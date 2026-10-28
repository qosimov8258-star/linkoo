"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { Info } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, formatCashDate, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { ContractDetailPanel } from "@/components/analytics/contracts-detail"
import { ContractFormDialog, ContractImportDialog } from "@/components/analytics/contracts-dialogs"
import { ContractStatusBadge } from "@/components/analytics/contracts-fields"
import { ContractsFilterBar, ContractsFilterPopup, EMPTY_CONTRACT_FILTERS, type ContractFilters } from "@/components/analytics/contracts-filter"
import { ContractIncomeImportDialog } from "@/components/analytics/contracts-income-import"
import { ListBTable } from "@/components/analytics/list-b-table"
import { RI, RefCard, RefHeader, RefIconButton, RefPage, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import {
  CONTRACT_STATUS_EXCEL,
  CONTRACT_TABS,
  type ContractDetail,
  type ContractFormOptions,
  type ContractListResult,
  type ContractRow,
  type ContractTab,
} from "@/lib/contracts-types"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

// "Договоры" (demo #/contracts, uz "Kelishuvlar"; spec scratchpad extra/spec-contracts.md).
// Tabs Активные / Завершенные / Все (status), "Показать фильтр" popup (Договор,
// Клиент, Агент, Зона, Диапазон дат), search, page size + "1 - 25 из N", Excel;
// columns № · Дата создания · Клиент · Зона · Агент · ИНН · Статус (№, date, agent
// and INN sortable); a row expands into the detail with the payments made under
// the contract; "+" creates (next number of the year), ⋮ → "Импортировать с excel".
// Data: /api/contracts/** (lib/contracts-repo.ts). The URL keeps the state.

const TAB_LABELS: Record<ContractTab, string> = { active: "Активные", completed: "Завершенные", all: "Все" }

type ViewState = {
  tab: ContractTab
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: ContractFilters
  detailId: number | null
}

function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const tab = params.get("status") as ContractTab | null
  const list = (name: string) => params.getAll(name).flatMap((value) => value.split("~")).map((value) => value.trim()).filter(Boolean)
  return {
    tab: tab && CONTRACT_TABS.includes(tab) ? tab : "all",
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      contractId: positiveInt(params.get("ids")),
      clientIds: (params.get("client") ?? "").split("-").map(Number).filter((id) => Number.isInteger(id) && id > 0),
      agents: list("agent"),
      zones: list("zone"),
      fromDate: params.get("fromDate") ?? "",
      toDate: params.get("toDate") ?? "",
    },
    detailId: positiveInt(params.get("id")),
  }
}

function stateToSearch(state: ViewState): string {
  return buildCashQuery({
    status: state.tab === "all" ? "" : state.tab,
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    ids: state.filters.contractId ?? "",
    client: state.filters.clientIds.join("-"),
    agent: state.filters.agents,
    zone: state.filters.zones,
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
    id: state.detailId ?? "",
  })
}

/** Query of GET /api/contracts (pageSize 0 = all rows for Excel). */
function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  return {
    status: state.tab,
    search: state.search,
    ordering: state.ordering,
    page: pageSize ? state.page : 1,
    pageSize: String(pageSize),
    ids: state.filters.contractId ?? "",
    client: state.filters.clientIds,
    agent: state.filters.agents,
    zone: state.filters.zones,
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
  }
}

