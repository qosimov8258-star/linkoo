"use client"

import type { ReactNode } from "react"

import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import type { CashQuery } from "@/components/analytics/cash/use-cash"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { FilterDate, FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { ReportMultiChipField } from "@/components/ref/report-kit"
import { formatStatementDate, isIsoDay } from "@/lib/finance/dates"
import { NO_CLIENT_TYPE } from "@/lib/finance-client-balance-types"
import {
  CLIENT_CONFIRMATION_FILTER_LABELS,
  CLIENT_CONFIRMATIONS,
  CUSTOMER_PAYMENT_TABS,
  type CustomerPaymentOptions,
  type CustomerPaymentTab,
} from "@/lib/cash/customer-payments-types"
import { useLanguage } from "@/lib/i18n/language-context"

// URL state and the filter panel of "Оплаты от клиентов" (demo #/client-transaction,
// ClientTransactionFilterForm module 2120). Param names are the demo's
// (showTab, fromDate, toDate, beginAcceptedTime, division, marketTypeParent,
// border, marketResponsibleAgent, …); multi values are repeated params (names
// may contain "-"), the selection is "select=12-15-19" like the demo.

export type CustomerPaymentsFilters = {
  branch: string[]
  deliveryMan: string[]
  division: string[]
  marketTypeParent: string
  marketType: string
  cashbox: string[]
  border: string[]
  client: string[]
  user: string
  acceptedBy: string
  marketResponsibleAgent: string[]
  marketResponsibleDeliveryMan: string[]
  status: string
  fromDate: string
  toDate: string
  beginAcceptedTime: string
  endAcceptedTime: string
  beginInvoiceDate: string
  endInvoiceDate: string
  showInvoice: string
  currency: string
  notAccept: boolean
}

export type CustomerPaymentsState = {
  tab: CustomerPaymentTab
  filters: CustomerPaymentsFilters
  search: string
  page: number
  pageSize: number
  /** Demo ordering key ("-id", "client", …); "" = default. */
  ordering: string
  showCheckboxes: boolean
  select: number[]
}

type ListKey = "branch" | "deliveryMan" | "division" | "cashbox" | "border" | "client" | "marketResponsibleAgent" | "marketResponsibleDeliveryMan"
type DayKey = "fromDate" | "toDate" | "beginAcceptedTime" | "endAcceptedTime" | "beginInvoiceDate" | "endInvoiceDate"
type TextKey = "marketTypeParent" | "marketType" | "user" | "acceptedBy" | "status" | "showInvoice" | "currency"

const LIST_KEYS: ListKey[] = ["branch", "deliveryMan", "division", "cashbox", "border", "client", "marketResponsibleAgent", "marketResponsibleDeliveryMan"]
const DAY_KEYS: DayKey[] = ["fromDate", "toDate", "beginAcceptedTime", "endAcceptedTime", "beginInvoiceDate", "endInvoiceDate"]
const TEXT_KEYS: TextKey[] = ["marketTypeParent", "marketType", "user", "acceptedBy", "status", "showInvoice", "currency"]

export const CUSTOMER_PAYMENTS_PAGE_SIZE = 25

export function emptyCustomerPaymentFilters(): CustomerPaymentsFilters {
  return {
    branch: [],
    deliveryMan: [],
    division: [],
    marketTypeParent: "",
    marketType: "",
    cashbox: [],
    border: [],
    client: [],
    user: "",
    acceptedBy: "",
    marketResponsibleAgent: [],
    marketResponsibleDeliveryMan: [],
    status: "",
    fromDate: "",
    toDate: "",
    beginAcceptedTime: "",
    endAcceptedTime: "",
    beginInvoiceDate: "",
    endInvoiceDate: "",
    showInvoice: "",
    currency: "",
    notAccept: false,
  }
}

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

export function stateFromParams(params: ParamReader): CustomerPaymentsState {
  const filters = emptyCustomerPaymentFilters()
  for (const key of LIST_KEYS) filters[key] = params.getAll(key).map((value) => value.trim()).filter(Boolean)
  for (const key of DAY_KEYS) {
    const value = params.get(key)?.trim() ?? ""
    filters[key] = isIsoDay(value) ? value : ""
  }
  for (const key of TEXT_KEYS) filters[key] = params.get(key)?.trim() ?? ""
  if (!["set", "not_set"].includes(filters.showInvoice)) filters.showInvoice = ""
  if (!(CLIENT_CONFIRMATIONS as readonly string[]).includes(filters.status)) filters.status = ""
  filters.notAccept = ["1", "true"].includes(params.get("notAccept") ?? "")
  const tab = params.get("showTab") ?? ""
  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize"))
  return {
    tab: (CUSTOMER_PAYMENT_TABS as readonly string[]).includes(tab) ? (tab as CustomerPaymentTab) : "all",
    filters,
    search: params.get("search")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : CUSTOMER_PAYMENTS_PAGE_SIZE,
    ordering: params.get("ordering")?.trim() ?? "",
    // The menu link carries showCheckboxes=true (demo); a bare URL shows the list without checkboxes.
    showCheckboxes: params.get("showCheckboxes") === "true",
    select: (params.get("select") ?? "")
      .split("-")
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0),
  }
}

