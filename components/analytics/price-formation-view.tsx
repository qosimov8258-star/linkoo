"use client"

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { amountDigits, printDigits } from "@/lib/amount-precision"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FilterCheck, FilterSelect, RI, RefAppliedFilter, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar, REF_SHADOW } from "@/components/ref/list-kit"
import { ReportMultiChipField } from "@/components/ref/report-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { SortHead } from "@/components/analytics/list-url-state"
import { FilterMulti } from "@/components/products/catalog-filter"
import { formatStatementDate, parseAnyDay } from "@/lib/finance/dates"
import { useAppCurrency } from "@/lib/app-currency-context"
import { useLanguage } from "@/lib/i18n/language-context"
import type { CatalogOptions } from "@/lib/products-types"

const PRICE_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "штрих код товара": "barcode", "штрихкод": "barcode", "штрих код": "barcode", "barcode": "barcode",
  "цена": "price", "price": "price",
}
import type { PriceListEntry, Product } from "./products-data"
import { notify } from "@/lib/notify"

const currencies = ["SUM", "USD"]
const BASE = "/analytics/price-formation"

/** A stored day (YYYY-MM-DD, legacy "19 октября 2026") in the page language. */
function formatDay(value: string, language: string) {
  const day = parseAnyDay(value)
  return day ? formatStatementDate(day, language, false).replace(/\s*г\.$/, "") : value
}

/** Linko's numberFormat: three decimals, or those of Настройки → Округление сумм when set. */
function formatNumber(value: number) {
  return printDigits(value, amountDigits(3))
}

function formatMoney(value: number, currency = "SUM") {
  return `${formatNumber(value)} ${currency}`
}

/** Accepted supplies of the product in the base currency (GET /api/products/[id]/cost). */
type SupplyHistoryLine = { incomingId: number; date: string; acceptedAt: string; qty: number; unitCost: number; averageCost: number }
type SupplyLine = { incomingId: number; date: string; qty: number; onStock: number; unitCost: number; averageCost: number | null; accepted: boolean }
/** currentCost = the one cost of goods (lib/stock/costs.ts), base currency. */
type CostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[]; lines?: SupplyLine[]; baseCurrency?: string }
/** GET /api/supplier-incomings/product-costs. */
type ProductCosts = { baseCurrency: string; costs: Record<string, number>; unset?: number[] }
/** A supply of the «Поставка» filter (GET /api/supplier-incomings). */
type SupplyOption = { id: number; supplier: string; contractNumber: string }

const PRICE_ICON = "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"
const EDIT_ICON = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

/** "1,202 SUM": the stored value is shown as is, a missing barcode with a capital letter like the reference. */
function notSet(value: string) {
  return value.trim().toLowerCase() === "не установлен" ? "Не установлен" : value
}

/** Every price list with this product's price in it (0 when not set). */
function withAllPriceLists(entries: PriceListEntry[], names: string[]): PriceListEntry[] {
  const merged = names.map((name) => entries.find((entry) => entry.name === name) ?? { name, cash: 0, nonCash: 0, min: 0, max: 0 })
  return names.length ? merged : entries
}

// ---------------------------------------------------------------------------
// List state in the URL (Linko #/price?…: the filter, search, ordering, page and pageSize; the opened product is
// a path segment, #/price/967 → /analytics/price-formation/967)
// ---------------------------------------------------------------------------

/** Linko's PriceFilterForm: Тип продукта → Подкатегория, Мера, Поставка, Организация, Бренд, Можно продавать,
 * Товары без себестоимости. Values are the directory names (the products page's catalog filter keeps them so too). */
type Filters = {
  typeParent: string
  typeChild: string
  measurement: string[]
  supply: string
  division: string[]
  brand: string[]
  canSell: "" | "true" | "false"
  withoutNetCost: boolean
}
const EMPTY_FILTERS: Filters = { typeParent: "", typeChild: "", measurement: [], supply: "", division: [], brand: [], canSell: "", withoutNetCost: false }

type ListState = { search: string; ordering: string; page: number; pageSize: number; filters: Filters; filterOpen: boolean }
const EMPTY_STATE: ListState = { search: "", ordering: "", page: 1, pageSize: 25, filters: EMPTY_FILTERS, filterOpen: false }

/** Linko's sortable columns (stock/products_net_costs ordering). */
const ORDERINGS = ["name", "barcode", "netCost", "minimum_price", "maximum_price", "priceUpdated"] as const

function positiveInt(value: string | null, fallback: number) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function readState(): ListState {
  const params = new URLSearchParams(window.location.search)
  const list = (name: string) => (params.get(name) ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  const ordering = params.get("ordering") ?? ""
  const canSell = params.get("canSell")
  return {
    search: params.get("search") ?? "",
    ordering: (ORDERINGS as readonly string[]).includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
    filterOpen: params.get("openFilterDialog") === "true",
    filters: {
      typeParent: params.get("typeParent") ?? "",
      typeChild: params.get("typeParent") ? (params.get("typeChild") ?? "") : "",
      measurement: list("measurement"),
      supply: params.get("supply") ?? "",
      division: list("division"),
      brand: list("brand"),
      canSell: canSell === "true" || canSell === "false" ? canSell : "",
      withoutNetCost: params.get("withoutNetCost") === "true",
    },
  }
}

function stateQuery(state: ListState): string {
  const params = new URLSearchParams()
  const f = state.filters
  if (f.brand.length) params.set("brand", f.brand.join(","))
  if (f.canSell) params.set("canSell", f.canSell)
  if (f.division.length) params.set("division", f.division.join(","))
  if (f.measurement.length) params.set("measurement", f.measurement.join(","))
  if (state.filterOpen) params.set("openFilterDialog", "true")
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.page > 1) params.set("page", String(state.page))
  params.set("pageSize", String(state.pageSize))
  if (state.search) params.set("search", state.search)
  if (f.supply) params.set("supply", f.supply)
  if (f.typeChild) params.set("typeChild", f.typeChild)
  if (f.typeParent) params.set("typeParent", f.typeParent)
  if (f.withoutNetCost) params.set("withoutNetCost", "true")
  return params.toString()
}

