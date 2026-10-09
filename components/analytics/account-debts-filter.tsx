"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
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

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b] disabled:cursor-not-allowed disabled:bg-[#f2f5f8] disabled:text-[#9aa3b6]"

function Field({ label, children, disabled = false, wide = false }: { label: string; children: ReactNode; disabled?: boolean; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`} title={disabled ? t("Нет данных") : undefined}>
      <span className={`text-sm ${disabled ? "text-[#9aa3b6]" : "text-[#586174]"}`}>{t(label)}</span>
      {children}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  /** [value, label] pairs (labels already translated where needed). */
  options: Array<[string, string]>
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useLanguage()
  return (
    <Field label={label} disabled={disabled}>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={fieldClass}>
        <option value="">{disabled ? t("Нет данных") : t("Все")}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </Field>
  )
}

function MultiSelectField({ label, value, options, onChange }: { label: string; value: string[]; options: string[]; onChange: (value: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  // Keep selected values that are not (or no longer) among the options visible.
  const all = useMemo(() => [...value.filter((item) => !options.includes(item)), ...options], [value, options])
  const shown = all.filter((item) => item.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((selected) => selected !== item) : [...value, item])
  return (
    <Field label={label}>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((current) => !current)} className={`${fieldClass} flex items-center justify-between gap-2 text-left`}>
          <span className="truncate">{value.length ? value.join(", ") : t("Все")}</span>
          <span className="flex shrink-0 items-center gap-1 text-[#9aa3b6]">
            {value.length > 0 && (
              <X
                className="h-4 w-4 hover:text-[#e57373]"
                aria-label={t("Очистить")}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange([])
                }}
              />
            )}
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-[110] mt-1 max-h-64 overflow-y-auto rounded-md border border-[#e1e5eb] bg-white shadow-lg">
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-9 w-full border-b border-[#e1e5eb] px-3 outline-none" />
            {shown.map((item) => (
              <button key={item} type="button" onClick={() => toggle(item)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#17233b] hover:bg-[#f2f5f8]">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(item) ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#c5ccd8]"}`}>
                  {value.includes(item) && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{item}</span>
              </button>
            ))}
            {!shown.length && <p className="px-3 py-3 text-sm text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
          </div>
        )}
      </div>
    </Field>
  )
}

