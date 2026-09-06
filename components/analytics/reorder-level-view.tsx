"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Download, Filter, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import type { Product } from "@/components/analytics/products-data"
import { downloadExcelTable } from "@/lib/excel-export"

type UnitType = "Количество" | "Объем" | "Вес" | "Блок"

type ProductRow = {
  id: number
  product: string
  weightPerUnit: number
  type: string
  brand: string
  // NOTE (real-data gap): recommending a reorder quantity needs both live
  // on-hand stock and a sales-velocity figure. Neither exists yet for this
  // report — there is no per-product on-hand ledger anywhere in the schema
  // (see stock-level-view.tsx), and aggregating "units sold" from orders
  // here would duplicate the sales-report work another agent owns
  // (abc-analysis / sales-by-products views) using the same order data. So
  // these five fields are honestly 0 for every row rather than fabricated —
  // only the real product identity fields below are wired.
  sold: number
  available: number
  stockDaysValue: number
  recommended6: number
  recommended30: number
  warehouse: string
  organization: string
}

function parseWeight(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

function productToRow(product: Product): ProductRow {
  return {
    id: product.id,
    product: product.name,
    weightPerUnit: parseWeight(product.netWeight) || parseWeight(product.weight),
    type: product.type || "Не указано",
    brand: product.brand || "No brand",
    sold: 0,
    available: 0,
    stockDaysValue: 0,
    recommended6: 0,
    recommended30: 0,
    // No real per-product warehouse link exists; the warehouse filter below
    // stays in the UI but has nothing real to filter on yet.
    warehouse: "Не указано",
    organization: product.organization || "Не указано",
  }
}

type SortKey = "weightPerUnit" | "sold" | "salesShare" | "available" | "avgDailySales" | "stockDays" | "recommended6" | "recommended30"
type SortDir = "asc" | "desc"

const number = (value: number, fraction = 0, maxFraction = 3) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: maxFraction }).format(value)

// `sold` is currently always 0 for every row (see the real-data-gap note
// above), so the sales-share percentage is always 0 too.
const salesShare = (_row: ProductRow) => 0
const stockDays = (row: ProductRow) => row.stockDaysValue
const avgDailySales = (row: ProductRow) => (row.stockDaysValue ? row.available / row.stockDaysValue : 0)

function sharePillClass(value: number) {
  if (value >= 10) return "bg-[#3aa76d]"
  if (value >= 1) return "bg-[#e0952e]"
  return "bg-[#e5484d]"
}

function stockDaysPillClass(value: number) {
  if (value >= 14) return "bg-[#3aa76d]"
  if (value >= 7) return "bg-[#e0952e]"
  return "bg-[#e5484d]"
}

function SortableHeader({ label, sortKey, active, onSort, className = "" }: { label: string; sortKey: SortKey; active: boolean; onSort: (key: SortKey) => void; className?: string }) {
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(sortKey) } }}
      className={`cursor-pointer select-none border-b-2 px-4 py-4 text-left font-semibold ${active ? "border-[#253653]" : "border-transparent"} hover:bg-[#e4eaf3] ${className}`}
    >
      {label}
    </th>
  )
}

