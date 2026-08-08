"use client"

import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  DollarSign,
  Pencil,
  Search,
  Star,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"

type Supply = { id: number; date: string; qty: number; inStock: number; cost: number; avgCost: string }
type PriceListEntry = { name: string; cash: number; nonCash: number }
type Product = {
  id: number
  name: string
  barcode: string
  cost: number
  priceMin: number
  priceMax: number
  updatedDate: string
  type: string
  brand: string
  unit: string
  organization: string
  canSell: boolean
  defaultCost: number
  supplies: Supply[]
  priceListPrices: PriceListEntry[]
}

const priceListNames = ["donalik", "o'rtacha narx", "optom narxlar", "ООО ПРОФШ", "123123123", "TestPriceList"]
const productTypes = ["Масла", "Напитки", "Снеки", "Бытовая химия", "Молочные продукты"]
const brands = ["EAGLE", "Coca-Cola", "PepsiCo", "Generic", "Nestle"]
const units = ["шт", "л", "кг"]
const organizations = ["ТестоваяОрганизация", "Linko Distribution"]
const currencies = ["SUM", "USD"]

function emptyPrices(): PriceListEntry[] {
  return priceListNames.map((name) => ({ name, cash: 0, nonCash: 0 }))
}

const knownRows: Product[] = [
  {
    id: 1,
    name: "Arslan 111111",
    barcode: "28812949090720",
    cost: 1202,
    priceMin: 0,
    priceMax: 15000,
    updatedDate: "13 июня 2026",
    type: "Напитки",
    brand: "Generic",
    unit: "шт",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1202,
    supplies: [{ id: 4001, date: "13 июня 2026", qty: 20, inStock: 12, cost: 24040, avgCost: "Принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 2,
    name: "seriya test",
    barcode: "Не установлен",
    cost: 11500,
    priceMin: 0,
    priceMax: 146580000,
    updatedDate: "26 мая 2026",
    type: "Снеки",
    brand: "Generic",
    unit: "шт",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 11500,
    supplies: [{ id: 4102, date: "26 мая 2026", qty: 3, inStock: 1, cost: 34500, avgCost: "Принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 3,
    name: "Масло трансмиссионное EAGLE PEGASUS MULTI ATF 1л (EO00710)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 2540,
    priceMax: 4110,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4206, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 4,
    name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 200л (EO00690)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 294290,
    priceMax: 475620,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4207, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 5,
    name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 4л (EO00620)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 6860,
    priceMax: 11090,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4208, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 6,
    name: "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 1л (EO00610)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 1970,
    priceMax: 10000,
    updatedDate: "27 февр. 2026",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4209, date: "27 февр. 2026", qty: 5, inStock: 2, cost: 5, avgCost: "Принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 7,
    name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 200л (EO00590)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 342150,
    priceMax: 552960,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4210, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 8,
    name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 4л (EO00520)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 7970,
    priceMax: 12880,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4211, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 9,
    name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-40 API SP 1л (EO00510)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 2250,
    priceMax: 3650,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4212, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
  {
    id: 10,
    name: "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-30 API SP ILSAC GF-6A 200л (EO00490)",
    barcode: "Не установлен",
    cost: 1,
    priceMin: 328580,
    priceMax: 531030,
    updatedDate: "Не установлена",
    type: "Масла",
    brand: "EAGLE",
    unit: "л",
    organization: "ТестоваяОрганизация",
    canSell: true,
    defaultCost: 1,
    supplies: [{ id: 4213, date: "", qty: 1, inStock: 0, cost: 0, avgCost: "Не принято" }],
    priceListPrices: emptyPrices(),
  },
]

const oilBases = [
  "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 5W-30 API SP ILSAC GF-6A",
  "Масло моторное EAGLE PREMIUM Gasoline 100% SYNTHETIC SAE 0W-20 API SP",
  "Масло трансмиссионное EAGLE PEGASUS MULTI ATF",
  "Масло гидравлическое EAGLE HYDRO HLP 46",
  "Антифриз EAGLE COOLANT G12+",
  "Смазка EAGLE GREASE EP2",
]
const oilSizes = ["200л", "20л", "5л", "4л", "1л"]
const genericNames = ["coca-cola 1.5l", "lipton ice tea 0.5l", "sprayt 1l", "energetik 0.5l", "baby still 1.5l", "g'ilof", "Lalaku"]

function generateRows(): Product[] {
  const rows: Product[] = [...knownRows]
  let code = 470

  for (let id = 11; id <= 805; id += 1) {
    const useOil = id % 5 !== 0
    const cost = useOil ? 1 : 500 + (id * 37) % 20000
    const priceMin = 1000 + (id * 173) % 300000
    const priceMax = priceMin + 500 + (id * 97) % 250000
    const updatedDate = id % 6 === 0 ? "Не установлена" : `${String(1 + (id % 28)).padStart(2, "0")} ${["янв.", "февр.", "марта", "апр.", "мая", "июня"][id % 6]} 2026`
    const type = useOil ? "Масла" : productTypes[id % productTypes.length]
    const brand = useOil ? "EAGLE" : brands[id % brands.length]

    let name: string
    let barcode = "Не установлен"
    if (useOil) {
      const base = oilBases[id % oilBases.length]
      const size = oilSizes[id % oilSizes.length]
      code += 5
      name = `${base} ${size} (EO00${code})`
    } else {
      name = `${genericNames[id % genericNames.length]} #${id}`
      barcode = String(28800000000000 + id * 137)
    }

    rows.push({
      id,
      name,
      barcode,
      cost,
      priceMin,
      priceMax,
      updatedDate,
      type,
      brand,
      unit: units[id % units.length],
      organization: organizations[id % organizations.length],
      canSell: id % 17 !== 0,
      defaultCost: cost,
      supplies: [{ id: 5000 + id, date: updatedDate === "Не установлена" ? "" : updatedDate, qty: 1 + (id % 20), inStock: id % 15, cost: cost * (1 + (id % 3)), avgCost: id % 6 === 0 ? "Не принято" : "Принято" }],
      priceListPrices: emptyPrices(),
    })
  }

  return rows
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

type AddStage = "pick" | "currency" | "amount" | null

export function PriceFormationView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Product[]>(generateRows)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
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

  function startEditDefaultCost() {
    if (!expanded) return
    setDefaultCostDraft(String(expanded.defaultCost))
    setEditingDefaultCost(true)
  }

  function saveDefaultCost(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    const value = Number(defaultCostDraft) || 0
    setRows((current) => current.map((row) => (row.id === expanded.id ? { ...row, defaultCost: value, cost: value } : row)))
    setEditingDefaultCost(false)
  }

  function startEditPrices() {
    if (!expanded) return
    setPriceDraft(expanded.priceListPrices.map((entry) => ({ ...entry })))
    setEditingPrices(true)
  }

  function updatePriceDraft(name: string, patch: Partial<PriceListEntry>) {
    setPriceDraft((current) => current.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry)))
  }

  function savePrices(event: FormEvent) {
    event.preventDefault()
    if (!expanded) return
    const values = priceDraft.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
    setRows((current) =>
      current.map((row) =>
        row.id === expanded.id
          ? {
              ...row,
              priceListPrices: priceDraft,
              priceMin: values.length ? Math.min(...values) : row.priceMin,
              priceMax: values.length ? Math.max(...values) : row.priceMax,
              updatedDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }),
            }
          : row,
      ),
    )
    setEditingPrices(false)
  }

  function downloadList() {
    downloadExcelTable("formirovanie-tsen", [
      ["Название", "Штрих-код товара", "Себестоимость", "Цена(мин)", "Цена(макс)", "Дата обновления"],
      ...filtered.map((row) => [row.name, row.barcode, row.cost, row.priceMin, row.priceMax, row.updatedDate]),
    ])
  }

  function downloadView2() {
    downloadExcelTable("formirovanie-tsen-vid-2", [
      ["Название", "Тип", "Бренд", "Ед.изм.", "Организация", "Можно продавать", "Себестоимость"],
      ...filtered.map((row) => [row.name, row.type, row.brand, row.unit, row.organization, row.canSell ? "Да" : "Нет", row.cost]),
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
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? "")
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      setRows((current) => {
        const next = [...current]
        for (const line of lines) {
          const [barcode, priceRaw] = line.split(/\t|,|;/).map((cell) => cell.trim())
          const price = Number(priceRaw)
          if (!barcode || !price) continue
          const index = next.findIndex((row) => row.barcode === barcode)
          if (index === -1) continue
          const updatedPrices = next[index].priceListPrices.map((entry) => (entry.name === selectedPriceList ? { ...entry, cash: price } : entry))
          const values = updatedPrices.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
          next[index] = { ...next[index], priceListPrices: updatedPrices, priceMin: values.length ? Math.min(...values) : next[index].priceMin, priceMax: values.length ? Math.max(...values) : next[index].priceMax }
        }
        return next
      })
      event.target.value = ""
      setAddStage(null)
    }
    reader.readAsText(file)
  }

  function saveNewPrice(event: FormEvent) {
    event.preventDefault()
    if (selectedProductId === null) return
    const cash = Number(cashAmount) || 0
    const nonCash = separateTransferPrice ? Number(nonCashAmount) || 0 : cash
    setRows((current) =>
      current.map((row) => {
        if (row.id !== selectedProductId) return row
        const updatedPrices = row.priceListPrices.map((entry) => (entry.name === selectedPriceList ? { ...entry, cash, nonCash } : entry))
        const values = updatedPrices.filter((entry) => entry.cash > 0).map((entry) => entry.cash)
        return {
          ...row,
          priceListPrices: updatedPrices,
          priceMin: values.length ? Math.min(...values) : row.priceMin,
          priceMax: values.length ? Math.max(...values) : row.priceMax,
          updatedDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }),
        }
      }),
    )
    setAddStage(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Формирование цен
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={downloadView2} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Скачать вид 2
            </button>
            <button type="button" onClick={downloadList} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Скачать
            </button>
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> Добавить цену
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="grid gap-4 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-sm text-slate-600">
              Тип продукта
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">Все</option>
                {productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Мера
              <select value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">Все</option>
                {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Организация
              <select value={organizationFilter} onChange={(event) => { setOrganizationFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">Все</option>
                {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Бренд
              <select value={brandFilter} onChange={(event) => { setBrandFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">Все</option>
                {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Можно продавать
              <select value={canSellFilter} onChange={(event) => { setCanSellFilter(event.target.value); setPage(1) }} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="all">Все</option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </select>
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={noCostOnly} onChange={(event) => { setNoCostOnly(event.target.checked); setPage(1) }} />
              Товары без себестоимости
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f70e7]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
          {embedded && (
            <button type="button" onClick={openAddPrice} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <DollarSign className="h-4 w-4" /> Добавить цену
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
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
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 text-[#4f70e7]">{row.name}</td>
                  <td className="px-5 py-4">{row.barcode}</td>
                  <td className="px-5 py-4">{formatMoney(row.cost)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMin)}</td>
                  <td className="px-5 py-4">{formatMoney(row.priceMax)}</td>
                  <td className="px-5 py-4">{row.updatedDate}</td>
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
                            <p className="mb-3 font-medium text-slate-800">Поставки</p>
                            {editingDefaultCost ? (
                              <form onSubmit={saveDefaultCost} className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Себестоимость по умолчанию:</span>
                                <span className="flex items-center gap-2">
                                  <input autoFocus type="number" value={defaultCostDraft} onChange={(event) => setDefaultCostDraft(event.target.value)} className="w-28 border-b border-slate-300 text-right outline-none" />
                                  <button type="submit" className="text-sm font-semibold text-[#4f70e7]">OK</button>
                                </span>
                              </form>
                            ) : (
                              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                                <span className="text-slate-600">Себестоимость по умолчанию:</span>
                                <span className="flex items-center gap-2 font-medium">
                                  {formatMoney(expanded.defaultCost)}
                                  <button type="button" onClick={startEditDefaultCost} aria-label="Изменить себестоимость" className="text-slate-400 hover:text-[#4f70e7]">
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                </span>
                              </div>
                            )}

                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">№</th>
                                  <th className="py-2 pr-4">Дата</th>
                                  <th className="py-2 pr-4">Кол-во</th>
                                  <th className="py-2 pr-4">На складе</th>
                                  <th className="py-2 pr-4">Себест.</th>
                                  <th className="py-2 pr-4">Усред. Себ.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expanded.supplies.map((supply) => (
                                  <tr key={supply.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4 text-[#4f70e7]">{supply.id}</td>
                                    <td className="py-2 pr-4">{supply.date || "—"}</td>
                                    <td className="py-2 pr-4">{supply.qty}</td>
                                    <td className="py-2 pr-4">{supply.inStock}</td>
                                    <td className="py-2 pr-4">{formatMoney(supply.cost)}</td>
                                    <td className="py-2 pr-4">{supply.avgCost}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 font-semibold">
                              <span>Текущая себестоимость:</span>
                              <span>{formatMoney(expanded.defaultCost)}</span>
                            </div>
                          </div>

                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-medium text-slate-800">
                                Цены на товар{" "}
                                <span className="text-slate-400">
                                  ({expanded.priceListPrices.some((entry) => entry.cash || entry.nonCash) ? "Установлены" : "Не установлены"})
                                </span>
                              </p>
                              {!editingPrices && (
                                <button type="button" onClick={startEditPrices} aria-label="Изменить цены" className="text-slate-400 hover:text-[#4f70e7]">
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
                                  <button type="submit" className="rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white">Сохранить</button>
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
                                  {expanded.priceListPrices.map((entry) => (
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

        {visible.length === 0 && (
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
                <input value={pickQuery} onChange={(event) => setPickQuery(event.target.value)} placeholder="Поиск товаров..." className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
                <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#626b7e] text-white">
                  <tr>
                    <th className="px-6 py-3">Название</th>
                    <th className="px-6 py-3">Тип</th>
                    <th className="px-6 py-3">Бренд</th>
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={separateTransferPrice} onChange={(event) => setSeparateTransferPrice(event.target.checked)} /> Установить другую цену для перевода
              </label>
            </div>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importPricesFromExcel} className="hidden" />
            <div className="flex justify-end gap-4">
              <button type="button" onClick={() => setAddStage(null)} className="font-semibold text-[#4f70e7]">Отмена</button>
              <button type="submit" className="font-semibold text-[#4f70e7]">Далее</button>
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
              <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
