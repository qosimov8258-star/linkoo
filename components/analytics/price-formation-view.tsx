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
import { useLanguage } from "@/lib/i18n/language-context"

const PRICE_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "штрих код товара": "barcode", "штрихкод": "barcode", "штрих код": "barcode", "barcode": "barcode",
  "цена": "price", "price": "price",
}
import { defaultPriceLists, type PriceListEntry, type Product } from "./products-data"

const priceListNames = defaultPriceLists().map((entry) => entry.name)
const currencies = ["SUM", "USD"]

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

type AddStage = "pick" | "currency" | "amount" | null

function toProductInput(product: Product): Omit<Product, "id" | "createdDate"> {
  const { id: _id, createdDate: _createdDate, ...rest } = product
  return rest
}

export function PriceFormationView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
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
  const [selectedPriceList, setSelectedPriceList] = useState(priceListNames[0])
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
    fetch("/api/products")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить продукты")
        return (await response.json()) as Product[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data.filter((product) => !product.deleted))
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

  async function patchProduct(id: number, patch: Partial<Product>): Promise<Product | null> {
    const current = rows.find((row) => row.id === id)
    if (!current) return null
    const merged: Product = { ...current, ...patch }
    try {
      const response = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toProductInput(merged)),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить товар"))
        return null
      }
      const saved = (await response.json()) as Product
      setRows((curr) => curr.map((row) => (row.id === id ? saved : row)))
      return saved
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
      return null
    }
  }

  function startEditDefaultCost() {
    if (!expanded) return
    setDefaultCostDraft(String(expanded.cost))
    setEditingDefaultCost(true)
  }

  async function saveDefaultCost(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    const value = Number(defaultCostDraft) || 0
    await patchProduct(expanded.id, { cost: value })
    setEditingDefaultCost(false)
  }

  function startEditPrices() {
    if (!expanded) return
    setPriceDraft(expanded.priceLists.map((entry) => ({ ...entry })))
    setEditingPrices(true)
  }

  function updatePriceDraft(name: string, patch: Partial<PriceListEntry>) {
    setPriceDraft((current) => current.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry)))
  }

  async function savePrices(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    const values = priceDraft.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
    await patchProduct(expanded.id, {
      priceLists: priceDraft,
      priceMin: values.length ? Math.min(...values) : expanded.priceMin,
      priceMax: values.length ? Math.max(...values) : expanded.priceMax,
      priceUpdatedDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }),
    })
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
        const updatedPrices = target.priceLists.map((entry) => (entry.name === selectedPriceList ? { ...entry, cash: price } : entry))
        const values = updatedPrices.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
        await patchProduct(target.id, {
          priceLists: updatedPrices,
          priceMin: values.length ? Math.min(...values) : target.priceMin,
          priceMax: values.length ? Math.max(...values) : target.priceMax,
          priceUpdatedDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }),
        })
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
    const updatedPrices = target.priceLists.map((entry) => (entry.name === selectedPriceList ? { ...entry, cash, nonCash } : entry))
    const values = updatedPrices.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
    await patchProduct(target.id, {
      priceLists: updatedPrices,
      priceMin: values.length ? Math.min(...values) : target.priceMin,
      priceMax: values.length ? Math.max(...values) : target.priceMax,
      priceUpdatedDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }),
    })
    setAddStage(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
            <span className="mx-2 text-slate-400">|</span> {t("Формирование цен")}
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={downloadView2} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Скачать вид 2")}
            </button>
            <button type="button" onClick={downloadList} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Скачать")}
            </button>
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> {t("Добавить цену")}
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
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
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
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
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f71dc]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
          {embedded && (
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> {t("Добавить цену")}
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">Название</th>
              <th className="px-5 py-5">Штрих - код товара</th>
              <th className="px-5 py-5">Себестоимость</th>
              <th className="px-5 py-5">Цена(мин)</th>
              <th className="px-5 py-5">Цена(макс)</th>
              <th className="px-5 py-5">Дата обновления</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">Загрузка продуктов...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 text-[#4f71dc]">{row.name}</td>
                  <td className="px-5 py-4">{row.barcode}</td>
                  <td className="px-5 py-4">{formatMoney(row.cost)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMin)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMax)}</td>
                  <td className="px-5 py-4">{row.priceUpdatedDate}</td>
                </tr>

                {expandedId === row.id && expanded && (
                  <tr>
                    <td colSpan={6} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{expanded.name}</h2>
                          <button type="button" onClick={() => setExpandedId(null)} aria-label="Закрыть" className="text-slate-500 hover:text-slate-800">
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="grid gap-8 lg:grid-cols-2">
                          <div>
                            <p className="mb-3 font-medium text-slate-800">Себестоимость</p>
                            {editingDefaultCost ? (
                              <form onSubmit={saveDefaultCost} className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Себестоимость по умолчанию:</span>
                                <span className="flex items-center gap-2">
                                  <input autoFocus type="number" value={defaultCostDraft} onChange={(event) => setDefaultCostDraft(event.target.value)} className="w-28 border-b border-slate-300 text-right outline-none" />
                                  <button type="submit" className="text-sm font-semibold text-[#4f71dc]">OK</button>
                                </span>
                              </form>
                            ) : (
                              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Себестоимость по умолчанию:</span>
                                <span className="flex items-center gap-2 font-medium">
                                  {formatMoney(expanded.cost)}
                                  <button type="button" onClick={startEditDefaultCost} aria-label="Изменить себестоимость" className="text-slate-400 hover:text-[#4f71dc]">
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                </span>
                              </div>
                            )}
                            <p className="text-sm text-slate-500">История поставок появится после подключения приёмок товара.</p>

                            <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 font-semibold">
                              <span>Текущая себестоимость:</span>
                              <span>{formatMoney(expanded.cost)}</span>
                            </div>
                          </div>

                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-medium text-slate-800">
                                Цены на товар{" "}
                                <span className="text-slate-400">
                                  ({expanded.priceLists.some((entry) => entry.cash || entry.nonCash) ? "Установлены" : "Не установлены"})
                                </span>
                              </p>
                              {!editingPrices && (
                                <button type="button" onClick={startEditPrices} aria-label="Изменить цены" className="text-slate-400 hover:text-[#4f71dc]">
                                  <Pencil className="h-5 w-5" />
                                </button>
                              )}
                            </div>

                            {editingPrices ? (
                              <form onSubmit={savePrices}>
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="text-slate-500">
                                      <th className="py-2 pr-4">Тип объекта</th>
                                      <th className="py-2 pr-4">Нал</th>
                                      <th className="py-2 pr-4">Безнал</th>
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
                                  <button type="button" onClick={() => setEditingPrices(false)} className="rounded border px-4 py-2 text-sm">Отмена</button>
                                  <button type="submit" className="rounded bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white">Сохранить</button>
                                </div>
                              </form>
                            ) : (
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="py-2 pr-4">Тип объекта</th>
                                    <th className="py-2 pr-4">Нал</th>
                                    <th className="py-2 pr-4">Безнал</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expanded.priceLists.map((entry) => (
                                    <tr key={entry.name} className="border-t border-slate-100">
                                      <td className="py-2 pr-4">{entry.name}</td>
                                      <td className="py-2 pr-4">{entry.cash}</td>
                                      <td className="py-2 pr-4">{entry.nonCash}</td>
                                    </tr>
                                  ))}
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
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {addStage === "pick" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Установить цену в прайс-лист</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex flex-wrap items-center gap-4 border-b p-5">
              <label className="text-sm font-medium text-slate-600">
                Фильтр по типу *
                <select value={pickTypeFilter} onChange={(event) => setPickTypeFilter(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
                  <option value="all">Все</option>
                  {productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-600">
                Фильтр по бренду *
                <select value={pickBrandFilter} onChange={(event) => setPickBrandFilter(event.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5">
                  <option value="all">Все</option>
                  {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </label>
              <label className="relative ml-auto w-72">
                <input value={pickQuery} onChange={(event) => setPickQuery(event.target.value)} placeholder="Поиск товаров..." className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
                <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#5d6474] text-white">
                  <tr>
                    <th className="px-6 py-3">Название</th>
                    <th className="px-6 py-3">Тип</th>
                    <th className="px-6 py-3">Бренд</th>
                  </tr>
                </thead>
                <tbody>
                  {pickResults.slice(0, 200).map((product) => (
                    <tr key={product.id} onClick={() => pickProduct(product)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-3 text-[#4f71dc]">{product.name}</td>
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
              <b>Выберите валюту</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              Выберите прайс-лист <span className="text-red-500">*</span>
              <select value={selectedPriceList} onChange={(event) => setSelectedPriceList(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                {priceListNames.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              Выберите валюту для наличных <span className="text-red-500">*</span>
              <select value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </label>
            <div className="mb-4 space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={importMode === "manual"} onChange={() => setImportMode("manual")} /> Вручную
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={importMode === "excel"} onChange={() => setImportMode("excel")} /> Импортировать с excel
              </label>
              {importMode === "excel" && (
                <button type="button" onClick={downloadPriceImportTemplate} className="ml-6 text-sm font-semibold text-[#4f71dc] hover:underline">
                  Скачать шаблон
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={separateTransferPrice} onChange={(event) => setSeparateTransferPrice(event.target.checked)} /> Установить другую цену для перевода
              </label>
            </div>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importPricesFromExcel} className="hidden" />
            <div className="flex justify-end gap-4">
              <button type="button" onClick={() => setAddStage(null)} className="font-semibold text-[#4f71dc]">Отмена</button>
              <button type="submit" className="font-semibold text-[#4f71dc]">Далее</button>
            </div>
          </form>
        </div>
      )}

      {addStage === "amount" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveNewPrice} className="w-full max-w-md rounded bg-white p-6">
            <div className="mb-5 flex items-center justify-between border-b pb-4">
              <b>Установить цену — {selectedPriceList}</b>
              <button type="button" onClick={() => setAddStage(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              Наличными ({selectedCurrency})
              <input autoFocus type="number" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} className="mt-2 block w-full outline-none" />
            </label>
            {separateTransferPrice && (
              <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
                Безналично ({selectedCurrency})
                <input type="number" value={nonCashAmount} onChange={(event) => setNonCashAmount(event.target.value)} className="mt-2 block w-full outline-none" />
              </label>
            )}
            <div className="mt-6 flex justify-end">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
