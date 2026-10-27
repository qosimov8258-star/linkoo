"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FilterCheck, FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar, REF_SHADOW, usePaging } from "@/components/ref/list-kit"
import { ReportMultiChipField } from "@/components/ref/report-kit"
import { formatStatementDate, parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

const PRICE_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "штрих код товара": "barcode", "штрихкод": "barcode", "штрих код": "barcode", "barcode": "barcode",
  "цена": "price", "price": "price",
}
import type { PriceListEntry, Product } from "./products-data"
import { notify } from "@/lib/notify"

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
type SupplyLine = { incomingId: number; date: string; qty: number; onStock: number; unitCost: number; averageCost: number | null; accepted: boolean }
/** currentCost = the one cost of goods (lib/stock/costs.ts), base currency. */
type CostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[]; lines?: SupplyLine[]; baseCurrency?: string }
/** GET /api/supplier-incomings/product-costs. */
type ProductCosts = { baseCurrency: string; costs: Record<string, number> }

const PRICE_ICON = "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"
const EDIT_ICON = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

/** "1,202 SUM": the stored value is shown as is, a missing barcode with a capital letter like the reference. */
function notSet(value: string) {
  return value.trim().toLowerCase() === "не установлен" ? "Не установлен" : value
}


/** Min / max of a product's own price lists (display fallback; the server stores priceMin / priceMax in the base currency). */
function priceBounds(entries: PriceListEntry[]) {
  const values = entries.flatMap((entry) => [entry.cash, entry.nonCash]).filter((value) => value > 0)
  return { priceMin: values.length ? Math.min(...values) : 0, priceMax: values.length ? Math.max(...values) : 0 }
}

/** Every price list with this product's price in it (0 when not set). */
function withAllPriceLists(entries: PriceListEntry[], names: string[]): PriceListEntry[] {
  const merged = names.map((name) => entries.find((entry) => entry.name === name) ?? { name, cash: 0, nonCash: 0, min: 0, max: 0 })
  return names.length ? merged : entries
}

type AddStage = "pick" | "currency" | "amount" | null

