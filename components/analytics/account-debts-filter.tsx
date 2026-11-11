"use client"

import { useEffect, useState } from "react"

import { BalanceFilterDialog, FilterCardOptionSelect } from "@/components/analytics/balance/filter-bar"
import { ClientPeriodField, DaysRange, MultiSelect } from "@/components/analytics/client-balance-filters"
import type { BalanceQuery } from "@/components/analytics/balance/use-balance"
import type { AccountDebtOptions } from "@/lib/finance-account-debts-types"
import { isIsoDay } from "@/lib/finance/dates"
import type { BalanceDateMode } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter popup of "Долги по счетам" (demo StatisticsFilterForm of the
// clients/accounts balance, module 656): the demo field set and order, the
// demo URL keys (STAT_MARKET_FILTER_KEY), and the mapping onto the
// /api/balances/account query. Fields without data in this app (visits,
// refusals, client sub-types, invoice flag on payments) are shown disabled.

export type AccountDebtFilters = {
  /** Филиалы (clients.branch) */
  branch: string[]
  /** Зона (clients.zone) */
  border: string[]
  /** Организация (movement organization) */
  division: string[]
  /** Тип клиента (clients.type) — also set by the "by client type" drill-down */
  marketTypeParent: string
  /** Клиенты агента (clients.agent) */
  user: string[]
  /** Доставщик (orders have no delivery man → the client's deliverer) */
  deliveryMan: string
  /** Ответственные доставщики (clients.deliverer) */
  responsibleDeliveryMan: string[]
  /** Ответственный инкасатор (clients.collector) */
  collectorMan: string
  balanceType: "" | "debtor" | "creditor" | "debtor_for_begin" | "creditor_for_begin"
  /** Период создания клиента */
  marketFromDate: string
  marketToDate: string
  minOrderDays: string
  orderDays: string
  minPaymentDays: string
  paymentDays: string
  releasedOrders: boolean
  isOnlyDelivered: boolean
  excludeClosedClients: boolean
}

export const EMPTY_ACCOUNT_DEBT_FILTERS: AccountDebtFilters = {
  branch: [],
  border: [],
  division: [],
  marketTypeParent: "",
  user: [],
  deliveryMan: "",
  responsibleDeliveryMan: [],
  collectorMan: "",
  balanceType: "",
  marketFromDate: "",
  marketToDate: "",
  minOrderDays: "",
  orderDays: "",
  minPaymentDays: "",
  paymentDays: "",
  releasedOrders: false,
  isOnlyDelivered: false,
  excludeClosedClients: false,
}

const LIST_KEYS = ["branch", "border", "division", "user", "responsibleDeliveryMan"] as const
const TEXT_KEYS = ["marketTypeParent", "deliveryMan", "collectorMan"] as const
const DAY_KEYS = ["marketFromDate", "marketToDate"] as const
const NUMBER_KEYS = ["minOrderDays", "orderDays", "minPaymentDays", "paymentDays"] as const
const FLAG_KEYS = ["releasedOrders", "isOnlyDelivered", "excludeClosedClients"] as const
const BALANCE_TYPES = ["debtor", "creditor", "debtor_for_begin", "creditor_for_begin"] as const

export const BALANCE_TYPE_LABELS: Record<(typeof BALANCE_TYPES)[number], string> = {
  debtor: "Задолжник на конец",
  creditor: "Закладчик на конец",
  debtor_for_begin: "Задолжник на начало",
  creditor_for_begin: "Закладчик на начало",
}

/** Filters from the page URL (demo keys, list values repeated). */
export function readAccountDebtFilters(params: URLSearchParams): AccountDebtFilters {
  const filters: AccountDebtFilters = { ...EMPTY_ACCOUNT_DEBT_FILTERS }
  for (const key of LIST_KEYS) filters[key] = params.getAll(key).map((value) => value.trim()).filter(Boolean)
  for (const key of TEXT_KEYS) filters[key] = (params.get(key) ?? "").trim()
  for (const key of DAY_KEYS) {
    const value = params.get(key) ?? ""
    filters[key] = isIsoDay(value) ? value : ""
  }
  for (const key of NUMBER_KEYS) {
    const value = (params.get(key) ?? "").trim()
    filters[key] = /^\d+$/.test(value) ? value : ""
  }
  for (const key of FLAG_KEYS) filters[key] = params.get(key) === "true" || params.get(key) === "1"
  const balanceType = params.get("balanceType") ?? ""
  filters.balanceType = (BALANCE_TYPES as readonly string[]).includes(balanceType) ? (balanceType as AccountDebtFilters["balanceType"]) : ""
  return filters
}

/** Appends the non-empty filters to the page URL params. */
export function writeAccountDebtFilters(params: URLSearchParams, filters: AccountDebtFilters) {
  for (const key of LIST_KEYS) filters[key].forEach((value) => params.append(key, value))
  for (const key of [...TEXT_KEYS, ...DAY_KEYS, ...NUMBER_KEYS, "balanceType"] as const) if (filters[key]) params.set(key, filters[key])
  for (const key of FLAG_KEYS) if (filters[key]) params.set(key, "true")
}

/** /api/balances/account params of the filters. */
export function accountDebtFilterQuery(filters: AccountDebtFilters): BalanceQuery {
  // "Доставщик" and "Ответственные доставщики" both narrow clients.deliverer
  // (orders carry no delivery man); when both are set only their common
  // names match — an impossible name keeps an empty intersection empty.
  let deliverers = filters.responsibleDeliveryMan
  if (filters.deliveryMan) {
    const wanted = filters.deliveryMan.toLowerCase()
    deliverers = deliverers.length ? deliverers.filter((name) => name.toLowerCase() === wanted) : [filters.deliveryMan]
    if (!deliverers.length) deliverers = ["∅"]
  }
  return {
    branch: filters.branch,
    zone: filters.border,
    organization: filters.division,
    clientType: filters.marketTypeParent ? [filters.marketTypeParent] : [],
    agent: filters.user,
    deliverer: deliverers,
    collector: filters.collectorMan ? [filters.collectorMan] : [],
    balanceType: filters.balanceType,
    clientCreatedFrom: filters.marketFromDate,
    clientCreatedTo: filters.marketToDate,
    orderDaysMin: filters.minOrderDays,
    orderDaysMax: filters.orderDays,
    paymentDaysMin: filters.minPaymentDays,
    paymentDaysMax: filters.paymentDays,
    orderScope: filters.isOnlyDelivered ? "delivered" : filters.releasedOrders ? "released" : "",
    excludeClosed: filters.excludeClosedClients,
  }
}

const NO_OPTIONS: AccountDebtOptions = { branches: [], organizations: [], zones: [], clientTypes: [], agents: [], deliverers: [], collectors: [] }

/** GET /api/balances/account-debts/options once `enabled` (lazy: the dialog's first opening). */
function useAccountDebtOptions(enabled: boolean): { options: AccountDebtOptions; loading: boolean } {
  const [state, setState] = useState<{ options: AccountDebtOptions; loaded: boolean }>({ options: NO_OPTIONS, loaded: false })
  useEffect(() => {
    if (!enabled || state.loaded) return
    const controller = new AbortController()
    fetch("/api/balances/account-debts/options", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<AccountDebtOptions>) : NO_OPTIONS))
      .then((options) => setState({ options: { ...NO_OPTIONS, ...options }, loaded: true }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ options: NO_OPTIONS, loaded: true })
      })
    return () => controller.abort()
  }, [enabled, state.loaded])
  return { options: state.options, loading: enabled && !state.loaded }
}

