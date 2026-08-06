"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ChevronDown, Download, Info, Star } from "lucide-react"

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

const money = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: 3 }).format(value)

// Кассы (matches Баланс кассы data set)
type Currency = "SUM" | "USD" | "Euro"
type Register = { id: number; name: string; openingAmount: number; openingCurrency: Currency }
const registers: Register[] = [
  { id: 1, name: "aaaa1", openingAmount: 20, openingCurrency: "Euro" },
  { id: 2, name: "adaw", openingAmount: 223123, openingCurrency: "SUM" },
  { id: 3, name: "Агент", openingAmount: 0, openingCurrency: "SUM" },
  { id: 4, name: "Ahmad", openingAmount: 0, openingCurrency: "SUM" },
  { id: 5, name: "Карим2", openingAmount: 23.36, openingCurrency: "USD" },
  { id: 6, name: "Карим1", openingAmount: 191040, openingCurrency: "SUM" },
  { id: 7, name: "kassa11", openingAmount: 500010000, openingCurrency: "SUM" },
]
const CASH_TOTALS = { euro: 20, sum: 25884392057.44, usd: 6577793.296 }

// Долги клиентов по типу магазина
type ShareRow = { name: string; balanceStart: number; balanceEnd: number }
const clientDebtSum: ShareRow[] = [
  { name: "chakana savdo", balanceStart: -24490631, balanceEnd: -24490631 },
  { name: "market", balanceStart: -38515711515.894, balanceEnd: -38515711515.894 },
  { name: "market109", balanceStart: -50000, balanceEnd: -50000 },
  { name: "market129", balanceStart: 0, balanceEnd: 0 },
  { name: "market138", balanceStart: -48283400, balanceEnd: -48283400 },
  { name: "market152", balanceStart: 50000, balanceEnd: 50000 },
  { name: "market166", balanceStart: 83550, balanceEnd: 83550 },
  { name: "market169", balanceStart: -590000, balanceEnd: -590000 },
]
const clientDebtSumShares = [
  { name: "market", percent: 74.1, color: "#22c55e" },
  { name: "Оптовый", percent: 19.2, color: "#22c55e" },
  { name: "Розничный", percent: 3.1, color: "#ef4444" },
  { name: "Другие", percent: 3.6, color: "#8b5cf6" },
]
const clientDebtUsdShares = [
  { name: "chakana savdo", percent: 57.6, color: "#3b82f6" },
  { name: "Оптовый", percent: 17.2, color: "#ef4444" },
  { name: "Розничный", percent: 13.6, color: "#3b82f6" },
  { name: "Супермаркет", percent: 9.2, color: "#22c55e" },
  { name: "Другие", percent: 2.4, color: "#8b5cf6" },
]
const CLIENT_DEBT_SUM_TOTAL = -71612857.134
const CLIENT_DEBT_USD_TOTAL = 6079773.002

// Обязательства перед поставщиками
const supplierDebt: ShareRow[] = [
  { name: "Инвенторизация", balanceStart: -100000000, balanceEnd: -100000000 },
  { name: "Demo", balanceStart: 136594000, balanceEnd: 136594000 },
  { name: "Kotta aka", balanceStart: 8955504900, balanceEnd: 8955504900 },
  { name: "Corelion", balanceStart: -199400456, balanceEnd: -199400456 },
  { name: "Corelion", balanceStart: 693033, balanceEnd: 693033 },
  { name: "Dji technology", balanceStart: 4149880000, balanceEnd: 4149880000 },
  { name: "shaxlo sutlari", balanceStart: -1085700000, balanceEnd: -1085700000 },
  { name: "laylo shirin", balanceStart: -69734000, balanceEnd: -69734000 },
]
const supplierDebtShares = [
  { name: "ali aliyev", percent: 30.0, color: "#3b82f6" },
  { name: "universal postavshik", percent: 22.8, color: "#f59e0b" },
  { name: "Sarvar", percent: 18.6, color: "#22c55e" },
  { name: "Kotta aka", percent: 7.9, color: "#3b82f6" },
  { name: "Dji technology", percent: 3.5, color: "#f59e0b" },
  { name: "Другие", percent: 17.2, color: "#8b5cf6" },
]
const supplierDebtUsdShares = [
  { name: "Demo", percent: 36.5, color: "#3b82f6" },
  { name: "Temurbek Sharipov", percent: 46.0, color: "#8b5cf6" },
  { name: "universal postavshik", percent: 17.0, color: "#ef4444" },
  { name: "Другие", percent: 0.5, color: "#22c55e" },
]
const SUPPLIER_DEBT_SUM_TOTAL = -114854713953.32
const SUPPLIER_DEBT_USD_TOTAL = -16425511.374

