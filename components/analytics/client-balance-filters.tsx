"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Filter, Info } from "lucide-react"

import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import type { BalanceQuery } from "@/components/analytics/balance/use-balance"
import { defaultBalancePeriod, formatDotDate, isIsoDay } from "@/lib/finance/dates"
import { NO_CLIENT_TYPE, type ClientBalanceOptions } from "@/lib/finance-client-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// State, URL query and filter popup of "Баланс клиентов" (demo module 656).
// Everything lives in the page URL like in the demo (same param names:
// fromDate/toDate or acceptedDateBegin/acceptedDateEnd, periodType, toggle,
// branch, border, division, marketTypeParent, user, deliveryMan, …); multi
// values are repeated params because names may contain "-" or ",".

export type ClientBalanceMode = "created" | "realization"
export type ClientBalanceToggle = "clients" | "types"

export type ClientBalanceFilters = {
  from: string
  to: string
  branch: string[]
  zone: string[]
  lastVisit: "" | "success" | "unsuccess"
  clientFrom: string
  clientTo: string
  orderDaysMin: string
  orderDaysMax: string
  paymentDaysMin: string
  paymentDaysMax: string
  rejectDaysMin: string
  rejectDaysMax: string
  visitDaysMin: string
  visitDaysMax: string
  organization: string[]
  clientType: string[]
  subType: string[]
  agent: string[]
  deliveryMan: string
  balanceType: "" | "debtor" | "creditor" | "debtor_for_begin" | "creditor_for_begin"
  deliverer: string[]
  collector: string
  releasedOrders: boolean
  onlyDelivered: boolean
  onlyInvoice: boolean
  excludeClosed: boolean
}

export type ClientBalanceState = {
  mode: ClientBalanceMode
  toggle: ClientBalanceToggle
  filters: ClientBalanceFilters
  search: string
  page: number
  pageSize: number
  ordering: string[]
  /** Act modal (demo ?openClient=<id>). */
  openClient: { key: string; name: string } | null
}

type ListField = "branch" | "zone" | "organization" | "clientType" | "subType" | "agent" | "deliverer"
type TextField = Exclude<keyof ClientBalanceFilters, ListField | "from" | "to" | "releasedOrders" | "onlyDelivered" | "onlyInvoice" | "excludeClosed">
type FlagField = "releasedOrders" | "onlyDelivered" | "onlyInvoice" | "excludeClosed"

/** Demo URL key of every filter field (STAT_MARKET_FILTER_KEY). */
const LIST_PARAMS: Record<ListField, string> = {
  branch: "branch",
  zone: "border",
  organization: "division",
  clientType: "marketTypeParent",
  subType: "marketType",
  agent: "user",
  deliverer: "responsibleDeliveryMan",
}
const TEXT_PARAMS: Record<TextField, string> = {
  lastVisit: "lastVisit",
  clientFrom: "marketFromDate",
  clientTo: "marketToDate",
  orderDaysMin: "minOrderDays",
  orderDaysMax: "orderDays",
  paymentDaysMin: "minPaymentDays",
  paymentDaysMax: "paymentDays",
  rejectDaysMin: "minRejectDays",
  rejectDaysMax: "rejectDays",
  visitDaysMin: "minVisitDays",
  visitDaysMax: "visitDays",
  deliveryMan: "deliveryMan",
  balanceType: "balanceType",
  collector: "collectorMan",
}
const FLAG_PARAMS: Record<FlagField, string> = {
  releasedOrders: "releasedOrders",
  onlyDelivered: "isOnlyDelivered",
  onlyInvoice: "onlyPaymentWithInvoice",
  excludeClosed: "excludeClosedClients",
}

export const CLIENT_BALANCE_PAGE_SIZE = 25

export function emptyFilters(from: string, to: string): ClientBalanceFilters {
  return {
    from,
    to,
    branch: [],
    zone: [],
    lastVisit: "",
    clientFrom: "",
    clientTo: "",
    orderDaysMin: "",
    orderDaysMax: "",
    paymentDaysMin: "",
    paymentDaysMax: "",
    rejectDaysMin: "",
    rejectDaysMax: "",
    visitDaysMin: "",
    visitDaysMax: "",
    organization: [],
    clientType: [],
    subType: [],
    agent: [],
    deliveryMan: "",
    balanceType: "",
    deliverer: [],
    collector: "",
    releasedOrders: false,
    onlyDelivered: false,
    onlyInvoice: false,
    excludeClosed: false,
  }
}

