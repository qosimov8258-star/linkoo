"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, FormField, MultiPick, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { FilterPopup, FilterToggle, PeriodField, orderedPeriod } from "@/components/analytics/internal-transfers-filter"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { WriteOffDetailPanel, WriteOffStatusLabel } from "@/components/analytics/write-offs-detail"
import { WriteOffFormDialog } from "@/components/analytics/write-offs-form"
import { RefCard, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { WRITE_OFF_STATUSES, type WriteOffListResult, type WriteOffOptions, type WriteOffStatus } from "@/lib/write-offs-types"

// "Списание" (demo #/write-off, chunk c142: list 5197, filter 4461). Header
// button "Списание товара"; toolbar "Показать фильтр" (Период создания, Склад,
// Создатель, Статус), search, page size + "1 - 25 из N", Excel; columns № |
// Создал | Склад | Дата создания | Статус; a row opens its detail in place.
// Data: /api/write-offs/**; the URL keeps the state.

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
  return null
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

  const th = "whitespace-nowrap px-2 py-0 text-left font-semibold"
  const td = "px-2 py-0 align-middle leading-[16.25px]"
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data?.count ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(state.page * state.pageSize, data?.count ?? 0)
  return (
    <RefPage>
      <RefHeader title={t("Списание")}>
        {canEdit && (
          <button type="button" onClick={() => setFormOpen(true)} className="text-[13px] font-semibold text-[#e57373] hover:brightness-90">
            {t("Списание товара")}
          </button>
        )}
      </RefHeader>

      <RefCard>
        <RefToolbar
          linkFilter="flush"
          leftSlot={
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

        <div className={`overflow-x-auto xl:overflow-visible ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[760px] table-fixed border-collapse text-[13px]">
            <thead>
              <tr className="h-[50px] bg-[#5d6474] text-white">
                {/* widths: lib/ref-table-columns.ts (TableFitter) */}
                <th className={`${th} pl-[30px]`}>{sortHeader("id", "№")}</th>
                <th className={th}>{t("Создал")}</th>
                <th className={th}>{t("Склад")}</th>
                <th className={th}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} pr-[38px]`}>{t("Статус")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    {open ? (
                      <tr>
                        {/* like the reference the card takes the row's place, 20 px apart from its neighbours and 15 px wider than the list */}
                        <td colSpan={5} className="p-0">
                          <div className="-mx-[15px] mb-[19px] mt-[21px]">
                            <WriteOffDetailPanel key={`${row.id}-${detailVersion}`} id={row.id} canEdit={canEdit} onClose={() => update({ detailId: null })} onChanged={list.reload} notify={notify} />
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr onClick={() => update({ detailId: row.id })} className="h-[50px] cursor-pointer border-b-2 border-dotted border-[#d9e0e5] hover:bg-[#f2f5f8]">
                        <td className={`${td} pl-[38px]`}>{row.id}</td>
                        <td className={td}>{row.creator || t("Не указано")}</td>
                        <td className={td}>{row.warehouse}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.date, language)}</td>
                        <td className={`${td} pr-[38px]`}>
                          <WriteOffStatusLabel status={row.status} />
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
      </RefCard>

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
    </RefPage>
  )
}
