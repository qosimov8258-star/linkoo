"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Download } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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

type Money = { sum: number; usd: number }
type Branch = { id: number; name: string; opening: Money }

const branches: Branch[] = []

const FIXED_TOTALS = { sum: 0, usd: 0 }
const groups = ["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Оплата", "Прочие приходы", "Прочие расходы", "Баланс на конец"] as const

type WarehouseRow = { id: number; name: string; balance: number; sharePercent: number }
const warehouses: WarehouseRow[] = []
const WAREHOUSE_TOTAL = 0
const DONUT_COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16"]

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toInputDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function BranchTabView() {
  const router = useRouter()
  const [chartMode, setChartMode] = useState<"type" | "brand">("type")
  const [sortKey, setSortKey] = useState<"opening" | "closing" | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [warehouseTab, setWarehouseTab] = useState<"cost" | "priceList">("cost")
  const [warehouseDisplay, setWarehouseDisplay] = useState<"text" | "chart">("text")
  const [warehouseMetric, setWarehouseMetric] = useState<"qty" | "sum">("sum")
  const [warehouseSort, setWarehouseSort] = useState<{ key: "balance"; dir: "asc" | "desc" } | null>(null)

  const today = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])
  const [rangeFrom] = useState(() => toInputDate(monthStart))
  const [rangeTo] = useState(() => toInputDate(today))

  const sortedBranches = useMemo(() => {
    if (!sortKey) return branches
    const copy = [...branches]
    copy.sort((a, b) => {
      const result = a.opening.sum - b.opening.sum
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [sortDir, sortKey])

  const toggleSort = (key: "opening" | "closing") => {
    if (sortKey === key) setSortDir((value) => (value === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const sortedWarehouses = useMemo(() => {
    if (!warehouseSort) return warehouses
    const copy = [...warehouses]
    copy.sort((a, b) => (warehouseSort.dir === "asc" ? a.balance - b.balance : b.balance - a.balance))
    return copy
  }, [warehouseSort])

  const gradientStops = useMemo(() => {
    return warehouses.reduce<{ acc: number; parts: string[] }>(
      (state, row, index) => {
        const start = state.acc
        const end = start + row.sharePercent
        return { acc: end, parts: [...state.parts, `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start}% ${end}%`] }
      },
      { acc: 0, parts: [] },
    ).parts
  }, [])

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-xl font-bold text-[#4f71dc]" /><span className="text-2xl font-light text-[#586174]">|</span>
          <span className="text-xl font-bold text-[#586174]">Виджеты</span>
        </div>
        <nav className="ml-auto flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "ФИЛИАЛ" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 text-white">A</span>
          Admin Ritm <small className="text-slate-400">Сервер: (https://time3.linko.uz)</small>
        </div>
        <strong className="ml-auto text-[#5470e8]">{rangeFrom.split("-").reverse().join(".")} - {rangeTo.split("-").reverse().join(".")}</strong>
      </section>

      <section className="mx-6 mb-6 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex h-64 items-end justify-center border-b border-l border-[#e1e5eb] text-[#9aa3b6]">
          <span>Нет данных за выбранный период</span>
        </div>
        <div className="flex overflow-hidden rounded-sm">
          <button onClick={() => setChartMode("type")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${chartMode === "type" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>Тип продукта</button>
          <button onClick={() => setChartMode("brand")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${chartMode === "brand" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>Бренд</button>
        </div>
      </section>

      <section className="mx-6 mb-6 grid grid-cols-1 gap-6 rounded-md bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-4 md:mx-9">
        <div>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM, <AmountCell value={FIXED_TOTALS.usd} /> USD</p>
          <p className="text-[#586174]">Баланс на начало периода</p>
        </div>
        <div>
          <p className="font-semibold">0 SUM, 0 USD</p>
          <p className="text-[#586174]">Передача на склад</p>
        </div>
        <div>
          <p className="font-semibold">0 SUM, 0 USD</p>
          <p className="text-[#586174]">Принятие оплаты</p>
        </div>
        <div>
          <p className="font-semibold">0 SUM, 0 USD</p>
          <p className="text-[#586174]">Прочие приходы</p>
        </div>
        <div>
          <p className="font-semibold">0 SUM, 0 USD</p>
          <p className="text-[#586174]">Возврат передачи</p>
        </div>
        <div>
          <p className="font-semibold">0 SUM, 0 USD</p>
          <p className="text-[#586174]">Прочие расходы</p>
        </div>
        <div className="lg:col-start-4">
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM, <AmountCell value={FIXED_TOTALS.usd} /> USD</p>
          <p className="text-[#586174]">Баланс на конец</p>
        </div>
      </section>

      <section className="mx-6 mb-6 overflow-x-auto rounded-md bg-white shadow-sm md:mx-9">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-white text-[#253653]">
              <th className="border border-[#e1e5eb] px-4 py-2" />
              {groups.map((group) => (
                <th key={group} colSpan={2} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
              ))}
            </tr>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Филиал</th>
              {groups.map((group) =>
                ["SUM", "USD"].map((currency) => (
                  <th
                    key={`${group}-${currency}`}
                    onClick={() => (group === "Баланс на начало периода" ? toggleSort("opening") : group === "Баланс на конец" ? toggleSort("closing") : undefined)}
                    className={`cursor-pointer select-none border-b border-[#e1e5eb] px-4 py-2 font-semibold hover:bg-[#f6f9fc] ${(group === "Баланс на начало периода" && sortKey === "opening") || (group === "Баланс на конец" && sortKey === "closing") ? "text-[#4f71dc]" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">{currency}<ChevronDown className="h-3 w-3" /></span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {sortedBranches.slice(0, 7).map((branch, index) => (
              <tr key={branch.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5">{branch.name}</td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
                {Array.from({ length: 10 }).map((_, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                ))}
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-center py-3"><span className="text-[#586174]">Показано {Math.min(sortedBranches.length, 7)} из {sortedBranches.length} филиалов</span></div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-6 flex overflow-hidden rounded-sm">
          <button onClick={() => setWarehouseTab("cost")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "cost" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>Себестоимость</button>
          <button onClick={() => setWarehouseTab("priceList")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "priceList" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>Прайс лист</button>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          <div className="mx-auto flex h-[300px] w-[300px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${gradientStops.join(", ")})` }}>
            <div className="flex h-[210px] w-[210px] flex-col items-center justify-center rounded-full bg-white text-center">
              <strong className="text-lg">{money(warehouseTab === "cost" ? WAREHOUSE_TOTAL : WAREHOUSE_TOTAL * 1.18)} SUM</strong>
              <span className="mt-1 text-[13px] uppercase text-[#9aa3b6]">Сумма на складе<br />на конец периода</span>
            </div>
          </div>

          <div>
            <table className="w-full border-collapse text-[14px]">
              <thead className="bg-[#f6f9fc] text-[#586174]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Склад</th>
                  <th className="px-4 py-3 text-left font-semibold">Баланс на начало</th>
                  <th onClick={() => setWarehouseSort((current) => ({ key: "balance", dir: current?.dir === "asc" ? "desc" : "asc" }))} className="cursor-pointer px-4 py-3 text-left font-semibold hover:text-[#4f71dc]">
                    <span className="inline-flex items-center gap-1">Баланс на конец<ChevronDown className="h-3.5 w-3.5" /></span>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold">Разница</th>
                </tr>
              </thead>
              <tbody>
                {sortedWarehouses.map((row, index) => (
                  <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                    <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
                    <td className="border-t border-[#e1e5eb] px-4 py-3.5">{money(warehouseTab === "cost" ? row.balance : row.balance * 1.18)} SUM</td>
                    <td className="border-t border-[#e1e5eb] px-4 py-3.5">{money(warehouseTab === "cost" ? row.balance : row.balance * 1.18)} SUM</td>
                    <td className="border-t border-[#e1e5eb] px-4 py-3.5">(0 %) 0 SUM</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex overflow-hidden rounded-sm">
            <button onClick={() => setWarehouseDisplay("text")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "text" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Текст</button>
            <button onClick={() => setWarehouseDisplay("chart")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "chart" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>График</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-sm">
              <button onClick={() => setWarehouseMetric("qty")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseMetric === "qty" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Кол-во</button>
              <button onClick={() => setWarehouseMetric("sum")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseMetric === "sum" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Сумма</button>
            </div>
            <button
              type="button"
              aria-label="Скачать"
              onClick={() =>
                downloadExcelTable("branch-warehouse-balance.xls", [
                  ["Склад", "Баланс на начало", "Баланс на конец", "Разница"],
                  ...sortedWarehouses.map((row) => {
                    const balance = money(warehouseTab === "cost" ? row.balance : row.balance * 1.18)
                    return [row.name, `${balance} SUM`, `${balance} SUM`, "(0 %) 0 SUM"]
                  }),
                ])
              }
              className="text-[#586174] hover:text-[#17233b]"
            >
              <Download className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
