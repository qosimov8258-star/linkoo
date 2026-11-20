"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { toggleOrdering } from "@/components/analytics/list-url-state"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { TransferDetailPanel } from "@/components/analytics/internal-transfers-detail"
import { EMPTY_TRANSFER_FILTERS, TransferFilterPanel, transferFilterCount, type TransferFilters } from "@/components/analytics/internal-transfers-filter"
import { TransferFormDialog } from "@/components/analytics/internal-transfers-form"
import { TransferAutoSeriesDialog } from "@/components/analytics/internal-transfers-series"
import { TransferInvoices } from "@/components/analytics/internal-transfers-print"
import { TransferStatusLabel, docDate, formatSum, formatWeight, transfersListSheet } from "@/components/analytics/internal-transfers-shared"
import { RI, RefAppliedFilter, RefButton, RefCard, RefEmpty, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Transfer, TransferListResult, TransferOptions } from "@/lib/internal-transfers-types"

// "Передачи между складами" (demo #/stock-transfers, chunk c7: page 4067,
// grid 4632). Toolbar: "Показать фильтр" (Со склада, На склад, Период
// создания / доставки / приемки, "Показать отмененные передачи"), search, page
// size + "1 - 25 из N", "Скачать" (Накладные по передачам, Выбранные передачи
// Excel, Скачать все); rows with checkboxes: № | Со склада | На склад | Создал |
// Дата создания | Дата доставки | Сумма (+ weight) | Статус. A row opens its
// detail in place; "Добавить" creates. Data: /api/internal-transfers/**.
// The dialogs live in the URL as in the reference: ?openCreateDialog=true (the create form), and on a card
// ?openUpdateDialog=true (the edit form) and ?autoSetDialog=true («Авто распределение по сериям»); closing one sets
// it to false (the reference keeps the parameter), and a link with it opens the dialog.

/** A card dialog flag of the URL: "" = absent, else the reference's "true" / "false". */
type DialogFlag = "" | "true" | "false"

type ViewState = {
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: TransferFilters
  detailId: number | null
  createDialog: DialogFlag
  updateDialog: DialogFlag
  autoSetDialog: DialogFlag
  /** Linko's ?openFilterDialog=true while the filter panel is open. */
  filterOpen: boolean
  /** Linko's ?showCheckboxes=true: the checkbox column of «Выбрать из списка». */
  selectMode: boolean
}

const flagOf = (value: string | null): DialogFlag => (value === "true" ? "true" : value === "false" ? "false" : "")

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      fromWarehouses: list("fromStock"),
      toWarehouses: list("toStock"),
      createdFrom: params.get("fromDate") ?? "",
      createdTo: params.get("toDate") ?? "",
      deliveryFrom: params.get("fromDateSecond") ?? "",
      deliveryTo: params.get("toDateSecond") ?? "",
      acceptedFrom: params.get("fromDateThird") ?? "",
      acceptedTo: params.get("toDateThird") ?? "",
      withCancelled: ["1", "true"].includes(params.get("withCancelled") ?? ""),
    },
    detailId: positiveInt(params.get("id")),
    createDialog: flagOf(params.get("openCreateDialog")),
    updateDialog: flagOf(params.get("openUpdateDialog")),
    autoSetDialog: flagOf(params.get("autoSetDialog")),
    filterOpen: params.get("openFilterDialog") === "true",
    selectMode: params.get("showCheckboxes") === "true",
  }
}

function stateToSearch(state: ViewState, selected: Set<number>): string {
  const f = state.filters
  // Linko keeps the keys of its address sorted.
  const params = new URLSearchParams(buildCashQuery({
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    fromStock: f.fromWarehouses,
    toStock: f.toWarehouses,
    fromDate: f.createdFrom,
    toDate: f.createdTo,
    fromDateSecond: f.deliveryFrom,
    toDateSecond: f.deliveryTo,
    fromDateThird: f.acceptedFrom,
    toDateThird: f.acceptedTo,
    // Linko writes its flags as "true".
    withCancelled: f.withCancelled ? "true" : "",
    id: state.detailId ?? "",
    openCreateDialog: state.createDialog,
    // The card's dialogs belong to the open card.
    openUpdateDialog: state.detailId ? state.updateDialog : "",
    autoSetDialog: state.detailId ? state.autoSetDialog : "",
    openFilterDialog: state.filterOpen ? "true" : "",
    showCheckboxes: state.selectMode ? "true" : "",
    // Linko's ticked rows: ?select=59-58.
    select: [...selected].join("-"),
  }))
  params.sort()
  return params.toString()
}

