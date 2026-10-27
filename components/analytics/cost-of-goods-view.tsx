"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, ConfirmDialog, FormField, MultiPick, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { NetCostActionDialog, NetCostEntryDialog, NetCostImportDialog } from "@/components/analytics/cost-of-goods-dialogs"
import { NetCostDetailPanel } from "@/components/analytics/cost-of-goods-detail"
import { CheckIcon, checksTitle, fmtCost, fmtSum, netCostMutate, netCostSheet } from "@/components/analytics/cost-of-goods-shared"
import { FilterToggle, orderedPeriod } from "@/components/analytics/internal-transfers-filter"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { ListBTable } from "@/components/analytics/list-b-table"
import { FilterDate, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefToolbar } from "@/components/ref/list-kit"
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

function NetCostFilter({ filters, options, onClose, onApply }: { filters: Filters; options: NetCostOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const set = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }))
  const items = (options?.items ?? []).map((item) => ({ value: item.key, label: item.name }))
  const warehouses = [{ value: COMMON, label: t("Общий") }, ...(options?.warehouses ?? []).map((name) => ({ value: name, label: name }))]
  const statuses = [
    { value: "true", label: t("Правильные") },
    { value: "false", label: t("Неправильные") },
  ]
  const faults = (options?.faultTypes ?? []).map((fault) => ({ value: fault.key, label: t(fault.name) }))
  const pick = (list: Array<{ value: string; label: string }>, values: string[]) => values.map((value) => list.find((entry) => entry.value === value) ?? { value, label: value })
  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <div className="absolute left-0 top-0 z-[60]">
        <RefFilterPanel
          narrow
          onClose={onClose}
          onApply={() => {
            const [fromDate, toDate] = orderedPeriod(draft.fromDate, draft.toDate)
            onApply({ ...draft, fromDate, toDate })
          }}
          applyClassName="mt-1"
        >
          <RefSearchSelect multi label={t("Продукт")} items={items} selected={pick(items, draft.products)} onChange={(next) => set({ products: next.map((item) => item.value) })} />
          <RefSearchSelect multi label={t("Склад")} items={warehouses} selected={pick(warehouses, draft.stocks)} onChange={(next) => set({ stocks: next.map((item) => item.value) })} />
          <RefSearchSelect label={t("Статус")} items={statuses} selected={pick(statuses, draft.isCorrect ? [draft.isCorrect] : [])} onChange={(next) => set({ isCorrect: (next[0]?.value ?? "") as Filters["isCorrect"] })} />
          <FilterDate label={t("Период создания")} begin={draft.fromDate} end={draft.toDate} onChange={(fromDate, toDate) => set({ fromDate, toDate })} />
          <RefSearchSelect multi label="Ошибки" items={faults} selected={pick(faults, draft.faults)} onChange={(next) => set({ faults: next.map((item) => item.value) as NetCostCheckKey[] })} />
        </RefFilterPanel>
      </div>
    </>
  )
}

