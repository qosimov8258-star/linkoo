"use client"

import { useRef, useState, type ReactNode } from "react"
import { CalendarDays, XCircle } from "lucide-react"

import type { BalanceQuery } from "@/components/analytics/balance/use-balance"
import { FilterCardContext, FilterCardOptionSelect } from "@/components/analytics/balance/filter-bar"
import { ClientPeriodField, MultiSelect } from "@/components/analytics/client-balance-filters"
import { formatDotDate, isIsoDay } from "@/lib/finance/dates"
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

  // The reference's card under the summary blocks: four columns, labels inside the fields, a dark «ПРИМЕНИТЬ».
  return (
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-[100] overflow-y-auto bg-black/10" onClick={onClose}>
      <div className="mx-[30px] mt-[225px] bg-white px-[20px] pb-[10px] pt-[20px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[30px] items-center justify-between">
          <h2 className="text-[15px] font-normal text-[#777]">{t("Фильтр")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555]">
            <XCircle className="h-6 w-6" strokeWidth={1.5} />
          </button>
        </div>
        <FilterCardContext.Provider value>
          <div className="mt-[14px] grid grid-cols-1 gap-x-[10px] gap-y-[14px] md:grid-cols-4">
            <DateField label={t("Долг на определенную дату")} value={draft.debtDate} onChange={(value) => set("debtDate", value)} />
            <div className="relative md:col-span-2">
              <span className="absolute -top-[22px] left-0 text-[13px] text-[#555]">{t("Срок долга")}</span>
              <div className="grid grid-cols-2 gap-[10px]">
                <DateField label={t("От")} value={draft.deadlineFrom} onChange={(value) => set("deadlineFrom", value)} />
                <DateField label={t("До")} value={draft.deadlineTo} onChange={(value) => set("deadlineTo", value)} />
              </div>
            </div>
            <MultiSelect label={t("Филиалы")} value={draft.branch} options={names(options?.branches, draft.branch)} onChange={(value) => set("branch", value)} />
            <MultiSelect label={t("Зона")} value={draft.zone} options={names(options?.zones, draft.zone)} onChange={(value) => set("zone", value)} />
            <FilterCardOptionSelect
              label={t("Тип баланса")}
              value={draft.balanceType}
              options={[
                { value: "debtor", label: t("Задолжники") },
                { value: "loaner", label: t("Закладчики") },
              ]}
              onChange={(value) => set("balanceType", value as ReconciliationFilters["balanceType"])}
            />
            {draft.balanceType && (
              <FilterCardOptionSelect
                label={t("Тип оплаты")}
                value={draft.paymentType}
                options={[
                  { value: "cash", label: t("Наличные") },
                  { value: "bank", label: t("Перечисление") },
                ]}
                onChange={(value) => set("paymentType", value as ReconciliationFilters["paymentType"])}
              />
            )}
            <MultiSelect label={t("Организация")} value={draft.organization} options={names(options?.organizations, draft.organization)} onChange={(value) => set("organization", value)} />
            <MultiSelect label={t("Агент")} value={draft.agent} options={names(options?.agents, draft.agent)} onChange={(value) => set("agent", value)} />
            <MultiSelect label={t("Клиента создал")} value={draft.createdBy} options={names(options?.users, draft.createdBy)} onChange={(value) => set("createdBy", value)} />
            <FilterCardOptionSelect label={t("Тип клиента")} value={draft.clientType} options={names(options?.types, draft.clientType ? [draft.clientType] : [])} onChange={(value) => set("clientType", value)} />
            <MultiSelect
              label={t("Статус")}
              value={draft.messageStatus}
              options={RECONCILIATION_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              onChange={(value) => set("messageStatus", value)}
            />
            <MultiSelect
              label={t("Статус заказа")}
              value={draft.orderStatus}
              options={ORDER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))}
              onChange={(value) => set("orderStatus", value)}
            />
            <WideDays label={t("Прошло дней с последнего заказа")} {...range("orderDaysMin", "orderDaysMax")} />
            <WideDays label={t("Прошло дней с последней оплаты")} {...range("paymentDaysMin", "paymentDaysMax")} />
            <WideDays label={t("Прошло дней с последнего отказа")} {...range("rejectDaysMin", "rejectDaysMax")} />
            <WideDays label={t("Прошло дней с последнего визита")} {...range("visitDaysMin", "visitDaysMax")} />
            <FilterCardOptionSelect
              label={t("Последнее посещение")}
              value={draft.lastVisit}
              options={[
                { value: "success", label: t("Успешный") },
                { value: "unsuccess", label: t("Не успешно") },
              ]}
              onChange={(value) => set("lastVisit", value as ReconciliationFilters["lastVisit"])}
            />
            <ClientPeriodField from={draft.clientFrom} to={draft.clientTo} onChange={(from, to) => setDraft((current) => ({ ...current, clientFrom: from, clientTo: to }))} />
          </div>
        </FilterCardContext.Provider>
        <button type="button" onClick={apply} className="mt-[22px] h-9 rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          {t("Применить")}
        </button>
      </div>
    </div>
  )
}

/** Date field of the reference's card: the label until a day is picked, a calendar icon, the native picker on click. */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <button
        type="button"
        onClick={() => input.current?.showPicker?.()}
        className="absolute inset-0 flex items-end justify-between pb-[6px] text-left text-[13px] text-black"
      >
        <span>{value ? formatDotDate(value) : label}</span>
        <CalendarDays className="h-4 w-4 text-[#bdbdbd]" />
      </button>
      <input ref={input} type="date" value={value} onChange={(event) => onChange(event.target.value)} tabIndex={-1} aria-label={label} className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0" />
    </div>
  )
}

/** «Прошло дней с …» over two columns: the caption, then bold От (дней) / До (дней) inputs side by side. */
function WideDays({ label, min, max, onChange }: { label: string; min: string; max: string; onChange: (next: { min: string; max: string }) => void }) {
  const { t } = useLanguage()
  const clean = (value: string) => value.replace(/\D/g, "")
  const input = "h-[36px] w-full border-0 border-b border-[#d5dae1] bg-transparent px-0 text-[13px] text-black outline-none placeholder:font-semibold placeholder:text-black"
  return (
    <div className="flex flex-col gap-1 md:col-span-2">
      <span className="text-[13px] text-[#555]">{label}</span>
      <div className="grid grid-cols-2 gap-[10px]">
        <input inputMode="numeric" value={min} onChange={(event) => onChange({ min: clean(event.target.value), max })} placeholder={t("От (дней)")} className={input} />
        <input inputMode="numeric" value={max} onChange={(event) => onChange({ min, max: clean(event.target.value) })} placeholder={t("До (дней)")} className={input} />
      </div>
    </div>
  )
}