/** Query of GET /api/internal-transfers (pageSize 0 = every row). */
function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  const f = state.filters
  return {
    search: state.search,
    ordering: state.ordering,
    page: pageSize ? state.page : 1,
    pageSize: String(pageSize),
    fromWarehouse: f.fromWarehouses,
    toWarehouse: f.toWarehouses,
    createdFrom: f.createdFrom,
    createdTo: f.createdTo,
    deliveryFrom: f.deliveryFrom,
    deliveryTo: f.deliveryTo,
    acceptedFrom: f.acceptedFrom,
    acceptedTo: f.acceptedTo,
    withCancelled: f.withCancelled,
  }
}

const ARROW_DOWN = "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z"
const ARROW_UP = "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z"
const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const BOX_CHECKED = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** Linko's sortable title: the text (it wraps in a narrow column: «Дата / создания»), then a 30 px slot — a 6 px gap and
 * the 24 px arrow, ↓ ascending, ↑ descending — that stays empty while the column is not sorted. */
function SortTitle({ label, ordering, field, onSort }: { label: ReactNode; ordering: string[]; field: string; onSort: (field: string) => void }) {
  const dir = ordering.includes(field) ? "asc" : ordering.includes(`-${field}`) ? "desc" : null
  return (
    <button type="button" onClick={() => onSort(field)} className="flex max-w-full items-center text-left font-semibold leading-[18px]">
      <span className="min-w-0">{label}</span>
      <span className="ml-[6px] flex h-[15px] w-6 shrink-0">
        {dir && (
          <svg viewBox="0 0 24 24" className="h-[15px] w-6 fill-white" aria-hidden>
            <path d={dir === "asc" ? ARROW_DOWN : ARROW_UP} />
          </svg>
        )}
      </span>
    </button>
  )
}

