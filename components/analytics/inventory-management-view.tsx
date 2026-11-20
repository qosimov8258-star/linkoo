"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, mutationError, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ItemDetailPanel, RequestDetailPanel } from "@/components/analytics/inventory-management-detail"
import { ItemFormDialog } from "@/components/analytics/inventory-management-dialogs"
import { InventoryFilterBar, InventoryFilterPanel } from "@/components/analytics/inventory-management-filter"
import { InventoryImportDialog } from "@/components/analytics/inventory-management-import"
import {
  CARD_DIALOG_KEYS,
  EMPTY_FILTERS,
  PAGE_DIALOG_KEYS,
  activeTab,
  checksSheet,
  filterGroup,
  itemsSheet,
  readAddressParam,
  listRequest,
  logsSheet,
  stateFromParams,
  stateToSearch,
  totalsRequest,
  writeAddressParams,
  type ViewState,
} from "@/components/analytics/inventory-management-shared"
import { ChecksTable, ItemsTable, LogsTable, RequestsTable, TotalsBar } from "@/components/analytics/inventory-management-tables"
import { ClientDrawer } from "@/components/clients/clients-view"
import { SHOP_DRAWER_PARAMS, closeShopDrawerParams } from "@/components/clients/shop-drawer-url"
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
  type InventoryTab,
  type InventoryTotals,
} from "@/lib/inventory-items-types"

// "Работа с инвентарем" (demo #/inventory-management?status=attachment, chunk
// c84; API main/gear*): client equipment (fridges, shelves…). Tabs Запросы
// (В процессе / Подтверждено / Отклонено / Все) | На складе | Прикрепление |
// Все | История движений | История проверки; the menu default "attachment"
// lists every item like "Все" but lights no tab. Items tabs show the blue
// totals bar and the "Выбрать из списка" checkboxes ("Удалить"); a row opens
// its detail in place. Header (not on Запросы, whose requests come from the
// agents' app): "Скачать Excel", "Импортировать", "Добавить". Data:
// /api/inventory-items/**; the URL keeps the state with Linko's keys.

const REQUEST_TABS: string[] = [...INVENTORY_REQUEST_STATUSES, ""]
const requestTabLabel = (tab: string) => (tab ? INVENTORY_REQUEST_STATUS_LABELS[tab as keyof typeof INVENTORY_REQUEST_STATUS_LABELS] : "Все")

// Address parameters the page state does not hold: the shop drawer (Linko's ?openShop=<client id>, its X leaves
// drawer=drawer_agent_visit&openShop=0) with its tabs, and the dialogs of the open item card.
const SHOP_KEYS = ["openShop", "drawer", ...SHOP_DRAWER_PARAMS]

