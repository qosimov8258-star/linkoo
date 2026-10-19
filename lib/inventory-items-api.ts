import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  INVENTORY_LOG_STATUSES,
  INVENTORY_REQUEST_STATUSES,
  INVENTORY_REQUEST_TYPES,
  scopeOfStatus,
  type InventoryItemScope,
  type InventoryLogStatus,
  type InventoryRequestStatus,
  type InventoryRequestType,
  type InventoryStatusParam,
} from "@/lib/inventory-items-types"

// HTTP helpers of /api/inventory-items/** (route files export only handlers).
// Error messages are Russian i18n keys; the UI shows them through t().

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** JSON response of an InventoryError ({error, field?, …extra}); rethrows anything else. */
export function inventoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof InventoryError) {
    return NextResponse.json({ error: error.message, field: error.field ?? null, ...(error.extra ?? {}) }, { status: error.status })
  }
  throw error
}

export function parseInventoryId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}

/** Every filter of the four lists (items, history, reviews, requests); each list reads its own subset. */
export type InventoryQuery = {
  search: string
  page: number
  /** 0 = every row (Excel). */
  pageSize: number
  ordering: string
  scope: InventoryItemScope
  clients: number[]
  products: number[]
  /** Инвентарь (item ids). */
  items: number[]
  warehouses: string[]
  users: string[]
  organizations: string[]
  branches: string[]
  clientTypes: string[]
  agents: string[]
  zones: string[]
  isReviewed: boolean | null
  showDeleted: boolean
  attachFrom: string
  attachTo: string
  createdFrom: string
  createdTo: string
  moveFrom: string
  moveTo: string
  updatedFrom: string
  updatedTo: string
  logStatuses: InventoryLogStatus[]
  requestStatuses: InventoryRequestStatus[]
  requestTypes: InventoryRequestType[]
  requestedBy: string[]
  processedBy: string[]
}

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint: string) {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [name]: [hint] } } }, { status: 400 })
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function texts(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split("~")).map((value) => value.trim().slice(0, 300)).filter(Boolean))].slice(0, 200)
}

function ids(values: string[]): number[] {
  return texts(values)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647)
}

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return texts(values).filter((value): value is T => (allowed as readonly string[]).includes(value))
}

/**
 * Query of the lists: ?status=in_stock|in_market|all|attachment &search &ordering &page &pageSize (0 = all)
 * &client=<id>* &product=<id>* &gear=<item id>* &warehouse=<name>* &user=<name>* &organization* &branch*
 * &clientType* &agent* &zone* &isReviewed=true|false &showDeleted=1 &attachFrom/To &createdFrom/To &moveFrom/To
 * &updatedFrom/To (YYYY-MM-DD) &logType=create|give|take* &requestStatus=pending|confirmed|canceled*
 * &requestType=attach|detach* &requestedBy* &processedBy*. Multi values repeat or join with "~".
 */
