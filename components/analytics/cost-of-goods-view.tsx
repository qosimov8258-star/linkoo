"use client"

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, FileSpreadsheet, Loader2, RefreshCw, Search } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, FormField, MultiPick, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { NetCostActionDialog, NetCostEntryDialog, NetCostImportDialog } from "@/components/analytics/cost-of-goods-dialogs"
import { NetCostDetailPanel } from "@/components/analytics/cost-of-goods-detail"
import { CheckIcon, checksTitle, fmtCost, fmtSum, netCostMutate, netCostSheet, recordDate } from "@/components/analytics/cost-of-goods-shared"
import { FilterPopup, FilterToggle, PeriodField, orderedPeriod } from "@/components/analytics/internal-transfers-filter"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  NET_COST_API,
  NET_COST_CHECK_KEYS,
  type NetCostActionKind,
  type NetCostActionResult,
  type NetCostCheckKey,
  type NetCostListResult,
  type NetCostOptions,
  type NetCostRecord,
  type NetCostTotals,
} from "@/lib/net-cost-types"

// "Себестоимость" (demo #/net-cost, chunk c46: container 4101, list 4344, filter 4345).
// Header buttons: Пересчитать, Импортировать с excel, Добавить, Проверить, Перерасчет,
// Перезаписать, Сгенерировать заново. Header table per warehouse ("Общий" first, five
// rows + "Показать больше"): Накопленная себестоимость | Текущая себестоимость остатки |
// Разница | Сумма переоценки. List: Наименование | Склад | Дата | Уср. Себестоимость |
// Себестоимость | Сумма переоценки | Проверка; filter Продукт, Склад, Статус, Период
// создания, Ошибки; a row opens its detail in place. Data: /api/cost-of-goods/**
// (lib/net-cost-*); the URL keeps the state.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const
const COMMON = "__common__"

type Filters = { products: string[]; stocks: string[]; isCorrect: "" | "true" | "false"; fromDate: string; toDate: string; faults: NetCostCheckKey[] }
const EMPTY: Filters = { products: [], stocks: [], isCorrect: "", fromDate: "", toDate: "", faults: [] }
type ViewState = { search: string; ordering: string; page: number; pageSize: number; filters: Filters; detailId: number | null }
type Dialog = { kind: "entry"; record: NetCostRecord | null } | { kind: "action"; action: Exclude<NetCostActionKind, "recheck"> } | { kind: "import" } | { kind: "delete"; record: NetCostRecord } | null

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  const correct = params.get("is_correct")
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      products: list("product"),
      stocks: list("stock"),
      isCorrect: correct === "true" || correct === "false" ? correct : "",
      fromDate: params.get("begin_date") ?? "",
      toDate: params.get("end_date") ?? "",
      faults: list("faults").filter((key): key is NetCostCheckKey => (NET_COST_CHECK_KEYS as string[]).includes(key)),
    },
    detailId: positiveInt(params.get("id")),
  }
}

function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  const f = state.filters
  return { search: state.search, ordering: state.ordering, page: pageSize ? state.page : 1, pageSize: String(pageSize), product: f.products, stock: f.stocks, is_correct: f.isCorrect, begin_date: f.fromDate, end_date: f.toDate, faults: f.faults }
}

function stateToSearch(state: ViewState): string {
  return buildCashQuery({ ...listQuery(state), page: state.page > 1 ? state.page : "", pageSize: state.pageSize === 25 ? "" : state.pageSize, id: state.detailId ?? "" })
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

function NetCostFilter({ filters, options, onClose, onApply }: { filters: Filters; options: NetCostOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const set = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }))
  return (
    <FilterPopup
      onClose={onClose}
      onSubmit={() => {
        const [fromDate, toDate] = orderedPeriod(draft.fromDate, draft.toDate)
        onApply({ ...draft, fromDate, toDate })
      }}
    >
      <MultiPick label={t("Продукт")} options={(options?.items ?? []).map((item) => ({ value: item.key, label: item.name }))} value={draft.products} onChange={(products) => set({ products })} />
      <MultiPick
        label={t("Склад")}
        options={[{ value: COMMON, label: t("Общий") }, ...(options?.warehouses ?? []).map((name) => ({ value: name, label: name }))]}
        value={draft.stocks}
        onChange={(stocks) => set({ stocks })}
      />
      <FormField label={t("Статус")}>
        <SearchSelect
          value={draft.isCorrect}
          options={[
            { value: "true", label: t("Правильные") },
            { value: "false", label: t("Неправильные") },
          ]}
          placeholder={t("Все")}
          onChange={(value) => set({ isCorrect: value as Filters["isCorrect"] })}
        />
      </FormField>
      <PeriodField label={t("Период создания")} from={draft.fromDate} to={draft.toDate} onChange={(fromDate, toDate) => set({ fromDate, toDate })} />
      <MultiPick
        label={t("Ошибки")}
        options={(options?.faultTypes ?? []).map((fault) => ({ value: fault.key, label: t(fault.name) }))}
        value={draft.faults}
        onChange={(faults) => set({ faults: faults as NetCostCheckKey[] })}
      />
    </FilterPopup>
  )
}

