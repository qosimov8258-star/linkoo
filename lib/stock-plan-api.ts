import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dbErrorResponse } from "@/lib/db-errors"
import { isIsoDay } from "@/lib/finance/dates"
import type { PlanPaging, PlanTaskFilters } from "@/lib/stock-plan"
import type { PlanMoveFilters } from "@/lib/stock-plan-movements"
import { PLAN_TASK_TABS, PLAN_TYPE_LABELS, type PlanTaskTab, type PlanTaskType } from "@/lib/stock-plan-types"
import { parsePageParam } from "@/lib/stock/paging"
import { notSignedInResponse, invalidFieldResponse } from "@/lib/validation"

// Query parsing of /api/stock/plan/** (the GETs). The row actions go to the
// documents' own endpoints (PATCH /api/supplier-incomings/[id], POST
// /api/internal-transfers/[id]/action), except a client return's "Принять":
// POST /api/stock/plan/returns/[id]/accept, so the warehouse keeper's stock
// permission is enough (POST /api/client-returns/** asks for orders.manage).

type Parsed<T> = { value: T; error?: undefined } | { value?: undefined; error: NextResponse }

function list(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

function badRequest(field: string, hint: string): NextResponse {
  return invalidFieldResponse(field, hint)
}

/** 401 unless signed in (reads are open to every role, like the other stock pages). */
export async function planAuth(): Promise<NextResponse | null> {
  const user = await getCurrentUser()
  return user ? null : notSignedInResponse()
}

function period(params: URLSearchParams): Parsed<{ from: string; to: string }> {
  let from = (params.get("from") ?? "").trim()
  let to = (params.get("to") ?? "").trim()
  if (from && !isIsoDay(from)) return { error: badRequest("from", "YYYY-MM-DD") }
  if (to && !isIsoDay(to)) return { error: badRequest("to", "YYYY-MM-DD") }
  if (from && to && from > to) [from, to] = [to, from]
  return { value: { from, to } }
}

/** page (1-based), pageSize (0 = all rows), ordering ([-]field). */
export function parsePlanPaging(params: URLSearchParams): PlanPaging {
  const page = parsePageParam(params.get("page"))
  const raw = params.get("pageSize")
  const size = raw === null || raw === "" ? 25 : Math.floor(Number(raw))
  return { page, pageSize: Number.isFinite(size) && size >= 0 ? Math.min(size, 2000) : 25, ordering: (params.get("ordering") ?? "").trim() }
}

export function parsePlanTab(params: URLSearchParams): Parsed<PlanTaskTab> {
  const tab = (params.get("tab") ?? "receive").trim() as PlanTaskTab
  return PLAN_TASK_TABS.includes(tab) ? { value: tab } : { error: badRequest("tab", PLAN_TASK_TABS.join(" | ")) }
}

/** warehouse* type doneBy* from to search. */
export function parseTaskFilters(params: URLSearchParams): Parsed<PlanTaskFilters> {
  const dates = period(params)
  if (dates.error) return dates
  const type = (params.get("type") ?? "").trim()
  if (type && !Object.prototype.hasOwnProperty.call(PLAN_TYPE_LABELS, type)) return { error: badRequest("type", Object.keys(PLAN_TYPE_LABELS).join(" | ")) }
  return {
    value: {
      warehouses: list(params, "warehouse"),
      type: type as PlanTaskType | "",
      doneBy: list(params, "doneBy"),
      ...dates.value,
      search: (params.get("search") ?? "").trim(),
    },
  }
}

/** warehouse* type* product* typeParent* subcategory* from to search. */
export function parseMoveFilters(params: URLSearchParams): Parsed<PlanMoveFilters> {
  const dates = period(params)
  if (dates.error) return dates
  return {
    value: {
      warehouses: list(params, "warehouse"),
      types: list(params, "type"),
      products: list(params, "product"),
      typeParents: list(params, "typeParent"),
      subcategories: list(params, "subcategory"),
      direction: ["in", "out"].includes(params.get("direction") ?? "") ? (params.get("direction") as string) : "",
      ...dates.value,
      search: (params.get("search") ?? "").trim(),
    },
  }
}

/** A busy database → 503 / 409 (lib/db-errors.ts); anything else → 500 with a Russian i18n key, never
 * the raw error text (it can carry SQL). The error itself is logged. */
export function planFailure(error: unknown): NextResponse {
  console.error("stock plan:", error)
  return dbErrorResponse(error) ?? NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 })
}
