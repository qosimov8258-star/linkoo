"use client"

import { useState, type ReactNode } from "react"
import { X } from "lucide-react"

import type { BalanceQuery } from "@/components/analytics/balance/use-balance"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { isIsoDay } from "@/lib/finance/dates"
import type { BalanceDateMode } from "@/lib/finance/types"
import { ORDER_STATUS_OPTIONS, RECONCILIATION_STATUS_OPTIONS, type StoreReconciliationOptions } from "@/lib/finance-store-reconciliation-types"
import { useLanguage } from "@/lib/i18n/language-context"

// State, URL sync and the filter popup of "Сверка магазина через бот" (demo
// module 1676 ClientBalanceFilterForm). URL params keep the demo names
// (onlyAccepted, debtDate, border, division, user, marketType, …); lists are
// repeated params.

export type ReconciliationFilters = {
  debtDate: string
  deadlineFrom: string
  deadlineTo: string
  branch: string[]
  zone: string[]
  balanceType: "" | "debtor" | "loaner"
  paymentType: "" | "cash" | "bank"
  organization: string[]
  agent: string[]
  createdBy: string[]
  clientType: string
  messageStatus: string[]
  orderStatus: string[]
  orderDaysMin: string
  orderDaysMax: string
  paymentDaysMin: string
  paymentDaysMax: string
  rejectDaysMin: string
  rejectDaysMax: string
  visitDaysMin: string
  visitDaysMax: string
  lastVisit: "" | "success" | "unsuccess"
  clientFrom: string
  clientTo: string
}

export type ReconciliationState = {
  mode: BalanceDateMode
  filters: ReconciliationFilters
  search: string
  ordering: string[]
  page: number
  pageSize: number
  /** Client act ("Информация по балансу клиента") open for this row. */
  openClient: { key: string; name: string } | null
}

export const RECONCILIATION_PAGE_SIZE = 25

export function emptyReconciliationFilters(): ReconciliationFilters {
  return {
    debtDate: "",
    deadlineFrom: "",
    deadlineTo: "",
    branch: [],
    zone: [],
    balanceType: "",
    paymentType: "",
    organization: [],
    agent: [],
    createdBy: [],
    clientType: "",
    messageStatus: [],
    orderStatus: [],
    orderDaysMin: "",
    orderDaysMax: "",
    paymentDaysMin: "",
    paymentDaysMax: "",
    rejectDaysMin: "",
    rejectDaysMax: "",
    visitDaysMin: "",
    visitDaysMax: "",
    lastVisit: "",
    clientFrom: "",
    clientTo: "",
  }
}

type ListField = "branch" | "zone" | "organization" | "agent" | "createdBy" | "messageStatus" | "orderStatus"
type TextField = Exclude<keyof ReconciliationFilters, ListField>

/** Demo query keys (CLIENT_BALANCE_FILTER_KEY / SHOP_FILTER_KEY). */
const LIST_PARAMS: Record<ListField, string> = {
  branch: "branch",
  zone: "border",
  organization: "division",
  agent: "user",
  createdBy: "marketCreatedBy",
  messageStatus: "messageStatus",
  orderStatus: "orderStatus",
}

const TEXT_PARAMS: Record<TextField, string> = {
  debtDate: "debtDate",
  deadlineFrom: "beginPaymentDeadline",
  deadlineTo: "endPaymentDeadline",
  balanceType: "balanceType",
  paymentType: "paymentType",
  clientType: "marketType",
  orderDaysMin: "minOrderDays",
  orderDaysMax: "orderDays",
  paymentDaysMin: "minPaymentDays",
  paymentDaysMax: "paymentDays",
  rejectDaysMin: "minRejectDays",
  rejectDaysMax: "rejectDays",
  visitDaysMin: "minVisitDays",
  visitDaysMax: "visitDays",
  lastVisit: "lastVisit",
  clientFrom: "marketFromDate",
  clientTo: "marketToDate",
}

const DAY_FIELDS: TextField[] = ["debtDate", "deadlineFrom", "deadlineTo", "clientFrom", "clientTo"]
const DAYS_FIELDS: TextField[] = ["orderDaysMin", "orderDaysMax", "paymentDaysMin", "paymentDaysMax", "rejectDaysMin", "rejectDaysMax", "visitDaysMin", "visitDaysMax"]

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

