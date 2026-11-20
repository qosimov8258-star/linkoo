"use client"

import { useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { FilterCheck, FilterTextMui, RefFilterPanel } from "@/components/ref/list-kit"
import { LinkoMultiField, LinkoSingleField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { formatStatementDate, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

import type { Incoming } from "./supplier-incomings-data"

// The filter of «Приход от поставщиков» (Linko's #/supply): its fields, the address it writes on «Применить» and the
// rule each field applies to the list.
// - Филиалы, Поставщик, Склад, Товар, Организация and Тип are multi-selects whose ids Linko joins with "-"
//   (provider=79-78); Тип оплаты is a single select (cash / bank).
// - The address keys are Linko's: branch, provider, stock, product, division, paymentType, status (0 Ожидает,
//   1 В процессе, 2 Принят, 4 Отменен), contract, invoiceNumber, invoiceFromDate / invoiceToDate,
//   deliveryFromDate / deliveryToDate, transferPeriodFromDate / transferPeriodToDate, createdFromDate / createdToDate,
//   exclude and excludeInventory; «Применить» also writes openFilterDialog=false and page=1.
// - «Фильтр: N элемента» counts the filter keys present in the address (each date bound and both checkboxes count).

export type IncomingsFilter = {
  branch: string[]
  provider: string[]
  stock: string[]
  product: string[]
  division: string[]
  /** "cash" | "bank" | "". */
  paymentType: string
  /** Linko's status codes ("0", "1", "2", "4"). */
  status: string[]
  contract: string
  invoiceNumber: string
  invoiceFrom: string
  invoiceTo: string
  deliveryFrom: string
  deliveryTo: string
  transferFrom: string
  transferTo: string
  createdFrom: string
  createdTo: string
  /** «Исключить отмененные поставки» (Linko's default: on). */
  exclude: boolean
  excludeInventory: boolean
}

export const EMPTY_INCOMINGS_FILTER: IncomingsFilter = {
  branch: [],
  provider: [],
  stock: [],
  product: [],
  division: [],
  paymentType: "",
  status: [],
  contract: "",
  invoiceNumber: "",
  invoiceFrom: "",
  invoiceTo: "",
  deliveryFrom: "",
  deliveryTo: "",
  transferFrom: "",
  transferTo: "",
  createdFrom: "",
  createdTo: "",
  exclude: true,
  excludeInventory: false,
}

const LIST_KEYS = ["branch", "provider", "stock", "product", "division", "status"] as const
const TEXT_KEYS = ["paymentType", "contract", "invoiceNumber"] as const
const DATE_KEYS: Array<[keyof IncomingsFilter, string]> = [
  ["invoiceFrom", "invoiceFromDate"],
  ["invoiceTo", "invoiceToDate"],
  ["deliveryFrom", "deliveryFromDate"],
  ["deliveryTo", "deliveryToDate"],
  ["transferFrom", "transferPeriodFromDate"],
  ["transferTo", "transferPeriodToDate"],
  ["createdFrom", "createdFromDate"],
  ["createdTo", "createdToDate"],
]
/** Every address key the filter owns. */
export const INCOMINGS_FILTER_PARAMS = [...LIST_KEYS, ...TEXT_KEYS, ...DATE_KEYS.map(([, param]) => param), "exclude", "excludeInventory"]

/** Linko's status codes of the «Тип» field, in its order. */
export const INCOMING_STATUS_OPTIONS: LinkoOption[] = [
  { value: "0", label: "Ожидает" },
  { value: "1", label: "В процессе" },
  { value: "2", label: "Принят" },
  { value: "4", label: "Отменен" },
]
const STATUS_OF_CODE: Record<string, Incoming["status"] | undefined> = { "0": "ожидает", "2": "принят", "4": "отменен" }
const PAYMENT_OPTIONS: LinkoOption[] = [
  { value: "bank", label: "Банковский счет" },
  { value: "cash", label: "Наличный" },
]
const PAYMENT_OF_CODE: Record<string, Incoming["paymentType"]> = { bank: "Банковский счет", cash: "Наличный" }

const isDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "")
const ids = (value: string | null) => [...new Set(String(value ?? "").split("-").map((part) => part.trim()).filter((part) => /^\d{1,10}$/.test(part)))]

/** The filter of an address (keys it does not know are ignored; no exclude key = Linko's default, on). */
export function readIncomingsFilter(params: URLSearchParams): IncomingsFilter {
  const filter: IncomingsFilter = { ...EMPTY_INCOMINGS_FILTER }
  for (const key of LIST_KEYS) filter[key] = ids(params.get(key))
  filter.status = filter.status.filter((code) => INCOMING_STATUS_OPTIONS.some((option) => option.value === code))
  const payment = params.get("paymentType")
  filter.paymentType = payment === "cash" || payment === "bank" ? payment : ""
  filter.contract = (params.get("contract") ?? "").slice(0, 200)
  filter.invoiceNumber = (params.get("invoiceNumber") ?? "").slice(0, 200)
  for (const [key, param] of DATE_KEYS) (filter[key] as string) = isDay(params.get(param))
  filter.exclude = params.get("exclude") !== "false"
  filter.excludeInventory = params.get("excludeInventory") === "true"
  return filter
}

/** The address change of «Применить»: every filter key set or removed, Linko's openFilterDialog=false and page=1. */
export function incomingsFilterPatch(filter: IncomingsFilter): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const key of LIST_KEYS) patch[key] = filter[key].length ? filter[key].join("-") : null
  for (const key of TEXT_KEYS) patch[key] = filter[key].trim() ? filter[key].trim() : null
  for (const [key, param] of DATE_KEYS) patch[param] = (filter[key] as string) || null
  patch.exclude = filter.exclude ? "true" : "false"
  patch.excludeInventory = filter.excludeInventory ? "true" : "false"
  patch.openFilterDialog = "false"
  patch.page = "1"
  return patch
}

