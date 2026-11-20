"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { INVENTORY_DIALOG_KEYS, InventoryDetailPanel, type InventoryDialogKey } from "@/components/analytics/stock-inventory-detail"
import { InventoryEditDialog } from "@/components/analytics/stock-inventory-edit"
import { EMPTY_INVENTORY_FILTERS, InventoryFilterBar, InventoryFilterPanel, type InventoryFilters } from "@/components/analytics/stock-inventory-filter"
import { InventoryFormDialog } from "@/components/analytics/stock-inventory-form"
import { StatusLabel, formatSum, inventoryDateText, inventoryListSheet } from "@/components/analytics/stock-inventory-shared"
import { RI, RefButton, RefHeader, RefIconButton, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_STATUSES,
  type StockInventoryListResult,
  type StockInventoryOptions,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"

// "Инвентаризация" (demo #/inventory; chunk c83 module 4138 + c0 modules
// 4372–4759; API stock/inventory/). Toolbar: "Показать фильтр" (Склад, Создал,
// Статус, Период создания), search, page size + "1 - 25 из N", Excel; columns
// № | Склад | Создал | Дата создания | Комментарий | Статус | Сумма (№ and date
// sortable); a row opens its card in its place (the rows above and below stay in
// two cards); "Добавить" creates. Counted lines become stock movements once
// confirmed (lib/stock core). Data: /api/stock/inventories/**; the URL keeps the
// state, the card's dialogs included, under Linko's keys (openUpdateDialog,
// openVerifyDialog, inventoryCancelOpen, openCreateDialog; a closed one stays as
// "false", as Linko leaves it). Like Linko's links, opening a card or a dialog and
// paging add a browser history entry (Back closes it again); the card's id stays
// in the URL on another page, where the card is not drawn.

type ViewState = {
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: InventoryFilters
  detailId: number | null
  dialogs: Partial<Record<InventoryDialogKey, string>>
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
    dialogs: Object.fromEntries(INVENTORY_DIALOG_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key) ?? ""]] : []))),
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
    ...state.dialogs,
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

// Linko marks an ascending column (ordering=createdDate) with ↓ and a descending one with ↑.
function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  const keys = ordering.split(",").map((part) => part.trim())
  if (keys.includes(sortKey)) return <ArrowDown className="ml-2 h-3.5 w-3.5 text-[#c9ccd3]" />
  if (keys.includes(`-${sortKey}`)) return <ArrowUp className="ml-2 h-3.5 w-3.5 text-[#c9ccd3]" />
  return null
}

/** Linko's header sort: a click adds the column ascending, then makes it descending, then drops it; the other keys stay
 * ("created_date,-id"). */
function nextOrdering(ordering: string, key: string): string {
  const keys = ordering.split(",").map((part) => part.trim()).filter(Boolean)
  const index = keys.findIndex((part) => part.replace(/^-/, "") === key)
  if (index < 0) return [...keys, key].join(",")
  if (keys[index].startsWith("-")) return keys.filter((_, i) => i !== index).join(",")
  return keys.map((part, i) => (i === index ? `-${key}` : part)).join(",")
}

