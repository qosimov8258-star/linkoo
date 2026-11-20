"use client"

import { buildCashQuery, type CashQuery } from "@/components/analytics/cash/use-cash"
import { formatCashDate } from "@/components/analytics/cash-management-shared"
import { formatMoney } from "@/lib/finance/currency"
import {
  INVENTORY_DEFAULT_STATUS,
  INVENTORY_LOG_LABELS,
  INVENTORY_REQUEST_STATUSES,
  INVENTORY_TABS,
  scopeOfStatus,
  type InventoryCheck,
  type InventoryItem,
  type InventoryLog,
  type InventoryStatusParam,
  type InventoryTab,
} from "@/lib/inventory-items-types"

// Shared pieces of "Работа с инвентарем" (demo c84): the URL state of the page,
// the API query of each tab, date / number formatting, the Одобрено icon and
// the Excel sheets of the lists.

export type Translate = (text: string) => string

/**
 * Linko's InventoryManagementFilterForm keys, as its address holds them (ids joined by "-"): market, division,
 * product, branch, stock, user, gear, statusHistory, marketTypeParent, marketType, statusRequest, type, requestedBy,
 * userBy, isReviewed, showDeleted=true and the periods fromDate/toDate (Дата создания / Дата запроса),
 * fromDateSecond/toDateSecond (Дата движения), fromDateThird/toDateThird (Дата обработки) and
 * fromDateFourth/toDateFourth (Дата прикрепления, a field of Linko's newer API only, still read from the address).
 */
export type InventoryFilters = {
  market: string[]
  division: string[]
  product: string[]
  branch: string[]
  stock: string[]
  user: string[]
  gear: string[]
  statusHistory: "" | "give" | "take"
  marketTypeParent: string[]
  marketType: string[]
  /** The sub-tab of "Запросы" (pending / confirmed / canceled; empty = Все); the filter can pick several. */
  statusRequest: string[]
  type: string[]
  requestedBy: string[]
  userBy: string[]
  isReviewed: "" | "true" | "false"
  showDeleted: boolean
  fromDate: string
  toDate: string
  fromDateSecond: string
  toDateSecond: string
  fromDateThird: string
  toDateThird: string
  fromDateFourth: string
  toDateFourth: string
}

export const EMPTY_FILTERS: InventoryFilters = {
  market: [],
  division: [],
  product: [],
  branch: [],
  stock: [],
  user: [],
  gear: [],
  statusHistory: "",
  marketTypeParent: [],
  marketType: [],
  statusRequest: [],
  type: [],
  requestedBy: [],
  userBy: [],
  isReviewed: "",
  showDeleted: false,
  fromDate: "",
  toDate: "",
  fromDateSecond: "",
  toDateSecond: "",
  fromDateThird: "",
  toDateThird: "",
  fromDateFourth: "",
  toDateFourth: "",
}

const LIST_KEYS = ["market", "division", "product", "branch", "stock", "user", "gear", "marketTypeParent", "marketType", "statusRequest", "type", "requestedBy", "userBy"] as const
const DATE_KEYS = ["fromDate", "toDate", "fromDateSecond", "toDateSecond", "fromDateThird", "toDateThird", "fromDateFourth", "toDateFourth"] as const

export type ViewState = {
  status: InventoryStatusParam
  search: string
  ordering: string
  page: number
  pageSize: number
  /** pageSize is written into the address (Linko's menu link and its page-size select do; «Просмотреть» of a card
   * leaves it out). */
  pageSizeShown: boolean
  filters: InventoryFilters
  detailId: number | null
}

/** Address parameters of the open item card's dialogs (Linko: «Изменить» → openUpdateDialog=true, «Передача / Изъятие»
 * → openChangeDialog=true, the trash → openConfirmDialog=true, the photo → openImageDialog=<id>; each X writes
 * false / 0). The page keeps them while a card is open. */
export const CARD_DIALOG_KEYS = ["openUpdateDialog", "openChangeDialog", "openConfirmDialog", "openImageDialog"]

/** Address parameters of the page's own dialogs (Linko: «Показать фильтр» → openFilterDialog=true, «Добавить» →
 * openCreateDialog=true, «Импортировать» → excelImportCreateDialog=true; closing writes false). */
export const PAGE_DIALOG_KEYS = ["openFilterDialog", "openCreateDialog", "excelImportCreateDialog"]

/** A parameter of the current address (null on the server or when absent). */
export function readAddressParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name)
}

/** Sets (or, with null, removes) parameters of the current address without a new history entry. */
export function writeAddressParams(patch: Record<string, string | null>): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const search = params.toString()
  if (search !== window.location.search.slice(1)) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
}

/** Filter group of a tab (each list reads its own fields). */
export function filterGroup(status: InventoryStatusParam): "items" | "history" | "history_check" | "request" {
  return status === "history" || status === "history_check" || status === "request" ? status : "items"
}

