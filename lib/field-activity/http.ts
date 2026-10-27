import "server-only"

import { NextResponse } from "next/server"

import type { FieldScope } from "@/lib/field-activity/actor"
import { scopedEmployeeIds } from "@/lib/field-activity/actor"
import { fieldErrorResponse } from "@/lib/field-activity/errors"
import type { FieldEventQuery } from "@/lib/field-activity/events"
import { boolParam, idsParam, periodParams, type QueryResult } from "@/lib/field-activity/input"
import { FIELD_EVENT_KINDS, type FieldEventKind } from "@/lib/field-activity/types"
import { MAX_DB_ID } from "@/lib/strict-number"

// Request plumbing shared by the field activity routes (the routes themselves export only
// their handlers).

/** 400 for one bad query parameter (Russian i18n key + the parameter name). */
export function badQuery(result: { field: string; error: string }) {
  return NextResponse.json({ error: result.error, field: result.field }, { status: 400 })
}

/** Runs a handler; FieldError and busy-database errors become their JSON answers. */
export async function fieldRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    const response = fieldErrorResponse(error)
    if (response) return response
    throw error
  }
}

/** The raw request body, at most `maxBytes` (null when larger: the caller answers 413). */
export async function readCappedBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** A positive int4 id query parameter; `required` refuses an empty one. */
export function idParam(value: string | null, field: string, required = false): QueryResult<number | undefined> {
  const text = (value ?? "").trim()
  if (!text) return required ? { ok: false, field, error: "Обязательное поле" } : { ok: true, value: undefined }
  const id = /^\d{1,10}$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isInteger(id) || id <= 0 || id > MAX_DB_ID) return { ok: false, field, error: "Неверный идентификатор" }
  return { ok: true, value: id }
}

/**
 * The event filter of a read request: from / to (local days, default today), kind (comma list),
 * employeeId, clientId, clientTypeId (comma lists or repeated), branchId, withEquipment
 * (true|false|yes|no), onlyAttributed, excludeCancelled — narrowed to the reader's scope.
 */
export function eventQueryOf(params: URLSearchParams, scope: FieldScope): QueryResult<FieldEventQuery> {
  const period = periodParams(params)
  if (!period.ok) return period
  const kinds: FieldEventKind[] = []
  for (const part of params.getAll("kind").flatMap((value) => value.split(","))) {
    const kind = part.trim()
    if (!kind) continue
    if (!(FIELD_EVENT_KINDS as readonly string[]).includes(kind)) return { ok: false, field: "kind", error: "Неверное значение" }
    if (!kinds.includes(kind as FieldEventKind)) kinds.push(kind as FieldEventKind)
  }
  const employees = idsParam(params, "employeeId")
  if (!employees.ok) return employees
  const clients = idsParam(params, "clientId")
  if (!clients.ok) return clients
  const types = idsParam(params, "clientTypeId")
  if (!types.ok) return types
  const branch = idParam(params.get("branchId"), "branchId")
  if (!branch.ok) return branch
  const equipment = boolParam(params.get("withEquipment"), "withEquipment")
  if (!equipment.ok) return equipment
  const attributed = boolParam(params.get("onlyAttributed"), "onlyAttributed")
  if (!attributed.ok) return attributed
  const excludeCancelled = boolParam(params.get("excludeCancelled"), "excludeCancelled")
  if (!excludeCancelled.ok) return excludeCancelled
  return {
    ok: true,
    value: {
      from: period.value.from,
      to: period.value.to,
      kinds: kinds.length ? kinds : undefined,
      employeeIds: scopedEmployeeIds(scope, employees.value.length ? employees.value : undefined),
      clientIds: clients.value.length ? clients.value : undefined,
      clientTypeIds: types.value.length ? types.value : undefined,
      branchId: branch.value,
      withEquipment: equipment.value,
      onlyAttributed: attributed.value,
      excludeCancelled: excludeCancelled.value,
    },
  }
}
