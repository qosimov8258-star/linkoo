"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FileSpreadsheet, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, mutationError, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ItemDetailPanel, RequestDetailPanel } from "@/components/analytics/inventory-management-detail"
import { ItemFormDialog, RequestFormDialog } from "@/components/analytics/inventory-management-dialogs"
import { InventoryFilterBar } from "@/components/analytics/inventory-management-filter"
import { InventoryImportDialog } from "@/components/analytics/inventory-management-import"
import {
  EMPTY_FILTERS,
  activeTab,
  checksSheet,
  filterGroup,
  itemsSheet,
  listRequest,
  logsSheet,
  stateFromParams,
  stateToSearch,
  totalsRequest,
  type ViewState,
} from "@/components/analytics/inventory-management-shared"
import { ChecksTable, ItemsTable, LogsTable, RequestsTable, TotalsBar } from "@/components/analytics/inventory-management-tables"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVENTORY_REQUEST_STATUSES,
  INVENTORY_REQUEST_STATUS_LABELS,
  INVENTORY_TABS,
  INVENTORY_TAB_LABELS,
  type InventoryCheck,
  type InventoryItemListResult,
  type InventoryListResult,
  type InventoryLog,
  type InventoryOptions,
  type InventoryRequest,
  type InventoryRequestStatus,
  type InventoryTab,
  type InventoryTotals,
} from "@/lib/inventory-items-types"

// "Работа с инвентарем" (demo #/inventory-management?status=attachment, chunk
// c84; API main/gear*): client equipment (fridges, shelves…). Tabs Запросы
// (В процессе / Подтверждено / Отклонено / Все) | На складе | Прикрепление |
// Все | История движений | История проверки; the menu default "attachment"
// lists every item like "Все". Items tabs show the blue totals bar and row
// checkboxes ("Удалить"); a row opens its detail in place. Header: "Скачать
// Excel", "Импортировать", "Добавить". Data: /api/inventory-items/**; the URL
// keeps the state.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const
const REQUEST_TABS: Array<InventoryRequestStatus | ""> = [...INVENTORY_REQUEST_STATUSES, ""]

