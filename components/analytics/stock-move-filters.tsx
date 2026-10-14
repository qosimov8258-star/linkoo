"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { MOVE_GROUP_BY, type MoveGroupBy, type MoveMode, type MovePresence } from "@/lib/stock-movement-columns"

// URL state, filter options and the filter dialog of "Остаток на определенную
// дату" (demo m2200 / m3875). URL keys follow the demo: fromDate toDate stock*
// branch* division* typeParent* type* brand* transactionInPeriod
// balanceInPeriod showOthers groupBy toggle=quantity|price|priceList priceList
// search ordering page pageSize, plus product=<item key> [kind] for the item detail.

export type MoveToggle = "quantity" | "price" | "priceList"

export type MoveState = {
  from: string
  to: string
  /** Raw URL dates ("" = default period). */
  urlFrom: string
  urlTo: string
  warehouses: string[]
  branches: string[]
  divisions: string[]
  typeParents: string[]
  types: string[]
  brands: string[]
  transaction: MovePresence
  balance: MovePresence
  showOthers: boolean
  groupBy: MoveGroupBy
  toggle: MoveToggle
  priceList: string
  search: string
  ordering: string
  page: number
  pageSize: number
  /** Item detail (product=<key>) and its kind filter. */
  item: string
  kind: string
}

export const MOVE_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000] as const

const GROUP_IDS = new Set<string>(MOVE_GROUP_BY.map((group) => group.id))

function presence(value: string | null): MovePresence {
  return value === "exist" || value === "not_exist" ? value : ""
}