/** Tab highlighted for a status: none for "attachment", the menu's default, which matches no tab in Linko (its
 * «Прикрепление» tab is in_market) although it lists every item. */
export function activeTab(status: InventoryStatusParam): InventoryTab | null {
  return status === "attachment" ? null : status
}

function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function stateFromParams(params: URLSearchParams): ViewState {
  // Linko joins ids with "-"; "~" and repeated keys are read too.
  const list = (name: string) => [...new Set(params.getAll(name).flatMap((value) => value.split(/[-~]/)).map((value) => value.trim()).filter(Boolean))]
  const rawStatus = params.get("status") ?? ""
  const status = (INVENTORY_TABS as readonly string[]).includes(rawStatus) || rawStatus === "attachment" ? (rawStatus as InventoryStatusParam) : INVENTORY_DEFAULT_STATUS
  const filters = { ...EMPTY_FILTERS }
  for (const key of LIST_KEYS) filters[key] = list(key)
  filters.statusRequest = filters.statusRequest.filter((value) => (INVENTORY_REQUEST_STATUSES as readonly string[]).includes(value))
  // A bare ?status=request (an old link) opens «В процессе», like Linko's tab.
  if (status === "request" && !params.has("statusRequest")) filters.statusRequest = ["pending"]
  for (const key of DATE_KEYS) filters[key] = ISO_DAY.test(params.get(key) ?? "") ? params.get(key)! : ""
  const reviewed = params.get("isReviewed")
  filters.isReviewed = reviewed === "true" || reviewed === "false" ? reviewed : ""
  filters.showDeleted = params.get("showDeleted") === "true"
  const history = params.get("statusHistory")
  filters.statusHistory = history === "give" || history === "take" ? history : ""
  return {
    status,
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    pageSizeShown: params.has("pageSize") || params.toString() === "",
    filters,
    detailId: positiveInt(params.get("id")),
  }
}

/** The address of the page: Linko's keys and values. */
export function stateToSearch(state: ViewState): string {
  const filters = state.filters
  const query: CashQuery = {
    status: state.status,
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSizeShown ? state.pageSize : "",
  }
  for (const key of LIST_KEYS) query[key] = filters[key].join("-")
  // Linko's «Все» sub-tab of Запросы writes an empty statusRequest.
  if (state.status === "request" && !filters.statusRequest.length) query.statusRequest = ""
  for (const key of DATE_KEYS) query[key] = filters[key]
  query.statusHistory = filters.statusHistory
  query.isReviewed = filters.isReviewed
  query.showDeleted = filters.showDeleted ? "true" : ""
  query.id = state.detailId ?? ""
  const search = buildCashQuery(query)
  return state.status === "request" && !filters.statusRequest.length ? `${search}&statusRequest=` : search
}

/** API query of the filters a list reads (the server matches the id filters through the names the rows keep). */
function apiQuery(state: ViewState): CashQuery {
  const f = state.filters
  const group = filterGroup(state.status)
  const query: CashQuery = { search: state.search, ordering: state.ordering, client: f.market, product: f.product, divisionId: f.division }
  if (group === "request") {
    return {
      ...query,
      requestStatus: f.statusRequest,
      requestType: f.type,
      requestedById: f.requestedBy,
      userById: f.userBy,
      createdFrom: f.fromDate,
      createdTo: f.toDate,
      updatedFrom: f.fromDateThird,
      updatedTo: f.toDateThird,
    }
  }
  query.gear = f.gear
  query.userId = f.user
  query.onlyDeleted = f.showDeleted ? "true" : ""
  // Linko sends market_type = Подкатегория, else Тип клиента.
  query.marketTypeId = f.marketType.length ? f.marketType : f.marketTypeParent
  if (group === "history_check") return { ...query, marketTypeId: [], createdFrom: f.fromDate, createdTo: f.toDate }
  query.stockId = f.stock
  if (group === "history") return { ...query, logType: f.statusHistory, createdFrom: f.fromDate, createdTo: f.toDate, moveFrom: f.fromDateSecond, moveTo: f.toDateSecond }
  return { ...query, branchId: f.branch, isReviewed: f.isReviewed, attachFrom: f.fromDateFourth, attachTo: f.toDateFourth }
}

/** API path + query of the current tab (pageSize 0 = every row, for Excel). */
export function listRequest(state: ViewState, pageSize = state.pageSize): string {
  const base = { ...apiQuery(state), page: pageSize ? state.page : 1, pageSize: String(pageSize) }
  if (state.status === "history") return `/api/inventory-items/logs?${buildCashQuery(base)}`
  if (state.status === "history_check") return `/api/inventory-items/checks?${buildCashQuery(base)}`
  if (state.status === "request") return `/api/inventory-items/requests?${buildCashQuery(base)}`
  return `/api/inventory-items?${buildCashQuery({ ...base, status: scopeOfStatus(state.status) ?? "all" })}`
}