function TotalsTable({ totals, loading }: { totals: NetCostTotals | null; loading: boolean }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const rows = totals?.rows ?? []
  const visible = expanded ? rows : rows.slice(0, 5)
  const currency = totals?.currency ?? ""
  const th = "whitespace-nowrap border-b border-[#f0f0f0] bg-[#fafafa] px-3 py-2 font-semibold text-[#333]"
  const td = "border-b border-[#f0f0f0] px-3 py-2 text-[16px] font-semibold text-[#333]"
  return (
    <section className={`mx-4 mt-4 overflow-x-auto rounded-xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)] md:mx-6 ${loading && !totals ? "opacity-60" : ""}`}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
        <thead>
          <tr>
            <th className={th}>{t("Склад")}</th>
            <th className={`${th} text-right`}>
              {t("Накопленная себестоимость")} {currency}
            </th>
            <th className={`${th} text-right`}>
              {t("Текущая себестоимость остатки")} {currency}
            </th>
            <th className={`${th} text-right`}>
              {t("Разница")} {currency}
            </th>
            <th className={`${th} text-right`}>
              {t("Сумма переоценки")} {currency}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.stock ?? COMMON} className="hover:bg-[#e6f0ff]">
              <td className={td}>{row.stock ?? t("Общий")}</td>
              <td className={`${td} text-right font-normal`}>{fmtSum(row.cumulativeCost)}</td>
              <td className={`${td} text-right font-normal`}>{fmtSum(row.lastCost)}</td>
              <td className={`${td} text-right font-normal`} style={{ color: row.isCorrect ? "green" : "red" }}>
                {fmtSum(row.fault)}
              </td>
              <td className={`${td} text-right font-normal`}>{fmtSum(row.totalRevaluation)}</td>
            </tr>
          ))}
          {!visible.length && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-[#9aa3b6]">
                {loading ? t("Загрузка...") : t("Нет данных")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 5 && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-[#1890ff]">
            {t(expanded ? "Скрыть" : "Показать больше")}
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      )}
    </section>
  )
}

