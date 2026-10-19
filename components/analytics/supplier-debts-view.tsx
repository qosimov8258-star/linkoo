"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Download, Info, Loader2, Plus, RefreshCw } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList } from "@/components/analytics/balance/use-balance"
import { DelivererActDialog, DelivererCorrectionDialog } from "@/components/analytics/deliverer-debts-dialogs"
import {
  countDelivererDebtsFilters,
  DelivererDebtsFilterPanel,
  EMPTY_FILTERS,
  type DelivererDebtsFilters,
  type DelivererDebtsTab,
} from "@/components/analytics/deliverer-debts-filter"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceRow } from "@/lib/finance/types"
import type { DelivererDebtsOptions } from "@/lib/finance-deliverer-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Долги доставщиков" (demo #/planning/?toggleType=prediction, chunk 124):
// - tab "prediction" — per delivery man and currency: balance at the start of
//   the period, shipped orders, returns, payments, corrections and the balance
//   at the end (GET /api/balances/deliverer: the client ledger attributed to
//   the order's / payment's / client's deliverer + his corrections);
// - tab "record" ("Долги агентов") — client balances by the clients'
//   responsible agent (GET /api/balances/agent).
// Period toggle Сегодня / Месяц / Своя Дата, filter popup, "Скачать" (Excel of
// the loaded list), "Обновить список"; deliverer name → Баланс клиентов by
// that deliverer (demo link), hover buttons → act ("Информация по балансу
// доставщика") and "КОРРЕКТИРОВКА". State lives in the URL like the demo:
// toggleType, typeCash, beginDate, endDate, division, paymentType, branch,
// marketType, releasedOrders, orderingPrediction, ordering, openClient, openAddDialog.

type PeriodType = "today" | "month" | "ownDate"

type ViewState = {
  tab: DelivererDebtsTab
  typeCash: PeriodType
  /** Own period ("Своя Дата"). */
  own: { from: string; to: string }
  filters: DelivererDebtsFilters
  /** Deliverers tab sorting (demo orderingPrediction). */
  orderingPrediction: string[]
  /** Agents tab sorting (demo ordering: first_name). */
  ordering: string[]
  /** Open act dialog (deliverer row key). */
  openClient: string | null
  /** Open correction dialog (employees.id). */
  openAddDialog: number | null
}

const DELIVERER_GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.deliverer).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

const AGENT_GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.agent).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

const DELIVERER_BOXES: SummaryBox[] = [
  {
    metrics: [
      { label: "Баланс на начало периода", field: "begin_balance" },
      { label: "Отгрузка (Заказы)", field: "order" },
    ],
  },
  {
    metrics: [
      { label: "Возврат", field: "order_return" },
      { label: "Оплачено", field: "payment" },
    ],
  },
  {
    align: "right",
    metrics: [
      { label: "Корректировка", field: "none_type" },
      { label: "Баланс на конец периода", field: "end_balance" },
    ],
  },
]