export function InventoryPage() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  // ?openFilterDialog=true (Linko's link to the open filter) starts with the filter panel open.
  const [filterOpen, setFilterOpen] = useState(() => searchParams.get("openFilterDialog") === "true")
  // The create dialog (open = null); «Изменение» is ?openUpdateDialog=true of the open card.
  const [form, setForm] = useState<null | undefined>(undefined)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<StockInventoryListResult>(`/api/stock/inventories?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<StockInventoryOptions>("/api/stock/inventories/options")
  const data = list.data
  const rows = data?.results ?? []

  // The URL follows the state: a new entry when the card, a dialog, the page or the list's filters change (Linko pushes
  // its hash links), else (typing in the search, the first normalisation) the entry is replaced.
  const shown = useRef<ViewState | null>(null)
  // Set before a correction the page makes by itself (a page past the end), which must not add an entry.
  const replaceNext = useRef(false)
  useEffect(() => {
    const search = stateToSearch(state)
    const previous = shown.current
    const replace = replaceNext.current
    shown.current = state
    replaceNext.current = false
    if (window.location.search.slice(1) === search) return
    const withoutSearch = (value: ViewState) => stateToSearch({ ...value, search: "" })
    const push = !replace && previous !== null && withoutSearch(previous) !== withoutSearch(state)
    const url = `${window.location.pathname}?${search}`
    // No state of our own: Next.js then records the entry in its router, so useSearchParams follows Back / Forward.
    if (push) window.history.pushState(null, "", url)
    else window.history.replaceState(null, "", url)
  }, [state])

  // Back / Forward: the state follows the URL.
  const urlSearch = searchParams.toString()
  useEffect(() => {
    const next = stateFromParams(new URLSearchParams(urlSearch))
    if (!shown.current || stateToSearch(next) === stateToSearch(shown.current)) return
    shown.current = next
    setState(next)
    setSearchDraft(next.search)
  }, [urlSearch])

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
    if (state.page > last) {
      replaceNext.current = true
      setState((current) => ({ ...current, page: last }))
    }
  }, [data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const setDialog = useCallback((key: InventoryDialogKey, value: string) => setState((current) => ({ ...current, dialogs: { ...current.dialogs, [key]: value } })), [])
  const closeEdit = useCallback(() => setDialog("openUpdateDialog", "false"), [setDialog])
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])

  const sort = (key: string) => update({ ordering: nextOrdering(state.ordering, key), page: 1 })
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
  // Only № and Дата создания sort (on the server); the other heads are plain text (a string head would sort client-side).
  const heads = [
    <span key="n" className="-ml-2 block">{sortHeader("id", "№")}</span>,
    <span key="w">{t("Склад")}</span>,
    <span key="c">{t("Создал")}</span>,
    sortHeader("created_date", t("Дата создания")),
    <span key="m">{t("Комментарий")}</span>,
    <span key="s">{t("Статус")}</span>,
    <span key="p">{t("Сумма")}</span>,
  ]
  return (
    <RefPage>
      <RefHeader title={t("Инвентаризация")}>
        {canEdit && <RefButton green icon={RI.checklist} label={t("Добавить")} onClick={() => setForm(null)} />}
      </RefHeader>

      <SplitDetailList
        rows={rows}
        selectedKey={state.detailId}
        rowKey={(row) => row.id}
        toolbar={
          <>
            <RefToolbar
              filterOpen={filterOpen}
              filterPanel={
                <InventoryFilterPanel
                  filters={state.filters}
                  options={options.data}
                  onClose={() => setFilterOpen(false)}
                  onApply={(filters) => {
                    setFilterOpen(false)
                    update({ filters, page: 1, detailId: null })
                  }}
                />
              }
              leftSlot={<InventoryFilterBar filters={state.filters} open={filterOpen} onOpen={() => setFilterOpen(true)} onClose={() => setFilterOpen(false)} onClear={clearFilters} />}
              // Linko's search sits in the second quarter of the toolbar row (25% of the width + 18px).
              linkFilter="flush"
              fluid
              query={searchDraft}
              onQuery={setSearchDraft}
              pageSize={state.pageSize}
              onPageSize={(size) => update({ page: 1, pageSize: size })}
              from={(state.page - 1) * state.pageSize + 1}
              to={Math.min(state.page * state.pageSize, data?.count ?? 0)}
              total={data?.count ?? 0}
              page={state.page}
              pageCount={pageCount}
              onPage={(page) => update({ page })}
              icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={() => data && void downloadExcel()} color="#333" />}
            />
            {list.error && (
              <div className="flex flex-wrap items-center gap-3 bg-white px-6 py-3 text-[#e57373]">
                <span>
                  {t("Не удалось загрузить данные")}: {t(list.error)}
                </span>
                <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] hover:underline">
                  {t("Повторить")}
                </button>
              </div>
            )}
          </>
        }
        tableProps={{
          cols: "minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)",
          heads,
          headPad: 30,
          rowKey: (row) => row.id,
          // A row links to its card (Linko's #/inventory/<id>); the card's header closes it.
          onRowClick: (row) => update({ detailId: row.id }),
          empty: list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено"),
          render: (row) => [
            // Linko's first cell has no left padding: the number sits under the № head.
            <span key="id" className="-ml-2 block">
              {row.id}
            </span>,
            row.warehouse,
            row.createdBy || "—",
            inventoryDateText(row, language),
            row.comment || t("Комментариев нет"),
            <StatusLabel key="status" status={row.status} />,
            // A long sum wraps inside its narrow column, as Linko's (its digit groups are joined by no-break spaces); Linko's
            // last cell has no right padding.
            <span key="sum" className="-mr-2 block [word-break:break-word]">
              {formatSum(row.totalPrice)}
            </span>,
          ],
        }}
        detail={(row) => (
          <InventoryDetailPanel
            key={`${row.id}-${detailVersion}`}
            id={row.id}
            canEdit={canEdit}
            dialogs={state.dialogs}
            onDialog={setDialog}
            onClose={() => update({ detailId: null })}
            onEdit={() => setDialog("openUpdateDialog", "true")}
            onChanged={list.reload}
            onDeleted={() => {
              update({ detailId: null })
              list.reload()
            }}
            notify={notify}
          />
        )}
      />

      {canEdit && state.detailId !== null && state.dialogs.openUpdateDialog === "true" && (
        <InventoryEditDialog
          id={state.detailId}
          options={options.data}
          onClose={closeEdit}
          onSaved={() => {
            closeEdit()
            notify(t("Успешно сохранено"))
            list.reload()
            options.reload()
            setDetailVersion((value) => value + 1)
          }}
        />
      )}

      {form !== undefined && (
        <InventoryFormDialog
          inventory={null}
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
