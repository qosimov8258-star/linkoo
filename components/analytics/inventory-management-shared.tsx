"use client"

import { CheckCircle2 } from "lucide-react"

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
  type InventoryRequestStatus,
  type InventoryStatusParam,
  type InventoryTab,
} from "@/lib/inventory-items-types"

// Shared pieces of "Работа с инвентарем" (demo c84): the URL state of the page,
// the API query of each tab, date / number formatting, the Одобрено icon and
// the Excel sheets of the lists.

export type Translate = (text: string) => string

export type InventoryFilters = {
  clients: string[]
  products: string[]
  gear: string[]
  warehouses: string[]
  users: string[]
  organizations: string[]
  branches: string[]
  clientTypes: string[]
  agents: string[]
  zones: string[]
  isReviewed: "" | "true" | "false"
  showDeleted: boolean
  attachFrom: string
  attachTo: string
  createdFrom: string
  createdTo: string
  moveFrom: string
  moveTo: string
  updatedFrom: string
  updatedTo: string
  logType: "" | "give" | "take"
  requestTypes: string[]
  requestedBy: string[]
  processedBy: string[]
}

export const EMPTY_FILTERS: InventoryFilters = {
  clients: [],
  products: [],
  gear: [],
  warehouses: [],
  users: [],
  organizations: [],
  branches: [],
  clientTypes: [],
  agents: [],
  zones: [],
  isReviewed: "",
  showDeleted: false,
  attachFrom: "",
  attachTo: "",
  createdFrom: "",
  createdTo: "",
  moveFrom: "",
  moveTo: "",
  updatedFrom: "",
  updatedTo: "",
  logType: "",
  requestTypes: [],
  requestedBy: [],
  processedBy: [],
}

const LIST_KEYS = ["clients", "products", "gear", "warehouses", "users", "organizations", "branches", "clientTypes", "agents", "zones", "requestTypes", "requestedBy", "processedBy"] as const
const DATE_KEYS = ["attachFrom", "attachTo", "createdFrom", "createdTo", "moveFrom", "moveTo", "updatedFrom", "updatedTo"] as const

/** URL / API parameter of every list filter. */
const PARAM: Record<(typeof LIST_KEYS)[number], string> = {
  clients: "client",
  products: "product",
  gear: "gear",
  warehouses: "warehouse",
  users: "user",
  organizations: "organization",
  branches: "branch",
  clientTypes: "clientType",
  agents: "agent",
  zones: "zone",
  requestTypes: "requestType",
  requestedBy: "requestedBy",
  processedBy: "processedBy",
}

export type ViewState = {
  status: InventoryStatusParam
  /** Sub-tab of "Запросы" ("" = Все). */
  requestStatus: InventoryRequestStatus | ""
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: InventoryFilters
  detailId: number | null
}

/** Filter group of a tab: switching between groups clears the filters (demo filterBy). */
export function filterGroup(status: InventoryStatusParam): "items" | "history" | "history_check" | "request" {
  return status === "history" || status === "history_check" || status === "request" ? status : "items"
}

/** Tab highlighted for a status ("attachment" lists everything, like "Все"). */
export function activeTab(status: InventoryStatusParam): InventoryTab {
  return status === "attachment" ? "all" : status
}

function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).flatMap((value) => value.split("~")).map((value) => value.trim()).filter(Boolean))]
  const rawStatus = params.get("status") ?? ""
  const status = (INVENTORY_TABS as readonly string[]).includes(rawStatus) || rawStatus === "attachment" ? (rawStatus as InventoryStatusParam) : INVENTORY_DEFAULT_STATUS
  const rawRequest = params.get("requestStatus") ?? (status === "request" && !params.has("requestStatus") ? "pending" : "")
  const filters = { ...EMPTY_FILTERS }
  for (const key of LIST_KEYS) filters[key] = list(PARAM[key])
  for (const key of DATE_KEYS) filters[key] = /^\d{4}-\d{2}-\d{2}$/.test(params.get(key) ?? "") ? params.get(key)! : ""
  const reviewed = params.get("isReviewed")
  filters.isReviewed = reviewed === "true" || reviewed === "false" ? reviewed : ""
  filters.showDeleted = params.get("showDeleted") === "1"
  const logType = params.get("logType")
  filters.logType = logType === "give" || logType === "take" ? logType : ""
  return {
    status,
    requestStatus: (INVENTORY_REQUEST_STATUSES as readonly string[]).includes(rawRequest) ? (rawRequest as InventoryRequestStatus) : "",
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters,
    detailId: positiveInt(params.get("id")),
  }
}

