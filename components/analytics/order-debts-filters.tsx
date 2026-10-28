"use client"

import { useMemo, useState } from "react"
import { Filter } from "lucide-react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefMultiField, type RefOption } from "@/components/ref/multi-field"
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
      <button type="button" onClick={onOpen} className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[12.8px] pr-[17px] text-[13px] font-semibold text-white hover:brightness-95">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" /></svg><span className="pl-2">{t("Фильтр")} / {countFilters(filters)}</span>
      </button>
      <span className="font-semibold text-[#4f70e7]">{scope.length ? scope.join(" ") : t("Во всей организации")}</span>
    </div>
  )
}

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const shortDay = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
const CALENDAR = "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"

/** A date range field ("Период создания" …): 10px label, value or "Укажите дату", opens the range picker. */
function RangeField({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="relative h-[54px]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="absolute inset-0 border-b border-[#e0e0e0] text-left">
        <span className="absolute left-0 top-[7px] text-[10px] leading-3 text-black">{t(label)}</span>
        <svg viewBox="0 0 24 24" className="absolute left-[240px] top-[6px] h-[14px] w-[14px] fill-[#c4c4c4]" aria-hidden>
          <path d={CALENDAR} />
        </svg>
        <span className="absolute inset-x-0 top-[28px] text-[13px] leading-[18px] text-black">{from || to ? `${shortDay(from || to)} - ${shortDay(to || from)}` : t("Укажите дату")}</span>
      </button>
      {(from || to) && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute bottom-[8px] right-0 z-10 flex h-5 w-5 items-center justify-center text-[18px] leading-none text-[#999]">
          ×
        </button>
      )}
      {open && (
        <DateRangePicker
          positionClassName="left-0 top-[58px]"
          begin={from || to || today}
          end={to || from || today}
          onClose={() => setOpen(false)}
          onApply={(begin, end) => {
            onChange(begin, end)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

const asOptions = (values: string[]): RefOption[] => values.map((value) => ({ value, label: value }))
// The demo lists the two released statuses (codes 2 and 3) under their own names.
const STATUS_LABELS: Record<string, string> = { "В пути": "Передан доставщику", "Доставлено": "Доставлен" }

/** The demo filter panel (fields in the demo order); edits a draft, "Применить" applies it. */
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
  const withSelected = (values: string[] | undefined, selected: string[]) => asOptions([...new Set([...(values ?? []), ...selected])])
  const typeOptions = useMemo(() => {
    const list = asOptions(options?.clientTypes ?? [])
    if (options?.untyped) list.push({ value: NO_CLIENT_TYPE, label: t("Не указано") })
    for (const value of draft.marketTypeParent) if (!list.some((option) => option.value === value)) list.push({ value, label: value === NO_CLIENT_TYPE ? t("Не указано") : value })
    return list
  }, [options, draft.marketTypeParent, t])
  const statusOptions = ["В пути", "Доставлено"].map((value) => ({ value, label: t(STATUS_LABELS[value]) }))
  const bucketOptions = DEBT_BUCKETS.map((bucket) => {
    const label = bucketLabel(bucket, config)
    return { value: bucket, label: fillTemplate(t(label.key), label.values) }
  })
  const row = "absolute left-[30px] right-[30px] grid grid-cols-4 gap-x-[10px]"
  const day = (value: string) => value.replace(/\D/g, "")

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[50px] z-[99] bg-black/[0.13]" onClick={onClose} />
      <form
        className="fixed left-[30px] right-[30px] top-[131px] z-[100] h-[426px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
        }}
      >
        <h2 className="absolute left-[30px] top-[20px] text-[14px] font-semibold leading-[18px] text-[#333]">{t("Фильтр")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[20px] top-[19px]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
        </button>

        <div className={row} style={{ top: 64 }}>
          <RefMultiField label="Филиалы" options={withSelected(options?.branches, draft.branch)} value={draft.branch} onChange={(value) => set("branch", value)} />
          <RefMultiField label="Организация" options={withSelected(options?.organizations, draft.division)} value={draft.division} onChange={(value) => set("division", value)} />
          <RefMultiField label="Заказ оформил" options={withSelected(options?.users, draft.user)} value={draft.user} onChange={(value) => set("user", value)} />
          <RefMultiField label="Доставщик" options={withSelected(options?.deliveryMen, draft.deliveryMan)} value={draft.deliveryMan} onChange={(value) => set("deliveryMan", value)} />
        </div>
        <div className={row} style={{ top: 131 }}>
          <RefMultiField label="Тип клиента" options={typeOptions} value={draft.marketTypeParent} onChange={(value) => set("marketTypeParent", value)} />
          <RefMultiField label="Статус подтверждения клиента" options={[]} value={[]} onChange={() => {}} />
          <RefMultiField label="Зона" options={withSelected(options?.zones, draft.zone)} value={draft.zone} onChange={(value) => set("zone", value)} />
          <RefMultiField label="Статус заказа" options={statusOptions} value={draft.status} onChange={(value) => set("status", value)} />
        </div>
        <span className="absolute text-[13px] leading-[16px] text-[#666]" style={{ top: 192, left: "calc(75% - 7.5px)" }}>
          {t("Прошло дней с последней оплаты")}
        </span>
        <div className={row} style={{ top: 203 }}>
          <RefMultiField label="Тип оплаты (транзакции)" options={[]} value={[]} onChange={() => {}} />
          <RefMultiField
            label="Тип оплаты"
            multiple={false}
            options={[
              { value: "cash", label: t("Наличные") },
              { value: "bank", label: t("Перечисление") },
            ]}
            value={draft.paymentType ? [draft.paymentType] : []}
            onChange={(value) => set("paymentType", (value[0] ?? "") as OrderDebtFilters["paymentType"])}
          />
          <RefMultiField label="Есть задолженность за период" multiple={false} options={bucketOptions} value={draft.marketDebtType ? [draft.marketDebtType] : []} onChange={(value) => set("marketDebtType", (value[0] ?? "") as OrderDebtFilters["marketDebtType"])} />
          <div className="grid grid-cols-2 gap-x-[16px]">
            {(
              [
                ["minPaymentDays", "От (дней)"],
                ["paymentDays", "До (дней)"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="relative block h-[54px] border-b border-[#e0e0e0]">
                {draft[field] && <span className="absolute left-0 top-[7px] text-[10px] leading-3 text-black">{t(label)}</span>}
                <input
                  inputMode="numeric"
                  value={draft[field]}
                  onChange={(event) => set(field, day(event.target.value))}
                  placeholder={t(label)}
                  aria-label={t(label)}
                  className={`absolute inset-x-0 h-[18px] bg-transparent text-[13px] leading-[18px] text-black outline-none placeholder:font-semibold placeholder:text-black ${draft[field] ? "top-[26px]" : "top-[28px] font-semibold"}`}
                />
              </label>
            ))}
          </div>
        </div>
        <div className={row} style={{ top: 272 }}>
          <RangeField label="Период создания" from={draft.createdFromDate} to={draft.createdToDate} onChange={(from, to) => setDraft((current) => ({ ...current, createdFromDate: from, createdToDate: to }))} />
          <RangeField label="Дата доставки" from={draft.deliveryFromDate} to={draft.deliveryToDate} onChange={(from, to) => setDraft((current) => ({ ...current, deliveryFromDate: from, deliveryToDate: to }))} />
          <RangeField label="Период даты оплаты" from={draft.paymentFromDate} to={draft.paymentToDate} onChange={(from, to) => setDraft((current) => ({ ...current, paymentFromDate: from, paymentToDate: to }))} />
          <RangeField label="Период реализации" from={draft.acceptedFromDate} to={draft.acceptedToDate} onChange={(from, to) => setDraft((current) => ({ ...current, acceptedFromDate: from, acceptedToDate: to }))} />
        </div>
        <label className="absolute left-[30px] top-[341px] flex h-[20px] cursor-pointer items-center text-[13px] font-semibold text-[#333]">
          <input type="checkbox" checked={draft.withWrongDebt} onChange={(event) => set("withWrongDebt", event.target.checked)} className="mr-[10px] h-[16px] w-[16px] accent-[#5d6474]" />
          {t("Требуется перерасчет")}
        </label>
        <button type="submit" className="absolute left-[30px] right-[30px] top-[371px] h-9 rounded-[3px] bg-[#71ce87] text-[13px] font-semibold uppercase text-white">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}