export function InternalTransfersView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [selected, setSelected] = useState<Set<number>>(() => new Set((searchParams.get("select") ?? "").split("-").map(Number).filter((id) => Number.isInteger(id) && id > 0)))
  const [printing, setPrinting] = useState<Transfer[] | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const list = useCashJson<TransferListResult>(`/api/internal-transfers?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<TransferOptions>("/api/internal-transfers/options")
  // The create form follows ?openCreateDialog, the edit form ?openUpdateDialog.
  const createOpen = state.createDialog === "true"
  const editOpen = Boolean(state.detailId) && state.updateDialog === "true"
  // The edit form starts from the transfer as stored now (with its products' expiry and boxes).
  const editing = useCashJson<Transfer>(editOpen ? `/api/internal-transfers/${state.detailId}?form=${detailVersion}` : null)
  const data = list.data
  const rows = data?.results ?? []

  useEffect(() => {
    const search = stateToSearch(state, selected)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state, selected])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  useEffect(() => {
    if (!data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [data, list.loading, state.page, state.pageSize])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [menuOpen])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const filterOpen = state.filterOpen
  const setFilterOpen = (open: boolean) => update({ filterOpen: open })
  // Like the reference the checkbox column only appears after the "Выбрать из списка" icon is pressed.
  const selectMode = state.selectMode
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const closePrint = useCallback(() => setPrinting(null), [])

  // Linko's header click: a new column is added ascending at the end, a second click makes it descending, a third
  // drops it (?ordering=created_date,-total_price).
  const ordering = state.ordering.split(",").filter(Boolean)
  const sort = (key: string) => update({ ordering: toggleOrdering(ordering, key).join(","), page: 1 })
  const sortHeader = (key: string, label: ReactNode) => <SortTitle label={label} ordering={ordering} field={key} onSort={sort} />

  /** Selected transfers (any page), else the current page. */
  const chosen = async (): Promise<Transfer[]> => {
    if (!selected.size) return rows
    const onPage = rows.filter((row) => selected.has(row.id))
    if (onPage.length === selected.size) return onPage
    const response = await fetch(`/api/internal-transfers?${buildCashQuery({ page: 1, pageSize: "0", ids: [...selected].join(",") })}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as TransferListResult | null
    return body?.results ?? onPage
  }

  const download = async (kind: "invoices" | "selected" | "all") => {
    setMenuOpen(false)
    try {
      if (kind === "all") {
        const response = await fetch(`/api/internal-transfers?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
        const body = (await response.json().catch(() => null)) as (TransferListResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
        return downloadExcelTable(t("Передачи между складами"), transfersListSheet(body.results, t, language))
      }
      const transfers = await chosen()
      if (!transfers.length) return notify(t("Выберите передачи"), true)
      if (kind === "invoices") setPrinting(transfers)
      else downloadExcelTable(t("Выбранные передачи Excel"), transfersListSheet(transfers, t, language))
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id))

  const warehouseNames = (options.data?.warehouses ?? []).map((warehouse) => warehouse.name)
  const th = "px-2 py-0 text-left font-semibold"
  const td = "px-2 py-[7px] align-middle leading-[16.25px]"
  const menuItem = "block h-[48px] w-full whitespace-nowrap pl-[25px] pr-[24px] text-left text-[13px] leading-[48px] hover:bg-[#f2f5f8]"
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = (state.page - 1) * state.pageSize + 1
  const to = Math.min(state.page * state.pageSize, data?.count ?? 0)
  return (
    <RefPage>
      <RefHeader title={t("Передачи между складами")}>
        {canEdit && <span className="mr-[8px] flex"><RefButton green icon={RI.add} label={t("Добавить")} onClick={() => update({ createDialog: "true" })} /></span>}
      </RefHeader>

      <RefCard>
        <RefToolbar
          linkFilter="flush"
          // Linko: the search starts 430 px from the window edge and is 300 px wide.
          filterWidth={379.5}
          searchWidth={300}
          filterOpen={filterOpen}
          filterPanel={
            <TransferFilterPanel
              filters={state.filters}
              warehouses={warehouseNames}
              onClose={() => setFilterOpen(false)}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1, detailId: null })
              }}
            />
          }
          // Linko's small chevron after «Показать фильтр»; once applied, the grey «Фильтр: N элемента» bar.
          thinChevron
          onToggleFilter={() => setFilterOpen(!filterOpen)}
          // Ticked rows: Linko's «Выбрано: N» on the bare page instead of the filter and the search.
          plain={selected.size > 0}
          hideSearch={selected.size > 0}
          leftSlot={
            selected.size > 0 ? (
              <div className="text-[13px] font-semibold text-[#333]">
                {t("Выбрано:")} {selected.size}
              </div>
            ) : // Linko's afterFilter bar: 371.5 px from 1 px right of the card's edge, the text 30 px in.
            transferFilterCount(state.filters) > 0 && (
              <RefAppliedFilter
                count={transferFilterCount(state.filters)}
                width={371.5}
                shift={4}
                onEdit={() => setFilterOpen(true)}
                onClear={() => update({ filters: { ...EMPTY_TRANSFER_FILTERS }, page: 1, detailId: null, filterOpen: false })}
              />
            )
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(pageSize) => update({ pageSize, page: 1, detailId: null })}
          from={from}
          to={to}
          total={data?.count ?? 0}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page, detailId: null })}
          icons={
            <>
              {selected.size === 0 && <button
                type="button"
                onClick={() => {
                  update({ selectMode: !selectMode })
                  setSelected(new Set())
                }}
                title={t("Выбрать из списка")}
                aria-label={t("Выбрать из списка")}
                data-tip-side="left"
                className="flex h-12 w-12 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selectMode ? "fill-[#1E4A9A]" : "fill-[#5d6474]"}`}><path d={RI.checklist} /></svg>
              </button>}
              <div ref={menuRef} className="relative">
                <button type="button" onClick={() => setMenuOpen((open) => !open)} title={t("Скачать")} aria-label={t("Скачать")} data-tip-side="left" className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
                </button>
                {menuOpen && (
                  // Linko's menu: the bold title 20 px down, 48 px items 25 px in.
                  <div className="absolute right-0 top-full z-[40] min-w-[223px] bg-white pb-[8px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                    <p className="mt-[20px] whitespace-nowrap px-[9px] pb-[6px] text-[13px] font-semibold">{t("Накладные по передачам")}</p>
                    <button type="button" className={menuItem} onClick={() => void download("invoices")}>
                      {t("Накладные по передачам")} ({selected.size || rows.length})
                    </button>
                    <button type="button" className={menuItem} onClick={() => void download("selected")}>
                      {t("Выбранные передачи")} ({selected.size || rows.length})
                    </button>
                    <button type="button" className={menuItem} onClick={() => void download("all")}>
                      {t("Скачать все")}
                    </button>
                  </div>
                )}
              </div>
              {/* Linko's «Выбрано: N» bar ends with the minus box that clears the ticks. */}
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} title={t("Снять выделение")} aria-label={t("Снять выделение")} data-tip-side="left" className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={MINUS_BOX} /></svg>
                </button>
              )}
            </>
          }
        />

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`${state.detailId ? "" : "overflow-x-auto"} ${list.loading ? "opacity-60" : ""}`}>
          {/* Linko's grid: 30 px on each side and 12 equal units between them (№ 1, Со склада 2, На склад 2, Создал 2,
              Дата создания 1, Дата доставки 1, Сумма 2, Статус 1); «Выбрать из списка» puts a 20 px checkbox column after
              the left 30 px. Spacer columns plus colSpan keep the units equal at every width. */}
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col style={{ width: 30 }} />
              {selectMode && <col style={{ width: 20 }} />}
              {Array.from({ length: 12 }, (_, index) => <col key={index} />)}
              <col style={{ width: 30 }} />
            </colgroup>
            <thead className="bg-[#5d6474] text-[13px] font-semibold text-[#fff]">
              <tr className="h-[50px]">
                {selectMode && (
                  <th colSpan={2} className="relative p-0">
                    <button
                      type="button"
                      aria-label={t("Выбрать все")}
                      onClick={() =>
                        setSelected((current) => {
                          const next = new Set(current)
                          rows.forEach((row) => (allOnPage ? next.delete(row.id) : next.add(row.id)))
                          return next
                        })
                      }
                      className="absolute left-[20px] top-1/2 flex -translate-y-1/2"
                    >
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
                        <path d={SELECT_ALL} />
                      </svg>
                    </button>
                  </th>
                )}
                <th colSpan={selectMode ? 1 : 2} className={`${th} ${selectMode ? "pl-0" : "pl-[30px]"}`}>{sortHeader("id", "№")}</th>
                <th colSpan={2} className={th}>{t("Со склада")}</th>
                <th colSpan={2} className={th}>{t("На склад")}</th>
                <th colSpan={2} className={th}>{sortHeader("accepted_by", t("Создал"))}</th>
                <th className={th}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={th}>{sortHeader("date_delivery", t("Дата доставки"))}</th>
                <th colSpan={2} className={th}>{sortHeader("total_price", t("Сумма"))}</th>
                <th colSpan={2} className={th}>{sortHeader("status", t("Статус"))}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    {!open && (
                      <tr onClick={() => update({ detailId: open ? null : row.id, updateDialog: "", autoSetDialog: "" })} className={`h-[50px] cursor-pointer bg-[linear-gradient(to_right,#d5d5d5_2px,transparent_2px)] bg-[length:8px_2px] bg-[position:0_100%] bg-repeat-x ${selected.has(row.id) ? "bg-[#f2f5f8]" : "bg-white hover:bg-[#f2f5f8]"}`}>
                        {selectMode && (
                          <td colSpan={2} className="relative p-0" onClick={(event) => event.stopPropagation()}>
                            <button type="button" aria-label={`№ ${row.id}`} onClick={() => toggle(row.id)} className="absolute left-[20px] top-1/2 flex -translate-y-1/2">
                              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selected.has(row.id) ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                                <path d={selected.has(row.id) ? BOX_CHECKED : BOX_EMPTY} />
                              </svg>
                            </button>
                          </td>
                        )}
                        <td colSpan={selectMode ? 1 : 2} className={`${td} ${selectMode ? "" : "pl-[38px]"}`}>{row.id}</td>
                        <td colSpan={2} className={td}><span data-no-translate>{row.fromWarehouse}</span></td>
                        <td colSpan={2} className={td}><span data-no-translate>{row.toWarehouse}</span></td>
                        <td colSpan={2} className={td}>{row.createdBy || t("Не указано")}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.createdAt, language)}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.deliveredAt, language)}</td>
                        <td colSpan={2} className={`${td} whitespace-nowrap`}>
                          {formatSum(row.amount)}
                          <span className="block text-[#1E4A9A]">{formatWeight(row.weight, t("кг"))}</span>
                        </td>
                        <td colSpan={2} className={`${td} pr-[38px]`}>
                          <TransferStatusLabel status={row.status} wrap />
                        </td>
                      </tr>
                    )}
                    {open && (
                      <tr>
                        <td colSpan={selectMode ? 15 : 14} className="bg-[#f2f5f8] p-0">
                          <TransferDetailPanel
                            key={`${row.id}-${detailVersion}`}
                            id={row.id}
                            canEdit={canEdit}
                            onClose={() => update({ detailId: null, updateDialog: "", autoSetDialog: "" })}
                            onEdit={() => update({ updateDialog: "true" })}
                            onAutoSet={() => update({ autoSetDialog: "true" })}
                            onPrint={(transfer) => setPrinting([transfer])}
                            onChanged={list.reload}
                            notify={notify}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={selectMode ? 15 : 14} className="bg-white p-0">
                    {/* Linko: the robot on a white card when nothing is found */}
                    {list.loading || list.error ? (
                      <div className="px-4 py-16 text-center text-[#9aa3b6]">{list.loading ? t("Загрузка...") : ""}</div>
                    ) : (
                      <RefEmpty text="По вашему запросу ничего не найдено" />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </RefCard>

      {createOpen && (
        <TransferFormDialog
          transfer={null}
          options={options.data}
          onClose={() => update({ createDialog: "false" })}
          onSaved={(saved) => {
            notify(t("Успешно сохранено"))
            list.reload()
            options.reload()
            update({ createDialog: "false", detailId: saved.id, page: 1, updateDialog: "", autoSetDialog: "" })
          }}
        />
      )}
      {editOpen && editing.data && editing.data.id === state.detailId && (
        <TransferFormDialog
          key={`${editing.data.id}-${detailVersion}`}
          transfer={editing.data}
          options={options.data}
          onClose={() => update({ updateDialog: "false" })}
          onSaved={() => {
            update({ updateDialog: "false" })
            notify(t("Успешно изменено"))
            list.reload()
            options.reload()
            setDetailVersion((value) => value + 1)
          }}
        />
      )}
      {editOpen && editing.error && !editing.data && (
        <div className="fixed inset-x-0 top-[70px] z-[120] mx-auto w-fit bg-white px-4 py-2 text-[13px] text-[#e57373] shadow">{t(editing.error)}</div>
      )}
      {Boolean(state.detailId) && state.autoSetDialog === "true" && (
        <TransferAutoSeriesDialog
          id={state.detailId!}
          onClose={() => update({ autoSetDialog: "false" })}
          onSaved={() => {
            update({ autoSetDialog: "false" })
            notify(t("Успешно изменено"))
            list.reload()
            setDetailVersion((value) => value + 1)
          }}
        />
      )}
      {printing && <TransferInvoices transfers={printing} warehouses={options.data?.warehouses ?? []} onClose={closePrint} />}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}
