"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { FilterCheck, FilterText } from "@/components/ref/list-kit"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

import type { ClientReturnRow } from "./returns-view"

// Продажи → Возвраты: Linko's return filter (its ReturnFilterForm, #/return). The panel has Linko's fields in Linko's
// order, four per row; the address holds Linko's own keys with ids joined by "-" (?branch=1-6&stock=13&deliveryMan=188
// &fromDate=2026-01-01&toDate=2026-01-31&exclude=true …), so a Linko link opens the same list here. Multi-search
// fields show the picked entries as chips; Доставщик, Тип оплаты (транзакции), Тип возврата and Вид возврата take one
// value. «Фильтр: N элемента» counts the keys that are set except fromDate (Linko's getCount).
// The rows carry names for most of these (client_returns stores the warehouse, people and organization by name), so a
// picked id is matched through its directory's name; the shop, the lines' products and the client account match by id.

export type ReturnFilters = {
  branch: string[]
  order: string
  product: string[]
  brand: string[]
  deliveryMan: string
  division: string[]
  paymentType: string
  status: string[]
  type: string
  createdBy: string[]
  customPaymentType: string[]
  client: string[]
  responsibleAgent: string[]
  market: string[]
  marketTypeParent: string[]
  marketType: string[]
  zone: string[]
  stock: string[]
  isReturnOnDelivery: string
  code: string
  fromDate: string
  toDate: string
  transferPeriodFromDate: string
  transferPeriodToDate: string
  exclude: boolean
}

export const EMPTY_RETURN_FILTERS: ReturnFilters = {
  branch: [],
  order: "",
  product: [],
  brand: [],
  deliveryMan: "",
  division: [],
  paymentType: "",
  status: [],
  type: "",
  createdBy: [],
  customPaymentType: [],
  client: [],
  responsibleAgent: [],
  market: [],
  marketTypeParent: [],
  marketType: [],
  zone: [],
  stock: [],
  isReturnOnDelivery: "",
  code: "",
  fromDate: "",
  toDate: "",
  transferPeriodFromDate: "",
  transferPeriodToDate: "",
  exclude: false,
}

const LIST_KEYS = ["branch", "product", "brand", "division", "status", "createdBy", "customPaymentType", "client", "responsibleAgent", "market", "marketTypeParent", "marketType", "zone", "stock"] as const
const TEXT_KEYS = ["order", "deliveryMan", "paymentType", "type", "isReturnOnDelivery", "code", "fromDate", "toDate", "transferPeriodFromDate", "transferPeriodToDate"] as const
const DAY_KEYS = new Set(["fromDate", "toDate", "transferPeriodFromDate", "transferPeriodToDate"])

/** The return statuses of the filter and the tabs (Надо принять = 0-1, Принятые = 2): Linko's codes. Linko's «В ходе
 * выполнения» (1) is a state Mezon returns never have. */
export const RETURN_STATUS_OPTIONS = [
  { value: "0", label: "В ожидании", status: "pending" },
  { value: "1", label: "В ходе выполнения", status: null },
  { value: "2", label: "Принятые", status: "accepted" },
  { value: "3", label: "Отменен", status: "cancelled" },
] as const

const TRANSACTION_PAYMENT_TYPES: Option[] = [
  { value: "bank", label: "Банковский счет" },
  { value: "cash", label: "Наличный" },
]
const CUSTOM_PAYMENT_TYPES: Option[] = [
  { value: "cash", label: "Наличные" },
  { value: "bank", label: "Перечисление" },
]
const RETURN_TYPES: Option[] = [
  { value: "old_base_return", label: "Со старый базе" },
  { value: "order_return", label: "С заказа" },
]
const RETURN_KINDS: Option[] = [
  { value: "true", label: "При доставке" },
  { value: "false", label: "С полки" },
]

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

/** The filter from the address (Linko's keys; lists are "-" joined). */
export function readReturnFilters(params: URLSearchParams): ReturnFilters {
  const filters: ReturnFilters = { ...EMPTY_RETURN_FILTERS }
  for (const key of LIST_KEYS) {
    filters[key] = [...new Set((params.get(key) ?? "").split("-").map((part) => part.trim()).filter((part) => /^[\w.]{1,64}$/.test(part)))].slice(0, 200)
  }
  filters.status = filters.status.filter((code) => RETURN_STATUS_OPTIONS.some((option) => option.value === code))
  for (const key of TEXT_KEYS) {
    const value = (params.get(key) ?? "").slice(0, 200)
    filters[key] = DAY_KEYS.has(key) && !isDay(value) ? "" : value
  }
  filters.exclude = params.get("exclude") === "true"
  return filters
}

