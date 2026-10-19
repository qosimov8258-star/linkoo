"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, FormField, MultiPick, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { FilterPopup, FilterToggle, PeriodField, orderedPeriod } from "@/components/analytics/internal-transfers-filter"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { WriteOffDetailPanel, WriteOffStatusLabel } from "@/components/analytics/write-offs-detail"
import { WriteOffFormDialog } from "@/components/analytics/write-offs-form"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { WRITE_OFF_STATUSES, type WriteOff, type WriteOffListResult, type WriteOffOptions, type WriteOffStatus } from "@/lib/write-offs-types"

// "Списание" (demo #/write-off, chunk c142: list 5197, filter 4461). Header
// button "Списание товара"; toolbar "Показать фильтр" (Период создания, Склад,
// Создатель, Статус), search, page size + "1 - 25 из N", Excel; columns № |
// Создал | Склад | Дата создания | Статус; a row opens its detail in place.
// Data: /api/write-offs/**; the URL keeps the state.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type Filters = { warehouses: string[]; creators: string[]; status: WriteOffStatus | ""; fromDate: string; toDate: string }
const EMPTY: Filters = { warehouses: [], creators: [], status: "", fromDate: "", toDate: "" }
type ViewState = { search: string; ordering: string; page: number; pageSize: number; filters: Filters; detailId: number | null }

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  const status = params.get("status") as WriteOffStatus | null
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: { warehouses: list("stock"), creators: list("user"), status: status && WRITE_OFF_STATUSES.includes(status) ? status : "", fromDate: params.get("fromDate") ?? "", toDate: params.get("toDate") ?? "" },
    detailId: positiveInt(params.get("id")),
  }
}

function stateToSearch(state: ViewState): string {
  const f = state.filters
  return buildCashQuery({ search: state.search, ordering: state.ordering, page: state.page > 1 ? state.page : "", pageSize: state.pageSize, stock: f.warehouses, user: f.creators, status: f.status, fromDate: f.fromDate, toDate: f.toDate, id: state.detailId ?? "" })
}

function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  const f = state.filters
  return { search: state.search, ordering: state.ordering, page: pageSize ? state.page : 1, pageSize: String(pageSize), warehouse: f.warehouses, creator: f.creators, status: f.status, fromDate: f.fromDate, toDate: f.toDate }
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

function WriteOffFilter({ filters, options, onClose, onApply }: { filters: Filters; options: WriteOffOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const named = (values: string[]) => values.map((value) => ({ value, label: value }))
  return (
    <FilterPopup
      onClose={onClose}
      onSubmit={() => {
        const [fromDate, toDate] = orderedPeriod(draft.fromDate, draft.toDate)
        onApply({ ...draft, fromDate, toDate })
      }}
    >
      <PeriodField label={t("Период создания")} from={draft.fromDate} to={draft.toDate} onChange={(fromDate, toDate) => setDraft((current) => ({ ...current, fromDate, toDate }))} />
      <MultiPick label={t("Склад")} options={named(options?.warehouses ?? [])} value={draft.warehouses} onChange={(warehouses) => setDraft((current) => ({ ...current, warehouses }))} />
      <MultiPick label={t("Создатель")} options={named(options?.users ?? [])} value={draft.creators} onChange={(creators) => setDraft((current) => ({ ...current, creators }))} />
      <FormField label={t("Статус")}>
        <SearchSelect value={draft.status} options={WRITE_OFF_STATUSES.map((status) => ({ value: status, label: t(status) }))} placeholder={t("Все")} onChange={(status) => setDraft((current) => ({ ...current, status: status as WriteOffStatus | "" }))} />
      </FormField>
    </FilterPopup>
  )
}

export function WriteOffsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<WriteOffListResult>(`/api/write-offs?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<WriteOffOptions>("/api/write-offs/options")
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
  const f = state.filters
  const filterCount = [f.warehouses.length > 0, f.creators.length > 0, Boolean(f.status), Boolean(f.fromDate || f.toDate)].filter(Boolean).length

  const downloadExcel = async () => {
    try {
      const response = await fetch(`/api/write-offs?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (WriteOffListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Списание"), [
        ["№", t("Создал"), t("Склад"), t("Дата создания"), t("Статус"), t("Сумма"), t("Комментарий")],
        ...body.results.map((row: WriteOff) => [row.id, row.creator, row.warehouse, docDate(row.date, language, true), t(row.status), Math.round(row.total * 100) / 100, row.comment]),
      ])
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
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Списание")}</h1>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setFormOpen(true)} className="h-[34px] rounded-sm bg-white px-4 text-[14px] font-semibold uppercase text-[#e57373] shadow-sm hover:bg-[#fff5f5]">
            {t("Списание товара")}
          </button>
        )}
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
          <div className="relative">
            <FilterToggle
              count={filterCount}
              open={filterOpen}
              onOpen={() => setFilterOpen(true)}
              onClose={() => setFilterOpen(false)}
              onClear={() => {
                setFilterOpen(false)
                update({ filters: { ...EMPTY }, page: 1, detailId: null })
              }}
            />
            {filterOpen && (
              <WriteOffFilter
                filters={state.filters}
                options={options.data}
                onClose={() => setFilterOpen(false)}
                onApply={(filters) => {
                  setFilterOpen(false)
                  update({ filters, page: 1, detailId: null })
                }}
              />
            )}
          </div>
          <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("Поиск")} aria-label={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
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
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb]">
                <th className={`${th} w-[10%] pl-6`}>{sortHeader("id", "№")}</th>
                <th className={`${th} w-[34%]`}>{t("Создал")}</th>
                <th className={`${th} w-[20%]`}>{t("Склад")}</th>
                <th className={`${th} w-[20%]`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} pr-6`}>{t("Статус")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr onClick={() => update({ detailId: open ? null : row.id })} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                      <td className={`${td} pl-6 font-semibold`}>{row.id}</td>
                      <td className={td}>{row.creator || t("Не указано")}</td>
                      <td className={td}>{row.warehouse}</td>
                      <td className={`${td} whitespace-nowrap`}>{docDate(row.date, language)}</td>
                      <td className={`${td} pr-6`}>
                        <WriteOffStatusLabel status={row.status} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                          <WriteOffDetailPanel key={`${row.id}-${detailVersion}`} id={row.id} canEdit={canEdit} onClose={() => update({ detailId: null })} onChanged={list.reload} notify={notify} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {formOpen && (
        <WriteOffFormDialog
          options={options.data}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false)
            notify(t("Успешно сохранено"))
            list.reload()
            options.reload()
            setDetailVersion((value) => value + 1)
            update({ detailId: saved.id, page: 1 })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