/** Linko's «Фильтр: N элемента»: every filter key that is set. */
function filterCount(f: Filters) {
  return [f.typeParent, f.typeChild, f.measurement.length, f.supply, f.division.length, f.brand.length, f.canSell, f.withoutNetCost].filter(Boolean).length
}

/** A day of the list's «Дата обновления» as a sortable stamp (null = «Не установлена»). */
function dayStamp(value: string): number | null {
  const day = parseAnyDay(value)
  return day ? Date.parse(day) : null
}

/** Linko's ordering: ascending puts the values without one last, descending first (Postgres NULLS LAST / FIRST);
 * equal values keep the list's own order (newest product first). */
function compareNullable(a: number | string | null, b: number | string | null, desc: boolean): number {
  if (a === null && b === null) return 0
  if (a === null) return desc ? -1 : 1
  if (b === null) return desc ? 1 : -1
  const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ru")
  return desc ? -result : result
}

type AddStage = "pick" | "currency" | "amount" | null

export function PriceFormationView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  // Настройки → Валюта приложения: prices are entered only in the app currency.
  const appCurrency = useAppCurrency()
  const [rows, setRows] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [state, setState] = useState<ListState>(EMPTY_STATE)
  const [ready, setReady] = useState(false)
  const [searchDraft, setSearchDraft] = useState("")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [defaultCostOpen, setDefaultCostOpen] = useState(false)
  const [defaultCostDraft, setDefaultCostDraft] = useState("")
  const [excelOpen, setExcelOpen] = useState(false)
  const [excelList, setExcelList] = useState("")
  const [options, setOptions] = useState<CatalogOptions | null>(null)
  const [supplies, setSupplies] = useState<SupplyOption[]>([])
  /** Products of the «Поставка» chosen in the filter (null while loading / not filtered). */
  const [supplyIds, setSupplyIds] = useState<Set<number> | null>(null)

  const [addStage, setAddStage] = useState<AddStage>(null)
  const [pickTypeFilter, setPickTypeFilter] = useState("all")
  const [pickBrandFilter, setPickBrandFilter] = useState("all")
  const [pickQuery, setPickQuery] = useState("")
  const [pickPage, setPickPage] = useState(1)
  const [priceListNames, setPriceListNames] = useState<string[]>([])
  /** Price lists by id, for «Скачать» (Linko's export puts them in id order). */
  const [priceListsById, setPriceListsById] = useState<Array<{ id: number; name: string }>>([])
  const [selectedPriceLists, setSelectedPriceLists] = useState<string[]>([])
  const [priceInputs, setPriceInputs] = useState<Record<string, { cash: string; nonCash: string }>>({})
  const [costInfo, setCostInfo] = useState<CostInfo | null>(null)
  const [baseCurrency, setBaseCurrency] = useState(currencies[0])
  /** Products whose cost was never set (no receipt, no entry, no default): «Не установлена», like the reference. */
  const [unsetCosts, setUnsetCosts] = useState<Set<number>>(new Set())
  const [selectedCurrency, setSelectedCurrency] = useState("")
  const [importMode, setImportMode] = useState<"manual" | "excel">("manual")
  const [separateTransferPrice, setSeparateTransferPrice] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()

  // The URL is read once mounted and again on Back / Forward.
  useEffect(() => {
    const sync = () => {
      const next = readState()
      setState(next)
      setSearchDraft(next.search)
    }
    sync()
    setReady(true)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  const query = stateQuery(state)
  useEffect(() => {
    if (!ready || embedded) return
    const path = window.location.pathname.match(/\/price-formation\/\d+/) ? window.location.pathname : BASE
    if (window.location.search.slice(1) !== query) window.history.replaceState(window.history.state, "", `${path}?${query}`)
  }, [query, ready, embedded])

  const update = useCallback((patch: Partial<ListState>) => setState((current) => ({ ...current, ...patch })), [])

  useEffect(() => {
    const value = searchDraft.trim()
    if (!ready || value === state.search) return
    const timer = window.setTimeout(() => update({ search: value, page: 1 }), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, ready, update])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch("/api/products").then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить продукты")
        return (await response.json()) as Product[]
      }),
      // "Себестоимость" = the one cost of goods (base currency, today); products.cost is only its cache.
      fetch("/api/supplier-incomings/product-costs")
        .then((response) => (response.ok ? (response.json() as Promise<ProductCosts>) : null))
        .catch(() => null),
    ])
      .then(([data, live]) => {
        if (cancelled) return
        if (live?.baseCurrency) setBaseCurrency(live.baseCurrency)
        setUnsetCosts(new Set(live?.unset ?? []))
        // Linko's list (stock/products_net_costs) holds every live product, inventory items included, newest first.
        setRows(
          data
            .filter((product) => !product.deleted)
            .map((product) => ({ ...product, cost: live?.costs?.[String(product.id)] ?? product.cost }))
            .sort((a, b) => b.id - a.id),
        )
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить продукты с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The one cost of goods (lib/stock/costs.ts), as the product list loaded above carries it.
  const costOf = (row: Product) => (unsetCosts.has(row.id) ? 0 : row.cost || 0)

  useEffect(() => {
    let cancelled = false
    fetch("/api/price-lists")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: { id: number; name: string }[]) => {
        if (cancelled) return
        setPriceListNames(data.map((item) => item.name))
        setPriceListsById([...data].sort((a, b) => a.id - b.id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // The filter's directories: product types with their subcategories, units, brands, organizations.
  useEffect(() => {
    if (!state.filterOpen || options) return
    let cancelled = false
    fetch("/api/products/options")
      .then((response) => (response.ok ? (response.json() as Promise<CatalogOptions>) : null))
      .then((data) => {
        if (!cancelled && data) setOptions(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state.filterOpen, options])

  // «Поставка»: every supply, newest first (Linko's stock/supply/).
  useEffect(() => {
    if ((!state.filterOpen && !state.filters.supply) || supplies.length) return
    let cancelled = false
    fetch("/api/supplier-incomings")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ id: number; supplier?: string; contractNumber?: string }>) => {
        if (cancelled || !Array.isArray(data)) return
        setSupplies(data.map((item) => ({ id: Number(item.id), supplier: item.supplier ?? "", contractNumber: item.contractNumber ?? "" })).sort((a, b) => b.id - a.id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [state.filterOpen, state.filters.supply, supplies.length])

  // The products of the chosen supply (the catalog list filtered by it).
  useEffect(() => {
    const supply = state.filters.supply
    setSupplyIds(null)
    if (!supply) return
    let cancelled = false
    fetch(`/api/products?view=list&supply=${encodeURIComponent(supply)}&pageSize=0`)
      .then((response) => (response.ok ? response.json() : { results: [] }))
      .then((data: { results?: Array<{ id: number }> }) => {
        if (!cancelled) setSupplyIds(new Set((data.results ?? []).map((item) => Number(item.id))))
      })
      .catch(() => {
        if (!cancelled) setSupplyIds(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [state.filters.supply])

  useEffect(() => {
    if (expandedId === null) return
    let cancelled = false
    setCostInfo(null)
    fetch(`/api/products/${expandedId}/cost`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CostInfo | null) => {
        if (!cancelled) setCostInfo(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedId])

  const productTypes = useMemo(() => Array.from(new Set(rows.map((row) => row.type))).filter(Boolean), [rows])
  const brands = useMemo(() => Array.from(new Set(rows.map((row) => row.brand))).filter(Boolean), [rows])
  const typeTree = useMemo(() => options?.types ?? [], [options])

  const filtered = useMemo(() => {
    const f = state.filters
    const needle = state.search.trim().toLowerCase()
    const children = f.typeParent ? (typeTree.find((type) => type.name === f.typeParent)?.children ?? []) : []
    return rows.filter((row) => {
      if (needle && !row.name.toLowerCase().includes(needle) && !row.barcode.toLowerCase().includes(needle)) return false
      if (f.typeChild ? row.type !== f.typeChild : f.typeParent && row.type !== f.typeParent && !children.includes(row.type)) return false
      if (f.measurement.length && !f.measurement.includes(row.unit)) return false
      if (f.supply && !supplyIds?.has(row.id)) return false
      if (f.division.length && !f.division.includes(row.organization)) return false
      if (f.brand.length && !f.brand.includes(row.brand)) return false
      if (f.canSell && String(Boolean(row.canSell)) !== f.canSell) return false
      // Linko's without_net_cost: the products it never valued (net cost null), not those valued at 0.
      if (f.withoutNetCost && !unsetCosts.has(row.id)) return false
      return true
    })
  }, [rows, state.filters, state.search, typeTree, supplyIds, unsetCosts])

  const sorted = useMemo(() => {
    if (!state.ordering) return filtered
    const desc = state.ordering.startsWith("-")
    const field = state.ordering.replace(/^-/, "")
    const value = (row: Product): number | string | null => {
      if (field === "name") return row.name
      if (field === "barcode") return notSet(row.barcode) === "Не установлен" ? null : row.barcode
      if (field === "netCost") return unsetCosts.has(row.id) ? null : row.cost || 0
      if (field === "minimum_price") return row.priceMin
      if (field === "maximum_price") return row.priceMax
      return dayStamp(row.priceUpdatedDate)
    }
    return [...filtered].sort((a, b) => compareNullable(value(a), value(b), desc) || b.id - a.id)
  }, [filtered, state.ordering, unsetCosts])

  const pageCount = Math.max(1, Math.ceil(sorted.length / state.pageSize))
  const page = Math.min(state.page, pageCount)
  const start = (page - 1) * state.pageSize
  const visible = sorted.slice(start, start + state.pageSize)
  // Like Linko, the product opens in place of its row when that row is on the shown page.
  const expanded = visible.find((row) => row.id === expandedId) ?? null

  const pickResults = useMemo(() => {
    return rows.filter((row) => {
      if (pickQuery && !row.name.toLowerCase().includes(pickQuery.toLowerCase())) return false
      if (pickTypeFilter !== "all" && row.type !== pickTypeFilter) return false
      if (pickBrandFilter !== "all" && row.brand !== pickBrandFilter) return false
      return true
    })
  }, [rows, pickQuery, pickTypeFilter, pickBrandFilter])

  function toggleExpand(row: Product) {
    const next = expandedId === row.id ? null : row.id
    setExpandedId(next)
    if (!embedded) window.history.pushState(null, "", `${next === null ? BASE : `${BASE}/${next}`}?${query}`)
  }

  // ?openSetPrice=true opens the "Установить цену в прайс-лист" flow (deep link like the reference).
  useEffect(() => {
    if (!embedded && new URLSearchParams(window.location.search).get("openSetPrice") === "true") setAddStage("currency")
  }, [embedded])

  // /analytics/price-formation/<id> opens the product (back / forward and direct links included).
  useEffect(() => {
    if (embedded) return
    const match = pathname.match(/\/price-formation\/(\d+)/)
    setExpandedId(match ? Number(match[1]) : null)
  }, [pathname, embedded])

  useEffect(() => {
    const onPop = () => {
      const match = window.location.pathname.match(/\/price-formation\/(\d+)/)
      setExpandedId(match ? Number(match[1]) : null)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  /** PUT only the price lists: the catalog keeps every omitted field, and the server
   * computes priceMin / priceMax (base currency) and priceUpdatedDate. */
  async function patchProduct(id: number, patch: Pick<Product, "priceLists">): Promise<Product | null> {
    if (!rows.some((row) => row.id === id)) return null
    try {
      const response = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceLists: patch.priceLists }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error || t("Не удалось сохранить товар"))
        return null
      }
      const saved = (await response.json()) as Product
      // The list keeps the cost of goods; the saved product carries only its cached copy.
      setRows((curr) => curr.map((row) => (row.id === id ? { ...saved, cost: row.cost } : row)))
      return saved
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
      return null
    }
  }

  function openDefaultCost() {
    if (!expanded) return
    setDefaultCostDraft(String(costInfo?.initialCost ?? expanded.cost))
    setDefaultCostOpen(true)
  }

  /** Linko's «Добавить себестоимость» (Сумма): the initial cost only; the current net cost follows from it and the
   * accepted supplies. */
  async function saveDefaultCost(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    try {
      const response = await fetch(`/api/products/${expanded.id}/cost`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialCost: Number(defaultCostDraft.replace(/\s/g, "").replace(",", ".")) || 0 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось сохранить товар"))
        return
      }
      const info = data as CostInfo
      setCostInfo(info)
      setRows((current) => current.map((row) => (row.id === expanded.id ? { ...row, cost: info.currentCost } : row)))
      setUnsetCosts((current) => {
        if (!current.has(expanded.id)) return current
        const next = new Set(current)
        next.delete(expanded.id)
        return next
      })
      setDefaultCostOpen(false)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadPriceImportTemplate() {
    downloadExcelTable("shablon-import-cen", [[t("Штрих-код товара"), t("Цена")]])
  }

  /** The list's own Excel (toolbar icon): the shown page, Linko's GridList columns. */
  function downloadList() {
    downloadExcelTable(t("Формирование цен"), [
      [t("Название"), t("Штрих - код товара"), t("Себестоимость"), t("Цена(мин)"), t("Цена(макс)"), t("Дата обновления")],
      ...visible.map((row) => [
        row.name,
        t(notSet(row.barcode)),
        unsetCosts.has(row.id) ? "0" : formatNumber(costOf(row)),
        formatNumber(row.priceMin),
        formatNumber(row.priceMax),
        dayStamp(row.priceUpdatedDate) === null ? "" : formatDay(row.priceUpdatedDate, language),
      ]),
    ])
  }

  /** Linko's «Скачать» (sales/product_price_list/export/): every product of the filter, each price list (in id order)
   * as Наличка | Валюта | Перечислением | Валюта under its merged name. */
  function exportPrices(lists: Array<{ id: number; name: string }>, fileName: string) {
    const head = ["№", t("Название продукта"), t("Брэнд"), t("Тип Продукта"), ...lists.flatMap((list) => [list.name, "", "", ""])]
    const sub = ["", "", "", "", ...lists.flatMap(() => [t("Наличка"), t("Валюта"), t("Перечислением"), t("Валюта")])]
    const body = sorted.map((row) => [
      row.id,
      row.name,
      row.brand === "No brand" ? "" : row.brand,
      row.type,
      ...lists.flatMap((list) => {
        const entry = row.priceLists.find((item) => item.name === list.name)
        return entry ? [entry.cash, entry.currency ?? baseCurrency, entry.nonCash, entry.nonCashCurrency ?? entry.currency ?? baseCurrency] : [null, null, null, null]
      }),
    ])
    const column = (index: number) => {
      let name = ""
      for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
      return name
    }
    const merges = ["A1:A2", "B1:B2", "C1:C2", "D1:D2", ...lists.map((_, index) => `${column(4 + index * 4)}1:${column(7 + index * 4)}1`)]
    downloadExcelTable(fileName, [head, sub, ...body], { merges, widths: [null, 50, ...Array(2 + lists.length * 4).fill(15)].map((width) => width ?? 10), blankNulls: true })
  }

  function downloadAll() {
    exportPrices(priceListsById, t("Формирование цен"))
  }

  function downloadOneList(event: FormEvent) {
    event.preventDefault()
    const list = priceListsById.find((item) => item.name === excelList)
    if (!list) return
    exportPrices([list], `${t("Формирование цен")} — ${list.name}`)
    setExcelOpen(false)
  }

  function openAddPrice() {
    setPickTypeFilter("all")
    setPickBrandFilter("all")
    setPickQuery("")
    setSelectedPriceLists([])
    setSelectedCurrency("")
    setImportMode("manual")
    setSeparateTransferPrice(false)
    setPriceInputs({})
    setPickPage(1)
    setAddStage("currency")
  }

  function goToPick(event: FormEvent) {
    event.preventDefault()
    if (!selectedPriceLists.length || !selectedCurrency) return
    if (importMode === "excel") {
      importInputRef.current?.click()
      return
    }
    setAddStage("pick")
  }

  /** Writes one price (cash / non-cash) into every chosen price list of the product. */
  function withPrices(target: Product, cash: number, nonCash: number): PriceListEntry[] {
    const entry = { cash, nonCash, currency: selectedCurrency, nonCashCurrency: selectedCurrency }
    return selectedPriceLists.reduce<PriceListEntry[]>(
      (list, name) => (list.some((item) => item.name === name) ? list.map((item) => (item.name === name ? { ...item, ...entry } : item)) : [...list, { name, min: 0, max: 0, ...entry }]),
      target.priceLists,
    )
  }

  function importPricesFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void (async () => {
      const lines = await readExcelRows(file)
      if (!lines.length) return
      const fieldByIndex = mapHeaderColumns(lines[0], PRICE_IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("barcode")
      const dataRows = hasHeader ? lines.slice(1) : lines
      let barcodeIndex = 0
      let priceIndex = 1
      if (hasHeader) {
        for (const [index, field] of fieldByIndex) {
          if (field === "barcode") barcodeIndex = index
          if (field === "price") priceIndex = index
        }
      }
      for (const row of dataRows) {
        const barcode = row[barcodeIndex]
        const price = Number(row[priceIndex])
        if (!barcode || !price) continue
        const target = rows.find((item) => item.barcode === barcode)
        if (!target || !selectedPriceLists.length) continue
        const updatedPrices = withPrices(target, price, price)
        await patchProduct(target.id, { priceLists: updatedPrices })
      }
      event.target.value = ""
      setAddStage(null)
    })()
  }

  async function saveNewPrices() {
    const touched = new Set(Object.keys(priceInputs).map((key) => Number(key.split(":")[0])))
    for (const id of touched) {
      const target = rows.find((row) => row.id === id)
      if (!target) continue
      let updatedPrices = target.priceLists
      let changed = false
      for (const name of selectedPriceLists) {
        const input = priceInputs[`${id}:${name}`]
        const cash = Number(input?.cash.replace(",", ".")) || 0
        if (!cash) continue
        const nonCash = separateTransferPrice ? Number(input?.nonCash.replace(",", ".")) || 0 : cash
        const entry = { cash, nonCash, currency: selectedCurrency, nonCashCurrency: selectedCurrency }
        updatedPrices = updatedPrices.some((item) => item.name === name) ? updatedPrices.map((item) => (item.name === name ? { ...item, ...entry } : item)) : [...updatedPrices, { name, min: 0, max: 0, ...entry }]
        changed = true
      }
      if (changed) await patchProduct(target.id, { priceLists: updatedPrices })
    }
    setAddStage(null)
  }

  const money = (value: number, currency?: string) => (currency ? formatMoney(value, currency) : value ? formatMoney(value) : "0")

  const supplyLines: SupplyLine[] = costInfo?.lines ?? (costInfo?.history ?? []).map((line) => ({ incomingId: line.incomingId, date: line.date, qty: line.qty, onStock: 0, unitCost: line.unitCost, averageCost: line.averageCost, accepted: true }))

  const count = filterCount(state.filters)
  const applyFilters = (filters: Filters) => update({ filters, filterOpen: false, page: 1 })
  const filterPanel = (
    <PriceFilterPanel
      filters={state.filters}
      types={typeTree.length ? typeTree : productTypes.map((name) => ({ name, children: [] }))}
      units={options?.units ?? Array.from(new Set(rows.map((row) => row.unit))).filter(Boolean)}
      organizations={options?.filterValues?.organizations ?? options?.organizations ?? []}
      brands={options?.filterValues?.brands ?? options?.brands ?? brands}
      supplies={supplies}
      onClose={() => update({ filterOpen: false })}
      onApply={applyFilters}
    />
  )

  const onSort = (field: string) => update({ ordering: state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field, page: 1 })
  const ordering = state.ordering ? [state.ordering] : []
  const heads: ReactNode[] = [
    <SortHead key="name" label={t("Название")} field="name" ordering={ordering} onSort={onSort} />,
    <SortHead key="barcode" label={t("Штрих - код товара")} field="barcode" ordering={ordering} onSort={onSort} />,
    <SortHead key="netCost" label={t("Себестоимость")} field="netCost" ordering={ordering} onSort={onSort} />,
    <div key="min" className="flex justify-end"><SortHead right label={t("Цена(мин)")} field="minimum_price" ordering={ordering} onSort={onSort} /></div>,
    <div key="max" className="text-center"><SortHead label={t("Цена(макс)")} field="maximum_price" ordering={ordering} onSort={onSort} /></div>,
    <SortHead key="date" label={<span className="block max-w-[80px] text-left leading-[18px]">{t("Дата обновления")}</span>} field="priceUpdated" ordering={ordering} onSort={onSort} />,
  ]
  // Linko's GridList: Название xs4 (no left padding), Штрих-код xs2, Себестоимость xs1, Цена(мин) xs2 (right),
  // Цена(макс) xs2 (centre), Дата обновления xs1 (lib/ref-columns.ts keeps the widths of this route).
  const COLS = "minmax(0,502fr) minmax(0,247fr) minmax(0,124fr) minmax(0,247fr) minmax(0,247fr) minmax(0,124fr)"

  const detail = expanded ? (
    <section className={`relative z-[1] -mx-[15px] my-5 bg-white text-[13px] text-[#333] ${REF_SHADOW}`}>
      <div className="relative flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[16px]">
        <button type="button" onClick={() => toggleExpand(expanded)} aria-label={t("Закрыть")} className="absolute inset-0 cursor-pointer" />
        <h2 className="relative text-[18px] font-semibold leading-[25px] text-[#333]">{expanded.name}</h2>
        <RefTip text={t("Закрыть")} side="bottom">
          <button type="button" onClick={() => toggleExpand(expanded)} aria-label={t("Закрыть")} className="relative z-[2] flex h-5 w-5 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={RI.close} /></svg>
          </button>
        </RefTip>
      </div>
      <div className="grid min-h-[200px] grid-cols-2">
        <div className="relative border-r border-[#efefef] px-[30px] pt-[20px]">
          {costInfo && (supplyLines.length > 0 || costInfo.initialCost > 0) && <p className="mb-[25px] flex h-[25px] items-center text-[14px] font-semibold">{t("Поставки")}</p>}
          {costInfo && costInfo.initialCost > 0 && (
            <div className="-mx-[30px] -mt-[10px] mb-[10px] flex h-[55px] items-center justify-between bg-[#f2f5f8] px-[30px] font-semibold">
              <span>{t("Себестоимость по умолчанию")}:</span>
              <span className="flex items-center">
                {formatMoney(costInfo.initialCost, baseCurrency)}
                <RefTip text={t("Изменить")} side="bottom">
                  <button type="button" onClick={openDefaultCost} aria-label={t("Изменить")} className="flex h-10 w-10 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={EDIT_ICON} /></svg>
                  </button>
                </RefTip>
              </span>
            </div>
          )}
          {costInfo && !supplyLines.length && (
            <div className="pb-6 text-center text-[13px] text-[#666]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="mx-auto mt-[10px] w-[155px]" />
              <p className="mt-3">
                {t("Поставок не найдено")},{" "}
                <a href="/analytics/supplier-incomings?openCreateDialog=true" target="_blank" rel="noreferrer" className="text-[#129fdd]">
                  {costInfo.initialCost > 0 ? t("добавить поставку") : t("добавьте поставку")}
                </a>
                {costInfo.initialCost > 0 ? null : (
                  <>
                    <br />
                    {t("или")}{" "}
                    <button type="button" onClick={openDefaultCost} className="text-[#129fdd]">{t("добавьте себестоимость")}</button> {t("по умолчанию")}
                  </>
                )}
              </p>
            </div>
          )}
          {supplyLines.length > 0 && (
            <div className="text-[13px]">
              <div className="grid h-[40px] grid-cols-[1fr_3fr_2fr_2fr_2fr_2fr] items-center font-semibold">
                {/* Linko's Col padding: none on the first and last cells, 8 px on the ones between. */}
                <span>№</span><span className="pl-2">{t("Дата")}</span><span className="pl-2">{t("Кол-во")}</span><span className="pl-2">{t("На складе")}</span><span className="pl-2">{t("Себест.")}</span><span className="text-right">{t("Усред. Себ.")}</span>
              </div>
              {supplyLines.map((line) => (
                <div key={line.incomingId} className={`relative grid h-[40px] grid-cols-[1fr_3fr_2fr_2fr_2fr_2fr] items-center ${DOTTED}`}>
                  <a href={`/analytics/supplier-incomings/${line.incomingId}`} className="text-[#129fdd]">{line.incomingId}</a>
                  <span className="pl-2">{line.date ? formatDay(line.date, language) : ""}</span>
                  <span className="pl-2">{formatNumber(line.qty)}</span>
                  <span className="pl-2">{formatNumber(line.onStock)}</span>
                  <span className="pl-2">{formatMoney(line.unitCost, baseCurrency)}</span>
                  <span className="text-right">{line.averageCost === null || !(line.averageCost > 0) ? t("Не принято") : formatMoney(line.averageCost, baseCurrency)}</span>
                </div>
              ))}
              <div className="my-5 flex items-center justify-end font-semibold">
                <span>{t("Текущая себестоимость")}:</span>
                <span className="pl-5">{formatMoney(costInfo?.currentCost ?? expanded.cost, baseCurrency)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="relative px-[30px] pt-[20px]">
          <div className="mb-[25px] flex h-[25px] items-center justify-between text-[14px] font-semibold">
            <p>
              {t("Цены на товар")}{" "}
              <span className="text-[12px] text-[#a5a1a0]">({expanded.priceLists.some((entry) => entry.cash || entry.nonCash) ? t("Установлены") : t("Не установлены")})</span>
            </p>
            {/* Linko's pencil opens the product's edit dialog in a new tab (#/product/<id>/?openUpdateDialog=true). */}
            <RefTip text={t("Изменить")} side="bottom">
              <a href={`/analytics/products/${expanded.id}?openUpdateDialog=true&pageSize=25`} target="_blank" rel="noreferrer" aria-label={t("Изменить")} className="flex h-6 w-6 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={EDIT_ICON} /></svg>
              </a>
            </RefTip>
          </div>
          <div className="text-[13px]">
            <div className="relative grid h-[40px] grid-cols-[6fr_3fr_3fr] items-center font-semibold">
              <span>{t("Тип обьекта")}</span><span className="pr-2 text-right">{t("Нал")}</span><span className="text-right">{t("Безнал")}</span>
            </div>
            {withAllPriceLists(expanded.priceLists, priceListNames).map((entry) => (
              <div key={entry.name} className={`relative grid h-[40px] grid-cols-[6fr_3fr_3fr] items-center ${DOTTED}`}>
                <span className="truncate pr-3">{entry.name}</span>
                <span className="pr-2 text-right">{money(entry.cash, entry.currency)}</span>
                <span className="text-right">{money(entry.nonCash, entry.nonCashCurrency ?? entry.currency)}</span>
              </div>
            ))}
            {!priceListNames.length && !expanded.priceLists.length && <div className="py-6 text-center text-[#999]">{t("Нет прайс-листов — создайте их в разделе «Прайс-листы»")}</div>}
          </div>
        </div>
      </div>
    </section>
  ) : null

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Формирование цен")}>
          <RefButton exact icon={RI.chart} label={t("Скачать вид 2")} onClick={() => setExcelOpen(true)} />
          <RefButton exact icon={RI.chart} label={t("Скачать")} onClick={downloadAll} />
          <RefButton exact green icon={PRICE_ICON} label={t("Добавить цену")} onClick={openAddPrice} />
        </RefHeader>
      )}
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          // Linko's toolbar of this page: the search from x = 430 (300 px), the applied filter bar 30 px out to the left.
          filterWidth={379}
          searchWidth={300}
          filterOpen={state.filterOpen}
          onToggleFilter={() => update({ filterOpen: !state.filterOpen })}
          filterPanel={filterPanel}
          leftSlot={count > 0 ? <RefAppliedFilter count={count} width={371.5} shift={30} onEdit={() => update({ filterOpen: true })} onClear={() => update({ filters: EMPTY_FILTERS, filterOpen: false, page: 1 })} /> : undefined}
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(pageSize) => update({ pageSize, page: 1 })}
          from={sorted.length ? start + 1 : 0}
          to={Math.min(start + state.pageSize, sorted.length)}
          total={sorted.length}
          page={page}
          pageCount={pageCount}
          onPage={(next) => update({ page: next })}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadList} color="#333" />}
          extra={embedded ? <RefButton green icon={PRICE_ICON} label={t("Добавить цену")} onClick={openAddPrice} /> : undefined}
        />
        <RefTable
          cols={COLS}
          heads={heads}
          rows={visible}
          rowKey={(row) => row.id}
          onRowClick={toggleExpand}
          rowClass={(row) => (row.id === expanded?.id ? "!hidden" : "")}
          expanded={(row) => (row.id === expanded?.id ? detail : null)}
          empty={loading ? t("Загрузка продуктов...") : loadError || t("По вашему запросу ничего не найдено")}
          render={(row) => [
            <span key="name" className="[word-break:break-all]">{row.name}</span>,
            t(notSet(row.barcode)),
            // Linko: numberFormat(netCost, PRIMARY_CURRENCY), «Не установлена» for a product it never valued.
            unsetCosts.has(row.id) ? t("Не установлена") : formatMoney(costOf(row), baseCurrency),
            <div key="min" className="text-right">{formatMoney(row.priceMin, baseCurrency)}</div>,
            <div key="max" className="text-center">{formatMoney(row.priceMax, baseCurrency)}</div>,
            dayStamp(row.priceUpdatedDate) === null ? t("Не установлена") : formatDay(row.priceUpdatedDate, language),
          ]}
        />
      </RefCard>

      {defaultCostOpen && expanded && (
        <PriceDialog title={t("Добавить себестоимость")} width={400} onClose={() => setDefaultCostOpen(false)} onSubmit={saveDefaultCost} submitLabel={t("Сохранить")}>
          <label className="relative block h-[62px]">
            <span className="absolute left-0 top-[6px] text-[10px] font-bold leading-3 text-black">{t("Сумма")}</span>
            <input autoFocus inputMode="decimal" value={defaultCostDraft} onChange={(event) => setDefaultCostDraft(event.target.value)} className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8] bg-transparent text-[13px] font-semibold outline-none focus:border-[#5d6474]" />
          </label>
        </PriceDialog>
      )}

      {excelOpen && (
        <PriceDialog title={t("Скачать Excel")} width={300} height={417} onClose={() => setExcelOpen(false)} onSubmit={downloadOneList} submitLabel={t("Сохранить")} submitDisabled={!excelList}>
          <div className="pt-[45px]">
            <FilterSelect label={t("Прайс-лист")} value={excelList} onChange={setExcelList} options={priceListNames} />
          </div>
        </PriceDialog>
      )}

      {addStage && (
        <div className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
          <div className="relative h-[56px] shrink-0 border-b border-[#efefef]">
            <span className="absolute left-[30px] top-[19px] text-[13px] font-bold uppercase leading-[18px]">{t("Установить цену в прайс-лист")}</span>
            <button type="button" aria-label={t("Закрыть")} onClick={() => setAddStage(null)} className="absolute right-[10px] top-[4px] flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
            </button>
          </div>
          <div className="flex h-[56px] shrink-0 items-center border-b border-[#efefef] px-[30px]">
            <div className="w-[240px]"><FilterSelect compact label={`${t("Фильтр по типу")} *`} value={pickTypeFilter === "all" ? "" : pickTypeFilter} onChange={(value) => setPickTypeFilter(value || "all")} options={productTypes} /></div>
            <div className="ml-[30px] w-[250px]"><FilterSelect compact label={`${t("Фильтр по бренду")} *`} value={pickBrandFilter === "all" ? "" : pickBrandFilter} onChange={(value) => setPickBrandFilter(value || "all")} options={brands} /></div>
            <input value={pickQuery} onChange={(event) => { setPickQuery(event.target.value); setPickPage(1) }} placeholder={t("Поиск товаров...")} className="ml-[217px] h-[42px] w-[280px] border border-[#ccc] bg-[#f2f2f2] px-3 text-[13px] outline-none" />
            <div className="-mr-[12px] ml-auto flex items-center text-[13px] text-[#5d6474]">
              <span className="mr-[34px] flex items-center text-[#333]">25<svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg></span>
              <span className="mr-[5px] whitespace-nowrap">{pickResults.length ? (pickPage - 1) * 25 + 1 : 0} - {Math.min(pickPage * 25, pickResults.length)} {t("из")} {pickResults.length}</span>
              <button type="button" disabled={pickPage <= 1} onClick={() => setPickPage((value) => value - 1)} aria-label="prev" className="px-[5px]">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${pickPage <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" disabled={pickPage * 25 >= pickResults.length} onClick={() => setPickPage((value) => value + 1)} aria-label="next">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${pickPage * 25 >= pickResults.length ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
              </button>
              <svg viewBox="0 0 24 24" className="ml-[5px] h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {addStage === "pick" && (
              <div className="flex min-w-max">
                <div className="sticky left-0 z-10 w-[568px] shrink-0 bg-white shadow-[2px_0_4px_rgba(0,0,0,0.12)]">
                  <div className="flex h-[51px] items-center border-b border-[#efefef] px-[30px] text-[13px] font-semibold text-[#5d6474]">{t("Товар")}</div>
                  {pickResults.slice((pickPage - 1) * 25, pickPage * 25).map((product, index) => (
                    <div key={product.id} title={product.name} className={`flex h-[50px] items-center truncate px-[30px] text-[13px] font-semibold text-[#5d6474] ${index % 2 ? "bg-[#f2f5f8]" : ""}`}>
                      <span className="truncate">{product.name}</span>
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex h-[51px] items-center border-b border-[#efefef]">
                    {selectedPriceLists.map((name) => (
                      <div key={name} className="w-[260px] shrink-0 px-[19px] text-[13px] font-semibold text-[#333]">{name}</div>
                    ))}
                  </div>
                  {pickResults.slice((pickPage - 1) * 25, pickPage * 25).map((product, index) => (
                    <div key={product.id} className={`flex h-[50px] items-center ${index % 2 ? "bg-[#f2f5f8]" : ""}`}>
                      {selectedPriceLists.map((name) => {
                        const key = `${product.id}:${name}`
                        const input = priceInputs[key]
                        return (
                          <div key={name} className="flex w-[260px] shrink-0 items-center gap-[10px] px-[19px]">
                            <input type="number" value={input?.cash ?? ""} onChange={(event) => setPriceInputs((current) => ({ ...current, [key]: { cash: event.target.value, nonCash: current[key]?.nonCash ?? "" } }))} className="h-8 w-[100px] border-b border-[#ccc] bg-transparent text-right outline-none" />
                            <span className="text-[13px] text-[#5d6474]">{selectedCurrency}</span>
                            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[#4f5bd5]"><path d={PRICE_ICON} /></svg>
                            <svg viewBox="0 0 24 24" className="-ml-1 h-[18px] w-[18px] fill-[#4f5bd5]"><path d={RI.card} /></svg>
                            {separateTransferPrice && (
                              <input type="number" value={input?.nonCash ?? ""} onChange={(event) => setPriceInputs((current) => ({ ...current, [key]: { cash: current[key]?.cash ?? "", nonCash: event.target.value } }))} className="h-8 w-[80px] border-b border-[#ccc] bg-transparent text-right outline-none" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="relative h-[56px] shrink-0 border-t border-[#efefef]">
            <button type="button" disabled={addStage !== "pick"} onClick={() => void saveNewPrices()} className="absolute right-[10px] top-[10px] h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-40">{t("Сохранить")}</button>
          </div>
        </div>
      )}

      {addStage === "currency" && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.3] font-sans text-[13px] text-[#333]">
          <form onSubmit={goToPick} className="relative h-[350px] w-[500px] bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
            <div className="h-[56px] border-b border-[#efefef] pl-[30px] pt-[20px] text-[13px] font-bold leading-4">{t("Выберите валюту")}</div>
            <div className="px-[30px]">
              <div className="relative mt-[19px] h-[62px]">
                <ReportMultiChipField label={`${t("Выберите прайс-лист")} *`} values={selectedPriceLists} options={priceListNames} onChange={setSelectedPriceLists} />
              </div>
              <FilterSelect label={`${t("Выберите валюту для наличных")} *`} value={selectedCurrency} onChange={setSelectedCurrency} options={appCurrency ? [appCurrency] : currencies} />
              <div className="-mt-[3px]">
                {(["manual", "excel"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setImportMode(mode)} className="flex h-[34px] items-center gap-4 text-left">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${importMode === mode ? "border-[#5d6474]" : "border-[#333]"}`}>{importMode === mode && <span className="h-3 w-3 rounded-full bg-[#5d6474]" />}</span>
                    {mode === "manual" ? t("Вручную") : t("Импортировать с excel")}
                  </button>
                ))}
                {importMode === "excel" && (
                  <button type="button" onClick={downloadPriceImportTemplate} className="ml-10 text-[13px] font-semibold text-[#1E4A9A] hover:underline">{t("Скачать шаблон")}</button>
                )}
                <FilterCheck compact label={t("Установить другую цену для перевода")} checked={separateTransferPrice} onChange={setSeparateTransferPrice} className="pt-[2px]" />
              </div>
            </div>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importPricesFromExcel} className="hidden" />
            <div className="absolute bottom-[7px] right-[30px] flex items-center gap-[39px]">
              <button type="button" onClick={() => setAddStage(null)} className="h-9 text-[13px] font-semibold uppercase text-[#1E4A9A]">{t("Отмена")}</button>
              <button type="submit" disabled={!selectedPriceLists.length || !selectedCurrency} className={`h-9 text-[13px] font-semibold uppercase ${selectedPriceLists.length && selectedCurrency ? "text-[#1E4A9A]" : "text-[#b0b0b0]"}`}>{t("Далее")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}

/** Linko's PriceFilterForm in its 310 px drawer. */
function PriceFilterPanel({
  filters,
  types,
  units,
  organizations,
  brands,
  supplies,
  onClose,
  onApply,
}: {
  filters: Filters
  types: Array<{ name: string; children: string[] }>
  units: string[]
  organizations: string[]
  brands: string[]
  supplies: SupplyOption[]
  onClose: () => void
  onApply: (filters: Filters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Filters>(filters)
  const set = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }))
  const children = types.find((type) => type.name === draft.typeParent)?.children ?? []
  const yes = t("Да")
  const no = t("Нет")
  return (
    <RefFilterPanel narrow applyClassName="mt-[25px]" onClose={onClose} onApply={() => onApply(draft)} className="!w-[310px]">
      <FilterSelect label={t("Тип продукта")} value={draft.typeParent} onChange={(value) => set({ typeParent: value, typeChild: "" })} options={types.map((type) => type.name)} />
      {draft.typeParent && <FilterSelect label={t("Подкатегория")} value={draft.typeChild} onChange={(value) => set({ typeChild: value })} options={children} />}
      <FilterMulti label={t("Мера")} value={draft.measurement} onChange={(measurement) => set({ measurement })} options={units} />
      <SupplyField label={t("Поставка")} value={draft.supply} onChange={(supply) => set({ supply })} supplies={supplies} />
      <FilterMulti label={t("Организация")} value={draft.division} onChange={(division) => set({ division })} options={organizations} />
      <FilterMulti label={t("Бренд")} value={draft.brand} onChange={(brand) => set({ brand })} options={brands} />
      <FilterSelect
        label={t("Можно продавать")}
        value={draft.canSell === "true" ? yes : draft.canSell === "false" ? no : ""}
        onChange={(value) => set({ canSell: value === yes ? "true" : value === no ? "false" : "" })}
        options={[yes, no]}
      />
      <FilterCheck compact label={t("Товары без себестоимости")} checked={draft.withoutNetCost} onChange={(withoutNetCost) => set({ withoutNetCost })} className="mt-[2px]" />
    </RefFilterPanel>
  )
}

/** Linko's SupplySearchField: one supply, each option «Поставка №N» / «Поставщик: …» / «Номер договора: …». */
function SupplyField({ label, value, onChange, supplies }: { label: string; value: string; onChange: (value: string) => void; supplies: SupplyOption[] }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const chosen = supplies.find((supply) => String(supply.id) === value)
  return (
    <div className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black">
        {value ? (
          <>
            <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3">{label}</span>
            <span className="absolute inset-x-0 top-[10px] truncate pr-8">{`${t("Поставка")} №${value}`}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[13px] leading-4">{label}</span>
        )}
      </button>
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[39.4px] h-[5px] w-[10px] fill-[#999]" aria-hidden><path d={open ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} /></svg>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-[54px] z-50 max-h-[205px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {chosen && (
              <button type="button" onClick={() => { onChange(""); setOpen(false) }} className="block h-9 w-full px-[10px] text-left text-[13px] text-[#999] hover:bg-[#f2f5f8]">
                {t("Сбросить")}
              </button>
            )}
            {supplies.length === 0 ? (
              <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Ничего не найдено")}</div>
            ) : (
              supplies.map((supply) => (
                <button
                  key={supply.id}
                  type="button"
                  onClick={() => {
                    onChange(String(supply.id))
                    setOpen(false)
                  }}
                  className={`block w-full px-[10px] py-[8px] text-left text-[13px] font-semibold leading-[16px] hover:bg-[#e6f2ff] ${String(supply.id) === value ? "bg-[#e6f2ff]" : ""}`}
                >
                  <span className="block">{`${t("Поставка")} №${supply.id}`}</span>
                  <span className="block">{`${t("Поставщик")}: ${supply.supplier || "-"}`}</span>
                  <span className="block">{`${t("Номер договора")}: ${supply.contractNumber || "-"}`}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Linko's small Material dialogs of this page («Скачать Excel», «Добавить себестоимость»): an upper-case title with a
 * close cross, the fields, a green «Сохранить» at the bottom right. */
function PriceDialog({ title, width, height, onClose, onSubmit, submitLabel, submitDisabled, children }: { title: string; width: number; height?: number; onClose: () => void; onSubmit: (event: FormEvent) => void; submitLabel: string; submitDisabled?: boolean; children: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.3] font-sans text-[13px] text-[#333]" onMouseDown={onClose}>
      <form onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()} className="flex flex-col bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]" style={{ width, minHeight: height }}>
        <div className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[16px]">
          <span className="text-[13px] font-bold uppercase">{title}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-8 w-8 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </div>
        <div className="flex-1 px-[30px] pb-[30px]">{children}</div>
        <div className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[10px]">
          <button type="submit" disabled={submitDisabled} className="h-9 rounded-[2px] bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white disabled:opacity-60">{submitLabel}</button>
        </div>
      </form>
    </div>
  )
}