/** «Фильтр: N элемента»: the filter keys present in the address. */
export function incomingsFilterCount(params: URLSearchParams): number {
  return INCOMINGS_FILTER_PARAMS.filter((key) => params.has(key)).length
}

/** Names behind the filter's ids, for rows without the ids (supplies entered here). */
export type IncomingsLookups = {
  branches: Map<string, string>
  suppliers: Map<string, string>
  warehouses: Map<string, string>
  organizations: Map<string, string>
  products: Map<string, string>
  /** Warehouse ids by name (the search matches a warehouse id, as Linko's does). */
  warehouseIds: Map<string, string[]>
}

const inDays = (day: string, from: string, to: string) => !(from || to) || (Boolean(day) && (!from || day >= from) && (!to || day <= to))
const dayOf = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "")

/** Linko's server rule for each field (texts compared exactly, as Linko does). */
export function incomingMatchesFilter(row: Incoming, filter: IncomingsFilter, lookups: IncomingsLookups, acceptedDay: (row: Incoming) => string): boolean {
  if (filter.exclude && row.status === "отменен") return false
  if (filter.excludeInventory && row.isInventory) return false
  if (filter.status.length && !filter.status.some((code) => STATUS_OF_CODE[code] === row.status)) return false
  if (filter.paymentType && row.paymentType !== PAYMENT_OF_CODE[filter.paymentType]) return false
  // The row's id when it has one (a supply copied from Linko), else the id's name.
  const picked = (selected: string[], rowId: number | null | undefined, names: Map<string, string>, value: string) =>
    !selected.length || selected.some((id) => (rowId != null ? String(rowId) === id : names.get(id) === value))
  if (!picked(filter.provider, row.supplierId, lookups.suppliers, row.supplier)) return false
  if (!picked(filter.branch, row.branchId, lookups.branches, row.branch)) return false
  if (!picked(filter.stock, row.warehouseId, lookups.warehouses, row.warehouse)) return false
  if (!picked(filter.division, row.organizationId, lookups.organizations, row.organization)) return false
  // A line copied from Linko carries its catalog key; a line entered here only the product's name.
  if (filter.product.length && !row.items.some((item) => filter.product.some((id) => (item.key ? item.key === `product:${id}` : item.product === lookups.products.get(id))))) return false
  if (filter.contract.trim() && row.contractNumber.trim() !== filter.contract.trim()) return false
  if (filter.invoiceNumber.trim() && row.invoiceNumber.trim() !== filter.invoiceNumber.trim()) return false
  if (!inDays(dayOf(row.invoiceDate), filter.invoiceFrom, filter.invoiceTo)) return false
  if (!inDays(dayOf(row.date), filter.deliveryFrom, filter.deliveryTo)) return false
  if (!inDays(acceptedDay(row), filter.transferFrom, filter.transferTo)) return false
  if (!inDays(row.createdDay ?? "", filter.createdFrom, filter.createdTo)) return false
  return true
}

/** Linko's search (a DRF search over id, supplier, contact name, comment and warehouse id): every word of the query
 * must be found, ignoring case, in one of them. */
export function incomingMatchesSearch(row: Incoming, query: string, lookups: IncomingsLookups): boolean {
  const words = query.toLocaleLowerCase("ru").split(/[\s,]+/).filter(Boolean)
  if (!words.length) return true
  const warehouseIds = row.warehouseId != null ? [String(row.warehouseId)] : (lookups.warehouseIds.get(row.warehouse) ?? [])
  const fields = [String(row.id), row.supplier, row.contactName ?? "", row.comment, ...warehouseIds].map((text) => text.toLocaleLowerCase("ru"))
  return words.every((word) => fields.some((text) => text.includes(word)))
}

/** Linko's option order (its database collation: case and punctuation ignored, digits, Latin, then Cyrillic). */
export function linkoOrder(a: string, b: string) {
  return a.localeCompare(b, "en", { sensitivity: "base", ignorePunctuation: true })
}

const CALENDAR = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"

/** Linko's date field of this filter (67 px): the small label, «Укажите дату», one day («20 нояб. 2026») or a range
 * («01 окт. 2026 – 31 окт. 2026»), a × once set and the calendar at the right end. Also the supplier returns filter's. */
