"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import * as echarts from "echarts"
import { MoreButton, ToggleButtons, formatAmount } from "@/components/analytics/widget-table-kit"
import { currencyLabel } from "@/lib/finance/currency"
import { monthEndIso, monthStartIso } from "@/lib/finance/dates"
import type { BalanceOverview } from "@/lib/finance/overview-types"
import { pnlMetrics, type PnlGroupRow } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Sections of the dashboard tabs "БАЛАНС" / "ФИЛИАЛ", all fed by
// GET /api/balances/overview (lib/finance/overview.ts): expenses by category,
// sales by product type / brand and by agent (P&L), cashboxes (Баланс кассы),
// stock per warehouse, client debts by client type and supplier obligations.
// A section rendered without `data` loads the period itself (`from`/`to`, else the current month).

const CARD = "rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] overflow-hidden"
const COLORS = ["#00e096", "#0095ff", "#ff3d71", "#ffaa00", "#7a5af8", "#fd7e14", "#20c997", "#6f42c1"]

export type BalanceRow = { name: string; start: number; end: number; currency: string }

const fmt = (value: number, digits = 3) => {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits
  return rounded.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/ /g, " ")
}
/** GET /api/balances/overview?from&to[&organization] (null url = do not fetch). */
export function useBalanceOverview(query: { from: string; to: string; organization?: string } | null): { data: BalanceOverview | null; loading: boolean; error: string } {
  const [data, setData] = useState<BalanceOverview | null>(null)
  const [loading, setLoading] = useState(Boolean(query))
  const [error, setError] = useState("")
  const url = query ? `/api/balances/overview?${new URLSearchParams({ from: query.from, to: query.to, ...(query.organization ? { organization: query.organization } : {}) }).toString()}` : null
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (BalanceOverview & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url])
  return { data, loading, error }
}

/** The data passed by the page, or the period (`from`/`to`, default the current month) loaded by the section itself. */
function useSectionData(data: BalanceOverview | null | undefined, range?: { from?: string; to?: string }): BalanceOverview | null {
  const own = useBalanceOverview(data === undefined ? { from: range?.from || monthStartIso(), to: range?.to || monthEndIso() } : null)
  return data === undefined ? own.data : data
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

function Donut({ rows, currency }: { rows: BalanceRow[]; currency: string }) {
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
        <span className="text-[13px] font-semibold text-[#333]">{fmt(total)} {currencyLabel(currency)}</span>
        <span className="text-[10px] uppercase text-[#555]">{t("Баланс")}</span>
      </div>
    </div>
  )
}

function DiffValue({ start, end, currency }: { start: number; end: number; currency: string }) {
  const diff = end - start
  const percent = start ? Math.round((diff / Math.abs(start)) * 100) : 0
  const tone = diff > 0 ? "text-[#3aa76d]" : diff < 0 ? "text-[#e5484d]" : ""
  return (
    <span className={`font-semibold ${tone}`}>
      ({percent} %) {fmt(diff)} {currencyLabel(currency)}
    </span>
  )
}

function BalanceTable({ rows, label, currency }: { rows: BalanceRow[]; label: string; currency: string }) {
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
            <tr key={`${row.name}|${row.currency}|${index}`} className="h-[36px] border-b border-[#e8ecf1]">
              <td className="border-r border-[#e8ecf1] px-[18px]">{t(row.name)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.start)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.end)}</td>
              <td className="px-[18px]"><DiffValue start={row.start} end={row.end} currency={currency} /></td>
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

function DonutCard({ rows, currency, label }: { rows: BalanceRow[]; currency: string; label: string }) {
  return (
    <div className={CARD}>
      <Donut rows={rows} currency={currency} />
      <BalanceTable rows={rows} label={label} currency={currency} />
    </div>
  )
}

