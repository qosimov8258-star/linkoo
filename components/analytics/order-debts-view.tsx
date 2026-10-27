"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, CreditCard, Search } from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { ClientActDialog } from "@/components/analytics/balance/client-act-dialog"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { formatRuDate } from "@/components/analytics/customer-payments-filters"
import {
  ClientDebtDetail,
  OrderDebtOrderDialog,
  OrderDebtPeriodDialog,
  OrderGroupPaymentDialog,
  useBucketTitle,
} from "@/components/analytics/order-debts-dialogs"
import {
  OrderDebtFilterButton,
  OrderDebtFilterDialog,
  listQuery,
  stateFromParams,
  stateToSearch,
  type OrderDebtState,
} from "@/components/analytics/order-debts-filters"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import type { CustomerPaymentOptions } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import {
  DEBT_BUCKETS,
  DEFAULT_ORDER_DEBT_CONFIG,
  type BucketAmounts,
  type DebtBucket,
  type OrderDebtClientRow,
  type OrderDebtListResult,
  type OrderDebtOptions,
  type OrderDebtOrderRow,
  type OrderDebtTab,
} from "@/lib/finance-order-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Долги с заказов" (demo #/statistics/debtors, uz "Buyurtmalar bo'yicha
// qarzlar"): debt aging of order remainders. Cards per aging bucket (periods
// from "Настроить период", default 7 / 30 / 120) with the "N / M Заказов
// обработано" counter and "Общий долг"; the recalculation banner; "Статистика по
// должникам" with the Клиенты / Заказы toggle, search, sorting, paging and the
// expanded view; client drill-down, order dialog with payment, group payment of
// selected orders, the demo filter popup and Excel. Data: GET /api/order-debts
// (lib/finance-order-debts.ts — remainders = order total − linked payments − FIFO
// share of the client's other credits, aged from the realization date).

const LIST_URL = "/api/order-debts"
const BUCKET_COLORS: Record<DebtBucket | "total", string> = { first: "#2cc990", second: "#FF9800", third: "#FF5722", fourth: "#F44336", total: "#F44336" }
const GROUPS: Array<DebtBucket | "total"> = [...DEBT_BUCKETS, "total"]
const INFO_COLUMNS: Array<{ key: "phone" | "address" | "guide" | "agent" | "type"; label: string }> = [
  { key: "phone", label: "Тел" },
  { key: "address", label: "Адрес" },
  { key: "guide", label: "Ориентир" },
  { key: "agent", label: "Ответственный агент" },
  { key: "type", label: "Тип" },
]

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

function DebtValue({ value }: { value: number }) {
  return <span style={{ color: value > 0.005 ? "#f44336" : undefined, fontWeight: value > 0.005 ? 600 : 400 }}>{formatMoney(value, 2)}</span>
}

export function OrderDebtsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<OrderDebtState>(() => stateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  // POST /api/order-debts/group-payment needs cash.manage (lib/capabilities-catalog.ts ROUTE_PERMISSIONS).
  const canGroupPay = useCanManage(["cash.manage"])
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<Record<string, OrderDebtOrderRow>>({})
  const [actClient, setActClient] = useState<{ key: string; name: string } | null>(null)
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const list = useCashJson<OrderDebtListResult>(`${LIST_URL}?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<OrderDebtOptions>(`${LIST_URL}/options`)
  // Cashboxes / branches / employees / rates of the pay dialogs (only for users who may pay).
  const payOptions = useCashJson<CustomerPaymentOptions>(canEdit ? "/api/cash/customer-payments/options" : null)
  const data = list.data
  const config = data?.stats.config ?? DEFAULT_ORDER_DEBT_CONFIG
  const bucketTitle = useBucketTitle(config)
  const currencies = useMemo(() => data?.currencies ?? [], [data])
  const isOrders = state.tab === "order"

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    // Writes (period, recalculation, payment date, payments) need manager or admin here.
    fetchJson<{ role?: string }>("/api/auth/me")
      .then((user) => setCanEdit(user.role === "manager" || user.role === "admin"))
      .catch(() => setCanEdit(false))
  }, [])

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
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const update = (patch: Partial<OrderDebtState>) => setState((current) => ({ ...current, ...patch }))
  const notify = (text: string, error = false) => setNotice({ text, error })
  const sort = (key: string) => update({ ordering: nextOrdering(state.ordering ? [state.ordering] : [], key, "asc-first")[0] ?? "", page: 1 })
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const switchTab = (tab: OrderDebtTab) => {
    if (tab === state.tab) return
    setSelected({})
    update({ tab, ordering: "", page: 1, search: "" })
    setSearchDraft("")
  }

  /** Card counters (demo links to the order list with debtType, dept=1 and, for "processed", the payment date from today). */
  const showBucketOrders = (bucket: DebtBucket, processed: boolean) => {
    setSelected({})
    setSearchDraft("")
    update({
      tab: "order",
      ordering: "",
      page: 1,
      search: "",
      filters: { ...state.filters, marketDebtType: bucket, paymentFromDate: processed ? (data?.stats.today ?? "") : "", paymentToDate: "" },
    })
  }

  const recalcAll = async () => {
    setRecalcBusy(true)
    const result = await cashMutate<{ recalculated: number; wrongDebtClientCount: number }>("POST", `${LIST_URL}/recalc`, {})
    setRecalcBusy(false)
    if (!result.ok) return notify(t(result.error), true)
    list.reload()
    notify(t("Долги пересчитаны"))
  }

  // --- Excel ------------------------------------------------------------------------------------

  const codes = currencies.map((currency) => currency.code)
  const download = async (tab: OrderDebtTab) => {
    try {
      const all = await fetchJson<OrderDebtListResult>(`${LIST_URL}?${buildCashQuery(listQuery({ ...state, tab, ordering: tab === state.tab ? state.ordering : "" }, { page: 1, pageSize: 0 }))}`)
      const allCodes = all.currencies.map((currency) => currency.code)
      if (tab === "client") {
        const head1 = [t("Клиенты"), ...GROUPS.flatMap((group) => allCodes.map((_, index) => (index === 0 ? bucketTitle(group) : ""))), t("Дополнительная информация"), "", "", "", ""]
        const head2 = ["", ...GROUPS.flatMap(() => allCodes.map(currencyLabel)), ...INFO_COLUMNS.map((column) => t(column.label))]
        const rows = all.clients.map((row) => [
          row.name,
          ...GROUPS.flatMap((group) => allCodes.map((code) => row.currencies[code]?.[group] ?? 0)),
          ...INFO_COLUMNS.map((column) => row[column.key] || ""),
        ])
        const totals = ["", ...GROUPS.flatMap((group) => allCodes.map((code) => (group === "total" ? (all.stats.amounts[code]?.total ?? 0) : (all.stats.amounts[code]?.[group] ?? 0))))]
        downloadExcelTable(t("Долги с заказов"), [head1, head2, ...rows, [t("Итого"), ...totals.slice(1)]])
      } else {
        const head = [
          t("Заказ №"),
          t("Клиент"),
          t("Прошло дней"),
          t("Сумма заказа"),
          t("Валюта"),
          t("Долг"),
          t("Срок оплаты"),
          t("Агент"),
          ...allCodes.map((code) => `${t("Общий долг")} (${currencyLabel(code)})`),
          t("Доставщик"),
          t("Дата реализации"),
          t("Дата доставки"),
          t("Дата создания"),
          t("Статус"),
        ]
        const rows = all.orders.map((row) => [
          row.orderId,
          row.client.name,
          row.passedDays,
          row.total,
          currencyLabel(row.currency),
          row.remaining,
          row.paymentDate,
          row.agent,
          ...allCodes.map((code) => row.clientDebt[code] ?? 0),
          row.deliveryMan,
          row.realizationDate,
          row.deliveryDate,
          row.createdAt.replace("T", " "),
          t(row.status),
        ])
        downloadExcelTable(`${t("Долги с заказов")} — ${t("Список заказов")}`, [head, ...rows])
      }
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  // --- render pieces ----------------------------------------------------------------------------

  const stats = data?.stats
  const cards = (
    <section className={`flex flex-wrap gap-x-14 gap-y-5 px-6 pb-4 md:px-9 ${list.loading ? "opacity-60" : ""}`}>
      {DEBT_BUCKETS.map((bucket) => (
        <div key={bucket} className="flex min-w-[170px] select-none flex-col gap-1">
          <span className="text-[#666]">{bucketTitle(bucket)}</span>
          {codes
            .filter((code) => (stats?.amounts[code]?.[bucket] ?? 0) > 0.005)
            .map((code) => (
              <span key={code} className="text-[15px] font-semibold" style={{ color: BUCKET_COLORS[bucket] }}>
                {formatMoney(stats!.amounts[code][bucket], 2)} {currencyLabel(code)}
              </span>
            ))}
          <span className="text-[15px] font-semibold text-[#17233b]">
            <button type="button" onClick={() => showBucketOrders(bucket, true)} className="mr-1 text-[#4f71dc] hover:underline" title={t("Заказов обработано")}>
              {stats?.expect[bucket] ?? 0}
            </button>
            /
            <button type="button" onClick={() => showBucketOrders(bucket, false)} className="mx-1 text-[#4f71dc] hover:underline">
              {stats?.debtors[bucket] ?? 0}
            </button>
            <span className="text-[13px] font-normal text-[#586174]">{t("Заказов обработано")}</span>
          </span>
        </div>
      ))}
      <div className="flex min-w-[170px] select-none flex-col gap-1">
        <span className="text-[#666]">{t("Общий долг")}</span>
        {codes.map((code) => (
          <span key={code} className="text-[15px] font-semibold" style={{ color: BUCKET_COLORS.total }}>
            {formatMoney(stats?.amounts[code]?.total ?? 0, 2)} {currencyLabel(code)}
          </span>
        ))}
      </div>
    </section>
  )

  const banner =
    stats && stats.wrongDebtClientCount > 0 ? (
      <div className="mx-6 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#ffd6d6] border-l-[5px] border-l-[#e54848] bg-[#fff5f5] px-2 py-1.5 shadow-[0_4px_14px_rgba(229,72,72,0.12)] md:mx-9">
        <h3 className="flex flex-wrap items-center gap-1 text-[14px] font-semibold text-[#a8071a]">
          <AlertTriangle className="h-4 w-4" />
          {t("Требуется перерасчет долгов клиентов:")}
          <button type="button" onClick={() => update({ filters: { ...state.filters, withWrongDebt: true }, page: 1, tab: "client" })} className="font-semibold text-[#4f71dc] hover:underline">
            {stats.wrongDebtClientCount} {t("шт.")}
          </button>
          {t("Долги этих клиентов исключены из итогов")}
        </h3>
        {canEdit && (
          <button type="button" disabled={recalcBusy} onClick={() => void recalcAll()} className="h-[30px] rounded-md bg-[#4f70e7] px-4 text-[13px] font-semibold text-white disabled:opacity-60">
            {recalcBusy ? t("Загрузка...") : t("Пересчитать")}
          </button>
        )}
      </div>
    ) : null

  const selectedRows = Object.values(selected)
  const orderRows = data?.orders ?? []
  const clientRows = data?.clients ?? []
  const allOnPage = orderRows.length > 0 && orderRows.every((row) => selected[row.key])
  const toggleAll = () =>
    setSelected((current) => {
      const next = { ...current }
      for (const row of orderRows) {
        if (allOnPage) delete next[row.key]
        else next[row.key] = row
      }
      return next
    })
  const toggleRow = (row: OrderDebtOrderRow) =>
    setSelected((current) => {
      const next = { ...current }
      if (next[row.key]) delete next[row.key]
      else next[row.key] = row
      return next
    })
  const openDetail = (key: string) => update({ detailId: key })
  const dateCell = (iso: string, withTime = false) => (iso ? formatRuDate(iso, withTime, language) : t("Не указано"))

  const th = "border border-[#e1e5eb] px-3 py-2 font-semibold whitespace-nowrap"
  const td = "border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap"

  const clientTable = (
    <table className="w-full border-collapse text-[14px]">
      <thead className="sticky top-0 z-[1]">
        <tr className="bg-[#edf2f7] text-[#253653]">
          <th rowSpan={2} className={`${th} sticky left-0 z-[2] min-w-[220px] bg-[#edf2f7] text-left`}>
            {sortHeader("name", t("Клиенты"))}
          </th>
          {GROUPS.map((group) => (
            <th key={group} colSpan={Math.max(1, codes.length)} className={`${th} text-center font-medium`}>
              {bucketTitle(group)}
            </th>
          ))}
          <th colSpan={INFO_COLUMNS.length} className={`${th} text-center font-medium`}>
            {t("Дополнительная информация")}
          </th>
        </tr>
        <tr className="bg-white text-[#17233b]">
          {GROUPS.map((group) =>
            codes.map((code) => (
              <th key={`${group}.${code}`} className={`${th} text-left`}>
                {sortHeader(`${group}.${code}`, currencyLabel(code))}
              </th>
            )),
          )}
          {INFO_COLUMNS.map((column) => (
            <th key={column.key} className={`${th} text-left`}>
              {sortHeader(column.key, t(column.label))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {clientRows.map((row: OrderDebtClientRow, index) => {
          const background = index % 2 ? "#F4F8FB" : "#ffffff"
          return (
            <tr key={row.key} style={{ background }}>
              <td className={`${td} sticky left-0`} style={{ background }}>
                <button type="button" onClick={() => openDetail(row.key)} className="flex w-full items-center justify-between gap-2 text-left text-[#333] hover:font-semibold hover:text-[#4f71dc]">
                  <span className="truncate">{row.name || t("Не указано")}</span>
                  {row.wrongDebt && (
                    <span title={t("Требуется перерасчет")} className="inline-flex">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-[#e54848]" />
                    </span>
                  )}
                </button>
              </td>
              {GROUPS.map((group) =>
                codes.map((code) => (
                  <td key={`${group}.${code}`} className={td}>
                    <DebtValue value={row.currencies[code]?.[group as keyof BucketAmounts] ?? 0} />
                  </td>
                )),
              )}
              {INFO_COLUMNS.map((column) => (
                <td key={column.key} className={`${td} max-w-[220px] truncate`} title={row[column.key]}>
                  {row[column.key] || ""}
                </td>
              ))}
            </tr>
          )
        })}
        {!clientRows.length && (
          <tr>
            <td colSpan={1 + GROUPS.length * Math.max(1, codes.length) + INFO_COLUMNS.length} className="px-4 py-16 text-center text-[#9aa3b6]">
              {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  const orderTable = (
    <table className="w-full border-collapse text-[14px]">
      <thead className="sticky top-0 z-[1]">
        <tr className="bg-[#edf2f7] text-left text-[#253653]">
          {canEdit && (
            <th className={`${th} sticky left-0 z-[2] w-10 bg-[#edf2f7] text-center`}>
              <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-4 w-4 accent-[#4f70e7]" />
            </th>
          )}
          <th className={th}>{sortHeader("id", t("Заказ №"))}</th>
          <th className={th}>{sortHeader("client", t("Клиент"))}</th>
          <th className={th}>{sortHeader("passed_days", t("Прошло дней"))}</th>
          <th className={`${th} text-right`}>{sortHeader("total", t("Сумма заказа"))}</th>
          <th className={`${th} text-right`}>{sortHeader("remaining", t("Долг"))}</th>
          <th className={th}>{sortHeader("payment_date", t("Срок оплаты"))}</th>
          <th className={th}>{sortHeader("agent", t("Агент"))}</th>
          {codes.map((code) => (
            <th key={code} className={`${th} text-right`}>
              {sortHeader(`client_debt.${code}`, `${t("Общий долг")} (${currencyLabel(code)})`)}
            </th>
          ))}
          <th className={th}>{sortHeader("delivery_man", t("Доставщик"))}</th>
          <th className={th}>{sortHeader("realization", t("Дата реализации"))}</th>
          <th className={th}>{sortHeader("delivery", t("Дата доставки"))}</th>
          <th className={th}>{sortHeader("created", t("Дата создания"))}</th>
        </tr>
      </thead>
      <tbody>
        {orderRows.map((row, index) => {
          const background = selected[row.key] ? "#eaf0fd" : index % 2 ? "#F4F8FB" : "#ffffff"
          return (
            <tr key={row.key} style={{ background }}>
              {canEdit && (
                <td className={`${td} sticky left-0 text-center`} style={{ background }}>
                  <input type="checkbox" checked={Boolean(selected[row.key])} onChange={() => toggleRow(row)} aria-label={`№ ${row.orderId}`} className="h-4 w-4 accent-[#4f70e7]" />
                </td>
              )}
              <td className={td}>
                <button type="button" onClick={() => update({ orderId: row.orderId })} className="font-semibold text-[#333] hover:text-[#4f71dc]">
                  {row.orderId}
                </button>
              </td>
              <td className={td}>
                <button
                  type="button"
                  onClick={() => (row.client.id !== null ? setActClient({ key: row.client.key, name: row.client.name }) : openDetail(row.client.key))}
                  className="max-w-[200px] truncate text-left text-[rgb(79,113,220)] hover:font-semibold"
                >
                  {row.client.name || t("Не указано")}
                </button>
              </td>
              <td className={td}>{row.passedDays}</td>
              <td className={`${td} text-right`}>
                {formatMoney(row.total, 2)} {currencyLabel(row.currency)}
              </td>
              <td className={`${td} text-right font-semibold text-[#E27676]`}>{formatMoney(row.remaining, 2)}</td>
              <td className={td}>
                <button type="button" onClick={() => openDetail(row.client.key)} className="text-[rgb(79,113,220)] hover:font-semibold">
                  {dateCell(row.paymentDate)}
                </button>
              </td>
              <td className={td}>{row.agent || t("Не указано")}</td>
              {codes.map((code) => (
                <td key={code} className={`${td} text-right font-semibold text-[#E27676]`}>
                  {formatMoney(row.clientDebt[code] ?? 0, 2)}
                </td>
              ))}
              <td className={td}>{row.deliveryMan || t("Не указано")}</td>
              <td className={td}>{dateCell(row.realizationDate)}</td>
              <td className={td}>{dateCell(row.deliveryDate)}</td>
              <td className={td}>{dateCell(row.createdAt, true)}</td>
            </tr>
          )
        })}
        {!orderRows.length && (
          <tr>
            <td colSpan={(canEdit ? 1 : 0) + 11 + codes.length} className="px-4 py-16 text-center text-[#9aa3b6]">
              {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  const detailName = clientRows.find((row) => row.key === state.detailId)?.name ?? orderRows.find((row) => row.client.key === state.detailId)?.client.name ?? ""

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Долги с заказов")}</h1>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 md:px-9">
        <OrderDebtFilterButton filters={state.filters} onOpen={() => setFilterOpen(true)} />
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && (
            <button type="button" onClick={() => setPeriodOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
              <CalendarClock className="h-5 w-5" /> {t("Настроить период")}
            </button>
          )}
          <BalanceDownloadMenu
            disabled={!data}
            items={[
              { label: "Список заказов", onClick: () => void download("order") },
              { label: "Скачать все", onClick: () => void download("client") },
            ]}
          />
        </div>
      </section>

      {cards}
      {banner}

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-3 border-t border-[#efefef] px-6 py-3 md:px-9">
          <strong className="whitespace-nowrap">{t("Статистика по должникам")}</strong>
          <div className="flex overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">
            {(
              [
                ["client", "Клиенты"],
                ["order", "Заказы"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchTab(tab)}
                className={`h-8 px-4 text-[13px] font-semibold uppercase tracking-wide ${state.tab === tab ? "bg-[#4f71dc] text-white shadow" : "bg-white text-[#17233b]"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <label className="relative min-w-[160px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[300px]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          {state.filters.withWrongDebt && (
            <span className="flex items-center gap-2 rounded-md bg-[#fff5f5] px-3 py-1 text-[13px] font-semibold text-[#a8071a]">
              {t("Требуется перерасчет")}
              <button type="button" onClick={() => update({ filters: { ...state.filters, withWrongDebt: false }, page: 1 })} className="text-[#4f71dc] hover:underline">
                {t("Сбросить фильтр")}
              </button>
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {isOrders && selectedRows.length > 0 && canEdit && (
              <>
                <span className="font-semibold">
                  {t("Выбрано")}: {selectedRows.length}
                </span>
                {canGroupPay && (
                  <button type="button" onClick={() => setGroupOpen(true)} className="flex h-9 items-center gap-2 rounded-md bg-[rgb(79,113,220)] px-4 font-semibold text-white">
                    <CreditCard className="h-4 w-4" /> {t("Групповая оплата")}
                  </button>
                )}
              </>
            )}
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373] md:px-9">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto pb-10 ${list.loading ? "opacity-60" : ""}`}>{isOrders ? orderTable : clientTable}</div>
      </ExpandedOverlay>

      {filterOpen && (
        <OrderDebtFilterDialog
          filters={state.filters}
          options={options.data}
          config={config}
          onClose={() => setFilterOpen(false)}
          onApply={(filters) => {
            setFilterOpen(false)
            setSelected({})
            update({ filters, page: 1 })
          }}
        />
      )}

      {periodOpen && (
        <OrderDebtPeriodDialog
          config={config}
          onClose={() => setPeriodOpen(false)}
          onSaved={() => {
            setPeriodOpen(false)
            list.reload()
            notify(t("Успешно сохранено"))
          }}
        />
      )}

      {state.detailId && (
        <ClientDebtDetail
          key={state.detailId}
          clientKey={state.detailId}
          name={detailName}
          canEdit={canEdit}
          onClose={() => {
            update({ detailId: "" })
            list.reload()
          }}
          onOpenOrder={(orderId) => update({ orderId })}
          onChanged={list.reload}
          notify={(text) => notify(text)}
        />
      )}

      {state.orderId > 0 && (
        <OrderDebtOrderDialog
          key={state.orderId}
          orderId={state.orderId}
          canEdit={canEdit}
          options={payOptions.data}
          onClose={() => update({ orderId: 0 })}
          onChanged={list.reload}
          notify={(text) => notify(text)}
        />
      )}

      {groupOpen && (
        <OrderGroupPaymentDialog
          rows={selectedRows}
          options={payOptions.data}
          onClose={() => setGroupOpen(false)}
          onSaved={(result) => {
            setGroupOpen(false)
            setSelected({})
            list.reload()
            notify(
              result.failed.length
                ? `${t("Успешно сохранено")}: ${result.results.length}. ${t("Ошибка")}: ${result.failed.map((item) => `№${item.orderId} — ${t(item.error)}`).join("; ")}`
                : t("Успешно сохранено"),
              result.failed.length > 0,
            )
          }}
        />
      )}

      {actClient && (
        <ClientActDialog
          key={actClient.key}
          kind="client"
          entityKey={actClient.key}
          name={actClient.name}
          from="2000-01-01"
          to={data?.stats.today ?? new Date().toISOString().slice(0, 10)}
          onClose={() => setActClient(null)}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[120] max-w-[90vw] -translate-x-1/2 rounded-md px-5 py-3 font-semibold text-white shadow-lg ${notice.error ? "bg-[#e57373]" : "bg-[#48a34b]"}`}
        >
          {notice.text}
        </div>
      )}
    </main>
  )
}
