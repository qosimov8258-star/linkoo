"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Plus, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { TransferDetailPanel } from "@/components/analytics/internal-transfers-detail"
import { EMPTY_TRANSFER_FILTERS, TransferFilterBar, type TransferFilters } from "@/components/analytics/internal-transfers-filter"
import { TransferFormDialog } from "@/components/analytics/internal-transfers-form"
import { TransferInvoices } from "@/components/analytics/internal-transfers-print"
import { TransferStatusLabel, docDate, formatSum, formatWeight, transfersListSheet } from "@/components/analytics/internal-transfers-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type ViewState = { search: string; ordering: string; page: number; pageSize: number; filters: TransferFilters; detailId: number | null }

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
  }
}

function stateToSearch(state: ViewState): string {
  const f = state.filters
  return buildCashQuery({
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
    withCancelled: f.withCancelled,
    id: state.detailId ?? "",
  })
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

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

export function InternalTransfersView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  // undefined = closed, null = create, transfer = edit.
  const [form, setForm] = useState<Transfer | null | undefined>(undefined)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [printing, setPrinting] = useState<Transfer[] | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const list = useCashJson<TransferListResult>(`/api/internal-transfers?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<TransferOptions>("/api/internal-transfers/options")
  const data = list.data
  const rows = data?.results ?? []

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

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
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const closePrint = useCallback(() => setPrinting(null), [])

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )

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
  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"
  const menuItem = "block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8]"
  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Передачи между складами")}</h1>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setForm(null)} title={t("Добавить передачу")} className="inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-4 text-[14px] font-semibold text-white shadow-sm hover:brightness-95">
            <Plus className="h-[18px] w-[18px]" /> {t("Добавить")}
          </button>
        )}
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
          <TransferFilterBar
            filters={state.filters}
            open={filterOpen}
            onOpen={() => setFilterOpen(true)}
            onClose={() => setFilterOpen(false)}
            onClear={() => {
              setFilterOpen(false)
              update({ filters: { ...EMPTY_TRANSFER_FILTERS }, page: 1, detailId: null })
            }}
            onApply={(filters) => {
              setFilterOpen(false)
              update({ filters, page: 1, detailId: null })
            }}
            warehouses={warehouseNames}
          />
          <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("Поиск")} aria-label={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())} className="text-[13px] text-[#586174] hover:underline">
                {t("Выбрано")}: {selected.size} ✕
              </button>
            )}
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} sizes={PAGE_SIZES} onChange={({ page, pageSize }) => update({ page, pageSize, detailId: null })} />
            <button type="button" onClick={list.reload} title={t("Обновить список")} aria-label={t("Обновить список")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
              <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
            </button>
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((open) => !open)} title={t("Скачать")} aria-label={t("Скачать")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
                <Download className="h-5 w-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-[40] mt-1 min-w-[240px] rounded-md border border-[#e1e5eb] bg-white py-2 shadow-lg">
                  <p className="px-4 pb-1 text-[13px] font-semibold">{t("Накладные по передачам")}</p>
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
          </div>
        </div>

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[1080px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb]">
                <th className="w-10 pl-6">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    aria-label={t("Выбрать все")}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current)
                        rows.forEach((row) => (allOnPage ? next.delete(row.id) : next.add(row.id)))
                        return next
                      })
                    }
                    className="h-4 w-4 accent-[rgb(79,113,220)]"
                  />
                </th>
                <th className={`${th} w-[7%]`}>{sortHeader("id", "№")}</th>
                <th className={`${th} w-[15%]`}>{t("Со склада")}</th>
                <th className={`${th} w-[15%]`}>{t("На склад")}</th>
                <th className={`${th} w-[13%]`}>{sortHeader("created_by", t("Создал"))}</th>
                <th className={`${th} w-[11%]`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} w-[11%]`}>{sortHeader("date_delivery", t("Дата доставки"))}</th>
                <th className={`${th} w-[13%]`}>{sortHeader("total_price", t("Сумма"))}</th>
                <th className={`${th} pr-6`}>{sortHeader("status", t("Статус"))}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr onClick={() => update({ detailId: open ? null : row.id })} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                      <td className="pl-6" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`№ ${row.id}`} className="h-4 w-4 accent-[rgb(79,113,220)]" />
                      </td>
                      <td className={`${td} font-semibold`}>{row.id}</td>
                      <td className={td}>{row.fromWarehouse}</td>
                      <td className={td}>{row.toWarehouse}</td>
                      <td className={td}>{row.createdBy || t("Не указано")}</td>
                      <td className={`${td} whitespace-nowrap`}>{docDate(row.createdAt, language)}</td>
                      <td className={`${td} whitespace-nowrap`}>{docDate(row.deliveredAt, language)}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {formatSum(row.amount)}
                        <span className="block text-[#4f71dc]">{formatWeight(row.weight, t("кг"))}</span>
                      </td>
                      <td className={`${td} pr-6`}>
                        <TransferStatusLabel status={row.status} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                          <TransferDetailPanel
                            key={`${row.id}-${detailVersion}`}
                            id={row.id}
                            canEdit={canEdit}
                            onClose={() => update({ detailId: null })}
                            onEdit={(transfer) => setForm(transfer)}
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
                  <td colSpan={9} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {form !== undefined && (
        <TransferFormDialog
          transfer={form}
          options={options.data}
          onClose={() => setForm(undefined)}
          onSaved={(saved, created) => {
            setForm(undefined)
            notify(t("Успешно сохранено"))
            list.reload()
            options.reload()
            if (created) update({ detailId: saved.id, page: 1 })
            else setDetailVersion((value) => value + 1)
          }}
        />
      )}
      {printing && <TransferInvoices transfers={printing} warehouses={options.data?.warehouses ?? []} onClose={closePrint} />}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