function TabBar<T extends string>({ tabs, value, label, onChange }: { tabs: readonly T[]; value: T; label: (tab: T) => string; onChange: (tab: T) => void }) {
  return (
    <div role="tablist" className="flex overflow-x-auto border-b border-[#e1e5eb] bg-white">
      {tabs.map((tab) => {
        const active = tab === value
        return (
          <button
            key={tab || "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={`relative h-10 min-w-max flex-1 px-4 text-[14px] ${active ? "font-semibold text-[#17233b]" : "text-[#586174] hover:bg-[#f7f9fc]"}`}
          >
            {label(tab)}
            {active && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[rgb(79,113,220)]" />}
          </button>
        )
      })}
    </div>
  )
}

export function InventoryManagementView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialog, setDialog] = useState<"create" | "import" | "request" | "bulk" | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState("")
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const group = filterGroup(state.status)
  const url = listRequest(state)
  const options = useCashJson<InventoryOptions>("/api/inventory-items/options")
  const items = useCashJson<InventoryItemListResult>(group === "items" ? url : null)
  const logs = useCashJson<InventoryListResult<InventoryLog>>(group === "history" ? url : null)
  const checks = useCashJson<InventoryListResult<InventoryCheck>>(group === "history_check" ? url : null)
  const requests = useCashJson<InventoryListResult<InventoryRequest>>(group === "request" ? url : null)
  const totals = useCashJson<InventoryTotals>(totalsRequest(state))
  const list = { items, history: logs, history_check: checks, request: requests }[group]
  const count = list.data?.count ?? 0

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  // Search applies 400 ms after typing stops.
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1, detailId: null })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  // A page past the end (rows removed, stale URL) jumps to the last page.
  useEffect(() => {
    if (!list.data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(list.data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [list.data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const reloadAll = () => {
    list.reload()
    totals.reload()
    options.reload()
  }

  const changeTab = (tab: InventoryTab) => {
    const sameGroup = filterGroup(tab) === group
    setSelected([])
    setFilterOpen(false)
    if (!sameGroup) setSearchDraft("")
    setState((current) => ({
      ...current,
      status: tab,
      requestStatus: tab === "request" ? "pending" : "",
      filters: sameGroup ? current.filters : { ...EMPTY_FILTERS },
      search: sameGroup ? current.search : "",
      ordering: sameGroup ? current.ordering : "",
      page: 1,
      detailId: null,
    }))
  }
  const openHistory = (id: number) => {
    setSelected([])
    setSearchDraft("")
    setState((current) => ({ ...current, status: "history", requestStatus: "", filters: { ...EMPTY_FILTERS, gear: [String(id)] }, search: "", ordering: "", page: 1, detailId: null }))
  }
  const filterClient = (id: number) => {
    setSelected([])
    setState((current) => ({ ...current, status: "in_market", filters: { ...EMPTY_FILTERS, clients: [String(id)] }, page: 1, detailId: null }))
  }
  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const clearFilters = () => {
    setSearchDraft("")
    setFilterOpen(false)
    setSelected([])
    update({ search: "", page: 1, filters: { ...EMPTY_FILTERS }, detailId: null })
  }
  const toggleRow = (id: number) => update({ detailId: state.detailId === id ? null : id })

  const downloadExcel = async () => {
    try {
      const response = await fetch(listRequest(state, 0), { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as { results?: unknown[]; error?: string } | null
      if (!response.ok || !body?.results) throw new Error(body?.error || `HTTP ${response.status}`)
      const rows = body.results
      const title = `${t("Работа с инвентарем")} — ${t(INVENTORY_TAB_LABELS[activeTab(state.status)])}`
      const sheet =
        group === "history"
          ? logsSheet(rows as InventoryLog[], t, language)
          : group === "history_check"
            ? checksSheet(rows as InventoryCheck[], t, language)
            : itemsSheet(rows as InventoryItemListResult["results"], t, language)
      downloadExcelTable(title, sheet)
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const bulkDelete = async () => {
    setBulkBusy(true)
    setBulkError("")
    const result = await cashMutate("POST", "/api/inventory-items/bulk-delete", { ids: selected })
    setBulkBusy(false)
    if (!result.ok) return setBulkError(result.status === 409 ? t("Удаление невозможно из-за связи с другими данными") : mutationError(result, t))
    setDialog(null)
    setSelected([])
    notify(t("Успешно Удалено"))
    update({ detailId: null })
    reloadAll()
  }

  const headerButton = "inline-flex h-[34px] items-center gap-1.5 rounded-sm px-4 text-[14px] font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
  const loading = list.loading
  const failed = Boolean(list.error)
  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Работа с инвентарем")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {group !== "request" ? (
            <>
              <button type="button" onClick={() => void downloadExcel()} disabled={!list.data} className={`${headerButton} bg-[rgb(79,113,220)]`}>
                <FileSpreadsheet className="h-[18px] w-[18px]" /> {t("Скачать Excel")}
              </button>
              {canEdit && (
                <>
                  <button type="button" onClick={() => setDialog("import")} className={`${headerButton} bg-[rgb(79,113,220)]`}>
                    <Upload className="h-[18px] w-[18px]" /> {t("Импортировать")}
                  </button>
                  <button type="button" onClick={() => setDialog("create")} title={t("Добавить инвентарь")} className={`${headerButton} bg-[#71ce87]`}>
                    <Plus className="h-[18px] w-[18px]" /> {t("Добавить")}
                  </button>
                </>
              )}
            </>
          ) : (
            canEdit && (
              <button type="button" onClick={() => setDialog("request")} className={`${headerButton} bg-[#71ce87]`}>
                <Plus className="h-[18px] w-[18px]" /> {t("Новый запрос")}
              </button>
            )
          )}
        </div>
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <TabBar tabs={INVENTORY_TABS} value={activeTab(state.status)} label={(tab) => t(INVENTORY_TAB_LABELS[tab])} onChange={changeTab} />
        {group === "request" && (
          <TabBar
            tabs={REQUEST_TABS}
            value={state.requestStatus}
            label={(tab) => (tab ? t(INVENTORY_REQUEST_STATUS_LABELS[tab]) : t("Все"))}
            onChange={(requestStatus) => update({ requestStatus, page: 1, detailId: null })}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
          <InventoryFilterBar
            status={state.status}
            filters={state.filters}
            options={options.data}
            open={filterOpen}
            onOpen={() => setFilterOpen(true)}
            onClose={() => setFilterOpen(false)}
            onClear={clearFilters}
            onApply={(filters) => {
              setFilterOpen(false)
              setSelected([])
              update({ filters, page: 1, detailId: null })
            }}
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
          {canEdit && group === "items" && selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBulkError("")
                setDialog("bulk")
              }}
              className="inline-flex h-[32px] items-center gap-1.5 rounded-sm bg-[#fa8072] px-3 text-[13px] font-semibold text-white hover:brightness-95"
            >
              <Trash2 className="h-4 w-4" /> {t("Удалить")} ({selected.length})
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <BalancePagination page={state.page} pageSize={state.pageSize} count={count} sizes={PAGE_SIZES} onChange={({ page, pageSize }) => update({ page, pageSize, detailId: null })} />
            <button type="button" onClick={reloadAll} title={t("Обновить список")} aria-label={t("Обновить список")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
              <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {group === "items" && <TotalsBar totals={totals.data} loading={totals.loading} />}

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

        <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
          {group === "items" && (
            <ItemsTable
              rows={items.data?.results ?? []}
              ordering={state.ordering}
              onSort={sort}
              selected={selected}
              onSelect={setSelected}
              selectable={canEdit}
              detailId={state.detailId}
              onRow={toggleRow}
              loading={loading}
              error={failed}
              renderDetail={(id) => (
                <ItemDetailPanel
                  key={`${id}-${detailVersion}`}
                  id={id}
                  canEdit={canEdit}
                  options={options.data}
                  onClose={() => update({ detailId: null })}
                  onChanged={reloadAll}
                  onDeleted={() => {
                    update({ detailId: null })
                    setSelected((current) => current.filter((value) => value !== id))
                    reloadAll()
                  }}
                  onHistory={openHistory}
                  onFilterClient={filterClient}
                  notify={notify}
                />
              )}
            />
          )}
          {group === "history" && <LogsTable rows={logs.data?.results ?? []} ordering={state.ordering} onSort={sort} loading={loading} error={failed} />}
          {group === "history_check" && <ChecksTable rows={checks.data?.results ?? []} loading={loading} error={failed} />}
          {group === "request" && (
            <RequestsTable
              rows={requests.data?.results ?? []}
              detailId={state.detailId}
              onRow={toggleRow}
              loading={loading}
              error={failed}
              renderDetail={(id) => (
                <RequestDetailPanel key={`${id}-${detailVersion}`} id={id} canEdit={canEdit} options={options.data} onClose={() => update({ detailId: null })} onChanged={reloadAll} notify={notify} />
              )}
            />
          )}
        </div>
      </section>

      {dialog === "create" && (
        <ItemFormDialog
          item={null}
          options={options.data}
          onClose={() => setDialog(null)}
          onSaved={(item) => {
            setDialog(null)
            notify(t("Успешно сохранено"))
            setDetailVersion((value) => value + 1)
            update({ detailId: item.id, page: 1 })
            reloadAll()
          }}
        />
      )}
      {dialog === "request" && (
        <RequestFormDialog
          options={options.data}
          onClose={() => setDialog(null)}
          onSaved={(request) => {
            setDialog(null)
            notify(t("Успешно сохранено"))
            update({ requestStatus: "pending", detailId: request.id, page: 1 })
            reloadAll()
          }}
        />
      )}
      {dialog === "import" && (
        <InventoryImportDialog
          options={options.data}
          onClose={() => setDialog(null)}
          onDone={(created) => {
            setDialog(null)
            notify(`${t("Успешно импортировано")}: ${created}`)
            reloadAll()
          }}
        />
      )}
      {dialog === "bulk" && (
        <ConfirmDialog
          title={t("Подтверждение удаления")}
          text={`${t("Вы уверены что хотите удалить эти данные?")} (№ ${selected.join(", ")})`}
          busy={bulkBusy}
          error={bulkError}
          onConfirm={() => void bulkDelete()}
          onClose={() => setDialog(null)}
        />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}

export default InventoryManagementView
