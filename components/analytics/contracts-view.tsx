"use client"

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Info, MoreVertical, Plus, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, formatCashDate, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ContractDetailPanel } from "@/components/analytics/contracts-detail"
import { ContractFormDialog, ContractImportDialog } from "@/components/analytics/contracts-dialogs"
import { ContractStatusBadge } from "@/components/analytics/contracts-fields"
import { ContractsFilterBar, EMPTY_CONTRACT_FILTERS, type ContractFilters } from "@/components/analytics/contracts-filter"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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
const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

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

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
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
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )

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

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Договоры")}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label={t("Меню")} className="flex h-11 w-11 items-center justify-center rounded-full text-[#586174] hover:bg-white">
                <MoreVertical className="h-6 w-6" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 z-[60] min-w-[220px] overflow-hidden rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      setImportOpen(true)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-[#f2f5f8]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#71ce87] text-white">
                      <FileSpreadsheet className="h-4 w-4" />
                    </span>
                    {t("Импортировать с excel")}
                  </button>
                </div>
              )}
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setForm(null)}
              title={t("Создать договор")}
              aria-label={t("Создать договор")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(79,113,220)] text-white shadow-md hover:brightness-95"
            >
              <Plus className="h-6 w-6" />
            </button>
          )}
        </div>
      </header>

      <section className="mx-4 mt-4 overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] md:mx-6">
        <div className="grid min-w-[360px] grid-cols-3">
          {CONTRACT_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => update({ tab, page: 1, detailId: null })}
              className={`h-[52px] border-b-[3px] px-2 text-[15px] ${state.tab === tab ? "border-[rgb(79,113,220)] font-semibold text-[#17233b]" : "border-transparent text-[#586174] hover:text-[#17233b]"}`}
            >
              {t(TAB_LABELS[tab])}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
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
                <th className={`${th} w-[8%] pl-6`}>{sortHeader("contract_number", t("№"))}</th>
                <th className={`${th} w-[12%]`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} w-[25%]`}>{t("Клиент")}</th>
                <th className={`${th} w-[15%]`}>{t("Зона")}</th>
                <th className={`${th} w-[15%]`}>{sortHeader("agent", t("Агент"))}</th>
                <th className={`${th} w-[15%]`}>{sortHeader("inn", t("ИНН"))}</th>
                <th className={`${th} w-[10%] text-center`}>{t("Статус")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => update({ detailId: open ? null : row.id })}
                      className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}
                    >
                      <td className={`${td} whitespace-nowrap pl-6 font-semibold`}>{row.fullNumber || 0}</td>
                      <td className={`${td} whitespace-nowrap`}>{row.createdDate ? formatCashDate(row.createdDate, language, false) : t("Не указан")}</td>
                      <td className={td}>{clientCell(row)}</td>
                      <td className={td}>{row.clients[0]?.zone || t("Не указан")}</td>
                      <td className={td}>{row.agent.name || t("Не указан")}</td>
                      <td className={td}>{row.inn || t("Не указан")}</td>
                      <td className={`${td} text-center`}>
                        <ContractStatusBadge status={row.status} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
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

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