export function stateFromParams(params: ParamReader): ReconciliationState {
  const filters = emptyReconciliationFilters()
  for (const [field, name] of Object.entries(LIST_PARAMS) as Array<[ListField, string]>) {
    filters[field] = params
      .getAll(name)
      .flatMap((value) => (field === "messageStatus" || field === "orderStatus" ? value.split("-") : [value]))
      .map((value) => value.trim())
      .filter(Boolean)
  }
  for (const [field, name] of Object.entries(TEXT_PARAMS) as Array<[TextField, string]>) {
    const value = (params.get(name) ?? "").trim()
    if (!value) continue
    if (DAY_FIELDS.includes(field) && !isIsoDay(value)) continue
    if (DAYS_FIELDS.includes(field) && !/^\d+$/.test(value)) continue
    ;(filters as Record<TextField, string>)[field] = value
  }
  if (!["debtor", "loaner"].includes(filters.balanceType)) filters.balanceType = ""
  if (!["cash", "bank"].includes(filters.paymentType)) filters.paymentType = ""
  if (!["success", "unsuccess"].includes(filters.lastVisit)) filters.lastVisit = ""
  filters.messageStatus = filters.messageStatus.filter((value) => RECONCILIATION_STATUS_OPTIONS.some((option) => option.value === value))
  filters.orderStatus = filters.orderStatus.filter((value) => ORDER_STATUS_OPTIONS.some((option) => option.value === value))
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  return {
    mode: params.get("onlyAccepted") === "true" ? "realization" : "created",
    filters,
    search: (params.get("search") ?? "").trim(),
    ordering: params.getAll("ordering").filter(Boolean),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : RECONCILIATION_PAGE_SIZE,
    openClient: null,
  }
}

export function stateToSearch(state: ReconciliationState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.mode === "realization") params.set("onlyAccepted", "true")
  if (state.search) params.set("search", state.search)
  state.ordering.forEach((key) => params.append("ordering", key))
  for (const [field, name] of Object.entries(LIST_PARAMS) as Array<[ListField, string]>) state.filters[field].forEach((value) => params.append(name, value))
  for (const [field, name] of Object.entries(TEXT_PARAMS) as Array<[TextField, string]>) {
    const value = state.filters[field]
    if (value) params.set(name, value)
  }
  return params.toString()
}

/** Demo counter: every filter key that has a value. */
export function countReconciliationFilters(filters: ReconciliationFilters): number {
  return Object.values(filters).filter((value) => (Array.isArray(value) ? value.length > 0 : value !== "")).length
}

const toDays = (value: string) => (value === "" ? undefined : Number(value))

/** Query of GET /api/store-reconciliation (and the list filters of the template). */
export function reconciliationQuery(state: ReconciliationState): BalanceQuery {
  const f = state.filters
  return {
    mode: state.mode,
    debtDate: f.debtDate,
    search: state.search,
    branch: f.branch,
    zone: f.zone,
    agent: f.agent,
    clientType: f.clientType ? [f.clientType] : [],
    organization: f.organization,
    createdBy: f.createdBy,
    messageStatus: f.messageStatus,
    orderStatus: f.orderStatus,
    balanceType: f.balanceType,
    paymentType: f.balanceType ? f.paymentType : "",
    deadlineFrom: f.deadlineFrom,
    deadlineTo: f.deadlineTo,
    orderDaysMin: toDays(f.orderDaysMin),
    orderDaysMax: toDays(f.orderDaysMax),
    paymentDaysMin: toDays(f.paymentDaysMin),
    paymentDaysMax: toDays(f.paymentDaysMax),
    rejectDaysMin: toDays(f.rejectDaysMin),
    rejectDaysMax: toDays(f.rejectDaysMax),
    visitDaysMin: toDays(f.visitDaysMin),
    visitDaysMax: toDays(f.visitDaysMax),
    lastVisit: f.lastVisit,
    clientCreatedFrom: f.clientFrom,
    clientCreatedTo: f.clientTo,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
  }
}

// --- popup -----------------------------------------------------------------------------

export const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]"

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

type Option = { value: string; label: string }

