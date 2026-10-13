"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ChevronDown, Pencil, Star, X } from "lucide-react"
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

const periods = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"] as const
const metrics = ["АКБ", "ОКБ", "ИНДЕКС АКБ", "ПРОДАЖИ"] as const
const salesRanges = ["ПО ДНЯМ", "ПО НЕДЕЛЯМ", "ПО МЕСЯЦАМ"] as const

type BreakdownKey = "type" | "territory" | "user" | "product"
const breakdownSections: { key: BreakdownKey; title: string; totalOkb: number }[] = [
  { key: "type", title: "Продажи по типу клиента", totalOkb: 0 },
  { key: "territory", title: "Продажи по территории", totalOkb: 0 },
  { key: "user", title: "Продажи по пользователям", totalOkb: 0 },
  { key: "product", title: "Продажи по типу продукта", totalOkb: 0 },
]

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14">
      <Image src="/robot-mascot.png" alt="Робот-помощник" width={96} height={96} className="h-24 w-24 object-contain" />
      <p className="mt-3 text-[#9aa3b6]">{label}</p>
    </div>
  )
}

function SortableTh({ label, sortKey, active, onSort }: { label: string; sortKey: string; active: boolean; onSort: (key: string) => void }) {
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(sortKey) } }}
      className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-semibold ${active ? "text-[#4f71dc]" : "text-[#586174]"} hover:text-[#4f71dc]`}
    >
      <span className="inline-flex items-center gap-1.5">{label}<ChevronDown className="h-3.5 w-3.5" /></span>
    </th>
  )
}