function shopOfParam(value: string | null): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function InventoryManagementView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  // Linko writes ?openFilterDialog=true while the filter is open, ?openCreateDialog=true for «Добавить» and
  // ?excelImportCreateDialog=true for «Импортировать» (false once closed), and opens them from such a link.
  const [filterOpen, setFilterOpenState] = useState(() => searchParams.get("openFilterDialog") === "true")
  const [dialog, setDialogState] = useState<"create" | "import" | "bulk" | null>(() =>
    searchParams.get("openCreateDialog") === "true" ? "create" : searchParams.get("excelImportCreateDialog") === "true" ? "import" : null,
  )
  const setFilterOpen = useCallback((open: boolean) => {
    setFilterOpenState(open)
    writeAddressParams({ openFilterDialog: open ? "true" : readAddressParam("openFilterDialog") === null ? null : "false" })
  }, [])
  const dialogRef = useRef(dialog)
  const setDialog = useCallback((next: "create" | "import" | "bulk" | null) => {
    const shown = next ?? dialogRef.current
    const key = shown === "create" ? "openCreateDialog" : shown === "import" ? "excelImportCreateDialog" : null
    if (key) writeAddressParams({ [key]: next ? "true" : "false" })
    dialogRef.current = next
    setDialogState(next)
  }, [])
  const [selected, setSelected] = useState<number[]>([])
  // Like the reference the checkbox column appears only after the "Выбрать из списка" icon is pressed.
  const [selectMode, setSelectMode] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState("")
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  // The shop drawer of a card's «Клиент» (or of ?openShop= on the list); it does not reload the list. It lives in the
  // page body, so it is read from the address once mounted (not on the server).
  const [shopId, setShopId] = useState<number | null>(null)
  useEffect(() => setShopId(shopOfParam(new URLSearchParams(window.location.search).get("openShop"))), [])

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
    const params = new URLSearchParams(stateToSearch(state))
    const current = new URLSearchParams(window.location.search)
    for (const key of [...SHOP_KEYS, ...PAGE_DIALOG_KEYS, ...(state.detailId !== null ? CARD_DIALOG_KEYS : [])]) {
      const value = current.get(key)
      if (value !== null && !params.has(key)) params.set(key, value)
    }
    const search = params.toString()
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

  // Linko's tab change: to or from История движений only the tab stays (filterBy({status})); otherwise the address keeps
  // its filters, Запросы adds statusRequest=pending and the other tabs drop it.
  const changeTab = (tab: InventoryTab) => {
    const reset = tab === "history" || state.status === "history"
    setSelected([])
    setFilterOpen(false)
    if (reset) setSearchDraft("")
    setState((current) => ({
      ...current,
      status: tab,
      filters: reset ? { ...EMPTY_FILTERS, statusRequest: tab === "request" ? ["pending"] : [] } : { ...current.filters, statusRequest: tab === "request" ? ["pending"] : [] },
      search: reset ? "" : current.search,
      ordering: reset ? "" : current.ordering,
      page: 1,
      detailId: null,
    }))
  }
  const openHistory = (id: number) => {
    setSelected([])
    setSearchDraft("")
    // Linko pushes ?status=history&gear=<id> alone: the shop drawer and the card's dialogs close, the page size is back
    // to its default and leaves the address.
    setShopId(null)
    writeAddressParams(Object.fromEntries([...SHOP_KEYS, ...CARD_DIALOG_KEYS].map((key) => [key, null])))
    setState((current) => ({
      ...current,
      status: "history",
      filters: { ...EMPTY_FILTERS, gear: [String(id)] },
      search: "",
      ordering: "",
      page: 1,
      pageSize: 25,
      pageSizeShown: false,
      detailId: null,
    }))
  }
  // Linko's filter.getParams({openShop: id}): the other parameters stay, drawer=drawer_agent_visit of a closed drawer too.
  const openShop = (id: number) => {
    setShopId(id)
    writeAddressParams({ openShop: String(id) })
  }
  // Like Linko's X: openShop=0 and drawer=drawer_agent_visit stay in the address and the list reloads. The callback
  // stays the same across renders (the drawer reloads its client whenever onClose changes).
  const reloads = useRef<Array<() => void>>([])
  useEffect(() => {
    reloads.current = [items.reload, logs.reload, checks.reload, requests.reload, totals.reload]
  })
  const closeShop = useCallback(() => {
    setShopId(null)
    closeShopDrawerParams()
    writeAddressParams({ drawer: "drawer_agent_visit", openShop: "0" })
    for (const reload of reloads.current) reload()
  }, [])
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
      const title = `${t("Работа с инвентарем")} — ${t(INVENTORY_TAB_LABELS[activeTab(state.status) ?? "all"])}`
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
  const requestLabels = REQUEST_TABS.map(requestTabLabel)
  const tab = activeTab(state.status)
  // The sub-tab of the one picked status ("" = Все); several picked in the filter light none.
  const requestValue = state.filters.statusRequest.length <= 1 ? requestTabLabel(state.filters.statusRequest[0] ?? "") : ""
  const pageCount = Math.max(1, Math.ceil(count / Math.max(1, state.pageSize)))
  return (
    <RefPage>
      <RefHeader title={t("Работа с инвентарем")}>
        {group !== "request" && (
          <>
            <RefButton icon={RI.chart} label={t("Скачать Excel")} onClick={() => void downloadExcel()} disabled={!list.data} />
            {canEdit && (
              <>
                <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => setDialog("import")} />
                <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => setDialog("create")} />
              </>
            )}
          </>
        )}
      </RefHeader>

      <RefCard>
        <RefTabs
          noMatchHidden
          labels={tabLabels}
          value={tab ? INVENTORY_TAB_LABELS[tab] : ""}
          onChange={(label) => changeTab(INVENTORY_TABS.find((item) => INVENTORY_TAB_LABELS[item] === label) ?? INVENTORY_TABS[0])}
        />
        {group === "request" && (
          <RefTabs
            noMatchHidden
            labels={requestLabels}
            value={requestValue}
            onChange={(label) => {
              const picked = REQUEST_TABS.find((item) => requestTabLabel(item) === label) ?? ""
              update({ filters: { ...state.filters, statusRequest: picked ? [picked] : [] }, page: 1, detailId: null })
            }}
          />
        )}

        {group === "items" && <TotalsBar totals={totals.data} loading={totals.loading} />}

        <RefToolbar
          // Linko's search field starts 430 px from the page's left edge, as with its «Показать фильтр».
          filterWidth={379}
          leftSlot={<InventoryFilterBar filters={state.filters} open={filterOpen} onOpen={() => setFilterOpen(true)} onClose={() => setFilterOpen(false)} onClear={clearFilters} />}
          filterOpen={filterOpen}
          filterPanel={
            <InventoryFilterPanel
              status={state.status}
              filters={state.filters}
              options={options.data}
              onClose={() => setFilterOpen(false)}
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
          onPageSize={(size) => update({ page: 1, pageSize: size, pageSizeShown: true, detailId: null })}
          from={(state.page - 1) * state.pageSize + 1}
          to={Math.min(state.page * state.pageSize, count)}
          total={count}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page, detailId: null })}
          icons={
            // Linko's checkboxes belong to the item lists (withCheckboxes: not on Запросы or the two histories).
            canEdit && group === "items" ? (
              <RefIconButton
                path={RI.checklist}
                label={t("Выбрать из списка")}
                color={selectMode ? "#1E4A9A" : "#666"}
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
            <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        {/* On a phone the wide list scrolls inside the card (not the page) and an open item card stays in view. */}
        <div className={`max-md:overflow-x-auto max-md:@container ${loading ? "opacity-60" : ""}`}>
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
                  onOpenClient={openShop}
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
        // Linko's ConfirmDialog type "delete" with «№ 12, 15» on the grey band, as the card's own delete.
        <ConfirmDialog
          title={`№ ${selected.join(", ")}`}
          dismissible={false}
          busy={bulkBusy}
          error={bulkError}
          onConfirm={() => void bulkDelete()}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Linko's drawer on this page is 600 px wide (Drawer width={600}). */}
      {shopId !== null &&
        createPortal(
          <div className="[&>aside]:w-[600px]">
            <ClientDrawer key={shopId} clientId={shopId} onClose={closeShop} editHref={`/clients?openShop=${shopId}&openUpdateDialog=true`} />
          </div>,
          document.body,
        )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}

export default InventoryManagementView