export function CostOfGoodsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [checking, setChecking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<NetCostListResult>(`${NET_COST_API}?${buildCashQuery(listQuery(state))}`)
  const totals = useCashJson<NetCostTotals>(`${NET_COST_API}/total`)
  const options = useCashJson<NetCostOptions>(`${NET_COST_API}/options`)
  const data = list.data
  const rows = data?.results ?? []

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
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
  const refresh = () => {
    list.reload()
    totals.reload()
    setDetailVersion((value) => value + 1)
  }
  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? "" : key, page: 1 })
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const f = state.filters
  const filterCount = [f.products.length > 0, f.stocks.length > 0, Boolean(f.isCorrect), Boolean(f.fromDate || f.toDate), f.faults.length > 0].filter(Boolean).length

  const recheck = async () => {
    setChecking(true)
    const result = await netCostMutate<NetCostActionResult>("POST", `${NET_COST_API}/actions/recheck`, {})
    setChecking(false)
    if (!result.ok) return notify(result.error, true)
    notify(`${t("Проверено")}: ${result.data.affected} · ${t("Ошибки")}: ${result.data.incorrect}`)
    refresh()
  }

  const remove = async (record: NetCostRecord) => {
    setDeleting(true)
    const result = await netCostMutate<{ ok: true }>("DELETE", `${NET_COST_API}/${record.id}`)
    setDeleting(false)
    if (!result.ok) return notify(result.error, true)
    setDialog(null)
    notify("Успешно удалено")
    update({ detailId: null })
    refresh()
  }

  const downloadExcel = async () => {
    try {
      const response = await fetch(`${NET_COST_API}?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (NetCostListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Себестоимость"), netCostSheet(body.results, t, language))
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Сервер недоступен, попробуйте ещё раз", true)
    }
  }

  const button = "inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-[rgb(79,113,220)] px-3 text-[13px] font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50"
  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"
  return (
    <main className={embedded ? "min-w-0 flex-1 text-[#17233b]" : "min-h-screen bg-[#f1f4f8] text-[#17233b]"}>
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        {!embedded && (
          <div className="flex min-w-0 items-center gap-3">
            <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
            <span className="text-3xl font-light text-[#586174]">|</span>
            <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Себестоимость")}</h1>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" className={button} onClick={() => setDialog({ kind: "action", action: "recalc-period" })}>
              {t("Пересчитать")}
            </button>
            <button type="button" className={button} onClick={() => setDialog({ kind: "import" })}>
              {t("Импортировать с excel")}
            </button>
            <button type="button" className={button} onClick={() => setDialog({ kind: "entry", record: null })}>
              {t("Добавить")}
            </button>
            <button type="button" className={`${button} min-w-[92px]`} disabled={checking} onClick={() => void recheck()}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Проверить")}
            </button>
            <button type="button" className={button} onClick={() => setDialog({ kind: "action", action: "recalc" })}>
              {t("Перерасчет")}
            </button>
            <button type="button" className={button} onClick={() => setDialog({ kind: "action", action: "reset-period" })}>
              {t("Перезаписать")}
            </button>
            <button type="button" className={button} onClick={() => setDialog({ kind: "action", action: "regenerate" })}>
              {t("Сгенерировать заново")}
            </button>
          </div>
        )}
      </header>

      <TotalsTable totals={totals.data} loading={totals.loading} />

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
              <NetCostFilter
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
            <button type="button" onClick={refresh} title={t("Обновить список")} aria-label={t("Обновить список")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
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
          <table className="w-full min-w-[860px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb]">
                <th className={`${th} w-[25%] pl-6`}>{sortHeader("product__name", t("Наименование"))}</th>
                <th className={`${th} w-[10%]`}>{sortHeader("stock", t("Склад"))}</th>
                <th className={`${th} w-[15%]`}>{sortHeader("created_date", t("Дата"))}</th>
                <th className={`${th} w-[15%] text-right`}>{sortHeader("cost", t("Уср. Себестоимость"))}</th>
                <th className={`${th} w-[15%] text-right`}>{sortHeader("real_cost", t("Себестоимость"))}</th>
                <th className={`${th} w-[14%] text-right`}>{t("Сумма переоценки")}</th>
                <th className={`${th} pr-6 text-center`}>{t("Проверка")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = state.detailId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr onClick={() => update({ detailId: open ? null : row.id })} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                      <td className={`${td} pl-6`}>{row.itemName}</td>
                      <td className={td}>{row.stock || <span className="font-semibold italic text-gray-500">{t("Общий")}</span>}</td>
                      <td className={`${td} whitespace-nowrap`}>{recordDate(row.date, language)}</td>
                      <td className={`${td} text-right`}>{fmtCost(row.cost)}</td>
                      <td className={`${td} text-right`}>{fmtCost(row.realCost)}</td>
                      <td className={`${td} text-right`}>{row.revaluation === null ? t("Не указано") : fmtCost(row.revaluation)}</td>
                      <td className={`${td} pr-6`} title={checksTitle(row.checkData, t)}>
                        <span className="flex justify-center">
                          <CheckIcon ok={row.isCorrect} title={checksTitle(row.checkData, t)} />
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                          <NetCostDetailPanel
                            key={`${row.id}-${detailVersion}`}
                            id={row.id}
                            canEdit={canEdit}
                            onClose={() => update({ detailId: null })}
                            onEdit={(detail) => setDialog({ kind: "entry", record: detail })}
                            onDelete={(detail) => setDialog({ kind: "delete", record: detail })}
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

      {dialog?.kind === "entry" && (
        <NetCostEntryDialog
          options={options.data}
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            notify(dialog.record ? "Успешно изменено" : "Успешно сохранено")
            setDialog(null)
            refresh()
            update({ detailId: saved.id, ...(dialog.record ? {} : { page: 1 }) })
          }}
        />
      )}
      {dialog?.kind === "action" && (
        <NetCostActionDialog
          kind={dialog.action}
          options={options.data}
          onClose={() => setDialog(null)}
          onDone={(_result, text) => {
            setDialog(null)
            notify(text)
            refresh()
          }}
        />
      )}
      {dialog?.kind === "import" && (
        <NetCostImportDialog
          options={options.data}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(null)
            notify(`${t("Успешно сохранено")}: ${result.created + result.updated}`)
            refresh()
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("Удалить")}
          text={t("Документы этой себестоимости будут перенесены на предыдущую себестоимость товара. Если предыдущей нет — они останутся без себестоимости.")}
          busy={deleting}
          onConfirm={() => void remove(dialog.record)}
          onClose={() => setDialog(null)}
        />
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