const BALANCE_TYPES = ["debtor", "creditor", "debtor_for_begin", "creditor_for_begin"] as const
const isDays = (value: string) => /^\d+$/.test(value)

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

/** Page state from the URL (menu default: 1st of month … today, 25 rows). */
export function stateFromParams(params: ParamReader): ClientBalanceState {
  const realization = params.get("periodType") === "secondPeriod"
  const fallback = defaultBalancePeriod()
  const day = (value: string | null) => (value && isIsoDay(value) ? value : "")
  let from = (realization ? day(params.get("acceptedDateBegin")) : "") || day(params.get("fromDate")) || fallback.from
  let to = (realization ? day(params.get("acceptedDateEnd")) : "") || day(params.get("toDate")) || fallback.to
  if (from > to) [from, to] = [to, from]

  const filters = emptyFilters(from, to)
  for (const [field, name] of Object.entries(LIST_PARAMS) as Array<[ListField, string]>) filters[field] = params.getAll(name).filter((value) => value.trim())
  for (const [field, name] of Object.entries(TEXT_PARAMS) as Array<[TextField, string]>) {
    const value = (params.get(name) ?? "").trim()
    if (field === "lastVisit") filters.lastVisit = value === "success" || value === "unsuccess" ? value : ""
    else if (field === "balanceType") filters.balanceType = (BALANCE_TYPES as readonly string[]).includes(value) ? (value as ClientBalanceFilters["balanceType"]) : ""
    else if (field === "clientFrom" || field === "clientTo") filters[field] = day(value)
    else if (field.endsWith("Min") || field.endsWith("Max")) filters[field] = isDays(value) ? value : ""
    else filters[field] = value
  }
  for (const [field, name] of Object.entries(FLAG_PARAMS) as Array<[FlagField, string]>) filters[field] = ["1", "true"].includes(params.get(name) ?? "")

  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize"))
  const openClient = params.get("openClient")
  return {
    mode: realization ? "realization" : "created",
    toggle: params.get("toggle") === "marketType" ? "types" : "clients",
    filters,
    search: (params.get("search") ?? "").trim(),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : CLIENT_BALANCE_PAGE_SIZE,
    ordering: params.getAll("ordering").filter(Boolean),
    openClient: openClient && openClient !== "0" ? { key: openClient, name: params.get("clientName") ?? "" } : null,
  }
}

/** URL query of the page state (demo param names). */
export function stateToSearch(state: ClientBalanceState): string {
  const params = new URLSearchParams()
  const f = state.filters
  if (state.mode === "realization") {
    params.set("periodType", "secondPeriod")
    params.set("acceptedDateBegin", f.from)
    params.set("acceptedDateEnd", f.to)
  } else {
    params.set("fromDate", f.from)
    params.set("toDate", f.to)
  }
  if (state.toggle === "types") params.set("toggle", "marketType")
  for (const [field, name] of Object.entries(LIST_PARAMS) as Array<[ListField, string]>) f[field].forEach((value) => params.append(name, value))
  for (const [field, name] of Object.entries(TEXT_PARAMS) as Array<[TextField, string]>) if (f[field]) params.set(name, f[field])
  for (const [field, name] of Object.entries(FLAG_PARAMS) as Array<[FlagField, string]>) if (f[field]) params.set(name, "true")
  if (state.search) params.set("search", state.search)
  state.ordering.forEach((key) => params.append("ordering", key))
  if (state.page > 1) params.set("page", String(state.page))
  params.set("pageSize", String(state.pageSize))
  if (state.openClient) {
    params.set("openClient", state.openClient.key)
    if (state.openClient.name) params.set("clientName", state.openClient.name)
  }
  return params.toString()
}

/** "Фильтр / N" of the demo: every filter key present in the URL except
 * fromDate and search — so toDate (or both realization dates) always counts. */
