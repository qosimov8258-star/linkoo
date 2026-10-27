import "server-only"

import { z } from "zod"

import { dbId, strictId, INVALID_ID } from "@/lib/strict-number"
import {
  MAX_RESTRICTION_EMPLOYEES,
  MAX_RESTRICTION_ITEMS,
  MAX_RESTRICTION_PAIRS,
  MAX_RESTRICTION_SEARCH,
  RESTRICTION_DEFAULT_PAGE_SIZE,
  RESTRICTION_MODES,
  RESTRICTION_PAGE_SIZES,
  RESTRICTION_PICKER_PAGE_SIZE,
  RESTRICTION_TABS,
  type RestrictionMode,
  type RestrictionOrdering,
  type RestrictionTab,
} from "@/lib/product-restrictions-types"

// Request validation of /api/product-restrictions/**. Every message is a Russian i18n key.

export const SELECT_EMPLOYEE = "Выберите хотя бы одного сотрудника"
export const SELECT_PRODUCT = "Выберите хотя бы один товар"
export const SELECT_PRODUCT_TYPE = "Выберите хотя бы один тип продукта"
export const TOO_MANY_VALUES = "Слишком много значений"
const BAD_PARAMETER = "Неверный параметр"
const BAD_MODE = "Неверный режим"
const TOO_LONG = "Слишком длинное значение"

/** Unique ids in the order given. */
function unique(ids: number[]): number[] {
  return [...new Set(ids)]
}

const idList = (max: number) =>
  z
    .array(dbId(INVALID_ID), { error: INVALID_ID })
    .max(max, TOO_MANY_VALUES)
    .transform(unique)

/**
 * POST /api/product-restrictions
 * {mode: add | remove | set, tab: product | product_type, employeeIds: [id…], itemIds: [id…]}
 * ADD and REMOVE need at least one item; SET with no items clears the list.
 */
export const restrictionApplySchema = z
  .object({
    mode: z.enum(RESTRICTION_MODES, { error: BAD_MODE }),
    tab: z.enum(RESTRICTION_TABS, { error: BAD_PARAMETER }),
    employeeIds: idList(MAX_RESTRICTION_EMPLOYEES).refine((ids) => ids.length > 0, SELECT_EMPLOYEE),
    itemIds: idList(MAX_RESTRICTION_ITEMS).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "set" && value.itemIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["itemIds"], message: value.tab === "product" ? SELECT_PRODUCT : SELECT_PRODUCT_TYPE })
    }
    if (value.employeeIds.length * Math.max(1, value.itemIds.length) > MAX_RESTRICTION_PAIRS) {
      ctx.addIssue({ code: "custom", path: ["itemIds"], message: TOO_MANY_VALUES })
    }
  })

export type RestrictionApplyInput = {
  mode: RestrictionMode
  tab: RestrictionTab
  employeeIds: number[]
  itemIds: number[]
}

type QueryError = { error: string; field: string }

/** A search text of a query string: NFC, control characters as spaces, trimmed; null when too long. */
function searchParam(value: string | null): string | null {
  const text = (value ?? "").normalize("NFC").replace(/[\p{Cc}\u2028\u2029]+/gu, " ").trim()
  return text.length > MAX_RESTRICTION_SEARCH ? null : text
}

function pageParam(value: string | null): number | null {
  const text = (value ?? "").trim()
  if (!text) return 1
  const page = strictId(text)
  return page !== null && page <= 1_000_000 ? page : null
}

function pageSizeParam(value: string | null, fallback: number): number | null {
  const text = (value ?? "").trim()
  if (!text) return fallback
  if (!/^\d+$/.test(text)) return null
  const size = Number(text)
  return (RESTRICTION_PAGE_SIZES as readonly number[]).includes(size) ? size : null
}

function tabParam(value: string | null): RestrictionTab | null {
  const text = (value ?? "").trim()
  if (!text) return "product"
  return (RESTRICTION_TABS as readonly string[]).includes(text) ? (text as RestrictionTab) : null
}

/** An optional id filter: null = not given, NaN-free number, or undefined when invalid. */
function optionalId(value: string | null): number | null | undefined {
  const text = (value ?? "").trim()
  if (!text) return null
  return strictId(text) ?? undefined
}

export type RestrictionListQuery = {
  tab: RestrictionTab
  search: string
  page: number
  pageSize: number
  ordering: RestrictionOrdering
}

/** GET /api/product-restrictions?tab=product|product_type&search=&page=&pageSize=&ordering=id|-id */
export function parseRestrictionListQuery(params: URLSearchParams): { query: RestrictionListQuery } | QueryError {
  const tab = tabParam(params.get("tab"))
  if (!tab) return { error: BAD_PARAMETER, field: "tab" }
  const search = searchParam(params.get("search"))
  if (search === null) return { error: TOO_LONG, field: "search" }
  const page = pageParam(params.get("page"))
  if (page === null) return { error: BAD_PARAMETER, field: "page" }
  const pageSize = pageSizeParam(params.get("pageSize"), RESTRICTION_DEFAULT_PAGE_SIZE)
  if (pageSize === null) return { error: BAD_PARAMETER, field: "pageSize" }
  const orderingText = (params.get("ordering") ?? "").trim()
  if (orderingText && orderingText !== "id" && orderingText !== "-id") return { error: BAD_PARAMETER, field: "ordering" }
  return { query: { tab, search, page, pageSize, ordering: orderingText === "-id" ? "-id" : "id" } }
}

export type RestrictionOptionsQuery = {
  kind: RestrictionTab
  search: string
  page: number
  pageSize: number
  typeId: number | null
  brandId: number | null
  organizationId: number | null
}

/** GET /api/product-restrictions/options?kind=product|product_type&search=&page=&pageSize=&type=&brand=&organization= */
export function parseRestrictionOptionsQuery(params: URLSearchParams): { query: RestrictionOptionsQuery } | QueryError {
  const kind = tabParam(params.get("kind"))
  if (!kind) return { error: BAD_PARAMETER, field: "kind" }
  const search = searchParam(params.get("search"))
  if (search === null) return { error: TOO_LONG, field: "search" }
  const page = pageParam(params.get("page"))
  if (page === null) return { error: BAD_PARAMETER, field: "page" }
  const pageSize = pageSizeParam(params.get("pageSize"), RESTRICTION_PICKER_PAGE_SIZE)
  if (pageSize === null) return { error: BAD_PARAMETER, field: "pageSize" }
  const filters: Record<"typeId" | "brandId" | "organizationId", number | null> = { typeId: null, brandId: null, organizationId: null }
  for (const [param, key] of [["type", "typeId"], ["brand", "brandId"], ["organization", "organizationId"]] as const) {
    const id = optionalId(params.get(param))
    if (id === undefined) return { error: INVALID_ID, field: param }
    // The type list has no filters (the demo shows only the search there).
    filters[key] = kind === "product" ? id : null
  }
  return { query: { kind, search, page, pageSize, ...filters } }
}

export type AllowedQuery = { employeeId: number | null; agent: string | null }

/** GET /api/product-restrictions/allowed?employeeId=<id> | ?agent=<"First Last"> | (none: the caller's own employee) */
export function parseAllowedQuery(params: URLSearchParams): { query: AllowedQuery } | QueryError {
  const idText = params.get("employeeId")
  const employeeId = optionalId(idText)
  if (employeeId === undefined) return { error: INVALID_ID, field: "employeeId" }
  const agent = searchParam(params.get("agent"))
  if (agent === null) return { error: TOO_LONG, field: "agent" }
  return { query: { employeeId, agent: agent || null } }
}