const AGENT_BOXES: SummaryBox[] = [
  {
    metrics: [
      { label: "Баланс на начало периода", field: "begin_balance" },
      { label: "Продажи", field: "order" },
    ],
  },
  {
    metrics: [
      { label: "Возврат", field: "order_return" },
      { label: "Оплачено", field: "payment" },
    ],
  },
  {
    metrics: [
      { label: "Прочие приходы", field: "none_type_plus" },
      { label: "Прочие расходы", field: "none_type_minus" },
    ],
  },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

const PERIODS: Array<{ key: PeriodType; label: string }> = [
  { key: "today", label: "Сегодня" },
  { key: "month", label: "Месяц" },
  { key: "ownDate", label: "Своя Дата" },
]

const TABS: Array<{ key: DelivererDebtsTab; label: string }> = [
  { key: "prediction", label: "Долги доставщиков" },
  { key: "record", label: "Долги агентов" },
]

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

/** Page state from the URL (menu default: today, deliverers). */
function readState(params: ParamReader): ViewState {
  const today = todayIso()
  const typeCash = params.get("typeCash")
  const begin = params.get("beginDate") ?? ""
  const end = params.get("endDate") ?? ""
  let own = { from: isIsoDay(begin) ? begin : monthStartIso(today), to: isIsoDay(end) ? end : monthEndIso(today) }
  if (own.from > own.to) own = { from: own.to, to: own.from }
  const list = (name: string) => params.getAll(name).map((value) => value.trim()).filter(Boolean)
  const paymentType = params.get("paymentType") ?? ""
  const addDialog = Number(params.get("openAddDialog"))
  const openClient = params.get("openClient") ?? ""
  return {
    tab: params.get("toggleType") === "record" ? "record" : "prediction",
    typeCash: typeCash === "month" || typeCash === "ownDate" ? typeCash : "today",
    own,
    filters: {
      division: list("division"),
      paymentType: paymentType === "cash" || paymentType === "bank" ? paymentType : "",
      branch: list("branch"),
      marketType: list("marketType"),
      releasedOrders: ["1", "true"].includes(params.get("releasedOrders") ?? ""),
    },
    orderingPrediction: (params.get("orderingPrediction") ?? "").split(",").filter(Boolean),
    ordering: (params.get("ordering") ?? "").split(",").filter(Boolean),
    openClient: openClient || null,
    openAddDialog: Number.isInteger(addDialog) && addDialog > 0 ? addDialog : null,
  }
}

/** Demo listFilterSerializer: today = today..today, month = the current calendar month, ownDate = beginDate..endDate. */
function periodOf(state: ViewState): { from: string; to: string } {
  const today = todayIso()
  if (state.typeCash === "today") return { from: today, to: today }
  if (state.typeCash === "month") return { from: monthStartIso(today), to: monthEndIso(today) }
  return state.own
}

function writeState(state: ViewState) {
  const period = periodOf(state)
  const params = new URLSearchParams()
  params.set("beginDate", period.from)
  params.set("endDate", period.to)
  params.set("toggleType", state.tab)
  if (state.typeCash !== "today") params.set("typeCash", state.typeCash)
  const f = state.filters
  f.division.forEach((value) => params.append("division", value))
  if (f.paymentType) params.set("paymentType", f.paymentType)
  f.branch.forEach((value) => params.append("branch", value))
  f.marketType.forEach((value) => params.append("marketType", value))
  if (f.releasedOrders) params.set("releasedOrders", "true")
  if (state.orderingPrediction.length) params.set("orderingPrediction", state.orderingPrediction.join(","))
  if (state.ordering.length) params.set("ordering", state.ordering.join(","))
  if (state.openClient) params.set("openClient", state.openClient)
  if (state.openAddDialog) params.set("openAddDialog", String(state.openAddDialog))
  const next = `${window.location.pathname}?${params.toString()}`
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next)
}

function useOptions() {
  const [options, setOptions] = useState<DelivererDebtsOptions | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/balances/deliverer-debts/options", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<DelivererDebtsOptions>) : null))
      .then((body) => {
        if (body) setOptions(body)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { options, reload }
}

/** Download icon with the demo's one-item menu ("Доставки" / "Долги"). */
function DownloadMenu({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} title={t("Скачать")} aria-label={t("Скачать")} className="rounded-full p-2.5 text-[#666] hover:bg-[#f2f5f8]">
        <Download className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 min-w-[160px] overflow-hidden rounded-sm bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false)
              onClick()
            }}
            className="block w-full px-4 py-2 text-left text-[13px] text-[#17233b] hover:bg-[#f2f5f8] disabled:text-[#9aa3b6]"
          >
            {t(label)}
          </button>
        </div>
      )}
    </div>
  )
}