export function countClientFilters(state: ClientBalanceState): number {
  const f = state.filters
  let count = state.mode === "realization" ? 2 : 1
  for (const field of Object.keys(LIST_PARAMS) as ListField[]) if (f[field].length) count += 1
  for (const field of Object.keys(TEXT_PARAMS) as TextField[]) if (f[field]) count += 1
  for (const field of Object.keys(FLAG_PARAMS) as FlagField[]) if (f[field]) count += 1
  return count
}

/** Params of GET /api/balances/client-balance for the page state. */
export function clientBalanceQuery(state: ClientBalanceState): BalanceQuery {
  const f = state.filters
  return {
    from: f.from,
    to: f.to,
    mode: state.mode === "realization" ? "realization" : undefined,
    branch: f.branch,
    zone: f.zone,
    organization: f.organization,
    clientType: f.clientType,
    agent: f.agent,
    deliverer: f.deliverer,
    collector: f.collector ? [f.collector] : [],
    deliveryMan: f.deliveryMan,
    balanceType: f.balanceType,
    excludeClosed: f.excludeClosed,
    orderScope: f.onlyDelivered ? "delivered" : f.releasedOrders ? "released" : undefined,
    clientCreatedFrom: f.clientFrom,
    clientCreatedTo: f.clientTo,
    orderDaysMin: f.orderDaysMin,
    orderDaysMax: f.orderDaysMax,
    paymentDaysMin: f.paymentDaysMin,
    paymentDaysMax: f.paymentDaysMax,
    lastVisit: f.lastVisit,
    rejectDaysMin: f.rejectDaysMin,
    rejectDaysMax: f.rejectDaysMax,
    visitDaysMin: f.visitDaysMin,
    visitDaysMax: f.visitDaysMax,
    onlyInvoicePayments: f.onlyInvoice,
    groupBy: state.toggle === "types" ? "type" : undefined,
    search: state.search,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
  }
}

// --- header pieces ------------------------------------------------------------

const PERIOD_HINTS: Record<ClientBalanceMode, string[]> = {
  created: [
    "При расчете оперативного долга система будет учитывать все транзакции по дате создания и будет учитывать:",
    "1. Все заказы (кроме неподтвержденных и отмененных заказов).",
    "2. Все оплаты (кроме отмененных).",
    "3. Все возвраты (кроме отмененных).",
  ],
  realization: [
    "При расчете фактического долга система будет учитывать все транзакции по дате реализации и будет учитывать:",
    "1. Заказы после выдачи со склада (то есть статус \"Доставляется\" и \"Доставленные\").",
    "2. Только принятые возвраты на склад (то есть статус \"Принят\").",
    "3. Только принятые оплаты в кассу.",
  ],
}