/** Writes the set keys into `params` (Linko's names). */
export function writeReturnFilters(params: URLSearchParams, filters: ReturnFilters) {
  for (const key of LIST_KEYS) if (filters[key].length) params.set(key, filters[key].join("-"))
  for (const key of TEXT_KEYS) if (filters[key]) params.set(key, filters[key])
  if (filters.exclude) params.set("exclude", "true")
}

/** Linko's «Фильтр: N элемента»: every set key but fromDate (a period counts once by its toDate; the acceptance period
 * by both of its ends). */
export function returnFilterCount(filters: ReturnFilters): number {
  const lists = LIST_KEYS.filter((key) => filters[key].length).length
  const texts = TEXT_KEYS.filter((key) => key !== "fromDate" && filters[key]).length
  return lists + texts + (filters.exclude ? 1 : 0)
}

export type Option = { value: string; label: string }
type TypeOption = Option & { parentId: number | null }

export type ReturnFilterDirectories = {
  branches: Option[]
  brands: Option[]
  organizations: Option[]
  employees: Option[]
  deliverers: Option[]
  zones: Option[]
  warehouses: Option[]
  clientTypes: TypeOption[]
}

type BigDirectories = { products: Option[]; accounts: Option[]; clients: Option[] }

async function getRows(url: string): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await fetch(url, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as unknown
    return response.ok && Array.isArray(body) ? (body as Array<Record<string, unknown>>) : []
  } catch {
    return []
  }
}