export function SupplierDebtsView() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => readState(searchParams))
  const [filterOpen, setFilterOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const { options, reload: reloadOptions } = useOptions()

  useEffect(() => {
    // Deferred: on the first render the app router replaces the history entry after the children's effects.
    const timer = window.setTimeout(() => writeState(state))
    return () => window.clearTimeout(timer)
  }, [state])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const isAgents = state.tab === "record"
  const period = periodOf(state)
  const f = state.filters
  const list = useBalanceList(
    isAgents ? "agent" : "deliverer",
    isAgents
      ? {
          from: period.from,
          to: period.to,
          organization: f.division,
          paymentType: f.paymentType,
          branch: f.branch,
          clientType: f.marketType,
          orderScope: f.releasedOrders ? "released" : undefined,
          ordering: state.ordering,
        }
      : { from: period.from, to: period.to, organization: f.division, paymentType: f.paymentType, branch: f.branch, ordering: state.orderingPrediction },
  )
  // A switch of tab refetches with the other kind: never show the other tab's rows meanwhile.
  const data = list.data?.kind === (isAgents ? "agent" : "deliverer") ? list.data : null
  const rows = useMemo(() => data?.rows ?? [], [data])
  // The demo lists every currency (cards and table), not only the non-zero ones.
  const codes = useMemo(() => (data?.currencies ?? []).map((currency) => currency.code), [data])
  const canEdit = Boolean(options?.canEdit)
  const filterCount = countDelivererDebtsFilters(f)

  const switchTab = (tab: DelivererDebtsTab) => {
    if (tab === state.tab) return
    // Demo moreParams: branch, marketType, releasedOrders and the ordering are reset; division / paymentType stay.
    update({ tab, filters: { ...f, branch: [], marketType: [], releasedOrders: false }, orderingPrediction: [], ordering: [] })
    setFilterOpen(false)
  }

  const refresh = () => {
    list.reload()
    reloadOptions()
  }

  const delivererName = (row: BalanceRow) => row.name || t("Не указано")

  // Demo: the deliverer opens Баланс клиентов for the realization period, filtered by that delivery man.
  const clientBalanceByDeliverer = (row: BalanceRow) =>
    `/analytics/client-balance?${buildBalanceQuery({
      periodType: "secondPeriod",
      acceptedDateBegin: period.from,
      acceptedDateEnd: period.to,
      deliveryMan: row.name,
      division: f.division,
    })}`
  // Agents: every amount opens Баланс клиентов of the agent's clients (demo user=<agent>).
  const clientBalanceByAgent = (row: BalanceRow) => `/analytics/client-balance?${buildBalanceQuery({ fromDate: period.from, toDate: period.to, user: [row.name] })}`

  const delivererCell = (row: BalanceRow) => (
    <div className="group flex items-center justify-between gap-2">
      {row.key === "none" ? (
        <span className="text-[#586174]">{delivererName(row)}</span>
      ) : (
        <Link href={clientBalanceByDeliverer(row)} className="text-[#333] hover:font-semibold hover:text-[#4f70e7]">
          {delivererName(row)}
        </Link>
      )}
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => update({ openClient: row.key })}
          title={t("Информация по балансу доставщика")}
          aria-label={t("Информация по балансу доставщика")}
          className="rounded-full p-1 text-[#666] hover:bg-[#e8edf3]"
        >
          <Info className="h-4 w-4" />
        </button>
        {canEdit && row.id !== null && (
          <button
            type="button"
            onClick={() => update({ openAddDialog: row.id })}
            title={t("Корректировка")}
            aria-label={t("Корректировка")}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-[#8dc572] text-white hover:opacity-85"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  )

  const agentCell = (row: BalanceRow) =>
    row.key === "none" ? (
      <span className="text-[#586174]">{t("Не указано")}</span>
    ) : (
      <Link href={clientBalanceByAgent(row)} className="text-[#333] hover:font-semibold hover:text-[#4f70e7]">
        {row.name}
      </Link>
    )

  const downloadExcel = () => {
    if (!data) return
    const leading = [{ label: isAgents ? "Агенты" : "Доставщики", value: (row: BalanceRow) => (row.key === "none" ? t("Не указано") : row.name) }]
    const groups = isAgents ? AGENT_GROUPS : DELIVERER_GROUPS
    downloadExcelTable(t(isAgents ? "Долги" : "Доставки"), balanceListExcelRows({ rows, groups, currencies: codes, leading, totals: data.totals, t }))
  }

  const correctionRow = state.openAddDialog ? rows.find((row) => row.id === state.openAddDialog) : undefined
  const actRow = state.openClient ? rows.find((row) => row.key === state.openClient) : undefined

  const toggleButton = (active: boolean) =>
    `h-9 px-4 text-[13px] font-semibold uppercase tracking-wide transition-colors ${active ? "bg-[#4f71dc] text-white" : "bg-[#dadada] text-white hover:bg-[#c8c8c8]"}`

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Долги доставщиков")}</span>
        </div>
      </header>

      <section className="relative flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] bg-white px-6 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.08)] md:px-9">
        <div className="flex overflow-hidden rounded-sm">
          {PERIODS.map((item) => (
            <button key={item.key} type="button" onClick={() => update({ typeCash: item.key })} className={toggleButton(state.typeCash === item.key)}>
              {t(item.label)}
            </button>
          ))}
        </div>
        {state.typeCash === "ownDate" && (
          <span className="flex items-center gap-2 text-[13px] font-bold text-[#4f70e7]">
            <input
              type="date"
              value={state.own.from}
              max={state.own.to}
              onChange={(event) => isIsoDay(event.target.value) && update({ own: { ...state.own, from: event.target.value } })}
              className="h-9 bg-transparent outline-none"
            />
            <span>—</span>
            <input
              type="date"
              value={state.own.to}
              min={state.own.from}
              onChange={(event) => isIsoDay(event.target.value) && update({ own: { ...state.own, to: event.target.value } })}
              className="h-9 bg-transparent outline-none"
            />
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-sm">
            {TABS.map((item) => (
              <button key={item.key} type="button" onClick={() => switchTab(item.key)} className={toggleButton(state.tab === item.key)}>
                {t(item.label)}
              </button>
            ))}
          </div>
          <DownloadMenu label={isAgents ? "Долги" : "Доставки"} disabled={!data} onClick={downloadExcel} />
          <button type="button" onClick={refresh} title={t("Обновить список")} aria-label={t("Обновить список")} className="rounded-full p-2.5 text-[#5d6474] hover:bg-[#f2f5f8]">
            <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
          </button>
          <BalanceFilterChip count={filterCount} onOpen={() => setFilterOpen(true)} onClear={() => update({ filters: EMPTY_FILTERS })} />
        </div>

        {filterOpen && (
          <DelivererDebtsFilterPanel
            key={state.tab}
            tab={state.tab}
            value={f}
            options={options}
            onApply={(filters) => update({ filters })}
            onClose={() => setFilterOpen(false)}
          />
        )}
      </section>

      <div className="border-b border-[#e1e5eb] bg-white pt-6">
        {data ? (
          <BalanceSummaryCards boxes={isAgents ? AGENT_BOXES : DELIVERER_BOXES} totals={data.totals} currencies={codes} loading={list.loading} />
        ) : (
          <div className="flex h-[150px] items-center justify-center pb-6">
            {list.error ? <span className="text-[#e57373]">{t(list.error)}</span> : <Loader2 className="h-7 w-7 animate-spin text-[#4f70e7]" />}
          </div>
        )}
      </div>

      {list.error && data && (
        <div className="flex items-center justify-between gap-4 bg-[#fdecec] px-6 py-2 text-[14px] text-[#c62828] md:px-9">
          <span>{t(list.error)}</span>
          <button type="button" onClick={list.reload} className="font-semibold underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <section className="bg-white pb-10">
        {isAgents ? (
          <BalanceTable
            rows={rows}
            groups={AGENT_GROUPS}
            currencies={codes}
            first={{ label: "Ответственные агенты клиентов", width: 260, sortKey: "name", render: agentCell }}
            ordering={state.ordering}
            onOrderingChange={(ordering) => update({ ordering })}
            onCellClick={(row, field) => {
              if (field && row.key !== "none") router.push(clientBalanceByAgent(row))
            }}
            loading={list.loading}
            emptyText="Нет данных"
          />
        ) : (
          <BalanceTable
            rows={rows}
            groups={DELIVERER_GROUPS}
            currencies={codes}
            first={{ label: "Доставщик", width: 220, sortKey: "name", render: delivererCell }}
            ordering={state.orderingPrediction}
            onOrderingChange={(orderingPrediction) => update({ orderingPrediction })}
            loading={list.loading}
            emptyText="Нет данных"
          />
        )}
      </section>

      {state.openClient && !isAgents && (
        <DelivererActDialog
          key={state.openClient}
          entityKey={state.openClient}
          name={actRow ? delivererName(actRow) : ""}
          from={period.from}
          to={period.to}
          canEdit={canEdit}
          onClose={() => update({ openClient: null })}
          onChanged={(message) => {
            setNotice(message)
            list.reload()
          }}
        />
      )}

      {state.openAddDialog && !isAgents && (
        <DelivererCorrectionDialog
          key={state.openAddDialog}
          employeeId={state.openAddDialog}
          name={correctionRow ? delivererName(correctionRow) : `#${state.openAddDialog}`}
          from={period.from}
          to={period.to}
          currencies={data?.currencies ?? []}
          options={options}
          onClose={() => update({ openAddDialog: null })}
          onSaved={() => {
            update({ openAddDialog: null })
            setNotice("Успешно сохранено")
            list.reload()
            reloadOptions()
          }}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded bg-[#323232] px-6 py-3 text-[14px] text-white shadow-lg" role="status">
          {t(notice)}
        </div>
      )}
    </main>
  )
}