/** Nav-bar toggle "По дате создание транзакции" | "По дате реализации" with the demo info tooltips. */
export function ClientBalancePeriodToggle({ mode, onChange }: { mode: ClientBalanceMode; onChange: (mode: ClientBalanceMode) => void }) {
  const { t } = useLanguage()
  const items: Array<{ mode: ClientBalanceMode; label: string }> = [
    { mode: "created", label: "По дате создание транзакции" },
    { mode: "realization", label: "По дате реализации" },
  ]
  return (
    <div className="my-3 flex overflow-visible rounded-md border border-[#dbe0e8]">
      {items.map((item) => (
        <button
          key={item.mode}
          type="button"
          onClick={() => onChange(item.mode)}
          className={`group relative flex items-center gap-2 px-5 py-3 text-[15px] font-semibold first:rounded-l-md last:rounded-r-md ${
            mode === item.mode ? "bg-[#71ce87] text-white" : "bg-white text-[#586174]"
          }`}
        >
          <Info className="h-4 w-4" />
          {t(item.label)}
          <span className="pointer-events-none absolute right-0 top-full z-[70] mt-2 hidden w-[360px] rounded-md bg-[#17233b] px-4 py-3 text-left text-[13px] font-normal leading-5 text-white shadow-lg group-hover:block">
            {PERIOD_HINTS[item.mode].map((line, index) => (
              <span key={line} className={`block ${index === 0 ? "mb-2" : ""}`}>
                {t(line)}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Blue "Фильтр / N" button with the demo's header text: the period (or
 * green "Реализовано" in realization mode) and the selected organizations /
 * branches, else "Во всей организации". */
export function ClientBalanceFilterButton({ state, onOpen }: { state: ClientBalanceState; onOpen: () => void }) {
  const { t } = useLanguage()
  const f = state.filters
  const scope = [...f.organization, ...f.branch]
  const realization = state.mode === "realization"
  const scopeText = scope.length ? scope.join(" ") : realization ? `${t("Реализовано")}${f.deliveryMan ? ` ${t("(По доставщику)")}` : ""}` : t("Во всей организации")
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" onClick={onOpen} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
        <Filter className="h-4 w-4" /> {t("Фильтр")} / {countClientFilters(state)}
      </button>
      {!realization && (
        <span className="font-semibold text-[#4f70e7]">
          {formatDotDate(f.from)} - {formatDotDate(f.to)}
        </span>
      )}
      <span className="font-semibold" style={{ color: realization ? "rgb(113, 206, 135)" : "#4f70e7" }}>
        {scopeText}
      </span>
    </div>
  )
}

// --- popup fields ---------------------------------------------------------------

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]"

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

type Option = { value: string; label: string }

/** Multi-select with search (demo *MultiSearchField). */
export function MultiSelect({ value, options, onChange, disabled = false }: { value: string[]; options: Option[]; onChange: (next: string[]) => void; disabled?: boolean }) {
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
  const labels = new Map(options.map((option) => [option.value, option.label]))
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${fieldClass} flex items-center justify-between gap-2 text-left disabled:bg-[#f2f5f8] disabled:text-[#9aa3b6]`}
      >
        <span className={`truncate ${value.length ? "" : "text-[#9aa3b6]"}`}>
          {value.length ? value.map((item) => labels.get(item) ?? item).join(", ") : disabled ? t("Нет данных") : t("Все")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-[110] mt-1 max-h-72 overflow-hidden rounded-md border border-[#e1e5eb] bg-white shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Поиск")}
            className="h-9 w-full border-b border-[#e1e5eb] px-3 text-[#17233b] outline-none"
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {shown.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[#17233b] hover:bg-[#f2f5f8]">
                <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} className="h-4 w-4 accent-[#4f70e7]" />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
            {!shown.length && <p className="px-3 py-2 text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

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

function DaysRange({
  label,
  min,
  max,
  onChange,
}: {
  label: string
  min: string
  max: string
  onChange: (next: { min: string; max: string }) => void
}) {
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

const names = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))

/** Fields of the demo filter popup (in the demo's order), editing a draft. */
export function ClientBalanceFilterFields({
  draft,
  onChange,
  options,
}: {
  draft: ClientBalanceFilters
  onChange: (next: ClientBalanceFilters) => void
  options: ClientBalanceOptions | null
}) {
  const { t } = useLanguage()
  const set = <K extends keyof ClientBalanceFilters>(field: K, value: ClientBalanceFilters[K]) => onChange({ ...draft, [field]: value })
  const typeOptions = useMemo(() => {
    const list = names(options?.types ?? [])
    if (options?.untyped) list.push({ value: NO_CLIENT_TYPE, label: t("Не указано") })
    // Keep values that came from the URL / drill-down even when not in the lookup.
    for (const value of draft.clientType) if (!list.some((option) => option.value === value)) list.push({ value, label: value === NO_CLIENT_TYPE ? t("Не указано") : value })
    return list
  }, [options, draft.clientType, t])
  const withSelected = (values: string[] | undefined, selected: string[]) => names([...new Set([...(values ?? []), ...selected])])

  return (
    <>
      <Field label="Филиалы">
        <MultiSelect value={draft.branch} options={withSelected(options?.branches, draft.branch)} onChange={(value) => set("branch", value)} />
      </Field>
      <Field label="Зона">
        <MultiSelect value={draft.zone} options={withSelected(options?.zones, draft.zone)} onChange={(value) => set("zone", value)} />
      </Field>
      <Field label="Последнее посещение">
        <SingleSelect
          value={draft.lastVisit}
          options={[
            { value: "success", label: t("Успешный") },
            { value: "unsuccess", label: t("Не успешно") },
          ]}
          onChange={(value) => set("lastVisit", value as ClientBalanceFilters["lastVisit"])}
        />
      </Field>
      <Field label="Период создания клиента">
        <span className="flex items-center gap-2">
          <input type="date" value={draft.clientFrom} onChange={(event) => set("clientFrom", event.target.value)} className={fieldClass} />
          <span className="text-[#586174]">—</span>
          <input type="date" value={draft.clientTo} onChange={(event) => set("clientTo", event.target.value)} className={fieldClass} />
        </span>
      </Field>
      <DaysRange label="Прошло дней с последнего заказа" min={draft.orderDaysMin} max={draft.orderDaysMax} onChange={({ min, max }) => onChange({ ...draft, orderDaysMin: min, orderDaysMax: max })} />
      <DaysRange
        label="Прошло дней с последней оплаты"
        min={draft.paymentDaysMin}
        max={draft.paymentDaysMax}
        onChange={({ min, max }) => onChange({ ...draft, paymentDaysMin: min, paymentDaysMax: max })}
      />
      <DaysRange label="Прошло дней с последнего отказа" min={draft.rejectDaysMin} max={draft.rejectDaysMax} onChange={({ min, max }) => onChange({ ...draft, rejectDaysMin: min, rejectDaysMax: max })} />
      <DaysRange label="Прошло дней с последнего визита" min={draft.visitDaysMin} max={draft.visitDaysMax} onChange={({ min, max }) => onChange({ ...draft, visitDaysMin: min, visitDaysMax: max })} />
      <Field label="Организация">
        <MultiSelect value={draft.organization} options={withSelected(options?.organizations, draft.organization)} onChange={(value) => set("organization", value)} />
      </Field>
      <Field label="Тип клиента">
        <MultiSelect value={draft.clientType} options={typeOptions} onChange={(value) => onChange({ ...draft, clientType: value, subType: value.length ? draft.subType : [] })} />
      </Field>
      {draft.clientType.length > 0 && (
        <Field label="Подкатегория">
          {/* Client types have no sub-types in this database. */}
          <MultiSelect value={draft.subType} options={[]} onChange={(value) => set("subType", value)} disabled />
        </Field>
      )}
      <Field label="Клиенты агента">
        <MultiSelect value={draft.agent} options={withSelected(options?.agents, draft.agent)} onChange={(value) => set("agent", value)} />
      </Field>
      <Field label="Доставщик">
        <SingleSelect value={draft.deliveryMan} options={withSelected(options?.deliverers, draft.deliveryMan ? [draft.deliveryMan] : [])} onChange={(value) => set("deliveryMan", value)} />
      </Field>
      <Field label="Тип баланса">
        <SingleSelect
          value={draft.balanceType}
          options={[
            { value: "debtor", label: t("Задолжник на конец") },
            { value: "creditor", label: t("Закладчик на конец") },
            { value: "debtor_for_begin", label: t("Задолжник на начало") },
            { value: "creditor_for_begin", label: t("Закладчик на начало") },
          ]}
          onChange={(value) => set("balanceType", value as ClientBalanceFilters["balanceType"])}
        />
      </Field>
      <Field label="Ответственные доставщики">
        <MultiSelect value={draft.deliverer} options={withSelected(options?.deliverers, draft.deliverer)} onChange={(value) => set("deliverer", value)} />
      </Field>
      <Field label="Ответственный инкасатор">
        <SingleSelect value={draft.collector} options={withSelected(options?.collectors, draft.collector ? [draft.collector] : [])} onChange={(value) => set("collector", value)} />
      </Field>
      <div className="flex flex-col gap-2 pt-2 text-[14px] text-[#17233b] md:col-span-2">
        {(
          [
            ["releasedOrders", "Учитывать только реализованных заказов"],
            ["onlyDelivered", "Только доставленные заказы"],
            ["onlyInvoice", "Только оплаты с счет фактурой"],
            ["excludeClosed", "Исключить закрытие магазины"],
          ] as Array<[FlagField, string]>
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2">
            <input type="checkbox" checked={draft[field]} onChange={(event) => set(field, event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t(label)}
          </label>
        ))}
      </div>
    </>
  )
}