const personName = (row: Record<string, unknown>) => `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() || String(row.name ?? "")
const toOptions = (rows: Array<Record<string, unknown>>, name: (row: Record<string, unknown>) => string = (row) => String(row.name ?? "")) =>
  rows.filter((row) => row.id !== undefined && row.id !== null && name(row)).map((row) => ({ value: String(row.id), label: name(row) }))

/** The small directories the filter needs to match ids (and to offer them): loaded once with the page. */
export function useReturnFilterDirectories(): ReturnFilterDirectories | null {
  const [directories, setDirectories] = useState<ReturnFilterDirectories | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all([
      getRows("/api/branches"),
      getRows("/api/brands"),
      getRows("/api/organizations"),
      getRows("/api/employees"),
      fetch("/api/orders/form-options", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ deliverers?: string[] }>) : null))
        .catch(() => null),
      getRows("/api/clients/zones"),
      getRows("/api/warehouses"),
      getRows("/api/client-types"),
    ]).then(([branches, brands, organizations, employees, formOptions, zones, warehouses, clientTypes]) => {
      if (!alive) return
      const people = toOptions(employees, personName)
      // Linko's Доставщик lists the delivery group (main/crud/for_select/?group=delivery), here the order form's deliverers.
      const deliverers = (formOptions?.deliverers ?? []).flatMap((name) => people.filter((person) => person.label === name).slice(0, 1))
      setDirectories({
        branches: toOptions(branches),
        brands: toOptions(brands),
        organizations: toOptions(organizations),
        employees: people,
        deliverers,
        zones: toOptions(zones),
        warehouses: toOptions(warehouses),
        clientTypes: clientTypes
          .filter((row) => row.id !== undefined && row.name)
          .map((row) => ({ value: String(row.id), label: String(row.name), parentId: typeof row.parentId === "number" ? row.parentId : null })),
      })
    })
    return () => {
      alive = false
    }
  }, [])
  return directories
}

let bigDirectories: Promise<BigDirectories> | null = null

/** Products, client accounts and shops (thousands of rows): loaded the first time the panel opens, then kept. */
function useBigDirectories(): BigDirectories | null {
  const [big, setBig] = useState<BigDirectories | null>(null)
  useEffect(() => {
    let alive = true
    bigDirectories ??= Promise.all([getRows("/api/products"), getRows("/api/financial-accounts"), getRows("/api/clients?balances=0")]).then(([products, accounts, clients]) => {
      const loaded = {
        products: toOptions(products.filter((row) => !row.deleted)),
        accounts: toOptions(accounts.filter((row) => !row.deleted)),
        clients: toOptions(clients),
      }
      // A failed load is tried again on the next opening.
      if (!products.length || !clients.length) bigDirectories = null
      return loaded
    })
    void bigDirectories.then((loaded) => alive && setBig(loaded))
    return () => {
      alive = false
    }
  }, [])
  return big
}

const namesOf = (options: Option[], ids: string[]) => {
  const wanted = new Set(ids)
  return new Set(options.filter((option) => wanted.has(option.value)).map((option) => option.label))
}

/** A UTC moment ("2026-01-29T08:09:14.000Z", or the app's "2026-01-29 08:09:14" without a zone) as its local day. */
function localDayOf(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Whether the filter matches an id through a directory's name (the list waits for the directories then). */
export function returnFiltersNeedDirectories(filters: ReturnFilters): boolean {
  return Boolean(filters.branch.length || filters.brand.length || filters.deliveryMan || filters.division.length || filters.createdBy.length || filters.responsibleAgent.length || filters.marketTypeParent.length || filters.marketType.length || filters.zone.length || filters.stock.length)
}

/** The rows the filter keeps, as Linko's order_return list answers for the same address (search and order aside). */
export function filterReturns<T extends ClientReturnRow & { accountId?: number | null; markCodes?: string[]; shopBranch?: string }>(rows: T[], filters: ReturnFilters, directories: ReturnFilterDirectories | null): T[] {
  const dirs = directories ?? { branches: [], brands: [], organizations: [], employees: [], deliverers: [], zones: [], warehouses: [], clientTypes: [] }
  const statuses = new Set(filters.status.map((code) => RETURN_STATUS_OPTIONS.find((option) => option.value === code)?.status).filter(Boolean))
  const branches = namesOf(dirs.branches, filters.branch)
  const brands = namesOf(dirs.brands, filters.brand)
  const divisions = namesOf(dirs.organizations, filters.division)
  const deliverer = filters.deliveryMan ? namesOf(dirs.employees, [filters.deliveryMan]) : null
  const creators = namesOf(dirs.employees, filters.createdBy)
  const agents = namesOf(dirs.employees, filters.responsibleAgent)
  // Linko sends market_type = Подкатегория, else Тип клиента.
  const types = namesOf(dirs.clientTypes, filters.marketType.length ? filters.marketType : filters.marketTypeParent)
  const zones = namesOf(dirs.zones, filters.zone)
  const stocks = namesOf(dirs.warehouses, filters.stock)
  const products = new Set(filters.product.map(Number))
  const markets = new Set(filters.market.map(Number))
  const accounts = new Set(filters.client.map(Number))
  const customLabels = new Set(CUSTOM_PAYMENT_TYPES.filter((option) => filters.customPaymentType.includes(option.value)).map((option) => option.label))
  const inDays = (day: string, begin: string, end: string) => Boolean(day) && !((begin && day < begin) || (end && day > end))
  const code = filters.code.trim()
  return rows.filter((row) => {
    // Linko's exclude_cancelled=True: cancelled returns only with «Показать отмененные возвраты» (or, here, the status
    // «Отменен» itself — Linko's list then stays empty).
    if (row.status === "cancelled" && !filters.exclude && !statuses.has("cancelled")) return false
    if (filters.status.length && !statuses.has(row.status)) return false
    // Linko's branch: the return's own, else (none of its own) its shop's.
    if (filters.branch.length && !branches.has(row.branch || row.shopBranch || "")) return false
    if (filters.order.trim() && String(row.orderId ?? "") !== filters.order.trim()) return false
    if (filters.product.length && !(row.productIds ?? []).some((id) => products.has(id))) return false
    if (filters.brand.length && !(row.brands ?? []).some((name) => brands.has(name))) return false
    if (deliverer && !deliverer.has(row.deliverer)) return false
    if (filters.division.length && !divisions.has(row.organization ?? "")) return false
    if (filters.paymentType && (row.returnPaymentType ?? row.paymentType) !== filters.paymentType) return false
    if (filters.type && (filters.type === "order_return") !== Boolean(row.fromOrder)) return false
    if (filters.createdBy.length && !creators.has(row.createdBy)) return false
    // «Тип оплаты» is Linko's custom payment type: a copied return matches by that type's name (its older «cash» /
    // «bank» types match neither choice), a return made here by its payment type.
    if (filters.customPaymentType.length) {
      const own = row.returnPaymentType ?? row.paymentType ?? ""
      if (row.paymentTypeName ? !customLabels.has(row.paymentTypeName) : !filters.customPaymentType.includes(own)) return false
    }
    if (filters.client.length && !accounts.has(Number(row.accountId))) return false
    if (filters.responsibleAgent.length && !agents.has(row.agent)) return false
    if (filters.market.length && !markets.has(Number(row.clientId))) return false
    if ((filters.marketType.length || filters.marketTypeParent.length) && !types.has(row.clientType ?? "")) return false
    if (filters.zone.length && !zones.has(row.zone)) return false
    if (filters.stock.length && !stocks.has(row.warehouse)) return false
    if (filters.isReturnOnDelivery && (filters.isReturnOnDelivery === "true") !== Boolean(row.onDelivery)) return false
    // Linko's «Код» looks for the lines' marking codes.
    if (code && !(row.markCodes ?? []).includes(code)) return false
    if ((filters.fromDate || filters.toDate) && !inDays(row.returnDate.slice(0, 10), filters.fromDate, filters.toDate || filters.fromDate)) return false
    // Linko: begin_accepted_time / end_accepted_time as given (no end falls back to the start).
    if ((filters.transferPeriodFromDate || filters.transferPeriodToDate) && !inDays(localDayOf(row.acceptedAt), filters.transferPeriodFromDate, filters.transferPeriodToDate)) return false
    return true
  })
}

/* ---------- Fields (Linko's react-select geometry in a 62 px block: the control 18 px down, 36 px tall) ---------- */

const CHIP_CLOSE = "flex h-full w-[17.7px] items-center justify-center border-r border-white/40"

function Caret({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[39.3px] h-[5px] w-[10px] fill-[#999]" aria-hidden>
      <path d={open ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} />
    </svg>
  )
}

/** The search fields' list closes (and forgets the typed text) on a click outside the field. */
function useCloseOutside(rootRef: RefObject<HTMLDivElement | null>, open: boolean, setOpen: (open: boolean) => void, setQuery: (query: string) => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [rootRef, open, setOpen, setQuery])
}

function MenuList({ options, chosen, onPick, emptyText }: { options: Option[]; chosen: (value: string) => boolean; onPick: (value: string) => void; emptyText: string }) {
  const { t } = useLanguage()
  return (
    <div className="absolute inset-x-0 top-[54px] z-50 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      {options.length === 0 ? (
        <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t(emptyText)}</div>
      ) : (
        options.slice(0, 100).map((option) => (
          <button
            key={option.value}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(option.value)}
            className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8] ${chosen(option.value) ? "text-[#1E4A9A]" : "text-[#333]"}`}
          >
            {t(option.label)}
          </button>
        ))
      )}
    </div>
  )
}

