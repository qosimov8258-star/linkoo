"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"

import { LOG_ACTIONS, LOG_STATUS, LogDetailsSheet, StatusIcon, formatLogDate, type ApiOrderLog, type OrderLineItem } from "@/components/orders/order-detail"
import type { Order } from "@/components/orders/orders-data"
import { useCashRates } from "@/components/analytics/cash-management-shared"
import { RefTip } from "@/components/ref/ref-tip"
import { convertAmount, currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate, parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's read-only order dialog of ?orderDetails=<order id> («ЗАКАЗ № 1529»), opened over a page and the shop drawer
// (Финансы → Старые долги, the drawer's ЗАДАЧИ «Просмотреть»): a 340 px column with the order (Клиент, Инициатор, Дата
// создания, Организация, Номер договора), БАЛАНС (Прайс-лист … Общий долг клиента) and ИСПОЛНЕНИЕ (Дата реализации …
// Дата доставки), and three tabs: Список товаров, Возврат and Логи (Linko keeps the tab in ?orderTab=return|logs and
// loads a tab's rows when it is opened). Nothing here writes.

type Tab = "productList" | "return" | "logs"
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "productList", label: "Список товаров" },
  { key: "return", label: "Возврат" },
  { key: "logs", label: "Логи" },
]

/** Paid / remaining per currency: GET /api/cash/orders/[id], or the debts model's parts (below). */
type OrderDue = { currencies: Array<{ currency: string; total: number; paid: number; remaining: number }> }
/** GET /api/order-debts/orders/[id]?optional=1 (null for an order outside the debts model). */
type DebtDetail = { order?: { clientBalance?: Record<string, number> }; parts?: Array<{ currency: string; total: number; balance: number }> }
/** A client return of the order (GET /api/client-returns?orderId=). */
type ReturnRow = { id: number; returnDate: string; status: string; warehouse: string; amount: number; currency: string; comment?: string }
/** GET /api/orders/[id] adds the shop's ledger debt (one line per currency). */
type OrderWithDebt = Order & { clientDebt?: { actual: string } | null }

const STATUS_VIEW: Record<string, { label: string; color: string }> = {
  "В процессе": { label: "Запрос отправлен", color: "#f0ad4e" },
  "Есть на складе": { label: "Есть на складе", color: "#f0ad4e" },
  "В пути": { label: "Передан доставщику", color: "#f0ad4e" },
  Доставлено: { label: "Доставлен", color: "#81c784" },
  Отменен: { label: "Отменен", color: "#e57373" },
  "Не подтвержден": { label: "Не подтвержден", color: "#999" },
}

/** Prices, sums, quantities and payments: Linko's numberFormat with its default precision (3 decimals, or those of
 * Настройки → Округление сумм when set: formatMoney). */
const number = (value: number) => formatMoney(value)
/** A line's price after its discount (the stored price is the one before it). */
const salePrice = (item: OrderLineItem) => item.unitPrice * (1 - item.discountPercent / 100)
/** What the discount takes off the line (0 for a bonus line, given for free). */
const lineDiscount = (item: OrderLineItem) => (item.isBonus ? 0 : item.quantity * item.unitPrice - item.lineTotal)

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

function readTab(): Tab {
  if (typeof window === "undefined") return "productList"
  const value = new URLSearchParams(window.location.search).get("orderTab")
  return value === "return" || value === "logs" ? value : "productList"
}

/** ?orderTab= of the open tab (none for Список товаров), without a new history entry. */
function writeTab(tab: Tab) {
  const params = new URLSearchParams(window.location.search)
  if (tab === "productList") params.delete("orderTab")
  else params.set("orderTab", tab)
  const search = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
}

// The dotted rows of Linko's lists (60 px, a dotted rule under each).
const DOTTED = "flex min-h-[60px] items-center border-b-2 border-dotted border-[#d9e0e5] py-[5px] pl-[5px] text-[13px] text-[#333]"

