"use client"

import type { ReturnStatus } from "./supplier-returns-data"

// The supplier returns page keeps its state in the address like Linko's #/provider-return routes:
// - the opened card is a path segment: /analytics/supplier-returns/22 (Linko: #/provider-return/22), the list's query
//   kept as it is; closing it goes back to /analytics/supplier-returns?<query>;
// - the list's own state is the query: pageSize, page, search, the filter (status=in_progress-completed, provider,
//   stock, division, branch, product — ids joined by "-" —, paymentType, createdFromDate / createdToDate,
//   transferPeriodFromDate / transferPeriodToDate), openFilterDialog and the checkbox column (showCheckboxes=true,
//   the ticked rows as select=22-19); a fresh address gets Linko's menu query
//   (pageSize=25&status=in_progress-completed), «Очистить» leaves no filter;
// - the dialogs are query parameters: openCreateDialog / openUpdateDialog (true while open, false once closed),
//   transferDialog («Принять»), pdPageSize / pdPage / pdSearch («Добавление продуктов» inside the form; Linko leaves
//   them as bare keys once it closes).
// The query is written in key order with empty values as bare keys, as Linko's query-string does. Every change is a
// history entry (pushState) except typing in a search box, so Back closes what was opened. Next's router follows
// pushState, so the page reads the address with usePathname / useSearchParams.

export const SUPPLIER_RETURNS_BASE = "/analytics/supplier-returns"

/** Linko's status values of the list query. */
export const STATUS_PARAM: Record<ReturnStatus, string> = { "в процессе": "in_progress", завершен: "completed", отменен: "cancelled" }
/** Linko's menu link: the list opens with this query. */
export const DEFAULT_LIST_QUERY = "pageSize=25&status=in_progress-completed"

const onPage = () => typeof window !== "undefined" && window.location.pathname.startsWith(SUPPLIER_RETURNS_BASE)

/** The card id of a pathname ("/analytics/supplier-returns/22" → 22), else null. */
export function cardIdOf(pathname: string | null | undefined): number | null {
  const match = /^\/analytics\/supplier-returns\/(\d{1,10})\/?$/.exec(pathname ?? "")
  const id = match ? Number(match[1]) : NaN
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}

