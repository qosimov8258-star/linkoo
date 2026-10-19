"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Filter, X } from "lucide-react"

import { MultiSelect } from "@/components/analytics/client-balance-filters"
import type { CashQuery } from "@/components/analytics/cash/use-cash"
import {
  DEBT_BUCKETS,
  EMPTY_ORDER_DEBT_FILTERS,
  ORDER_DEBT_ARRAY_FILTERS,
  ORDER_DEBT_TEXT_FILTERS,
  bucketLabel,
  fillTemplate,
  type DebtBucket,
  type OrderDebtConfig,
  type OrderDebtFilters,
  type OrderDebtOptions,
  type OrderDebtTab,
} from "@/lib/finance-order-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// URL state, query and filter popup of "Долги с заказов" (demo grid component:
// StatisticsFilterForm with the 17 fields of STAT_DEBTORS_FILTER_KEY; keys in
// the URL are the demo's: toggle, search, ordering, page, pageSize, division,
// branch, user, deliveryMan, marketTypeParent, zone, status, paymentType,
// marketDebtType, minPaymentDays, paymentDays, created/delivery/payment/accepted
// From/ToDate, withWrongDebt; drill-down detailId, order dialog orderId).

export const NO_CLIENT_TYPE = "-"

export type OrderDebtState = {
  tab: OrderDebtTab
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: OrderDebtFilters
  /** Client drill-down (demo detailId). */
  detailId: string
  /** Order dialog (demo orderId). */
  orderId: number
}

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

export function stateFromParams(params: ParamReader): OrderDebtState {
  const filters: OrderDebtFilters = { ...EMPTY_ORDER_DEBT_FILTERS }
  for (const name of ORDER_DEBT_ARRAY_FILTERS) filters[name] = params.getAll(name).filter(Boolean)
  for (const name of ORDER_DEBT_TEXT_FILTERS) {
    const value = params.get(name) ?? ""
    if (name === "paymentType") filters.paymentType = value === "cash" || value === "bank" ? value : ""
    else if (name === "marketDebtType") filters.marketDebtType = (DEBT_BUCKETS as readonly string[]).includes(value) ? (value as DebtBucket) : ""
    else filters[name] = value
  }
  filters.withWrongDebt = params.get("withWrongDebt") === "true" || params.get("withWrongDebt") === "1"
  const number = (name: string, fallback: number) => {
    const value = Number(params.get(name) ?? "")
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  }
  return {
    tab: params.get("toggle") === "order" ? "order" : "client",
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: number("page", 1),
    pageSize: number("pageSize", 25),
    filters,
    detailId: params.get("detailId") ?? "",
    orderId: number("orderId", 0),
  }
}

function filterEntries(filters: OrderDebtFilters): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const name of ORDER_DEBT_ARRAY_FILTERS) for (const value of filters[name]) entries.push([name, value])
  for (const name of ORDER_DEBT_TEXT_FILTERS) if (filters[name]) entries.push([name, filters[name]])
  if (filters.withWrongDebt) entries.push(["withWrongDebt", "true"])
  return entries
}

export function stateToSearch(state: OrderDebtState): string {
  const params = new URLSearchParams()
  params.set("toggle", state.tab)
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  for (const [name, value] of filterEntries(state.filters)) params.append(name, value)
  if (state.detailId) params.set("detailId", state.detailId)
  if (state.orderId) params.set("orderId", String(state.orderId))
  return params.toString()
}

/** Query of GET /api/order-debts (repeated params for lists). */
export function listQuery(state: OrderDebtState, overrides: Partial<{ page: number; pageSize: number }> = {}): CashQuery {
  const query: CashQuery = {
    toggle: state.tab,
    search: state.search,
    ordering: state.ordering,
    page: overrides.page ?? state.page,
    pageSize: overrides.pageSize ?? state.pageSize,
  }
  for (const name of ORDER_DEBT_ARRAY_FILTERS) query[name] = state.filters[name]
  for (const name of ORDER_DEBT_TEXT_FILTERS) query[name] = state.filters[name]
  query.withWrongDebt = state.filters.withWrongDebt
  return query
}

