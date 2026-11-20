"use client"

import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { RI, RefAppliedFilter, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { compareBandCurrencies, formatMoney, roundMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

import { AddReturnDialog } from "./add-return-dialog"
import { ReturnStatusActions, ReturnTrashButton } from "./return-card-dialogs"
import { ReturnLogsTab } from "./return-logs-tab"
import { ReturnEditButton, ReturnEditGate } from "./return-edit-button"
import { ReturnCardAside, ReturnCardTitle } from "./return-card-aside"
import { ReturnItemsTab } from "./return-items-tab"
import { useReturnItemMarksScope } from "./return-item-marks"
import { ReturnShopDrawer, ReturnsListShopDrawer, shopInAddress, writeShopToAddress } from "./return-shop-drawer"
import { ReturnPrintButton, ReturnsPrintSelected } from "./return-print"
import { ReturnSeriesButtons, ReturnSeriesListAction, ReturnSeriesTab, useReturnSeriesSelection } from "./return-series"
import { EMPTY_RETURN_FILTERS, ReturnsFilterFields, filterReturns, readReturnFilters, returnFilterCount, returnFiltersNeedDirectories, useReturnFilterDirectories, writeReturnFilters, type ReturnFilters } from "./returns-filter"
import { ReturnsAcceptSelected, ReturnsDownloadMenu, ReturnsMultiUpdate, ReturnsSalesMenu } from "./returns-list-bulk"
import { RETURNS_EXCEL_NAME, SELECTED_RETURNS_EXCEL_NAME, downloadListExcel } from "./returns-list-excel"

// Продажи → Возвраты: client returns stored by /api/client-returns. A return
// is created "pending"; "Принять на склад" accepts it — only then the goods
// come back into its warehouse (stock) and the client is credited by its
// amount (client balance). A pending return can be edited or cancelled. An
// accepted one can be undone («Отменить запрос», after a confirmation): it goes
// back to pending while its warehouse still holds the goods (else the server
// answers 409 with the shortage).
//
// Like Linko (#/return): the tabs are the status filter (Надо принять = status 0-1, Принятые = 2), the list is
// filtered, searched (id, client account, comment), sorted (№, Дата возврата, Сумма возврата) and summed over every
// matching return, and the tab, search, filters, page, sorting, open card, card tab and dialogs live in the address.
// A return's card opens in place of its row, the rows around it stay.

export type ClientReturnItem = {
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  price: number
  total: number
  orderItemId: number | null
  orderId?: number | null
  orderCreatedAt?: string | null
  boxAmount?: number
  boxUnit?: string
}

export type ClientReturnRow = {
  id: number
  clientId: number | null
  client: string
  zone: string
  warehouse: string
  /** The return's organization (shown under the warehouse, like the reference). */
  organization?: string
  orderId: number | null
  returnDate: string
  status: "pending" | "accepted" | "cancelled"
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  createdBy: string
  createdAt: string
  acceptedAt: string | null
  acceptedBy: string
  unacceptedAt?: string | null
  unacceptedBy?: string
  cancelledAt?: string | null
  cancelledBy?: string
  branch?: string
  clientType?: string
  account?: string
  paymentType?: string
  /** The return's own payment type (the payment icon and the payment filters), see lib/client-returns-repo.ts. */
  returnPaymentType?: string
  /** Linko's custom payment type of a copied return («Наличные», or its older «cash» / «bank»); '' = none. */
  paymentTypeName?: string
  reason?: string
  onDelivery?: boolean
  fromOrder?: boolean
  productIds?: number[]
  brands?: string[]
  /** The client account's id, the lines' marking codes and the shop's branch (the list filters «Финансовый счет», «Код»
   * and «Филиалы»). */
  accountId?: number | null
  markCodes?: string[]
  shopBranch?: string
  items?: ClientReturnItem[]
  itemCount?: number
}

const STATUS_LABEL: Record<ClientReturnRow["status"], string> = { pending: "Ожидает", accepted: "Принят", cancelled: "Отменен" }
const STATUS_COLOR: Record<ClientReturnRow["status"], string> = { pending: "text-[#f0ad4e]", accepted: "text-[#48a34b]", cancelled: "text-[#e57373]" }
const TABS = ["Надо принять", "Принятые", "Все"] as const
type Tab = (typeof TABS)[number]
const TAB_STATUS: Record<Tab, string[]> = { "Надо принять": ["0", "1"], Принятые: ["2"], Все: [] }
// moment's Russian short months, as the reference prints them ("04 мар. 2026", "17 июля 2026").
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
// Linko's list columns: 5% 22% 12% 12% 14% 15% 15% 15% 15% of a flex row (125 %) shrunk to fit, each in proportion to
// its basis less its 16 px padding, which leaves 61.58 / 259.16 / 142.94 / 166.18 / 177.8 px of a 1484 px row.
const LIST_COLS = "minmax(0,61.58fr) minmax(0,259.16fr) minmax(0,142.94fr) minmax(0,142.94fr) minmax(0,166.18fr) minmax(0,177.8fr) minmax(0,177.8fr) minmax(0,177.8fr) minmax(0,177.8fr)"
// Linko's page sizes.
const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]

type SortKey = "id" | "date" | "amount"
type Sort = { key: SortKey; desc: boolean } | null
const SORT_PARAM: Record<SortKey, string> = { id: "id", date: "createdDate", amount: "totalPrice" }

function tabOf(status: string[]): Tab {
  const key = [...status].sort().join("-")
  return key === "0-1" ? "Надо принять" : key === "2" ? "Принятые" : "Все"
}

/** The list state from the address (Linko keeps it all in its URL). */
function readListState(search: string): { filters: ReturnFilters; query: string; page: number; pageSize: number; sort: Sort } {
  const params = new URLSearchParams(search)
  const filters = readReturnFilters(params)
  const ordering = params.get("ordering") ?? ""
  const sortKey = (Object.keys(SORT_PARAM) as SortKey[]).find((key) => ordering.replace(/^-/, "") === SORT_PARAM[key])
  const size = Number(params.get("pageSize"))
  return {
    filters,
    query: params.get("search")?.slice(0, 200) ?? "",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: PAGE_SIZES.includes(size) ? size : 25,
    sort: sortKey ? { key: sortKey, desc: ordering.startsWith("-") } : null,
  }
}

/** The return's own day with its time when it has one ("17 июля 2026, 08:24"), like the reference's list; the time is
 * the stored local (Tashkent) time, not converted. */
function displayDayTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value ?? "")
  if (!match) return value
  const day = `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`
  return match[4] ? `${day}, ${match[4]}:${match[5]}` : day
}