export function stateToSearch(state: CustomerPaymentsState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  params.set("showCheckboxes", state.showCheckboxes ? "true" : "false")
  if (state.tab !== "all") params.set("showTab", state.tab)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  const f = state.filters
  for (const key of LIST_KEYS) f[key].forEach((value) => params.append(key, value))
  for (const key of [...DAY_KEYS, ...TEXT_KEYS]) if (f[key]) params.set(key, f[key])
  if (f.notAccept) params.set("notAccept", "true")
  if (state.select.length) params.set("select", state.select.join("-"))
  return params.toString()
}

/** Demo "Фильтр: N элемента": non-empty filter keys except fromDate. */
export function countCustomerPaymentFilters(filters: CustomerPaymentsFilters): number {
  return Object.entries(filters).filter(([key, value]) => {
    if (key === "fromDate") return false
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  }).length
}

/** Params of GET /api/cash/customer-payments/total (every filter, the tab and the search; no paging). */
export function customerPaymentsTotalsQuery(state: CustomerPaymentsState): CashQuery {
  const f = state.filters
  return {
    tab: state.tab,
    search: state.search,
    from: f.fromDate,
    to: f.toDate,
    acceptedFrom: f.beginAcceptedTime,
    acceptedTo: f.endAcceptedTime,
    invoiceFrom: f.beginInvoiceDate,
    invoiceTo: f.endInvoiceDate,
    invoice: f.showInvoice,
    branch: f.branch,
    deliveryMan: f.deliveryMan,
    organization: f.division,
    clientType: f.marketTypeParent ? [f.marketTypeParent] : [],
    cashbox: f.cashbox,
    zone: f.border,
    client: f.client,
    createdBy: f.user ? [f.user] : [],
    acceptedBy: f.acceptedBy ? [f.acceptedBy] : [],
    responsibleAgent: f.marketResponsibleAgent,
    responsibleDeliverer: f.marketResponsibleDeliveryMan,
    status: f.status,
    currency: f.currency,
    notAccept: f.notAccept,
  }
}

/** Params of GET /api/cash/customer-payments (one page). */
export function customerPaymentsListQuery(state: CustomerPaymentsState): CashQuery {
  return { ...customerPaymentsTotalsQuery(state), ordering: state.ordering, page: state.page, pageSize: state.pageSize }
}

// Demo date cells: "07 сент. 2026, 20:03" / "01 мая 2026". The demo prints Russian
// months even in the uz UI; we follow the selected language like the other pages.
const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

export function formatRuDate(iso: string, withTime = true, language = "ru"): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso
  if (language !== "ru") return formatStatementDate(iso, language, withTime)
  const day = `${iso.slice(8, 10)} ${RU_SHORT_MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
  return withTime && iso.length >= 16 ? `${day}, ${iso.slice(11, 16)}` : day
}

// --- panel ------------------------------------------------------------------------

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]"

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

type Option = { value: string; label: string }

/** Reference-style (Material) filter fields over the {value,label} option lists of this page. */
export function RMulti({ label, value, options, onChange }: { label: string; value: string[]; options: Option[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const labelOf = (item: string) => options.find((option) => option.value === item)?.label ?? item
  return (
    <div className="relative h-[62px]">
      <ReportMultiChipField label={t(label)} values={value.map(labelOf)} options={options.map((option) => option.label)} onChange={(next) => onChange(next.map((name) => options.find((option) => option.label === name)?.value ?? name))} />
    </div>
  )
}

export function RSel({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (next: string) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return <FilterSelect label={t(label)} value={options.find((option) => option.value === value)?.label ?? ""} options={options.map((option) => option.label)} onChange={(name) => onChange(options.find((option) => option.label === name)?.value ?? "")} />
}

export function RDate({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  return <FilterDate label={t(label)} begin={from} end={to} onChange={onChange} />
}

function Select({ value, options, onChange, disabled = false }: { value: string; options: Option[]; onChange: (next: string) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} disabled:bg-[#f2f5f8]`}>
      <option value="">{disabled ? t("Нет данных") : t("Все")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function DayRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  return (
    <span className="flex items-center gap-2">
      <input type="date" value={from} aria-label={t("с")} onChange={(event) => onChange(event.target.value, to)} className={`${fieldClass} min-w-0 px-2`} />
      <span className="text-[#586174]">—</span>
      <input type="date" value={to} aria-label={t("по")} onChange={(event) => onChange(from, event.target.value)} className={`${fieldClass} min-w-0 px-2`} />
    </span>
  )
}