/** Demo counter "Фильтр / N": every filled field. */
export function countFilters(filters: OrderDebtFilters): number {
  const pairs: Array<[string, string]> = [
    ["createdFromDate", "createdToDate"],
    ["deliveryFromDate", "deliveryToDate"],
    ["paymentFromDate", "paymentToDate"],
    ["acceptedFromDate", "acceptedToDate"],
    ["minPaymentDays", "paymentDays"],
  ]
  let count = ORDER_DEBT_ARRAY_FILTERS.filter((name) => filters[name].length).length
  if (filters.paymentType) count += 1
  if (filters.marketDebtType) count += 1
  if (filters.withWrongDebt) count += 1
  for (const [a, b] of pairs) if (filters[a as keyof OrderDebtFilters] || filters[b as keyof OrderDebtFilters]) count += 1
  return count
}

/** Blue "Фильтр / N" + scope (organizations / branches or "Во всей организации"), demo withoutDate. */
export function OrderDebtFilterButton({ filters, onOpen }: { filters: OrderDebtFilters; onOpen: () => void }) {
  const { t } = useLanguage()
  const scope = [...filters.division, ...filters.branch]
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" onClick={onOpen} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
        <Filter className="h-4 w-4" /> {t("Фильтр")} / {countFilters(filters)}
      </button>
      <span className="font-semibold text-[#4f70e7]">{scope.length ? scope.join(" ") : t("Во всей организации")}</span>
    </div>
  )
}

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]"

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

function DayRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <span className="flex items-center gap-2">
      <input type="date" value={from} onChange={(event) => onChange(event.target.value, to)} className={`${fieldClass} min-w-0 px-2`} />
      <span className="text-[#586174]">—</span>
      <input type="date" value={to} onChange={(event) => onChange(from, event.target.value)} className={`${fieldClass} min-w-0 px-2`} />
    </span>
  )
}

type Option = { value: string; label: string }
const names = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))

