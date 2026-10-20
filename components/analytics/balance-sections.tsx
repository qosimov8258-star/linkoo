"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import * as echarts from "echarts"
import { currencyLabel } from "@/lib/finance/currency"
import { monthEndIso, monthStartIso } from "@/lib/finance/dates"
import type { BalanceOverview } from "@/lib/finance/overview-types"
import { pnlMetrics, type PnlGroupRow } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Sections of the dashboard tabs "БАЛАНС" / "ФИЛИАЛ", all fed by
// GET /api/balances/overview (lib/finance/overview.ts): expenses by category,
// sales by product type / brand and by agent (P&L), cashboxes (Баланс кассы),
// stock per warehouse, client debts by client type and supplier obligations.
// A section rendered without `data` loads the current month itself.

const CARD = "rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] overflow-hidden"
const COLORS = ["#00e096", "#0095ff", "#ff3d71", "#ffaa00", "#7a5af8", "#fd7e14", "#20c997", "#6f42c1"]

export type BalanceRow = { name: string; start: number; end: number; currency: string }

const fmt = (value: number, digits = 2) => {
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

/** The data passed by the page, or the current month loaded by the section itself. */
function useSectionData(data: BalanceOverview | null | undefined): BalanceOverview | null {
  const own = useBalanceOverview(data === undefined ? { from: monthStartIso(), to: monthEndIso() } : null)
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

function Donut({ rows, currency, caption, height = 350 }: { rows: Array<{ name: string; value: number }>; currency: string; caption: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const positive = rows.filter((row) => row.value > 0)
    chart.setOption({
      animation: false,
      series: [
        {
          type: "pie",
          radius: ["65%", "98%"],
          center: ["50%", "50%"],
          label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: 700, formatter: "{d}%", textBorderColor: "#555", textBorderWidth: 2 },
          labelLine: { show: false },
          emptyCircleStyle: { color: "transparent" },
          itemStyle: { borderWidth: 0 },
          tooltip: { show: true },
          data: positive.map((row, index) => ({ name: row.name, value: row.value, itemStyle: { color: COLORS[index % COLORS.length] } })),
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
    <div className="relative" style={{ height }}>
      <div ref={ref} className="absolute inset-[10px]" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[13px] font-semibold text-[#333]">{fmt(total)} {currencyLabel(currency)}</span>
        <span className="text-[10px] uppercase text-[#555]">{t(caption)}</span>
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
            <th className="px-[18px] font-semibold">{t(label)}</th>
            <th className="px-[18px] font-semibold">{t("Баланс на начало")}<SortArrows /></th>
            <th className="cursor-pointer px-[18px] font-semibold" onClick={toggle}>{t("Баланс на конец")}<SortArrows /></th>
            <th className="px-[18px] font-semibold">{t("Разница")}<SortArrows /></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={`${row.name}|${row.currency}`} className="h-[36px] border-b border-[#e8ecf1]">
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
      <Donut rows={rows.map((row) => ({ name: row.name, value: row.end }))} currency={currency} caption="Баланс" />
      <BalanceTable rows={rows} label={label} currency={currency} />
    </div>
  )
}

function DonutSection({ title, label, rows, base }: { title: string; label: string; rows: BalanceRow[]; base: string }) {
  const { t } = useLanguage()
  const currencies = [...new Set(rows.map((row) => row.currency))]
  return (
    <>
      <SectionTitle>{t(title)}</SectionTitle>
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

function ExpenseCard({ title, rows, currency }: { title: string; rows: Array<{ name: string; amount: number }>; currency: string }) {
  const { t } = useLanguage()
  return (
    <div>
      <h2 className="mb-[10px] text-[20px] font-semibold text-[#333]">{t(title)}</h2>
      <div className={CARD}>
        <Donut rows={rows.map((row) => ({ name: row.name, value: row.amount }))} currency={currency} caption="итого" height={250} />
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
              <th className="px-[18px] font-semibold">{t("Категория")}</th>
              <th className="px-[18px] font-semibold">{t("Сумма")} ({currencyLabel(currency)})<SortArrows /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="h-[36px] border-b border-[#e8ecf1]">
                <td className="border-r border-[#e8ecf1] px-[18px]">{t(row.name)}</td>
                <td className="px-[18px]">{fmt(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="h-[34px]" />
      </div>
    </div>
  )
}

function SalesByCategory({ rows, base }: { rows: PnlGroupRow[]; base: string }) {
  const { t } = useLanguage()
  const totals = rows.reduce(
    (sum, row) => {
      const period = row.periods[0]
      return { realization: sum.realization + period.realization, returns: sum.returns + period.returns, cost: sum.cost + period.cost, returnCost: sum.returnCost + period.returnCost, quantity: 0 }
    },
    { realization: 0, returns: 0, cost: 0, returnCost: 0, quantity: 0 },
  )
  const metrics = pnlMetrics(totals)
  return (
    <section className={`mx-[30px] ${CARD}`}>
      <div className="grid grid-cols-2 items-center py-[30px] text-center sm:grid-cols-4">
        {[
          ["Реализация", totals.realization],
          ["Возвраты", totals.returns],
          ["Чистая реализация", metrics.net],
          ["Валовая прибыль", metrics.profit],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <p className="text-[14px] font-bold">
              {fmt(Number(value))} {currencyLabel(base)}
            </p>
            <p className="text-[10px] uppercase text-[#555]">{t(String(label))}</p>
          </div>
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
          {rows.map((row) => {
            const period = row.periods[0]
            const values = pnlMetrics(period)
            return (
              <tr key={row.name} className="h-[36px] border-b border-[#e8ecf1]">
                <td className="truncate border-r border-[#e8ecf1] px-[18px]">{t(row.name)}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(period.realization)}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(period.returns)}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(values.net)}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(values.profit)}</td>
                <td className="px-[18px]">{values.margin} %</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!rows.length && (
        <div className="flex flex-col items-center py-[16px]">
          <Image src="/robot-empty.png" alt="" width={96} height={96} className="h-[96px] w-[96px] object-contain" />
          <p className="mt-[6px] text-[13px] text-[#555]">{t("Нет данных")}</p>
        </div>
      )}
      <div className="h-[30px] border-t border-[#e8ecf1]" />
    </section>
  )
}

function AgentProfit({ rows, mode, base }: { rows: PnlGroupRow[]; mode: "profit" | "fact"; base: string }) {
  const { t } = useLanguage()
  const values = rows
    .map((row) => ({ name: row.name, value: mode === "profit" ? pnlMetrics(row.periods[0]).profit : row.periods[0].realization - row.periods[0].returns }))
    .sort((a, b) => b.value - a.value)
  const max = Math.max(1, ...values.map((row) => Math.abs(row.value)))
  return (
    <section className={`mx-[30px] ${CARD} px-[24px] py-[20px]`}>
      {values.length ? (
        values.map((row) => (
          <div key={row.name} className="mb-[10px] grid grid-cols-[220px_1fr_160px] items-center gap-[12px] text-[13px]">
            <span className="truncate">{t(row.name)}</span>
            <span className="h-[14px] rounded bg-[#eff3f7]">
              <span className={`block h-full rounded ${row.value >= 0 ? "bg-[#4f71dc]" : "bg-[#e5484d]"}`} style={{ width: `${(Math.abs(row.value) / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold">
              {fmt(row.value)} {currencyLabel(base)}
            </span>
          </div>
        ))
      ) : (
        <p className="py-[30px] text-center text-[13px] text-[#555]">{t("Нет данных")}</p>
      )}
    </section>
  )
}

/** Cashboxes of the period: strip of totals per currency + one row per cashbox. */
export function CashOverview({ data: given }: { data?: BalanceOverview | null } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given)
  const cashRows = useMemo(() => data?.cashboxes ?? [], [data])
  const [cashMore, setCashMore] = useState(false)
  const shownCash = cashMore ? cashRows : cashRows.slice(0, 8)
  const currencies = [...new Set(cashRows.map((row) => row.currency))]
  const total = (field: "begin" | "income" | "expenses" | "transferIncome" | "transferExpense" | "end") =>
    Object.fromEntries(currencies.map((currency) => [currency, cashRows.filter((row) => row.currency === currency).reduce((sum, row) => sum + row[field], 0)]))

  const strip = [
    { label: t("Баланс на начало периода"), tone: "text-[#0095ff]", total: total("begin") },
    { label: t("Приход за период"), tone: "text-[#6fc982]", total: total("income") },
    { label: t("Расход за период"), tone: "text-[#ff6b6b]", total: total("expenses") },
    { label: t("Перевод в кассу"), tone: "text-[#6fc982]", total: total("transferIncome") },
    { label: t("Перевод с кассы"), tone: "text-[#ff6b6b]", total: total("transferExpense") },
    { label: t("Баланс на конец периода"), tone: "text-[#0095ff]", total: total("end") },
  ]

  return (
    <section className={`mx-[30px] ${CARD}`}>
      <div className="grid grid-cols-2 text-center sm:grid-cols-6">
        {strip.map((cell, index) => (
          <div key={cell.label} className={`px-[8px] py-[16px] ${index > 0 ? "border-l border-[#e8ecf1]" : ""}`}>
            {currencies.map((currency) => (
              <p key={currency} className={`text-[15px] font-medium leading-[19px] ${cell.tone}`}>{fmt(cell.total[currency] ?? 0)} {currencyLabel(currency)}</p>
            ))}
            <p className="mt-[2px] text-[13px] text-[#555]">{cell.label}</p>
          </div>
        ))}
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
            <th className="px-[18px] font-semibold">{t("Кассы")}</th>
            {[t("Баланс на начало"), t("Приход за период"), t("Расход за период"), t("Баланс на конец"), t("Разница")].map((label) => (
              <th key={label} className="px-[18px] font-semibold">{label}<SortArrows /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownCash.map((row) => (
            <tr key={`${row.id}|${row.name}`} className="h-[36px] border-b border-[#e8ecf1]">
              <td className="border-r border-[#e8ecf1] px-[18px]">{row.name}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.begin)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.income + row.transferIncome)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.expenses + row.transferExpense)}</td>
              <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.end)}</td>
              <td className="px-[18px]"><DiffValue start={row.begin} end={row.end} currency={row.currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {cashRows.length > 8 && (
        <button type="button" onClick={() => setCashMore((value) => !value)} className="mx-[18px] my-[10px] flex h-[30px] w-[calc(100%-36px)] items-center justify-center gap-[6px] rounded-[15px] bg-[#eff3f7] text-[13px] text-[#4f71dc]">
          {cashMore ? t("Скрыть") : t("Показать еще")} <ChevronDown className={`h-4 w-4 ${cashMore ? "rotate-180" : ""}`} />
        </button>
      )}
      <div className="h-[20px]" />
    </section>
  )
}

/** Stock value per warehouse at cost (the one cost of goods), begin / end of the period. */
export function WarehouseOverview({ data: given }: { data?: BalanceOverview | null } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given)
  const base = data?.baseCurrency ?? "SUM"
  const rows: BalanceRow[] = (data?.warehouses ?? []).map((row) => ({ name: row.name, start: row.begin, end: row.end, currency: base }))
  const total = rows.reduce((sum, row) => sum + row.end, 0)
  return (
    <section className={`mx-[30px] mt-[30px] ${CARD}`}>
      <div className="flex items-center px-[18px] pt-[12px] text-[13px] font-semibold uppercase text-[#4f71dc]">{t("СЕБЕСТОИМОСТЬ")}</div>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="relative">
          <Donut rows={rows.map((row) => ({ name: row.name, value: row.end }))} currency={base} caption="Сумма на складе" height={300} />
          <span className="pointer-events-none absolute inset-x-0 bottom-[8px] text-center text-[9px] uppercase text-[#555]">
            {t("на конец периода")}: {fmt(total)} {currencyLabel(base)}
          </span>
        </div>
        <BalanceTable rows={rows} label="Склад" currency={base} />
      </div>
    </section>
  )
}

export function BalanceSections({ data: given }: { data?: BalanceOverview | null } = {}) {
  const { t } = useLanguage()
  const data = useSectionData(given)
  const base = data?.baseCurrency ?? "SUM"
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [agentMode, setAgentMode] = useState<"profit" | "fact">("profit")

  const debtRows = (list: BalanceOverview["clientDebts"] | undefined): BalanceRow[] => (list ?? []).map((row) => ({ name: row.name, start: row.begin, end: row.end, currency: row.currency }))
  const cashRows: BalanceRow[] = (data?.cashboxes ?? []).map((row) => ({ name: row.name, start: row.begin, end: row.end, currency: row.currency }))

  return (
    <>
      <div className="mx-[30px] mt-[44px] grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <ExpenseCard title="Прямые расходы" rows={data?.expenses.direct ?? []} currency={base} />
        <ExpenseCard title="Косвенные расходы" rows={data?.expenses.indirect ?? []} currency={base} />
      </div>

      <SectionTitle right={<ChipGroup options={[t("ТИП ПРОДУКТА"), t("БРЕНД")] as const} value={categoryMode === "type" ? t("ТИП ПРОДУКТА") : t("БРЕНД")} onChange={(value) => setCategoryMode(value === t("ТИП ПРОДУКТА") ? "type" : "brand")} />}>
        {t("Реализация по категориям")}
      </SectionTitle>
      <SalesByCategory rows={(categoryMode === "type" ? data?.salesByType : data?.salesByBrand) ?? []} base={base} />

      <SectionTitle right={<ChipGroup options={[t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ"), t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")] as const} value={agentMode === "profit" ? t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") : t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")} onChange={(value) => setAgentMode(value === t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") ? "profit" : "fact")} />}>
        {t("Прибыль от агентов")}
      </SectionTitle>
      <AgentProfit rows={data?.salesByAgent ?? []} mode={agentMode} base={base} />

      <div className="mt-[30px]" />
      <CashOverview data={data} />
      <WarehouseOverview data={data} />

      <DonutSection title="Долги клиентов" label="Тип магазина" rows={debtRows(data?.clientDebts)} base={base} />
      <DonutSection title="Обязательства перед поставщиками" label="Поставщик" rows={debtRows(data?.supplierDebts)} base={base} />
      <DonutSection title="Касса" label="Касса" rows={cashRows} base={base} />
      <div className="h-[40px]" />
    </>
  )
}
