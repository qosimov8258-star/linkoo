"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Calendar, ChevronDown, ChevronsUpDown, Download } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

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

type MetricKey = "realization" | "returns" | "netRealization" | "grossProfit" | "profitability"
const metricKeyByTab: Record<(typeof metricTabs)[number], MetricKey> = {
  "РЕАЛИЗАЦИЯ": "realization",
  "ВОЗВРАТЫ": "returns",
  "ЧИСТАЯ РЕАЛИЗАЦИЯ": "netRealization",
  "ВАЛОВАЯ ПРИБЫЛЬ": "grossProfit",
  "РЕНТАБЕЛЬНОСТЬ ВП": "profitability",
}

type PnlRow = { id: number; name: string; realization: number; returns: number; grossProfit: number }

const typeRows: PnlRow[] = []

const brandRows: PnlRow[] = []

const number = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toInputDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function formatLongDate(date: Date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function Field({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium text-[#586174]">
      {label}
      <select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal text-[#17233b] outline-none">
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
    </label>
  )
}

function SortableHeader({ label, metricKey, active, onSort }: { label: string; metricKey: MetricKey; active: boolean; onSort: (key: MetricKey) => void }) {
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(metricKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(metricKey) } }}
      className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-semibold ${active ? "text-[#4f71dc]" : "text-[#586174]"} hover:text-[#4f71dc]`}
    >
      <span className="inline-flex items-center gap-1.5">{label}<ChevronsUpDown className="h-3.5 w-3.5" /></span>
    </th>
  )
}

export function PnLView() {
  const router = useRouter()

  const today = useMemo(() => new Date(), [])
  const prevPeriodEnd = useMemo(() => { const d = new Date(today); d.setMonth(d.getMonth() - 1); return d }, [today])
  const prevPeriodStart = useMemo(() => { const d = new Date(prevPeriodEnd); d.setDate(d.getDate() - 2); return d }, [prevPeriodEnd])
  const currentPeriodStart = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 2); return d }, [today])

  const [firstFrom, setFirstFrom] = useState(() => toInputDate(prevPeriodStart))
  const [firstTo, setFirstTo] = useState(() => toInputDate(prevPeriodEnd))
  const [secondFrom, setSecondFrom] = useState(() => toInputDate(currentPeriodStart))
  const [secondTo, setSecondTo] = useState(() => toInputDate(today))
  const [appliedFirst, setAppliedFirst] = useState(() => `${formatLongDate(prevPeriodStart)} - ${formatLongDate(prevPeriodEnd)}`)
  const [appliedSecond, setAppliedSecond] = useState(() => `${formatLongDate(currentPeriodStart)} - ${formatLongDate(today)}`)

  const [branch, setBranch] = useState("Все филиалы")
  const [zone, setZone] = useState("Все зоны")
  const [supervisor, setSupervisor] = useState("Все супервайзеры")
  const [agent, setAgent] = useState("Все агенты")
  const [productType, setProductType] = useState("Все типы товара")
  const [product, setProduct] = useState("Все товары")

  const [metricTab, setMetricTab] = useState<(typeof metricTabs)[number]>("РЕАЛИЗАЦИЯ")
  const [sortMode, setSortMode] = useState<(typeof sortModes)[number]>("ВСЕ")
  const [groupBy, setGroupBy] = useState<"type" | "brand">("type")

  const applyFilter = () => {
    setAppliedFirst(`${formatLongDate(new Date(firstFrom))} - ${formatLongDate(new Date(firstTo))}`)
    setAppliedSecond(`${formatLongDate(new Date(secondFrom))} - ${formatLongDate(new Date(secondTo))}`)
  }

  const sourceRows = groupBy === "type" ? typeRows : brandRows

  const filtered = useMemo(() => {
    return sourceRows.filter((row) => {
      if (groupBy === "type" && productType !== "Все типы товара" && row.name !== productType) return false
      if (groupBy === "brand" && product !== "Все товары" && row.name !== product) return false
      return true
    })
  }, [groupBy, product, productType, sourceRows])

  const rows = useMemo(() => {
    return filtered.map((row) => {
      const netRealization = row.realization - row.returns
      const profitability = netRealization ? (row.grossProfit / netRealization) * 100 : 0
      return { ...row, netRealization, profitability }
    })
  }, [filtered])

  const sortKey = metricKeyByTab[metricTab]
  const sorted = useMemo(() => {
    if (sortMode === "ВСЕ") return rows
    const copy = [...rows]
    copy.sort((a, b) => (sortMode === "УБЫВАЮЩИЕ" ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
    return copy
  }, [rows, sortKey, sortMode])

  const totals = rows.reduce(
    (acc, row) => ({ realization: acc.realization + row.realization, returns: acc.returns + row.returns, netRealization: acc.netRealization + row.netRealization, grossProfit: acc.grossProfit + row.grossProfit }),
    { realization: 0, returns: 0, netRealization: 0, grossProfit: 0 },
  )
  const totalProfitability = totals.netRealization ? (totals.grossProfit / totals.netRealization) * 100 : 0

  const sortColumn = (key: MetricKey) => {
    const tabForKey = (Object.keys(metricKeyByTab) as (typeof metricTabs)[number][]).find((tab) => metricKeyByTab[tab] === key)
    if (tabForKey) setMetricTab(tabForKey)
    setSortMode((current) => (sortKey === key && current === "УБЫВАЮЩИЕ" ? "ВОЗРАСТАЮЩИЕ" : "УБЫВАЮЩИЕ"))
  }

  const downloadAll = () => {
    const header = ["Название", "Реализация", "Возвраты", "Чистая реализация", "Валовая прибыль", "Рентабельность ВП (%)"]
    const body = sorted.map((row) => [row.name, row.realization, row.returns, row.netRealization, row.grossProfit, row.profitability.toFixed(1)])
    downloadExcelTable("pnl.xls", [header, ...body])
  }

  return (
    <main className="min-h-screen bg-[#f2f5f8] text-[#17233b]">
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
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "P&L" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <section className="m-6 rounded-md bg-white p-7 shadow-sm md:mx-9">
        <h2 className="mb-6 text-lg font-semibold text-[#586174]">Фильтр</h2>
        <div className="grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-[15px] font-medium text-[#586174]">
              <span>Первый период</span>
              <Calendar className="h-4 w-4 text-[#9aa3b6]" />
            </div>
            <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
              <input type="date" value={firstFrom} onChange={(event) => setFirstFrom(event.target.value)} className="w-full bg-transparent outline-none" />
              <span className="text-[#9aa3b6]">—</span>
              <input type="date" value={firstTo} onChange={(event) => setFirstTo(event.target.value)} className="w-full bg-transparent outline-none" />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[15px] font-medium text-[#586174]">
              <span>Второй период</span>
              <Calendar className="h-4 w-4 text-[#9aa3b6]" />
            </div>
            <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
              <input type="date" value={secondFrom} onChange={(event) => setSecondFrom(event.target.value)} className="w-full bg-transparent outline-none" />
              <span className="text-[#9aa3b6]">—</span>
              <input type="date" value={secondTo} onChange={(event) => setSecondTo(event.target.value)} className="w-full bg-transparent outline-none" />
            </div>
          </div>
          <Field label="Филиалы" value={branch} setValue={setBranch} options={["Все филиалы", "Самарканд", "Бухоро", "Ташкент", "Наманган", "Фарғона"]} />
          <Field label="Зона" value={zone} setValue={setZone} options={["Все зоны", "Розничный", "Рабочий", "Не рабочий зона"]} />
          <Field label="Супервайзер" value={supervisor} setValue={setSupervisor} options={["Все супервайзеры"]} />
          <Field label="Агент" value={agent} setValue={setAgent} options={["Все агенты"]} />
          <Field label="Тип товара" value={productType} setValue={setProductType} options={["Все типы товара", ...typeRows.map((row) => row.name)]} />
          <Field label="Товар" value={product} setValue={setProduct} options={["Все товары", ...brandRows.map((row) => row.name)]} />
        </div>
        <button onClick={applyFilter} className="mt-7 rounded-sm bg-[#586174] px-8 py-3 text-[13px] font-bold uppercase tracking-wide text-white hover:bg-[#48505f]">
          Применить
        </button>
      </section>

      <section className="mx-6 mb-6 flex flex-wrap items-center gap-2 rounded-md bg-white p-4 shadow-sm md:mx-9">
        <div className="flex flex-wrap gap-2">
          {metricTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setMetricTab(tab)}
              className={`rounded-sm px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${metricTab === tab ? "bg-[#4f71dc] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {sortModes.map((mode) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`rounded-sm px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${sortMode === mode ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#586174]">Реализация по категориям</h2>
            <p className="mt-1 text-[13px] text-[#9aa3b6]">Первый период: {appliedFirst} · Второй период: {appliedSecond}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded-sm">
              <button
                onClick={() => setGroupBy("type")}
                className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${groupBy === "type" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}
              >
                Тип продукта
              </button>
              <button
                onClick={() => setGroupBy("brand")}
                className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${groupBy === "brand" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}
              >
                Бренд
              </button>
            </div>
            <button onClick={downloadAll} aria-label="Скачать" className="text-[#586174] hover:text-[#17233b]"><Download className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center">
            <p className="text-2xl font-bold text-[#17233b]">{number(totals.realization)}</p>
            <p className="mt-1 text-[13px] text-[#586174]">Реализация</p>
          </div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center">
            <p className="text-2xl font-bold text-[#e5484d]">{number(totals.returns)}</p>
            <p className="mt-1 text-[13px] text-[#586174]">Возвраты</p>
          </div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center">
            <p className="text-2xl font-bold text-[#17233b]">{number(totals.netRealization)}</p>
            <p className="mt-1 text-[13px] text-[#586174]">Чистая реализация</p>
          </div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center">
            <p className="text-2xl font-bold text-[#3aa76d]">{number(totals.grossProfit)}</p>
            <p className="mt-1 text-[13px] text-[#586174]">Валовая прибыль</p>
          </div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center">
            <p className="text-2xl font-bold text-[#3aa76d]">{totalProfitability.toFixed(1)} %</p>
            <p className="mt-1 text-[13px] text-[#586174]">Рентабельность ВП</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-[14px]">
            <thead className="border-b border-[#e1e5eb] bg-[#f6f9fc]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-[#586174]">Название</th>
                <SortableHeader label="Реализация" metricKey="realization" active={sortKey === "realization"} onSort={sortColumn} />
                <SortableHeader label="Возвраты" metricKey="returns" active={sortKey === "returns"} onSort={sortColumn} />
                <SortableHeader label="Чистая реализация" metricKey="netRealization" active={sortKey === "netRealization"} onSort={sortColumn} />
                <SortableHeader label="Валовая прибыль" metricKey="grossProfit" active={sortKey === "grossProfit"} onSort={sortColumn} />
                <SortableHeader label="Рентабельность ВП" metricKey="profitability" active={sortKey === "profitability"} onSort={sortColumn} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.realization)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#e5484d]">{number(row.returns)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.netRealization)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#3aa76d]">{number(row.grossProfit)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#3aa76d]">{row.profitability.toFixed(1)} %</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">По вашему запросу ничего не найдено</td></tr>
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#dbe0e8] bg-[#edf2f7] font-semibold">
                  <td className="px-4 py-3.5">Итого</td>
                  <td className="px-4 py-3.5">{number(totals.realization)}</td>
                  <td className="px-4 py-3.5 text-[#e5484d]">{number(totals.returns)}</td>
                  <td className="px-4 py-3.5">{number(totals.netRealization)}</td>
                  <td className="px-4 py-3.5 text-[#3aa76d]">{number(totals.grossProfit)}</td>
                  <td className="px-4 py-3.5 text-[#3aa76d]">{totalProfitability.toFixed(1)} %</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </main>
  )
}
