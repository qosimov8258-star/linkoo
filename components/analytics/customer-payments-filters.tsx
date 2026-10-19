"use client"

import type { ReactNode } from "react"

import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import type { CashQuery } from "@/components/analytics/cash/use-cash"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
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
    // The menu opens the page with showCheckboxes=true (demo); only "Спрятать флажки" turns it off.
    showCheckboxes: params.get("showCheckboxes") !== "false",
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
}: {
  draft: CustomerPaymentsFilters
  onChange: (next: CustomerPaymentsFilters) => void
  options: CustomerPaymentOptions | null
  onApply: () => void
}) {
  const { t } = useLanguage()
  const set = <K extends keyof CustomerPaymentsFilters>(key: K, value: CustomerPaymentsFilters[K]) => onChange({ ...draft, [key]: value })
  const typeOptions: Option[] = [
    ...(options?.untyped ? [{ value: NO_CLIENT_TYPE, label: t("Не указано") }] : []),
    ...names(options?.clientTypes ?? []),
  ]
  return (
    <section className="border-b border-[#e1e5eb] bg-white px-4 py-5 md:px-9">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Филиалы">
          <MultiSelect value={draft.branch} options={names(options?.branches ?? [])} onChange={(value) => set("branch", value)} />
        </Field>
        <Field label="Доставщик">
          <MultiSelect value={draft.deliveryMan} options={names(options?.deliverers ?? [])} onChange={(value) => set("deliveryMan", value)} />
        </Field>
        <Field label="Организация">
          <MultiSelect value={draft.division} options={names(options?.organizations ?? [])} onChange={(value) => set("division", value)} />
        </Field>
        <Field label="Тип клиента">
          <Select value={draft.marketTypeParent} options={typeOptions} onChange={(value) => onChange({ ...draft, marketTypeParent: value, marketType: "" })} />
        </Field>
        {draft.marketTypeParent && (
          <Field label="Подкатегория">
            <Select value={draft.marketType} options={[]} onChange={(value) => set("marketType", value)} disabled />
          </Field>
        )}
        <Field label="Касса">
          <MultiSelect
            value={draft.cashbox}
            options={(options?.cashboxes ?? []).map((cashbox) => ({ value: String(cashbox.id), label: cashbox.name }))}
            onChange={(value) => set("cashbox", value)}
          />
        </Field>
        <Field label="Зона">
          <MultiSelect value={draft.border} options={names(options?.zones ?? [])} onChange={(value) => set("border", value)} />
        </Field>
        <Field label="Клиент">
          <MultiSelect
            value={draft.client}
            options={(options?.clients ?? []).map((client) => ({ value: String(client.id), label: client.name }))}
            onChange={(value) => set("client", value)}
          />
        </Field>
        <Field label="Создал">
          <Select value={draft.user} options={names(options?.users ?? [])} onChange={(value) => set("user", value)} />
        </Field>
        <Field label="Принял">
          <Select value={draft.acceptedBy} options={names(options?.acceptedBy ?? [])} onChange={(value) => set("acceptedBy", value)} />
        </Field>
        <Field label="Ответственный агент магазина">
          <MultiSelect value={draft.marketResponsibleAgent} options={names(options?.agents ?? [])} onChange={(value) => set("marketResponsibleAgent", value)} />
        </Field>
        <Field label="Ответственный доставщик магазина">
          <MultiSelect
            value={draft.marketResponsibleDeliveryMan}
            options={names(options?.deliverers ?? [])}
            onChange={(value) => set("marketResponsibleDeliveryMan", value)}
          />
        </Field>
        <Field label="Подтверждение клиента">
          <Select
            value={draft.status}
            options={CLIENT_CONFIRMATIONS.map((status) => ({ value: status, label: t(CLIENT_CONFIRMATION_FILTER_LABELS[status]) }))}
            onChange={(value) => set("status", value)}
          />
        </Field>
        <Field label="Дата оплаты">
          <DayRange from={draft.fromDate} to={draft.toDate} onChange={(from, to) => onChange({ ...draft, fromDate: from, toDate: to })} />
        </Field>
        <Field label="Дата получения">
          <DayRange
            from={draft.beginAcceptedTime}
            to={draft.endAcceptedTime}
            onChange={(from, to) => onChange({ ...draft, beginAcceptedTime: from, endAcceptedTime: to })}
          />
        </Field>
        <Field label="Дата счет фактуры">
          <DayRange
            from={draft.beginInvoiceDate}
            to={draft.endInvoiceDate}
            onChange={(from, to) => onChange({ ...draft, beginInvoiceDate: from, endInvoiceDate: to })}
          />
        </Field>
        <Field label="Счета фактура">
          <Select
            value={draft.showInvoice}
            options={[
              { value: "set", label: t("Установлен") },
              { value: "not_set", label: t("Не установлен") },
            ]}
            onChange={(value) => set("showInvoice", value)}
          />
        </Field>
        <Field label="Валюта">
          <Select
            value={draft.currency}
            options={(options?.currencies ?? []).map((currency) => ({ value: currency.code, label: currency.label }))}
            onChange={(value) => set("currency", value)}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onApply} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
          {t("Применить")}
        </button>
      </div>
    </section>
  )
}
