"use client"

import { CalendarDays, X } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { ORDER_STATUS_REF_LABEL, ORDER_STATUS_REF_OPTIONS, type Order } from "./orders-data"

export type DateRange = { from: string; to: string }

export type OrderFilters = {
  created: DateRange
  delivery: DateRange
  select: Record<string, string[]>
  debtMin: string
  invoiceNumber: string
  checks: Record<string, boolean>
}

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  created: { from: "", to: "" },
  delivery: { from: "", to: "" },
  select: {},
  debtMin: "",
  invoiceNumber: "",
  checks: {},
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "25 июля 2026" / "25 июля 17:17" -> yyyy-mm-dd (year falls back to the given one). */
function parseRuDate(text: string, fallbackYear?: string): string {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?(?:\s+(\d{4}))?/)
  if (!match) return ""
  const month = MONTHS.findIndex((m) => match[2].startsWith(m))
  if (month < 0) return ""
  const year = match[3] ?? fallbackYear ?? ""
  if (!year) return ""
  return `${year}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

function currencyOf(amount: string) {
  return amount.trim().split(/\s+/).pop() ?? ""
}

function parseMoney(text: string) {
  const value = Number(text.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(value) ? value : 0
}

type SelectField = { key: string; label: string; value?: (row: Order) => string }

/** Reference lists that feed select options (name taken from each record). */
const REFERENCE_ENDPOINTS: Record<string, string> = {
  financeAccount: "cashboxes",
  deliverer: "employees",
  picker: "employees",
  productType: "product-types",
  branch: "branches",
  transport: "transport",
  warehouse: "warehouses",
  priceList: "price-lists",
  organization: "organizations",
  brand: "brands",
}

const STATIC_OPTIONS: Record<string, string[]> = {
  overdue: ["Прошло до 7 дней", "C 7 дней - До 30", "C 30 дней - До 120", "Больше 120 дней"],
  transactionType: ["Банковский счет", "Наличный"],
  dealType: ["Стандарт", "Консигнация"],
  status: ORDER_STATUS_REF_OPTIONS,
  paymentType: ["Наличные", "Перечисление"],
  paymentStatus: ["Не оплачен", "Оплачен"],
  currency: ["Euro", "SUM", "USD"],
  printStatus: ["Напечатано", "Не напечатано"],
  marked: ["Да", "Нет"],
  invoiceType: ["Активные счет фактуры", "Не активные счет фактуры"],
  invoiceSent: ["Да", "Нет"],
  activeContract: ["Да", "Нет"],
  markingDone: ["Да", "Нет"],
}

// Fields backed by order data filter for real; the rest keep the original layout
// and become selectable once the backend exposes those attributes.
// The reference prints these labels in Russian in every language (kept by DomTranslator's route list).
const RAW_LABELS = new Set(["Финансовый счет", "ИНН магазина", "Маркетинговая акция", "Исключить полный возврат", "Заказы с возвратами", "Показать дату реализации, не равную дате доставки"])

const SELECT_FIELDS: SelectField[] = [
  { key: "overdue", label: "Просроченность долга" },
  { key: "financeAccount", label: "Финансовый счет" },
  { key: "deliverer", label: "Доставщик", value: (row) => row.deliveryMan ?? "" },
  { key: "picker", label: "Сборщик" },
  { key: "productType", label: "Тип товара" },
  { key: "product", label: "Товар", value: (row) => row.product },
  { key: "client", label: "Клиент", value: (row) => row.client },
  { key: "shopInn", label: "ИНН магазина" },
  { key: "clientType", label: "Тип клиента", value: (row) => row.type },
  { key: "branch", label: "Филиалы" },
  { key: "transport", label: "Транспорт" },
  { key: "warehouse", label: "Склад" },
  { key: "priceList", label: "Прайс-лист" },
  { key: "organization", label: "Организация" },
  { key: "agent", label: "Агент", value: (row) => row.agent },
  { key: "paymentStatus", label: "Статус оплаты", value: (row) => (row.orderBalance === undefined ? "" : row.orderBalance > 0 ? "Не оплачен" : "Оплачен") },
  { key: "transactionType", label: "Тип оплаты (транзакции)" },
  { key: "zone", label: "Зона", value: (row) => row.zone },
  { key: "campaign", label: "Маркетинговая акция" },
  { key: "campaignType", label: "Тип акции" },
  { key: "paymentType", label: "Тип оплаты", value: (row) => (row.payMethod ? (row.payMethod === "bank" ? "Перечисление" : "Наличные") : "") },
  { key: "dealType", label: "Тип сделки" },
  { key: "status", label: "Статус", value: (row) => ORDER_STATUS_REF_LABEL[row.status] ?? row.status },
]

const SELECT_FIELDS_AFTER_DEBT: SelectField[] = [
  { key: "brand", label: "Бренд" },
  { key: "currency", label: "Валюта", value: (row) => currencyOf(row.amount) },
  { key: "printStatus", label: "Статус печати" },
  { key: "marked", label: "Есть маркированный товар" },
  { key: "invoiceType", label: "Тип счет фактуры", value: (row) => (row.invoiceActive ? "Активные счет фактуры" : "Не активные счет фактуры") },
  { key: "invoiceSent", label: "Счет фактура отправлена" },
  { key: "activeContract", label: "Активный договор у клиента" },
  { key: "markingDone", label: "Маркировка завершена" },
]

const DATE_FIELDS = [
  { key: "created", label: "Период создания" },
  { key: "delivery", label: "Дата доставки" },
  { key: "paymentDate", label: "Период даты оплаты" },
  { key: "warehouseDate", label: "Период передачи со склада" },
  { key: "invoiceDate", label: "Дата счет фактуры" },
] as const

const CHECKS = [
  { key: "bonus", label: "Только бонусные заказы" },
  { key: "prize", label: "Только призовые заказы" },
  { key: "cancelled", label: "Показать отмененные заказы" },
  { key: "noFullReturn", label: "Исключить полный возврат" },
  { key: "withReturns", label: "Заказы с возвратами" },
  { key: "realizationDiffers", label: "Показать дату реализации, не равную дате доставки" },
]

const ALL_SELECTS = [...SELECT_FIELDS, ...SELECT_FIELDS_AFTER_DEBT]

export function countOrderFilters(filters: OrderFilters) {
  return (
    [filters.created, filters.delivery].filter((range) => range.from || range.to).length +
    Object.values(filters.select).filter((values) => values.length > 0).length +
    (filters.debtMin ? 1 : 0) +
    (filters.invoiceNumber ? 1 : 0)
  )
}

function inRange(date: string, range: DateRange) {
  if (!range.from && !range.to) return true
  if (!date) return false
  return (!range.from || date >= range.from) && (!range.to || date <= range.to)
}

export function matchesOrderFilters(row: Order, filters: OrderFilters) {
  const deliveryDate = parseRuDate(row.delivery)
  const year = deliveryDate.slice(0, 4)
  if (!inRange(parseRuDate(row.created, year), filters.created)) return false
  if (!inRange(deliveryDate, filters.delivery)) return false
  for (const field of ALL_SELECTS) {
    const chosen = filters.select[field.key]
    if (chosen?.length && field.value && !chosen.includes(field.value(row))) return false
  }
  if (row.status === "Отменен" && !filters.checks.cancelled && !filters.select.status?.includes("Отменен")) return false
  if (filters.debtMin && -parseMoney(row.balance) <= parseMoney(filters.debtMin)) return false
  return true
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function RangeCalendar({ value, onChange }: { value: DateRange; onChange: (value: DateRange) => void }) {
  const { t } = useLanguage()
  const base = value.from ? new Date(value.from) : new Date()
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() })
  const first = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const days = new Date(view.year, view.month + 1, 0).getDate()
  const title = new Date(view.year, view.month, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const shift = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1)
    setView({ year: d.getFullYear(), month: d.getMonth() })
  }
  const pick = (date: string) => {
    if (!value.from || value.to) onChange({ from: date, to: "" })
    else onChange(date < value.from ? { from: date, to: value.from } : { from: value.from, to: date })
  }
  return (
    <div className="w-[280px] select-none text-[13px]">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="prev" className="px-2 text-lg text-[#5d6474]">‹</button>
        <span className="font-semibold capitalize">{title}</span>
        <button type="button" onClick={() => shift(1)} aria-label="next" className="px-2 text-lg text-[#5d6474]">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-[#999]">
        {WEEKDAYS.map((d) => <span key={d} className="py-1">{t(d)}</span>)}
      </div>
      <div className="grid grid-cols-7 text-center">
        {Array.from({ length: first }).map((_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = iso(view.year, view.month, i + 1)
          const edge = date === value.from || date === value.to
          const between = value.from && value.to && date > value.from && date < value.to
          return (
            <button key={date} type="button" onClick={() => pick(date)} className={`h-8 ${edge ? "rounded-full bg-[#4f71dc] text-white" : between ? "bg-[#e3e9fb]" : "hover:bg-[#f2f5f8]"}`}>
              {i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: DateRange; onChange: (value: DateRange) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const text = value.from || value.to ? `${value.from || "…"} — ${value.to || "…"}` : t("Укажите дату")
  return (
    <div className="relative h-[37px] w-[256px] border-b border-[#e0e0e0]">
      <span className="absolute left-0 top-0 flex items-center gap-[3px] text-[10px] font-bold leading-3">
        {t(label)}
        <CalendarDays className="h-3 w-3 text-[#bbb]" />
      </span>
      <button type="button" onClick={() => setOpen((v) => !v)} className="absolute inset-x-0 top-[12px] h-[24px] text-left text-[13px] leading-[24px]">{text}</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[37px] z-20 bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <RangeCalendar value={value} onChange={onChange} />
            <div className="mt-2 flex justify-between">
              <button type="button" onClick={() => onChange({ from: "", to: "" })} className="text-[13px] font-semibold text-[#5d6474]">{t("Очистить")}</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[13px] font-semibold text-[#4f71dc]">OK</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

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

function TextBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block h-[52px] border-b border-[#e0e0e0]">
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black" />
    </label>
  )
}

export function OrderFilterPanel({ orders, filters, onChange, onApply, onClose }: { orders: Order[]; filters: OrderFilters; onChange: (filters: OrderFilters) => void; onApply: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [reference, setReference] = useState<Record<string, string[]>>({})

  useEffect(() => {
    let cancelled = false
    const endpoints = Array.from(new Set(Object.values(REFERENCE_ENDPOINTS)))
    Promise.all(
      endpoints.map((endpoint) =>
        fetch(`/api/${endpoint}`)
          .then((response) => (response.ok ? response.json() : []))
          .then((items: Array<{ name?: string; fullName?: string }>) =>
            [endpoint, Array.isArray(items) ? Array.from(new Set(items.map((item) => item.name ?? item.fullName ?? "").filter(Boolean))) : []] as const,
          )
          .catch(() => [endpoint, []] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setReference(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const optionsFor = (field: SelectField) => {
    const fromOrders = field.value ? orders.map(field.value).filter(Boolean) : []
    const fromReference = REFERENCE_ENDPOINTS[field.key] ? (reference[REFERENCE_ENDPOINTS[field.key]] ?? []) : []
    const fixed = STATIC_OPTIONS[field.key] ?? []
    const dynamic = Array.from(new Set([...fromOrders, ...fromReference])).filter((option) => !fixed.includes(option)).sort((a, b) => a.localeCompare(b))
    return [...fixed, ...dynamic]
  }

  const setSelect = (key: string, value: string[]) => onChange({ ...filters, select: { ...filters.select, [key]: value } })

  const renderSelect = (field: SelectField) => (
    <SelectBox key={field.key} label={RAW_LABELS.has(field.label) ? field.label : t(field.label)} value={filters.select[field.key] ?? []} options={optionsFor(field)} onChange={(value) => setSelect(field.key, value)} />
  )

  return (
    <div className="bg-white px-[20px] pb-5 pt-[23px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-normal text-[#757575]">{t("Фильтр")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#999] hover:text-[#666]">
          <X className="h-6 w-6 rounded-full border-2 border-current p-[2px]" />
        </button>
      </div>

      <div className="mt-[18px] grid grid-cols-1 gap-x-[10.2px] gap-y-[15px] sm:grid-cols-2 xl:grid-cols-4">
        {DATE_FIELDS.slice(0, 4).map((field) => (
          <DateField
            key={field.key}
            label={field.label}
            value={field.key === "created" || field.key === "delivery" ? filters[field.key] : { from: "", to: "" }}
            onChange={(value) => (field.key === "created" || field.key === "delivery") && onChange({ ...filters, [field.key]: value })}
          />
        ))}
        <DateField label={DATE_FIELDS[4].label} value={{ from: "", to: "" }} onChange={() => {}} />
        {SELECT_FIELDS.map(renderSelect)}
        <TextBox label="Долг клиента больше" value={filters.debtMin} onChange={(value) => onChange({ ...filters, debtMin: value.replace(/[^\d]/g, "") })} />
        <TextBox label={t("Номер счет фактура")} value={filters.invoiceNumber} onChange={(value) => onChange({ ...filters, invoiceNumber: value })} />
        {SELECT_FIELDS_AFTER_DEBT.map(renderSelect)}
      </div>

      <h4 className="mt-6 border-b-2 border-[#9fa8da] pb-1 text-[12px] font-bold text-[#7986cb]">{t("Дополнительно")}</h4>
      <div className="mt-3 grid grid-cols-1 gap-x-[10.2px] gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {CHECKS.map((check) => (
          <label key={check.key} className="flex cursor-pointer items-start gap-2 px-[3px] text-[13px] font-semibold">
            <input
              type="checkbox"
              checked={!!filters.checks[check.key]}
              onChange={(event) => onChange({ ...filters, checks: { ...filters.checks, [check.key]: event.target.checked } })}
              className="mt-[2px] h-[15px] w-[15px] shrink-0 accent-[#5d6474]"
            />
            {RAW_LABELS.has(check.label) ? check.label : t(check.label)}
          </label>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onApply} className="h-9 rounded-[3px] bg-[#5d6474] px-4 text-[13px] font-medium uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:brightness-110">
          {t("Применить")}
        </button>
        {countOrderFilters(filters) > 0 && (
          <button type="button" onClick={() => onChange(EMPTY_ORDER_FILTERS)} className="h-9 rounded-[3px] border border-[#e0e0e0] bg-white px-4 text-[13px] font-medium uppercase text-[#5d6474] hover:bg-[#f2f5f8]">
            {t("Сбросить")}
          </button>
        )}
      </div>
    </div>
  )
}