/** A UTC moment ("2026-01-29T08:09:14.000Z", or the app's "2026-01-29 08:09:14" without a zone) as a Date. */
function utcDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function momentText(date: Date | null) {
  if (!date) return ""
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function displayMoment(value: string | null | undefined) {
  return momentText(utcDate(value)) || (value ?? "")
}

/** When the return was made: a return copied from Linko keeps Linko's own creation time (local) in its return date;
 * one made here has a bare return day and its creation moment in created_at (UTC). */
function createdMoment(row: ClientReturnRow): Date | null {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(row.returnDate)) {
    const date = new Date(row.returnDate.replace(" ", "T").slice(0, 19))
    return Number.isNaN(date.getTime()) ? null : date
  }
  return utcDate(row.createdAt)
}

function money(value: number) {
  // The reference's numberFormat: the decimals of Настройки → Округление сумм (its ROUND_AMOUNT_FOR_CURRENCY), in the
  // band and the rows alike.
  return formatMoney(value)
}

/** A line the warehouse no longer holds (409 of «Отменить запрос» / cancel of an accepted return). */
type Shortage = { product: string; unit: string; required: number; available: number }

async function call<T>(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: true; body: T } | { ok: false; error: string; shortages?: Shortage[] }> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json().catch(() => null)) as (T & { error?: string; shortages?: Shortage[] }) | null
    if (!response.ok || body === null) return { ok: false, error: body?.error ?? "Не удалось сохранить изменения на сервере", shortages: body?.shortages }
    return { ok: true, body }
  } catch {
    return { ok: false, error: "Не удалось сохранить изменения на сервере" }
  }
}

/** Error text of a failed call: a stock shortage is composed from translated parts
 * (product names stay as they are), anything else is translated as a whole. */
function errorText(result: { error: string; shortages?: Shortage[] }, warehouse: string, t: (text: string) => string): string {
  if (!result.shortages?.length) return t(result.error)
  const parts = result.shortages
    .slice(0, 5)
    .map((line) => `${line.product} — ${t("доступно")} ${money(line.available)} ${line.unit}, ${t("требуется")} ${money(line.required)} ${line.unit}`.trim())
  return `${t("Не возможно отменить.")} ${t("Недостаточно товара на складе")} «${warehouse}»: ${parts.join("; ")}${result.shortages.length > 5 ? "; …" : ""}`
}

const ICON = {
  checkCircle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  removeCircle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z",
  eyeOff: RI.eyeOff,
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  boxEmpty: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  boxChecked: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  minusBox: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z",
  creditCard: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  localAtm: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z",
  truck: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
}