/** Linko's multi-search field: the name until something is picked, then a small label over «× name» chips; × clears
 * them all. A pick keeps the list open (a second click drops the entry), typing filters the list. */
function MultiField({ label, options, value, onChange, translate = false }: { label: string; options: Option[] | null; value: string[]; onChange: (next: string[]) => void; translate?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useCloseOutside(rootRef, open, setOpen, setQuery)
  const close = () => (setOpen(false), setQuery(""))
  const inputRef = useRef<HTMLInputElement>(null)
  const byValue = useMemo(() => new Map((options ?? []).map((option) => [option.value, option.label])), [options])
  const text = (option: string) => (translate ? t(option) : option)
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = (options ?? []).filter((option) => !needle || text(option.label).toLocaleLowerCase("ru").includes(needle))
  const toggle = (picked: string) => onChange(value.includes(picked) ? value.filter((item) => item !== picked) : [...value, picked])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      close()
    } else if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
    else if (event.key === "Enter") {
      event.preventDefault()
      if (shown[0]) toggle(shown[0].value)
    }
  }
  const filled = value.length > 0
  return (
    <div ref={rootRef} className="relative h-[62px]">
      <div
        role="button"
        tabIndex={-1}
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="absolute inset-x-0 top-[18px] h-[36px] cursor-text border-b border-[#e8e8e8] text-[13px] font-semibold text-black"
      >
        {filled && <span className="absolute left-0 top-[-13px] text-[10px] font-bold leading-3">{t(label)}</span>}
        <span className="absolute inset-y-0 left-0 right-[45px] flex flex-wrap content-start items-start gap-x-[5px] gap-y-[3px] pt-[5px]">
          {value.map((item) => (
            <span key={item} className="flex h-[22.4px] items-center bg-[#1E4A9A] text-[11.7px] font-semibold text-white">
              <button type="button" aria-label={t("Удалить")} onClick={(event) => (event.stopPropagation(), onChange(value.filter((entry) => entry !== item)))} className={CHIP_CLOSE}>
                ×
              </button>
              <span className="whitespace-nowrap px-[5px]">{text(byValue.get(item) ?? item)}</span>
            </span>
          ))}
          {open || filled ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => (setQuery(event.target.value), setOpen(true))}
              onKeyDown={onKeyDown}
              aria-label={t(label)}
              className={`h-[22px] min-w-[5px] flex-1 bg-transparent text-[13px] font-normal outline-none ${filled ? "" : "absolute left-0 top-[8px]"}`}
            />
          ) : null}
        </span>
        {!filled && !query && <span className="pointer-events-none absolute left-0 top-[12px] leading-4">{t(label)}</span>}
        {filled && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => (event.stopPropagation(), onChange([]))} className="absolute right-[28.4px] top-[13.8px] text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#d0021b]">
            ×
          </button>
        )}
      </div>
      <Caret open={open} />
      {open && <MenuList options={options === null ? [] : shown} chosen={(item) => value.includes(item)} onPick={toggle} emptyText={options === null ? "Загрузка..." : "Ничего не найдено"} />}
    </div>
  )
}

