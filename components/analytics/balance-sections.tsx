"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import * as echarts from "echarts"
import { useLanguage } from "@/lib/i18n/language-context"
import { MoreButton, ToggleButtons, formatAmount } from "@/components/analytics/widget-table-kit"
import type { PnlExpense, PnlRow, PnlStats } from "@/lib/pnl-stats-repo"

const CARD = "rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] overflow-hidden"
const COLORS = ["#00e096", "#0095ff", "#ff3d71", "#ffaa00", "#7a5af8", "#fd7e14", "#20c997", "#6f42c1"]
const CURRENCIES = ["SUM", "USD", "Euro"] as const
type Currency = (typeof CURRENCIES)[number]

export type BalanceRow = { name: string; start: number; end: number; currency: Currency }

const fmt = (value: number, digits = 3) => {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits
  return rounded.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/ /g, " ")
}

function SortArrows() {
  return (
    <svg viewBox="0 0 10 14" className="ml-[8px] inline h-[10px] w-[7px] fill-[#8a94a6]" aria-hidden>
      <path d="M5 0l4 5H1zM5 14L1 9h8z" />
    </svg>
  )
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mx-[30px] mt-[44px] mb-[10px] flex items-center justify-between">
      <h2 className="text-[20px] font-semibold text-[#333]">{children}</h2>
      {right}
    </div>
  )
}