function DonutSection({ title, label, rows, base }: { title: string; label: string; rows: BalanceRow[]; base: string }) {
  const currencies = [...new Set(rows.map((row) => row.currency))]
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="mx-[30px] grid grid-cols-1 items-start gap-[16px] lg:grid-cols-2">
        {currencies.length === 0 ? (
          <DonutCard rows={[]} currency={base} label={label} />
        ) : (
          currencies.map((currency) => <DonutCard key={currency} rows={rows.filter((row) => row.currency === currency)} currency={currency} label={label} />)
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

function ExpenseCard({ title, rows, currency }: { title: string; rows: Array<{ name: string; amount: number }>; currency: string }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const sorted = [...rows].sort((x, y) => y.amount - x.amount)
  const shown = expanded ? sorted : sorted.slice(0, 7)
  return (
    <div>
      <h2 className="mb-[10px] text-[20px] font-semibold text-[#333]">{title}</h2>
      <div className={CARD}>
        <PieChart rows={sorted.map((row) => ({ name: t(row.name), value: row.amount }))} centerLabel={t("итого")} />
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
              <th className="px-[18px] font-semibold">{t("Категория")}</th>
              <th className="px-[18px] font-semibold">{t("Сумма")} ({currencyLabel(currency)})<SortArrows /></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.name} className="h-[36px] border-b border-[#eee]">
                <td className="px-[18px]">{t(row.name)}</td>
                <td className="px-[18px]">{fmt(row.amount, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 7 ? <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} /> : <div className="h-[34px]" />}
      </div>
    </div>
  )
}

type AgentValue = { name: string; value: number }

function AgentsChart({ rows }: { rows: AgentValue[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const top = [...rows]
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
  }, [rows, t])
  return <div ref={ref} className={`mx-[30px] h-[400px] ${CARD}`} />
}

type CategoryRow = { name: string; sales: number; returns: number; factSales: number; profit: number; rentability: number }

const categoryRowOf = (row: PnlGroupRow): CategoryRow => {
  const period = row.periods[0]
  const { net, profit, margin } = pnlMetrics(period)
  return { name: row.name, sales: period.realization, returns: period.returns, factSales: net, profit, rentability: margin }
}

const WIDGET_HEAD = "bg-[#f0f4f9] text-left text-[13px] font-semibold text-[#374557]"
const COLLAPSED_ROWS = 8

/** Cashboxes of the period: strip of totals per currency + one row per cashbox. */
export function CashOverview({ data: given, from, to }: { data?: BalanceOverview | null; from?: string; to?: string } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given, { from, to })
  const [expanded, setExpanded] = useState(false)
  const rows = useMemo(() => data?.cashboxes ?? [], [data])
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const codes = [...new Set(rows.map((row) => row.currency))].sort()
  const visibleCodes = codes.length ? codes : [data?.baseCurrency ?? "SUM"]
  const total = (field: "begin" | "income" | "expenses" | "transferIncome" | "transferExpense" | "end", code: string) =>
    rows.filter((row) => row.currency === code).reduce((sum, row) => sum + row[field], 0)
  const summary = (field: "begin" | "income" | "expenses" | "transferIncome" | "transferExpense" | "end") =>
    visibleCodes.map((code) => `${formatAmount(total(field, code))}\u00a0${currencyLabel(code)}`).join(", ")

  const strip = [
    { label: t("Баланс на начало периода"), tone: "text-[#0d99ff]", field: "begin" },
    { label: t("Приход за период"), tone: "text-[#8acb8d]", field: "income" },
    { label: t("Расход за период"), tone: "text-[#e57373]", field: "expenses" },
    { label: t("Перевод в кассу"), tone: "text-[#8acb8d]", field: "transferIncome" },
    { label: t("Перевод с кассы"), tone: "text-[#e57373]", field: "transferExpense" },
    { label: t("Баланс на конец периода"), tone: "text-[#0d99ff]", field: "end" },
  ] as const
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
            const difference = row.end - row.begin
            const percent = row.begin ? (difference / Math.abs(row.begin)) * 100 : 0
            return (
              <tr key={`${row.id}|${row.name}`} className="h-[36.1px] border-b border-[#eee]">
                <td className="border-r border-[#eee] px-[17.5px]">{row.name}</td>
                {[row.begin, row.income, row.expenses, row.transferIncome, row.transferExpense, row.end].map((value, index) => (
                  <td key={index} className="border-r border-[#eee] px-[17.5px]">{formatAmount(value)}</td>
                ))}
                <td className="px-[17.5px] font-semibold"><span className="flex justify-between"><span>{formatAmount(Math.round(percent * 10) / 10)} %</span><span>{formatAmount(difference)} {currencyLabel(row.currency)}</span></span></td>
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

/** Stock value per warehouse at cost (the one cost of goods), begin / end of the period. */
export function WarehouseOverview({ data: given, from, to }: { data?: BalanceOverview | null; from?: string; to?: string } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given, { from, to })
  const base = data?.baseCurrency ?? "SUM"
  const rows = data?.warehouses ?? []
  const [expanded, setExpanded] = useState(false)
  const [priceMode, setPriceMode] = useState<"cost" | "price">("cost")
  const [view, setView] = useState<"text" | "chart">("text")
  const [metric, setMetric] = useState<"qty" | "sum">("sum")
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)
  const widths = [254.3, 312.5, 310.9, 201.8]
  const total = rows.reduce((sum, row) => sum + row.end, 0)
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
            <span className="text-[16px] font-bold leading-5 text-[#333]">{fmt(total)} {currencyLabel(base)}</span>
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
              {shown.map((row) => {
                const difference = row.end - row.begin
                const percent = row.begin ? Math.round((difference / Math.abs(row.begin)) * 100) : 0
                return (
                  <tr key={row.name} className="h-[36.1px] border-b border-[#eee]">
                    <td className="border-r border-[#eee] px-[17.5px]">{row.name}</td>
                    <td className="border-r border-[#eee] px-[17.5px]">{fmt(row.begin)} {currencyLabel(base)}</td>
                    <td className="border-r border-[#eee] px-[17.5px]">{fmt(row.end)} {currencyLabel(base)}</td>
                    <td className="px-[17.5px] font-semibold">( {percent} % ) {fmt(difference)} {currencyLabel(base)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length > COLLAPSED_ROWS && <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />}
        </div>
      </section>
      <div className="h-[10px]" />
    </>
  )
}

export function BalanceSections({ data: given, from, to }: { data?: BalanceOverview | null; from?: string; to?: string } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given, { from, to })
  const base = data?.baseCurrency ?? "SUM"
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [categoryExpanded, setCategoryExpanded] = useState(false)
  const [agentMode, setAgentMode] = useState<"profit" | "fact">("profit")

  const categoryRows = ((categoryMode === "type" ? data?.salesByType : data?.salesByBrand) ?? [])
    .map(categoryRowOf)
    .filter((row) => row.sales !== 0 || row.returns !== 0)
    .sort((x, y) => y.sales - x.sales)
  const salesTotals = data?.sales ? { ...data.sales, ...pnlMetrics(data.sales) } : null
  const agentRows: AgentValue[] = (data?.salesByAgent ?? []).map((row) => {
    const period = row.periods[0]
    return { name: row.name, value: agentMode === "profit" ? pnlMetrics(period).profit : period.realization - period.returns }
  })

  const debtRows = (list: BalanceOverview["clientDebts"] | undefined): BalanceRow[] => (list ?? []).map((row) => ({ name: row.name, start: row.begin, end: row.end, currency: row.currency }))
  const cashRows: BalanceRow[] = (data?.cashboxes ?? []).map((row) => ({ name: row.name, start: row.begin, end: row.end, currency: row.currency }))

  return (
    <>
      <div className="mx-[30px] mt-[44px] grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <ExpenseCard title={t("Прямые расходы")} rows={data?.expenses.direct ?? []} currency={base} />
        <ExpenseCard title={t("Косвенные расходы")} rows={data?.expenses.indirect ?? []} currency={base} />
      </div>

      <SectionTitle right={<ChipGroup options={[t("ТИП ПРОДУКТА"), t("БРЕНД")] as const} value={categoryMode === "type" ? t("ТИП ПРОДУКТА") : t("БРЕНД")} onChange={(value) => setCategoryMode(value === t("ТИП ПРОДУКТА") ? "type" : "brand")} />}>
        {t("Реализация по категориям")}
      </SectionTitle>
      <section className={`mx-[30px] ${CARD}`}>
        <div className="grid grid-cols-4">
          {[
            [t("Реализация"), "sales", salesTotals?.realization ?? 0, ""],
            [t("Возвраты"), "returns", salesTotals?.returns ?? 0, ""],
            [t("Чистая реализация"), "factSales", salesTotals?.net ?? 0, ""],
            [t("Валовая прибыль"), "profit", salesTotals?.profit ?? 0, "text-[#43a047]"],
          ].map(([label, field, value, tone]) => (
            <PieChart
              key={label as string}
              rows={categoryRows.map((row) => ({ name: t(row.name), value: Math.max(0, row[field as "sales"]) }))}
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
                <td className="truncate px-[18px]">{t(row.name)}</td>
                <td className="px-[18px]">{fmt(row.sales)}</td>
                <td className="px-[18px]">{fmt(row.returns)}</td>
                <td className="px-[18px]">{fmt(row.factSales)}</td>
                <td className={`px-[18px] font-semibold ${row.profit > 0 ? "text-[#81c784]" : row.profit < 0 ? "text-[#e57373]" : ""}`}>{fmt(row.profit)}</td>
                <td className="px-[18px]">{fmt(row.rentability, 2)}</td>
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
      <AgentsChart rows={agentRows} />

      <CashOverview data={data} />

      <DonutSection title={t("Долги клиентов")} label={t("Тип магазина")} rows={debtRows(data?.clientDebts)} base={base} />
      <DonutSection title={t("Обязательства перед поставщиками")} label={t("Поставщик")} rows={debtRows(data?.supplierDebts)} base={base} />
      <DonutSection title={t("Касса")} label={t("Касса")} rows={cashRows} base={base} />
      <div className="h-[40px]" />
    </>
  )
}
