"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Plus, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { InventoryDetailPanel } from "@/components/analytics/stock-inventory-detail"
import { EMPTY_INVENTORY_FILTERS, InventoryFilterBar, type InventoryFilters } from "@/components/analytics/stock-inventory-filter"
import { InventoryFormDialog } from "@/components/analytics/stock-inventory-form"
import { StatusLabel, formatSum, inventoryDateText, inventoryListSheet } from "@/components/analytics/stock-inventory-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_STATUSES,
  type StockInventoryDetail,
  type StockInventoryListResult,
  type StockInventoryOptions,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"

// "Инвентаризация" (demo #/inventory; chunk c83 module 4138 + c0 modules
// 4372–4759; API stock/inventory/). Toolbar: "Показать фильтр" (Склад, Создал,
// Статус, Период создания), search, page size + "1 - 25 из N", Excel; columns
// № | Склад | Создал | Дата создания | Комментарий | Статус | Сумма (№ and date
// sortable); a row opens its detail in place; "Добавить" creates. Counted
// lines become stock movements once confirmed (lib/stock core). Data:
// /api/stock/inventories/**; the URL keeps the state.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type ViewState = {
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: InventoryFilters
  detailId: number | null
}

function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).flatMap((value) => value.split("~")).map((value) => value.trim()).filter(Boolean))]
  const status = params.get("status") as StockInventoryStatus | null
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      warehouses: list("stock"),
      createdBy: list("createdBy"),
      status: status && STOCK_INVENTORY_STATUSES.includes(status) ? status : "",
      fromDate: params.get("fromDate") ?? "",
      toDate: params.get("toDate") ?? "",
    },
    detailId: positiveInt(params.get("id")),
  }
}

function stateToSearch(state: ViewState): string {
  return buildCashQuery({
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    stock: state.filters.warehouses,
    createdBy: state.filters.createdBy,
    status: state.filters.status,
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
    id: state.detailId ?? "",
  })
}

/** Query of GET /api/stock/inventories (pageSize 0 = every row for Excel). */
function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  return {
    search: state.search,
    ordering: state.ordering,
    page: pageSize ? state.page : 1,
    pageSize: String(pageSize),
    warehouse: state.filters.warehouses,
    createdBy: state.filters.createdBy,
    status: state.filters.status,
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
  }
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

export function InventoryPage() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  // undefined = closed, null = create, detail = edit.
  const [form, setForm] = useState<StockInventoryDetail | null | undefined>(undefined)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<StockInventoryListResult>(`/api/stock/inventories?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<StockInventoryOptions>("/api/stock/inventories/options")
  const data = list.data
  const rows = data?.results ?? []

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  // Search applies 400 ms after typing stops.
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  // A page past the end (rows removed, stale URL) jumps to the last page.
  useEffect(() => {
    if (!data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )

  const clearFilters = () => {
    setSearchDraft("")
    setFilterOpen(false)
    update({ search: "", page: 1, filters: { ...EMPTY_INVENTORY_FILTERS }, detailId: null })
  }

  const downloadExcel = async () => {
    try {
      const response = await fetch(`/api/stock/inventories?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (StockInventoryListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Инвентаризация"), inventoryListSheet(body.results, t, language))
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"
  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Инвентаризация")}</h1>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setForm(null)}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-4 text-[14px] font-semibold text-white shadow-sm hover:brightness-95"
          >
            <Plus className="h-[18px] w-[18px]" /> {t("Добавить")}
          </button>
        )}
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
          <InventoryFilterBar
            filters={state.filters}
            open={filterOpen}
            onOpen={() => setFilterOpen(true)}
            onClose={() => setFilterOpen(false)}
            onClear={clearFilters}
            onApply={(filters) => {
              setFilterOpen(false)
              update({ filters, page: 1, detailId: null })
            }}
            options={options.data}
          />
          <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} sizes={PAGE_SIZES} onChange={({ page, pageSize }) => update({ page, pageSize, detailId: null })} />
            <button type="button" onClick={list.reload} title={t("Обновить список")} aria-label={t("Обновить список")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
              <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
            </button>
            <button type="button" onClick={() => void downloadExcel()} disabled={!data} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40">
              <FileSpreadsheet className="h-5 w-5" />
            </button>
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
          <table className="w-full min-w-[960px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb] text-[#17233b]">
                <th className={`${th} w-[8%] pl-6`}>{sortHeader("id", "№")}</th>
                <th className={`${th} w-[17%]`}>{t("Склад")}</th>
                <th className={`${th} w-[15%]`}>{t("Создал")}</th>
                <th className={`${th} w-[15%]`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} w-[18%]`}>{t("Комментарий")}</th>
                <th className={`${th} w-[14%]`}>{t("Статус")}</th>
                <th className={`${th} w-[13%] pr-6 text-right`}>{t("Сумма")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr onClick={() => update({ detailId: open ? null : row.id })} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                      <td className={`${td} pl-6 font-semibold`}>{row.id}</td>
                      <td className={td}>{row.warehouse}</td>
                      <td className={td}>{row.createdBy || "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>{inventoryDateText(row, language)}</td>
                      <td className={`${td} max-w-[260px] truncate`} title={row.comment || undefined}>
                        {row.comment || t("Комментариев нет")}
                      </td>
                      <td className={td}>
                        <StatusLabel status={row.status} />
                      </td>
                      <td className={`${td} whitespace-nowrap pr-6 text-right`}>{formatSum(row.totalPrice)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                          <InventoryDetailPanel
                            key={`${row.id}-${detailVersion}`}
                            id={row.id}
                            canEdit={canEdit}
                            onClose={() => update({ detailId: null })}
                            onEdit={(detail) => setForm(detail)}
                            onChanged={list.reload}
                            onDeleted={() => {
                              update({ detailId: null })
                              list.reload()
                            }}
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
                  <td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {form !== undefined && (
        <InventoryFormDialog
          inventory={form}
          options={options.data}
          onClose={() => setForm(undefined)}
          onSaved={(saved, created, text) => {
            setForm(undefined)
            notify(t(text))
            list.reload()
            options.reload()
            if (created) update({ detailId: saved.id, page: 1 })
            else setDetailVersion((value) => value + 1)
          }}
        />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
