"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useAppCurrency } from "@/lib/app-currency-context"
import { roundAmount } from "@/lib/amount-precision"
import { parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { OrderFilterData, OrderFilterFacts } from "@/lib/order-filter-data"

import { orderOrganization, type Order } from "./orders-data"

// Linko's order filter (Продажи → Заказы → «Показать фильтр», its OrderFilterForm): the same fields in the same order,
// single or multi selects as Linko's, and every value kept under Linko's URL key (ORDER_FILTER_KEY: stock=59,
// dealType=consignment, dept=1, status=0-1-5 …). The panel edits a draft; «ПРИМЕНИТЬ» applies it (and writes the URL).

/** Applied filter values by Linko's URL keys; a multi select joins its ids with "-" like Linko. */
export type OrderFilters = Record<string, string>

export const EMPTY_ORDER_FILTERS: OrderFilters = {}

/** Linko's ORDER_FILTER_KEY values, in its order. */
export const ORDER_FILTER_KEYS = [
  "fromDate", "toDate", "deliveryFromDate", "deliveryToDate", "paymentFromDate", "paymentToDate", "transferPeriodFromDate",
  "transferPeriodToDate", "invoiceFromDate", "invoiceToDate", "debtType", "client", "deliveryMan", "collector", "productType",
  "productTypeChild", "product", "shop", "marketInn", "marketTypeParent", "marketType", "branch", "transport", "stock",
  "priceList", "division", "initiator", "dept", "paymentType", "zone", "promotion", "promotionType", "customPaymentType",
  "dealType", "status", "marketDebtAmount", "invoiceNumber", "brand", "currency", "isPrinted", "hasMarkProduct",
  "activeInvoice", "invoiceHasUUID", "marketContractIsActive", "isMarkCompleted", "hasCustomDiscount", "onlyBonus",
  "withBall", "exclude", "excludeFullReturn", "withOrderReturn", "deliveryDateToAccepted", "hasDiscount", "isFiscal", "isNew",
] as const

/** Linko's «Фильтр: N элемента»: every filter key present in the URL but fromDate (so a creation period counts once,
 * any other period twice — its from and to keys). */
export function countOrderFilters(filters: OrderFilters) {
  return ORDER_FILTER_KEYS.filter((key) => key !== "fromDate" && filters[key]).length
}

/** Linko's order status codes (ORDER_STATUS_ITEMS) ↔ the stored statuses. */
export const ORDER_STATUS_CODES: Record<string, string> = {
  "0": "В процессе",
  "1": "Есть на складе",
  "2": "В пути",
  "3": "Доставлено",
  "4": "Отменен",
  "5": "Не подтвержден",
}
export const statusCodeOf = (status: string) => Object.entries(ORDER_STATUS_CODES).find(([, value]) => value === status)?.[0] ?? ""

const STATUS_ITEMS = [
  { id: "0", name: "В процессе" },
  { id: "1", name: "Есть на складе" },
  { id: "2", name: "Передан доставщику" },
  { id: "3", name: "Доставлен" },
  { id: "4", name: "Отменен" },
  { id: "5", name: "Не подтвержден" },
]
const DEBT_TYPES = [
  { id: "first", name: "Прошло до 7 дней" },
  { id: "second", name: "C 7 дней - До 30" },
  { id: "third", name: "C 30 дней - До 120" },
  { id: "fourth", name: "Больше 120 дней" },
]
const DEPT_ITEMS = [
  { id: "1", name: "Не оплачен" },
  { id: "2", name: "Оплачен" },
]
const PAYMENT_TYPES = [
  { id: "bank", name: "Банковский счет" },
  { id: "cash", name: "Наличный" },
]
const DEAL_TYPES = [
  { id: "standard", name: "Стандарт" },
  { id: "consignment", name: "Консигнация" },
]
const PROMOTION_TYPES = [
  { id: "discount", name: "Скидочная" },
  { id: "bonus", name: "Бонусная" },
  { id: "addup", name: "Надбавка" },
  { id: "ball", name: "Балл" },
  { id: "cash_back", name: "Кэшбек" },
  { id: "none_type", name: "Нет акции" },
]
const PRINTED = [
  { id: "true", name: "Напечатано" },
  { id: "false", name: "Не напечатано" },
]
const TRUE_FALSE = [
  { id: "true", name: "Да" },
  { id: "false", name: "Нет" },
]
const ACTIVE_INVOICES = [
  { id: "true", name: "Активные счет фактуры" },
  { id: "false", name: "Не активные счет фактуры" },
]

// The reference prints these labels in Russian in every language (kept by DomTranslator's route list).
const RAW_LABELS = new Set(["Финансовый счет", "ИНН магазина", "Маркетинговая акция", "Исключить полный возврат", "Заказы с возвратами", "Показать дату реализации, не равную дате доставки"])

const CHECKS = [
  { key: "onlyBonus", label: "Только бонусные заказы" },
  { key: "withBall", label: "Только призовые заказы" },
  { key: "exclude", label: "Показать отмененные заказы" },
  { key: "excludeFullReturn", label: "Исключить полный возврат" },
  { key: "withOrderReturn", label: "Заказы с возвратами" },
  { key: "deliveryDateToAccepted", label: "Показать дату реализации, не равную дате доставки" },
]

type Item = { id: string; name: string }

const ids = (value: string | undefined) => (value ? value.split("-").filter(Boolean) : [])
const numIds = (value: string | undefined) => ids(value).map(Number).filter(Number.isFinite)

/** What the list needs besides the rows: the filter data (option lists, per-order facts) and today. */
export type OrderFilterContext = { data: OrderFilterData | null; today: string }

/** The filter keys that need GET /api/orders/filter-data to be applied. */
const DATA_KEYS = ["client", "deliveryMan", "collector", "productType", "productTypeChild", "product", "shop", "marketInn", "marketTypeParent", "marketType", "branch", "transport", "stock", "priceList", "division", "initiator", "zone", "promotion", "promotionType", "brand", "currency", "hasMarkProduct", "marketContractIsActive", "onlyBonus", "isNew"]
export const needsFilterData = (filters: OrderFilters) => DATA_KEYS.some((key) => filters[key])

/** Whole days from `day` to `today`. */
function daysSince(day: string, today: string) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
}