function filterQuery(filters: InventoryFilters): CashQuery {
  const query: CashQuery = {}
  for (const key of LIST_KEYS) query[PARAM[key]] = filters[key]
  for (const key of DATE_KEYS) query[key] = filters[key]
  query.isReviewed = filters.isReviewed
  query.showDeleted = filters.showDeleted ? "1" : ""
  query.logType = filters.logType
  return query
}

export function stateToSearch(state: ViewState): string {
  return buildCashQuery({
    status: state.status,
    requestStatus: state.status === "request" ? state.requestStatus || "all" : "",
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    ...filterQuery(state.filters),
    id: state.detailId ?? "",
  })
}

/** API path + query of the current tab (pageSize 0 = every row, for Excel). */
export function listRequest(state: ViewState, pageSize = state.pageSize): string {
  const base = { search: state.search, ordering: state.ordering, page: pageSize ? state.page : 1, pageSize: String(pageSize), ...filterQuery(state.filters) }
  if (state.status === "history") return `/api/inventory-items/logs?${buildCashQuery(base)}`
  if (state.status === "history_check") return `/api/inventory-items/checks?${buildCashQuery(base)}`
  if (state.status === "request") return `/api/inventory-items/requests?${buildCashQuery({ ...base, requestStatus: state.requestStatus })}`
  return `/api/inventory-items?${buildCashQuery({ ...base, status: scopeOfStatus(state.status) ?? "all" })}`
}

/** Totals query (items tabs only). */
export function totalsRequest(state: ViewState): string | null {
  const scope = scopeOfStatus(state.status)
  if (!scope) return null
  return `/api/inventory-items/totals?${buildCashQuery({ search: state.search, ...filterQuery(state.filters), status: scope })}`
}

/** Number of filled filters of the tab ("Фильтр: N элемента"). */
export function filterCount(filters: InventoryFilters): number {
  return [
    ...LIST_KEYS.map((key) => filters[key].length > 0),
    Boolean(filters.attachFrom || filters.attachTo),
    Boolean(filters.createdFrom || filters.createdTo),
    Boolean(filters.moveFrom || filters.moveTo),
    Boolean(filters.updatedFrom || filters.updatedTo),
    Boolean(filters.isReviewed),
    filters.showDeleted,
    Boolean(filters.logType),
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

/** "g'ilof (№ 12)" — item title of the history / review rows (demo "product (№stockNumber)"). */
export function itemTitle(item: { product: string; stockNumber: string }): string {
  return item.stockNumber ? `${item.product} (№${item.stockNumber})` : item.product
}

export function photoUrl(item: { id: number; version: string }): string {
  return `/api/inventory-items/${item.id}/photo?v=${encodeURIComponent(item.version)}`
}

/** Demo Одобрено icon: green check / red cross. */
export function ReviewIcon({ reviewed, t, className = "h-5 w-5" }: { reviewed: boolean; t: Translate; className?: string }) {
  const label = reviewed ? t("Одобрено") : t("Не одобрено")
  return (
    <span title={label} role="img" aria-label={label} className="inline-flex shrink-0">
      {reviewed ? <CheckCircle2 className={`${className} text-[#71ce87]`} /> : <svg viewBox="0 0 24 24" className={`${className} fill-[#e66767]`}><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>}
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
      dayText(row.date, language),
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