export function ContractsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [incomeImportOpen, setIncomeImportOpen] = useState(false)
  // undefined = closed, null = create, contract = edit.
  const [form, setForm] = useState<ContractDetail | null | undefined>(undefined)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<ContractListResult>(`/api/contracts?${buildCashQuery(listQuery(state))}`)
  const formOptions = useCashJson<ContractFormOptions>("/api/contracts/form-options")
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
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [menuOpen])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const clearFilters = () => {
    // Demo handleClearFilterDialog: empty query (also back to the "Все" tab).
    setSearchDraft("")
    setFilterOpen(false)
    update({ tab: "all", search: "", page: 1, filters: { ...EMPTY_CONTRACT_FILTERS }, detailId: null })
  }

  const downloadExcel = async () => {
    try {
      const response = await fetch(`/api/contracts?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (ContractListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = [t("№"), t("Дата создания"), t("Клиент"), t("Зона"), t("Агент"), t("ИНН"), t("Статус")]
      const lines = body.results.map((row) => [
        row.fullNumber,
        row.createdDate ? formatCashDate(row.createdDate, language, false) : "",
        row.clients.map((client) => client.name).join(", "),
        row.clients[0]?.zone ?? "",
        row.agent.name,
        row.inn,
        t(CONTRACT_STATUS_EXCEL[row.status]),
      ])
      downloadExcelTable(t("Договоры"), [header, ...lines])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const clientCell = (row: ContractRow) => {
    const first = row.clients[0]?.name || t("Не указан")
    if (row.clients.length <= 1) return <span className="block max-w-[320px] truncate">{first}</span>
    return (
      <span className="inline-flex max-w-[320px] items-center gap-2" title={row.clients.map((client) => client.name).join("\n")}>
        <Info className="h-4 w-4 shrink-0 text-[rgb(79,113,220)]" />
        <span className="truncate">{first}</span>
        <span className="shrink-0 rounded-full bg-[#eef1fb] px-1.5 text-[12px] text-[#4f70e7]">+{row.clients.length - 1}</span>
      </span>
    )
  }

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, state.page * state.pageSize) : 0
  const sortHead = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="text-left font-semibold hover:opacity-80">
      {label}
      {state.ordering === key ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${key}` ? <span className="ml-1 text-[10px]">▼</span> : null}
    </button>
  )

  return (
    <RefPage>
      <RefHeader title={t("Договоры")}>
        {canEdit && (
          <div ref={menuRef} className="relative mr-[2px] -mt-[4px]">
            <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label={t("Меню")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.more} /></svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-[50px] z-[60] flex h-14 w-[280px] items-center rounded-[2px] bg-white pl-5 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setImportOpen(true)
                  }}
                  className="flex w-full items-center text-left text-[13px] text-[#333]"
                >
                  <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#71ce87]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={RI.chart} /></svg>
                  </span>
                  <span className="ml-[26px]">{t("Импортировать с excel")}</span>
                </button>
              </div>
            )}
          </div>
        )}
        {canEdit && (
          <button type="button" onClick={() => setForm(null)} title={t("Создать договор")} aria-label={t("Создать договор")} className="flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#4f71dc] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          </button>
        )}
      </RefHeader>

      <RefTabs
        separate
        labels={CONTRACT_TABS.map((tab) => TAB_LABELS[tab])}
        value={TAB_LABELS[state.tab]}
        onChange={(label) => update({ tab: CONTRACT_TABS.find((tab) => TAB_LABELS[tab] === label) ?? "all", page: 1, detailId: null })}
      />

      <RefCard className="mt-5 bg-white">
        <RefToolbar
          filterOpen={filterOpen}
          filterPanel={
            <ContractsFilterPopup
              filters={state.filters}
              options={formOptions.data}
              onClose={() => setFilterOpen(false)}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1, detailId: null })
              }}
            />
          }
          leftSlot={
            <ContractsFilterBar
              filters={state.filters}
              tab={state.tab}
              open={filterOpen}
              onOpen={() => setFilterOpen(true)}
              onClose={() => setFilterOpen(false)}
              onClear={clearFilters}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1, detailId: null })
              }}
              options={formOptions.data}
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
              <RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={() => void downloadExcel()} color="#5d6474" />
              <RefIconButton path={RI.chart} label={t("Импортировать приход")} onClick={() => setIncomeImportOpen(true)} color="#5d6474" />
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

        <div className={list.loading ? "opacity-60" : undefined}>
          <ListBTable
            cols="111px 166px 346px 208px 207px 210px 136px"
            minWidth={1100}
            heads={[sortHead("contract_number", t("№")), sortHead("created_date", t("Дата создания")), t("Клиент"), t("Зона"), sortHead("agent", t("Агент")), sortHead("inn", t("ИНН")), <span key="status" className="block text-center">{t("Статус")}</span>]}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => update({ detailId: state.detailId === row.id ? null : row.id })}
            replaceRow={(row) => state.detailId === row.id}
            empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
            render={(row) => [
              row.fullNumber || 0,
              row.createdDate ? formatCategoryDate(row.createdDate.slice(0, 10), language) : t("Не указан"),
              clientCell(row),
              row.clients[0]?.zone || t("Не указан"),
              row.agent.name || t("Не указан"),
              row.inn || t("Не указан"),
              <span key="status" className="block text-center"><ContractStatusBadge status={row.status} /></span>,
            ]}
            expanded={(row) =>
              state.detailId === row.id ? (
                <div className="-mx-[15px] my-5">
                  <ContractDetailPanel
                    key={`${row.id}-${detailVersion}`}
                    id={row.id}
                    canEdit={canEdit}
                    onClose={() => update({ detailId: null })}
                    onEdit={(contract) => setForm(contract)}
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
        </div>
      </RefCard>

      {form !== undefined && (
        <ContractFormDialog
          contract={form}
          options={formOptions.data}
          onClose={() => setForm(undefined)}
          onSaved={(saved) => {
            const created = form === null
            setForm(undefined)
            notify(t("Успешно сохранено"))
            list.reload()
            formOptions.reload()
            if (created) update({ detailId: saved.id })
            else setDetailVersion((value) => value + 1)
          }}
        />
      )}

      {importOpen && (
        <ContractImportDialog
          onClose={() => setImportOpen(false)}
          onDone={() => {
            list.reload()
            formOptions.reload()
          }}
        />
      )}

      {incomeImportOpen && <ContractIncomeImportDialog onClose={() => setIncomeImportOpen(false)} />}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}