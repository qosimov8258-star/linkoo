"use client"

import { useEffect, useMemo, useState } from "react"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportGridTable, ReportPage, ReportSearchField, ReportSelectField } from "@/components/ref/report-kit"
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


export function ReorderLevelView() {
  const [rows, setRows] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [unit, setUnit] = useState<UnitType>("Количество")
  const [warehouse, setWarehouse] = useState("")
  const [organization, setOrganization] = useState("")
  const [productType, setProductType] = useState("")
  const [brand, setBrand] = useState("")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [{ dateFrom, dateTo }] = useState(() => {
    const months = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return {
      dateFrom: `01 ${months[start.getMonth()]} ${start.getFullYear()}`,
      dateTo: `${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`,
    }
  })

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

  const warehouses = [...new Set(rows.map((row) => row.warehouse))]
  const organizations = [...new Set(rows.map((row) => row.organization))]
  const productTypes = [...new Set(rows.map((row) => row.type))]
  const brands = [...new Set(rows.map((row) => row.brand))]

  const unitMultiplier = (row: ProductRow) => {
    if (unit === "Вес" && row.weightPerUnit) return row.weightPerUnit
    if (unit === "Блок") return 1 / 12
    return 1
  }

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !row.product.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (warehouse !== "" && row.warehouse !== warehouse) return false
      if (organization !== "" && row.organization !== organization) return false
      if (productType !== "" && row.type !== productType) return false
      if (brand !== "" && row.brand !== brand) return false
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

  const sortHead = (label: string, key: SortKey) => (
    <button type="button" onClick={() => toggleSort(key)} className={`w-full border-b-[3px] pb-[2px] font-semibold leading-4 ${sortKey === key ? "border-[#555]" : "border-transparent"}`}>{label}</button>
  )
  const pill = (className: string, text: string) => <div className={`-mx-[6px] -my-[6px] px-[6px] py-[6px] font-semibold text-white ${className}`}>{text}</div>

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Рекомендованный запас" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px]">
        <div className="relative flex h-[50px] items-center px-[30px]">
          <button onClick={() => setFilterOpen(true)} className="text-[13px] text-[#4f71dc]">Показать фильтр ⌄</button>
          <div className="ml-[160px]"><ReportSearchField value={search} onChange={setSearch} width={182} /></div>
          <span className="ml-auto mr-[12px] text-[13px] font-bold text-[#4f71dc]">{dateFrom} - {dateTo}</span>
          <div className="w-[200px]"><ReportSelectField label="Показать по типу ед." value={unit === "Количество" ? "" : unit} onChange={(value) => setUnit((value || "Количество") as UnitType)} options={["Количество", "Объем", "Вес", "Блок"]} clearable={false} /></div>
          <button onClick={downloadAll} className="ml-[94px] flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.download} /></svg>Скачать все</button>
        </div>

        <ReportGridTable
          minWidth={1750}
          loading={loading}
          colWidths={["300px", "", "", "", "", "", "", "", "", "", ""]}
          heads={["Товар", sortHead("Вес одной ед.", "weightPerUnit"), "Тип", "Бренд", sortHead("Продано", "sold"), sortHead("Доля от продаж (%)", "salesShare"), sortHead("Доступно", "available"), sortHead("Сред. дневные продажи", "avgDailySales"), sortHead("Запас дней", "stockDays"), sortHead("Рек. запас на 6 дней", "recommended6"), sortHead("Рек. запас на 30 дней", "recommended30")]}
          rows={sorted.map((row) => {
            const mult = unitMultiplier(row)
            const share = salesShare(row)
            const days = stockDays(row)
            return [
              row.product,
              number(row.weightPerUnit),
              row.type,
              row.brand === "No brand" ? "" : row.brand,
              number(row.sold * mult, mult !== 1 ? 3 : 0),
              pill(sharePillClass(share), `${number(share, 2, 2)} %`),
              number(row.available * mult, mult !== 1 ? 3 : 0),
              number(avgDailySales(row) * mult, 0, 3),
              pill(stockDaysPillClass(days), number(days)),
              row.recommended6,
              row.recommended30,
            ]
          })}
        />
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
          <ReportSelectField label="Склад" value={warehouse} onChange={setWarehouse} options={warehouses} />
          <ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={organizations} />
          <ReportSelectField label="Тип продукта" value={productType} onChange={setProductType} options={productTypes} />
          <ReportSelectField label="По брендам" value={brand} onChange={setBrand} options={brands} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