export function SalesTabView() {
  const router = useRouter()
  const [period, setPeriod] = useState<(typeof periods)[number]>("МЕСЯЦ")
  const [metric, setMetric] = useState<(typeof metrics)[number]>("ПРОДАЖИ")
  const [filterActive, setFilterActive] = useState(true)
  const [filterLabel, setFilterLabel] = useState("Все филиалы")
  const [filterEditOpen, setFilterEditOpen] = useState(false)
  const [salesRange, setSalesRange] = useState<(typeof salesRanges)[number]>("ПО ДНЯМ")
  const [sortState, setSortState] = useState<Record<BreakdownKey, string | null>>({ type: null, territory: null, user: null, product: null })

  const sortBy = (key: BreakdownKey, column: string) => {
    setSortState((current) => ({ ...current, [key]: current[key] === column ? null : column }))
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-xl font-bold text-[#4f71dc]" />
          <span className="text-2xl font-light text-[#586174]">|</span>
          <span className="text-xl font-bold text-[#586174]">Виджеты</span>
        </div>
        <nav className="ml-auto flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }}
              className={`rounded-md px-4 py-2.5 text-sm font-bold ${tab === "ПРОДАЖА" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] hover:bg-slate-100"}`}
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
        <div className="flex overflow-hidden rounded shadow">
          {periods.map((item) => (
            <button key={item} onClick={() => setPeriod(item)} className={`border px-5 py-2 text-sm font-medium ${period === item ? "bg-[#5470e8] text-white" : "bg-white"}`}>{item}</button>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 px-6 pb-6 md:px-9">
        {metrics.map((item) => (
          <button
            key={item}
            onClick={() => setMetric(item)}
            className={`rounded-sm px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${metric === item ? "bg-[#3aca6a] text-white" : "border border-[#e1e5eb] text-[#586174] hover:bg-slate-50"}`}
          >
            {item}
          </button>
        ))}
        {filterActive && (
          <div className="relative ml-auto flex items-center gap-2 rounded-md bg-[#f6f9fc] px-4 py-2 text-[#586174]">
            Фильтр: {filterLabel}
            <button type="button" onClick={() => setFilterEditOpen((value) => !value)} aria-label="Изменить фильтр"><Pencil className="h-4 w-4 text-[#9aa3b6] hover:text-[#4f71dc]" /></button>
            <button type="button" aria-label="Очистить фильтр" onClick={() => setFilterActive(false)}><X className="h-5 w-5 rounded-full border border-[#9aa3b6] p-0.5 text-[#9aa3b6] hover:text-[#e5484d]" /></button>
            {filterEditOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-64 border border-[#e1e5eb] bg-white p-4 shadow-xl">
                <label className="block text-xs font-medium text-[#586174]">
                  Филиал
                  <select value={filterLabel} onChange={(event) => setFilterLabel(event.target.value)} className="mt-1 block w-full border-b border-[#dbe0e8] bg-white py-2 text-sm outline-none">
                    <option>Все филиалы</option>
                    <option>777</option>
                    <option>878</option>
                    <option>Andijon</option>
                    <option>AURUM samarqand</option>
                  </select>
                </label>
                <button type="button" onClick={() => setFilterEditOpen(false)} className="mt-4 w-full rounded bg-[#5470e8] py-2 text-sm font-semibold text-white">Применить</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mx-6 mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 md:mx-9">
        <div className="rounded-md border border-[#e1e5eb] bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">Продажи по территории</h3>
          <EmptyBlock label="Ничего не найдено" />
        </div>
        <div className="rounded-md border border-[#e1e5eb] bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">Продажи по пользователям</h3>
          <EmptyBlock label="Ничего не найдено" />
        </div>
        <div className="rounded-md border border-[#e1e5eb] bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold">Продажи по типу продукта</h3>
          <EmptyBlock label="Ничего не найдено" />
        </div>
      </section>

      <section className="mx-6 mb-10 rounded-md bg-white p-6 shadow-sm md:mx-9">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Продажа</h2>
          <div className="flex items-center gap-6">
            <div className="flex overflow-hidden rounded-sm">
              {salesRanges.map((item) => (
                <button key={item} onClick={() => setSalesRange(item)} className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${salesRange === item ? "bg-[#3aca6a] text-white" : "border border-[#3aca6a] text-[#3aca6a]"}`}>{item}</button>
              ))}
            </div>
            <h2 className="text-lg font-semibold">По типам оплаты</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <EmptyBlock label="Ничего не найдено" />
          <EmptyBlock label="Ничего не найдено" />
        </div>
        <div className="mt-6 flex h-40 items-end border-b border-l border-[#e1e5eb] px-2 text-[#9aa3b6]" />
      </section>

      {breakdownSections.map((section) => (
        <section key={section.key} className="mx-6 mb-10 md:mx-9">
          <h2 className="mb-4 text-lg font-semibold">{section.title}</h2>
          <div className="overflow-hidden rounded-md bg-white shadow-sm">
            <table className="w-full border-collapse text-[14px]">
              <thead className="bg-[#f6f9fc]">
                <tr>
                  <SortableTh label="Название" sortKey="name" active={sortState[section.key] === "name"} onSort={(key) => sortBy(section.key, key)} />
                  <SortableTh label="ОКБ" sortKey="okb" active={sortState[section.key] === "okb"} onSort={(key) => sortBy(section.key, key)} />
                  <SortableTh label="АКБ" sortKey="akb" active={sortState[section.key] === "akb"} onSort={(key) => sortBy(section.key, key)} />
                  <SortableTh label="Индекс АКБ" sortKey="index" active={sortState[section.key] === "index"} onSort={(key) => sortBy(section.key, key)} />
                  <SortableTh label="Продажи" sortKey="sales" active={sortState[section.key] === "sales"} onSort={(key) => sortBy(section.key, key)} />
                </tr>
              </thead>
              <tbody>
                <tr><td colSpan={5}><EmptyBlock label="Нет данных" /></td></tr>
              </tbody>
              <tfoot>
                <tr className="border-t border-[#e1e5eb] font-semibold">
                  <td className="px-4 py-3.5">Итого</td>
                  <td className="px-4 py-3.5">{section.totalOkb}</td>
                  <td className="px-4 py-3.5">0</td>
                  <td className="px-4 py-3.5">0 %</td>
                  <td className="px-4 py-3.5">0</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </main>
  )
}