// Прибыль от агентов (та же касса)
const agentProfitToggleOptions = ["СУММА ПРИБЫЛИ ОТ ПРОДАЖИ", "ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ"] as const

// Склад
type WarehouseRow = { id: number; name: string; balance: number; sharePercent: number }
const warehouses: WarehouseRow[] = [
  { id: 1, name: "Suhrob sklad", balance: 238653107.79, sharePercent: 28.5 },
  { id: 2, name: "new (vansell)", balance: 10420879627.4, sharePercent: 23.3 },
  { id: 3, name: "ГП", balance: 11111100000, sharePercent: 18.9 },
  { id: 4, name: "Temurbek", balance: 370000000, sharePercent: 11.1 },
  { id: 5, name: "Lit Energu", balance: 240350000, sharePercent: 3.5 },
  { id: 6, name: "Said Qosimov", balance: 76148736.401, sharePercent: 3.2 },
  { id: 7, name: "bog'ishamol45", balance: 5000000, sharePercent: 3.0 },
  { id: 8, name: "baby still (сырье)", balance: 102597, sharePercent: 3.1 },
]
const WAREHOUSE_TOTAL = 342011626001

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value, value % 1 ? 2 : 0)}</span>
}

function InfoCard({ label, lines }: { label: string; lines: { value: number; suffix: string }[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[13px] uppercase text-[#9aa3b6]">{label} <Info className="h-3.5 w-3.5" /></p>
      {lines.map((line, index) => (
        <p key={index} className="font-semibold text-[#17233b]">{money(line.value, line.value % 1 ? 2 : 0)} {line.suffix}</p>
      ))}
    </div>
  )
}

function Donut({ shares, size = 260 }: { shares: { name: string; percent: number; color: string }[]; size?: number }) {
  const stops = useMemo(() => {
    return shares.reduce<{ acc: number; parts: string[] }>(
      (state, row) => {
        const start = state.acc
        const end = start + row.percent
        return { acc: end, parts: [...state.parts, `${row.color} ${start}% ${end}%`] }
      },
      { acc: 0, parts: [] },
    ).parts
  }, [shares])
  return (
    <div className="mx-auto flex items-center justify-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(${stops.join(", ")})` }}>
      <div className="flex flex-col items-center justify-center rounded-full bg-white text-center" style={{ width: size * 0.68, height: size * 0.68 }} />
    </div>
  )
}

function ShareTable({ rows }: { rows: ShareRow[] }) {
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null)
  const sorted = useMemo(() => {
    if (!sortDir) return rows
    const copy = [...rows]
    copy.sort((a, b) => (sortDir === "asc" ? a.balanceEnd - b.balanceEnd : b.balanceEnd - a.balanceEnd))
    return copy
  }, [rows, sortDir])
  return (
    <table className="w-full border-collapse text-[14px]">
      <thead className="bg-[#f6f9fc] text-[#586174]">
        <tr>
          <th className="px-4 py-3 text-left font-semibold">Тип магазина</th>
          <th className="px-4 py-3 text-left font-semibold">Баланс на начало</th>
          <th onClick={() => setSortDir((current) => (current === "asc" ? "desc" : "asc"))} className="cursor-pointer px-4 py-3 text-left font-semibold hover:text-[#4f70e7]">
            <span className="inline-flex items-center gap-1">Баланс на конец<ChevronDown className="h-3.5 w-3.5" /></span>
          </th>
          <th className="px-4 py-3 text-left font-semibold">Разница</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr key={row.name + index} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
            <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
            <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balanceStart} /></td>
            <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balanceEnd} /></td>
            <td className="border-t border-[#e1e5eb] px-4 py-3.5">(0 %) 0</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14">
      <Image src="/robot-mascot.png" alt="Робот-помощник" width={96} height={96} className="h-24 w-24 object-contain" />
      <p className="mt-3 text-[#9aa3b6]">{label}</p>
    </div>
  )
}