/** Linko's single search field: the picked entry in place of the name (a small label over it), × empties it. */
function SingleField({ label, options, value, onChange, translate = false }: { label: string; options: Option[] | null; value: string; onChange: (next: string) => void; translate?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useCloseOutside(rootRef, open, setOpen, setQuery)
  const close = () => (setOpen(false), setQuery(""))
  const inputRef = useRef<HTMLInputElement>(null)
  const text = (option: string) => (translate ? t(option) : option)
  const picked = (options ?? []).find((option) => option.value === value)
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = (options ?? []).filter((option) => !needle || text(option.label).toLocaleLowerCase("ru").includes(needle))
  const pick = (next: string) => {
    onChange(next)
    close()
  }
  return (
    <div ref={rootRef} className="relative h-[62px]">
      <div
        role="button"
        tabIndex={-1}
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="absolute inset-x-0 top-[18px] h-[36px] cursor-text border-b border-[#e8e8e8] text-[13px] font-semibold text-black"
      >
        {value && <span className="absolute left-0 top-[-13px] text-[10px] font-bold leading-3">{t(label)}</span>}
        {open && (
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                close()
              } else if (event.key === "Enter") {
                event.preventDefault()
                if (shown[0]) pick(shown[0].value)
              }
            }}
            aria-label={t(label)}
            className="absolute left-0 right-[45px] top-[11px] h-[18px] bg-transparent text-[13px] font-normal outline-none"
          />
        )}
        {!query && (
          <span className={`pointer-events-none absolute left-0 right-[45px] truncate leading-[18px] ${value ? "top-[13px] text-[#333]" : "top-[12px]"}`}>
            {value ? text(picked?.label ?? value) : t(label)}
          </span>
        )}
        {value && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => (event.stopPropagation(), onChange(""))} className="absolute right-[28.4px] top-[13.8px] text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#d0021b]">
            ×
          </button>
        )}
      </div>
      <Caret open={open} />
      {open && <MenuList options={options === null ? [] : shown} chosen={(item) => item === value} onPick={pick} emptyText={options === null ? "Загрузка..." : "Ничего не найдено"} />}
    </div>
  )
}

const DATE_RANGE = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Linko's period field (DateToDateField): the small label above, «Укажите дату» or «01 янв. 2026 – 31 янв. 2026», a ×
 * once set and the 18 px calendar at the right end. */
