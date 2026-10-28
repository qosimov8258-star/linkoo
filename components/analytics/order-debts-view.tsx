"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { useRouter } from "next/navigation"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { ClientActDialog } from "@/components/analytics/balance/client-act-dialog"
import { ClientDetail } from "@/components/clients/clients-view"
import { OrderDetailCard } from "@/components/orders/order-detail"
import type { Order } from "@/components/orders/orders-data"
import type { Client } from "@/components/clients/clients-data"
import { ExpandedOverlay } from "@/components/analytics/balance/expanded-view"
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
  OrderDebtFilterDialog,
  countFilters,
  listQuery,
  stateFromParams,
  stateToSearch,
  type OrderDebtState,
} from "@/components/analytics/order-debts-filters"
import { RefHeader } from "@/components/ref/list-kit"
import { RefPager } from "@/components/ref/pager-controls"
import { ScrollButtons } from "@/components/ref/scroll-buttons"
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
import { RefTip } from "@/components/ref/ref-tip"
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
/** The reference prefixes every debtor phone that is not already "+998…" with "+998". */
function debtPhone(phone: string | null | undefined): string {
  const value = (phone ?? "").trim()
  return value && !value.startsWith("+998") ? `+998${value}` : value
}

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
  if (ordering !== sortKey && ordering !== `-${sortKey}`) return null
  return (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#8f8f8f]" aria-hidden>
      <path d={ordering === sortKey ? "M7 14l5-5 5 5z" : "M7 10l5 5 5-5z"} />
    </svg>
  )
}