/** Header cell that sorts the whole filtered list (Linko orders on the server: ordering=-id …). */
function SortHead({ label, active, desc, onClick, right }: { label: string; active: boolean; desc: boolean; onClick: () => void; right?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center font-semibold hover:opacity-80 ${right ? "justify-end text-right" : "text-left"}`}>
      {label}
      {active ? <span className="ml-1 text-[10px]">{desc ? "▼" : "▲"}</span> : null}
    </button>
  )
}

export function ReturnsView({ initialId }: { initialId?: number } = {}) {
  const { t } = useLanguage()
  const warehouses = useDirectoryNames("warehouses")
  // The directories the filter matches its ids through (Linko's filter keys hold ids).
  const directories = useReturnFilterDirectories()
  const [rows, setRows] = useState<ClientReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  // The list state is read from the address once mounted (the server render has no address query).
  const [restored, setRestored] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(initialId ?? null)
  const [addOpen, setAddOpen] = useState(false)
  const [initialOrderId, setInitialOrderId] = useState<number | undefined>()
  // The order card's «Частичный возврат» (Linko's ?o=&s=&d=): the order's warehouse and delivery man by id.
  const [initialStock, setInitialStock] = useState<{ warehouseId?: number; delivererId?: number }>({})
  const [filterOpen, setFilterOpen] = useState(false)
  // Linko keeps the panel in the address: openFilterDialog=true while open, =false (with page=1) once it was closed.
  const [filterTouched, setFilterTouched] = useState(false)
  const [draftFilters, setDraftFilters] = useState<ReturnFilters>(EMPTY_RETURN_FILTERS)
  const [filters, setFilters] = useState<ReturnFilters>(EMPTY_RETURN_FILTERS)
  const [sort, setSort] = useState<Sort>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
  // A card's «Авто распределение по сериям» ticks its return (Linko's select=<id>, no checkbox column).
  useReturnSeriesSelection(setChecked)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const tab = tabOf(filters.status)

  const load = useCallback(async () => {
    setLoading(true)
    // Every return once: the tabs, filters, search, sorting and totals work on it (Linko asks its server per change).
    const result = await call<{ rows: ClientReturnRow[] }>("/api/client-returns?tab=all")
    if (result.ok) setRows(result.body.rows)
    else setNotice({ tone: "error", text: t(result.error) })
    setLoading(false)
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links: ?o=<order>&openCreateDialog=true (from an order card), ?r=<return>, /analytics/returns/<id>, and the
  // list state (status, search, filters, page, ordering).
  useEffect(() => {
    const state = readListState(window.location.search)
    setFilters(state.filters)
    setDraftFilters(state.filters)
    setQuery(state.query)
    setPage(state.page)
    setPageSize(state.pageSize)
    setSort(state.sort)
    setRestored(true)
    const params = new URLSearchParams(window.location.search)
    const order = Number(params.get("o"))
    if (params.get("openCreateDialog") === "true") {
      setInitialOrderId(Number.isInteger(order) && order > 0 ? order : undefined)
      const id = (name: string) => {
        const value = Number(params.get(name))
        return Number.isSafeInteger(value) && value > 0 ? value : undefined
      }
      setInitialStock({ warehouseId: id("s"), delivererId: id("d") })
      setAddOpen(true)
    }
    const ret = Number(params.get("r"))
    if (Number.isInteger(ret) && ret > 0) setSelectedId(ret)
    // Linko's ticked rows: ?showCheckboxes=true&select=205-207.
    const ticked = [...new Set((params.get("select") ?? "").split("-").map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))].slice(0, 500)
    // select= alone ticks the rows without the checkbox column, as Linko.
    if (params.get("showCheckboxes") === "true") setSelectMode(true)
    if (ticked.length) setChecked(ticked)
    if (params.get("openFilterDialog") === "true") setFilterOpen(true)
    if (params.get("openFilterDialog")) setFilterTouched(true)
  }, [])

  // The open card follows the address on browser Back / Forward over the pushed card URLs.
  useEffect(() => {
    const onPop = () => {
      const match = /^\/analytics\/returns\/(\d+)$/.exec(window.location.pathname)
      setSelectedId(match ? Number(match[1]) : null)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  // The list state in the address, like Linko's #/return?status=2&search=…&page=2&ordering=-id.
  useEffect(() => {
    if (!restored) return
    const params = new URLSearchParams()
    // Linko's filter keys, ids joined by "-" (status=0-1&stock=13-1&deliveryMan=188&exclude=true …).
    writeReturnFilters(params, filters)
    if (query) params.set("search", query)
    if (page > 1 || (filterTouched && !filterOpen)) params.set("page", String(page))
    params.set("pageSize", String(pageSize))
    if (sort) params.set("ordering", `${sort.desc ? "-" : ""}${SORT_PARAM[sort.key]}`)
    if (addOpen) params.set("openCreateDialog", "true")
    if (filterOpen || filterTouched) params.set("openFilterDialog", String(filterOpen))
    if (selectMode) params.set("showCheckboxes", "true")
    if (checked.length) params.set("select", checked.join("-"))
    const current = new URLSearchParams(window.location.search)
    // The open card's tab, edit dialog and shop card (?openShopDetail=<shop id>, Linko's drawer tabs) stay, and so do the
    // list's checkbox dialogs.
    for (const key of ["tab", "openUpdateDialog", "openShopDetail", "drawer", "shopDrawerTab", "marketTab", "openCreateNotification", "activityFromDate", "activityToDate", "type", "dPage", "openAgentPL", "openConfirmDialog", "cancelDialog", "openMultiUpdateDialog", "openDelivery", "openExpirationDatesEdit", "openExpirationDateDialog"]) {
      // «type» is also the filter's «Тип возврата» (Linko uses the key for both): the shop card's logs keep theirs only
      // while the card is open and the filter has none.
      if (key === "type" && (filters.type || !Number(current.get("openShopDetail")))) continue
      if (current.get(key)) params.set(key, current.get(key)!)
    }
    // Linko keeps the order card's client / shop / order / warehouse / delivery man in the address while the dialog is open.
    if (addOpen) for (const key of ["c", "d", "m", "o", "s"]) if (current.get(key)) params.set(key, current.get(key)!)
    // Linko keeps the keys sorted (?openExpirationDateDialog=true&pageSize=25&select=205-207&showCheckboxes=true).
    params.sort()
    const next = `${window.location.pathname}?${params}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next)
  }, [restored, filters, query, page, pageSize, sort, addOpen, selectMode, checked, filterOpen, filterTouched])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    const shown = filterReturns(rows, filters, directories)
      // Linko's search: the return number (as a part of it: «22» finds 221, 220 and 22), the client account's name and
      // the comment.
      .filter((row) => !term || String(row.id).includes(term) || (row.account || row.client).toLowerCase().includes(term) || row.comment.toLowerCase().includes(term))
    if (!sort) return shown
    const value = (row: ClientReturnRow) => (sort.key === "id" ? row.id : sort.key === "amount" ? row.amount : createdMoment(row)?.getTime() ?? 0)
    return [...shown].sort((a, b) => (sort.desc ? -1 : 1) * (value(a) - value(b)) || b.id - a.id)
  }, [rows, query, filters, sort, directories])
  // A filter by a directory's id waits for the directories (else the list would flash «ничего не найдено»).
  const listLoading = loading || (directories === null && returnFiltersNeedDirectories(filters))
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const pageRows = visible.slice(start, start + pageSize)
  const selectedOnPage = selectedId !== null && pageRows.some((row) => row.id === selectedId)
  // The band sums the returns the list shows (Linko's order_return/total takes the list's own filters: cancelled ones
  // only with «Показать отмененные возвраты»), one sum per currency in the band's currency order.
  // With ticked rows it sums the ticked returns the list shows (a ticked return the filter hides is not counted), one
  // sum per currency in the order the currencies first appear in the list, as the reference.
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>()
    const summed = checked.length ? visible.filter((row) => checked.includes(row.id)) : visible
    for (const row of summed) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount)
    const list = [...byCurrency].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
    return checked.length ? list : list.sort((a, b) => compareBandCurrencies(a.currency, b.currency))
  }, [visible, checked])

  // A new snackbar restarts the 4 s timer (two saves in a row keep the second one up its full time).
  const [flashes, setFlashes] = useState(0)
  useEffect(() => {
    if (!flashes) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [flashes])
  function flash(tone: "ok" | "error", text: string) {
    setNotice({ tone, text })
    setFlashes((count) => count + 1)
  }

  /** Opens (or closes) a return's card in place of its row; the address names it like Linko's #/return/221. */
  function open(id: number | null) {
    setSelectedId(id)
    const params = new URLSearchParams(window.location.search)
    params.delete("r")
    params.delete("tab")
    params.delete("openUpdateDialog")
    // Linko keeps the open shop card (and its tab) when another return is opened; closing the card drops it.
    for (const key of ["openExpirationDatesEdit", "openExpirationDateDialog", ...(id ? [] : ["openShopDetail", "drawer", "shopDrawerTab", "marketTab", "openCreateNotification", "activityFromDate", "activityToDate"])]) params.delete(key)
    const suffix = params.toString() ? `?${params}` : ""
    window.history.pushState(window.history.state, "", id ? `/analytics/returns/${id}${suffix}` : `/analytics/returns${suffix}`)
  }

  function applyFilters(next: ReturnFilters) {
    setFilters(next)
    setDraftFilters(next)
    setPage(1)
    setChecked([])
    if (selectedId !== null) open(null)
  }

  function toggleSort(key: SortKey) {
    setSort((current) => (current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false }))
  }

  /** The list's «Принять на склад» (its «ВЫПОЛНИТЬ» dialog): the ticked pending returns on `date` (empty = now). */
  async function acceptIds(ids: number[], date?: string): Promise<boolean> {
    const pending = ids.filter((id) => rows.find((row) => row.id === id)?.status === "pending")
    if (!pending.length) {
      setSelectMode(true)
      flash("error", t("Выберите хотя бы один возврат !"))
      return false
    }
    const result = await call<ClientReturnRow[]>("/api/client-returns/accept", { method: "POST", body: { ids: pending, ...(date ? { date } : {}) } })
    if (!result.ok) {
      flash("error", t(result.error))
      return false
    }
    setChecked([])
    flash("ok", `${t("Принято на склад")}: ${result.body.length}`)
    await load()
    return true
  }

  /** Linko's Excel with the table's columns (returns-list-excel.ts): the rows of the current page («Возвраты.xlsx») or
   * the ticked returns («Продажа товаров» → «Выбранные возвраты Excel.xlsx»); the file names stay Linko's in every
   * language. An empty field reads «Не указано» and a zero sum "0", as there. */
  function exportRows(list: ClientReturnRow[] = pageRows, name = RETURNS_EXCEL_NAME) {
    const none = t("Не указано")
    downloadListExcel(
      name,
      [t("№"), t("Клиент"), t("Склад"), t("Доставщик"), t("Дата возврата"), t("Создал"), t("Ответственный агент"), t("Комментарий"), t("Сумма возврата")],
      list.map((row) => [row.id, row.client || none, row.warehouse || none, row.deliverer || none, t(displayDayTime(row.returnDate)), row.createdBy || none, row.agent || none, row.comment || none, row.amount || "0"]),
    )
  }

  const allOnPageChecked = pageRows.length > 0 && pageRows.every((row) => checked.includes(row.id))
  const detail = (id: number) => (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]">
      <Detail
        id={id}
        warehouses={warehouses}
        close={() => open(null)}
        onChanged={(message) => {
          if (message) flash("ok", message)
          void load()
        }}
        onError={(message) => flash("error", message)}
      />
    </div>
  )

  return (
    <RefPage>
      <RefHeader title={t("Возвраты")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => (setInitialOrderId(undefined), setInitialStock({}), setAddOpen(true))} exact />
      </RefHeader>
      <RefCard>
        <div className="bg-white pb-[2px]">
          <RefTabs labels={[...TABS]} value={tab} onChange={(value) => applyFilters({ ...filters, status: TAB_STATUS[value as Tab] })} />
        </div>
        <div className={`flex flex-wrap justify-between gap-x-6 border-b border-[#efefef] px-[5px] py-[3px] text-[13px] font-semibold text-white ${checked.length ? "bg-[#09890f]" : "bg-[#1E4A9A]"}`}>
          {/* One sum per currency (never a fixed currency list, never a mixed sum), in the reference's markup: the label
              and every list sum («…SUM ,») are flex items 5 px apart (their edge spaces dropped), the ticked returns'
              sums («…USD ») sit in one such item; nothing to sum prints nothing. */}
          <span className="flex items-center [&>span]:mr-[5px]">
            <span>{t("Возвраты")}: </span>{" "}
            {checked.length ? (
              <span>
                {totals.map((entry) => (
                  <span key={entry.currency}>{`${money(entry.amount)} ${entry.currency} `}</span>
                ))}
              </span>
            ) : (
              totals.map((entry, index) => <span key={entry.currency}>{`${money(entry.amount)} ${entry.currency}${index < totals.length - 1 ? " ," : " "}`}</span>)
            )}
          </span>
        </div>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => (setDraftFilters(filters), setFilterTouched(true), setFilterOpen((value) => !value))}
          filterWidth={380}
          leftSlot={
            checked.length ? (
              <div className="text-[13px] font-semibold text-[#333]">
                {t("Выбрано:")} {checked.length}
              </div>
            ) : returnFilterCount(filters) > 0 ? (
              <RefAppliedFilter count={returnFilterCount(filters)} onEdit={() => (setDraftFilters(filters), setFilterTouched(true), setFilterOpen(true))} onClear={() => applyFilters(EMPTY_RETURN_FILTERS)} />
            ) : undefined
          }
          hideSearch={checked.length > 0}
          filterPanel={
            // Linko's «Применить» has 15 px above it.
            <RefFilterPanel applyClassName="mt-[14.8px]" onClose={() => setFilterOpen(false)} onApply={() => (applyFilters(draftFilters), setFilterOpen(false))}>
              {/* Linko's fields in Linko's order, four per row (returns-filter.tsx). */}
              <ReturnsFilterFields draft={draftFilters} onChange={setDraftFilters} directories={directories} />
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPage(1)
          }}
          pageSizeMenu
          pageSize={pageSize}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          from={visible.length ? start + 1 : 0}
          to={Math.min(start + pageSize, visible.length)}
          total={visible.length}
          page={safePage}
          pageCount={pageCount}
          onPage={setPage}
          icons={
            <span className="-mr-[9px] flex">
              {checked.length ? null : (
                <RefIconButton path={selectMode ? ICON.eyeOff : RI.checklist} label={selectMode ? t("Спрятать флажки") : t("Выбрать из списка")} color="#5d6474" onClick={() => (setSelectMode((value) => !value), setChecked([]))} />
              )}
              {checked.length ? null : <RefIconButton path={RI.download} label={t("Скачать Excel")} color="#333" onClick={() => exportRows()} />}
              <ReturnSeriesListAction ids={checked} onDone={(message) => flash("ok", message)} />
              {checked.length ? <ReturnsPrintSelected ids={checked} /> : null}
              {/* Linko's checkbox actions: «Скачать» (1C), «Изменить выбранные возвраты», «Продажа товаров». */}
              {checked.length ? <ReturnsDownloadMenu ids={checked} /> : null}
              {/* Mounted without ticked rows too: ?openMultiUpdateDialog=true opens its dialog. */}
              <ReturnsMultiUpdate ids={checked} withButton={checked.length > 0} onDone={(message) => (flash("ok", message), void load())} />
              {checked.length ? <ReturnsSalesMenu ids={checked} onExcel={() => exportRows(checked.flatMap((id) => rows.filter((row) => row.id === id)), SELECTED_RETURNS_EXCEL_NAME)} /> : null}
            </span>
          }
          extra={
            // Linko's «Снять выделение» sits right against the green button.
            <span className="flex items-center">
              {/* The checked returns only, after Linko's «ВЫПОЛНИТЬ» (nothing checked: «Выберите хотя бы один возврат !»);
                  the open card accepts its own return with its own button. */}
              <ReturnsAcceptSelected ids={checked} onAccept={(date) => acceptIds(checked, date)} />
              {checked.length ? <RefIconButton path={ICON.minusBox} label={t("Снять выделение")} color="#666" onClick={() => setChecked([])} /> : null}
            </span>
          }
        />
        {selectedId !== null && !selectedOnPage && !listLoading && detail(selectedId)}
        <RefTable
          // The selection mode adds Linko's 20 px checkbox column in front (its 24 px icons start 10 px before the row).
          cols={selectMode ? `20px ${LIST_COLS}` : LIST_COLS}
          heads={[
            ...(selectMode
              ? [
                  <button key="all" type="button" aria-label={t("Выбрать все")} className="-ml-[18px] flex" onClick={() => setChecked((current) => (allOnPageChecked ? current.filter((id) => !pageRows.some((row) => row.id === id)) : [...new Set([...current, ...pageRows.map((row) => row.id)])]))}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
                      <path d={ICON.selectAll} />
                    </svg>
                  </button>,
                ]
              : []),
            <SortHead key="id" label={t("№")} active={sort?.key === "id"} desc={Boolean(sort?.desc)} onClick={() => toggleSort("id")} />,
            <span key="client">{t("Клиент")}</span>,
            <span key="warehouse">{t("Склад")}</span>,
            <span key="deliverer">{t("Доставщик")}</span>,
            <SortHead key="date" label={t("Дата возврата")} active={sort?.key === "date"} desc={Boolean(sort?.desc)} onClick={() => toggleSort("date")} />,
            <span key="creator">{t("Создал")}</span>,
            <span key="agent">{t("Ответственный агент")}</span>,
            <span key="comment">{t("Комментарий")}</span>,
            <SortHead key="sum" right label={t("Сумма возврата")} active={sort?.key === "amount"} desc={Boolean(sort?.desc)} onClick={() => toggleSort("amount")} />,
          ]}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => open(row.id === selectedId ? null : row.id)}
          // A ticked row is shaded like the reference's.
          rowClass={(row) => (row.id === selectedId ? "hidden" : checked.includes(row.id) ? "!bg-[#f2f5f8]" : "")}
          expanded={(row) => (row.id === selectedId ? detail(row.id) : null)}
          empty={listLoading ? "" : t("Ничего не найдено")}
          render={(row) => [
            ...(selectMode
              ? [
                  <button
                    key="check"
                    type="button"
                    aria-label={t("Выбрать")}
                    className="relative -top-px -ml-[18px] flex"
                    onClick={(event) => {
                      event.stopPropagation()
                      setChecked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))
                    }}
                  >
                    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${checked.includes(row.id) ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                      <path d={checked.includes(row.id) ? ICON.boxChecked : ICON.boxEmpty} />
                    </svg>
                  </button>,
                ]
              : []),
            row.id,
            <>
              {row.client}
              <br />
              {/* Like the reference (SHOW_BORDER_IN_ORDER_LIST): the client's zone under its name. */}
              <span className="text-[#1E4A9A]">{row.zone}</span>
            </>,
            <>
              {row.warehouse || t("Не указан")}
              <br />
              {/* Like the reference: the organization under the warehouse (the order is on the return's card). */}
              <span className="text-[#1E4A9A]">{row.organization}</span>
            </>,
            row.deliverer || "N/A",
            <>
              {t(displayDayTime(row.returnDate))}
              <br />
              <span className="text-[#1E4A9A]">{t(displayMoment(row.acceptedAt))}</span>
            </>,
            row.createdBy || "—",
            row.agent || t("Не указано"),
            row.comment || "-",
            <span key="sum" className="flex items-center justify-between">
              {/* Linko: the amount takes 70% of the cell, the payment icon sits at its right end. */}
              <span className="block w-[70%] text-right">
                {money(row.amount)} {row.currency}
                <br />
                <span className={STATUS_COLOR[row.status]}>{t(STATUS_LABEL[row.status])}</span>
              </span>
              {/* Linko's payment icon is its own control: a click on it does not open the card. */}
              <span role="presentation" onClick={(event) => event.stopPropagation()} className="flex h-5 w-5 shrink-0 cursor-default items-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#1E4A9A]" aria-hidden>
                  <path d={(row.returnPaymentType ?? row.paymentType) === "bank" ? ICON.creditCard : ICON.localAtm} />
                </svg>
              </span>
            </span>,
          ]}
        />
      </RefCard>
      {notice && <div className={`fixed bottom-6 left-1/2 z-[1500] -translate-x-1/2 rounded-[2px] px-6 py-3 text-[14px] text-white shadow-lg ${notice.tone === "error" ? "bg-[#c62828]" : "bg-[#323232]"}`}>{notice.text}</div>}
      {addOpen && (
        <AddReturnDialog
          initialOrderId={initialOrderId}
          initialWarehouseId={initialStock.warehouseId}
          initialDelivererId={initialStock.delivererId}
          onClose={() => setAddOpen(false)}
          onSaved={(created) => {
            setAddOpen(false)
            flash("ok", t("Успешно сохранено"))
            setFilters({ ...EMPTY_RETURN_FILTERS, status: TAB_STATUS[created.status === "accepted" ? "Принятые" : "Надо принять"] })
            setPage(1)
            setSort(null)
            open(created.id)
            void load()
          }}
        />
      )}
      {/* ?openShopDetail=<shop id> without a card: the shop card over the list (an open card shows its own). */}
      {selectedId === null && <ReturnsListShopDrawer />}
    </RefPage>
  )
}

