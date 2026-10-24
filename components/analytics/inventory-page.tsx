"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Plus, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { InventoryDetailPanel } from "@/components/analytics/stock-inventory-detail"
import { EMPTY_INVENTORY_FILTERS, InventoryFilterBar, type InventoryFilters } from "@/components/analytics/stock-inventory-filter"
import { InventoryFormDialog } from "@/components/analytics/stock-inventory-form"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { StatusLabel, inventoryListSheet } from "@/components/analytics/stock-inventory-shared"
import { formatMoney } from "@/lib/finance/currency"
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
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
  return null
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

  // ?openInventoryCreateDialog=true opens the create dialog (reference deep link).
  const wantCreate = useRef(searchParams.get("openInventoryCreateDialog") === "true")
  useEffect(() => {
    if (!canEdit || !wantCreate.current) return
    wantCreate.current = false
    setForm(null)
  }, [canEdit])

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / state.pageSize))
  const heads = [
    <span key="n" className="-ml-2 block">{sortHeader("id", "№")}</span>,
    t("Склад"),
    t("Создал"),
    sortHeader("created_date", t("Дата создания")),
    t("Комментарий"),
    t("Статус"),
    t("Сумма"),
  ]
  return (
    <RefPage>
      <RefHeader title={t("Инвентаризация")}>
        {canEdit && <RefButton green icon={RI.checklist} label={t("Добавить")} onClick={() => setForm(null)} />}
      </RefHeader>

      <RefCard>
        <RefToolbar
          leftSlot={
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
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(size) => update({ page: 1, pageSize: size, detailId: null })}
          from={data?.count ? (state.page - 1) * state.pageSize + 1 : 0}
          to={Math.min(state.page * state.pageSize, data?.count ?? 0)}
          total={data?.count ?? 0}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page, detailId: null })}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={() => data && void downloadExcel()} color="#333" />}
        />

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 bg-white px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <RefTable
          cols="minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)"
          heads={heads}
          headPad={30}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => update({ detailId: state.detailId === row.id ? null : row.id })}
          rowClass={(row) => (state.detailId === row.id ? "!bg-[#eef2ff]" : "")}
          empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
          render={(row) => [
            row.id,
            row.warehouse,
            row.createdBy || "—",
            docDate(row.type === "custom_date" ? row.invDate : row.createdDate, language),
            row.comment || t("Комментариев нет"),
            <StatusLabel key="status" status={row.status} />,
            formatMoney(row.totalPrice, 3),
          ]}
          expanded={(row) =>
            state.detailId === row.id ? (
              <div className="-mx-[15px] my-5 bg-[#f2f5f8] px-2 py-3 md:px-4">
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
              </div>
            ) : null
          }
        />
      </RefCard>

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
    </RefPage>
  )
}