/** "a=1&b&c=2": keys sorted, an empty value written as a bare key. */
export function queryText(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params)
  sorted.sort()
  return [...sorted].map(([name, value]) => (value === "" ? encodeURIComponent(name) : `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)).join("&")
}

function write(path: string, params: URLSearchParams, replace = false) {
  const query = queryText(params)
  const url = `${path}${query ? `?${query}` : ""}`
  if (url === `${window.location.pathname}${window.location.search}`) return
  // No state object: Next's router syncs usePathname / useSearchParams only with a history entry it did not make.
  if (replace) window.history.replaceState(null, "", url)
  else window.history.pushState(null, "", url)
}

/** Sets (string; "" = a bare key) or removes (null) query parameters, keeping the rest. */
export function applyPatch(params: URLSearchParams, patch: Record<string, string | null>): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) next.delete(name)
    else next.set(name, value)
  }
  return next
}

/** Sets or removes query parameters, keeping the rest. */
export function pushParams(patch: Record<string, string | null>, replace = false) {
  if (!onPage()) return
  write(window.location.pathname, applyPatch(new URLSearchParams(window.location.search), patch), replace)
}

/** Replaces the whole query (the filter's «Применить» / «Очистить»), keeping the path. */
export function pushQuery(query: string, replace = false) {
  if (!onPage()) return
  write(window.location.pathname, new URLSearchParams(query), replace)
}

/** Opens the card `id` (null closes it), keeping the list's query; `patch` changes parameters at the same time. */
export function pushCard(id: number | null, patch: Record<string, string | null> = {}) {
  if (!onPage()) return
  write(id === null ? SUPPLIER_RETURNS_BASE : `${SUPPLIER_RETURNS_BASE}/${id}`, applyPatch(new URLSearchParams(window.location.search), patch))
}

// ---------------------------------------------------------------------------
// The list query
// ---------------------------------------------------------------------------

export type ListFilter = {
  statuses: ReturnStatus[]
  /** Ids as Linko writes them (several joined by "-": "12-13"); a product's is its catalog key's id, or "r<id>" for a
   * raw material (no "-" inside, so the joined list stays readable). */
  provider: string[]
  stock: string[]
  division: string[]
  branch: string[]
  product: string[]
  /** "bank" | "cash" | "". */
  paymentType: string
  createdFrom: string
  createdTo: string
  transferFrom: string
  transferTo: string
}

export type ListQuery = ListFilter & {
  page: number
  pageSize: number
  search: string
  filterOpen: boolean
  /** Linko's checkbox column (?showCheckboxes=true) and the ticked rows (?select=22-19). */
  showCheckboxes: boolean
  select: number[]
}

export const EMPTY_FILTER: ListFilter = { statuses: [], provider: [], stock: [], division: [], branch: [], product: [], paymentType: "", createdFrom: "", createdTo: "", transferFrom: "", transferTo: "" }

const PAGE_SIZES = [10, 25, 50, 100, 200, 500]
const isDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "")
/** The ids of Linko's "12-13" (`raw` also takes a raw material's "r5"). */
const idList = (value: string | null, raw = false) => [
  ...new Set(
    String(value ?? "")
      .split("-")
      .map((part) => part.trim())
      .filter((part) => /^\d{1,10}$/.test(part) || (raw && /^r\d{1,10}$/.test(part))),
  ),
]

export function readListQuery(params: URLSearchParams): ListQuery {
  const byParam = new Map(Object.entries(STATUS_PARAM).map(([status, param]) => [param, status as ReturnStatus]))
  const statuses = [...new Set((params.get("status") ?? "").split("-").map((part) => byParam.get(part)).filter((status): status is ReturnStatus => Boolean(status)))]
  const page = Number(params.get("page"))
  const size = Number(params.get("pageSize"))
  const payment = params.get("paymentType")
  return {
    statuses,
    provider: idList(params.get("provider")),
    stock: idList(params.get("stock")),
    division: idList(params.get("division")),
    branch: idList(params.get("branch")),
    product: idList(params.get("product"), true),
    paymentType: payment === "bank" || payment === "cash" ? payment : "",
    createdFrom: isDay(params.get("createdFromDate")),
    createdTo: isDay(params.get("createdToDate")),
    transferFrom: isDay(params.get("transferPeriodFromDate")),
    transferTo: isDay(params.get("transferPeriodToDate")),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : 25,
    search: params.get("search") ?? "",
    filterOpen: params.get("openFilterDialog") === "true",
    showCheckboxes: params.get("showCheckboxes") === "true",
    select: idList(params.get("select")).map(Number),
  }
}

/** The query parameters of a filter (null = not set), as Linko's «Применить» writes them. */
export function filterPatch(filter: ListFilter): Record<string, string | null> {
  const order: ReturnStatus[] = ["в процессе", "завершен", "отменен"]
  const statuses = order.filter((status) => filter.statuses.includes(status)).map((status) => STATUS_PARAM[status])
  return {
    status: statuses.length ? statuses.join("-") : null,
    provider: filter.provider.join("-") || null,
    stock: filter.stock.join("-") || null,
    division: filter.division.join("-") || null,
    branch: filter.branch.join("-") || null,
    product: filter.product.join("-") || null,
    paymentType: filter.paymentType || null,
    createdFromDate: filter.createdFrom || null,
    createdToDate: filter.createdFrom ? filter.createdTo || filter.createdFrom : null,
    transferPeriodFromDate: filter.transferFrom || null,
    transferPeriodToDate: filter.transferFrom ? filter.transferTo || filter.transferFrom : null,
  }
}

/** Whether the query names any list state (else it is a fresh address that gets Linko's menu query). */
export function hasListState(params: URLSearchParams): boolean {
  return [...params.keys()].some((name) => !["openCreateDialog", "openUpdateDialog", "transferDialog", "pdPage", "pdPageSize", "pdSearch", "tab"].includes(name))
}