/** The return card over another page (Активность → Возврат card): the same Detail as
 * Продажи → Возвраты, with its own notices. Escape or the backdrop closes it. */
export function ClientReturnDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useLanguage()
  const warehouses = useDirectoryNames("warehouses")
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const onChanged = useCallback((message?: string) => setNotice(message ? { tone: "ok", text: message } : null), [])
  const onError = useCallback((message: string) => setNotice({ tone: "error", text: message }), [])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("Возврат №")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mx-auto my-6 w-full max-w-[1200px]">
        {notice && (
          <div className={`flex items-center justify-between rounded px-4 py-3 text-sm ${notice.tone === "ok" ? "bg-[#e9f8ed] text-[#278549]" : "bg-[#fdecea] text-[#c62828]"}`}>
            {notice.text}
            <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть уведомление")}>
              <X size={18} />
            </button>
          </div>
        )}
        <Detail id={id} warehouses={warehouses} close={onClose} onChanged={onChanged} onError={onError} overDialog />
      </div>
    </div>
  )
}

type CardTab = "items" | "series" | "logs" | "photos"
// The card tabs in the address, as Linko names them (#/return/221?tab=logs).
const CARD_TAB_PARAM: Record<CardTab, string> = { items: "productList", series: "expireDates", logs: "logs", photos: "photoReports" }