function DownloadMenu({ items, disabled }: { items: Array<{ label: string; onClick: () => void }>; disabled: boolean }) {
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
      <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="flex h-[34px] items-center rounded-[5px] bg-[#71ce87] pl-[12px] text-[13px] font-semibold text-white disabled:opacity-50">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white"><path d="M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z" /></svg>
        <span className="px-[12px]">{t("Скачать")}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[40px] z-[60] w-[168px] rounded-[8px] bg-white py-[4px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className="block h-12 w-full px-[16px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DebtValue({ value }: { value: number }) {
  return <span style={{ color: Math.abs(value) > 0.005 ? "#e27676" : undefined, fontWeight: Math.abs(value) > 0.005 ? 600 : 400 }}>{formatMoney(value, 3)}</span>
}

export function OrderDebtsView() {
  const tableScroll = useRef<HTMLDivElement>(null)
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
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
  // The reference opens the client card (right panel) from an order row; the balance act stays on the clients tab.
  const [panelClient, setPanelClient] = useState<Client | null>(null)
  const [orderDialog, setOrderDialog] = useState<Order | null>(null)
  const openOrderDialog = (id: number) =>
    fetch(`/api/orders/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Order>) : null))
      .then((order) => order && setOrderDialog(order))
      .catch(() => {})
  const openClientPanel = (id: number) =>
    fetch(`/api/clients/${id}`)
      .then((response) => (response.ok ? (response.json() as Promise<Client>) : null))
      .then((client) => client && setPanelClient(client))
      .catch(() => {})
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
  // The demo lists the currencies by name: Euro, SUM, USD.
  const orderedCodes = [...codes].sort((a, b) => currencyLabel(a).localeCompare(currencyLabel(b)))
  const cardWidths = ["299.6px", "299.7px", "299.6px", "316.7px", "1fr"]
  const counterLink = "text-[15px] font-normal leading-5 text-[#129fdd] hover:underline"
  const cards = (
    <section className={`grid select-none px-[30px] pt-[14px] ${list.loading ? "opacity-60" : ""}`} style={{ gridTemplateColumns: cardWidths.join(" ") }}>
      {DEBT_BUCKETS.map((bucket) => (
        <div key={bucket} className="min-w-0">
          <span className="block h-[17.3px] text-[13px] leading-[17.3px] text-[#666]">{bucketTitle(bucket)}</span>
          {orderedCodes
            .filter((code) => (stats?.amounts[code]?.[bucket] ?? 0) > 0.005)
            .map((code) => (
              <div key={code} className="h-[18.75px] text-[15px] font-semibold leading-[18.75px]" style={{ color: BUCKET_COLORS[bucket] }}>
                {formatMoney(stats!.amounts[code][bucket], 2)} {currencyLabel(code)}
              </div>
            ))}
          <div className="-mt-[0px] flex h-[18.75px] items-center overflow-visible text-[15px] font-semibold text-[#333]">
            <button type="button" onClick={() => showBucketOrders(bucket, true)} className={counterLink} title={t("Заказов обработано")}>
              {stats?.expect[bucket] ?? 0}
            </button>
            <span className="mx-[5px]">/</span>
            <button type="button" onClick={() => showBucketOrders(bucket, false)} className={counterLink}>
              {stats?.debtors[bucket] ?? 0}
            </button>
            <span className="ml-[4px] text-[13px] font-normal text-[#666]">{t("Заказов обработано")}</span>
          </div>
        </div>
      ))}
      <div className="min-w-0">
        <span className="block h-[17.3px] text-[13px] leading-[17.3px] text-[#666]">{t("Общий долг")}</span>
        {orderedCodes
          .filter((code) => (stats?.amounts[code]?.total ?? 0) > 0.005)
          .map((code) => (
            <div key={code} className="h-[18.75px] text-[15px] font-semibold leading-[18.75px]" style={{ color: BUCKET_COLORS.total }}>
              {formatMoney(stats!.amounts[code].total, 2)} {currencyLabel(code)}
            </div>
          ))}
      </div>
    </section>
  )

  const banner =
    stats && stats.wrongDebtClientCount > 0 ? (
      <div className="mx-[30px] mt-[15px] flex h-[44px] items-center justify-between rounded-[10px] border-l-[5px] border-[#e54848] bg-[#fff5f5] pl-[8px] pr-[9px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <h3 className="flex items-center gap-[4px] text-[14px] font-semibold leading-[19.6px] text-[#a8071a]">
          {t("Требуется перерасчет долгов клиентов:")}
          <button type="button" onClick={() => update({ filters: { ...state.filters, withWrongDebt: true }, page: 1, tab: "client" })} className="font-semibold text-[#129fdd] hover:underline">
            {stats.wrongDebtClientCount} {t("шт.")}
          </button>
          {t("Долги этих клиентов исключены из итогов")}
        </h3>
        {canEdit && (
          <button type="button" disabled={recalcBusy} onClick={() => void recalcAll()} className="h-[30px] w-[116.8px] rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white disabled:opacity-60">
            {recalcBusy ? t("Загрузка...") : t("Пересчитать")}
          </button>
        )}
      </div>
    ) : null

  const selectedRows = Object.values(selected)

  const hasSelection = isOrders && canEdit && selectedRows.length > 0
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
  // The demo shows "08 сент. 2026" for dates and "07 сент. 20:03" for creation times (no year).
  const dateCell = (iso: string) => (iso ? formatRuDate(iso, false, language) : "")
  const timeCell = (iso: string) => {
    if (!iso) return ""
    if (language !== "ru" || iso.length < 16) return formatRuDate(iso, true, language)
    return `${formatRuDate(iso, false, language).replace(/\s\d{4}$/, "")} ${iso.slice(11, 16)}`
  }

  const headBase = "relative border-r border-[#efefef] bg-[#f0f4f9] px-[5px] text-center align-middle text-[13px] font-semibold leading-[18px] text-[#374557]"
  const cellBase = "border-r border-[#efefef] pl-[5px] pr-0 py-[7.5px] align-middle text-[13px] leading-[16.25px] text-[#333]"
  // Like the reference, a ticked row keeps its zebra colour.
  const rowBackground = (index: number, _active = false) => (index % 2 ? "#f4f8fb" : "#ffffff")
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center justify-center gap-[2px] font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const empty = (columns: number) => (
    <tr>
      <td colSpan={columns} className="h-[200px] bg-[#fff] text-center text-[13px] text-[#999]">
        {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
      </td>
    </tr>
  )

  const CLIENT_INFO_WIDTHS = [140, 200, 100, 200, 100]
  const clientTable = (
    <table className="table-fixed border-collapse" style={{ width: 220 + GROUPS.length * Math.max(1, codes.length) * 90 + 740 }}>
      <colgroup>
        <col style={{ width: 220 }} />
        {GROUPS.flatMap((group) => codes.map((code) => <col key={`${group}.${code}`} style={{ width: 90 }} />))}
        {CLIENT_INFO_WIDTHS.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <thead className="shadow-[0_2px_4px_rgba(0,0,0,0.12)]">
        <tr className="h-[30px]">
          <th className={headBase} />
          {GROUPS.map((group) => (
            <th key={group} colSpan={Math.max(1, codes.length)} className={headBase}>
              {bucketTitle(group)}
            </th>
          ))}
          <th colSpan={INFO_COLUMNS.length} className={headBase}>
            {t("Дополнительная информация")}
          </th>
        </tr>
        <tr className="h-[29px]">
          <th className={headBase}>{sortHeader("name", t("Клиенты"))}</th>
          {GROUPS.flatMap((group) =>
            codes.map((code) => (
              <th key={`${group}.${code}`} className={headBase}>
                {sortHeader(`${group}.${code}`, currencyLabel(code))}
              </th>
            )),
          )}
          {INFO_COLUMNS.map((column) => (
            <th key={column.key} className={headBase}>
              {sortHeader(column.key, t(column.label))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {clientRows.map((row: OrderDebtClientRow, index) => {
          const background = rowBackground(index)
          const cell = `${cellBase} h-[31.3px] py-0`
          return (
            <tr key={row.key} style={{ background }}>
              <td className={cell}>
                <button type="button" onClick={() => openDetail(row.key)} className="flex w-full items-center justify-between gap-2 pr-[5px] text-left text-[#333]">
                  <span className="truncate">{row.name || t("Не указано")}</span>
                </button>
              </td>
              {GROUPS.flatMap((group) =>
                codes.map((code) => (
                  <td key={`${group}.${code}`} className={cell}>
                    <DebtValue value={row.currencies[code]?.[group as keyof BucketAmounts] ?? 0} />
                  </td>
                )),
              )}
              {INFO_COLUMNS.map((column) => {
                const text = column.key === "phone" ? debtPhone(row.phone) : row[column.key]
                return (
                  <td key={column.key} className={`${cell} truncate`} title={text}>
                    {text || ""}
                  </td>
                )
              })}
            </tr>
          )
        })}
        {!clientRows.length && empty(1 + GROUPS.length * Math.max(1, codes.length) + INFO_COLUMNS.length)}
      </tbody>
    </table>
  )

  const ORDER_WIDTHS = [70, ...(canEdit ? [30] : []), 100, 100, 100, 100, 100, 200, ...codes.map(() => 100), 100, 100, 100, 102]
  const orderTable = (
    <table className="table-fixed border-collapse" style={{ width: ORDER_WIDTHS.reduce((sum, width) => sum + width, 0) }}>
      <colgroup>
        {ORDER_WIDTHS.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <thead className="shadow-[0_2px_4px_rgba(0,0,0,0.12)]">
        <tr className="h-[47px]">
          <th className={headBase}>{sortHeader("id", t("Заказ №"))}</th>
          {canEdit && (
            <th className={headBase}>
              <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-[13px] w-[13px] align-middle accent-[#5d6474]" />
            </th>
          )}
          <th className={headBase}>{sortHeader("client", t("Клиент"))}</th>
          <th className={headBase}>{sortHeader("passed_days", t("Прошло дней"))}</th>
          <th className={headBase}>{sortHeader("total", t("Сумма заказа"))}</th>
          <th className={headBase}>{sortHeader("remaining", t("Долг"))}</th>
          <th className={headBase}>{sortHeader("payment_date", t("Срок оплаты"))}</th>
          <th className={headBase}>{sortHeader("agent", t("Агент"))}</th>
          {codes.map((code) => (
            <th key={code} className={headBase}>
              {sortHeader(`client_debt.${code}`, `${t("Общий долг")} (${currencyLabel(code)})`)}
            </th>
          ))}
          <th className={headBase}>{sortHeader("delivery_man", t("Доставщик"))}</th>
          <th className={headBase}>{sortHeader("realization", t("Дата реализации"))}</th>
          <th className={headBase}>{sortHeader("delivery", t("Дата доставки"))}</th>
          <th className={headBase}>{sortHeader("created", t("Дата создания"))}</th>
        </tr>
      </thead>
      <tbody>
        {orderRows.map((row, index) => {
          const background = rowBackground(index, Boolean(selected[row.key]))
          const cell = `${cellBase} h-[34px]`
          return (
            <tr key={row.key} style={{ background }}>
              <td className={cell}>
                <button type="button" onClick={() => void openOrderDialog(row.orderId)} className="cursor-pointer text-left">
                  {row.orderId}
                </button>
              </td>
              {canEdit && (
                <td className={`${cell} text-center`}>
                  <input type="checkbox" checked={Boolean(selected[row.key])} onChange={() => toggleRow(row)} aria-label={`№ ${row.orderId}`} className="h-[13px] w-[13px] align-middle accent-[#5d6474]" />
                </td>
              )}
              <td className={cell}>
                <button
                  type="button"
                  onClick={() => (row.client.id !== null ? openClientPanel(row.client.id) : openDetail(row.client.key))}
                  className="break-words text-left text-[#4f71dc]"
                >
                  {row.client.name || t("Не указано")}
                </button>
              </td>
              <td className={cell}>{row.passedDays}</td>
              <td className={cell}>
                {formatMoney(row.total, 2)} {currencyLabel(row.currency)}
              </td>
              <td className={`${cell} font-semibold text-[#e27676]`}>-{formatMoney(row.remaining, 2)}</td>
              <td className={cell}>
                <button type="button" onClick={() => update({ orderId: row.orderId })} className="text-left text-[#4f71dc]">
                  {dateCell(row.paymentDate)}
                </button>
              </td>
              <td className={cell}>{row.agent}</td>
              {codes.map((code) => {
                const debt = formatMoney(row.clientDebt[code] ?? 0, 2)
                // Like the reference: long totals are cut to 12 characters and the full number shows in a tooltip.
                return (
                  <td key={code} className={`${cell} font-semibold text-[#e27676]`}>
                    {debt.length > 12 ? (
                      <RefTip text={debt} side="bottom">
                        {`${debt.slice(0, 12)}...`}
                      </RefTip>
                    ) : (
                      debt
                    )}
                  </td>
                )
              })}
              <td className={cell}>{row.deliveryMan}</td>
              <td className={cell}>{dateCell(row.realizationDate)}</td>
              <td className={cell}>{dateCell(row.deliveryDate)}</td>
              <td className={cell}>{timeCell(row.createdAt)}</td>
            </tr>
          )
        })}
        {!orderRows.length && empty(ORDER_WIDTHS.length)}
      </tbody>
    </table>
  )

  const detailName = clientRows.find((row) => row.key === state.detailId)?.name ?? orderRows.find((row) => row.client.key === state.detailId)?.client.name ?? ""
  const toggleButton = (active: boolean) =>
    `h-8 min-w-[70px] whitespace-nowrap rounded-[5px] px-4 pt-[1px] text-[13px] font-normal uppercase ${active ? "bg-[#4f71dc] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"}`
  const headerButton = "flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-[12px] text-[13px] font-semibold text-white"
  const filterCount = countFilters(state.filters)
  const scope = [...state.filters.division, ...state.filters.branch]
  const lastPage = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data?.count ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(state.page * state.pageSize, data?.count ?? 0)

  return (
    <main className="min-h-screen bg-white font-sans text-[13px] text-[#333]">
      <div className="border-b border-[#dde1e5] bg-[#f2f5f8] pl-[30px] pr-[30px]">
        <RefHeader title={t("Долги с заказов")} />
      </div>

      <section className="flex h-[34px] items-center justify-between px-[30px] mt-[20px]">
        <div className="flex items-center">
          <button type="button" onClick={() => setFilterOpen(true)} className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[12px] text-[13px] font-semibold text-white">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" /></svg>
            <span className="px-[12px]">
              {t("Фильтр")}
              {filterCount > 0 && ` / ${filterCount}`}
            </span>
          </button>
          <span className="ml-[14px] text-[13px] font-semibold text-[#4f71dc]">{scope.length ? scope.join(" ") : t("Во всей организации")}</span>
        </div>
        <div className="flex items-center gap-[8px]">
          {isOrders && (
            <button type="button" onClick={() => router.push("/clients/territory")} className={headerButton}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" /></svg>
              <span className="px-[12px]">{t("Показать на карте")}</span>
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => setPeriodOpen(true)} className={headerButton}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" /></svg>
              <span className="px-[12px]">{t("Настроить период")}</span>
            </button>
          )}
          <DownloadMenu
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
        <section className="mt-[10px] flex h-[51px] items-center border-t border-[#efefef] px-[30px]">
          <strong className={`${hasSelection ? "w-[292.5px]" : "w-[392.5px]"} shrink-0 text-[13px] font-semibold leading-[16.25px]`}>{t("Статистика по должникам")}</strong>
          <div className="flex">
            {(
              [
                ["client", "Клиенты"],
                ["order", "Заказы"],
              ] as const
            ).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => switchTab(tab)} className={toggleButton(state.tab === tab)}>
                {t(label)}
              </button>
            ))}
          </div>
          <label className={`relative ${hasSelection ? "ml-[119px]" : "ml-[218px]"} block h-[32px] w-[180px] border-b border-[#e0e0e0]`}>
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-[30px] w-full bg-transparent pr-7 text-[13px] outline-none placeholder:text-black/30"
            />
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[4px] h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </label>
          {state.filters.withWrongDebt && (
            <span className="ml-[16px] flex items-center gap-2 rounded-[5px] bg-[#fff5f5] px-3 py-1 text-[13px] font-semibold text-[#a8071a]">
              {t("Требуется перерасчет")}
              <button type="button" onClick={() => update({ filters: { ...state.filters, withWrongDebt: false }, page: 1 })} className="text-[#129fdd] hover:underline">
                {t("Сбросить фильтр")}
              </button>
            </span>
          )}
          {/* POST /api/order-debts/group-payment needs cash.manage: hide the button without it. */}
          {hasSelection && canGroupPay && (
            <button type="button" onClick={() => setGroupOpen(true)} className="ml-[120px] flex h-[30px] w-[172px] items-center justify-center gap-[7px] rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" /></svg>
              {t("Групповая оплата")}
            </button>
          )}
          <div className="ml-auto flex items-center text-[#5d6474]">
            <RefPager
              pageSize={state.pageSize}
              onPageSize={(size) => update({ page: 1, pageSize: size })}
              from={from}
              to={to}
              total={data?.count ?? 0}
              page={Math.min(state.page, lastPage)}
              pageCount={lastPage}
              onPage={(page) => update({ page })}
            />
            <RefTip text={t("Расширенный вид")} side="left" className="h-9 w-[46px] items-center justify-end pl-[16px] pr-[6px]">
              <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? t("Обычный вид") : t("Расширенный вид")} className="flex h-6 w-6 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={expanded ? "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" : "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"} /></svg>
              </button>
            </RefTip>
          </div>
        </section>

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-[30px] py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f71dc] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div ref={tableScroll} className={`overflow-x-auto pb-10 ${list.loading ? "opacity-60" : ""}`}>{isOrders ? orderTable : clientTable}</div>
        <ScrollButtons targetRef={tableScroll} watch={`${isOrders}-${list.loading}`} />
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

      {orderDialog && (
        <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-black/[0.54] pt-[16px]" onMouseDown={(event) => event.target === event.currentTarget && setOrderDialog(null)}>
          {/* The reference shows the order card read-only: the title and a close button replace the card's action bar. */}
          <div className="relative mb-[16px] w-[1200px] max-w-[calc(100vw-32px)] [&>div>div:first-child>div]:hidden [&>div>div:first-child>h2]:hidden [&_.w-1\/3:last-child>div]:hidden [&>div]:shadow-none [&>div>div:first-child]:h-[60px]">
            <OrderDetailCard
              order={orderDialog}
              onUpdate={() => {}}
              refreshOrder={(id) => void openOrderDialog(id)}
              onNavigate={(href) => router.push(href)}
              onNotify={notify}
            />
            <h2 className="absolute left-[30px] top-0 flex h-[60px] items-center text-[13px] font-bold uppercase text-[#333]">
              {t("Заказ")} № {orderDialog.id}
            </h2>
            <button type="button" aria-label={t("Закрыть")} onClick={() => setOrderDialog(null)} className="absolute right-[10px] top-[6px] flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
            </button>
          </div>
        </div>
      )}

      {panelClient && (
        <ClientDetail
          client={panelClient}
          onClose={() => setPanelClient(null)}
          onEdit={() => router.push(`/clients?openShop=${panelClient.id}&openUpdateDialog=true`)}
          onDelete={() => router.push(`/clients?openShop=${panelClient.id}`)}
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
