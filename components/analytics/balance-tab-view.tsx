"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ChevronDown, Download, Info } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"
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

const money = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)

// Кассы (matches Баланс кассы data set)
type Currency = "SUM" | "USD" | "Euro"
type Register = { id: number; name: string; openingAmount: number; openingCurrency: Currency }
const registers: Register[] = []
const CASH_TOTALS = { euro: 0, sum: 0, usd: 0 }

// Долги клиентов по типу магазина
type ShareRow = { name: string; balanceStart: number; balanceEnd: number }
const clientDebtSum: ShareRow[] = []
const clientDebtSumShares: { name: string; percent: number; color: string }[] = []
const clientDebtUsdShares: { name: string; percent: number; color: string }[] = []
const CLIENT_DEBT_SUM_TOTAL = 0
const CLIENT_DEBT_USD_TOTAL = 0

// Обязательства перед поставщиками
const supplierDebt: ShareRow[] = []
const supplierDebtShares: { name: string; percent: number; color: string }[] = []
const supplierDebtUsdShares: { name: string; percent: number; color: string }[] = []
const SUPPLIER_DEBT_SUM_TOTAL = 0
const SUPPLIER_DEBT_USD_TOTAL = 0

// Прибыль от агентов (та же касса)
const agentProfitToggleOptions = ["СУММА ПРИБЫЛИ ОТ ПРОДАЖИ", "ФАКТИЧЕСКАЯ СУММА ПРОДАЖИ"] as const

// Склад
type WarehouseRow = { id: number; name: string; balance: number; sharePercent: number }
const warehouses: WarehouseRow[] = []
const WAREHOUSE_TOTAL = 0

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
  const { t } = useLanguage()
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
          <th className="px-4 py-3 text-left font-semibold">{t("Тип магазина")}</th>
          <th className="px-4 py-3 text-left font-semibold">{t("Баланс на начало")}</th>
          <th onClick={() => setSortDir((current) => (current === "asc" ? "desc" : "asc"))} className="cursor-pointer px-4 py-3 text-left font-semibold hover:text-[#4f70e7]">
            <span className="inline-flex items-center gap-1">{t("Баланс на конец")}<ChevronDown className="h-3.5 w-3.5" /></span>
          </th>
          <th className="px-4 py-3 text-left font-semibold">{t("Разница")}</th>
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
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center py-14">
      <Image src="/robot-mascot.png" alt={t("Робот-помощник")} width={96} height={96} className="h-24 w-24 object-contain" />
      <p className="mt-3 text-[#9aa3b6]">{label}</p>
    </div>
  )
}