function Detail({
  id,
  close,
  onChanged,
  onError,
  overDialog = false,
}: {
  id: number
  warehouses: string[]
  close: () => void
  onChanged: (message?: string) => void
  onError: (message: string) => void
  /** The card is shown in a dialog over another page (ClientReturnDialog): its shop card goes over that dialog. */
  overDialog?: boolean
}) {
  const { t } = useLanguage()
  // The lines opened in «Список товаров» stay open while this card is shown (a tab switch keeps them).
  useReturnItemMarksScope(id)
  const [row, setRow] = useState<ClientReturnRow | null>(null)
  const [editOpen, setEditOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("openUpdateDialog") === "true")
  const [busy, setBusy] = useState(false)
  // Linko's client link opens the shop card over the return (?openShopDetail=<shop id>).
  const [shopId, setShopIdState] = useState<number | null>(shopInAddress)
  const [tab, setTabState] = useState<CardTab>(() => {
    const param = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("tab")
    return (Object.keys(CARD_TAB_PARAM) as CardTab[]).find((key) => CARD_TAB_PARAM[key] === param) ?? "items"
  })

  const setParam = (name: string, value: string | null) => {
    if (!window.location.pathname.startsWith("/analytics/returns")) return
    const params = new URLSearchParams(window.location.search)
    if (value) params.set(name, value)
    else params.delete(name)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`)
  }
  const setTab = (next: CardTab) => {
    setTabState(next)
    setParam("tab", next === "items" ? null : CARD_TAB_PARAM[next])
  }
  const setEdit = (open: boolean) => {
    setEditOpen(open)
    // Like Linko: closing leaves openUpdateDialog=false in the address.
    setParam("openUpdateDialog", open ? "true" : "false")
  }
  const setShop = (id: number | null) => {
    setShopIdState(id)
    writeShopToAddress(id)
  }
  const closeShop = useCallback(() => {
    setShopIdState(null)
    writeShopToAddress(null)
  }, [])

  const load = useCallback(async () => {
    const result = await call<ClientReturnRow>(`/api/client-returns/${id}`)
    if (result.ok) setRow(result.body)
    else onError(t(result.error))
  }, [id, onError, t])

  useEffect(() => {
    void load()
  }, [load])

  if (!row) return null

  async function act(path: "accept" | "cancel" | "unaccept", message: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    const result = await call<ClientReturnRow>(`/api/client-returns/${id}/${path}`, { method: "POST", body })
    setBusy(false)
    if (!result.ok) {
      onError(errorText(result, row?.warehouse ?? "", t))
      return false
    }
    setRow({ ...result.body })
    onChanged(message)
    return true
  }

  return (
    // Linko's card in the list is at most 615 px tall and scrolls inside (its wrapper: maxHeight 615px, overflow auto).
    <section className={`bg-white font-sans text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] ${overDialog ? "" : "max-h-[615px] overflow-auto"}`}>
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        {/* Like Linko: the whole title bar closes the card (a layer over the title, under the buttons). */}
        <button type="button" onClick={close} aria-label={t("Закрыть")} className="absolute inset-0 z-[1] cursor-pointer" />
        <span className="text-left text-[18px] font-semibold leading-none">
          <ReturnCardTitle row={row} />
        </span>
        <div className="relative z-[3] flex items-center gap-[10px]">
          {/* The series deep links open on every tab; the two buttons show on «Серии» only. */}
          <ReturnSeriesButtons returnId={row.id} warehouse={row.warehouse} onChanged={onChanged} buttons={tab === "series"} />
          {/* Every status (Linko): an accepted, cancelled or «со старой базы» return only for an administrator. */}
          <ReturnEditButton row={row} disabled={busy} onOpen={() => setEdit(true)} />
          <ReturnStatusActions returnId={row.id} status={row.status} busy={busy} act={act} />
          <span className="flex">
            <ReturnPrintButton id={row.id} disabled={row.status === "cancelled"} />
            <ReturnTrashButton returnId={row.id} status={row.status} busy={busy} act={act} />
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[347px_minmax(0,1fr)]">
        <ReturnCardAside row={row} onOpenShop={setShop} />
        <div className="min-w-0 px-[30px] pb-[30px]">
          <div className="flex h-[49px] items-end border-b border-[#efefef]">
            {([["items", "Список товаров"], ["series", "Серии"], ["logs", "Логи"], ["photos", "Фотоотчеты"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`h-[41px] min-w-[112px] border-b-[2px] px-[6px] text-center text-[13px] font-medium ${tab === key ? "border-[#1E4A9A]" : "border-transparent"}`}>
                {t(label)}
              </button>
            ))}
          </div>
          {tab === "items" && <ReturnItemsTab row={row} />}
          {tab === "series" && <ReturnSeriesTab returnId={row.id} refreshKey={row} />}
          {tab === "photos" ? (
            // Linko's empty block (as on «Серии»: 300 × 296, the robot 155 px wide 55 px from its top), 15 px lower.
            <div
              className="mx-auto mt-[15px] h-[296px] w-[300px] bg-no-repeat pb-[50px] pt-[230px] text-center text-[13px] leading-[16.25px] text-[#999]"
              style={{ backgroundImage: "url(/robot-empty.png)", backgroundSize: "155px auto", backgroundPosition: "50% 55px" }}
            >
              {t("По вашему запросу ничего не найдено")}
            </div>
          ) : null}
          {tab === "logs" && <ReturnLogsTab returnId={row.id} refreshKey={JSON.stringify(row)} />}
        </div>
      </div>

      {shopId !== null && <ReturnShopDrawer shopId={shopId} onClose={closeShop} overDialog={overDialog} />}

      {editOpen && (
        <ReturnEditGate row={row}>
          <AddReturnDialog
            edit={row}
            onClose={() => setEdit(false)}
            onSaved={(saved) => {
              setRow(saved)
              setEdit(false)
              onChanged(t("Успешно сохранено"))
            }}
          />
        </ReturnEditGate>
      )}
    </section>
  )
}
