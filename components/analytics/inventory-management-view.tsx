"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

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
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTabs, RefToolbar } from "@/components/ref/list-kit"
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

const REQUEST_TABS: Array<InventoryRequestStatus | ""> = [...INVENTORY_REQUEST_STATUSES, ""]

export function InventoryManagementView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  // The reference opens "Добавление инвентаря" from ?openCreateDialog=true.
  const [dialog, setDialog] = useState<"create" | "import" | "request" | "bulk" | null>(() => (searchParams.get("openCreateDialog") === "true" ? "create" : null))
  const [selected, setSelected] = useState<number[]>([])
  // Like the reference the checkbox column appears only after the "Выбрать из списка" icon is pressed.
  const [selectMode, setSelectMode] = useState(false)
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

  const loading = list.loading
  const failed = Boolean(list.error)
  const tabLabels = INVENTORY_TABS.map((tab) => INVENTORY_TAB_LABELS[tab])
  const requestLabels = REQUEST_TABS.map((tab) => (tab ? INVENTORY_REQUEST_STATUS_LABELS[tab] : "Все"))
  const pageCount = Math.max(1, Math.ceil(count / Math.max(1, state.pageSize)))
  return (
    <RefPage>
      <RefHeader title={t("Работа с инвентарем")}>
        {group !== "request" ? (
          <>
            <RefButton icon={RI.chart} label={t("Скачать Excel")} onClick={() => void downloadExcel()} disabled={!list.data} />
            {canEdit && (
              <>
                <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => setDialog("import")} />
                <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => setDialog("create")} />
              </>
            )}
          </>
        ) : (
          canEdit && <RefButton green icon={RI.add} label={t("Новый запрос")} onClick={() => setDialog("request")} />
        )}
      </RefHeader>

      <RefCard>
        <RefTabs
          labels={tabLabels}
          value={INVENTORY_TAB_LABELS[activeTab(state.status)]}
          onChange={(label) => changeTab(INVENTORY_TABS.find((tab) => INVENTORY_TAB_LABELS[tab] === label) ?? INVENTORY_TABS[0])}
        />
        {group === "request" && (
          <RefTabs
            labels={requestLabels}
            value={state.requestStatus ? INVENTORY_REQUEST_STATUS_LABELS[state.requestStatus] : "Все"}
            onChange={(label) => update({ requestStatus: REQUEST_TABS.find((tab) => (tab ? INVENTORY_REQUEST_STATUS_LABELS[tab] : "Все") === label) ?? "", page: 1, detailId: null })}
          />
        )}

        {group === "items" && <TotalsBar totals={totals.data} loading={totals.loading} />}

        <RefToolbar
          leftSlot={
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
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(size) => update({ page: 1, pageSize: size, detailId: null })}
          from={count ? (state.page - 1) * state.pageSize + 1 : 0}
          to={Math.min(state.page * state.pageSize, count)}
          total={count}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page, detailId: null })}
          icons={
            canEdit ? (
              <RefIconButton
                path={RI.checklist}
                label={t("Выбрать из списка")}
                color={selectMode ? "#4f71dc" : "#666"}
                onClick={() => {
                  setSelectMode((on) => !on)
                  setSelected([])
                }}
              />
            ) : undefined
          }
          extra={
            canEdit && group === "items" && selected.length > 0 ? (
              <RefButton
                red
                icon={RI.trash}
                label={`${t("Удалить")} (${selected.length})`}
                onClick={() => {
                  setBulkError("")
                  setDialog("bulk")
                }}
              />
            ) : undefined
          }
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

        <div className={loading ? "opacity-60" : ""}>
          {group === "items" && (
            <ItemsTable
              rows={items.data?.results ?? []}
              ordering={state.ordering}
              onSort={sort}
              selected={selected}
              onSelect={setSelected}
              selectable={canEdit && selectMode}
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
      </RefCard>

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
    </RefPage>
  )
}

export default InventoryManagementView