function inRange(day: string | null | undefined, from: string | undefined, to: string | undefined) {
  if (!from && !to) return true
  if (!day) return false
  return (!from || day >= from) && (!to || day <= to)
}

/** First amount of a "1 234,5 SUM" text (the client balance of the list). */
function firstAmount(text: string) {
  const match = /-?[\d\s ]+(?:[.,]\d+)?/.exec(text ?? "")
  const value = match ? Number(match[0].replace(/[\s ]/g, "").replace(",", ".")) : Number.NaN
  return Number.isFinite(value) ? value : 0
}

/** The unpaid rest the list colours the payment icon by (OrderRow): the ledger rest of a counted order, the payable
 * rest of an unconfirmed one. */
export function orderRest(row: Order): number {
  return row.orderBalance ?? row.payableRest ?? 0
}

/**
 * Whether an order passes the applied filter — Linko's server rules, checked on its own data:
 * «Просроченность долга» = days since the order was realized (accepted day; В пути / Доставлено only);
 * «Статус оплаты» = the order's rest; «Долг клиента больше» = the client's balance (the list's «Баланс»);
 * «Исключить полный возврат» drops an order whose fact (lines − returns) is 0; «Заказы с возвратами» = any return;
 * «Показать дату реализации, не равную дате доставки» = realized on another day than its delivery day.
 * «Период передачи со склада» = the accepted day (Linko's begin/end_accepted_time); «Только бонусные заказы» = a bonus
 * line; «Только новые» = Linko's is_new; «Статус оплаты» counts any rest above 0 at the money precision as unpaid.
 * Linko's server ignores «Только призовые заказы» and «Фискализирован» (every order stays), so they only count here too;
 * its «Статус печати» lists every order as «Напечатано» and none as «Не напечатано», and so does this list. Mezon records
 * no marking completion or EDO sending: those choices match no order.
 */