function SingleSelect({ value, options, onChange }: { value: string; options: Option[]; onChange: (next: string) => void }) {
  const { t } = useLanguage()
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}>
      <option value="">{t("Все")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function DaysRange({ label, min, max, onChange }: { label: string; min: string; max: string; onChange: (next: { min: string; max: string }) => void }) {
  const { t } = useLanguage()
  const clean = (value: string) => value.replace(/\D/g, "")
  return (
    <Field label={label}>
      <span className="grid grid-cols-2 gap-2">
        <input inputMode="numeric" value={min} onChange={(event) => onChange({ min: clean(event.target.value), max })} placeholder={t("От (дней)")} className={fieldClass} />
        <input inputMode="numeric" value={max} onChange={(event) => onChange({ min, max: clean(event.target.value) })} placeholder={t("До (дней)")} className={fieldClass} />
      </span>
    </Field>
  )
}

const names = (values: string[] | undefined, selected: string[] = []): Option[] => [...new Set([...(values ?? []), ...selected])].map((value) => ({ value, label: value }))

/** Demo filter popup (no period: the page shows balances on one day). */
export function ReconciliationFilterDialog({
  open,
  filters,
  options,
  onClose,
  onApply,
}: {
  open: boolean
  filters: ReconciliationFilters
  options: StoreReconciliationOptions | null
  onClose: () => void
  onApply: (next: ReconciliationFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft each time the popup opens.
    setLastOpen(open)
    if (open) setDraft(filters)
  }
  if (!open) return null
  const set = <K extends keyof ReconciliationFilters>(field: K, value: ReconciliationFilters[K]) => setDraft((current) => ({ ...current, [field]: value }))
  const range = (minField: keyof ReconciliationFilters, maxField: keyof ReconciliationFilters) => ({
    min: draft[minField] as string,
    max: draft[maxField] as string,
    onChange: ({ min, max }: { min: string; max: string }) => setDraft((current) => ({ ...current, [minField]: min, [maxField]: max })),
  })
  const apply = () => {
    onApply({ ...draft, paymentType: draft.balanceType ? draft.paymentType : "" })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className="w-full max-w-[1100px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold text-[#5d6474]">{t("Фильтр")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#8f8f8f]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Долг на определенную дату">
            <input type="date" value={draft.debtDate} onChange={(event) => set("debtDate", event.target.value)} className={fieldClass} />
          </Field>
          <Field label="Срок долга">
            <span className="grid grid-cols-2 gap-2">
              <input type="date" value={draft.deadlineFrom} onChange={(event) => set("deadlineFrom", event.target.value)} className={fieldClass} aria-label={t("От")} title={t("От")} />
              <input type="date" value={draft.deadlineTo} onChange={(event) => set("deadlineTo", event.target.value)} className={fieldClass} aria-label={t("До")} title={t("До")} />
            </span>
          </Field>
          <Field label="Филиалы">
            <MultiSelect value={draft.branch} options={names(options?.branches, draft.branch)} onChange={(value) => set("branch", value)} />
          </Field>
          <Field label="Зона">
            <MultiSelect value={draft.zone} options={names(options?.zones, draft.zone)} onChange={(value) => set("zone", value)} />
          </Field>
          <Field label="Тип баланса">
            <SingleSelect
              value={draft.balanceType}
              options={[
                { value: "debtor", label: t("Задолжники") },
                { value: "loaner", label: t("Закладчики") },
              ]}
              onChange={(value) => set("balanceType", value as ReconciliationFilters["balanceType"])}
            />
          </Field>
          {draft.balanceType && (
            <Field label="Тип оплаты">
              <SingleSelect
                value={draft.paymentType}
                options={[
                  { value: "cash", label: t("Наличные") },
                  { value: "bank", label: t("Перечисление") },
                ]}
                onChange={(value) => set("paymentType", value as ReconciliationFilters["paymentType"])}
              />
            </Field>
          )}
          <Field label="Организация">
            <MultiSelect value={draft.organization} options={names(options?.organizations, draft.organization)} onChange={(value) => set("organization", value)} />
          </Field>
          <Field label="Агент">
            <MultiSelect value={draft.agent} options={names(options?.agents, draft.agent)} onChange={(value) => set("agent", value)} />
          </Field>
          <Field label="Клиента создал">
            <MultiSelect value={draft.createdBy} options={names(options?.users, draft.createdBy)} onChange={(value) => set("createdBy", value)} />
          </Field>
          <Field label="Тип клиента">
            <SingleSelect value={draft.clientType} options={names(options?.types, draft.clientType ? [draft.clientType] : [])} onChange={(value) => set("clientType", value)} />
          </Field>
          <Field label="Статус">
            <MultiSelect
              value={draft.messageStatus}
              options={RECONCILIATION_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              onChange={(value) => set("messageStatus", value)}
            />
          </Field>
          <Field label="Статус заказа">
            <MultiSelect
              value={draft.orderStatus}
              options={ORDER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              onChange={(value) => set("orderStatus", value)}
            />
          </Field>
          <DaysRange label="Прошло дней с последнего заказа" {...range("orderDaysMin", "orderDaysMax")} />
          <DaysRange label="Прошло дней с последней оплаты" {...range("paymentDaysMin", "paymentDaysMax")} />
          <DaysRange label="Прошло дней с последнего отказа" {...range("rejectDaysMin", "rejectDaysMax")} />
          <DaysRange label="Прошло дней с последнего визита" {...range("visitDaysMin", "visitDaysMax")} />
          <Field label="Последнее посещение">
            <SingleSelect
              value={draft.lastVisit}
              options={[
                { value: "success", label: t("Успешный") },
                { value: "unsuccess", label: t("Не успешно") },
              ]}
              onChange={(value) => set("lastVisit", value as ReconciliationFilters["lastVisit"])}
            />
          </Field>
          <Field label="Период создания клиента" wide>
            <span className="flex items-center gap-2">
              <input type="date" value={draft.clientFrom} onChange={(event) => set("clientFrom", event.target.value)} className={fieldClass} />
              <span className="text-[#586174]">—</span>
              <input type="date" value={draft.clientTo} onChange={(event) => set("clientTo", event.target.value)} className={fieldClass} />
            </span>
          </Field>
        </div>
        <div className="flex justify-end border-t border-[#e1e5eb] px-6 py-4">
          <button type="button" onClick={apply} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
            {t("Применить")}
          </button>
        </div>
      </div>
    </div>
  )
}