/** Totals query (items tabs only). */
export function totalsRequest(state: ViewState): string | null {
  const scope = scopeOfStatus(state.status)
  if (!scope) return null
  return `/api/inventory-items/totals?${buildCashQuery({ ...apiQuery(state), status: scope })}`
}

/** «Фильтр: N элемента» (Linko's getCount): the filter keys that are set. A period counts once, by its end (Linko's
 * key list holds toDate…toDateFourth but not the starts), and statusRequest counts on Запросы (its sub-tab). */
export function filterCount(filters: InventoryFilters): number {
  return [
    ...LIST_KEYS.map((key) => filters[key].length > 0),
    Boolean(filters.statusHistory),
    Boolean(filters.isReviewed),
    filters.showDeleted,
    Boolean(filters.toDate),
    Boolean(filters.toDateSecond),
    Boolean(filters.toDateThird),
    Boolean(filters.toDateFourth),
  ].filter(Boolean).length
}

// --- formatting ---------------------------------------------------------------------------

/** "08 окт. 2026" (demo dateFormat) of a day or a date-time. */
export function dayText(iso: string, language: string): string {
  return iso ? formatCashDate(iso.slice(0, 10), language, false) : ""
}

/** "08 окт. 2026, 18:42" (demo dateTimeFormat). */
export function timeText(iso: string, language: string): string {
  return iso ? formatCashDate(iso, language, iso.length >= 16) : ""
}

export function qtyText(value: number, unit: string): string {
  return `${formatMoney(value, 3)}${unit ? ` ${unit}` : ""}`
}

/** "g'ilof   (№12)" — item title of the history / review rows: Linko prints `product, "   (№", stockNumber, ")"` (three
 * spaces in История движений, two in История проверки; "(№)" without a number), shown with white-space: pre. */
export function itemTitle(item: { product: string; stockNumber: string }, gap = "   "): string {
  return `${item.product}${gap}(№${item.stockNumber})`
}

export function photoUrl(item: { id: number; version: string }): string {
  return `/api/inventory-items/${item.id}/photo?v=${encodeURIComponent(item.version)}`
}

/** Demo Одобрено icon: green check / red cross. */
export function ReviewIcon({ reviewed, t, className = "h-5 w-5" }: { reviewed: boolean; t: Translate; className?: string }) {
  const label = reviewed ? t("Одобрено") : t("Не одобрено")
  return (
    <span title={label} role="img" aria-label={label} className="inline-flex shrink-0">
      {reviewed ? (
        <svg viewBox="0 0 24 24" className={`${className} fill-[#71ce87]`}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className={`${className} fill-[#e66767]`}>
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      )}
    </span>
  )
}

// --- Excel ----------------------------------------------------------------------------------

type Cell = string | number
const yesNo = (value: boolean, t: Translate) => (value ? t("Да") : t("Нет"))

export function itemsSheet(rows: InventoryItem[], t: Translate, language: string): Cell[][] {
  return [
    ["№", t("Серийный №"), t("Клиент"), t("Тип инвентаря"), t("Инвентарный №"), t("Склад"), t("Состояние"), t("Ответственный"), t("Дата прикрепления"), t("Дата проверки"), t("Дата создания"), t("Одобрено"), t("Комментарий")],
    ...rows.map((row) => [
      row.id,
      row.serialNumber,
      row.client?.name ?? "",
      row.product.name,
      row.stockNumber,
      row.warehouse,
      t(row.condition),
      row.responsible,
      dayText(row.date || row.createdAt, language),
      row.reviewedAt ? timeText(row.reviewedAt, language) : "",
      timeText(row.createdAt, language),
      yesNo(row.isReviewed, t),
      row.comment,
    ]),
  ]
}

export function logsSheet(rows: InventoryLog[], t: Translate, language: string): Cell[][] {
  return [
    [t("Инвентарь"), t("Инвентарный №"), t("Серийный №"), t("Дата создания"), t("Дата движения"), t("Клиент"), t("Склад"), t("Состояние"), t("Тип"), t("Комментарий"), t("Создал")],
    ...rows.map((row) => [
      row.item.product,
      row.item.stockNumber,
      row.item.serialNumber,
      timeText(row.createdAt, language),
      dayText(row.date, language),
      row.client?.name ?? "",
      row.warehouse,
      t(row.condition),
      t(INVENTORY_LOG_LABELS[row.status]),
      row.comment,
      row.createdBy,
    ]),
  ]
}

export function checksSheet(rows: InventoryCheck[], t: Translate, language: string): Cell[][] {
  return [
    ["№", t("Клиент"), t("Создал"), t("Дата проверки"), t("Инвентарь"), t("Инвентарный №"), t("Одобрено"), t("Комментарий")],
    ...rows.map((row) => [row.id, row.client?.name ?? "", row.createdBy, timeText(row.createdAt, language), row.item.product, row.item.stockNumber, yesNo(row.isReviewed, t), row.comment]),
  ]
}