/** The demo filter popup (fields in the demo order); edits a draft, "Применить" applies it. */
export function OrderDebtFilterDialog({
  filters,
  options,
  config,
  onClose,
  onApply,
}: {
  filters: OrderDebtFilters
  options: OrderDebtOptions | null
  config: OrderDebtConfig
  onClose: () => void
  onApply: (filters: OrderDebtFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<OrderDebtFilters>(filters)
  const set = <K extends keyof OrderDebtFilters>(field: K, value: OrderDebtFilters[K]) => setDraft((current) => ({ ...current, [field]: value }))
  const withSelected = (values: string[] | undefined, selected: string[]) => names([...new Set([...(values ?? []), ...selected])])
  const typeOptions = useMemo(() => {
    const list = names(options?.clientTypes ?? [])
    if (options?.untyped) list.push({ value: NO_CLIENT_TYPE, label: t("Не указано") })
    for (const value of draft.marketTypeParent) if (!list.some((option) => option.value === value)) list.push({ value, label: value === NO_CLIENT_TYPE ? t("Не указано") : value })
    return list
  }, [options, draft.marketTypeParent, t])
  const statusOptions = withSelected(options?.statuses, draft.status).map((option) => ({ ...option, label: t(option.label) }))
  const bucketOptions = DEBT_BUCKETS.map((bucket) => {
    const label = bucketLabel(bucket, config)
    return { value: bucket, label: fillTemplate(t(label.key), label.values) }
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10" onClick={onClose}>
      <form
        className="w-full max-w-[860px] rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
        }}
      >
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold text-[#17233b]">{t("Фильтр")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Филиалы">
            <MultiSelect value={draft.branch} options={withSelected(options?.branches, draft.branch)} onChange={(value) => set("branch", value)} />
          </Field>
          <Field label="Организация">
            <MultiSelect value={draft.division} options={withSelected(options?.organizations, draft.division)} onChange={(value) => set("division", value)} />
          </Field>
          <Field label="Заказ оформил">
            <MultiSelect value={draft.user} options={withSelected(options?.users, draft.user)} onChange={(value) => set("user", value)} />
          </Field>
          <Field label="Доставщик">
            <MultiSelect value={draft.deliveryMan} options={withSelected(options?.deliveryMen, draft.deliveryMan)} onChange={(value) => set("deliveryMan", value)} />
          </Field>
          <Field label="Тип клиента">
            <MultiSelect value={draft.marketTypeParent} options={typeOptions} onChange={(value) => set("marketTypeParent", value)} />
          </Field>
          <Field label="Зона">
            <MultiSelect value={draft.zone} options={withSelected(options?.zones, draft.zone)} onChange={(value) => set("zone", value)} />
          </Field>
          <Field label="Статус заказа">
            <MultiSelect value={draft.status} options={statusOptions} onChange={(value) => set("status", value)} />
          </Field>
          <Field label="Тип оплаты">
            <select value={draft.paymentType} onChange={(event) => set("paymentType", event.target.value as OrderDebtFilters["paymentType"])} className={fieldClass}>
              <option value="">{t("Все")}</option>
              <option value="cash">{t("Наличными")}</option>
              <option value="bank">{t("Перечислением")}</option>
            </select>
          </Field>
          <Field label="Есть задолженность за период">
            <select value={draft.marketDebtType} onChange={(event) => set("marketDebtType", event.target.value as OrderDebtFilters["marketDebtType"])} className={fieldClass}>
              <option value="">{t("Все")}</option>
              {bucketOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Прошло дней с последней оплаты">
            <span className="grid grid-cols-2 gap-2">
              <input
                inputMode="numeric"
                value={draft.minPaymentDays}
                onChange={(event) => set("minPaymentDays", event.target.value.replace(/\D/g, ""))}
                placeholder={t("От (дней)")}
                aria-label={t("От (дней)")}
                className={fieldClass}
              />
              <input
                inputMode="numeric"
                value={draft.paymentDays}
                onChange={(event) => set("paymentDays", event.target.value.replace(/\D/g, ""))}
                placeholder={t("До (дней)")}
                aria-label={t("До (дней)")}
                className={fieldClass}
              />
            </span>
          </Field>
          <Field label="Период создания">
            <DayRange from={draft.createdFromDate} to={draft.createdToDate} onChange={(from, to) => setDraft((current) => ({ ...current, createdFromDate: from, createdToDate: to }))} />
          </Field>
          <Field label="Дата доставки">
            <DayRange from={draft.deliveryFromDate} to={draft.deliveryToDate} onChange={(from, to) => setDraft((current) => ({ ...current, deliveryFromDate: from, deliveryToDate: to }))} />
          </Field>
          <Field label="Период даты оплаты">
            <DayRange from={draft.paymentFromDate} to={draft.paymentToDate} onChange={(from, to) => setDraft((current) => ({ ...current, paymentFromDate: from, paymentToDate: to }))} />
          </Field>
          <Field label="Период реализации">
            <DayRange from={draft.acceptedFromDate} to={draft.acceptedToDate} onChange={(from, to) => setDraft((current) => ({ ...current, acceptedFromDate: from, acceptedToDate: to }))} />
          </Field>
          <label className="flex items-center gap-2 pt-6 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={draft.withWrongDebt} onChange={(event) => set("withWrongDebt", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Требуется перерасчет")}
          </label>
        </div>
        <div className="flex justify-between gap-3 border-t border-[#e1e5eb] px-6 py-4">
          <button type="button" onClick={() => setDraft({ ...EMPTY_ORDER_DEBT_FILTERS })} className="h-10 rounded-md px-4 font-semibold text-[#4f70e7] hover:bg-[#f2f5f8]">
            {t("Очистить")}
          </button>
          <button type="submit" className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
            {t("Применить")}
          </button>
        </div>
      </form>
    </div>
  )
}
