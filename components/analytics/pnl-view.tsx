"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage, ReportRangeField, ReportSelectField, WidgetHeader } from "@/components/ref/report-kit"
import type { OrderItemWithOrder } from "@/lib/order-items-repo"

const tabs = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"] as const
const tabHref: Partial<Record<(typeof tabs)[number], string>> = {
  "ВИДЖЕТЫ": "/",
  "ОХВАТ": "/analytics/coverage-analysis",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/client-debts",
  "ГИБКИЙ ДАШБОРД": "/analytics/flexible-dashboard",
  "ФИЛИАЛ": "/analytics/branch-tab",
  "ПРОДАЖА": "/analytics/sales-tab",
  "KPI": "/analytics/kpi-performance",
  "БАЛАНС": "/analytics/balance-tab",
}

const metricTabs = ["РЕАЛИЗАЦИЯ", "ВОЗВРАТЫ", "ЧИСТАЯ РЕАЛИЗАЦИЯ", "ВАЛОВАЯ ПРИБЫЛЬ", "РЕНТАБЕЛЬНОСТЬ ВП"] as const
const sortModes = ["УБЫВАЮЩИЕ", "ВОЗРАСТАЮЩИЕ", "ВСЕ"] as const
type Metric = (typeof metricTabs)[number]

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Same tolerant parsing as the other order reports: ISO date or "06 сент. 14:23" (no year).
function orderDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?/i)
  if (!ru) return null
  const names = ["янв", "февр", "мар", "апр", "мая", "июня", "июля", "авг", "сент", "окт", "нояб", "дек"]
  const month = names.indexOf(ru[2].toLowerCase())
  if (month < 0) return null
  const year = value.match(/(\d{4})/)
  return toIso(new Date(year ? Number(year[1]) : new Date().getFullYear(), month, Number(ru[1])))
}

type Totals = { realization: number; returns: number; cost: number; returnCost: number }
const emptyTotals = (): Totals => ({ realization: 0, returns: 0, cost: 0, returnCost: 0 })
const metricValue = (totals: Totals, metric: Metric) => {
  const net = totals.realization - totals.returns
  const profit = net - (totals.cost - totals.returnCost)
  if (metric === "РЕАЛИЗАЦИЯ") return totals.realization
  if (metric === "ВОЗВРАТЫ") return totals.returns
  if (metric === "ЧИСТАЯ РЕАЛИЗАЦИЯ") return net
  if (metric === "ВАЛОВАЯ ПРИБЫЛЬ") return profit
  return net ? Math.round((profit / net) * 1000) / 10 : 0
}

function DiffCell({ first, second, plain }: { first: number; second: number; plain?: boolean }) {
  const diff = second - first
  const percent = first ? Math.round((diff / Math.abs(first)) * 100) : 0
  const tone = plain || diff === 0 ? "" : diff < 0 ? "bg-[#e57373] text-white" : "bg-[#8fcf8f] text-white"
  return (
    <div className={`flex h-full items-center justify-between px-[6px] font-semibold ${tone}`}>
      <span>{percent} %</span>
      <span>{number(diff)}</span>
    </div>
  )
}

function CompareTable({ title, rows, className = "" }: { title: string; rows: { name: string; first: number; second: number }[]; className?: string }) {
  const firstTotal = rows.reduce((sum, row) => sum + row.first, 0)
  const secondTotal = rows.reduce((sum, row) => sum + row.second, 0)
  return (
    <div className={`min-h-[140px] bg-white pb-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${className}`}>
      <div className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center bg-[#f2f5f8] px-[6px] text-[13px] font-semibold">
        <span>{title}</span><span>Первый период ⇅</span><span>Второй период ⇅</span><span>Разница ⇅</span>
      </div>
      {rows.map((row) => (
        <div key={row.name} className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px]">
          <span className="px-[6px]">{row.name}</span><span className="border-l border-[#ececec] px-[6px]">{number(row.first)}</span><span className="border-l border-[#ececec] px-[6px]">{number(row.second)}</span><DiffCell first={row.first} second={row.second} />
        </div>
      ))}
      {rows.length > 0 && (
        <div className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px] font-bold">
          <span className="px-[6px]">Итого</span><span className="border-l border-[#ececec] px-[6px]">{number(firstTotal)}</span><span className="border-l border-[#ececec] px-[6px]">{number(secondTotal)}</span><DiffCell first={firstTotal} second={secondTotal} />
        </div>
      )}
    </div>
  )
}