export function OrderDetailsDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [order, setOrder] = useState<OrderWithDebt | null>(null)
  const [error, setError] = useState("")
  const [items, setItems] = useState<OrderLineItem[] | null>(null)
  const [due, setDue] = useState<OrderDue | null>(null)
  // «Общий долг клиента»: the balance of the financial account the order is booked on (the debts list's «Общий долг»
  // per currency), which Linko prints as one sum in the main currency at today's rates (its total_balance_client).
  const [accountDebt, setAccountDebt] = useState<Record<string, number> | null>(null)
  const { base, rates } = useCashRates()
  const [tab, setTabState] = useState<Tab>(readTab)
  const [returns, setReturns] = useState<ReturnRow[] | null>(null)
  const [logs, setLogs] = useState<ApiOrderLog[] | null>(null)
  const [logDetails, setLogDetails] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    void getJson<OrderWithDebt>(`/api/orders/${orderId}`, signal).then((body) => {
      if (signal.aborted) return
      if (body && typeof body.id === "number") setOrder(body)
      else setError("Не удалось загрузить данные")
    })
    void getJson<OrderLineItem[]>(`/api/orders/${orderId}/items`, signal).then((body) => !signal.aborted && setItems(Array.isArray(body) ? body : []))
    // «Оплачено» / «Остаток» are Linko's total_paid / total_balance: the debts model's remainder of the order (the same
    // as the debts list's «Долг»), paid = total − remainder. An order outside that model keeps the cash core's numbers.
    void getJson<DebtDetail | null>(`/api/order-debts/orders/${orderId}?optional=1`, signal).then(async (body) => {
      if (signal.aborted) return
      setAccountDebt(body?.order?.clientBalance ?? {})
      const parts = body?.parts ?? []
      if (parts.length) {
        const round = (value: number) => Math.round(value * 1e6) / 1e6
        setDue({ currencies: parts.map((part) => ({ currency: part.currency, total: part.total, paid: round(part.total - part.balance), remaining: round(part.balance) })) })
        return
      }
      const cash = await getJson<OrderDue>(`/api/cash/orders/${orderId}`, signal)
      if (!signal.aborted) setDue(cash ?? { currencies: [] })
    })
    return () => controller.abort()
  }, [orderId])

  // Linko asks for a tab's rows when the tab is opened.
  useEffect(() => {
    const controller = new AbortController()
    if (tab === "return" && returns === null) {
      void getJson<{ rows: ReturnRow[] }>(`/api/client-returns?orderId=${orderId}`, controller.signal).then((body) => !controller.signal.aborted && setReturns(body?.rows ?? []))
    }
    if (tab === "logs" && logs === null) {
      void getJson<ApiOrderLog[]>(`/api/orders/${orderId}/logs`, controller.signal).then((body) => !controller.signal.aborted && setLogs(Array.isArray(body) ? body : []))
    }
    return () => controller.abort()
  }, [tab, orderId, returns, logs])

  const setTab = (next: Tab) => {
    setTabState(next)
    writeTab(next)
  }
  const close = useCallback(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("orderTab")) writeTab("productList")
    onClose()
  }, [onClose])

  /** "08 мая 2026" of an ISO day or of a stored day text (an unreadable text is shown as it is). */
  const day = (value: string | null | undefined) => {
    if (!value) return ""
    const iso = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : parseAnyDay(value)
    return iso ? formatStatementDate(iso, language, false) : value
  }
  const currency = order ? order.currency || order.amount.trim().split(/\s+/).pop() || "" : ""
  const dueLine = (pick: "paid" | "remaining") =>
    due?.currencies.length ? due.currencies.map((entry) => `${number(entry[pick])} ${currencyLabel(entry.currency)}`).join(", ") : `0 ${currencyLabel(currency)}`.trim()
  const remains = due?.currencies.some((entry) => entry.remaining > 0) ?? false

  const debtEntries = Object.entries(accountDebt ?? {})
  // null while a rate is unknown (then each currency is shown on its own line).
  const debtTotal = debtEntries.reduce<number | null>((sum, [code, value]) => {
    const converted = convertAmount(value, code, base, rates)
    return sum === null || converted === null ? null : sum + converted
  }, 0)
  const debtLine = (code: string, value: number) => `${formatMoney(value)} ${currencyLabel(code)}`
  const debtSpan = (code: string, value: number) => (
    <span key={code} className={`block truncate ${value < 0 ? "text-[#e57373]" : "text-[#81c784]"}`} title={debtLine(code, value)}>
      {debtLine(code, value)}
    </span>
  )
  const debtNode =
    accountDebt === null ? (
      "…"
    ) : debtEntries.length ? (
      debtTotal !== null ? debtSpan(base, debtTotal) : debtEntries.filter(([, value]) => Math.abs(value) > 0.000005).map(([code, value]) => debtSpan(code, value))
    ) : order?.clientDebt?.actual ? (
      // An order outside the debts model (cancelled, not handed over): the shop's own ledger debt.
      order.clientDebt.actual.split(/,\s+/).map((line) => (
        <span key={line} className={`block truncate ${line.trim().startsWith("-") ? "text-[#e57373]" : "text-[#81c784]"}`} title={line}>
          {line}
        </span>
      ))
    ) : (
      <span className="text-[#81c784]">{`0 ${currencyLabel(currency)}`}</span>
    )

  const row = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex min-h-[25px] items-start justify-between gap-[10px] leading-[25px]">
      <span className="shrink-0">{label}</span>
      <span className={`min-w-0 truncate text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )
  const section = (title: string | null, children: ReactNode, last = false) => (
    <div className={`px-[30px] py-[15px] ${last ? "" : "border-b border-[#efefef]"}`}>
      {title && <div className="mb-[10px] text-[13px] font-semibold uppercase leading-[16.25px]">{t(title)}</div>}
      <ul>{children}</ul>
    </div>
  )

  const status = order ? (STATUS_VIEW[order.status] ?? { label: order.status, color: "#f0ad4e" }) : null
  const payKind = order ? order.paymentType || order.payMethod || "cash" : "cash"
  const deliveryType = order ? (order.deliveryType === "self" ? "Самовывоз" : order.deliveryType === "delivery" ? "Доставка" : order.deliveryType || "") : ""
  const realizedDay = order ? order.acceptedDate || (order.shippedAt ? parseAnyDay(order.shippedAt, true) : null) || "" : ""
  const createdDay = order?.createdAt ? parseAnyDay(order.createdAt, true) : null
  const shopName = order ? order.marketName || order.client : ""
  const warehouse = order ? order.warehouse || order.stockName || "" : ""

  const left = order && (
    <div className="w-[340px] shrink-0 border-r border-[#efefef]">
      {section(
        null,
        <>
          <li className="flex min-h-[25px] items-start justify-between gap-[10px] leading-[25px]">
            <span className="shrink-0">{t("Клиент")}:</span>
            <span className="min-w-0 truncate text-right font-semibold">
              {order.clientId ? (
                <a
                  href={`/clients?${new URLSearchParams({ openShop: String(order.clientId), search: shopName })}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={order.client}
                  className="whitespace-nowrap text-[#129fdd]"
                >
                  {shopName}
                </a>
              ) : (
                shopName
              )}
            </span>
          </li>
          {row(`${t("Инициатор")}:`, order.agent || order.createdBy || t("Не указан"))}
          {row(t("Дата создания"), createdDay ? day(createdDay) : order.created)}
          {row(`${t("Организация")}:`, order.organization || t("Не указано"))}
          {row(`${t("Номер договора")}:`, order.contract || order.invoiceContract || t("Не указан"))}
        </>,
      )}
      {section(
        "Баланс",
        <>
          {row(`${t("Прайс-лист")}:`, order.priceList || t("Не указан"))}
          {row(`${t("Дата окончательной оплаты")}:`, day(order.paymentDate || order.dueDate))}
          {row(`${t("Тип оплаты")}:`, t(payKind === "bank" ? "Перечислением" : "Наличными"))}
          {row(t("Общая стоимость"), order.amount)}
          {row(`${t("Оплачено")}:`, due ? dueLine("paid") : "…")}
          {row(`${t("Остаток")}:`, due ? dueLine("remaining") : "…", due ? (remains ? "text-[#e57373]" : "text-[#81c784]") : "")}
          <li className="flex min-h-[25px] items-start justify-between gap-[10px] leading-[25px]">
            <span className="shrink-0">{t("Общий долг клиента")}:</span>
            <span className="min-w-0 text-right font-semibold">{debtNode}</span>
          </li>
        </>,
      )}
      {section(
        "Исполнение",
        <>
          {row(`${t("Дата реализации")}:`, realizedDay ? day(realizedDay) : t("Не реализовано"))}
          {status && row(`${t("Текущий статус")}:`, <span style={{ color: status.color }}>{t(status.label)}</span>)}
          {row(`${t("Доставщик")}:`, order.deliveryMan || t("Не указан"))}
          {row(`${t("Тип передачи")}:`, deliveryType ? t(deliveryType) : t("Не указано"))}
          {order.delivery && row(`${t("Дата доставки")}:`, day(order.delivery))}
        </>,
        true,
      )}
    </div>
  )

  const code = currencyLabel(currency)
  // Linko's returned quantity: a red badge between the quantity and the unit («10 [-5] Dona»), hinted on the lines.
  const returnBadge = (value: number, hint: boolean) => {
    const badge = <span className="mx-[3px] inline-flex rounded-[2px] bg-[#ff9393] px-[6px] font-semibold text-white">-{number(value)}</span>
    return hint ? (
      <RefTip text={t("Количество возврата")} side="bottom" className="font-semibold">
        {badge}
      </RefTip>
    ) : (
      badge
    )
  }
  // The lines scroll inside 500 px; «Итого» stays under them.
  const productList = (
    <>
      <div className="max-h-[500px] overflow-y-auto pr-[30px]">
        <div className={`${DOTTED} -mx-[8px] font-semibold`}>
          <div className="w-1/3 px-[8px]">{t("Товар")}</div>
          <div className="w-1/6 px-[8px] text-right">{t("Количество")}</div>
          <div className="w-1/6 px-[8px] text-right">{`${t("Цена")} (${code})`}</div>
          <div className="w-1/6 px-[8px] text-right">{`${t("Сумма")} (${code})`}</div>
          <div className="w-1/6 px-[8px] text-right">{`${t("Скидка")} (${code})`}</div>
        </div>
        {items === null ? (
          <p className="py-6 text-center text-[#888]">{t("Загрузка...")}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className={`${DOTTED} -mx-[8px]`}>
              <div className="w-1/3 px-[8px]">
                {item.productName}
                {item.isBonus && <strong className="font-semibold text-[#81c784]"> ({t("бонус")})</strong>}
                {warehouse && <strong className="font-semibold"> ({warehouse})</strong>}
              </div>
              <div className="w-1/6 px-[8px] text-right">
                {number(item.quantity)}
                {(item.returnQuantity ?? 0) > 0 && returnBadge(item.returnQuantity ?? 0, true)}
                {t(item.unit)}
              </div>
              <div className="w-1/6 px-[8px] text-right">{number(salePrice(item))}</div>
              <div className="w-1/6 px-[8px] text-right">{number(item.lineTotal)}</div>
              <div className="w-1/6 px-[8px] text-right">{number(lineDiscount(item))}</div>
            </div>
          ))
        )}
      </div>
      {items && items.length > 0 && (
        <div className="-mx-[8px] mt-[20px] flex pl-[5px] pr-[30px] text-[13px] font-semibold leading-[16.25px]">
          <div className="w-1/3 px-[8px]">{t("Итого")}:</div>
          <div className="w-1/6 px-[8px] text-right">
            {/* Quantities add up per unit (never one sum over kilograms and pieces). */}
            {[...new Set(items.map((item) => item.unit))].map((unit) => {
              const lines = items.filter((item) => item.unit === unit)
              const qty = lines.reduce((sum, item) => sum + item.quantity, 0)
              const ret = lines.reduce((sum, item) => sum + (item.returnQuantity ?? 0), 0)
              return (
                <span key={unit} className="block">
                  {number(qty)}
                  {ret > 0 && returnBadge(ret, false)}
                  {t(unit)}
                </span>
              )
            })}
          </div>
          <div className="w-1/6 px-[8px]" />
          <div className="w-1/6 px-[8px] text-right">{number(items.reduce((sum, item) => sum + item.lineTotal, 0))}</div>
          <div className="w-1/6 px-[8px] text-right">{number(items.reduce((sum, item) => sum + lineDiscount(item), 0))}</div>
        </div>
      )}
    </>
  )

  const robot = (text: string) => (
    <div className="flex flex-col items-center pb-[56px] pt-[40px] text-[#666]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[150px]" />
      <span className="-mt-[40px]">{text}</span>
    </div>
  )

  const returnsList =
    returns === null ? (
      <p className="py-6 text-center text-[#888]">{t("Загрузка...")}</p>
    ) : returns.length === 0 ? (
      robot(t("В данном заказе нет возвратов"))
    ) : (
      <div className="pr-[20px]">
        <div className={`${DOTTED} grid grid-cols-[3fr_3fr_2fr_3fr_1fr] font-semibold [&>*]:pr-[22px]`}>
          <span>{t("Причина возврата")}</span>
          <span>{t("Склад")}</span>
          <span className="text-right">{t("Дата возврата")}</span>
          <span className="text-right">{`${t("Сумма")} (${code})`}</span>
          <span />
        </div>
        {returns.map((entry) => (
          // Like the order card's «Возврат», a row opens the return in a new tab.
          <a key={entry.id} href={`/analytics/returns/${entry.id}?search=${entry.id}`} target="_blank" rel="noopener noreferrer" className={`${DOTTED} grid grid-cols-[3fr_3fr_2fr_3fr_1fr] hover:bg-[#fafafa] [&>*]:pr-[22px]`}>
            <span className="truncate">{entry.comment ?? ""}</span>
            <span className="truncate">{entry.warehouse}</span>
            <span className="text-right">{day(entry.returnDate)}</span>
            <span className="text-right">{number(entry.amount)}</span>
            <span className={`text-right ${entry.status === "accepted" ? "text-[#81c784]" : entry.status === "cancelled" ? "text-[#e57373]" : "text-[#f0ad4e]"}`}>
              {t(entry.status === "accepted" ? "Принят" : entry.status === "cancelled" ? "Отменен" : "Ожидает")}
            </span>
          </a>
        ))}
      </div>
    )

  const logsList =
    logs === null ? (
      <p className="py-6 text-center text-[#888]">{t("Загрузка...")}</p>
    ) : (
      <div>
        <div className="mt-[10px] flex justify-end">
          <button type="button" onClick={() => setLogDetails(true)} className="mr-[38px] flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white">
            {t("Детали изменений заказа")}
          </button>
        </div>
        <div className="flex flex-col pr-[30px] pt-[15px]">
          {logs.map((log) => {
            const action = LOG_ACTIONS[log.action]
            const logStatus = LOG_STATUS[log.status]
            const tone = action?.tone === "begin" ? "border-[#64b5f6] text-[#64b5f6]" : action?.tone === "error" ? "border-[#e57373] text-[#e57373]" : "border-[#81c784] text-[#81c784]"
            return (
              <div key={log.id} className="mb-5 grid grid-cols-2 gap-y-[7px] rounded-[10px] border border-[#e5e8f1] bg-[#fbfbfb] p-5 [&_p]:leading-[26px]">
                <div className="flex">
                  <div className="flex items-center">
                    <span className="font-semibold">{t("Заказ")}:</span>
                    {action ? (
                      <span className="whitespace-nowrap px-[7px] py-px">
                        <span className={`whitespace-nowrap rounded-[15px] border px-[7px] py-px ${tone}`}>{t(action.label)}</span>
                      </span>
                    ) : (
                      t("Не установлен")
                    )}
                  </div>
                  {logStatus && (
                    <div className="ml-[10px] flex items-center">
                      <span className="font-semibold">{t("Статус")}:</span>
                      <span className="flex h-[33px] w-[33px] items-center justify-center">
                        <StatusIcon status={logStatus.status} color={logStatus.color} size={23} />
                      </span>
                      <span>{t(logStatus.label)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center">
                  <p>
                    <span className="font-semibold">{t("Кем")}:</span> {log.createdBy}
                  </p>
                  <div className="ml-5 flex items-center">
                    <span className="font-semibold">{t("Когда")}:</span>
                    <p className="ml-[5px]">{t(formatLogDate(log.createdAt))}</p>
                  </div>
                  <div className="ml-[10px] flex items-center">
                    <span className="mr-[5px] font-semibold">{t("Сумма")}:</span> {number(log.totalPrice)} {currencyLabel(log.currency)}
                  </div>
                </div>
                {log.comment && (
                  <div className="col-span-full flex items-center">
                    <span className="mr-[5px] font-semibold">{t("Комментарий")}:</span>
                    <p>{t(log.comment)}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )

  const tabIndex = TABS.findIndex((item) => item.key === tab)
  return (
    <>
      {/* Like Linko, only the X closes it (a click on the dim backdrop and Escape do not). */}
      <div className="fixed inset-0 z-[1200] overflow-y-auto bg-black/[0.54]">
        <div className="flex min-h-full items-center justify-center px-4 pb-[144px] pt-[16px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${t("Заказ")} № ${orderId}`}
            className="w-[1400px] max-w-full rounded-[2px] bg-white font-sans text-[13px] leading-[16.25px] text-[#333] shadow-[0_14px_45px_rgba(0,0,0,0.25),0_10px_18px_rgba(0,0,0,0.22)]"
          >
            <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
              <h2 className="text-[13px] font-bold uppercase">
                {t("Заказ")} № {orderId}
              </h2>
              <button type="button" aria-label={t("Закрыть")} title={t("Закрыть")} onClick={close} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </header>
            {!order ? (
              <div className="flex min-h-[240px] items-center justify-center text-[#999]">{error ? <span className="text-[#e57373]">{t(error)}</span> : t("Загрузка...")}</div>
            ) : (
              <div className="flex">
                {left}
                <div className="min-w-0 flex-1 px-[30px] pb-[20px]">
                  <div className="relative mb-[1px] flex border-b border-[#f2f5f8]">
                    {TABS.map((item) => (
                      <button key={item.key} type="button" onClick={() => setTab(item.key)} className="h-12 w-[150px] whitespace-nowrap text-[13px] font-medium text-black">
                        {t(item.label)}
                      </button>
                    ))}
                    <span className="absolute -bottom-[1px] h-[2px] w-[150px] bg-[#1E4A9A] transition-all duration-300" style={{ left: tabIndex * 150 }} />
                  </div>
                  {tab === "productList" && productList}
                  {tab === "return" && returnsList}
                  {tab === "logs" && logsList}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {logDetails && logs && (
        // Above the dialog (the sheet's own layer is lower).
        <div className="relative z-[1300]">
          <LogDetailsSheet orderId={orderId} logs={logs} onClose={() => setLogDetails(false)} />
        </div>
      )}
    </>
  )
}
