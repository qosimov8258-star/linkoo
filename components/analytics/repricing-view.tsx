"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Plus, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, FormField, MultiPick, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { FilterPopup, FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { docDate, formatSum } from "@/components/analytics/internal-transfers-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { RepricingDetailPanel, RepricingStatusLabel } from "./repricing-detail"
import { RepricingLinkedDialog } from "./repricing-dialogs"
import { RepricingFormDialog } from "./repricing-form"
import {
  REPRICINGS_API,
  REPRICING_STATUSES,
  REPRICING_STATUS_LABELS,
  type Repricing,
  type RepricingListResult,
  type RepricingOptions,
  type RepricingStatus,
} from "./repricing-data"

// "Переоценка" (demo #/revaluation, chunk c143: list 5205, filter 4463, detail 5206, create 5207/5208,
// linked 5210). Header buttons "Переоценку связанных" (tooltip "Создать переоценку для связанных
// прайс-листов") and "Добавить"; toolbar "Показать фильтр" (Прайс лист, Пользователь, Статус, Товар),
// search, paginator, Excel; columns № | Создал | Дата создания | Прайс лист | Сумма переоценки |
// Статус (проведен / отменен); a row opens its detail in place. The URL keeps the state; the price
// lists page links here with ?openCreateDialog=true&priceListId=&currency= ("Установить цену").

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type Filters = { priceLists: string[]; users: string[]; status: RepricingStatus | ""; products: string[] }
const EMPTY: Filters = { priceLists: [], users: [], status: "", products: [] }
type ViewState = { search: string; ordering: string; page: number; pageSize: number; filters: Filters; detailId: number | null }
type CreateState = { priceListId: number | null; currency: string } | null

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  const status = params.get("status") as RepricingStatus | null
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: { priceLists: list("priceList"), users: list("user"), status: status && REPRICING_STATUSES.includes(status) ? status : "", products: list("product") },
    detailId: positiveInt(params.get("id")),
  }
}

function createFromParams(params: URLSearchParams): CreateState {
  if (params.get("openCreateDialog") !== "true") return null
  return { priceListId: positiveInt(params.get("priceListId")), currency: params.get("currency") ?? "" }
}

function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  const f = state.filters
  return { paged: 1, search: state.search, ordering: state.ordering, page: pageSize ? state.page : 1, pageSize: String(pageSize), priceList: f.priceLists, user: f.users, status: f.status, product: f.products }
}

function stateToSearch(state: ViewState): string {
  const f = state.filters
  return buildCashQuery({ search: state.search, ordering: state.ordering, page: state.page > 1 ? state.page : "", pageSize: state.pageSize, priceList: f.priceLists, user: f.users, status: f.status, product: f.products, id: state.detailId ?? "" })
}

function RepricingFilter({ filters, options, onClose, onApply }: { filters: Filters; options: RepricingOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  return (
    <FilterPopup onClose={onClose} onSubmit={() => onApply(draft)}>
      <MultiPick label={t("Прайс лист")} options={(options?.priceLists ?? []).map((list) => ({ value: String(list.id), label: list.name }))} value={draft.priceLists} onChange={(priceLists) => setDraft((current) => ({ ...current, priceLists }))} />
      <MultiPick label={t("Пользователь")} options={(options?.users ?? []).map((user) => ({ value: user, label: user }))} value={draft.users} onChange={(users) => setDraft((current) => ({ ...current, users }))} />
      <FormField label={t("Статус")}>
        <SearchSelect
          value={draft.status}
          options={REPRICING_STATUSES.map((status) => ({ value: status, label: t(REPRICING_STATUS_LABELS[status]) }))}
          placeholder={t("Все")}
          onChange={(status) => setDraft((current) => ({ ...current, status: status as RepricingStatus | "" }))}
        />
      </FormField>
      <MultiPick label={t("Товар")} options={(options?.products ?? []).map((product) => ({ value: product.key, label: product.name }))} value={draft.products} onChange={(products) => setDraft((current) => ({ ...current, products }))} />
    </FilterPopup>
  )
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

export function RepricingView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [create, setCreate] = useState<CreateState>(() => createFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [linkedOpen, setLinkedOpen] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<RepricingListResult>(`${REPRICINGS_API}?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<RepricingOptions>(`${REPRICINGS_API}/options`)
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
  const refresh = useCallback(() => {
    list.reload()
    options.reload()
    setDetailVersion((value) => value + 1)
  }, [list, options])
  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const f = state.filters
  const filterCount = [f.priceLists.length > 0, f.users.length > 0, Boolean(f.status), f.products.length > 0].filter(Boolean).length

  const downloadExcel = async () => {
    try {
      const response = await fetch(`${REPRICINGS_API}?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (RepricingListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Переоценка"), [
        ["№", t("Создал"), t("Дата создания"), t("Прайс лист"), t("Сумма переоценки"), t("Валюта"), t("Статус"), t("Комментарий")],
        ...body.results.map((row: Repricing) => [row.id, row.createdBy, docDate(row.createdAt, language, true), row.priceList, row.total, row.currency, t(REPRICING_STATUS_LABELS[row.status]), row.comment]),
      ])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const headerButton = "inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-3 text-[14px] font-semibold text-white hover:brightness-95"
  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"
  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Переоценка")}</h1>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => setLinkedOpen(true)} title={t("Создать переоценку для связанных прайс-листов")} className={headerButton}>
              <Plus className="h-4 w-4" /> {t("Переоценку связанных")}
            </button>
            <button type="button" onClick={() => setCreate({ priceListId: null, currency: "" })} title={t("Добавление")} className={headerButton}>
              <Plus className="h-4 w-4" /> {t("Добавить")}
            </button>
          </div>
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
              <RepricingFilter
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
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb]">
                <th className={`${th} w-[8%] pl-6`}>{sortHeader("id", "№")}</th>
                <th className={`${th} w-[24%]`}>{t("Создал")}</th>
                <th className={`${th} w-[20%]`}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={`${th} w-[18%]`}>{t("Прайс лист")}</th>
                <th className={`${th} w-[18%]`}>{sortHeader("total", t("Сумма переоценки"))}</th>
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
                      <td className={td}>{row.createdBy || t("Не указано")}</td>
                      <td className={`${td} whitespace-nowrap`}>{docDate(row.createdAt, language)}</td>
                      <td className={td}>{row.priceList || t("Не указано")}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatSum(row.total, row.currency)}</td>
                      <td className={`${td} pr-6`}>
                        <RepricingStatusLabel status={row.status} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                          <RepricingDetailPanel
                            key={`${row.id}-${detailVersion}`}
                            id={row.id}
                            canEdit={canEdit}
                            onClose={() => update({ detailId: null })}
                            onOpen={(id) => update({ detailId: id })}
                            onChanged={refresh}
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
                  <td colSpan={6} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {create && (
        <RepricingFormDialog
          initial={create}
          options={options.data}
          onClose={() => setCreate(null)}
          onSaved={(result) => {
            setCreate(null)
            const linked = result.linked.length ? ` ${t("Связанные переоценки")}: ${result.linked.map((doc) => `№ ${doc.id}`).join(", ")}` : ""
            notify(`${t("Успешно сохранено")}.${linked}`)
            refresh()
            if (result.repricing) update({ detailId: result.repricing.id, page: 1 })
          }}
        />
      )}
      {linkedOpen && (
        <RepricingLinkedDialog
          options={options.data}
          onClose={() => setLinkedOpen(false)}
          onSaved={(text, firstId) => {
            setLinkedOpen(false)
            notify(text)
            refresh()
            if (firstId) update({ detailId: firstId, page: 1 })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