function ChipGroup<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-[32px] px-[16px] text-[13px] font-medium uppercase shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-colors first:rounded-l-[3px] last:rounded-r-[3px] ${value === option ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function Donut({ rows, currency }: { rows: BalanceRow[]; currency: Currency }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  const total = rows.reduce((sum, row) => sum + row.end, 0)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const positive = rows.filter((row) => row.end > 0)
    chart.setOption({
      animation: false,
      series: [
        {
          type: "pie",
          radius: ["65%", "98%"],
          center: ["50%", "50%"],
          label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: 700, formatter: "{b}\n{d}%", textBorderColor: "#555", textBorderWidth: 2 },
          labelLine: { show: false },
          emptyCircleStyle: { color: "transparent" },
          itemStyle: { borderWidth: 0 },
          data: positive.map((row, index) => ({ name: row.name, value: row.end, itemStyle: { color: COLORS[index % COLORS.length] } })),
        },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      chart.dispose()
    }
  }, [rows])
  return (
    <div className="relative h-[350px]">
      <div ref={ref} className="absolute inset-[10px]" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[13px] font-semibold text-[#333]">{fmt(total)} {currency}</span>
        <span className="text-[10px] uppercase text-[#555]">{t("Баланс")}</span>
      </div>
    </div>
  )
}

function BalanceTable({ rows, label, currency }: { rows: BalanceRow[]; label: string; currency: Currency }) {
  const { t } = useLanguage()
  const [more, setMore] = useState(false)
  const [desc, setDesc] = useState<boolean | null>(null)
  const sorted = useMemo(() => (desc === null ? rows : [...rows].sort((a, b) => (desc ? b.end - a.end : a.end - b.end))), [rows, desc])
  const shown = more ? sorted : sorted.slice(0, 8)
  const toggle = () => setDesc((current) => (current === null ? true : !current))
  return (
    <div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
            <th className="px-[18px] font-semibold">{label}</th>
            <th className="px-[18px] font-semibold">{t("Баланс на начало")}<SortArrows /></th>
            <th className="cursor-pointer px-[18px] font-semibold" onClick={toggle}>{t("Баланс на конец")}<SortArrows /></th>
            <th className="px-[18px] font-semibold">{t("Разница")}<SortArrows /></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={`${row.name}-${index}`} className="h-[36px] border-b border-[#e8ecf1]">
              <td className="border-r border-[#e8ecf1] px-[18px]">{row.name}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.start)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.end)}</td>
              <td className="px-[18px] font-semibold">(0 %) 0 {currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 8 ? (
        <button type="button" onClick={() => setMore((value) => !value)} className="mx-[18px] my-[10px] flex h-[30px] w-[calc(100%-36px)] items-center justify-center gap-[6px] rounded-[15px] bg-[#eff3f7] text-[13px] text-[#4f71dc]">
          {more ? t("Скрыть") : t("Показать еще")} <ChevronDown className={`h-4 w-4 ${more ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <div className="h-[30px]" />
      )}
    </div>
  )
}

function DonutCard({ rows, currency, label }: { rows: BalanceRow[]; currency: Currency; label: string }) {
  return (
    <div className={CARD}>
      <Donut rows={rows} currency={currency} />
      <BalanceTable rows={rows} label={label} currency={currency} />
    </div>
  )
}

function DonutSection({ title, label, rows }: { title: string; label: string; rows: BalanceRow[] }) {
  const groups = CURRENCIES.map((currency) => ({ currency, rows: rows.filter((row) => row.currency === currency) })).filter((group) => group.rows.length > 0)
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="mx-[30px] grid grid-cols-1 items-start gap-[16px] lg:grid-cols-2">
        {groups.length === 0 ? (
          <DonutCard rows={[]} currency="SUM" label={label} />
        ) : (
          groups.map((group) => <DonutCard key={group.currency} rows={group.rows} currency={group.currency} label={label} />)
        )}
      </div>
    </>
  )
}

function PieChart({ rows, centerLabel, centerDigits = 0, labels = true, height = 250, tone, totalOverride }: { rows: { name: string; value: number }[]; centerLabel: string; centerDigits?: number; labels?: boolean; height?: number; tone?: string; totalOverride?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  const total = totalOverride ?? rows.reduce((sum, row) => sum + row.value, 0)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chart.setOption({
      animation: false,
      series: [
        {
          type: "pie",
          radius: ["62%", "96%"],
          label: { show: labels, position: "inside", color: "#fff", fontSize: 11, fontWeight: 700, formatter: (item: { name: string; percent?: number }) => ((item.percent ?? 0) >= 3 ? `${item.name}\n${(item.percent ?? 0).toFixed(1)}%` : (item.percent ?? 0) >= 1 ? `${(item.percent ?? 0).toFixed(1)}%` : ""), textBorderColor: "#555", textBorderWidth: 2 },
          labelLine: { show: false },
          emptyCircleStyle: { color: "transparent" },
          itemStyle: { borderWidth: 1, borderColor: "#fff" },
          data: rows.filter((row) => row.value > 0).map((row, index) => ({ name: row.name, value: row.value, itemStyle: { color: COLORS[index % COLORS.length] } })),
        },
      ],
      tooltip: { trigger: "item", formatter: "{b}: {d}%" },
    })
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      chart.dispose()
    }
  }, [rows])
  return (
    <div className="relative" style={{ height }}>
      <div ref={ref} className="absolute inset-[10px]" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={`text-[12px] font-bold ${tone ?? ""}`}>{fmt(total, centerDigits)}</span>
        <span className={`text-[10px] ${tone ? "uppercase" : "lowercase"} text-[#555]`}>{centerLabel || t("итого")}</span>
      </div>
    </div>
  )
}

function ExpenseCard({ title, rows }: { title: string; rows: PnlExpense[] }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const sorted = [...rows].sort((x, y) => y.first - x.first)
  const shown = expanded ? sorted : sorted.slice(0, 7)
  return (
    <div>
      <h2 className="mb-[10px] text-[20px] font-semibold text-[#333]">{title}</h2>
      <div className={CARD}>
        <PieChart rows={sorted.map((row) => ({ name: row.name, value: row.first }))} centerLabel={t("итого")} />
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
              <th className="px-[18px] font-semibold">{t("Категория")}</th>
              <th className="px-[18px] font-semibold">{t("Сумма (SUM)")}<SortArrows /></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className="h-[36px] border-b border-[#eee]">
                <td className="px-[18px]">{row.name}</td>
                <td className="px-[18px]">{fmt(row.first, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 7 ? <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} /> : <div className="h-[34px]" />}
      </div>
    </div>
  )
}

function usePnl(from?: string, to?: string): PnlStats | null {
  const [stats, setStats] = useState<PnlStats | null>(null)
  useEffect(() => {
    if (!from || !to) return
    let cancelled = false
    const query = new URLSearchParams({ first_begin: from, first_end: to, second_begin: from, second_end: to })
    fetch(`/api/pnl-stats?${query}`)
      .then((response) => (response.ok ? (response.json() as Promise<PnlStats>) : null))
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch(() => {
        if (!cancelled) setStats(null)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])
  return stats
}

function AgentsChart({ rows, mode }: { rows: PnlRow[]; mode: "profit" | "fact" }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const top = [...rows]
      .map((row) => ({ name: row.name, value: mode === "profit" ? row.first.profit : row.first.factSales }))
      .filter((row) => row.value !== 0)
      .sort((x, y) => y.value - x.value)
      .slice(0, 12)
    chart.setOption({
      animation: false,
      grid: { left: 90, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: "axis", valueFormatter: (value: number) => fmt(value, 0) },
      xAxis: { type: "category", data: top.map((row) => row.name), axisLabel: { interval: 0, rotate: 30, fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { formatter: (value: number) => fmt(value / 1_000_000, 0) + " " + t("млн") } },
      series: [{ type: "bar", data: top.map((row) => row.value), itemStyle: { color: "#0095ff" }, barMaxWidth: 36 }],
    })
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      chart.dispose()
    }
  }, [rows, mode, t])
  return <div ref={ref} className={`mx-[30px] h-[400px] ${CARD}`} />
}

type ClientRow = { type?: string; balance?: number | null }
type Supplier = { name: string }

const toCurrency = (value: string | undefined): Currency => (value === "USD" ? "USD" : value === "EUR" || value === "Euro" ? "Euro" : "SUM")

type CashboxReport = {
  rows: { key: string; name: string; info: Record<string, string | number | null>; currencies: Record<string, Record<string, number>> }[]
  totals: Record<string, Record<string, number>>
  visibleCurrencies: string[]
  currencies: { code: string; label: string }[]
}

/** Cashbox balances of the period from the shared finance ledger ("Касса"), one row per cashbox in its own currency. */
function useCashbox(from?: string, to?: string) {
  const [report, setReport] = useState<CashboxReport | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ pageSize: "1000" })
    if (from) query.set("from", from)
    if (to) query.set("to", to)
    fetch(`/api/balances/cashbox?${query}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as CashboxReport) : null))
      .then((data) => setReport(data))
      .catch(() => {})
    return () => controller.abort()
  }, [from, to])
  return report
}

export function useCashRows(): BalanceRow[] {
  const report = useCashbox()
  return (report?.rows ?? []).map((row) => {
    const code = String(row.info.currency ?? "SUM")
    const amounts = row.currencies[code]
    return { name: row.name, start: amounts?.begin_balance ?? 0, end: amounts?.end_balance ?? 0, currency: toCurrency(code) }
  })
}

const WIDGET_HEAD = "bg-[#f0f4f9] text-left text-[13px] font-semibold text-[#374557]"
const COLLAPSED_ROWS = 8

export function CashOverview({ from, to }: { from?: string; to?: string }) {
  const { t } = useLanguage()
  const report = useCashbox(from, to)
  const [expanded, setExpanded] = useState(false)
  const rows = report?.rows ?? []
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const codes = [...(report?.visibleCurrencies ?? ["SUM"])].sort()
  const labelOf = (code: string) => report?.currencies.find((currency) => currency.code === code)?.label ?? code
  const summary = (field: string) => codes.map((code) => `${formatAmount(report?.totals[code]?.[field] ?? 0)}\u00a0${labelOf(code)}`).join(", ")

  const strip = [
    { label: t("Баланс на начало периода"), tone: "text-[#0d99ff]", field: "begin_balance" },
    { label: t("Приход за период"), tone: "text-[#8acb8d]", field: "income" },
    { label: t("Расход за период"), tone: "text-[#e57373]", field: "expenses" },
    { label: t("Перевод в кассу"), tone: "text-[#8acb8d]", field: "transfer_income" },
    { label: t("Перевод с кассы"), tone: "text-[#e57373]", field: "transfer_expense" },
    { label: t("Баланс на конец периода"), tone: "text-[#0d99ff]", field: "end_balance" },
  ]
  const widths = [205.2, 175.7, 178.9, 174.3, 165, 167.3, 167.8, 205.8]

  return (
    <section className={`mx-[30px] ${CARD}`}>
      <div className="grid grid-cols-6">
        {strip.map((cell) => (
          <div key={cell.field} className="flex min-h-[102.5px] flex-col items-center px-[15px] pt-[15px] text-center">
            <div className={`text-[15px] font-semibold leading-[18.75px] ${cell.tone}`}>{summary(cell.field)}</div>
            <div className="text-[13px] leading-[18px] text-[#666]">{cell.label}</div>
          </div>
        ))}
      </div>
      <table className="w-full table-fixed border-collapse text-[13px] text-[#333]">
        <colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${(width / 1440) * 100}%` }} />)}</colgroup>
        <thead>
          <tr className={`h-[35.6px] ${WIDGET_HEAD}`}>
            <th className="px-[17.5px] font-semibold">{t("Кассы")}</th>
            {[t("Баланс на начало"), t("Приход за период"), t("Расход за период"), t("Перевод в кассу"), t("Перевод с кассы"), t("Баланс на конец"), t("Разница")].map((label) => (
              <th key={label} className="border-l border-white px-[17.5px] font-semibold">{label}{label !== t("Разница") && <SortArrows />}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const code = String(row.info.currency ?? "SUM")
            const amounts = row.currencies[code] ?? {}
            const difference = (amounts.end_balance ?? 0) - (amounts.begin_balance ?? 0)
            const percent = amounts.begin_balance ? (difference / Math.abs(amounts.begin_balance)) * 100 : 0
            return (
              <tr key={row.key} className="h-[36.1px] border-b border-[#eee]">
                <td className="border-r border-[#eee] px-[17.5px]">{row.name}</td>
                {["begin_balance", "income", "expenses", "transfer_income", "transfer_expense", "end_balance"].map((field) => (
                  <td key={field} className="border-r border-[#eee] px-[17.5px]">{formatAmount(amounts[field] ?? 0)}</td>
                ))}
                <td className="px-[17.5px] font-semibold"><span className="flex justify-between"><span>{formatAmount(Math.round(percent * 10) / 10)} %</span><span>{formatAmount(difference)} {labelOf(code)}</span></span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > COLLAPSED_ROWS && <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />}
      <div className="h-[10px]" />
    </section>
  )
}

export function WarehouseOverview() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<{ id: number; name: string }[]>([])
  const [expanded, setExpanded] = useState(false)
  const [priceMode, setPriceMode] = useState<"cost" | "price">("cost")
  const [view, setView] = useState<"text" | "chart">("text")
  const [metric, setMetric] = useState<"qty" | "sum">("sum")
  useEffect(() => {
    let cancelled = false
    fetch("/api/warehouses")
      .then(async (response) => (response.ok ? ((await response.json()) as { id: number; name: string }[]) : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setRows(data.map((row) => ({ id: row.id, name: row.name })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const widths = [254.3, 312.5, 310.9, 201.8]
  return (
    <>
      <div className="mx-[30px] mt-[16px] flex items-center justify-between">
        <ToggleButtons tone="blue" value={priceMode} onChange={setPriceMode} options={[{ value: "cost", label: t("Себестоимость") }, { value: "price", label: t("Прайс лист") }] as const} />
        <div className="flex gap-[10px]">
          <ToggleButtons tone="green" value={view} onChange={setView} options={[{ value: "text", label: t("Текст") }, { value: "chart", label: t("График") }] as const} />
          <ToggleButtons tone="green" value={metric} onChange={setMetric} options={[{ value: "qty", label: t("Кол-во") }, { value: "sum", label: t("Сумма") }] as const} />
        </div>
      </div>
      <section className={`mx-[30px] mt-[20px] grid grid-cols-1 lg:grid-cols-[360px_1fr] ${CARD}`}>
        <div className="relative h-[300px] lg:h-auto">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[16px] font-bold leading-5 text-[#333]">0 SUM</span>
            <span className="mt-[2px] text-[10px] font-semibold leading-[13.25px] text-[#675c5c]">{t("Сумма на складе")}<br />{t("На конец периода")}</span>
          </div>
        </div>
        <div>
          <table className="w-full table-fixed border-collapse text-[13px] text-[#333]">
            <colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${(width / 1080) * 100}%` }} />)}</colgroup>
            <thead>
              <tr className={`h-[35.6px] ${WIDGET_HEAD}`}>
                <th className="px-[17.5px] font-semibold">{t("Склад")}</th>
                {[t("Баланс на начало"), t("Баланс на конец"), t("Разница")].map((label) => (
                  <th key={label} className="border-l border-white px-[17.5px] font-semibold">{label}{label !== t("Разница") && <SortArrows />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="h-[36.1px] border-b border-[#eee]">
                  <td className="border-r border-[#eee] px-[17.5px]">{row.name}</td>
                  <td className="border-r border-[#eee] px-[17.5px]">0 SUM</td>
                  <td className="border-r border-[#eee] px-[17.5px]">0 SUM</td>
                  <td className="px-[17.5px] font-semibold">( 0 % ) 0 SUM</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > COLLAPSED_ROWS && <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />}
        </div>
      </section>
      <div className="h-[10px]" />
    </>
  )
}

export function BalanceSections({ from, to }: { from?: string; to?: string }) {
  const { t } = useLanguage()
  const pnl = usePnl(from, to)
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [categoryExpanded, setCategoryExpanded] = useState(false)
  const [agentMode, setAgentMode] = useState<"profit" | "fact">("profit")
  const cashRows = useCashRows()
  const categoryRows = ((categoryMode === "type" ? pnl?.productTypes : pnl?.brands) ?? []).filter((row) => row.first.sales !== 0 || row.first.returns !== 0).sort((x, y) => y.first.sales - x.first.sales)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async <T,>(url: string, set: (data: T[]) => void) => {
      try {
        const response = await fetch(url)
        if (!response.ok) return
        const data = (await response.json()) as T[]
        if (!cancelled && Array.isArray(data)) set(data)
      } catch {
        // keep the empty state when the API is unreachable
      }
    }
    void load<ClientRow>("/api/clients", setClients)
    void load<Supplier>("/api/suppliers", setSuppliers)
    return () => {
      cancelled = true
    }
  }, [])

  const clientRows: BalanceRow[] = useMemo(() => {
    const byType = new Map<string, number>()
    for (const client of clients) {
      const key = client.type || t("Не указано")
      byType.set(key, (byType.get(key) ?? 0) + Number(client.balance ?? 0))
    }
    return [...byType.entries()].map(([name, balance]) => ({ name, start: balance, end: balance, currency: "SUM" as Currency }))
  }, [clients, t])
  const supplierRows: BalanceRow[] = suppliers.map((supplier) => ({ name: supplier.name, start: 0, end: 0, currency: "SUM" }))

  return (
    <>
      <div className="mx-[30px] mt-[44px] grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <ExpenseCard title={t("Прямые расходы")} rows={pnl?.directExpenses ?? []} />
        <ExpenseCard title={t("Косвенные расходы")} rows={pnl?.indirectExpenses ?? []} />
      </div>

      <SectionTitle right={<ChipGroup options={[t("ТИП ПРОДУКТА"), t("БРЕНД")] as const} value={categoryMode === "type" ? t("ТИП ПРОДУКТА") : t("БРЕНД")} onChange={(value) => setCategoryMode(value === t("ТИП ПРОДУКТА") ? "type" : "brand")} />}>
        {t("Реализация по категориям")}
      </SectionTitle>
      <section className={`mx-[30px] ${CARD}`}>
        <div className="grid grid-cols-4">
          {[
            [t("Реализация"), "sales", pnl?.summary.sales.first ?? 0, ""],
            [t("Возвраты"), "returns", pnl?.summary.returns.first ?? 0, ""],
            [t("Чистая реализация"), "factSales", (pnl?.summary.sales.first ?? 0) - (pnl?.summary.returns.first ?? 0), ""],
            [t("Валовая прибыль"), "profit", pnl?.summary.salesProfit.first ?? 0, "text-[#43a047]"],
          ].map(([label, field, value, tone]) => (
            <PieChart
              key={label as string}
              rows={categoryRows.map((row) => ({ name: row.name, value: Math.max(0, row.first[field as "sales"]) }))}
              centerLabel={label as string}
              centerDigits={3}
              height={280}
              tone={tone as string}
              totalOverride={value as number}
            />
          ))}
        </div>
        <table className="w-full table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
              <th className="px-[18px] font-semibold">{t("Название")}</th>
              {[t("Реализация"), t("Возвраты"), t("Чистая реализация"), t("Валовая прибыль"), t("Рентабельность ВП")].map((label) => (
                <th key={label} className="px-[18px] font-semibold">{label}<SortArrows /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(categoryExpanded ? categoryRows : categoryRows.slice(0, 8)).map((row) => (
              <tr key={row.name} className="h-[36px] border-b border-[#eee]">
                <td className="px-[18px]">{row.name}</td>
                <td className="px-[18px]">{fmt(row.first.sales)}</td>
                <td className="px-[18px]">{fmt(row.first.returns)}</td>
                <td className="px-[18px]">{fmt(row.first.factSales)}</td>
                <td className={`px-[18px] font-semibold ${row.first.profit > 0 ? "text-[#81c784]" : row.first.profit < 0 ? "text-[#e57373]" : ""}`}>{fmt(row.first.profit)}</td>
                <td className="px-[18px]">{fmt(row.first.rentability, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {categoryRows.length > 8 && <MoreButton expanded={categoryExpanded} onToggle={() => setCategoryExpanded((value) => !value)} />}
        {categoryRows.length === 0 && (
          <div className="flex flex-col items-center py-[16px]">
            <Image src="/robot-empty.png" alt="" width={96} height={96} className="h-[96px] w-[96px] object-contain" />
            <p className="mt-[6px] text-[13px] text-[#555]">{t("Нет данных")}</p>
          </div>
        )}
        <div className="h-[30px] border-t border-[#e8ecf1]" />
      </section>

      <SectionTitle right={<ChipGroup options={[t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ"), t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")] as const} value={agentMode === "profit" ? t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") : t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")} onChange={(value) => setAgentMode(value === t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") ? "profit" : "fact")} />}>
        {t("Прибыль от агентов")}
      </SectionTitle>
      <AgentsChart rows={pnl?.agents ?? []} mode={agentMode} />

      <CashOverview from={from} to={to} />

      <DonutSection title={t("Долги клиентов")} label={t("Тип магазина")} rows={clientRows} />
      <DonutSection title={t("Обязательства перед поставщиками")} label={t("Поставщик")} rows={supplierRows} />
      <DonutSection title={t("Касса")} label={t("Касса")} rows={cashRows} />
      <div className="h-[40px]" />
    </>
  )
}