export function ReorderLevelView() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [unitOpen, setUnitOpen] = useState(false)
  const [unit, setUnit] = useState<UnitType>("Количество")
  const [warehouse, setWarehouse] = useState("Все склады")
  const [organization, setOrganization] = useState("Все организации")
  const [productType, setProductType] = useState("Все типы")
  const [brand, setBrand] = useState("Все бренды")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [dateFrom] = useState("01 Июня 2026")
  const [dateTo] = useState("31 Авг. 2026")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/products")
      .then(async (response) => (response.ok ? ((await response.json()) as Product[]) : []))
      .then((products) => {
        if (!cancelled) setRows(products.filter((product) => !product.deleted).map(productToRow))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const warehouses = ["Все склады", ...new Set(rows.map((row) => row.warehouse))]
  const organizations = ["Все организации", ...new Set(rows.map((row) => row.organization))]
  const productTypes = ["Все типы", ...new Set(rows.map((row) => row.type))]
  const brands = ["Все бренды", ...new Set(rows.map((row) => row.brand))]

  const unitMultiplier = (row: ProductRow) => {
    if (unit === "Вес" && row.weightPerUnit) return row.weightPerUnit
    if (unit === "Блок") return 1 / 12
    return 1
  }

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !row.product.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (warehouse !== "Все склады" && row.warehouse !== warehouse) return false
      if (organization !== "Все организации" && row.organization !== organization) return false
      if (productType !== "Все типы" && row.type !== productType) return false
      if (brand !== "Все бренды" && row.brand !== brand) return false
      return true
    })
  }, [brand, organization, productType, search, warehouse])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const key = sortKey
    const copy = [...filtered]
    copy.sort((a, b) => {
      const valueOf = (row: ProductRow) => {
        if (key === "salesShare") return salesShare(row)
        if (key === "stockDays") return stockDays(row)
        if (key === "avgDailySales") return avgDailySales(row)
        return row[key]
      }
      const result = valueOf(a) - valueOf(b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [filtered, sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const downloadAll = () => {
    const header = ["Товар", "Вес одной ед.", "Тип", "Бренд", "Продано", "Доля от продаж (%)", "Доступно", "Сред. дневные продажи", "Запас дней", "Рек. запас на 6 дней", "Рек. запас на 30 дней"]
    const body = sorted.map((row) => {
      const mult = unitMultiplier(row)
      return [
        row.product,
        row.weightPerUnit,
        row.type,
        row.brand,
        number(row.sold * mult, mult !== 1 ? 3 : 0),
        number(salesShare(row), 2, 2),
        number(row.available * mult, mult !== 1 ? 3 : 0),
        number(avgDailySales(row) * mult, 0, 3),
        number(stockDays(row)),
        row.recommended6,
        row.recommended30,
      ]
    })
    downloadExcelTable("recommended-stock.xls", [header, ...body])
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Рекомендованный запас</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          <Filter className="h-4 w-4" /> Показать фильтр <ChevronDown className="h-4 w-4" />
        </button>

        <label className="relative min-w-[220px] border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <span className="font-semibold text-[#4f70e7]">{dateFrom} - {dateTo}</span>

        <div className="relative">
          <button onClick={() => setUnitOpen((value) => !value)} className="flex h-11 w-56 items-center justify-between rounded-sm border border-[#dbe0e8] px-4 text-[15px] font-medium text-[#17233b]">
            Показать по типу ед. <ChevronDown className={`h-4 w-4 transition ${unitOpen ? "rotate-180" : ""}`} />
          </button>
          {unitOpen && (
            <div className="absolute left-0 top-12 z-20 w-56 rounded-sm bg-white py-1 shadow-xl">
              {(["Количество", "Объем", "Вес", "Блок"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => { setUnit(option); setUnitOpen(false) }}
                  className={`block w-full px-4 py-2.5 text-left text-[15px] ${unit === option ? "bg-[#eaf0fd] text-[#4f70e7]" : "text-[#586174] hover:bg-slate-50"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={downloadAll} className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white">
          <Download className="h-5 w-5" /> Скачать все
        </button>
      </section>

      <section className="overflow-x-auto">
        <table className="min-w-[1750px] w-full border-collapse text-[15px]">
          <thead className="bg-white text-[#17233b]">
            <tr>
              <th className="border-b-2 border-transparent px-4 py-4 text-left font-semibold">Товар</th>
              <SortableHeader label="Вес одной ед." sortKey="weightPerUnit" active={sortKey === "weightPerUnit"} onSort={toggleSort} />
              <th className="border-b-2 border-transparent px-4 py-4 text-left font-semibold">Тип</th>
              <th className="border-b-2 border-transparent px-4 py-4 text-left font-semibold">Бренд</th>
              <SortableHeader label="Продано" sortKey="sold" active={sortKey === "sold"} onSort={toggleSort} />
              <SortableHeader label="Доля от продаж (%)" sortKey="salesShare" active={sortKey === "salesShare"} onSort={toggleSort} />
              <SortableHeader label="Доступно" sortKey="available" active={sortKey === "available"} onSort={toggleSort} />
              <SortableHeader label="Сред. дневные продажи" sortKey="avgDailySales" active={sortKey === "avgDailySales"} onSort={toggleSort} />
              <SortableHeader label="Запас дней" sortKey="stockDays" active={sortKey === "stockDays"} onSort={toggleSort} />
              <SortableHeader label="Рек. запас на 6 дней" sortKey="recommended6" active={sortKey === "recommended6"} onSort={toggleSort} />
              <SortableHeader label="Рек. запас на 30 дней" sortKey="recommended30" active={sortKey === "recommended30"} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const mult = unitMultiplier(row)
              const share = salesShare(row)
              const days = stockDays(row)
              return (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.product}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.weightPerUnit)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.type}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.brand === "No brand" ? "" : row.brand}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.sold * mult, mult !== 1 ? 3 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] p-0">
                    <div className={`px-4 py-3.5 font-semibold text-white ${sharePillClass(share)}`}>{number(share, 2, 2)} %</div>
                  </td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.available * mult, mult !== 1 ? 3 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(avgDailySales(row) * mult, 0, 3)}</td>
                  <td className="border-t border-[#e1e5eb] p-0">
                    <div className={`px-4 py-3.5 font-semibold text-white ${stockDaysPillClass(days)}`}>{number(days)}</div>
                  </td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.recommended6}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.recommended30}</td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={11} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">{loading ? "Загрузка..." : "Ничего не найдено"}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-24" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[380px] rounded-md bg-white p-7 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </div>
            {(
              [
                ["Склад", warehouse, setWarehouse, warehouses],
                ["Организация", organization, setOrganization, organizations],
                ["Тип продукта", productType, setProductType, productTypes],
                ["По брендам", brand, setBrand, brands],
              ] as const
            ).map(([label, value, setter, options]) => (
              <label key={label} className="relative mb-8 block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                {label}
                <select value={value} onChange={(event) => setter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                  {options.map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
              </label>
            ))}
            <button onClick={() => setFilterOpen(false)} className="rounded-sm bg-[#586174] px-6 py-3 font-bold uppercase tracking-wide text-white">Применить</button>
          </div>
        </div>
      )}
    </main>
  )
}
