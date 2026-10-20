"use client"

import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  DollarSign,
  Pencil,
  Search,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { formatStatementDate, parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

const PRICE_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "штрих код товара": "barcode", "штрихкод": "barcode", "штрих код": "barcode", "barcode": "barcode",
  "цена": "price", "price": "price",
}
import type { PriceListEntry, Product } from "./products-data"

const currencies = ["SUM", "USD"]

/** A stored day (YYYY-MM-DD, legacy "19 октября 2026") in the page language. */
function formatDay(value: string, language: string) {
  const day = parseAnyDay(value)
  return day ? formatStatementDate(day, language, false).replace(/\s*г\.$/, "") : value
}

function formatMoney(value: number, currency = "SUM") {
  return `${(Math.round(value * 1000) / 1000).toLocaleString("ru-RU")} ${currency}`
}

/** Accepted supplies of the product in the base currency (GET /api/products/[id]/cost). */
type SupplyHistoryLine = { incomingId: number; date: string; acceptedAt: string; qty: number; unitCost: number; averageCost: number }
/** currentCost = the one cost of goods (lib/stock/costs.ts), base currency. */
type CostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[]; baseCurrency?: string }
/** GET /api/supplier-incomings/product-costs. */
type ProductCosts = { baseCurrency: string; costs: Record<string, number> }

/** Every price list with this product's price in it (0 when not set). */
function withAllPriceLists(entries: PriceListEntry[], names: string[]): PriceListEntry[] {
  const merged = names.map((name) => entries.find((entry) => entry.name === name) ?? { name, cash: 0, nonCash: 0, min: 0, max: 0 })
  return [...merged, ...entries.filter((entry) => !names.includes(entry.name))]
}

type AddStage = "pick" | "currency" | "amount" | null

