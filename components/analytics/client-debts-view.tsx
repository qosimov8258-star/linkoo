"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart, ChevronDown, Expand, Filter, Settings, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

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

type DebtRow = {
  id: number
  client: string
  daysPassed: number
  orderAmount: number
  orderCurrency: "SUM" | "USD"
  debt: number
  dueDate: string
  agent: string
  totalDebtSum: number
  totalDebtUsd: number
  totalDebtEur: number
  courier: string
  realizationDate: string
  deliveryDate: string
  createdAt: string
}

const rows: DebtRow[] = []

type ClientDebtProfile = {
  id: number
  client: string
  overSum: number
  overUsd: number
  phone: string
  address: string
  landmark: string
  agent: string
  type: string
}

const clientProfiles: ClientDebtProfile[] = []

const TOTAL_ORDERS = 0
const TOTAL_CLIENTS = 0

const number = (value: number, maxFraction = 3) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: maxFraction }).format(value)

function AmountCell({ value, fraction = 3 }: { value: number; fraction?: number }) {
  if (value === 0) return <span>0</span>
  return <span className="font-semibold text-[#e5484d]">{number(value, fraction)}</span>
}

function SelectField({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  const { t } = useLanguage()
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium text-[#586174]">
      {t(label)}
      <select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal text-[#17233b] outline-none">
        {options.map((option) => <option key={option} value={option}>{t(option)}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
    </label>
  )
}

export function ClientDebtsView() {
  const { t } = useLanguage()
  const router = useRouter()
  const [view, setView] = useState<"clients" | "orders">("orders")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [needsRecalc, setNeedsRecalc] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)

  const [p1, setP1] = useState(7)
  const [p2, setP2] = useState(30)
  const [p3, setP3] = useState(120)
  const [p1Draft, setP1Draft] = useState("7")
  const [p2Draft, setP2Draft] = useState("30")
  const [p3Draft, setP3Draft] = useState("120")

  const [branch, setBranch] = useState("Все филиалы")
  const [organization, setOrganization] = useState("Все организации")
  const [orderCreator, setOrderCreator] = useState("Все")
  const [courierFilter, setCourierFilter] = useState("Все")
  const [clientType, setClientType] = useState("Все типы")
  const [confirmStatus, setConfirmStatus] = useState("Все")
  const [zone, setZone] = useState("Все зоны")
  const [orderStatus, setOrderStatus] = useState("Все")
  const [transactionType, setTransactionType] = useState("Все")
  const [paymentType, setPaymentType] = useState("Все")
  const [hasDebtPeriod, setHasDebtPeriod] = useState("Не важно")
  const [daysFrom, setDaysFrom] = useState("")
  const [daysTo, setDaysTo] = useState("")
  const [onlyNeedsRecalc, setOnlyNeedsRecalc] = useState(false)

  const filteredOrders = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const filteredClients = useMemo(
    () => clientProfiles.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const visibleCount = view === "orders" ? filteredOrders.length : filteredClients.length
  const maxPage = Math.max(1, Math.ceil(visibleCount / pageSize))
  const safePage = Math.min(page, maxPage)
  const visibleOrders = filteredOrders.slice((safePage - 1) * pageSize, safePage * pageSize)
  const visibleClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const ordersTotalLabel = isDefaultView ? TOTAL_ORDERS : filteredOrders.length
  const clientsTotalLabel = isDefaultView ? TOTAL_CLIENTS : filteredClients.length

  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const savePeriods = () => {
    const first = Number(p1Draft) || p1
    const second = Number(p2Draft) || p2
    const third = Number(p3Draft) || p3
    setP1(first)
    setP2(second)
    setP3(third)
    setPeriodOpen(false)
  }

  const downloadAll = () => {
    if (view === "orders") {
      const header = [t("Заказ №"), t("Клиент"), t("Прошло дней"), t("Сумма заказа"), t("Долг"), t("Срок оплаты"), t("Агент"), t("Общий долг SUM"), t("Общий долг USD"), t("Общий долг Euro"), t("Доставщик"), t("Дата реализации"), t("Дата доставки"), t("Дата создания")]
      const body = filteredOrders.map((row) => [row.id, row.client, row.daysPassed, `${number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} ${row.orderCurrency}`, number(row.debt, row.debt % 1 ? 2 : 0), row.dueDate, row.agent, number(row.totalDebtSum, 2), number(row.totalDebtUsd, 3), number(row.totalDebtEur), row.courier, row.realizationDate, row.deliveryDate, row.createdAt])
      downloadExcelTable("client-debts-orders", [header, ...body])
    } else {
      const header = [t("Клиент"), `${t("Прошло до")} ${p1} ${t("дней SUM")}`, "USD", `${t("С")} ${p1} ${t("дней - До")} ${p2} SUM`, "USD", `${t("С")} ${p2} ${t("дней - До")} ${p3} SUM`, "USD", `${t("Больше")} ${p3} ${t("дней SUM")}`, "USD", t("Итого SUM"), "USD", t("Тел"), t("Адрес"), t("Ориентир"), t("Ответственный агент"), t("Тип")]
      const body = filteredClients.map((row) => [row.client, 0, 0, 0, 0, 0, 0, number(row.overSum, 2), number(row.overUsd, 3), number(row.overSum, 2), number(row.overUsd, 3), row.phone, row.address, row.landmark, row.agent, row.type])
      downloadExcelTable("client-debts-clients", [header, ...body])
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f71dc]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Долги с заказов")}</span>
        </div>
        <nav className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "ДОЛГ КЛИЕНТОВ" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
            >
              {t(tab)}
            </button>
          ))}
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> {t("Фильтр")}
        </button>
        <span className="font-semibold text-[#4f71dc]">{t("Во всей организации")}</span>
        <button onClick={() => { setP1Draft(String(p1)); setP2Draft(String(p2)); setP3Draft(String(p3)); setPeriodOpen(true) }} className="ml-auto flex h-11 items-center gap-2 rounded-md border border-[#4f71dc] px-5 font-semibold text-[#4f71dc]">
          <Settings className="h-5 w-5" /> {t("Настроить период")}
        </button>
        <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> {t("Скачать")}
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-5 md:px-9">
        <div>
          <p className="text-[#586174]">{t("Прошло до")} {p1} {t("дней")}</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f71dc]">0</span> / <span className="text-[#4f71dc]">0</span> {t("Заказов обработано")}</p>
        </div>
        <div>
          <p className="text-[#586174]">{t("С")} {p1} {t("дней - До")} {p2}</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f71dc]">0</span> / <span className="text-[#4f71dc]">0</span> {t("Заказов обработано")}</p>
        </div>
        <div>
          <p className="text-[#586174]">{t("С")} {p2} {t("дней - До")} {p3}</p>
          <p className="font-semibold text-[#e5484d]">0 SUM</p>
          <p className="font-semibold text-[#e0952e]">0 USD</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f71dc]">0</span> / <span className="text-[#4f71dc]">0</span> {t("Заказов обработано")}</p>
        </div>
        <div>
          <p className="text-[#586174]">{t("Больше")} {p3} {t("дней")}</p>
          <p className="font-semibold text-[#e5484d]">0 Euro</p>
          <p className="font-semibold text-[#e5484d]">0 SUM</p>
          <p className="font-semibold text-[#e5484d]">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">{t("Общий долг")}</p>
          <p className="font-semibold text-[#e5484d]">0 Euro</p>
          <p className="font-semibold text-[#e5484d]">0 SUM</p>
          <p className="font-semibold text-[#e5484d]">0 USD</p>
          <p className="mt-2 font-semibold"><span className="text-[#4f71dc]">0</span> / <span className="text-[#4f71dc]">0</span> {t("Заказов обработано")}</p>
        </div>
      </section>

      {needsRecalc > 0 && (
        <section className="mx-6 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#f5c2c7] bg-[#fdecee] px-6 py-4 md:mx-9">
          <p className="text-[#c53238]">{t("Требуется перерасчет долгов клиентов")}: {needsRecalc} {t("шт. Долги этих клиентов исключены из итогов")}</p>
          <button onClick={() => setNeedsRecalc(0)} className="rounded-md bg-[#4f71dc] px-5 py-2.5 font-semibold text-white">{t("Пересчитать")}</button>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 px-6 py-3 md:px-9">
        <h2 className="text-lg font-semibold text-[#586174]">{t("Статистика по должникам")}</h2>
        <div className="flex overflow-hidden rounded-md">
          <button onClick={() => { setView("clients"); setPage(1) }} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${view === "clients" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>{t("Клиенты")}</button>
          <button onClick={() => { setView("orders"); setPage(1) }} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${view === "orders" ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] text-[#4f71dc]"}`}>{t("Заказы")}</button>
        </div>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{visibleCount ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, visibleCount)} {t("из")} {view === "orders" ? ordersTotalLabel : clientsTotalLabel}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f71dc] p-1 text-[#4f71dc] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      <section className="overflow-x-auto bg-white pb-10">
        {view === "orders" ? (
          <table className="min-w-[1900px] w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Заказ №")}</th>
                <th className="px-2 py-3" />
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Клиент")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Прошло дней")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Сумма заказа")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Долг")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Срок оплаты")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Агент")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Общий долг (SUM)")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Общий долг (USD)")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Общий долг (Euro)")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Доставщик")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Дата реализации")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Дата доставки")}</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t("Дата создания")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.id}</td>
                  <td className="border-t border-[#e1e5eb] px-2 py-3.5 text-center">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} className="h-4 w-4 accent-[#4f71dc]" />
                  </td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 font-medium text-[#4f71dc]">{row.client}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.daysPassed}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} {row.orderCurrency}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#e5484d]">{number(row.debt, row.debt % 1 ? 2 : 0)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#4f71dc]">{row.dueDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.agent}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5 text-[#e5484d]">{number(row.totalDebtSum, 2)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.totalDebtUsd, 3)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.totalDebtEur)}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.courier}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.realizationDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.deliveryDate}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.createdAt}</td>
                </tr>
              ))}
              {visibleOrders.length === 0 && (
                <tr><td colSpan={15} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">{t("Ничего не найдено")}</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-[2100px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-[#253653]">
                <th className="border border-[#e1e5eb] px-4 py-2" />
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("Прошло до")} {p1} {t("дней")}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("С")} {p1} {t("дней - До")} {p2}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("С")} {p2} {t("дней - До")} {p3}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("Больше")} {p3} {t("дней")}</th>
                <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("Итого")}</th>
                <th colSpan={5} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{t("Дополнительная информация")}</th>
              </tr>
              <tr className="bg-white text-[#17233b]">
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Клиенты")}</th>
                {Array.from({ length: 5 }).map((_, groupIndex) =>
                  ["SUM", "USD", "Euro"].map((currency) => (
                    <th key={`${groupIndex}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                  )),
                )}
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Тел")}</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Адрес")}</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Ориентир")}</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Ответственный агент")}</th>
                <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{t("Тип")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleClients.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.client}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overSum} fraction={2} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overUsd} fraction={3} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overSum} fraction={2} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5"><AmountCell value={row.overUsd} fraction={3} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">0</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.phone}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.address}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.landmark}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.agent}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.type}</td>
                </tr>
              ))}
              {visibleClients.length === 0 && (
                <tr><td colSpan={20} className="border-t border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">{t("Ничего не найдено")}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {periodOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setPeriodOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[500px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">{t("Настроить период")}</h2>
              <button aria-label={t("Закрыть")} onClick={() => setPeriodOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="space-y-7 px-8 py-7">
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Первый период")}
                <input type="number" min={1} value={p1Draft} onChange={(event) => setP1Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Второй период")}
                <input type="number" min={1} value={p2Draft} onChange={(event) => setP2Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Третий период")}
                <input type="number" min={1} value={p3Draft} onChange={(event) => setP3Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={savePeriods} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">{t("Сохранить")}</button>
            </footer>
          </div>
        </div>
      )}

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[1100px] max-w-[94vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-semibold text-[#586174]">{t("Фильтр")}</h2>
              <button aria-label={t("Закрыть")} onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </header>
            <div className="grid grid-cols-1 gap-x-10 gap-y-7 px-8 py-7 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label="Филиалы" value={branch} setValue={setBranch} options={["Все филиалы", "Самарканд", "Ташкент", "Наманган"]} />
              <SelectField label="Организация" value={organization} setValue={setOrganization} options={["Все организации", "Linko"]} />
              <SelectField label="Заказ оформил" value={orderCreator} setValue={setOrderCreator} options={["Все", "Admin Ritm", "Тп 1 Исмоилов Гани", "Тп 2 Алиса"]} />
              <SelectField label="Доставщик" value={courierFilter} setValue={setCourierFilter} options={["Все", "Admin Ritm", "Quvonchbek Admin", "Хайрулло Доставщик"]} />
              <SelectField label="Тип клиента" value={clientType} setValue={setClientType} options={["Все типы", "Оптовый", "Розничный", "Розница"]} />
              <SelectField label="Статус подтверждения клиента" value={confirmStatus} setValue={setConfirmStatus} options={["Все", "Подтвержден", "Не подтвержден"]} />
              <SelectField label="Зона" value={zone} setValue={setZone} options={["Все зоны", "Розничный", "Рабочий", "Не рабочий зона"]} />
              <SelectField label="Статус заказа" value={orderStatus} setValue={setOrderStatus} options={["Все", "Доставлен", "В пути", "Отменен"]} />
              <SelectField label="Тип оплаты (транзакции)" value={transactionType} setValue={setTransactionType} options={["Все", "Наличными", "Перечислением"]} />
              <SelectField label="Тип оплаты" value={paymentType} setValue={setPaymentType} options={["Все", "SUM", "USD", "Euro"]} />
              <SelectField label="Есть задолженность за период" value={hasDebtPeriod} setValue={setHasDebtPeriod} options={["Не важно", "Да", "Нет"]} />
              <div>
                <p className="mb-1 text-[13px] font-medium text-[#586174]">{t("Прошло дней с последней оплаты")}</p>
                <div className="flex items-center gap-3">
                  <input value={daysFrom} onChange={(event) => setDaysFrom(event.target.value)} type="number" placeholder={t("От (дней)")} className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
                  <input value={daysTo} onChange={(event) => setDaysTo(event.target.value)} type="number" placeholder={t("До (дней)")} className="w-full border-b border-[#dbe0e8] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#586174]" />
                </div>
              </div>
              {(["Период создания", "Дата доставки", "Период даты оплаты", "Период реализации"] as const).map((label) => (
                <label key={label} className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                  {t(label)}
                  <input type="date" className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
                </label>
              ))}
            </div>
            <div className="border-t px-8 py-6">
              <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
                <input type="checkbox" checked={onlyNeedsRecalc} onChange={(event) => setOnlyNeedsRecalc(event.target.checked)} className="h-4 w-4 accent-[#4f71dc]" />
                {t("Требуется перерасчет")}
              </label>
            </div>
            <div className="px-8 pb-8">
              <button onClick={() => setFilterOpen(false)} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">{t("Применить")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