export function matchesOrderFilters(row: Order, filters: OrderFilters, appCurrency = "", context: OrderFilterContext = { data: null, today: "" }) {
  const f = filters
  // Cancelled orders only with «Показать отмененные заказы» (Linko sends exclude_cancelled otherwise, even with the
  // «Отменен» status picked, and lists none).
  const statuses = ids(f.status)
  if (row.status === "Отменен" && !f.exclude) return false
  if (statuses.length && !statuses.includes(statusCodeOf(row.status))) return false
  if (!inRange(parseAnyDay(row.createdAt, true) ?? parseAnyDay(row.created), f.fromDate, f.toDate)) return false
  const delivery = parseAnyDay(row.delivery)
  if (!inRange(delivery, f.deliveryFromDate, f.deliveryToDate)) return false
  if (!inRange(row.paymentDate || null, f.paymentFromDate, f.paymentToDate)) return false
  if (!inRange(row.acceptedDate || null, f.transferPeriodFromDate, f.transferPeriodToDate)) return false
  if (!inRange(row.invoiceDate || null, f.invoiceFromDate, f.invoiceToDate)) return false
  const released = row.status === "В пути" || row.status === "Доставлено"
  if (f.debtType) {
    if (!released || !row.acceptedDate || !context.today) return false
    const days = daysSince(row.acceptedDate, context.today)
    const band = days < 7 ? "first" : days < 30 ? "second" : days < 120 ? "third" : "fourth"
    if (band !== f.debtType) return false
  }
  if (f.dept && (roundAmount(orderRest(row)) > 0 ? "1" : "2") !== f.dept) return false
  if (f.paymentType && (row.paymentType || "cash") !== f.paymentType) return false
  if (f.dealType && (row.dealType === "1" || row.dealType === "consignment" ? "consignment" : row.dealType === "0" || row.dealType === "standard" ? "standard" : "") !== f.dealType) return false
  if (f.customPaymentType && !ids(f.customPaymentType).includes(row.payTypeName || "")) return false
  if (f.marketDebtAmount && !(-firstAmount(row.balance) > Number(f.marketDebtAmount))) return false
  if (f.invoiceNumber && !(row.invoiceNumber ?? "").toLowerCase().includes(f.invoiceNumber.toLowerCase())) return false
  if (f.activeInvoice && String(!!row.invoiceActive) !== f.activeInvoice) return false
  if (f.isPrinted === "false" || f.invoiceHasUUID === "true" || f.isMarkCompleted === "true") return false
  if (f.excludeFullReturn && Math.round(((row.linesTotal ?? row.totalPrice ?? 0) - (row.returnPrice ?? 0)) * 1e9) === 0) return false
  if (f.withOrderReturn && !((row.returnPrice ?? 0) > 0)) return false
  if (f.deliveryDateToAccepted && !(row.acceptedDate && row.acceptedDate !== delivery)) return false
  if (!needsFilterData(f)) return true
  const data = context.data
  if (!data) return true
  const facts: OrderFilterFacts | undefined = data.facts[row.id]
  const nameOf = (list: Array<{ id: number; name: string }>, key: string) => {
    const wanted = new Set(numIds(f[key]))
    return new Set(list.filter((item) => wanted.has(item.id)).map((item) => item.name))
  }
  const anyOf = (values: number[] | undefined, key: string) => numIds(f[key]).some((id) => (values ?? []).includes(id))
  if (f.client && !(facts?.account != null && numIds(f.client).includes(facts.account))) return false
  const people = data.options.allEmployees ?? data.options.employees
  if (f.deliveryMan && !nameOf(people, "deliveryMan").has(row.deliveryMan ?? "")) return false
  if (f.collector && !(facts?.collector != null && numIds(f.collector).includes(facts.collector))) return false
  if (f.onlyBonus && !facts?.bonus) return false
  if (f.isNew && !facts?.isNew) return false
  if (f.productTypeChild ? !anyOf(facts?.types, "productTypeChild") : f.productType && !anyOf(facts?.types, "productType")) return false
  if (f.product && !anyOf(facts?.products, "product")) return false
  if (f.shop && !(row.clientId != null && numIds(f.shop).includes(row.clientId))) return false
  if (f.marketInn && !ids(f.marketInn).includes(facts?.inn ?? "")) return false
  if (f.marketType ? !(facts?.clientType != null && numIds(f.marketType).includes(facts.clientType)) : f.marketTypeParent && !(facts?.clientTypeParent != null && numIds(f.marketTypeParent).includes(facts.clientTypeParent))) return false
  if (f.branch && !nameOf(data.options.branches, "branch").has(row.branchName ?? "")) return false
  if (f.transport && !nameOf(data.options.transports, "transport").has(row.transportNumber ?? "")) return false
  if (f.stock && !nameOf(data.options.warehouses, "stock").has(row.warehouse || row.stockName || "")) return false
  if (f.priceList && !nameOf(data.options.priceLists, "priceList").has(row.priceList ?? "")) return false
  // «Организация» (Linko's division filter, with its DIVISIONS setting): the order's organization by id (several may
  // share a name); an order the data does not know yet by its name.
  if (f.division && !(facts ? facts.division != null && numIds(f.division).includes(facts.division) : nameOf(data.options.organizations ?? [], "division").has(orderOrganization(row)))) return false
  if (f.initiator && !nameOf(people, "initiator").has(row.agent)) return false
  if (f.zone && !nameOf(data.options.zones, "zone").has(row.zone)) return false
  if (f.brand && !anyOf(facts?.brands, "brand")) return false
  // «Маркетинговая акция» / «Тип акции»: the promotions Linko applied to the order (orders.promotions); Linko's own
  // «Нет акции» answers no order.
  if (f.promotion && !anyOf(facts?.promotions, "promotion")) return false
  if (f.promotionType && !ids(f.promotionType).some((type) => (facts?.promotionTypes ?? []).includes(type))) return false
  // With an app currency (Настройки → Валюта приложения) every order is shown in it: «Валюта» is hidden and keeps every row.
  if (f.currency && !appCurrency) {
    const code = data.options.currencies.find((item) => String(item.id) === f.currency)?.code ?? ""
    const own = (row.currency || row.amount.trim().split(/\s+/).pop() || "").toUpperCase()
    if (!code || (own !== code.toUpperCase() && !(code === "EUR" && own === "EURO"))) return false
  }
  if (f.hasMarkProduct && String(!!facts?.marked) !== f.hasMarkProduct) return false
  if (f.marketContractIsActive && String(!!facts?.contract) !== f.marketContractIsActive) return false
  return true
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const ARROW = <path d="M7 10l5 5 5-5z" />

/** Linko's single select (react-select): bold placeholder; once picked, the label above, the value, × and ▾. */
function SingleBox({ label, value, items, onChange }: { label: string; value: string; items: Item[]; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const picked = items.find((item) => item.id === value)
  const shown = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 100)
  const close = () => { setOpen(false); setQuery("") }
  return (
    <div className="relative h-[52px]">
      {picked && <span className="absolute left-0 top-[4px] text-[9.75px] font-semibold leading-3 text-black">{label}</span>}
      <div onMouseDown={() => setOpen(true)} className={`absolute inset-x-0 bottom-0 flex h-[30px] cursor-pointer items-center border-b pr-[46px] ${open ? "border-[#5d6474]" : "border-[#e0e0e0]"}`}>
        <input
          value={open ? query : picked ? picked.name : ""}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
            if (event.key === "Enter" && shown[0]) { event.preventDefault(); onChange(shown[0].id); close() }
          }}
          placeholder={picked ? picked.name : label}
          aria-label={label}
          className={`w-full bg-transparent text-[13px] outline-none ${picked ? "font-normal text-black placeholder:text-black" : "font-semibold placeholder:font-semibold placeholder:text-black"}`}
        />
      </div>
      {picked && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute bottom-[5px] right-[26px] text-[16px] leading-[16px] text-[#999]">×</button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[3px] right-0 h-6 w-6 fill-black/40">{ARROW}</svg>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute inset-x-0 top-full z-20 max-h-[220px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {shown.length === 0 ? (
              <div className="px-4 py-2 text-[13px] text-[#999]">{t("Не найдено")}</div>
            ) : (
              shown.map((item) => (
                <button key={item.id} type="button" onClick={() => { onChange(item.id); close() }} className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-[#e3effd] ${item.id === value ? "bg-[#e3effd]" : ""}`}>
                  {item.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Linko's multi select: the label above the chips once something is picked, the chips grow the field, × clears all. */
function MultiBox({ label, value, items, onChange }: { label: string; value: string[]; items: Item[]; onChange: (value: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items])
  const shown = items.filter((item) => !value.includes(item.id) && item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 100)
  const close = () => { setOpen(false); setQuery("") }
  return (
    <div className="relative min-h-[52px]">
      {value.length > 0 && <span className="block pt-[4px] text-[9.75px] font-semibold leading-3 text-black">{label}</span>}
      <div onMouseDown={() => setOpen(true)} className={`flex min-h-[30px] cursor-pointer flex-wrap items-center gap-[4px] border-b pr-[46px] ${value.length ? "mt-[3px] pb-[3px]" : "mt-[22px]"} ${open ? "border-[#5d6474]" : "border-[#e0e0e0]"}`}>
        {value.map((id) => (
          <span key={id} className="flex items-stretch rounded-[2px] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.4px] text-white">
            <button type="button" aria-label={`${t("Удалить")} ${byId.get(id) ?? id}`} onMouseDown={(event) => event.stopPropagation()} onClick={() => onChange(value.filter((item) => item !== id))} className="border-r border-white/60 px-[5px] py-[2px]">×</button>
            <span className="px-[5px] py-[2px]">{byId.get(id) ?? id}</span>
          </span>
        ))}
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
            if (event.key === "Enter" && shown[0]) { event.preventDefault(); onChange([...value, shown[0].id]); setQuery("") }
            if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
          }}
          placeholder={value.length ? "" : label}
          aria-label={label}
          className="min-w-[40px] flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-black"
        />
      </div>
      {value.length > 0 && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])} className="absolute bottom-[8px] right-[26px] text-[16px] leading-[16px] text-[#999]">×</button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[3px] right-0 h-6 w-6 fill-black/40 ${open ? "rotate-180" : ""}`}>{ARROW}</svg>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute inset-x-0 top-full z-20 max-h-[220px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {shown.length === 0 ? (
              <div className="px-4 py-2 text-[13px] text-[#999]">{t("Не найдено")}</div>
            ) : (
              // Linko's menu stays open after a pick (several can be chosen), semibold, nothing highlighted before hover.
              shown.map((item) => (
                <button key={item.id} type="button" onClick={() => { onChange([...value, item.id]); setQuery("") }} className="block w-full px-4 py-2 text-left text-[13px] font-semibold hover:bg-[#e3effd]">
                  {item.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TextBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block h-[52px]">
      {value && <span className="absolute left-0 top-[4px] text-[9.75px] font-semibold leading-3 text-black">{label}</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} className="absolute inset-x-0 bottom-0 h-[30px] border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:font-semibold placeholder:text-black focus:border-[#5d6474]" />
    </label>
  )
}

// --- Linko's date range picker (two months with month / year selects, presets, × / ✓) ---------------------------------

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const PRESETS = ["Сегодня", "Вчера", "Последние 7 дней", "Текущий месяц", "Пред. месяц"] as const

const isoOf = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month, day))
  return date.toISOString().slice(0, 10)
}
const shiftDays = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)

function presetRange(preset: (typeof PRESETS)[number], today: string): [string, string] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  switch (preset) {
    case "Сегодня": return [today, today]
    case "Вчера": return [shiftDays(today, -1), shiftDays(today, -1)]
    case "Последние 7 дней": return [shiftDays(today, -6), today]
    case "Текущий месяц": return [isoOf(year, month, 1), today]
    default: return [isoOf(year, month - 1, 1), isoOf(year, month, 0)]
  }
}

function MonthView({ year, month, from, to, today, onPick, onMonth, onPrev, onNext }: { year: number; month: number; from: string; to: string; today: string; onPick: (day: string) => void; onMonth: (year: number, month: number) => void; onPrev: () => void; onNext: () => void }) {
  const { t } = useLanguage()
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const offset = (first + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => isoOf(year, month, 1 - offset + index))
  const years = Array.from({ length: 21 }, (_, index) => Number(today.slice(0, 4)) - 15 + index)
  const nav = "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] bg-[#eef0f4] text-[#5d6474]"
  return (
    <div className="w-[280px]">
      <div className="flex h-[30px] items-center justify-between">
        <button type="button" onClick={onPrev} aria-label={t("Назад")} className={nav}><svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M15 6v12l-8-6z" /></svg></button>
        <span className="flex items-center gap-3 text-[13px] font-semibold text-[#333]">
          <select value={month} onChange={(event) => onMonth(year, Number(event.target.value))} aria-label={t("Месяц")} className="cursor-pointer bg-transparent outline-none">
            {MONTHS.map((name, index) => <option key={name} value={index}>{t(name)}</option>)}
          </select>
          <select value={year} onChange={(event) => onMonth(Number(event.target.value), month)} aria-label={t("Год")} className="cursor-pointer bg-transparent outline-none">
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </span>
        <button type="button" onClick={onNext} aria-label={t("Вперед")} className={nav}><svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M9 6v12l8-6z" /></svg></button>
      </div>
      <div className="mt-[10px] grid grid-cols-7 text-center text-[11px] text-[#999]">
        {WEEKDAYS.map((day) => <span key={day} className="h-[20px] leading-[20px]">{t(day)}</span>)}
      </div>
      <div className="grid grid-cols-7 text-center text-[13px]">
        {cells.map((day) => {
          const inMonth = Number(day.slice(5, 7)) - 1 === ((month % 12) + 12) % 12
          const edge = day === from || day === to
          const between = from && to && day > from && day < to
          const isToday = day === today
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              className={`mx-auto my-[2px] h-[36px] w-[36px] rounded-[8px] ${edge ? "bg-[#1E4A9A] font-semibold text-white" : between ? "bg-[#e3e9f6]" : isToday ? "font-semibold text-[#1E4A9A]" : inMonth ? "text-[#333] hover:bg-[#f2f5f8]" : "text-[#ccc]"}`}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RangePicker({ from, to, today, onApply, onClose }: { from: string; to: string; today: string; onApply: (from: string, to: string) => void; onClose: () => void }) {
  const { t } = useLanguage()
  // An empty field opens on today (Linko marks «Сегодня» and today's day).
  const [start, setStart] = useState(from || today)
  const [stop, setStop] = useState(from ? to : today)
  const anchor = from || today
  const [view, setView] = useState({ year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)) - 2 })
  const norm = (year: number, month: number) => ({ year: year + Math.floor(month / 12), month: ((month % 12) + 12) % 12 })
  const left = norm(view.year, view.month)
  const right = norm(view.year, view.month + 1)
  const preset = PRESETS.find((item) => {
    const [a, b] = presetRange(item, today)
    return a === start && b === stop
  })
  const pick = (day: string) => {
    if (!start || stop) { setStart(day); setStop("") }
    else if (day < start) { setStop(start); setStart(day) }
    else setStop(day)
  }
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 top-full z-40 flex gap-[20px] rounded-[4px] bg-white p-[12px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex w-[150px] flex-col border-r border-[#efefef] pr-[10px]">
          {PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                const [a, b] = presetRange(item, today)
                setStart(a)
                setStop(b)
                setView({ year: Number(b.slice(0, 4)), month: Number(b.slice(5, 7)) - 2 })
              }}
              className={`mb-[4px] h-[34px] whitespace-nowrap rounded-[6px] px-[12px] text-left text-[13px] ${preset === item ? "bg-[#e3e9f6] font-semibold text-[#1E4A9A]" : "text-[#333] hover:bg-[#f2f5f8]"}`}
            >
              {t(item)}
            </button>
          ))}
          <div className="mt-auto flex gap-[6px] pt-[16px]">
            <button type="button" onClick={onClose} aria-label={t("Отмена")} className="flex h-[30px] w-[64px] items-center justify-center rounded-[4px] bg-[#eef0f4]">
              <X className="h-4 w-4 text-[#5d6474]" />
            </button>
            <button type="button" disabled={!start} onClick={() => onApply(start, stop || start)} aria-label={t("Применить")} className="flex h-[30px] w-[64px] items-center justify-center rounded-[4px] bg-[#1E4A9A] disabled:opacity-50">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
            </button>
          </div>
        </div>
        <MonthView year={left.year} month={left.month} from={start} to={stop} today={today} onPick={pick} onMonth={(year, month) => setView({ year, month })} onPrev={() => setView((v) => norm(v.year, v.month - 1))} onNext={() => setView((v) => norm(v.year, v.month + 1))} />
        <MonthView year={right.year} month={right.month} from={start} to={stop} today={today} onPick={pick} onMonth={(year, month) => setView(norm(year, month - 1))} onPrev={() => setView((v) => norm(v.year, v.month - 1))} onNext={() => setView((v) => norm(v.year, v.month + 1))} />
      </div>
    </>
  )
}

const dayText = (day: string) => `${day.slice(8, 10)} ${SHORT_MONTHS[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`

/** Linko's date field: the small label, «Укажите дату» (or the period) and the calendar icon at the right, full width. */
function DateField({ label, from, to, today, onChange }: { label: string; from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[52px]">
      <span className="absolute left-0 top-[4px] text-[9.75px] font-semibold leading-3 text-black">{t(label)}</span>
      <button type="button" onClick={() => setOpen((value) => !value)} className={`absolute inset-x-0 bottom-0 flex h-[30px] items-center border-b pr-[30px] text-left text-[13px] text-black ${open ? "border-[#5d6474]" : "border-[#e0e0e0]"}`}>
        {from ? `${t(dayText(from))} - ${t(dayText(to || from))}` : t("Укажите дату")}
      </button>
      {from && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute bottom-[6px] right-[26px] text-[16px] leading-[16px] text-[#999]">×</button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[5px] right-[2px] h-[18px] w-[18px] fill-[#999]"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" /></svg>
      {open && (
        <RangePicker
          from={from}
          to={to}
          today={today}
          onClose={() => setOpen(false)}
          onApply={(a, b) => {
            onChange(a, b)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Multi select with chips over the label (the promotions filter drawer uses it). */
export function SelectBox({ label, value, options, onChange }: { label: string; value: string[]; options: string[]; onChange: (value: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const shown = options.filter((option) => !value.includes(option) && option.toLowerCase().includes(query.toLowerCase()))
  const close = () => { setOpen(false); setQuery("") }
  return (
    <div className="relative min-h-[52px] border-b border-[#e0e0e0]">
      {value.length > 0 && <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{label}</span>}
      <div onMouseDown={() => setOpen(true)} className="absolute inset-x-0 bottom-0 flex min-h-[30px] cursor-pointer flex-wrap items-center gap-1 pr-6">
        {value.map((item) => (
          <span key={item} className="flex items-stretch rounded-[2px] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.4px] text-white">
            <button type="button" aria-label={`${t("Удалить")} ${item}`} onMouseDown={(event) => event.stopPropagation()} onClick={() => onChange(value.filter((v) => v !== item))} className="border-r border-white px-[5px] py-[2px]">×</button>
            <span className="px-[5px] py-[2px]">{item}</span>
          </span>
        ))}
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close()
            if (event.key === "Enter" && shown[0]) { event.preventDefault(); onChange([...value, shown[0]]); close() }
            if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
          }}
          placeholder={value.length ? "" : label}
          aria-label={label}
          className="min-w-[40px] flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-black"
        />
      </div>
      {value.length > 0 && (
        <button type="button" aria-label={t("Очистить")} title="Clear value" data-native-tip="" onClick={() => onChange([])} className="absolute bottom-[3px] right-[24px] text-[18px] leading-[18px] text-[#999]">×</button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-0 right-0 h-6 w-6 fill-black/30 ${open ? "rotate-180" : ""}`}><path d="M7 10l5 5 5-5z" /></svg>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute inset-x-0 top-full z-20 max-h-[220px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {shown.length === 0 ? (
              <div className="px-4 py-2 text-[13px] text-[#999]">{t("Не найдено")}</div>
            ) : (
              shown.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { onChange([...value, option]); close() }}
                  className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-[#e3effd] ${index === 0 ? "bg-[#e3effd]" : ""}`}
                >
                  {option}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function OrderFilterPanel({
  orders,
  filters,
  data,
  today,
  onApply,
  onClose,
}: {
  orders: Order[]
  filters: OrderFilters
  data: OrderFilterData | null
  today: string
  onApply: (filters: OrderFilters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const appCurrency = useAppCurrency()
  // The choices stay a draft until «Применить», as in Linko.
  const [draft, setDraft] = useState<OrderFilters>(filters)
  useEffect(() => setDraft(filters), [filters])
  const set = (patch: OrderFilters) => setDraft((current) => {
    const next = { ...current, ...patch }
    for (const key of Object.keys(next)) if (!next[key]) delete next[key]
    return next
  })
  const label = (text: string) => (RAW_LABELS.has(text) ? text : t(text))
  const opts = data?.options
  const asItems = (list: Array<{ id: number; name: string }> | undefined) => (list ?? []).map((item) => ({ id: String(item.id), name: item.name }))
  const translated = (list: Item[]) => list.map((item) => ({ id: item.id, name: t(item.name) }))

  const pickedTypes = numIds(draft.productType)
  const pickedClientTypes = numIds(draft.marketTypeParent)
  const customPaymentTypes = useMemo(
    () => Array.from(new Set(orders.map((order) => order.payTypeName ?? "").filter(Boolean))).map((name) => ({ id: name, name })),
    [orders],
  )

  const multi = (key: string, text: string, items: Item[]) => (
    <MultiBox key={key} label={label(text)} value={ids(draft[key])} items={items} onChange={(value) => set({ [key]: value.join("-") })} />
  )
  const single = (key: string, text: string, items: Item[]) => (
    <SingleBox key={key} label={label(text)} value={draft[key] ?? ""} items={items} onChange={(value) => set({ [key]: value })} />
  )
  const date = (fromKey: string, toKey: string, text: string) => (
    <DateField key={fromKey} label={text} from={draft[fromKey] ?? ""} to={draft[toKey] ?? ""} today={today} onChange={(from, to) => set({ [fromKey]: from, [toKey]: to })} />
  )

  return (
    // Linko's panel lies over the list (position absolute, the full width, z-index 98) and pushes nothing down.
    <div className="absolute inset-x-0 top-0 z-40 bg-white px-[20px] pb-[10px] pt-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="flex h-[48px] items-center justify-between">
        <h3 className="text-[15px] font-normal text-[#757575]">{t("Фильтр")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#999] hover:text-[#666]">
          <X className="h-6 w-6 rounded-full border-2 border-current p-[2px]" />
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-x-[10px] gap-y-[15px] sm:grid-cols-2 xl:grid-cols-4">
        {date("fromDate", "toDate", "Период создания")}
        {date("deliveryFromDate", "deliveryToDate", "Дата доставки")}
        {date("paymentFromDate", "paymentToDate", "Период даты оплаты")}
        {date("transferPeriodFromDate", "transferPeriodToDate", "Период передачи со склада")}
        {date("invoiceFromDate", "invoiceToDate", "Дата счет фактуры")}
        {single("debtType", "Просроченность долга", translated(DEBT_TYPES))}
        {multi("client", "Финансовый счет", asItems(opts?.financeAccounts))}
        {multi("deliveryMan", "Доставщик", asItems(opts?.employees))}
        {multi("collector", "Сборщик", asItems(opts?.employees))}
        {multi("productType", "Тип товара", asItems(opts?.productTypes.filter((item) => item.parentId === null)))}
        {pickedTypes.length > 0 && multi("productTypeChild", "Подкатегория", asItems(opts?.productTypes.filter((item) => item.parentId !== null && pickedTypes.includes(item.parentId))))}
        {multi("product", "Товар", asItems(opts?.products.filter((item) => !pickedTypes.length || (item.typeId !== null && (pickedTypes.includes(item.typeId) || pickedTypes.includes(opts.productTypes.find((type) => type.id === item.typeId)?.parentId ?? -1))))))}
        {multi("shop", "Клиент", asItems(opts?.clients))}
        {multi("marketInn", "ИНН магазина", (opts?.inns ?? []).map((inn) => ({ id: inn, name: inn })))}
        {multi("marketTypeParent", "Тип клиента", asItems(opts?.clientTypes.filter((item) => item.parentId === null)))}
        {pickedClientTypes.length > 0 && multi("marketType", "Подкатегория", asItems(opts?.clientTypes.filter((item) => item.parentId !== null && pickedClientTypes.includes(item.parentId))))}
        {multi("branch", "Филиалы", asItems(opts?.branches))}
        {multi("transport", "Транспорт", asItems(opts?.transports))}
        {single("stock", "Склад", asItems(opts?.warehouses))}
        {single("priceList", "Прайс-лист", asItems(opts?.priceLists))}
        {multi("division", "Организация", asItems(opts?.organizations))}
        {multi("initiator", "Агент", asItems(opts?.employees))}
        {single("dept", "Статус оплаты", translated(DEPT_ITEMS))}
        {single("paymentType", "Тип оплаты (транзакции)", translated(PAYMENT_TYPES))}
        {multi("zone", "Зона", asItems(opts?.zones))}
        {multi("promotion", "Маркетинговая акция", asItems(opts?.promotions))}
        {multi("promotionType", "Тип акции", translated(PROMOTION_TYPES))}
        {multi("customPaymentType", "Тип оплаты", customPaymentTypes)}
        {single("dealType", "Тип сделки", translated(DEAL_TYPES))}
        {multi("status", "Статус", translated(STATUS_ITEMS))}
        <TextBox label={t("Долг клиента больше")} value={draft.marketDebtAmount ?? ""} onChange={(value) => set({ marketDebtAmount: value.replace(/[^\d]/g, "") })} />
        <TextBox label={t("Номер счет фактура")} value={draft.invoiceNumber ?? ""} onChange={(value) => set({ invoiceNumber: value })} />
        {multi("brand", "Бренд", asItems(opts?.brands))}
        {!appCurrency && single("currency", "Валюта", asItems(opts?.currencies))}
        {single("isPrinted", "Статус печати", translated(PRINTED))}
        {single("hasMarkProduct", "Есть маркированный товар", translated(TRUE_FALSE))}
        {single("activeInvoice", "Тип счет фактуры", translated(ACTIVE_INVOICES))}
        {single("invoiceHasUUID", "Счет фактура отправлена", translated(TRUE_FALSE))}
        {single("marketContractIsActive", "Активный договор у клиента", translated(TRUE_FALSE))}
        {single("isMarkCompleted", "Маркировка завершена", translated(TRUE_FALSE))}
        {single("isFiscal", "Фискализирован", translated(TRUE_FALSE))}
      </div>

      <h4 className="mt-[18px] border-b-2 border-[#adbce8] pb-[2px] text-[12px] font-bold tracking-[0.3px] text-[#6b7a99]">{t("Дополнительно")}</h4>
      <div className="mt-3 grid grid-cols-1 gap-x-[10px] gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {CHECKS.map((check) => (
          <label key={check.key} className="flex cursor-pointer items-start gap-2 px-[3px] text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={draft[check.key] === "true"}
              onChange={(event) => set({ [check.key]: event.target.checked ? "true" : "" })}
              className="mt-[2px] h-[15px] w-[15px] shrink-0 accent-[#5d6474]"
            />
            {label(check.label)}
          </label>
        ))}
      </div>

      <button type="button" onClick={() => onApply(draft)} className="mt-[15px] h-9 rounded-[3px] bg-[#5d6474] px-4 text-[13px] font-medium uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:brightness-110">
        {t("Применить")}
      </button>
    </div>
  )
}