export function BalanceTabView() {
  const router = useRouter()
  const [favorite, setFavorite] = useState(false)
  const [organization, setOrganization] = useState("Все организации")
  const [warehouseTab, setWarehouseTab] = useState<"cost" | "priceList">("cost")
  const [warehouseDisplay, setWarehouseDisplay] = useState<"text" | "chart">("text")
  const [period, setPeriod] = useState("МЕСЯЦ")
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [agentProfitMode, setAgentProfitMode] = useState<(typeof agentProfitToggleOptions)[number]>(agentProfitToggleOptions[0])

  const downloadAll = () => {
    const header = ["Раздел", "SUM", "USD", "Euro"]
    const body = [
      ["Баланс на начало периода", CASH_TOTALS.sum, CASH_TOTALS.usd, CASH_TOTALS.euro],
      ["Долги клиентов (SUM)", CLIENT_DEBT_SUM_TOTAL, "", ""],
      ["Долги клиентов (USD)", "", CLIENT_DEBT_USD_TOTAL, ""],
      ["Обязательства перед поставщиками (SUM)", SUPPLIER_DEBT_SUM_TOTAL, "", ""],
      ["Обязательства перед поставщиками (USD)", "", SUPPLIER_DEBT_USD_TOTAL, ""],
    ]
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "balance.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3">
          <Star className={`h-6 w-6 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-xl font-bold text-[#4f70e7]">Избранные</span><span className="text-2xl font-light text-[#586174]">|</span>
          <span className="text-xl font-bold text-[#586174]">Виджеты</span>
        </button>
        <nav className="ml-auto flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "БАЛАНС" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
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
        <strong className="ml-auto text-[#5470e8]">01 Авг. 2026 - 31 Авг. 2026</strong>
        <div className="flex overflow-hidden rounded-md border border-[#e1e5eb]">
          {["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"].map((item) => <button key={item} onClick={() => setPeriod(item)} className={`border-r border-[#e1e5eb] px-4 py-2 text-sm font-medium last:border-r-0 ${period === item ? "bg-[#4f70e7] text-white" : "bg-white hover:bg-slate-50"}`}>{item}</button>)}
        </div>
      </section>

      <section className="mx-6 mb-6 flex flex-wrap items-center gap-4 rounded-md bg-white p-4 shadow-sm md:mx-9">
        <label className="relative min-w-[220px]">
          <span className="sr-only">Организация</span>
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="w-full appearance-none border-b border-[#dbe0e8] bg-transparent pb-1 pr-6 outline-none">
            <option>Все организации</option>
            <option>Linko</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-1 h-4 w-4 text-[#9aa3b6]" />
        </label>
        <button className="rounded-md bg-[#4f70e7] px-6 py-2.5 font-semibold text-white">Применить</button>
        <button onClick={downloadAll} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#4caf72] px-4 font-semibold text-white">
          <Download className="h-4 w-4" /> Скачать Excel
        </button>
      </section>

      <section className="mx-6 mb-10 grid grid-cols-1 gap-8 rounded-md bg-white p-6 shadow-sm lg:grid-cols-3 md:mx-9">
        <div className="space-y-6">
          <h3 className="text-lg font-semibold">Баланс на 1 августа</h3>
          <InfoCard label="Склад" lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
          <InfoCard label="Касса" lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
          <InfoCard label="Задолженность клиентов" lines={[{ value: 11708312, suffix: "EURO" }, { value: 45744307420, suffix: "SUM" }, { value: 936540, suffix: "USD" }]} />
          <InfoCard label="Предоплаты поставщикам" lines={[{ value: 2490816833, suffix: "SUM" }, { value: 2595, suffix: "USD" }]} />
          <InfoCard label="Авансы, выданные по оплате труда" lines={[{ value: 8000000, suffix: "EURO" }, { value: 107484400, suffix: "SUM" }, { value: 499000, suffix: "USD" }]} />
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">Сумма активов в основной валюте</p>
            <p className="font-semibold text-[#3aa76d]">805 322 450 783,199 SUM</p>
          </div>
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">Курс</p>
            <p className="font-semibold">12 500</p>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold">Продажа за период</h3>
          <div className="flex items-center gap-2 rounded-md border border-[#e1e5eb] px-4 py-3">
            <span className="text-[#586174]">0 SUM</span>
          </div>
          <div>
            <p className="text-[#586174]">Приход денежных средств</p>
            <div className="rounded-md border border-[#e1e5eb] px-4 py-3 text-[#586174]">0 SUM</div>
          </div>
          <div>
            <p className="text-[#586174]">Собственный капитал не изменился</p>
            <div className="rounded-md border border-[#e1e5eb] px-4 py-3 text-[#586174]">0 SUM</div>
          </div>

          <InfoCard label="Авансы, полученные от покупателей" lines={[{ value: 3431, suffix: "EURO" }, { value: 13984313131, suffix: "SUM" }, { value: 8016310, suffix: "USD" }]} />
          <InfoCard label="Долги поставщикам" lines={[{ value: 117345530786, suffix: "SUM" }, { value: 16428106, suffix: "USD" }]} />
          <InfoCard label="Кешбэк покупателей" lines={[{ value: 90031333708, suffix: "SUM" }, { value: 180000000018, suffix: "USD" }]} />
          <InfoCard label="Задолженность по оплате труда" lines={[{ value: 90426358, suffix: "SUM" }]} />
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">Сумма обязательств в основной валюте</p>
            <p className="font-semibold text-[#e5484d]">2 250 527 057 325 702 SUM</p>
          </div>
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">Собственный капитал</p>
            <p className="font-semibold text-[#e5484d]">-2 249 721 734 874 918,5 SUM</p>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold">Баланс на 31 августа</h3>
          <InfoCard label="Склад" lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
          <InfoCard label="Касса" lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
          <InfoCard label="Задолженность клиентов" lines={[{ value: 11708312, suffix: "EURO" }, { value: 45744307420, suffix: "SUM" }, { value: 936540, suffix: "USD" }]} />
          <InfoCard label="Долги поставщикам" lines={[{ value: 117345530786, suffix: "SUM" }, { value: 16428106, suffix: "USD" }]} />
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <h2 className="mb-5 text-lg font-semibold">Кассы</h2>
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">Баланс на начало периода</p>
          </div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Приход за период</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Расход за период</p></div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Перевод в кассу</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Перевод с кассы</p></div>
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">Баланс на конец периода</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Кассы</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на начало</th>
                <th className="px-4 py-3 text-left font-semibold">Приход за период</th>
                <th className="px-4 py-3 text-left font-semibold">Расход за период</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на конец</th>
                <th className="px-4 py-3 text-left font-semibold">Разница</th>
              </tr>
            </thead>
            <tbody>
              {registers.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.openingAmount === 0 ? "0" : `${money(row.openingAmount, row.openingAmount % 1 ? 2 : 0)}`}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.openingAmount === 0 ? "0" : `${money(row.openingAmount, row.openingAmount % 1 ? 2 : 0)}`}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0 % <span className="ml-2">0 {row.openingCurrency}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-6 mb-10 md:mx-9">
        <h2 className="mb-4 text-lg font-semibold">Долги клиентов</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={clientDebtSumShares} />
            <p className="mt-4 text-center font-semibold">{money(CLIENT_DEBT_SUM_TOTAL, 3)} SUM<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">Баланс</span></p>
          </div>
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={clientDebtUsdShares} />
            <p className="mt-4 text-center font-semibold">{money(CLIENT_DEBT_USD_TOTAL, 3)} USD<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">Баланс</span></p>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-md bg-white shadow-sm">
          <ShareTable rows={clientDebtSum} />
        </div>
      </section>

      <section className="mx-6 mb-10 md:mx-9">
        <h2 className="mb-4 text-lg font-semibold">Обязательства перед поставщиками</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={supplierDebtShares} />
            <p className="mt-4 text-center font-semibold">{money(SUPPLIER_DEBT_SUM_TOTAL, 2)} SUM<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">Баланс</span></p>
          </div>
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={supplierDebtUsdShares} />
            <p className="mt-4 text-center font-semibold">{money(SUPPLIER_DEBT_USD_TOTAL, 3)} USD<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">Баланс</span></p>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-md bg-white shadow-sm">
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Поставщик</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на начало</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на конец</th>
                <th className="px-4 py-3 text-left font-semibold">Разница</th>
              </tr>
            </thead>
            <tbody>
              {supplierDebt.map((row, index) => (
                <tr key={row.name + index} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balanceStart} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.balanceEnd} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">(0 %) 0</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-6 mb-10 grid grid-cols-1 gap-6 lg:grid-cols-2 md:mx-9">
        <div className="rounded-md bg-white shadow-sm">
          <h2 className="border-b border-[#e1e5eb] px-6 py-4 text-lg font-semibold">Прямые расходы</h2>
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr><th className="px-4 py-3 text-left font-semibold">Категория</th><th className="px-4 py-3 text-left font-semibold">Сумма (SUM)</th></tr>
            </thead>
            <tbody><tr><td colSpan={2}><EmptyBlock label="Нет данных" /></td></tr></tbody>
            <tfoot><tr className="border-t border-[#e1e5eb] font-semibold"><td className="px-4 py-3.5">Итого</td><td className="px-4 py-3.5">0</td></tr></tfoot>
          </table>
        </div>
        <div className="rounded-md bg-white shadow-sm">
          <h2 className="border-b border-[#e1e5eb] px-6 py-4 text-lg font-semibold">Косвенные расходы</h2>
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr><th className="px-4 py-3 text-left font-semibold">Категория</th><th className="px-4 py-3 text-left font-semibold">Сумма (SUM)</th></tr>
            </thead>
            <tbody><tr><td colSpan={2}><EmptyBlock label="Нет данных" /></td></tr></tbody>
            <tfoot><tr className="border-t border-[#e1e5eb] font-semibold"><td className="px-4 py-3.5">Итого</td><td className="px-4 py-3.5">0</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Реализация по категориям</h2>
          <div className="flex overflow-hidden rounded-sm">
            <button onClick={() => setCategoryMode("type")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${categoryMode === "type" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Тип продукта</button>
            <button onClick={() => setCategoryMode("brand")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${categoryMode === "brand" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Бренд</button>
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">Реализация</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">Возвраты</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">Чистая реализация</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">Валовая прибыль</p></div>
        </div>
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-[#f6f9fc] text-[#586174]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Название</th>
              <th className="px-4 py-3 text-left font-semibold">Реализация</th>
              <th className="px-4 py-3 text-left font-semibold">Возвраты</th>
              <th className="px-4 py-3 text-left font-semibold">Чистая реализация</th>
              <th className="px-4 py-3 text-left font-semibold">Валовая прибыль</th>
              <th className="px-4 py-3 text-left font-semibold">Рентабельность ВП</th>
            </tr>
          </thead>
          <tbody><tr><td colSpan={6}><EmptyBlock label="Нет данных" /></td></tr></tbody>
        </table>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Прибыль от агентов</h2>
          <div className="flex overflow-hidden rounded-sm">
            {agentProfitToggleOptions.map((option) => (
              <button key={option} onClick={() => setAgentProfitMode(option)} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${agentProfitMode === option ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{option}</button>
            ))}
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">Баланс на начало периода</p>
          </div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Приход за период</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Расход за период</p></div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Перевод в кассу</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">Перевод с кассы</p></div>
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">Баланс на конец периода</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Кассы</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на начало</th>
                <th className="px-4 py-3 text-left font-semibold">Баланс на конец</th>
                <th className="px-4 py-3 text-left font-semibold">Разница</th>
              </tr>
            </thead>
            <tbody>
              {registers.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.name}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.openingAmount === 0 ? "0" : money(row.openingAmount, row.openingAmount % 1 ? 2 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.openingAmount === 0 ? "0" : money(row.openingAmount, row.openingAmount % 1 ? 2 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">(0 %) 0 {row.openingCurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-6 flex overflow-hidden rounded-sm">
          <button onClick={() => setWarehouseTab("cost")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "cost" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>Себестоимость</button>
          <button onClick={() => setWarehouseTab("priceList")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "priceList" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>Прайс лист</button>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${warehouses.reduce<{ acc: number; parts: string[] }>((state, row, index) => { const colors = ["#3b82f6", "#22c55e", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16"]; const start = state.acc; const end = start + row.sharePercent; return { acc: end, parts: [...state.parts, `${colors[index % colors.length]} ${start}% ${end}%`] } }, { acc: 0, parts: [] }).parts.join(", ")})` }}>
            <div className="flex h-[180px] w-[180px] flex-col items-center justify-center rounded-full bg-white text-center">
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
                  <th className="px-4 py-3 text-left font-semibold">Баланс на конец</th>
                  <th className="px-4 py-3 text-left font-semibold">Разница</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((row, index) => (
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
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-sm">
            <button onClick={() => setWarehouseDisplay("text")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "text" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>Текст</button>
            <button onClick={() => setWarehouseDisplay("chart")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "chart" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>График</button>
          </div>
        </div>
      </section>
    </main>
  )
}