function TotalsTable({ totals, loading }: { totals: NetCostTotals | null; loading: boolean }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const rows = totals?.rows ?? []
  const visible = expanded ? rows : rows.slice(0, 3)
  const currency = totals?.currency ?? ""
  const th = "whitespace-nowrap bg-[#fafafa] px-[10px] py-[7px] text-[14px] font-semibold leading-[16px] text-[#333]"
  const td = "border-b border-[#f0f0f0] px-[10px] py-[7px] text-[14px] leading-[16px] text-[#333]"
  return (
    <section className={`mb-[17px] mt-4 overflow-x-auto rounded-[10px] bg-white pb-[14px] pl-4 pr-12 pt-4 shadow-[0_2px_8px_rgba(0,0,0,0.05)] ${loading && !totals ? "opacity-60" : ""}`}>
      <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
        <colgroup>
          <col style={{ width: "15.32%" }} />
          <col style={{ width: "34.93%" }} />
          <col style={{ width: "38.29%" }} />
          <col style={{ width: "11.46%" }} />
        </colgroup>
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
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.stock ?? COMMON} className="hover:bg-[#e6f0ff]">
              <td className={`${td} font-semibold`}>{row.stock ?? t("Общий")}</td>
              <td className={`${td} text-right`}>{fmtSum(row.cumulativeCost)}</td>
              <td className={`${td} text-right`}>{fmtSum(row.lastCost)}</td>
              <td className={`${td} text-right`} style={{ color: row.isCorrect ? "green" : "red" }}>
                {fmtSum(row.fault)}
              </td>
            </tr>
          ))}
          {!visible.length && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-[#9aa3b6]">
                {loading ? t("Загрузка...") : t("Нет данных")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 3 && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-[13px] text-[#1890ff]">
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

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, state.page * state.pageSize) : 0
  const sortHead = (key: string, label: string, right = false, extra = "") => (
    <button type="button" onClick={() => sort(key)} className={`font-semibold hover:opacity-80 ${right ? "block w-full text-right" : "text-left"} ${extra}`}>
      {label}
      {state.ordering === key ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${key}` ? <span className="ml-1 text-[10px]">▼</span> : null}
    </button>
  )
  const refDate = (value: string) => {
    if (!value) return ""
    const day = formatCategoryDate(value.slice(0, 10), language)
    return value.length > 10 ? `${day}, ${value.slice(11, 16)}` : day
  }
  const Body = (
    <>
      <TotalsTable totals={totals.data} loading={totals.loading} />

      <RefCard className="bg-white">
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          filterPanel={
            <NetCostFilter
              filters={state.filters}
              options={options.data}
              onClose={() => setFilterOpen(false)}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1, detailId: null })
              }}
            />
          }
          leftSlot={
            filterCount === 0 ? (
              <button type="button" onClick={() => setFilterOpen((open) => !open)} className="flex h-[16.3px] w-fit items-center text-[13px] text-[#4f71dc]">
                {t("Показать фильтр")}
                <svg viewBox="6 2 12 20" className="ml-px h-5 w-[13px] translate-y-[1.9px] fill-[#4f71dc]"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" /></svg>
              </button>
            ) : (
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
            )
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
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} color="#5d6474" onClick={() => data && void downloadExcel()} />}
        />
        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f71dc] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`-mt-px ${list.loading ? "opacity-60" : ""}`}>
          <ListBTable
            cols="minmax(0,289.3fr) minmax(0,119.5fr) minmax(0,175.2fr) minmax(0,175.2fr) minmax(0,175.2fr) minmax(0,175.2fr) minmax(0,70.4fr)"
            minWidth={1100}
            heads={[
              sortHead("product__name", t("Наименование")),
              sortHead("stock", t("Склад")),
              sortHead("created_date", t("Дата"), false, "-ml-[3px]"),
              sortHead("cost", t("Уср. Себестоимость"), true, "!w-auto ml-auto mr-[7px] max-w-[100px]"),
              sortHead("real_cost", t("Себестоимость"), true, "!w-auto ml-auto mr-[8px]"),
              <span key="rev" className="mr-[10px] block text-right">{t("Сумма переоценки")}</span>,
              <span key="check" className="-ml-[10px] block text-center">{t("Проверка")}</span>,
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            rowClass={(row) => (state.detailId === row.id ? "!bg-[#eef2ff]" : "")}
            onRowClick={(row) => update({ detailId: state.detailId === row.id ? null : row.id })}
            empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
            render={(row) => [
              row.itemName,
              row.stock || <span className="font-semibold italic text-[#5d6474]">{t("Общий")}</span>,
              <span key="date" className="whitespace-nowrap">{refDate(row.date)}</span>,
              <span key="cost" className="block text-right">{fmtCost(row.cost)}</span>,
              <span key="real" className="block text-right">{fmtCost(row.realCost)}</span>,
              <span key="rev" className="block text-right">{row.revaluation === null ? t("Не указано") : fmtCost(row.revaluation)}</span>,
              <span key="check" className="flex justify-center" data-no-translate="" title={checksTitle(row.checkData)}>
                <CheckIcon ok={row.isCorrect} title={checksTitle(row.checkData)} />
              </span>,
            ]}
            replaceRow={(row) => state.detailId === row.id}
            expanded={(row) =>
              state.detailId === row.id ? (
                <NetCostDetailPanel
                  key={`${row.id}-${detailVersion}`}
                  id={row.id}
                  canEdit={canEdit}
                  onClose={() => update({ detailId: null })}
                  onEdit={(detail) => setDialog({ kind: "entry", record: detail })}
                  onDelete={(detail) => setDialog({ kind: "delete", record: detail })}
                />
              ) : null
            }
          />
        </div>
      </RefCard>
    </>
  )

  const content = (
    <>
      <RefHeader title={t("Себестоимость")}>
        {canEdit && (
          <>
            <RefButton exact icon={RI.chart} label={t("Импортировать с excel")} onClick={() => setDialog({ kind: "import" })} />
            <RefButton exact label={checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Проверить")} disabled={checking} onClick={() => void recheck()} />
            <RefButton exact label={t("Перерасчет")} onClick={() => setDialog({ kind: "action", action: "recalc" })} />
            <RefButton exact label={t("Перезаписать")} onClick={() => setDialog({ kind: "action", action: "reset-period" })} />
            <RefButton exact label={t("Сгенерировать заново")} onClick={() => setDialog({ kind: "action", action: "regenerate" })} />
          </>
        )}
      </RefHeader>
      {Body}
    </>
  )
  return (
    <>
      {embedded ? <main className="min-w-0 flex-1 bg-[#f2f5f8] px-7 pb-7 text-[13px] text-[#333]">{content}</main> : <RefPage>{content}</RefPage>}

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
    </>
  )
}