export function BalanceTabView() {
  const { t } = useLanguage()
  const router = useRouter()
  const [organization, setOrganization] = useState("Все организации")
  const [applied, setApplied] = useState(false)
  const [warehouseTab, setWarehouseTab] = useState<"cost" | "priceList">("cost")
  const [warehouseDisplay, setWarehouseDisplay] = useState<"text" | "chart">("text")
  const [period, setPeriod] = useState("МЕСЯЦ")
  const [categoryMode, setCategoryMode] = useState<"type" | "brand">("type")
  const [agentProfitMode, setAgentProfitMode] = useState<(typeof agentProfitToggleOptions)[number]>(agentProfitToggleOptions[0])

  const downloadAll = () => {
    const header = [t("Раздел"), "SUM", "USD", "Euro"]
    const body = [
      [t("Баланс на начало периода"), CASH_TOTALS.sum, CASH_TOTALS.usd, CASH_TOTALS.euro],
      [t("Долги клиентов (SUM)"), CLIENT_DEBT_SUM_TOTAL, "", ""],
      [t("Долги клиентов (USD)"), "", CLIENT_DEBT_USD_TOTAL, ""],
      [t("Обязательства перед поставщиками (SUM)"), SUPPLIER_DEBT_SUM_TOTAL, "", ""],
      [t("Обязательства перед поставщиками (USD)"), "", SUPPLIER_DEBT_USD_TOTAL, ""],
    ]
    downloadExcelTable("balance.xls", [header, ...body])
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-xl font-bold text-[#4f70e7]" /><span className="text-2xl font-light text-[#586174]">|</span>
          <span className="text-xl font-bold text-[#586174]">{t("Виджеты")}</span>
        </div>
        <nav className="ml-auto flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "БАЛАНС" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {t(tab)}
            </button>
          ))}
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 text-white">A</span>
          Admin Ritm <small className="text-slate-400">{t("Сервер:")} (https://time3.linko.uz)</small>
        </div>
        <strong className="ml-auto text-[#5470e8]">{t("01 Авг. 2026 - 31 Авг. 2026")}</strong>
        <div className="flex overflow-hidden rounded-md border border-[#e1e5eb]">
          {["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"].map((item) => <button key={item} onClick={() => setPeriod(item)} className={`border-r border-[#e1e5eb] px-4 py-2 text-sm font-medium last:border-r-0 ${period === item ? "bg-[#4f70e7] text-white" : "bg-white hover:bg-slate-50"}`}>{t(item)}</button>)}
        </div>
      </section>

      <section className="mx-6 mb-6 flex flex-wrap items-center gap-4 rounded-md bg-white p-4 shadow-sm md:mx-9">
        <label className="relative min-w-[220px]">
          <span className="sr-only">{t("Организация")}</span>
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="w-full appearance-none border-b border-[#dbe0e8] bg-transparent pb-1 pr-6 outline-none">
            <option value="Все организации">{t("Все организации")}</option>
            <option>Linko</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-1 h-4 w-4 text-[#9aa3b6]" />
        </label>
        <button
          onClick={() => {
            setApplied(true)
            window.setTimeout(() => setApplied(false), 1800)
          }}
          className="rounded-md bg-[#4f70e7] px-6 py-2.5 font-semibold text-white"
        >
          {applied ? t("Применено ✓") : t("Применить")}
        </button>
        <button onClick={downloadAll} className="ml-auto flex h-10 items-center gap-2 rounded-md bg-[#4caf72] px-4 font-semibold text-white">
          <Download className="h-4 w-4" /> {t("Скачать Excel")}
        </button>
      </section>

      <section className="mx-6 mb-10 grid grid-cols-1 gap-8 rounded-md bg-white p-6 shadow-sm lg:grid-cols-3 md:mx-9">
        <div className="space-y-6">
          <h3 className="text-lg font-semibold">{t("Баланс на 1 августа")}</h3>
          <InfoCard label={t("Склад")} lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
          <InfoCard label={t("Касса")} lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
          <InfoCard label={t("Задолженность клиентов")} lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Предоплаты поставщикам")} lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Авансы, выданные по оплате труда")} lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">{t("Сумма активов в основной валюте")}</p>
            <p className="font-semibold text-[#3aa76d]">0 SUM</p>
          </div>
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">{t("Курс")}</p>
            <p className="font-semibold">0</p>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold">{t("Продажа за период")}</h3>
          <div className="flex items-center gap-2 rounded-md border border-[#e1e5eb] px-4 py-3">
            <span className="text-[#586174]">0 SUM</span>
          </div>
          <div>
            <p className="text-[#586174]">{t("Приход денежных средств")}</p>
            <div className="rounded-md border border-[#e1e5eb] px-4 py-3 text-[#586174]">0 SUM</div>
          </div>
          <div>
            <p className="text-[#586174]">{t("Собственный капитал не изменился")}</p>
            <div className="rounded-md border border-[#e1e5eb] px-4 py-3 text-[#586174]">0 SUM</div>
          </div>

          <InfoCard label={t("Авансы, полученные от покупателей")} lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Долги поставщикам")} lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Кешбэк покупателей")} lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Задолженность по оплате труда")} lines={[{ value: 0, suffix: "SUM" }]} />
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">{t("Сумма обязательств в основной валюте")}</p>
            <p className="font-semibold text-[#e5484d]">0 SUM</p>
          </div>
          <div>
            <p className="text-[13px] uppercase text-[#9aa3b6]">{t("Собственный капитал")}</p>
            <p className="font-semibold text-[#e5484d]">0 SUM</p>
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold">{t("Баланс на 31 августа")}</h3>
          <InfoCard label={t("Склад")} lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
          <InfoCard label={t("Касса")} lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
          <InfoCard label={t("Задолженность клиентов")} lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
          <InfoCard label={t("Долги поставщикам")} lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <h2 className="mb-5 text-lg font-semibold">{t("Кассы")}</h2>
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">{t("Баланс на начало периода")}</p>
          </div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Приход за период")}</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Расход за период")}</p></div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Перевод в кассу")}</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Перевод с кассы")}</p></div>
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">{t("Баланс на конец периода")}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{t("Кассы")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на начало")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Приход за период")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Расход за период")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на конец")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Разница")}</th>
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
        <h2 className="mb-4 text-lg font-semibold">{t("Долги клиентов")}</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={clientDebtSumShares} />
            <p className="mt-4 text-center font-semibold">{money(CLIENT_DEBT_SUM_TOTAL, 3)} SUM<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">{t("Баланс")}</span></p>
          </div>
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={clientDebtUsdShares} />
            <p className="mt-4 text-center font-semibold">{money(CLIENT_DEBT_USD_TOTAL, 3)} USD<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">{t("Баланс")}</span></p>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-md bg-white shadow-sm">
          <ShareTable rows={clientDebtSum} />
        </div>
      </section>

      <section className="mx-6 mb-10 md:mx-9">
        <h2 className="mb-4 text-lg font-semibold">{t("Обязательства перед поставщиками")}</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={supplierDebtShares} />
            <p className="mt-4 text-center font-semibold">{money(SUPPLIER_DEBT_SUM_TOTAL, 2)} SUM<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">{t("Баланс")}</span></p>
          </div>
          <div className="rounded-md bg-white p-6 shadow-sm">
            <Donut shares={supplierDebtUsdShares} />
            <p className="mt-4 text-center font-semibold">{money(SUPPLIER_DEBT_USD_TOTAL, 3)} USD<br /><span className="text-[13px] font-normal uppercase text-[#9aa3b6]">{t("Баланс")}</span></p>
          </div>
        </div>
        <div className="mt-6 overflow-hidden rounded-md bg-white shadow-sm">
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{t("Поставщик")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на начало")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на конец")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Разница")}</th>
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
          <h2 className="border-b border-[#e1e5eb] px-6 py-4 text-lg font-semibold">{t("Прямые расходы")}</h2>
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr><th className="px-4 py-3 text-left font-semibold">{t("Категория")}</th><th className="px-4 py-3 text-left font-semibold">{t("Сумма (SUM)")}</th></tr>
            </thead>
            <tbody><tr><td colSpan={2}><EmptyBlock label={t("Нет данных")} /></td></tr></tbody>
            <tfoot><tr className="border-t border-[#e1e5eb] font-semibold"><td className="px-4 py-3.5">{t("Итого")}</td><td className="px-4 py-3.5">0</td></tr></tfoot>
          </table>
        </div>
        <div className="rounded-md bg-white shadow-sm">
          <h2 className="border-b border-[#e1e5eb] px-6 py-4 text-lg font-semibold">{t("Косвенные расходы")}</h2>
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr><th className="px-4 py-3 text-left font-semibold">{t("Категория")}</th><th className="px-4 py-3 text-left font-semibold">{t("Сумма (SUM)")}</th></tr>
            </thead>
            <tbody><tr><td colSpan={2}><EmptyBlock label={t("Нет данных")} /></td></tr></tbody>
            <tfoot><tr className="border-t border-[#e1e5eb] font-semibold"><td className="px-4 py-3.5">{t("Итого")}</td><td className="px-4 py-3.5">0</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("Реализация по категориям")}</h2>
          <div className="flex overflow-hidden rounded-sm">
            <button onClick={() => setCategoryMode("type")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${categoryMode === "type" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{t("Тип продукта")}</button>
            <button onClick={() => setCategoryMode("brand")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${categoryMode === "brand" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{t("Бренд")}</button>
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">{t("Реализация")}</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">{t("Возвраты")}</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">{t("Чистая реализация")}</p></div>
          <div className="rounded-md bg-[#f6f9fc] py-4 text-center"><p className="text-xl font-bold">0</p><p className="mt-1 text-[13px] text-[#586174]">{t("Валовая прибыль")}</p></div>
        </div>
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-[#f6f9fc] text-[#586174]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">{t("Название")}</th>
              <th className="px-4 py-3 text-left font-semibold">{t("Реализация")}</th>
              <th className="px-4 py-3 text-left font-semibold">{t("Возвраты")}</th>
              <th className="px-4 py-3 text-left font-semibold">{t("Чистая реализация")}</th>
              <th className="px-4 py-3 text-left font-semibold">{t("Валовая прибыль")}</th>
              <th className="px-4 py-3 text-left font-semibold">{t("Рентабельность ВП")}</th>
            </tr>
          </thead>
          <tbody><tr><td colSpan={6}><EmptyBlock label={t("Нет данных")} /></td></tr></tbody>
        </table>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("Прибыль от агентов")}</h2>
          <div className="flex overflow-hidden rounded-sm">
            {agentProfitToggleOptions.map((option) => (
              <button key={option} onClick={() => setAgentProfitMode(option)} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${agentProfitMode === option ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{t(option)}</button>
            ))}
          </div>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-6">
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">{t("Баланс на начало периода")}</p>
          </div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Приход за период")}</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Расход за период")}</p></div>
          <div><p className="font-bold text-[#3aa76d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Перевод в кассу")}</p></div>
          <div><p className="font-bold text-[#e5484d]">0 Euro, 0 SUM, 0 USD</p><p className="text-[13px] text-[#586174]">{t("Перевод с кассы")}</p></div>
          <div>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.euro)} Euro,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.sum, 2)} SUM,</p>
            <p className="font-bold text-[#4f70e7]">{money(CASH_TOTALS.usd, 3)} USD</p>
            <p className="text-[13px] text-[#586174]">{t("Баланс на конец периода")}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">{t("Кассы")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на начало")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Баланс на конец")}</th>
                <th className="px-4 py-3 text-left font-semibold">{t("Разница")}</th>
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
          <button onClick={() => setWarehouseTab("cost")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "cost" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>{t("Себестоимость")}</button>
          <button onClick={() => setWarehouseTab("priceList")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseTab === "priceList" ? "bg-[#4f70e7] text-white" : "border border-[#4f70e7] text-[#4f70e7]"}`}>{t("Прайс лист")}</button>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${warehouses.reduce<{ acc: number; parts: string[] }>((state, row, index) => { const colors = ["#3b82f6", "#22c55e", "#ef4444", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16"]; const start = state.acc; const end = start + row.sharePercent; return { acc: end, parts: [...state.parts, `${colors[index % colors.length]} ${start}% ${end}%`] } }, { acc: 0, parts: [] }).parts.join(", ")})` }}>
            <div className="flex h-[180px] w-[180px] flex-col items-center justify-center rounded-full bg-white text-center">
              <strong className="text-lg">{money(warehouseTab === "cost" ? WAREHOUSE_TOTAL : WAREHOUSE_TOTAL * 1.18)} SUM</strong>
              <span className="mt-1 text-[13px] uppercase text-[#9aa3b6]">{t("Сумма на складе")}<br />{t("на конец периода")}</span>
            </div>
          </div>
          <div>
            <table className="w-full border-collapse text-[14px]">
              <thead className="bg-[#f6f9fc] text-[#586174]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">{t("Склад")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("Баланс на начало")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("Баланс на конец")}</th>
                  <th className="px-4 py-3 text-left font-semibold">{t("Разница")}</th>
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
            <button onClick={() => setWarehouseDisplay("text")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "text" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{t("Текст")}</button>
            <button onClick={() => setWarehouseDisplay("chart")} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${warehouseDisplay === "chart" ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{t("График")}</button>
          </div>
        </div>
      </section>
    </main>
  )
}