function PeriodField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const day = (iso: string) => formatDateText(iso, language, { withTime: false })
  const today = todayIso()
  return (
    <div className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-0 h-[54px] w-full cursor-pointer text-left">
        <span className="absolute left-0 top-[5px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
        <span className="absolute left-0 right-[44px] top-[32px] truncate text-[13px] leading-4 text-black">{begin || end ? `${day(begin || end)} – ${day(end || begin)}` : t("Укажите дату")}</span>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[31px] h-[18px] w-[18px] fill-[#8a90a0]" aria-hidden>
          <path d={DATE_RANGE} />
        </svg>
        <span className="absolute inset-x-0 top-[53px] h-px bg-[#e0e0e0]" />
      </button>
      {(begin || end) && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-[24px] top-[33px] flex h-[14px] w-[14px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#8a90a0]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={begin || end || today}
          end={end || begin || today}
          positionClassName="left-0 top-[62px]"
          onClose={() => setOpen(false)}
          onApply={(from, to) => {
            onChange(from, to)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** The panel's fields, in Linko's order, four per row. */
export function ReturnsFilterFields({ draft, onChange, directories }: { draft: ReturnFilters; onChange: (next: ReturnFilters) => void; directories: ReturnFilterDirectories | null }) {
  const big = useBigDirectories()
  const set = <K extends keyof ReturnFilters>(key: K) => (value: ReturnFilters[K]) => onChange({ ...draft, [key]: value })
  const parents = useMemo(() => directories?.clientTypes.filter((type) => type.parentId === null) ?? null, [directories])
  const children = useMemo(() => {
    const chosen = new Set(draft.marketTypeParent.map(Number))
    return directories?.clientTypes.filter((type) => type.parentId !== null && chosen.has(type.parentId)) ?? null
  }, [directories, draft.marketTypeParent])
  return (
    <div className="grid grid-cols-4 gap-x-[10px] gap-y-[5px]">
      <MultiField label="Филиалы" options={directories?.branches ?? null} value={draft.branch} onChange={set("branch")} />
      <FilterText label="№ Заказа" value={draft.order} onChange={set("order")} />
      <MultiField label="Продукт" options={big?.products ?? null} value={draft.product} onChange={set("product")} />
      <MultiField label="Бренд" options={directories?.brands ?? null} value={draft.brand} onChange={set("brand")} />
      <SingleField label="Доставщик" options={directories?.deliverers ?? null} value={draft.deliveryMan} onChange={set("deliveryMan")} />
      <MultiField label="Организация" options={directories?.organizations ?? null} value={draft.division} onChange={set("division")} />
      <SingleField label="Тип оплаты (транзакции)" options={TRANSACTION_PAYMENT_TYPES} value={draft.paymentType} onChange={set("paymentType")} translate />
      <MultiField label="Статус" options={RETURN_STATUS_OPTIONS.map(({ value, label }) => ({ value, label }))} value={draft.status} onChange={set("status")} translate />
      <SingleField label="Тип возврата" options={RETURN_TYPES} value={draft.type} onChange={set("type")} translate />
      <MultiField label="Возврат создал" options={directories?.employees ?? null} value={draft.createdBy} onChange={set("createdBy")} />
      <MultiField label="Тип оплаты" options={CUSTOM_PAYMENT_TYPES} value={draft.customPaymentType} onChange={set("customPaymentType")} translate />
      <MultiField label="Финансовый счет" options={big?.accounts ?? null} value={draft.client} onChange={set("client")} />
      <MultiField label="Ответственный агент" options={directories?.employees ?? null} value={draft.responsibleAgent} onChange={set("responsibleAgent")} />
      <MultiField label="Клиент" options={big?.clients ?? null} value={draft.market} onChange={set("market")} />
      <MultiField
        label="Тип клиента"
        options={parents}
        value={draft.marketTypeParent}
        // Linko's Подкатегория belongs to the picked types: it empties with them.
        onChange={(next) => onChange({ ...draft, marketTypeParent: next, marketType: next.length ? draft.marketType : [] })}
      />
      {draft.marketTypeParent.length ? <MultiField label="Подкатегория" options={children} value={draft.marketType} onChange={set("marketType")} /> : null}
      <MultiField label="Зона" options={directories?.zones ?? null} value={draft.zone} onChange={set("zone")} />
      <MultiField label="Склад" options={directories?.warehouses ?? null} value={draft.stock} onChange={set("stock")} />
      <SingleField label="Вид возврата" options={RETURN_KINDS} value={draft.isReturnOnDelivery} onChange={set("isReturnOnDelivery")} translate />
      <FilterText label="Код" value={draft.code} onChange={set("code")} />
      <PeriodField label="Период создания" begin={draft.fromDate} end={draft.toDate} onChange={(fromDate, toDate) => onChange({ ...draft, fromDate, toDate })} />
      <PeriodField label="Период приемки на складе" begin={draft.transferPeriodFromDate} end={draft.transferPeriodToDate} onChange={(transferPeriodFromDate, transferPeriodToDate) => onChange({ ...draft, transferPeriodFromDate, transferPeriodToDate })} />
      {/* Linko's CheckBox: a 20 px box, the label 6 px after it. */}
      <FilterCheck compact label="Показать отмененные возвраты" checked={draft.exclude} onChange={set("exclude")} className="self-start pt-[4.8px]" />
    </div>
  )
}
