"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import * as echarts from "echarts"
import { useLanguage } from "@/lib/i18n/language-context"

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
          {shown.map((row) => (
            <tr key={row.name + row.start} className="h-[36px] border-b border-[#e8ecf1]">
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

function ExpenseCard({ title }: { title: string }) {
  const { t } = useLanguage()
  return (
    <div>
      <h2 className="mb-[10px] text-[20px] font-semibold text-[#333]">{title}</h2>
      <div className={CARD}>
        <div className="relative h-[250px]">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[12px] font-bold">0</span>
            <span className="text-[10px] lowercase text-[#555]">{t("итого")}</span>
          </div>
        </div>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="h-[36px] bg-[#eff3f7] text-left font-semibold text-[#344054]">
              <th className="px-[18px] font-semibold">{t("Категория")}</th>
              <th className="px-[18px] font-semibold">{t("Сумма (SUM)")}<SortArrows /></th>
            </tr>
          </thead>
          <tbody />
        </table>
        <div className="h-[34px]" />
      </div>
    </div>
  )
}

type Register = { name: string; currency: string }
type ClientRow = { type?: string; balance?: number | null }
type Supplier = { name: string }

const toCurrency = (value: string | undefined): Currency => (value === "USD" ? "USD" : value === "EUR" || value === "Euro" ? "Euro" : "SUM")

export function useCashRows(): BalanceRow[] {
  const [registers, setRegisters] = useState<Register[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/cashboxes")
      .then(async (response) => (response.ok ? ((await response.json()) as Register[]) : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setRegisters(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return registers.map((register) => ({ name: register.name, start: 0, end: 0, currency: toCurrency(register.currency) }))
}

export function CashOverview() {
  const { t } = useLanguage()
  const cashRows = useCashRows()
  const stripTotal = (key: "start" | "end") => {
    const total: Record<Currency, number> = { Euro: 0, SUM: 0, USD: 0 }
    for (const row of cashRows) total[row.currency] += row[key]
    return total
  }
  const startTotal = stripTotal("start")
  const endTotal = stripTotal("end")
  const [cashMore, setCashMore] = useState(false)
  const shownCash = cashMore ? cashRows : cashRows.slice(0, 8)

  const strip = [
    { label: t("Баланс на начало периода"), tone: "text-[#0095ff]", total: startTotal },
    { label: t("Приход за период"), tone: "text-[#6fc982]", total: { Euro: 0, SUM: 0, USD: 0 } },
    { label: t("Расход за период"), tone: "text-[#ff6b6b]", total: { Euro: 0, SUM: 0, USD: 0 } },
    { label: t("Перевод в кассу"), tone: "text-[#6fc982]", total: { Euro: 0, SUM: 0, USD: 0 } },
    { label: t("Перевод с кассы"), tone: "text-[#ff6b6b]", total: { Euro: 0, SUM: 0, USD: 0 } },
    { label: t("Баланс на конец периода"), tone: "text-[#0095ff]", total: endTotal },
  ]

  return (
      <section className={`mx-[30px] ${CARD}`}>
        <div className="grid grid-cols-2 text-center sm:grid-cols-6">
          {strip.map((cell, index) => (
            <div key={cell.label} className={`px-[8px] py-[16px] ${index > 0 ? "border-l border-[#e8ecf1]" : ""}`}>
              {(["Euro", "SUM", "USD"] as const).map((currency) => (
                <p key={currency} className={`text-[15px] font-medium leading-[19px] ${cell.tone}`}>{fmt(cell.total[currency])} {currency === "Euro" ? "Euro" : currency}</p>
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
              <tr key={row.name} className="h-[36px] border-b border-[#e8ecf1]">
                <td className="border-r border-[#e8ecf1] px-[18px]">{row.name}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.start)}</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">0</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">0</td>
                <td className="border-r border-[#e8ecf1] px-[18px]">{fmt(row.end)}</td>
                <td className="px-[18px] text-right"><span className="float-left font-semibold">0 %</span><span className="font-semibold">0 {row.currency}</span></td>
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

function ToggleGroup<T extends string>({ options, value, onChange, tone }: { options: readonly T[]; value: T; onChange: (value: T) => void; tone: "blue" | "green" }) {
  const active = tone === "blue" ? "bg-[#4f71dc] text-white" : "bg-[#2bcd53] text-white"
  const idle = tone === "blue" ? "border border-[#4f71dc] bg-white text-[#4f71dc]" : "border border-[#2bcd53] bg-white text-[#2bcd53]"
  return (
    <div className="flex">
      {options.map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`h-[32px] px-[16px] text-[13px] font-semibold uppercase first:rounded-l-[3px] last:rounded-r-[3px] ${value === option ? active : idle}`}>
          {option}
        </button>
      ))}
    </div>
  )
}

export function WarehouseOverview() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<BalanceRow[]>([])
  const [priceMode, setPriceMode] = useState<"cost" | "price">("cost")
  const [view, setView] = useState<"text" | "chart">("text")
  const [metric, setMetric] = useState<"qty" | "sum">("sum")
  useEffect(() => {
    let cancelled = false
    fetch("/api/warehouses")
      .then(async (response) => (response.ok ? ((await response.json()) as { name: string }[]) : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setRows(data.map((row) => ({ name: row.name, start: 0, end: 0, currency: "SUM" as Currency })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const costLabel = t("СЕБЕСТОИМОСТЬ")
  const priceLabel = t("ПРАЙС ЛИСТ")
  return (
    <section className={`mx-[30px] mt-[30px] ${CARD}`}>
      <div className="flex items-center justify-between px-[0px]">
        <ToggleGroup tone="blue" options={[costLabel, priceLabel] as const} value={priceMode === "cost" ? costLabel : priceLabel} onChange={(value) => setPriceMode(value === costLabel ? "cost" : "price")} />
        <div className="flex gap-[8px]">
          <ToggleGroup tone="green" options={[t("ТЕКСТ"), t("ГРАФИК")] as const} value={view === "text" ? t("ТЕКСТ") : t("ГРАФИК")} onChange={(value) => setView(value === t("ТЕКСТ") ? "text" : "chart")} />
          <ToggleGroup tone="green" options={[t("КОЛ-ВО"), t("СУММА")] as const} value={metric === "qty" ? t("КОЛ-ВО") : t("СУММА")} onChange={(value) => setMetric(value === t("КОЛ-ВО") ? "qty" : "sum")} />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="relative h-[300px]">
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[13px] font-bold text-[#333]">0 SUM</span>
            <span className="text-[9px] uppercase text-[#555]">{t("Сумма на складе")}<br />{t("на конец периода")}</span>
          </div>
        </div>
        <BalanceTable rows={rows} label={t("Склад")} currency="SUM" />
      </div>
    </section>
  )
}

export function BalanceSections() {
  const { t } = useLanguage()
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [agentMode, setAgentMode] = useState<"profit" | "fact">("profit")
  const cashRows = useCashRows()
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
        <ExpenseCard title={t("Прямые расходы")} />
        <ExpenseCard title={t("Косвенные расходы")} />
      </div>

      <SectionTitle right={<ChipGroup options={[t("ТИП ПРОДУКТА"), t("БРЕНД")] as const} value={categoryMode === "type" ? t("ТИП ПРОДУКТА") : t("БРЕНД")} onChange={(value) => setCategoryMode(value === t("ТИП ПРОДУКТА") ? "type" : "brand")} />}>
        {t("Реализация по категориям")}
      </SectionTitle>
      <section className={`mx-[30px] ${CARD}`}>
        <div className="grid h-[280px] grid-cols-4 items-center text-center">
          {[t("Реализация"), t("Возвраты"), t("Чистая реализация"), t("Валовая прибыль")].map((label) => (
            <div key={label}>
              <p className="text-[12px] font-bold">0</p>
              <p className="text-[10px] uppercase text-[#555]">{label}</p>
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
        </table>
        <div className="flex flex-col items-center py-[16px]">
          <Image src="/robot-empty.png" alt="" width={96} height={96} className="h-[96px] w-[96px] object-contain" />
          <p className="mt-[6px] text-[13px] text-[#555]">{t("Нет данных")}</p>
        </div>
        <div className="h-[30px] border-t border-[#e8ecf1]" />
      </section>

      <SectionTitle right={<ChipGroup options={[t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ"), t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")] as const} value={agentMode === "profit" ? t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") : t("ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ")} onChange={(value) => setAgentMode(value === t("СУММА ПРИБЫЛИ ОТ ПРОДАЖИ") ? "profit" : "fact")} />}>
        {t("Прибыль от агентов")}
      </SectionTitle>
      <div className="h-[400px]" />

      <CashOverview />

      <DonutSection title={t("Долги клиентов")} label={t("Тип магазина")} rows={clientRows} />
      <DonutSection title={t("Обязательства перед поставщиками")} label={t("Поставщик")} rows={supplierRows} />
      <DonutSection title={t("Касса")} label={t("Касса")} rows={cashRows} />
      <div className="h-[40px]" />
    </>
  )
}