function values(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

export function moveStateFromParams(params: URLSearchParams): MoveState {
  const today = todayIso()
  const urlFrom = isIsoDay(params.get("fromDate")) ? (params.get("fromDate") as string) : ""
  const urlTo = isIsoDay(params.get("toDate")) ? (params.get("toDate") as string) : ""
  // Demo default period: the whole current month.
  const periodFrom = urlFrom || monthStartIso(today)
  const periodTo = urlTo || monthEndIso(today)
  const [from, to] = periodFrom <= periodTo ? [periodFrom, periodTo] : [periodTo, periodFrom]
  const groupRaw = params.get("groupBy") ?? ""
  const groupBy = (GROUP_IDS.has(groupRaw) ? groupRaw : "product") as MoveGroupBy
  const toggleRaw = params.get("toggle") ?? ""
  let toggle: MoveToggle = toggleRaw === "price" || toggleRaw === "priceList" ? toggleRaw : "quantity"
  if (toggle === "priceList" && (groupBy === "stock" || groupBy === "branch")) toggle = "quantity"
  const size = Number(params.get("pageSize"))
  const page = Math.floor(Number(params.get("page")))
  return {
    from,
    to,
    urlFrom,
    urlTo,
    warehouses: values(params, "stock"),
    branches: values(params, "branch"),
    divisions: values(params, "division"),
    typeParents: values(params, "typeParent"),
    types: values(params, "type"),
    brands: values(params, "brand"),
    transaction: presence(params.get("transactionInPeriod")),
    balance: presence(params.get("balanceInPeriod")),
    showOthers: params.get("showOthers") === "true",
    groupBy,
    toggle,
    priceList: (params.get("priceList") ?? "").trim(),
    search: (params.get("search") ?? "").trim(),
    ordering: (params.get("ordering") ?? "").trim(),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: (MOVE_PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
    item: (params.get("product") ?? "").trim(),
    kind: (params.get("kind") ?? "").trim(),
  }
}

export function moveMode(toggle: MoveToggle): MoveMode {
  return toggle === "price" ? "cost" : toggle === "priceList" ? "price" : "quantity"
}

/** Query string of /api/stock/movement/** for the state (filters only, plus `extra`). */
export function moveApiQuery(state: MoveState, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams()
  params.set("from", state.from)
  params.set("to", state.to)
  const repeat = (name: string, list: string[]) => list.forEach((value) => params.append(name, value))
  repeat("warehouse", state.warehouses)
  repeat("branch", state.branches)
  repeat("organization", state.divisions)
  repeat("type", state.typeParents)
  repeat("subcategory", state.types)
  repeat("brand", state.brands)
  if (state.search) params.set("search", state.search)
  params.set("groupBy", state.groupBy)
  params.set("mode", moveMode(state.toggle))
  if (state.toggle === "priceList" && state.priceList) params.set("priceList", state.priceList)
  if (state.transaction) params.set("transaction", state.transaction)
  if (state.balance) params.set("balance", state.balance)
  for (const [name, value] of Object.entries(extra)) if (value !== undefined && value !== "") params.set(name, String(value))
  return params.toString()
}

type UrlValue = string | number | boolean | string[] | null | undefined

/** URL query state (demo hashHistory.push): pushState keeps useSearchParams in sync. */
export function useUrlState() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const update = useCallback(
    (changes: Record<string, UrlValue>) => {
      const params = new URLSearchParams(window.location.search)
      for (const [name, value] of Object.entries(changes)) {
        params.delete(name)
        if (Array.isArray(value)) value.filter(Boolean).forEach((item) => params.append(name, item))
        else if (value !== null && value !== undefined && value !== "" && value !== false) params.set(name, String(value))
      }
      const query = params.toString()
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [pathname],
  )
  return { searchParams, update }
}

// --- filter options (GET /api/stock/options) -----------------------------------------

export type StockOptions = {
  warehouses: Array<{ name: string; branch: string }>
  types: string[]
  subcategories: string[]
  brands: string[]
  organizations: string[]
  branches: string[]
  priceLists: string[]
}

const EMPTY_OPTIONS: StockOptions = { warehouses: [], types: [], subcategories: [], brands: [], organizations: [], branches: [], priceLists: [] }

function names(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const result = list.map((entry) => (typeof entry === "string" ? entry : typeof entry === "object" && entry ? String((entry as { name?: unknown }).name ?? "") : "")).map((name) => name.trim())
  return [...new Set(result.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
}

/** Filter lists of the stock pages; loads once `enabled` turns true. */
export function useStockOptions(enabled: boolean): { options: StockOptions; error: string } {
  const [options, setOptions] = useState<StockOptions>(EMPTY_OPTIONS)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch("/api/stock/options", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
        if (!response.ok || !body) throw new Error((body?.error as string) || `HTTP ${response.status}`)
        const warehouses = Array.isArray(body.warehouses)
          ? (body.warehouses as unknown[])
              .map((entry) => (typeof entry === "string" ? { name: entry, branch: "" } : { name: String((entry as { name?: unknown }).name ?? "").trim(), branch: String((entry as { branch?: unknown }).branch ?? "").trim() }))
              .filter((entry) => entry.name)
          : []
        setOptions({
          warehouses,
          types: names(body.types),
          subcategories: names(body.subcategories),
          brands: names(body.brands),
          organizations: names(body.organizations),
          branches: names(body.branches),
          priceLists: names(body.priceLists),
        })
        setError("")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [enabled])
  return { options, error }
}

export function withSelected(list: string[], selected: string[]) {
  return [...new Set([...selected, ...list])].map((name) => ({ value: name, label: name }))
}

// --- filter dialog ----------------------------------------------------------------------

export type MoveFilterDraft = Pick<MoveState, "warehouses" | "branches" | "divisions" | "typeParents" | "types" | "brands" | "transaction" | "balance" | "showOthers">

export function draftFromState(state: MoveState): MoveFilterDraft {
  const { warehouses, branches, divisions, typeParents, types, brands, transaction, balance, showOthers } = state
  return { warehouses, branches, divisions, typeParents, types, brands, transaction, balance, showOthers }
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

function PresenceSelect({ value, onChange }: { value: MovePresence; onChange: (next: MovePresence) => void }) {
  const { t } = useLanguage()
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as MovePresence)} className="h-10 rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]">
      <option value="">{t("Все")}</option>
      <option value="exist">{t("Есть")}</option>
      <option value="not_exist">{t("Нет")}</option>
    </select>
  )
}

export function MoveFilterDialog({
  open,
  onClose,
  state,
  options,
  optionsError,
  onApply,
}: {
  open: boolean
  onClose: () => void
  state: MoveState
  options: StockOptions
  optionsError: string
  onApply: (period: { from: string; to: string }, draft: MoveFilterDraft) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<MoveFilterDraft>(() => draftFromState(state))
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(draftFromState(state))
  }
  const set = <K extends keyof MoveFilterDraft>(key: K, value: MoveFilterDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const branchNames = [...new Set([...options.branches, ...options.warehouses.map((warehouse) => warehouse.branch).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "ru"))
  // Warehouses of the chosen branches only (demo: the branch narrows the warehouse list).
  const warehouseNames = options.warehouses.filter((warehouse) => !draft.branches.length || draft.branches.includes(warehouse.branch)).map((warehouse) => warehouse.name)
  return (
    <BalanceFilterDialog open={open} onClose={onClose} from={state.from} to={state.to} onApply={(period) => onApply(period, draft)}>
      {optionsError && <p className="text-sm text-[#e57373] md:col-span-2">{t("Не удалось загрузить списки фильтра")}: {t(optionsError)}</p>}
      <Field label="Филиалы">
        <MultiSelect value={draft.branches} options={withSelected(branchNames, draft.branches)} onChange={(next) => set("branches", next)} />
      </Field>
      <Field label="Организация">
        <MultiSelect value={draft.divisions} options={withSelected(options.organizations, draft.divisions)} onChange={(next) => set("divisions", next)} />
      </Field>
      <Field label="Склад">
        <MultiSelect value={draft.warehouses} options={withSelected(warehouseNames, draft.warehouses)} onChange={(next) => set("warehouses", next)} />
      </Field>
      <Field label="Тип продукта">
        <MultiSelect value={draft.typeParents} options={withSelected(options.types, draft.typeParents)} onChange={(next) => set("typeParents", next)} />
      </Field>
      <Field label="Подкатегория">
        <MultiSelect value={draft.types} options={withSelected(options.subcategories, draft.types)} onChange={(next) => set("types", next)} />
      </Field>
      <Field label="Бренд">
        <MultiSelect value={draft.brands} options={withSelected(options.brands, draft.brands)} onChange={(next) => set("brands", next)} />
      </Field>
      <Field label="Движение за период">
        <PresenceSelect value={draft.transaction} onChange={(next) => set("transaction", next)} />
      </Field>
      <Field label="Остаток за период">
        <PresenceSelect value={draft.balance} onChange={(next) => set("balance", next)} />
      </Field>
      <label className="flex items-center gap-2 text-[#17233b] md:col-span-2">
        <input type="checkbox" checked={draft.showOthers} onChange={(event) => set("showOthers", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
        {t("Показать прочие")}
      </label>
    </BalanceFilterDialog>
  )
}
