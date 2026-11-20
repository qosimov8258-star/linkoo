"use client"

import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import type { CashQuery } from "@/components/analytics/cash/use-cash"
import { FilterDate, FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { LinkoMultiField, LinkoSingleField } from "@/components/ref/linko-select-fields"
import { ReportMultiChipField } from "@/components/ref/report-kit"
import { compareCurrencyCodes, currencyLabel } from "@/lib/finance/currency"
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
  /** Linko's «Тип оплаты»: cash | bank. */
  paymentType: string
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
type TextKey = "marketTypeParent" | "marketType" | "user" | "acceptedBy" | "status" | "showInvoice" | "currency" | "paymentType"

const LIST_KEYS: ListKey[] = ["branch", "deliveryMan", "division", "cashbox", "border", "client", "marketResponsibleAgent", "marketResponsibleDeliveryMan"]
const DAY_KEYS: DayKey[] = ["fromDate", "toDate", "beginAcceptedTime", "endAcceptedTime", "beginInvoiceDate", "endInvoiceDate"]
const TEXT_KEYS: TextKey[] = ["marketTypeParent", "marketType", "user", "acceptedBy", "status", "showInvoice", "currency", "paymentType"]

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
    paymentType: "",
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
  if (!["cash", "bank"].includes(filters.paymentType)) filters.paymentType = ""
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
    // Linko's «Клиент» (client=<id>) is a financial account.
    account: f.client,
    paymentType: f.paymentType,
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

const names = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))

/** Linko's ClientTransactionFilterForm: a panel over the whole list, its fields four per row in Linko's order
 * («Применить» applies the draft). */
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
  const set = <K extends keyof CustomerPaymentsFilters>(key: K) => (value: CustomerPaymentsFilters[K]) => onChange({ ...draft, [key]: value })
  const list = (values: string[] | undefined): Option[] | null => (options ? names(values ?? []) : null)
  const typeOptions: Option[] | null = options
    ? [...(options.untyped ? [{ value: NO_CLIENT_TYPE, label: t("Не указано") }] : []), ...names(options.clientTypes)]
    : null
  // Linko's user fields list the active staff in their order (by id).
  const staff = options ? names([...new Set([...options.employees].sort((a, b) => a.id - b.id).map((employee) => employee.name))]) : null
  const period = (label: string, from: DayKey, to: DayKey) => (
    <FilterDate iconEnd className="!h-[67px]" label={t(label)} begin={draft[from]} end={draft[to]} onChange={(begin, end) => onChange({ ...draft, [from]: begin, [to]: end })} />
  )
  return (
    <RefFilterPanel onClose={onClose} onApply={onApply} applyClassName="mt-[15px]">
      <div className="grid grid-cols-4 items-end gap-x-5 gap-y-[5px]">
        {period("Дата оплаты", "fromDate", "toDate")}
        {period("Дата получения", "beginAcceptedTime", "endAcceptedTime")}
        {period("Дата счет фактуры", "beginInvoiceDate", "endInvoiceDate")}
        <LinkoMultiField label="Филиалы" options={list(options?.branches)} value={draft.branch} onChange={set("branch")} />
        <LinkoMultiField label="Доставщик" options={list(options?.deliverers)} value={draft.deliveryMan} onChange={set("deliveryMan")} />
        <LinkoMultiField label="Организация" options={list(options?.organizations)} value={draft.division} onChange={set("division")} />
        <LinkoSingleField label="Тип клиента" options={typeOptions} value={draft.marketTypeParent} onChange={(value) => onChange({ ...draft, marketTypeParent: value, marketType: "" })} />
        {draft.marketTypeParent && <LinkoSingleField label="Подкатегория" options={[]} value={draft.marketType} onChange={set("marketType")} />}
        <LinkoMultiField
          label="Касса"
          options={options ? options.cashboxes.map((cashbox) => ({ value: String(cashbox.id), label: cashbox.name })) : null}
          value={draft.cashbox}
          onChange={set("cashbox")}
        />
        <LinkoMultiField label="Зона" options={list(options?.zones)} value={draft.border} onChange={set("border")} />
        <LinkoMultiField
          label="Клиент"
          options={options ? (options.accounts ?? []).map((account) => ({ value: String(account.id), label: account.name })) : null}
          value={draft.client}
          onChange={set("client")}
        />
        <LinkoSingleField label="Создал" options={staff} value={draft.user} onChange={set("user")} />
        <LinkoSingleField label="Принял" options={staff} value={draft.acceptedBy} onChange={set("acceptedBy")} />
        <LinkoMultiField label="Ответственный агент магазина" options={list(options?.agents)} value={draft.marketResponsibleAgent} onChange={set("marketResponsibleAgent")} />
        <LinkoMultiField label="Ответственный доставщик магазина" options={list(options?.deliverers)} value={draft.marketResponsibleDeliveryMan} onChange={set("marketResponsibleDeliveryMan")} />
        <LinkoSingleField
          label="Подтверждение клиента"
          options={CLIENT_CONFIRMATIONS.map((status) => ({ value: status, label: t(CLIENT_CONFIRMATION_FILTER_LABELS[status]) }))}
          value={draft.status}
          onChange={set("status")}
        />
        <LinkoSingleField
          label="Счета фактура"
          options={[
            { value: "set", label: t("Установлен") },
            { value: "not_set", label: t("Не установлен") },
          ]}
          value={draft.showInvoice}
          onChange={set("showInvoice")}
        />
        <LinkoSingleField
          label="Валюта"
          options={options ? [...options.currencies].sort((a, b) => compareCurrencyCodes(a.code, b.code)).map((currency) => ({ value: currency.code, label: currencyLabel(currency.code) })) : null}
          value={draft.currency}
          onChange={set("currency")}
        />
        <LinkoSingleField
          label="Тип оплаты"
          options={[
            { value: "bank", label: t("Банковский счет") },
            { value: "cash", label: t("Наличный") },
          ]}
          value={draft.paymentType}
          onChange={set("paymentType")}
        />
      </div>
    </RefFilterPanel>
  )
}