function DaysRangeField({ label, min, max, onChange, disabled = false }: { label: string; min: string; max: string; onChange: (next: { min: string; max: string }) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  const clean = (value: string) => value.replace(/\D/g, "")
  return (
    <Field label={label} disabled={disabled}>
      <span className="flex items-center gap-2">
        <input inputMode="numeric" value={min} disabled={disabled} onChange={(event) => onChange({ min: clean(event.target.value), max })} placeholder={t("От (дней)")} className={fieldClass} />
        <input inputMode="numeric" value={max} disabled={disabled} onChange={(event) => onChange({ min, max: clean(event.target.value) })} placeholder={t("До (дней)")} className={fieldClass} />
      </span>
    </Field>
  )
}

function CheckField({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed text-[#9aa3b6]" : "text-[#17233b]"}`} title={disabled ? t("Нет данных") : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
      {t(label)}
    </label>
  )
}

const names = (values: string[]): Array<[string, string]> => values.map((value) => [value, value])

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
  const { options, loading } = useAccountDebtOptions(open)
  const [draft, setDraft] = useState(filters)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft from the applied filters each time the dialog opens.
    setLastOpen(open)
    if (open) setDraft(filters)
  }
  const set = <K extends keyof AccountDebtFilters>(key: K, value: AccountDebtFilters[K]) => setDraft((current) => ({ ...current, [key]: value }))

  return (
    <BalanceFilterDialog
      open={open}
      onClose={onClose}
      from={from}
      to={to}
      dateLabel={mode === "realization" ? "Период реализации" : "Период создания транзакции"}
      onApply={(period) => onApply(period, draft)}
    >
      {loading && <p className="text-sm text-[#9aa3b6] md:col-span-2">{t("Загрузка...")}</p>}
      <MultiSelectField label="Филиалы" value={draft.branch} options={options.branches} onChange={(value) => set("branch", value)} />
      <MultiSelectField label="Зона" value={draft.border} options={options.zones} onChange={(value) => set("border", value)} />
      <SelectField
        label="Последнее посещение"
        value=""
        options={[
          ["success", t("Успешный")],
          ["unsuccess", t("Не успешно")],
        ]}
        onChange={() => undefined}
        disabled
      />
      <Field label="Период создания клиента">
        <span className="flex items-center gap-2">
          <input type="date" value={draft.marketFromDate} max={draft.marketToDate || undefined} onChange={(event) => set("marketFromDate", event.target.value)} className={fieldClass} />
          <span className="text-[#586174]">—</span>
          <input type="date" value={draft.marketToDate} min={draft.marketFromDate || undefined} onChange={(event) => set("marketToDate", event.target.value)} className={fieldClass} />
        </span>
      </Field>
      <DaysRangeField
        label="Прошло дней с последнего заказа"
        min={draft.minOrderDays}
        max={draft.orderDays}
        onChange={({ min, max }) => setDraft((current) => ({ ...current, minOrderDays: min, orderDays: max }))}
      />
      <DaysRangeField
        label="Прошло дней с последней оплаты"
        min={draft.minPaymentDays}
        max={draft.paymentDays}
        onChange={({ min, max }) => setDraft((current) => ({ ...current, minPaymentDays: min, paymentDays: max }))}
      />
      <DaysRangeField label="Прошло дней с последнего отказа" min="" max="" onChange={() => undefined} disabled />
      <DaysRangeField label="Прошло дней с последнего визита" min="" max="" onChange={() => undefined} disabled />
      <MultiSelectField label="Организация" value={draft.division} options={options.organizations} onChange={(value) => set("division", value)} />
      <SelectField label="Тип клиента" value={draft.marketTypeParent} options={names(withValue(options.clientTypes, draft.marketTypeParent))} onChange={(value) => set("marketTypeParent", value)} />
      {draft.marketTypeParent && <SelectField label="Подкатегория" value="" options={[]} onChange={() => undefined} disabled />}
      <MultiSelectField label="Клиенты агента" value={draft.user} options={options.agents} onChange={(value) => set("user", value)} />
      <SelectField label="Доставщик" value={draft.deliveryMan} options={names(withValue(options.deliverers, draft.deliveryMan))} onChange={(value) => set("deliveryMan", value)} />
      <SelectField
        label="Тип баланса"
        value={draft.balanceType}
        options={BALANCE_TYPES.map((type) => [type, t(BALANCE_TYPE_LABELS[type])])}
        onChange={(value) => set("balanceType", value as AccountDebtFilters["balanceType"])}
      />
      <MultiSelectField label="Ответственные доставщики" value={draft.responsibleDeliveryMan} options={options.deliverers} onChange={(value) => set("responsibleDeliveryMan", value)} />
      <SelectField label="Ответственный инкасатор" value={draft.collectorMan} options={names(withValue(options.collectors, draft.collectorMan))} onChange={(value) => set("collectorMan", value)} />
      <div className="flex flex-col gap-2 border-t border-[#e1e5eb] pt-4 md:col-span-2">
        <CheckField label="Учитывать только реализованных заказов" checked={draft.releasedOrders} onChange={(checked) => set("releasedOrders", checked)} />
        <CheckField label="Только доставленные заказы" checked={draft.isOnlyDelivered} onChange={(checked) => set("isOnlyDelivered", checked)} />
        <CheckField label="Только оплаты с счет фактурой" checked={false} onChange={() => undefined} disabled />
        <CheckField label="Исключить закрытие магазины" checked={draft.excludeClosedClients} onChange={(checked) => set("excludeClosedClients", checked)} />
        <button type="button" onClick={() => setDraft({ ...EMPTY_ACCOUNT_DEBT_FILTERS })} className="self-start text-sm text-[#4f70e7] hover:underline">
          {t("Сбросить фильтр")}
        </button>
      </div>
    </BalanceFilterDialog>
  )
}

/** Options plus the current value (a URL value may not be among the options). */
function withValue(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options
}