export function SupplyDateField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const day = (iso: string) => formatStatementDate(iso, language, false).replace(/\s*г\.$/, "")
  const from = begin || end
  const to = end || begin
  const today = todayIso()
  return (
    <div className="relative h-[67px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-0 h-[60px] w-full cursor-pointer text-left">
        <span className="absolute left-0 top-[9px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
        <span className="absolute left-0 right-[48px] top-[37px] truncate text-[13px] leading-4 text-black">{from ? (from === to ? day(from) : `${day(from)} – ${day(to)}`) : t("Укажите дату")}</span>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[36px] h-[18px] w-[18px] fill-[#8a90a0]" aria-hidden>
          <path d={CALENDAR} />
        </svg>
        <span className="absolute inset-x-0 top-[58px] h-px bg-[#e0e0e0]" />
      </button>
      {from && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-[22px] top-[36px] flex h-[18px] w-[18px] items-center justify-center text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]">
          ×
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={from || today}
          end={to || today}
          positionClassName="left-0 top-[75px]"
          onClose={() => setOpen(false)}
          onApply={(nextBegin, nextEnd) => {
            onChange(nextBegin, nextEnd)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

export type IncomingsFilterOptions = {
  branches: LinkoOption[]
  suppliers: LinkoOption[]
  warehouses: LinkoOption[]
  products: LinkoOption[]
  organizations: LinkoOption[]
}

/** The panel edits a draft of the applied filter; «Применить» hands it over, × closes the panel and keeps the
 * applied one. */
export function SupplierIncomingsFilterPanel({
  initial,
  options,
  onApply,
  onClose,
}: {
  initial: IncomingsFilter
  options: IncomingsFilterOptions | null
  onApply: (filter: IncomingsFilter) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(initial)
  const set = <K extends keyof IncomingsFilter>(key: K, value: IncomingsFilter[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const translated = (list: LinkoOption[]) => list.map((option) => ({ ...option, label: t(option.label) }))
  return (
    <RefFilterPanel narrow applyClassName="mt-[25px]" onClose={onClose} onApply={() => onApply(draft)} className="!w-[310px]">
      <LinkoMultiField label={t("Филиалы")} options={options?.branches ?? null} value={draft.branch} onChange={(value) => set("branch", value)} />
      {/* Linko's supplier and product lists show their first 50 (newest first) until a name is typed. */}
      <LinkoMultiField label={t("Поставщик")} options={options?.suppliers ?? null} limit={50} value={draft.provider} onChange={(value) => set("provider", value)} />
      <LinkoMultiField label={t("Склад")} options={options?.warehouses ?? null} value={draft.stock} onChange={(value) => set("stock", value)} />
      <LinkoMultiField label={t("Товар")} options={options?.products ?? null} limit={50} value={draft.product} onChange={(value) => set("product", value)} />
      <LinkoMultiField label={t("Организация")} options={options?.organizations ?? null} value={draft.division} onChange={(value) => set("division", value)} />
      <LinkoSingleField label={t("Тип оплаты")} options={translated(PAYMENT_OPTIONS)} value={draft.paymentType} onChange={(value) => set("paymentType", value)} />
      <LinkoMultiField label={t("Тип")} options={translated(INCOMING_STATUS_OPTIONS)} value={draft.status} onChange={(value) => set("status", value)} />
      <FilterTextMui className="w-[256px]" label={t("Номер договора")} value={draft.contract} onChange={(value) => set("contract", value)} />
      <FilterTextMui label={t("Номер счет фактуры")} value={draft.invoiceNumber} onChange={(value) => set("invoiceNumber", value)} />
      <SupplyDateField label="Дата счет фактуры" begin={draft.invoiceFrom} end={draft.invoiceTo} onChange={(begin, end) => setDraft((current) => ({ ...current, invoiceFrom: begin, invoiceTo: end }))} />
      <SupplyDateField label="Дата поставки" begin={draft.deliveryFrom} end={draft.deliveryTo} onChange={(begin, end) => setDraft((current) => ({ ...current, deliveryFrom: begin, deliveryTo: end }))} />
      <SupplyDateField label="Период передачи со склада" begin={draft.transferFrom} end={draft.transferTo} onChange={(begin, end) => setDraft((current) => ({ ...current, transferFrom: begin, transferTo: end }))} />
      <SupplyDateField label="Дата создания" begin={draft.createdFrom} end={draft.createdTo} onChange={(begin, end) => setDraft((current) => ({ ...current, createdFrom: begin, createdTo: end }))} />
      <FilterCheck compact label={t("Исключить отмененные поставки")} checked={draft.exclude} onChange={(value) => set("exclude", value)} className="mt-[10px] w-[235.5px]" />
      <FilterCheck compact label={t("Исключить инвентаризации")} checked={draft.excludeInventory} onChange={(value) => set("excludeInventory", value)} className="mt-[10px]" />
    </RefFilterPanel>
  )
}