export function parseInventoryQuery(url: string): Parsed<InventoryQuery> {
  const search = new URL(url).searchParams
  const all = (name: string) => search.getAll(name)
  const page = Number(search.get("page") ?? 1)
  const pageSize = Number(search.get("pageSize") ?? search.get("page_size") ?? 25)
  if (!Number.isInteger(page) || page < 1) return { error: bad("page", ">= 1") }
  if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 10000) return { error: bad("pageSize", "0..10000") }
  const status = (search.get("status") ?? "attachment").trim() || "attachment"
  const scope = scopeOfStatus(status as InventoryStatusParam)
  if (!scope) return { error: bad("status", "in_stock | in_market | all | attachment") }
  const dates: Record<string, string> = {}
  for (const name of ["attachFrom", "attachTo", "createdFrom", "createdTo", "moveFrom", "moveTo", "updatedFrom", "updatedTo"]) {
    const value = (search.get(name) ?? "").trim()
    if (value && !ISO_DAY.test(value)) return { error: bad(name, "YYYY-MM-DD") }
    dates[name] = value
  }
  const reviewed = (search.get("isReviewed") ?? "").trim()
  if (reviewed && reviewed !== "true" && reviewed !== "false") return { error: bad("isReviewed", "true | false") }
  const showDeleted = ["1", "true"].includes((search.get("showDeleted") ?? "").trim())
  return {
    data: {
      search: (search.get("search") ?? "").trim().slice(0, 200),
      page,
      pageSize,
      ordering: (search.get("ordering") ?? "").trim().slice(0, 40),
      scope,
      clients: ids(all("client")),
      products: ids(all("product")),
      items: ids(all("gear")),
      warehouses: texts([...all("warehouse"), ...all("stock")]),
      users: texts(all("user")),
      organizations: texts(all("organization")),
      branches: texts(all("branch")),
      clientTypes: texts(all("clientType")),
      agents: texts(all("agent")),
      zones: texts(all("zone")),
      isReviewed: reviewed ? reviewed === "true" : null,
      showDeleted,
      attachFrom: dates.attachFrom,
      attachTo: dates.attachTo,
      createdFrom: dates.createdFrom,
      createdTo: dates.createdTo,
      moveFrom: dates.moveFrom,
      moveTo: dates.moveTo,
      updatedFrom: dates.updatedFrom,
      updatedTo: dates.updatedTo,
      logStatuses: pick(all("logType"), INVENTORY_LOG_STATUSES),
      requestStatuses: pick(all("requestStatus"), INVENTORY_REQUEST_STATUSES),
      requestTypes: pick(all("requestType"), INVENTORY_REQUEST_TYPES),
      requestedBy: texts(all("requestedBy")),
      processedBy: texts(all("processedBy")),
    },
  }
}

// --- bodies ------------------------------------------------------------------------------

const day = z.union([z.literal(""), z.string().regex(ISO_DAY)])
const optionalId = z.coerce.number().int().positive().max(2_147_483_647).nullable().optional()
const text = (max: number) => z.string().trim().max(max)

/** POST /api/inventory-items, PUT /api/inventory-items/[id]. Required fields are checked by the repo (field errors). */
export const inventoryItemSchema = z.object({
  warehouse: text(300).default(""),
  productId: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  condition: text(100).default(""),
  responsible: text(300).default(""),
  clientId: optionalId,
  serialNumber: text(200).default(""),
  stockNumber: text(200).default(""),
  date: day.default(""),
  comment: text(2000).default(""),
  photo: z
    .union([z.literal(""), z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/)])
    .optional(),
})

/** POST /api/inventory-items/[id]/change — "Передача / Изъятие". */
export const inventoryChangeSchema = z.object({
  takeDate: day.optional(),
  giveClientId: optionalId,
  giveDate: day.optional(),
  condition: text(100).optional(),
  comment: text(2000).optional(),
})

export const inventoryReviewSchema = z.object({ isReviewed: z.boolean() })

export const inventoryBulkDeleteSchema = z.object({ ids: z.array(z.coerce.number().int().positive().max(2_147_483_647)).min(1).max(500) })

export const inventoryRequestCreateSchema = z.object({
  type: z.enum(INVENTORY_REQUEST_TYPES),
  clientId: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  productId: optionalId,
  itemId: optionalId,
  comment: text(2000).default(""),
})

export const inventoryRequestConfirmSchema = z.object({ itemId: optionalId })

export const inventoryRequestCancelSchema = z.object({ reason: text(2000).default("") })

export const inventoryImportSchema = z.object({
  rows: z
    .array(
      z.object({
        line: z.coerce.number().int().min(1).max(100000),
        clientId: z.coerce.string().max(30).optional(),
        client: z.coerce.string().max(300).optional(),
        product: z.coerce.string().max(300).default(""),
        serialNumber: z.coerce.string().max(200).optional(),
        stockNumber: z.coerce.string().max(200).optional(),
        warehouse: z.coerce.string().max(300).optional(),
        condition: z.coerce.string().max(100).optional(),
        date: z.coerce.string().max(40).optional(),
        comment: z.coerce.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(5000),
})

/** Clients of the import template: ?agent=<name>* &zone=<name>*. */
export function parseTemplateQuery(url: string): { agents: string[]; zones: string[] } {
  const search = new URL(url).searchParams
  return { agents: texts([...search.getAll("agent"), ...search.getAll("responsible_agent")]), zones: texts([...search.getAll("zone"), ...search.getAll("border")]) }
}