export function PriceFormationView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [rows, setRows] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [unitFilter, setUnitFilter] = useState("all")
  const [organizationFilter, setOrganizationFilter] = useState("all")
  const [brandFilter, setBrandFilter] = useState("all")
  const [canSellFilter, setCanSellFilter] = useState("all")
  const [noCostOnly, setNoCostOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingDefaultCost, setEditingDefaultCost] = useState(false)
  const [defaultCostDraft, setDefaultCostDraft] = useState("")
  const [editingPrices, setEditingPrices] = useState(false)
  const [priceDraft, setPriceDraft] = useState<PriceListEntry[]>([])

  const [addStage, setAddStage] = useState<AddStage>(null)
  const [pickTypeFilter, setPickTypeFilter] = useState("all")
  const [pickBrandFilter, setPickBrandFilter] = useState("all")
  const [pickQuery, setPickQuery] = useState("")
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [priceListNames, setPriceListNames] = useState<string[]>([])
  const [selectedPriceList, setSelectedPriceList] = useState("")
  const [costInfo, setCostInfo] = useState<CostInfo | null>(null)
  const [baseCurrency, setBaseCurrency] = useState(currencies[0])
  const [selectedCurrency, setSelectedCurrency] = useState(currencies[0])
  const [importMode, setImportMode] = useState<"manual" | "excel">("manual")
  const [separateTransferPrice, setSeparateTransferPrice] = useState(false)
  const [cashAmount, setCashAmount] = useState("")
  const [nonCashAmount, setNonCashAmount] = useState("")
  const importInputRef = useRef<HTMLInputElement>(null)

  const pageSize = 25

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
        setRows(data.filter((product) => !product.deleted).map((product) => ({ ...product, cost: live?.costs?.[String(product.id)] ?? product.cost })))
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
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/price-lists")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: { name: string }[]) => {
        if (cancelled) return
        setPriceListNames(data.map((item) => item.name))
        setSelectedPriceList((current) => current || data[0]?.name || "")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (expandedId === null) return
    let cancelled = false
    setCostInfo(null)
    fetch(`/api/products/${expandedId}/cost`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CostInfo | null) => {
        if (cancelled) return
        setCostInfo(data)
        // Keep the list in step with the detail (both read the cost of goods).
        if (data) setRows((current) => current.map((row) => (row.id === expandedId && row.cost !== data.currentCost ? { ...row, cost: data.currentCost } : row)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedId])

  const productTypes = useMemo(() => Array.from(new Set(rows.map((row) => row.type))).filter(Boolean), [rows])
  const units = useMemo(() => Array.from(new Set(rows.map((row) => row.unit))).filter(Boolean), [rows])
  const organizations = useMemo(() => Array.from(new Set(rows.map((row) => row.organization))).filter(Boolean), [rows])
  const brands = useMemo(() => Array.from(new Set(rows.map((row) => row.brand))).filter(Boolean), [rows])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query.toLowerCase())) return false
      if (typeFilter !== "all" && row.type !== typeFilter) return false
      if (unitFilter !== "all" && row.unit !== unitFilter) return false
      if (organizationFilter !== "all" && row.organization !== organizationFilter) return false
      if (brandFilter !== "all" && row.brand !== brandFilter) return false
      if (canSellFilter !== "all" && String(row.canSell) !== canSellFilter) return false
      if (noCostOnly && row.cost !== 0) return false
      return true
    })
  }, [rows, query, typeFilter, unitFilter, organizationFilter, brandFilter, canSellFilter, noCostOnly])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const expanded = rows.find((row) => row.id === expandedId) ?? null

  const pickResults = useMemo(() => {
    return rows.filter((row) => {
      if (pickQuery && !row.name.toLowerCase().includes(pickQuery.toLowerCase())) return false
      if (pickTypeFilter !== "all" && row.type !== pickTypeFilter) return false
      if (pickBrandFilter !== "all" && row.brand !== pickBrandFilter) return false
      return true
    })
  }, [rows, pickQuery, pickTypeFilter, pickBrandFilter])

  function toggleExpand(row: Product) {
    setExpandedId((current) => (current === row.id ? null : row.id))
    setEditingDefaultCost(false)
    setEditingPrices(false)
  }

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
        window.alert(data.error || t("Не удалось сохранить товар"))
        return null
      }
      const saved = (await response.json()) as Product
      // The list keeps the cost of goods; the saved product carries only its cached copy.
      setRows((curr) => curr.map((row) => (row.id === id ? { ...saved, cost: row.cost } : row)))
      return saved
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
      return null
    }
  }

  function startEditDefaultCost() {
    if (!expanded) return
    setDefaultCostDraft(String(costInfo?.initialCost ?? expanded.cost))
    setEditingDefaultCost(true)
  }

  /** The initial cost only; the current net cost follows from it and the
   * accepted supplies. */
  async function saveDefaultCost(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    try {
      const response = await fetch(`/api/products/${expanded.id}/cost`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialCost: Number(defaultCostDraft.replace(",", ".")) || 0 }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(data.error ? t(data.error) : t("Не удалось сохранить товар"))
        return
      }
      const info = data as CostInfo
      setCostInfo(info)
      setRows((current) => current.map((row) => (row.id === expanded.id ? { ...row, cost: info.currentCost } : row)))
      setEditingDefaultCost(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function startEditPrices() {
    if (!expanded) return
    setPriceDraft(withAllPriceLists(expanded.priceLists, priceListNames).map((entry) => ({ ...entry })))
    setEditingPrices(true)
  }

  function updatePriceDraft(name: string, patch: Partial<PriceListEntry>) {
    setPriceDraft((current) => current.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry)))
  }

  async function savePrices(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    // Price lists that were never set and are still empty stay out of the product.
    const priceLists = priceDraft.filter((entry) => entry.cash || entry.nonCash || expanded.priceLists.some((existing) => existing.name === entry.name))
    await patchProduct(expanded.id, { priceLists })
    setEditingPrices(false)
  }

  function downloadPriceImportTemplate() {
    downloadExcelTable("shablon-import-cen", [[t("Штрих-код товара"), t("Цена")]])
  }

  function downloadList() {
    downloadExcelTable("formirovanie-tsen", [
      [t("Название"), t("Штрих-код товара"), t("Себестоимость"), t("Цена(мин)"), t("Цена(макс)"), t("Дата обновления")],
      ...filtered.map((row) => [row.name, row.barcode, row.cost, row.priceMin, row.priceMax, row.priceUpdatedDate]),
    ])
  }

  function downloadView2() {
    downloadExcelTable("formirovanie-tsen-vid-2", [
      [t("Название"), t("Тип"), t("Бренд"), t("Ед.изм."), t("Организация"), t("Можно продавать"), t("Себестоимость")],
      ...filtered.map((row) => [row.name, row.type, row.brand, row.unit, row.organization, row.canSell ? t("Да") : t("Нет"), row.cost]),
    ])
  }

  function openAddPrice() {
    setPickTypeFilter("all")
    setPickBrandFilter("all")
    setPickQuery("")
    setSelectedProductId(null)
    setAddStage("pick")
  }

  function pickProduct(product: Product) {
    setSelectedProductId(product.id)
    setSelectedPriceList(priceListNames[0])
    setSelectedCurrency(currencies[0])
    setImportMode("manual")
    setSeparateTransferPrice(false)
    setCashAmount("")
    setNonCashAmount("")
    setAddStage("currency")
  }

  function goToAmount(event: FormEvent) {
    event.preventDefault()
    if (importMode === "excel") {
      importInputRef.current?.click()
      return
    }
    setAddStage("amount")
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
        const priceRaw = row[priceIndex]
        const price = Number(priceRaw)
        if (!barcode || !price) continue
        const target = rows.find((row) => row.barcode === barcode)
        if (!target) continue
        if (!selectedPriceList) continue
        const entry = { cash: price, nonCash: price, currency: selectedCurrency, nonCashCurrency: selectedCurrency }
        const updatedPrices = target.priceLists.some((item) => item.name === selectedPriceList)
          ? target.priceLists.map((item) => (item.name === selectedPriceList ? { ...item, ...entry } : item))
          : [...target.priceLists, { name: selectedPriceList, min: 0, max: 0, ...entry }]
        await patchProduct(target.id, { priceLists: updatedPrices })
      }
      event.target.value = ""
      setAddStage(null)
    })()
  }

  async function saveNewPrice(event: FormEvent) {
    event.preventDefault()
    if (selectedProductId === null) return
    const target = rows.find((row) => row.id === selectedProductId)
    if (!target) return
    const cash = Number(cashAmount) || 0
    const nonCash = separateTransferPrice ? Number(nonCashAmount) || 0 : cash
    if (!selectedPriceList) return
    const entry = { cash, nonCash, currency: selectedCurrency, nonCashCurrency: selectedCurrency }
    const updatedPrices = target.priceLists.some((item) => item.name === selectedPriceList)
      ? target.priceLists.map((item) => (item.name === selectedPriceList ? { ...item, ...entry } : item))
      : [...target.priceLists, { name: selectedPriceList, min: 0, max: 0, ...entry }]
    await patchProduct(target.id, { priceLists: updatedPrices })
    setAddStage(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> {t("Формирование цен")}
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={downloadView2} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Скачать вид 2")}
            </button>
            <button type="button" onClick={downloadList} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Скачать")}
            </button>
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> {t("Добавить цену")}
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="grid gap-4 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-sm text-slate-600">
              {t("Тип продукта")}
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">{t("Все")}</option>
                {productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              {t("Мера")}
              <select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">{t("Все")}</option>
                {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              {t("Организация")}
              <select value={organizationFilter} onChange={(event) => { setOrganizationFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">{t("Все")}</option>
                {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              {t("Бренд")}
              <select value={brandFilter} onChange={(event) => { setBrandFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">{t("Все")}</option>
                {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              {t("Можно продавать")}
              <select value={canSellFilter} onChange={(event) => { setCanSellFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">{t("Все")}</option>
                <option value="true">{t("Да")}</option>
                <option value="false">{t("Нет")}</option>
              </select>
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={noCostOnly} onChange={(event) => { setNoCostOnly(event.target.checked); setPage(1) }} />
              {t("Товары без себестоимости")}
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f70e7]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
          {embedded && (
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> {t("Добавить цену")}
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">{t("Название")}</th>
              <th className="px-5 py-5">{t("Штрих - код товара")}</th>
              <th className="px-5 py-5">{t("Себестоимость")}</th>
              <th className="px-5 py-5">{t("Цена(мин)")}</th>
              <th className="px-5 py-5">{t("Цена(макс)")}</th>
              <th className="px-5 py-5">{t("Дата обновления")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">{t("Загрузка продуктов...")}</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 text-[#4f70e7]">{row.name}</td>
                  <td className="px-5 py-4">{t(row.barcode)}</td>
                  <td className="px-5 py-4">{formatMoney(row.cost, baseCurrency)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMin)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMax)}</td>
                  <td className="px-5 py-4">{t(row.priceUpdatedDate)}</td>
                </tr>

                {expandedId === row.id && expanded && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{expanded.name}</h2>
                          <button type="button" onClick={() => setExpandedId(null)} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="grid gap-8 lg:grid-cols-2">
                          <div>
                            <p className="mb-3 font-medium text-slate-800">{t("Поставки")}</p>
                            {editingDefaultCost ? (
                              <form onSubmit={saveDefaultCost} className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">{t("Себестоимость начальная")}:</span>
                                <span className="flex items-center gap-2">
                                  <input autoFocus inputMode="decimal" value={defaultCostDraft} onChange={(event) => setDefaultCostDraft(event.target.value)} className="w-28 border-b border-slate-300 text-right outline-none" />
                                  <button type="submit" className="text-sm font-semibold text-[#4f70e7]">OK</button>
                                </span>
                              </form>
                            ) : (
                              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">{t("Себестоимость начальная")}:</span>
                                <span className="flex items-center gap-2 font-medium">
                                  {formatMoney(costInfo?.initialCost ?? expanded.cost, baseCurrency)}
                                  <button type="button" onClick={startEditDefaultCost} aria-label={t("Изменить себестоимость")} className="text-slate-400 hover:text-[#4f70e7]">
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                </span>
                              </div>
                            )}
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-3">{t("№")}</th>
                                  <th className="py-2 pr-3">{t("Дата")}</th>
                                  <th className="py-2 pr-3">{t("Кол-во")}</th>
                                  <th className="py-2 pr-3">{t("Себест.")}</th>
                                  <th className="py-2 pr-3">{t("Усред. Себ.")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(costInfo?.history ?? []).map((line, index) => (
                                  <tr key={`${line.incomingId}-${index}`} className="border-t border-slate-100">
                                    <td className="py-2 pr-3">{line.incomingId}</td>
                                    <td className="py-2 pr-3">{formatDay(line.date, language)}</td>
                                    <td className="py-2 pr-3">{line.qty.toLocaleString("ru-RU")} {expanded.unit}</td>
                                    <td className="py-2 pr-3">{formatMoney(line.unitCost, baseCurrency)}</td>
                                    <td className="py-2 pr-3">{formatMoney(line.averageCost, baseCurrency)}</td>
                                  </tr>
                                ))}
                                {costInfo && !costInfo.history.length && (
                                  <tr><td colSpan={5} className="py-4 text-center text-slate-400">{t("Принятых поставок нет")}</td></tr>
                                )}
                              </tbody>
                            </table>

                            <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 font-semibold">
                              <span>{t("Текущая себестоимость")}:</span>
                              <span>{formatMoney(costInfo?.currentCost ?? expanded.cost, baseCurrency)}</span>
                            </div>
                          </div>

                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-medium text-slate-800">
                                {t("Цены на товар")}{" "}
                                <span className="text-slate-400">
                                  ({expanded.priceLists.some((entry) => entry.cash || entry.nonCash) ? t("Установлены") : t("Не установлены")})
                                </span>
                              </p>
                              {!editingPrices && (
                                <button type="button" onClick={startEditPrices} aria-label={t("Изменить цены")} className="text-slate-400 hover:text-[#4f70e7]">
                                  <Pencil className="h-5 w-5" />
                                </button>
                              )}
                            </div>

                            {editingPrices ? (
                              <form onSubmit={savePrices}>
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="text-slate-500">
                                      <th className="py-2 pr-4">{t("Тип объекта")}</th>
                                      <th className="py-2 pr-4">{t("Нал")}</th>
                                      <th className="py-2 pr-4">{t("Безнал")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {priceDraft.map((entry) => (
                                      <tr key={entry.name} className="border-t border-slate-100">
                                        <td className="py-2 pr-4">{entry.name}</td>
                                        <td className="py-2 pr-4">
                                          <input type="number" value={entry.cash} onChange={(event) => updatePriceDraft(entry.name, { cash: Number(event.target.value) })} className="w-24 border-b border-slate-300 outline-none" />
                                        </td>
                                        <td className="py-2 pr-4">
                                          <input type="number" value={entry.nonCash} onChange={(event) => updatePriceDraft(entry.name, { nonCash: Number(event.target.value) })} className="w-24 border-b border-slate-300 outline-none" />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="mt-3 flex justify-end gap-3">
                                  <button type="button" onClick={() => setEditingPrices(false)} className="rounded border px-4 py-2 text-sm">{t("Отмена")}</button>
                                  <button type="submit" className="rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white">{t("Сохранить")}</button>
                                </div>
                              </form>
                            ) : (
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="py-2 pr-4">{t("Тип объекта")}</th>
                                    <th className="py-2 pr-4">{t("Нал")}</th>
                                    <th className="py-2 pr-4">{t("Безнал")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {withAllPriceLists(expanded.priceLists, priceListNames).map((entry) => (
                                    <tr key={entry.name} className="border-t border-slate-100">
                                      <td className="py-2 pr-4">{entry.name}</td>
                                      <td className="py-2 pr-4">{entry.cash ? formatMoney(entry.cash, entry.currency ?? "SUM") : 0}</td>
                                      <td className="py-2 pr-4">{entry.nonCash ? formatMoney(entry.nonCash, entry.nonCashCurrency ?? entry.currency ?? "SUM") : 0}</td>
                                    </tr>
                                  ))}
                                  {!priceListNames.length && !expanded.priceLists.length && (
                                    <tr><td colSpan={3} className="py-4 text-center text-slate-400">{t("Нет прайс-листов — создайте их в разделе «Прайс-листы»")}</td></tr>
                                  )}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {addStage === "pick" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{t("Установить цену в прайс-лист")}</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>
            <div className="flex flex-wrap items-center gap-4 border-b p-5">
              <label className="text-sm font-medium text-slate-600">
                {t("Фильтр по типу")} *
                <select value={pickTypeFilter} onChange={(event) => setPickTypeFilter(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
                  <option value="all">{t("Все")}</option>
                  {productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-600">
                {t("Фильтр по бренду")} *
                <select value={pickBrandFilter} onChange={(event) => setPickBrandFilter(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
                  <option value="all">{t("Все")}</option>
                  {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </label>
              <label className="relative ml-auto w-72">
                <input value={pickQuery} onChange={(event) => setPickQuery(event.target.value)} placeholder={t("Поиск товаров...")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
                <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#626b7e] text-white">
                  <tr>
                    <th className="px-6 py-3">{t("Название")}</th>
                    <th className="px-6 py-3">{t("Тип")}</th>
                    <th className="px-6 py-3">{t("Бренд")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pickResults.slice(0, 200).map((product) => (
                    <tr key={product.id} onClick={() => pickProduct(product)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-3 text-[#4f70e7]">{product.name}</td>
                      <td className="px-6 py-3">{product.type}</td>
                      <td className="px-6 py-3">{product.brand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {addStage === "currency" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={goToAmount} className="w-full max-w-md rounded bg-white p-6">
            <div className="mb-5 flex items-center justify-between border-b pb-4">
              <b>{t("Выберите валюту")}</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              {t("Выберите прайс-лист")} <span className="text-red-500">*</span>
              <select required value={selectedPriceList} onChange={(event) => setSelectedPriceList(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                <option value="">{t("Выберите...")}</option>
                {priceListNames.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              {t("Выберите валюту для наличных")} <span className="text-red-500">*</span>
              <select value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </label>
            <div className="mb-4 space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={importMode === "manual"} onChange={() => setImportMode("manual")} /> {t("Вручную")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={importMode === "excel"} onChange={() => setImportMode("excel")} /> {t("Импортировать с excel")}
              </label>
              {importMode === "excel" && (
                <button type="button" onClick={downloadPriceImportTemplate} className="ml-6 text-sm font-semibold text-[#4f70e7] hover:underline">
                  {t("Скачать шаблон")}
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={separateTransferPrice} onChange={(event) => setSeparateTransferPrice(event.target.checked)} /> {t("Установить другую цену для перевода")}
              </label>
            </div>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importPricesFromExcel} className="hidden" />
            <div className="flex justify-end gap-4">
              <button type="button" onClick={() => setAddStage(null)} className="font-semibold text-[#4f70e7]">{t("Отмена")}</button>
              <button type="submit" className="font-semibold text-[#4f70e7]">{t("Далее")}</button>
            </div>
          </form>
        </div>
      )}

      {addStage === "amount" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveNewPrice} className="w-full max-w-md rounded bg-white p-6">
            <div className="mb-5 flex items-center justify-between border-b pb-4">
              <b>{t("Установить цену")} — {selectedPriceList}</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              {t("Наличными")} ({selectedCurrency})
              <input autoFocus type="number" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} className="mt-2 block w-full outline-none" />
            </label>
            {separateTransferPrice && (
              <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
                {t("Безналично")} ({selectedCurrency})
                <input type="number" value={nonCashAmount} onChange={(event) => setNonCashAmount(event.target.value)} className="mt-2 block w-full outline-none" />
              </label>
            )}
            <div className="mt-6 flex justify-end">
              <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">{t("Сохранить")}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