const names = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))

/** Inline 4-column filter panel ("Применить" applies the draft). */
export function CustomerPaymentsFilterPanel({
  draft,
  onChange,
  options,
  onApply,
  onClose,
}: {
  draft: CustomerPaymentsFilters
  onChange: (next: CustomerPaymentsFilters) => void
  options: CustomerPaymentOptions | null
  onApply: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const set = <K extends keyof CustomerPaymentsFilters>(key: K, value: CustomerPaymentsFilters[K]) => onChange({ ...draft, [key]: value })
  const typeOptions: Option[] = [
    ...(options?.untyped ? [{ value: NO_CLIENT_TYPE, label: t("Не указано") }] : []),
    ...names(options?.clientTypes ?? []),
  ]
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={onApply} className="!w-[310px] max-h-[calc(100vh-120px)] overflow-y-auto">
      <div className="grid grid-cols-1">
        <RMulti label="Филиалы" value={draft.branch} options={names(options?.branches ?? [])} onChange={(value) => set("branch", value)} />
        <RMulti label="Доставщик" value={draft.deliveryMan} options={names(options?.deliverers ?? [])} onChange={(value) => set("deliveryMan", value)} />
        <RMulti label="Организация" value={draft.division} options={names(options?.organizations ?? [])} onChange={(value) => set("division", value)} />
        <RSel label="Тип клиента" value={draft.marketTypeParent} options={typeOptions} onChange={(value) => onChange({ ...draft, marketTypeParent: value, marketType: "" })} />
        {draft.marketTypeParent && (
          <RSel label="Подкатегория" value={draft.marketType} options={[]} onChange={(value) => set("marketType", value)} disabled />
        )}
        <RMulti label="Касса"
            value={draft.cashbox}
            options={(options?.cashboxes ?? []).map((cashbox) => ({ value: String(cashbox.id), label: cashbox.name }))}
            onChange={(value) => set("cashbox", value)}
          />
        <RMulti label="Зона" value={draft.border} options={names(options?.zones ?? [])} onChange={(value) => set("border", value)} />
        <RMulti label="Клиент"
            value={draft.client}
            options={(options?.clients ?? []).map((client) => ({ value: String(client.id), label: client.name }))}
            onChange={(value) => set("client", value)}
          />
        <RSel label="Создал" value={draft.user} options={names(options?.users ?? [])} onChange={(value) => set("user", value)} />
        <RSel label="Принял" value={draft.acceptedBy} options={names(options?.acceptedBy ?? [])} onChange={(value) => set("acceptedBy", value)} />
        <RMulti label="Ответственный агент магазина" value={draft.marketResponsibleAgent} options={names(options?.agents ?? [])} onChange={(value) => set("marketResponsibleAgent", value)} />
        <RMulti label="Ответственный доставщик магазина"
            value={draft.marketResponsibleDeliveryMan}
            options={names(options?.deliverers ?? [])}
            onChange={(value) => set("marketResponsibleDeliveryMan", value)}
          />
        <RSel label="Подтверждение клиента"
            value={draft.status}
            options={CLIENT_CONFIRMATIONS.map((status) => ({ value: status, label: t(CLIENT_CONFIRMATION_FILTER_LABELS[status]) }))}
            onChange={(value) => set("status", value)}
          />
        <RDate label="Дата оплаты" from={draft.fromDate} to={draft.toDate} onChange={(from, to) => onChange({ ...draft, fromDate: from, toDate: to })} />
        <RDate label="Дата получения"
            from={draft.beginAcceptedTime}
            to={draft.endAcceptedTime}
            onChange={(from, to) => onChange({ ...draft, beginAcceptedTime: from, endAcceptedTime: to })}
          />
        <RDate label="Дата счет фактуры"
            from={draft.beginInvoiceDate}
            to={draft.endInvoiceDate}
            onChange={(from, to) => onChange({ ...draft, beginInvoiceDate: from, endInvoiceDate: to })}
          />
        <RSel label="Счета фактура"
            value={draft.showInvoice}
            options={[
              { value: "set", label: t("Установлен") },
              { value: "not_set", label: t("Не установлен") },
            ]}
            onChange={(value) => set("showInvoice", value)}
          />
        <RSel label="Валюта"
            value={draft.currency}
            options={(options?.currencies ?? []).map((currency) => ({ value: currency.code, label: currency.label }))}
            onChange={(value) => set("currency", value)}
          />
      </div>
    </RefFilterPanel>
  )
}
