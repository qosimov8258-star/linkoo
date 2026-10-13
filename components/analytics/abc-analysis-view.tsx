"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Download, PlusCircle } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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
  "Все типы продуктов",
  `01, "OLIVIA" ТУАЛЕТНОЕ МЫЛО`,
  `02, "OLIVIA" ТВЕРДОЕ МЫЛО`,
  `03, "OLIVIA" ЖИДКОЕ МЫЛО`,
  `04, "OLIVIA" ШАМПУНЬ ДЛЯ ВОЛОС`,
  `06, "OLIVIA" "COTTON BUDS" ВАТНЫЕ ПАЛОЧКИ`,
]
const brands = ["Все бренды", "Alpen Gold", "Aple", "Apple", "Aqua de lux", "arbuz privet", "asus vivobook"]
const branches = ["Все филиалы", "777", "878", "agent", "Andijon", "AURUM samarqand", "baby still"]
const orderUsers = ["Все сотрудники", "05.08.2025 (1)", "Otaw Original3 Mardonov", "shohrux Avazhonov", "xodim1 1", "Suxrob Akramxodjaev", "Zaynillo Sadullayev"]

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
  const [productType, setProductType] = useState(productTypes[0])
  const [brand, setBrand] = useState(brands[0])
  const [branch, setBranch] = useState(branches[0])
  const [orderUser, setOrderUser] = useState(orderUsers[0])
  const [groupBy, setGroupBy] = useState("Продукт")
  const [applied, setApplied] = useState(0)
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

  function apply(event: FormEvent) {
    event.preventDefault()
    if (from <= to) setApplied((value) => value + 1)
  }

  function downloadCsv() {
    downloadExcelTable("abc-analysis.xls", [
      ["ИД", "Наименование", "Кол-во проданного товара", "Кол-во проданного товара в %", "Сумма продаж", "Сумма продаж в %", "Класс"],
      ...rows.map((row) => [row.id, row.name, row.quantity, row.quantityPercent.toFixed(1), row.sales, row.salesPercent.toFixed(1), row.abcClass]),
      ["", "Итого", totals.quantity, 100, totals.sales, 100, ""],
    ])
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span><h1 className="text-slate-600">ABC анализ</h1>
        </div>
        <div className="flex gap-4"><button type="button" onClick={downloadCsv} className="rounded-md bg-[#71ce87] px-5 py-2.5 font-bold text-white"><Download className="mr-2 inline h-5 w-5" />Скачать Excel</button><button type="button" onClick={() => setDashboardOpen(true)} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white"><PlusCircle className="mr-2 inline h-5 w-5" />Добавить в дашборд</button></div>
      </header>
      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className="grid gap-x-5 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs">Дата создания от<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-0 border-b py-2 text-base" /></label>
            <label className="text-xs">Дата создания до<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-0 border-b py-2 text-base" /></label>
            <SelectFilter label="Тип продукта" value={productType} setValue={setProductType} options={productTypes} />
            <SelectFilter label="Бренд" value={brand} setValue={setBrand} options={brands} />
            <SelectFilter label="Филиал" value={branch} setValue={setBranch} options={branches} />
            <SelectFilter label="Заказ оформил" value={orderUser} setValue={setOrderUser} options={orderUsers} />
            <SelectFilter label="Группировать по" value={groupBy} setValue={setGroupBy} options={["Продукт", "Бренд", "Филиал"]} />
          </div>
          <button type="submit" disabled={from > to} className="mt-3 w-full rounded-md bg-[#71ce87] py-3 font-bold text-white disabled:opacity-50">Применить</button>
        </form>
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
      </section>
      {overlayOpen && <button type="button" aria-label="Закрыть окно" onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && <DashboardDialog reportSlug="abc-analysis" reportLabel="ABC анализ" visibility={visibility} setVisibility={setVisibility} dashboard={dashboard} setDashboard={setDashboard} onClose={() => setDashboardOpen(false)} />}
    </main>
  )
}

function SelectFilter({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  return <label className="text-xs">{label}<select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full border-0 border-b bg-white py-2 text-base font-semibold">{options.map((option, index) => <option key={`${option}-${index}`}>{option}</option>)}</select></label>
}
