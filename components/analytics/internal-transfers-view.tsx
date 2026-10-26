"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { TransferDetailPanel } from "@/components/analytics/internal-transfers-detail"
import { EMPTY_TRANSFER_FILTERS, TransferFilterBar, type TransferFilters } from "@/components/analytics/internal-transfers-filter"
import { TransferFormDialog } from "@/components/analytics/internal-transfers-form"
import { TransferInvoices } from "@/components/analytics/internal-transfers-print"
import { TransferStatusLabel, docDate, formatSum, formatWeight, transfersListSheet } from "@/components/analytics/internal-transfers-shared"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
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
  return null
}

export function InternalTransfersView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  // undefined = closed, null = create, transfer = edit.
  // The reference opens the create form from ?openCreateDialog=true.
  const [form, setForm] = useState<Transfer | null | undefined>(() => (searchParams.get("openCreateDialog") === "true" ? null : undefined))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Like the reference the checkbox column only appears after the "Выбрать из списка" icon is pressed.
  const [selectMode, setSelectMode] = useState(false)
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
  const th = "whitespace-nowrap px-2 py-0 text-left font-semibold"
  const td = "px-2 py-[7px] align-middle leading-[16.25px]"
  const menuItem = "block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8]"
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data?.count ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(state.page * state.pageSize, data?.count ?? 0)
  return (
    <RefPage>
      <RefHeader title={t("Передачи между складами")}>
        {canEdit && <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => setForm(null)} />}
      </RefHeader>

      <RefCard>
        <RefToolbar
          linkFilter="flush"
          leftSlot={
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
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="mr-2 text-[13px] text-[#586174] hover:underline">
                  {t("Выбрано")}: {selected.size} ✕
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectMode((on) => !on)
                  setSelected(new Set())
                }}
                title={t("Выбрать из списка")}
                aria-label={t("Выбрать из списка")}
                className="flex h-12 w-12 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selectMode ? "fill-[#4f71dc]" : "fill-[#5d6474]"}`}><path d={RI.checklist} /></svg>
              </button>
              <div ref={menuRef} className="relative">
                <button type="button" onClick={() => setMenuOpen((open) => !open)} title={t("Скачать")} aria-label={t("Скачать")} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
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
            </>
          }
        />

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

        <div className={`${state.detailId ? "" : "overflow-x-auto"} ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-[13px]">
            <colgroup>
              {selectMode && <col style={{ width: 40 }} />}
              {[10.35, 15.86, 15.86, 15.86, 7.93, 7.93, 15.86, 10.35].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
            </colgroup>
            <thead className="bg-[#5d6474] text-[13px] font-semibold text-[#fff]">
              <tr className="h-[50px]">
                {selectMode && <th className="w-10 pl-[30px]">
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
                </th>}
                <th className={`${th} w-[10.35%]`}><span className="ml-[22px] inline-block">{sortHeader("id", "№")}</span></th>
                <th className={`${th} w-[15.86%]`}>{t("Со склада")}</th>
                <th className={`${th} w-[15.86%]`}>{t("На склад")}</th>
                <th className={`${th} w-[15.86%]`}>{sortHeader("created_by", t("Создал"))}</th>
                <th className={`${th} w-[7.93%] !whitespace-normal leading-[18px] [&>*]:block [&>*]:max-h-[36px] [&>*]:overflow-hidden`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} w-[7.93%] !whitespace-normal leading-[18px] [&>*]:block [&>*]:max-h-[36px] [&>*]:overflow-hidden`}>{sortHeader("date_delivery", t("Дата доставки"))}</th>
                <th className={`${th} w-[15.86%]`}>{sortHeader("total_price", t("Сумма"))}</th>
                <th className={`${th} w-[10.35%]`}>{sortHeader("status", t("Статус"))}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    {!open && (
                      <tr onClick={() => update({ detailId: open ? null : row.id })} className={`h-[50px] cursor-pointer bg-[linear-gradient(to_right,#d5d5d5_2px,transparent_2px)] bg-[length:8px_2px] bg-[position:0_100%] bg-repeat-x ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                        {selectMode && <td className="pl-6" onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`№ ${row.id}`} className="h-4 w-4 accent-[rgb(79,113,220)]" />
                        </td>}
                        <td className={td}><span className="ml-[30px]">{row.id}</span></td>
                        <td className={td}><span data-no-translate>{row.fromWarehouse}</span></td>
                        <td className={td}><span data-no-translate>{row.toWarehouse}</span></td>
                        <td className={td}>{row.createdBy || t("Не указано")}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.createdAt, language)}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.deliveredAt, language)}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {formatSum(row.amount)}
                          <span className="block text-[#4f71dc]">{formatWeight(row.weight, t("кг"))}</span>
                        </td>
                        <td className={`${td} pr-[38px]`}>
                          <TransferStatusLabel status={row.status} wrap />
                        </td>
                      </tr>
                    )}
                    {open && (
                      <tr>
                        <td colSpan={selectMode ? 9 : 8} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
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
                  <td colSpan={selectMode ? 9 : 8} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </RefCard>

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
    </RefPage>
  )
}