export function PnLView() {
  const router = useRouter()
  const today = useMemo(() => new Date(), [])
  const [firstFrom, setFirstFrom] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth() - 1, 1)))
  const [firstTo, setFirstTo] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), 28))))
  const [secondFrom, setSecondFrom] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [secondTo, setSecondTo] = useState(() => toIso(today))
  const [applied, setApplied] = useState({ firstFrom, firstTo, secondFrom, secondTo })

  const [branch, setBranch] = useState("")
  const [zone, setZone] = useState("")
  const [supervisor, setSupervisor] = useState("")
  const [agent, setAgent] = useState("")
  const [productType, setProductType] = useState("")
  const [product, setProduct] = useState("")
  const [metric, setMetric] = useState<Metric>("РЕАЛИЗАЦИЯ")
  const [sortMode, setSortMode] = useState<(typeof sortModes)[number]>("ВСЕ")
  const [items, setItems] = useState<OrderItemWithOrder[]>([])

  useEffect(() => {
    let cancelled = false
    fetch("/api/order-items")
      .then((response) => (response.ok ? (response.json() as Promise<OrderItemWithOrder[]>) : []))
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const agents = useMemo(() => Array.from(new Set(items.map((item) => item.orderAgent).filter(Boolean))), [items])
  const zones = useMemo(() => Array.from(new Set(items.map((item) => item.orderZone).filter(Boolean))), [items])
  const products = useMemo(() => Array.from(new Set(items.map((item) => item.productName).filter(Boolean))), [items])

  // Aggregates real order lines for both periods, grouped by one dimension.
  const group = (keyOf: (item: OrderItemWithOrder) => string) => {
    const map = new Map<string, { first: Totals; second: Totals }>()
    for (const item of items) {
      if (agent && item.orderAgent !== agent) continue
      if (zone && item.orderZone !== zone) continue
      if (product && item.productName !== product) continue
      const date = orderDate(item.orderCreated)
      if (!date) continue
      const slot = date >= applied.firstFrom && date <= applied.firstTo ? "first" : date >= applied.secondFrom && date <= applied.secondTo ? "second" : null
      if (!slot) continue
      const key = keyOf(item) || "Не указано"
      const entry = map.get(key) ?? { first: emptyTotals(), second: emptyTotals() }
      const totals = entry[slot]
      if (item.orderType === "Возврат") {
        totals.returns += item.lineTotal
        totals.returnCost += item.lineCost
      } else {
        totals.realization += item.lineTotal
        totals.cost += item.lineCost
      }
      map.set(key, entry)
    }
    const rows = Array.from(map.entries()).map(([name, entry]) => ({ name, first: metricValue(entry.first, metric), second: metricValue(entry.second, metric) }))
    if (sortMode === "ВСЕ") return rows
    return rows.sort((a, b) => (sortMode === "УБЫВАЮЩИЕ" ? b.second - a.second : a.second - b.second))
  }

  const byAgent = group((item) => item.orderAgent)
  const byZone = group((item) => item.orderZone)
  const byProduct = group((item) => item.productName)

  const lines = useMemo(() => {
    const sum = (slot: "first" | "second", pick: (totals: Totals) => number) => {
      const total = emptyTotals()
      for (const item of items) {
        if (agent && item.orderAgent !== agent) continue
        if (zone && item.orderZone !== zone) continue
        if (product && item.productName !== product) continue
        const date = orderDate(item.orderCreated)
        if (!date) continue
        const range = slot === "first" ? [applied.firstFrom, applied.firstTo] : [applied.secondFrom, applied.secondTo]
        if (date < range[0] || date > range[1]) continue
        if (item.orderType === "Возврат") {
          total.returns += item.lineTotal
          total.returnCost += item.lineCost
        } else {
          total.realization += item.lineTotal
          total.cost += item.lineCost
        }
      }
      return pick(total)
    }
    const row = (name: string, pick: (totals: Totals) => number) => ({ name, first: sum("first", pick), second: sum("second", pick) })
    return [
      row("Реализовано", (t) => t.realization),
      row("Себестоимость реализованной продукции", (t) => t.cost),
      row("Возвраты", (t) => t.returns),
      row("Себестоимость возвратов", (t) => t.returnCost),
      row("Валовая прибыль", (t) => t.realization - t.returns - (t.cost - t.returnCost)),
      row("Рентабельность ВП", (t) => metricValue(t, "РЕНТАБЕЛЬНОСТЬ ВП")),
    ]
  }, [items, applied, agent, zone, product])

  const card = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

  return (
    <ReportPage>
      <WidgetHeader active="P&L" />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ firstFrom, firstTo, secondFrom, secondTo })
        }}
        className={`mx-7 px-[20px] pb-[22px] pt-[10px] ${card}`}
      >
        <h2 className="text-[14px] leading-[18px] text-[#666]">Фильтр</h2>
        <div className="mt-[4px] grid gap-x-[10px] gap-y-[13px] md:grid-cols-2 xl:grid-cols-4">
          <ReportRangeField label="Первый период" from={firstFrom} to={firstTo} onFrom={setFirstFrom} onTo={setFirstTo} />
          <ReportRangeField label="Второй период" from={secondFrom} to={secondTo} onFrom={setSecondFrom} onTo={setSecondTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={["Самарканд", "Бухоро", "Ташкент", "Наманган", "Фарғона"]} clearable={false} />
          <ReportSelectField label="Зона" value={zone} onChange={setZone} options={zones} clearable={false} />
          <ReportSelectField label="Супервайзер" value={supervisor} onChange={setSupervisor} options={[]} clearable={false} />
          <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={agents} clearable={false} />
          <ReportSelectField label="Тип товара" value={productType} onChange={setProductType} options={[]} clearable={false} />
          <ReportSelectField label="Товар" value={product} onChange={setProduct} options={products} clearable={false} />
        </div>
        <button type="submit" className="mt-[12px] h-9 rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110">Применить</button>
      </form>

      <section className="mx-7 mt-[20px] flex flex-wrap items-center">
        <div className="flex">
          {metricTabs.map((tab, index) => (
            <button key={tab} onClick={() => setMetric(tab)} className={`h-[30px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === metricTabs.length - 1 ? "rounded-r-[3px]" : ""} ${metric === tab ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{tab}</button>
          ))}
        </div>
        <div className="ml-auto flex">
          {sortModes.map((mode, index) => (
            <button key={mode} onClick={() => setSortMode(mode)} className={`h-[30px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === sortModes.length - 1 ? "rounded-r-[3px]" : ""} ${sortMode === mode ? "border-[#2bcd53] bg-[#2bcd53] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{mode}</button>
          ))}
        </div>
      </section>

      <section className="mx-7 mt-[20px] grid gap-[17px] pb-8 lg:grid-cols-2">
        <div className="space-y-[30px]">
          <CompareTable title="Филиал" rows={[]} />
          <div className={`pb-[6px] ${card}`}>
            <div className="grid h-[36px] grid-cols-[1.6fr_1fr_1fr_1.3fr] items-center bg-[#f2f5f8] px-[6px] text-[13px] font-semibold"><span>Наименование</span><span>Первый период</span><span>Второй период</span><span>Разница</span></div>
            {lines.map((line, index) => (
              <div key={line.name} className="grid min-h-[36px] grid-cols-[1.6fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px]">
                <span className="px-[6px] py-[6px]">{line.name}</span>
                <span className="border-l border-[#ececec] px-[6px]">{number(line.first)}</span>
                <span className="border-l border-[#ececec] px-[6px]">{number(line.second)}</span>
                <DiffCell first={line.first} second={line.second} plain={index === 2 || index === 3} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-[30px]">
          <CompareTable title="Агент" rows={byAgent} />
          <CompareTable title="Тип продукта" rows={[]} />
          <CompareTable title="Бренд" rows={byProduct.slice(0, 0)} />
          <CompareTable title="Зона" rows={byZone} />
        </div>
      </section>
    </ReportPage>
  )
}