// --- fields ------------------------------------------------------------------

function CheckField({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed text-[#9aa3b6]" : "text-black"}`} title={disabled ? t("Нет данных") : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
      {t(label)}
    </label>
  )
}


export function AccountDebtFilterDialog({
  open,
  onClose,
  from,
  to,
  mode,
  filters,
  onApply,
}: {
  open: boolean
  onClose: () => void
  from: string
  to: string
  mode: BalanceDateMode
  filters: AccountDebtFilters
  onApply: (period: { from: string; to: string }, filters: AccountDebtFilters) => void
}) {
  const { t } = useLanguage()
  const { options } = useAccountDebtOptions(open)
  const [draft, setDraft] = useState(filters)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft from the applied filters each time the dialog opens.
    setLastOpen(open)
    if (open) setDraft(filters)
  }
  const set = <K extends keyof AccountDebtFilters>(key: K, value: AccountDebtFilters[K]) => setDraft((current) => ({ ...current, [key]: value }))

  return (
    // The reference's compact card (four columns): its fields in its order. Filters it does not offer here
    // (Зона, Клиенты агента, Ответственные доставщики, …) still apply from the URL.
    <BalanceFilterDialog
      open={open}
      columns={4}
      onClose={onClose}
      from={from}
      to={to}
      dateLabel={mode === "realization" ? "Период реализации" : "Период создания транзакции"}
      onApply={(period) => onApply(period, draft)}
    >
      <MultiSelect label={t("Филиалы")} value={draft.branch} options={optionList(options.branches)} onChange={(value) => set("branch", value)} />
      <FilterCardOptionSelect
        label={t("Последнее посещение")}
        value=""
        options={[
          { value: "success", label: t("Успешный") },
          { value: "unsuccess", label: t("Не успешно") },
        ]}
        onChange={() => undefined}
        disabled
      />
      <ClientPeriodField from={draft.marketFromDate} to={draft.marketToDate} onChange={(fromDay, toDay) => setDraft((current) => ({ ...current, marketFromDate: fromDay, marketToDate: toDay }))} />
      <DaysRange label="Прошло дней с последнего заказа" min={draft.minOrderDays} max={draft.orderDays} onChange={({ min, max }) => setDraft((current) => ({ ...current, minOrderDays: min, orderDays: max }))} />
      <DaysRange label="Прошло дней с последней оплаты" min={draft.minPaymentDays} max={draft.paymentDays} onChange={({ min, max }) => setDraft((current) => ({ ...current, minPaymentDays: min, paymentDays: max }))} />
      <DaysRange label="Прошло дней с последнего отказа" min="" max="" onChange={() => undefined} disabled />
      <DaysRange label="Прошло дней с последнего визита" min="" max="" onChange={() => undefined} disabled />
      <MultiSelect label={t("Организация")} value={draft.division} options={optionList(options.organizations)} onChange={(value) => set("division", value)} />
      <FilterCardOptionSelect label={t("Тип клиента")} value={draft.marketTypeParent} options={optionList(withValue(options.clientTypes, draft.marketTypeParent))} onChange={(value) => set("marketTypeParent", value)} />
      <FilterCardOptionSelect label={t("Доставщик")} value={draft.deliveryMan} options={optionList(withValue(options.deliverers, draft.deliveryMan))} onChange={(value) => set("deliveryMan", value)} />
      <FilterCardOptionSelect
        label={t("Тип баланса")}
        value={draft.balanceType}
        options={BALANCE_TYPES.map((type) => ({ value: type, label: t(BALANCE_TYPE_LABELS[type]) }))}
        onChange={(value) => set("balanceType", value as AccountDebtFilters["balanceType"])}
      />
      <div className="grid grid-cols-1 gap-2 pt-2 text-[13px] font-semibold text-black md:col-span-4 md:grid-cols-4">
        <CheckField label="Учитывать только реализованных заказов" checked={draft.releasedOrders} onChange={(checked) => set("releasedOrders", checked)} />
        <CheckField label="Только оплаты с счет фактурой" checked={false} onChange={() => undefined} disabled />
      </div>
    </BalanceFilterDialog>
  )
}

/** Plain names as select options. */
function optionList(values: string[]): Array<{ value: string; label: string }> {
  return values.map((value) => ({ value, label: value }))
}

/** Options plus the current value (a URL value may not be among the options). */
function withValue(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options
}