export function PriceFormationView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [rows, setRows] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [unitFilter, setUnitFilter] = useState("all")
  const [organizationFilter, setOrganizationFilter] = useState("all")
  const [brandFilter, setBrandFilter] = useState("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
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
  const [pickPage, setPickPage] = useState(1)
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [priceListNames, setPriceListNames] = useState<string[]>([])
  const [selectedPriceLists, setSelectedPriceLists] = useState<string[]>([])
  const [priceInputs, setPriceInputs] = useState<Record<string, { cash: string; nonCash: string }>>({})
  const [costInfo, setCostInfo] = useState<CostInfo | null>(null)
  const [baseCurrency, setBaseCurrency] = useState(currencies[0])
  const [selectedCurrency, setSelectedCurrency] = useState("")
  const [importMode, setImportMode] = useState<"manual" | "excel">("manual")
  const [separateTransferPrice, setSeparateTransferPrice] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()

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
        setRows(
          data
            .filter((product) => !product.deleted && !product.isInventory)
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
  }, [])

  // Products whose stored cost is 0 show the running average of their accepted supplies (the reference's formula).
  const [supplyCosts, setSupplyCosts] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    fetch("/api/products/supply-costs")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: Record<string, number>) => !cancelled && setSupplyCosts(data))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const costOf = (row: Product) => row.cost || supplyCosts[row.name.trim().toLocaleLowerCase("ru")] || 0

  useEffect(() => {
    let cancelled = false
    fetch("/api/price-lists")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: { name: string }[]) => {
        if (cancelled) return
        setPriceListNames(data.map((item) => item.name))
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
  const suppliers = useMemo(() => Array.from(new Set(rows.map((row) => row.supplier))).filter(Boolean), [rows])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query.toLowerCase())) return false
      if (typeFilter !== "all" && row.type !== typeFilter) return false
      if (unitFilter !== "all" && row.unit !== unitFilter) return false
      if (organizationFilter !== "all" && row.organization !== organizationFilter) return false
      if (brandFilter !== "all" && row.brand !== brandFilter) return false
      if (supplierFilter !== "all" && row.supplier !== supplierFilter) return false
      if (canSellFilter !== "all" && String(row.canSell) !== canSellFilter) return false
      if (noCostOnly && costOf(row) !== 0) return false
      return true
    })
  }, [rows, query, typeFilter, unitFilter, organizationFilter, brandFilter, supplierFilter, canSellFilter, noCostOnly])

  const paging = usePaging(filtered.length)
  const visible = filtered.slice(paging.start, paging.end)
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
    const next = expandedId === row.id ? null : row.id
    setExpandedId(next)
    setEditingDefaultCost(false)
    setEditingPrices(false)
    if (!embedded) window.history.pushState(null, "", next === null ? "/analytics/price-formation" : `/analytics/price-formation/${next}`)
  }

  // ?openSetPrice=true opens the "Установить цену в прайс-лист" flow (deep link like the reference).
  useEffect(() => {
    if (!embedded && new URLSearchParams(window.location.search).get("openSetPrice") === "true") setAddStage("currency")
  }, [embedded])

  // /analytics/price-formation/<id> opens the product panel (back / forward and direct links included).
  useEffect(() => {
    if (embedded) return
    const match = pathname.match(/\/price-formation\/(\d+)/)
    setExpandedId(match ? Number(match[1]) : null)
  }, [pathname, embedded])

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
        notify(data.error ? t(data.error) : t("Не удалось сохранить товар"))
        return
      }
      const info = data as CostInfo
      setCostInfo(info)
      setRows((current) => current.map((row) => (row.id === expanded.id ? { ...row, cost: info.currentCost } : row)))
      setEditingDefaultCost(false)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
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

  const filterPanel = (
    <RefFilterPanel narrow applyClassName="mt-[26px]" onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)} className="!w-[310px]">
      <FilterSelect label={t("Тип продукта")} value={typeFilter === "all" ? "" : typeFilter} onChange={(value) => { setTypeFilter(value || "all"); paging.setPage(1) }} options={productTypes} />
      <FilterSelect label={t("Мера")} value={unitFilter === "all" ? "" : unitFilter} onChange={(value) => { setUnitFilter(value || "all"); paging.setPage(1) }} options={units} />
      <FilterSelect label={t("Поставка")} value={supplierFilter === "all" ? "" : supplierFilter} onChange={(value) => { setSupplierFilter(value || "all"); paging.setPage(1) }} options={suppliers} />
      <FilterSelect label={t("Организация")} value={organizationFilter === "all" ? "" : organizationFilter} onChange={(value) => { setOrganizationFilter(value || "all"); paging.setPage(1) }} options={organizations} />
      <FilterSelect label={t("Бренд")} value={brandFilter === "all" ? "" : brandFilter} onChange={(value) => { setBrandFilter(value || "all"); paging.setPage(1) }} options={brands} />
      <FilterSelect label={t("Можно продавать")} value={canSellFilter === "all" ? "" : canSellFilter === "true" ? t("Да") : t("Нет")} onChange={(value) => { setCanSellFilter(!value ? "all" : value === t("Да") ? "true" : "false"); paging.setPage(1) }} options={[t("Да"), t("Нет")]} />
      <FilterCheck compact label={t("Товары без себестоимости")} checked={noCostOnly} onChange={(value) => { setNoCostOnly(value); paging.setPage(1) }} className="mt-[2px]" />
    </RefFilterPanel>
  )

  const heads = [
    t("Название"),
    t("Штрих - код товара"),
    t("Себестоимость"),
    <div key="min" className="-mr-[22px] text-right">{t("Цена(мин)")}</div>,
    <div key="max" className="text-center">{t("Цена(макс)")}</div>,
    t("Дата обновления"),
  ]
  const COLS = "469.3px 230.7px 230.7px 115.3px 230.6px 126px"

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Формирование цен")}>
          <RefButton exact icon={RI.chart} label={t("Скачать вид 2")} onClick={downloadView2} />
          <RefButton exact icon={RI.chart} label={t("Скачать")} onClick={downloadList} />
          <RefButton exact green icon={PRICE_ICON} label={t("Добавить цену")} onClick={openAddPrice} />
        </RefHeader>
      )}
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadList} color="#333" />}
          extra={embedded ? <RefButton green icon={PRICE_ICON} label={t("Добавить цену")} onClick={openAddPrice} /> : undefined}
        />
        <RefTable
          cols={COLS}
          heads={heads}
          headPad={30}
          hideBody={Boolean(expanded)}
          rows={visible}
          rowKey={(row) => row.id}
          onRowClick={toggleExpand}
          empty={loading ? t("Загрузка продуктов...") : loadError || t("По вашему запросу ничего не найдено")}
          render={(row) => [
            row.name,
            t(notSet(row.barcode)),
            formatMoney(costOf(row), baseCurrency),
            <div key="min" className="text-right">{formatMoney(row.priceMin || priceBounds(row.priceLists).priceMin)}</div>,
            <div key="max" className="text-center">{formatMoney(row.priceMax || priceBounds(row.priceLists).priceMax)}</div>,
            t(row.priceUpdatedDate),
          ]}
        />
      </RefCard>

      {expanded && (
        <section className={`-mx-[15px] mt-5 bg-white ${REF_SHADOW}`}>
          <div className="flex h-[60px] items-center justify-between border-b border-[#e8e8e8] pl-[30px] pr-[16px]">
            <h2 className="text-[18px] font-semibold leading-[25px] text-[#333]">{expanded.name}</h2>
            <button type="button" onClick={() => toggleExpand(expanded)} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
            </button>
          </div>
          <div className="grid min-h-[620px] grid-cols-2">
            <div className="px-[30px] pt-[20px]">
              <p className="text-[14px] font-semibold leading-5 text-[#333]">{t("Поставки")}</p>
              <div className="-mx-[30px] mt-4 flex h-[56px] items-center justify-between bg-[#f2f5f8] px-[30px] text-[13px] font-semibold">
                <span>{t("Себестоимость по умолчанию")}:</span>
                {editingDefaultCost ? (
                  <form onSubmit={saveDefaultCost} className="flex items-center gap-3">
                    <input autoFocus inputMode="decimal" value={defaultCostDraft} onChange={(event) => setDefaultCostDraft(event.target.value)} className="w-28 border-b border-[#ccc] bg-transparent text-right outline-none" />
                    <button type="submit" className="text-[13px] font-semibold uppercase text-[#129fdd]">OK</button>
                  </form>
                ) : (
                  <span className="flex items-center">
                    {formatMoney(costInfo?.initialCost ?? expanded.cost, baseCurrency)}
                    <button type="button" onClick={startEditDefaultCost} aria-label={t("Изменить себестоимость")} className="flex h-10 w-10 items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={EDIT_ICON} /></svg>
                    </button>
                  </span>
                )}
              </div>
              <div className="mt-[9px] text-[13px]">
                <div className="grid h-[40px] grid-cols-[64.3px_169px_112.7px_112.6px_minmax(0,1fr)_auto] items-center font-semibold">
                  <span>№</span><span>{t("Дата")}</span><span>{t("Кол-во")}</span><span>{t("На складе")}</span><span>{t("Себест.")}</span><span className="text-right">{t("Усред. Себ.")}</span>
                </div>
                {supplyLines.map((line) => (
                  <div key={line.incomingId} className={`relative grid h-[40px] grid-cols-[64.3px_169px_112.7px_112.6px_minmax(0,1fr)_auto] items-center ${DOTTED}`}>
                    <a href={`/analytics/supplier-incomings/${line.incomingId}`} className="text-[#129fdd]">{line.incomingId}</a>
                    <span>{formatDay(line.date, language)}</span>
                    <span>{line.qty.toLocaleString("ru-RU")}</span>
                    <span>{line.onStock.toLocaleString("ru-RU")}</span>
                    <span>{formatMoney(line.unitCost, baseCurrency)}</span>
                    <span className="text-right">{line.averageCost === null ? t("Не принято") : formatMoney(line.averageCost, baseCurrency)}</span>
                  </div>
                ))}
                {costInfo && !supplyLines.length && <div className="h-[40px] leading-[40px] text-[#999]">{t("Принятых поставок нет")}</div>}
                <div className="mt-2 flex h-[40px] items-center justify-end text-[13px] font-semibold">
                  <span>{t("Текущая себестоимость")}:</span>
                  <span className="ml-5">{formatMoney(costInfo?.currentCost ?? expanded.cost, baseCurrency)}</span>
                </div>
              </div>
            </div>

            <div className="border-l border-[#e8e8e8] px-[30px] pt-[20px]">
              <div className="flex h-5 items-center justify-between">
                <p className="text-[14px] font-semibold leading-5 text-[#333]">
                  {t("Цены на товар")}{" "}
                  <span className="text-[12px] text-[#a5a1a0]">({expanded.priceLists.some((entry) => entry.cash || entry.nonCash) ? t("Установлены") : t("Не установлены")})</span>
                </p>
                {!editingPrices && (
                  <button type="button" onClick={startEditPrices} aria-label={t("Изменить цены")} className="-mr-[10px] flex h-10 w-10 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={EDIT_ICON} /></svg>
                  </button>
                )}
              </div>
              <form onSubmit={savePrices} className="mt-[26px] text-[13px]">
                <div className="grid h-[40px] grid-cols-[minmax(0,1fr)_176px_177px] items-center font-semibold">
                  <span>{t("Тип обьекта")}</span><span className="text-right">{t("Нал")}</span><span className="text-right">{t("Безнал")}</span>
                </div>
                {(editingPrices ? priceDraft : withAllPriceLists(expanded.priceLists, priceListNames)).map((entry) => (
                  <div key={entry.name} className={`relative grid h-[40px] grid-cols-[minmax(0,1fr)_176px_177px] items-center ${DOTTED}`}>
                    <span className="truncate pr-3">{entry.name}</span>
                    {editingPrices ? (
                      <>
                        <input type="number" value={entry.cash} onChange={(event) => updatePriceDraft(entry.name, { cash: Number(event.target.value) })} className="ml-auto w-28 border-b border-[#ccc] bg-transparent text-right outline-none" />
                        <input type="number" value={entry.nonCash} onChange={(event) => updatePriceDraft(entry.name, { nonCash: Number(event.target.value) })} className="ml-auto w-28 border-b border-[#ccc] bg-transparent text-right outline-none" />
                      </>
                    ) : (
                      <>
                        <span className="text-right">{money(entry.cash, entry.currency)}</span>
                        <span className="text-right">{money(entry.nonCash, entry.nonCashCurrency ?? entry.currency)}</span>
                      </>
                    )}
                  </div>
                ))}
                {!priceListNames.length && !expanded.priceLists.length && <div className="py-6 text-center text-[#999]">{t("Нет прайс-листов — создайте их в разделе «Прайс-листы»")}</div>}
                {editingPrices && (
                  <div className="mt-4 flex justify-end gap-4">
                    <button type="button" onClick={() => setEditingPrices(false)} className="h-9 px-4 text-[13px] font-semibold uppercase text-[#4f71dc]">{t("Отмена")}</button>
                    <button type="submit" className="h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd]">{t("Сохранить")}</button>
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>
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
              <FilterSelect label={`${t("Выберите валюту для наличных")} *`} value={selectedCurrency} onChange={setSelectedCurrency} options={currencies} />
              <div className="-mt-[3px]">
                {(["manual", "excel"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setImportMode(mode)} className="flex h-[34px] items-center gap-4 text-left">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${importMode === mode ? "border-[#5d6474]" : "border-[#333]"}`}>{importMode === mode && <span className="h-3 w-3 rounded-full bg-[#5d6474]" />}</span>
                    {mode === "manual" ? t("Вручную") : t("Импортировать с excel")}
                  </button>
                ))}
                {importMode === "excel" && (
                  <button type="button" onClick={downloadPriceImportTemplate} className="ml-10 text-[13px] font-semibold text-[#4f71dc] hover:underline">{t("Скачать шаблон")}</button>
                )}
                <FilterCheck compact label={t("Установить другую цену для перевода")} checked={separateTransferPrice} onChange={setSeparateTransferPrice} className="pt-[2px]" />
              </div>
            </div>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importPricesFromExcel} className="hidden" />
            <div className="absolute bottom-[7px] right-[30px] flex items-center gap-[39px]">
              <button type="button" onClick={() => setAddStage(null)} className="h-9 text-[13px] font-semibold uppercase text-[#4f71dc]">{t("Отмена")}</button>
              <button type="submit" disabled={!selectedPriceLists.length || !selectedCurrency} className={`h-9 text-[13px] font-semibold uppercase ${selectedPriceLists.length && selectedCurrency ? "text-[#4f71dc]" : "text-[#b0b0b0]"}`}>{t("Далее")}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}
