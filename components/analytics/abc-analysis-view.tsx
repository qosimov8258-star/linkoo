"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import type { OrderItemWithOrder } from "@/lib/order-items-repo"

// Same defensive parser as sales-by-products-view: orderCreated is either an ISO date
// ("2026-08-02") or a Russian day+month string with no year ("06 сент. 14:23").
function parseOrderCreatedDate(value: string): Date | null {
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?/i)
  if (ru) {
    const monthNames = ["янв", "февр", "мар", "апр", "мая", "июня", "июля", "авг", "сент", "окт", "нояб", "дек"]
    const monthIndex = monthNames.indexOf(ru[2].toLowerCase())
    if (monthIndex >= 0) {
      const yearMatch = value.match(/(\d{4})/)
      const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
      const date = new Date(year, monthIndex, Number(ru[1]))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  return null
}

function isWithinRange(value: string, fromIso: string, toIso: string): boolean {
  const date = parseOrderCreatedDate(value)
  if (!date) return true
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T23:59:59`)
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime()
}

type AbcRow = { id: number; name: string; quantity: number; quantityPercent: number; sales: number; salesPercent: number; abcClass: "A" | "B" | "C" }

// Classic ABC classification: sort groups by revenue descending, then classify by
// cumulative share of total revenue (A up to 80%, B up to 95%, C beyond).
function buildAbcRows(items: OrderItemWithOrder[], groupBy: string): AbcRow[] {
  // Brand isn't captured on order items (only productName is) — no real data to group by.
  if (groupBy === "Бренд") return []
  const keyOf = groupBy === "Филиал" ? (item: OrderItemWithOrder) => item.orderZone || "Без зоны" : (item: OrderItemWithOrder) => item.productName || "—"

  const buckets = new Map<string, { quantity: number; sales: number }>()
  for (const item of items) {
    if (item.orderType === "Возврат") continue // ABC ranks by real sales; returns are excluded, not counted as negative sales
    const key = keyOf(item)
    const bucket = buckets.get(key) ?? { quantity: 0, sales: 0 }
    bucket.quantity += item.quantity
    bucket.sales += item.lineTotal
    buckets.set(key, bucket)
  }

  const totalQuantity = Array.from(buckets.values()).reduce((sum, b) => sum + b.quantity, 0)
  const totalSales = Array.from(buckets.values()).reduce((sum, b) => sum + b.sales, 0)
  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1].sales - a[1].sales)

  let cumulative = 0
  return sorted.map(([name, bucket], index) => {
    cumulative += bucket.sales
    const cumulativePercent = totalSales ? (cumulative / totalSales) * 100 : 0
    const abcClass: "A" | "B" | "C" = cumulativePercent <= 80 ? "A" : cumulativePercent <= 95 ? "B" : "C"
    return {
      id: index + 1,
      name,
      quantity: bucket.quantity,
      quantityPercent: totalQuantity ? (bucket.quantity / totalQuantity) * 100 : 0,
      sales: bucket.sales,
      salesPercent: totalSales ? (bucket.sales / totalSales) * 100 : 0,
      abcClass,
    }
  })
}

const productTypes = [
  `01, "OLIVIA" ТУАЛЕТНОЕ МЫЛО`,
  `02, "OLIVIA" ТВЕРДОЕ МЫЛО`,
  `03, "OLIVIA" ЖИДКОЕ МЫЛО`,
  `04, "OLIVIA" ШАМПУНЬ ДЛЯ ВОЛОС`,
  `06, "OLIVIA" "COTTON BUDS" ВАТНЫЕ ПАЛОЧКИ`,
]
const brands = ["Alpen Gold", "Aple", "Apple", "Aqua de lux", "arbuz privet", "asus vivobook"]
const branches = ["777", "878", "agent", "Andijon", "AURUM samarqand", "baby still"]
const orderUsers = ["05.08.2025 (1)", "Otaw Original3 Mardonov", "shohrux Avazhonov", "xodim1 1", "Suxrob Akramxodjaev", "Zaynillo Sadullayev"]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

export function AbcAnalysisView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [productType, setProductType] = useState("")
  const [brand, setBrand] = useState("")
  const [branch, setBranch] = useState("")
  const [orderUser, setOrderUser] = useState("")
  const [groupBy, setGroupBy] = useState("Продукт")
  const [, setApplied] = useState(0)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = dashboardOpen

  useEffect(() => {
    if (!overlayOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDashboardOpen(false)
      }
    }
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  const [items, setItems] = useState<OrderItemWithOrder[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState("")

  useEffect(() => {
    let cancelled = false
    setItemsLoading(true)
    fetch("/api/order-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as OrderItemWithOrder[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setItemsError("")
      })
      .catch(() => {
        if (!cancelled) setItemsError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // productType/brand/branch/orderUser filters below stay cosmetic: their option lists
  // are static mock values that don't correspond to real product/zone/agent names, and
  // brand isn't a field captured on order items at all. Only the date range and the
  // "Группировать по" dimension (Продукт → productName, Филиал → orderZone) reflect
  // real order_items data; "Бренд" grouping has no backing field and returns no rows.
  const rows = useMemo(() => {
    const dateFiltered = items.filter((item) => isWithinRange(item.orderCreated, from, to))
    return buildAbcRows(dateFiltered, groupBy)
  }, [items, from, to, groupBy])

  const totals = rows.reduce(
    (sum, row) => ({ quantity: sum.quantity + row.quantity, sales: sum.sales + row.sales }),
    { quantity: 0, sales: 0 },
  )

  function downloadCsv() {
    downloadExcelTable("abc-analysis.xls", [
      ["ИД", "Наименование", "Кол-во проданного товара", "Кол-во проданного товара в %", "Сумма продаж", "Сумма продаж в %", "Класс"],
      ...rows.map((row) => [row.id, row.name, row.quantity, row.quantityPercent.toFixed(1), row.sales, row.salesPercent.toFixed(1), row.abcClass]),
      ["", "Итого", totals.quantity, 100, totals.sales, 100, ""],
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title="ABC анализ" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} />
      <ReportBand>
        <ReportFilters onApply={() => from <= to && setApplied((value) => value + 1)} applyDisabled={from > to}>
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportSelectField label="Тип продукта" value={productType} onChange={setProductType} options={productTypes} />
          <ReportSelectField label="Бренд" value={brand} onChange={setBrand} options={brands} />
          <ReportSelectField label="Филиал" value={branch} onChange={setBranch} options={branches} />
          <ReportSelectField label="Заказ оформил" value={orderUser} onChange={setOrderUser} options={orderUsers} />
          <ReportChipField label="Группировать по" value={groupBy} options={["Продукт", "Бренд", "Филиал"]} onChange={setGroupBy} />
        </ReportFilters>
        {!itemsLoading && !itemsError && rows.length === 0 ? (
          <ReportEmpty />
        ) : (
        <div className="mt-3 overflow-x-auto border visits-scrollbar">
          <table className="min-w-[1250px] w-full border-collapse">
            <thead className="bg-slate-50"><tr><th className="border px-4 py-5 text-left">ИД</th><th className="min-w-[600px] border px-4 py-5 text-center">Наименование</th><th className="border px-4 py-5 text-center">Кол-во проданного товара</th><th className="border px-4 py-5 text-center">Кол-во проданного товара в %</th><th className="border px-4 py-5 text-center">Сумма продаж</th><th className="border px-4 py-5 text-center">Сумма продаж в %</th><th className="border px-4 py-5 text-center">Класс</th></tr></thead>
            <tbody>
              {itemsLoading ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-slate-400">Загрузка...</td></tr>
              ) : itemsError ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-red-600">{itemsError}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-slate-400">Нет данных за выбранный период</td></tr>
              ) : (
                <>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="border px-2 py-4">{row.id}</td>
                      <td className="border px-2 py-4">{row.name}</td>
                      <td className="border px-2 py-4 text-right">{row.quantity.toLocaleString("ru-RU")}</td>
                      <td className="border px-2 py-4 text-right">{row.quantityPercent.toFixed(1)}</td>
                      <td className="border px-2 py-4 text-right">{row.sales.toLocaleString("ru-RU")}</td>
                      <td className="border px-2 py-4 text-right">{row.salesPercent.toFixed(1)}</td>
                      <td className={`border px-2 py-4 ${row.abcClass === "A" ? "bg-[#94f56f]" : row.abcClass === "B" ? "bg-yellow-300" : "bg-red-300"}`}>{row.abcClass}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="border" />
                    <td className="border px-2 py-4">Итого</td>
                    <td className="border px-2 py-4 text-right">{totals.quantity.toLocaleString("ru-RU")}</td>
                    <td className="border px-2 py-4 text-right">100</td>
                    <td className="border px-2 py-4 text-right">{totals.sales.toLocaleString("ru-RU")}</td>
                    <td className="border px-2 py-4 text-right">100</td>
                    <td className="border" />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        )}
      </ReportBand>
      {overlayOpen && <button type="button" aria-label="Закрыть окно" onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && <DashboardDialog reportSlug="abc-analysis" reportLabel="ABC анализ" visibility={visibility} setVisibility={setVisibility} dashboard={dashboard} setDashboard={setDashboard} onClose={() => setDashboardOpen(false)} />}
    </ReportPage>
  )
}
