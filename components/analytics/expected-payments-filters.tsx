"use client"

import { RefFilterPanel } from "@/components/ref/list-kit"
import { useState, type ReactNode } from "react"

import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import type { CashQuery } from "@/components/analytics/cash/use-cash"
import { RDate, RMulti, RSel } from "@/components/analytics/customer-payments-filters"
import { PaymentModal } from "@/components/analytics/customer-payments-dialogs"
import type { CustomerPaymentOptions } from "@/lib/cash/customer-payments-types"
import { isIsoDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// URL state and filter popup of "Ожидаемые оплаты" (demo #/pending-payments,
// PendingPaymentsFilterForm module 4379). Demo param names: branch, client,
// agent, paymentType, deliveryMan, division, status, fromDate/toDate (created),
// fromDateSecond/toDateSecond (delivery), fromDateThird/toDateThird (payment
// date). No period is pre-set (periodInitial: false).

export type ExpectedPaymentsFilters = {
  branch: string[]
  client: string[]
  agent: string[]
  paymentType: string
  deliveryMan: string[]
  division: string[]
  status: string
  fromDate: string
  toDate: string
  fromDateSecond: string
  toDateSecond: string
  fromDateThird: string
  toDateThird: string
}

export type ExpectedPaymentsState = {
  filters: ExpectedPaymentsFilters
  search: string
  page: number
  pageSize: number
  ordering: string
  showCheckboxes: boolean
}

type ListKey = "branch" | "client" | "agent" | "deliveryMan" | "division"
type DayKey = "fromDate" | "toDate" | "fromDateSecond" | "toDateSecond" | "fromDateThird" | "toDateThird"

const LIST_KEYS: ListKey[] = ["branch", "client", "agent", "deliveryMan", "division"]
const DAY_KEYS: DayKey[] = ["fromDate", "toDate", "fromDateSecond", "toDateSecond", "fromDateThird", "toDateThird"]

export const EXPECTED_PAYMENTS_PAGE_SIZE = 25

export function emptyExpectedFilters(): ExpectedPaymentsFilters {
  return {
    branch: [],
    client: [],
    agent: [],
    paymentType: "",
    deliveryMan: [],
    division: [],
    status: "",
    fromDate: "",
    toDate: "",
    fromDateSecond: "",
    toDateSecond: "",
    fromDateThird: "",
    toDateThird: "",
  }
}

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

export function expectedStateFromParams(params: ParamReader): ExpectedPaymentsState {
  const filters = emptyExpectedFilters()
  for (const key of LIST_KEYS) filters[key] = params.getAll(key).map((value) => value.trim()).filter(Boolean)
  for (const key of DAY_KEYS) {
    const value = params.get(key)?.trim() ?? ""
    filters[key] = isIsoDay(value) ? value : ""
  }
  const paymentType = params.get("paymentType") ?? ""
  filters.paymentType = paymentType === "cash" || paymentType === "bank" ? paymentType : ""
  filters.status = params.get("status")?.trim() ?? ""
  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize"))
  return {
    filters,
    search: params.get("search")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : EXPECTED_PAYMENTS_PAGE_SIZE,
    ordering: params.get("ordering")?.trim() ?? "",
    showCheckboxes: params.get("showCheckboxes") === "true",
  }
}

export function expectedStateToSearch(state: ExpectedPaymentsState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.showCheckboxes) params.set("showCheckboxes", "true")
  const f = state.filters
  for (const key of LIST_KEYS) f[key].forEach((value) => params.append(key, value))
  for (const key of DAY_KEYS) if (f[key]) params.set(key, f[key])
  if (f.paymentType) params.set("paymentType", f.paymentType)
  if (f.status) params.set("status", f.status)
  return params.toString()
}

export function countExpectedFilters(filters: ExpectedPaymentsFilters): number {
  return Object.values(filters).filter((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value))).length
}

/** Params of GET /api/cash/customer-payments/expected. */
export function expectedListQuery(state: ExpectedPaymentsState): CashQuery {
  const f = state.filters
  return {
    search: state.search,
    branch: f.branch,
    client: f.client,
    agent: f.agent,
    paymentType: f.paymentType,
    deliveryMan: f.deliveryMan,
    organization: f.division,
    status: f.status ? [f.status] : [],
    from: f.fromDate,
    to: f.toDate,
    deliveryFrom: f.fromDateSecond,
    deliveryTo: f.toDateSecond,
    dueFrom: f.fromDateThird,
    dueTo: f.toDateThird,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
  }
}

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

const names = (values: string[]) => values.map((value) => ({ value, label: value }))

/** Filter popup ("Применить" applies; the draft is re-seeded each time it opens). */
export function ExpectedPaymentsFilterDialog({
  filters,
  options,
  onApply,
  onClose,
}: {
  filters: ExpectedPaymentsFilters
  options: CustomerPaymentOptions | null
  onApply: (next: ExpectedPaymentsFilters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const set = <K extends keyof ExpectedPaymentsFilters>(key: K, value: ExpectedPaymentsFilters[K]) => setDraft((current) => ({ ...current, [key]: value }))
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={() => onApply(draft)} className="!w-[300px] max-h-[calc(100vh-120px)] overflow-y-auto">
      <div className="flex flex-col">
        <RMulti label="Филиалы" value={draft.branch} options={names(options?.branches ?? [])} onChange={(value) => set("branch", value)} />
        <RMulti label="Клиент"
            value={draft.client}
            options={(options?.clients ?? []).map((client) => ({ value: String(client.id), label: client.name }))}
            onChange={(value) => set("client", value)}
          />
        <RMulti label="Клиент"
            value={draft.client}
            options={(options?.clients ?? []).map((client) => ({ value: String(client.id), label: client.name }))}
            onChange={(value) => set("client", value)}
          />
        <RMulti label="Агент" value={draft.agent} options={names(options?.agents ?? [])} onChange={(value) => set("agent", value)} />
        <RSel label="Тип оплаты" value={draft.paymentType} options={[{ value: "cash", label: t("Наличными") }, { value: "bank", label: t("Перечислением") }]} onChange={(value) => set("paymentType", value)} />
        <RMulti label="Доставщик" value={draft.deliveryMan} options={names(options?.deliverers ?? [])} onChange={(value) => set("deliveryMan", value)} />
        <RMulti label="Организация" value={draft.division} options={names(options?.organizations ?? [])} onChange={(value) => set("division", value)} />
        <RSel label="Статус" value={draft.status} options={(options?.orderStatuses ?? []).map((status) => ({ value: status, label: t(status) }))} onChange={(value) => set("status", value)} />
        <RDate label="Дата создания" from={draft.fromDate} to={draft.toDate} onChange={(from, to) => setDraft((current) => ({ ...current, fromDate: from, toDate: to }))} />
        <RDate label="Дата доставки"
            from={draft.fromDateSecond}
            to={draft.toDateSecond}
            onChange={(from, to) => setDraft((current) => ({ ...current, fromDateSecond: from, toDateSecond: to }))}
          />
      </div>
    </RefFilterPanel>
  )
}
