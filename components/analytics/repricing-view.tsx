"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { docDate, formatSum } from "@/components/analytics/internal-transfers-shared"
import { RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { RefMultiField } from "@/components/ref/multi-field"
import { RefTip } from "@/components/ref/ref-tip"
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

// "Переоценка" (reference #/revaluation/). Header buttons "Переоценку связанных" (tooltip "Создать переоценку для
// связанных прайс-листов") and "Добавить"; toolbar "Показать фильтр" opens a full-width panel (Прайс лист,
// Пользователь, Статус, Товар + ПРИМЕНИТЬ), search, page size + "1 - 25 из N", "Скачать Excel" (ours: every row
// of the current search / filters); columns № | Создал | Дата создания | Прайс лист | Сумма переоценки |
// Статус (проведен / отменен); a row opens its detail card in place.
// The URL keeps the state; the price lists page links here with ?openCreateDialog=true&priceListId=&currency=.

type Filters = { priceLists: string[]; users: string[]; status: RepricingStatus | ""; products: string[] }
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

function RepricingFilterPanel({ filters, options, onClose, onApply }: { filters: Filters; options: RepricingOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  return (
    <RefFilterPanel onClose={onClose} onApply={() => onApply(draft)} applyClassName="mt-[24px]">
      <div className="mt-0 grid grid-cols-4 gap-x-[12px] pr-[3px]">
        <RefMultiField label={t("Прайс лист")} options={(options?.priceLists ?? []).map((list) => ({ value: String(list.id), label: list.name }))} value={draft.priceLists} onChange={(priceLists) => setDraft((current) => ({ ...current, priceLists }))} />
        <RefMultiField label={t("Пользователь")} options={(options?.users ?? []).map((user) => ({ value: user, label: user }))} value={draft.users} onChange={(users) => setDraft((current) => ({ ...current, users }))} />
        <RefMultiField
          label={t("Статус")}
          multiple={false}
          options={REPRICING_STATUSES.map((status) => ({ value: status, label: t(REPRICING_STATUS_LABELS[status]) }))}
          value={draft.status ? [draft.status] : []}
          onChange={(next) => setDraft((current) => ({ ...current, status: (next[0] ?? "") as RepricingStatus | "" }))}
        />
        <RefMultiField label={t("Товар")} options={(options?.products ?? []).map((product) => ({ value: product.key, label: product.name }))} value={draft.products} onChange={(products) => setDraft((current) => ({ ...current, products }))} />
      </div>
    </RefFilterPanel>
  )
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return null
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

  // "Скачать Excel": all rows of the current search and filters (pageSize 0 = no paging), not only the shown page.
  const downloadExcel = async () => {
    try {
      const response = await fetch(`${REPRICINGS_API}?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (RepricingListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
      downloadExcelTable(t("Переоценка"), [
        ["№", t("Создал"), t("Дата создания"), t("Прайс лист"), t("Сумма переоценки"), t("Валюта"), t("Статус"), t("Комментарий")],
        ...body.results.map((row: Repricing) => [row.id, row.createdBy, docDate(row.createdAt, language, true), row.priceList, Math.round(row.total * 100) / 100, row.currency, t(REPRICING_STATUS_LABELS[row.status]), row.comment]),
      ])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const th = "whitespace-nowrap px-2 py-0 text-left font-semibold"
  const td = "px-2 py-0 align-middle leading-[16.25px]"
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data?.count ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(state.page * state.pageSize, data?.count ?? 0)
  return (
    <RefPage>
      <RefHeader title={t("Переоценка")}>
        {canEdit && (
          <>
            <RefTip text={t("Создать переоценку для связанных прайс-листов")} side="bottom">
              <RefButton exact green icon={RI.add} label={t("Переоценку связанных")} onClick={() => setLinkedOpen(true)} />
            </RefTip>
            <RefButton exact green icon={RI.add} label={t("Добавить")} onClick={() => setCreate({ priceListId: null, currency: "" })} />
          </>
        )}
      </RefHeader>

      <RefCard>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((open) => !open)}
          filterPanel={
            <RepricingFilterPanel
              filters={state.filters}
              options={options.data}
              onClose={() => setFilterOpen(false)}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1, detailId: null })
              }}
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
            <button type="button" onClick={() => void downloadExcel()} disabled={!data} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className="flex h-12 w-12 items-center justify-center disabled:opacity-40">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
            </button>
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

        <div className={`overflow-x-auto xl:overflow-visible ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[820px] table-fixed border-collapse text-[13px]">
            <thead>
              <tr className="h-[50px] bg-[#5d6474] text-white">
                {/* widths: lib/ref-table-columns.ts (TableFitter) */}
                <th className={`${th} pl-[30px]`}>{sortHeader("id", "№")}</th>
                <th className={th}>{t("Создал")}</th>
                <th className={th}>{sortHeader("created_date", t("Дата создания"))}</th>
                <th className={th}>{t("Прайс лист")}</th>
                <th className={th}>{sortHeader("total", t("Сумма переоценки"))}</th>
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
                        <td colSpan={6} className="p-0">
                          <div className="-mx-[15px] mb-[19px] mt-[21px]">
                            <RepricingDetailPanel
                              key={`${row.id}-${detailVersion}`}
                              id={row.id}
                              canEdit={canEdit}
                              onClose={() => update({ detailId: null })}
                              onOpen={(id) => update({ detailId: id })}
                              onChanged={refresh}
                              notify={notify}
                            />
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr onClick={() => update({ detailId: row.id })} className="h-[50px] cursor-pointer border-b-2 border-dotted border-[#d9e0e5] hover:bg-[#f2f5f8]">
                        <td className={`${td} pl-[38px]`}>{row.id}</td>
                        <td className={td}>{row.createdBy || t("Не указано")}</td>
                        <td className={`${td} whitespace-nowrap`}>{docDate(row.createdAt, language)}</td>
                        <td className={td}>{row.priceList || t("Не указано")}</td>
                        <td className={`${td} whitespace-nowrap`}>{formatSum(row.total, row.currency)}</td>
                        <td className={`${td} pr-[38px]`}>
                          <RepricingStatusLabel status={row.status} />
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
      </RefCard>

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
    </RefPage>
  )
}
