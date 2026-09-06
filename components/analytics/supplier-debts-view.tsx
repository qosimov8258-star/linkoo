"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronsRight, Download, RefreshCw, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Money = { sum: number; usd: number; eur: number }
type DebtRow = {
  id: number
  name: string
  linkStyle?: boolean
  opening: Money
  shipment: Money
  refund: Money
  paid: Money
  correction: Money
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const supplierRows: DebtRow[] = []

const agentRows: DebtRow[] = []

const supplierTotals = { opening: { sum: 0, usd: 0, eur: 0 } }
const agentTotals = { opening: { sum: 0, usd: 0, eur: 0 } }

const TOTAL_SUPPLIERS = 0
const TOTAL_AGENTS = 0

const groups = ["Баланс на начало периода", "Отгрузка (Заказы)", "Возврат", "Оплачено", "Корректировка", "Баланс на конец периода"] as const
type GroupKey = "opening" | "shipment" | "refund" | "paid" | "correction" | "closing"
const groupKeys: GroupKey[] = ["opening", "shipment", "refund", "paid", "correction", "closing"]

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-[#4f70e7]">0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

function cellFor(row: DebtRow, key: GroupKey, currency: keyof Money): number {
  if (key === "closing") return row.opening[currency] + row.shipment[currency] - row.refund[currency] - row.paid[currency] + row.correction[currency]
  return row[key][currency]
}

export function SupplierDebtsView() {
  const [period, setPeriod] = useState<"today" | "month" | "custom">("today")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [debtTab, setDebtTab] = useState<"suppliers" | "agents">("suppliers")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [appliedOrganization, setAppliedOrganization] = useState("Все организации")
  const [search, setSearch] = useState("")
  const [cardsCollapsed, setCardsCollapsed] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const rows = debtTab === "suppliers" ? supplierRows : agentRows
  const totals = debtTab === "suppliers" ? supplierTotals : agentTotals
  const totalLabel = debtTab === "suppliers" ? TOTAL_SUPPLIERS : TOTAL_AGENTS
  const nameColumnLabel = debtTab === "suppliers" ? "Доставщик" : "Агент"

  const organizations = ["Все организации", "Linko", "NEW ORG", "energetik"]

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !row.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      return true
    })
  }, [rows, search])

  const applyFilter = () => {
    setAppliedOrganization(organizationFilter)
    setFilterOpen(false)
  }

  const downloadExcel = () => {
    const header = [nameColumnLabel, ...groups.flatMap((group) => [`${group} SUM`, `${group} USD`, `${group} Euro`])]
    const body = filtered.map((row) => {
      const cells = groupKeys.flatMap((key) => [
        cellFor(row, key, "sum"),
        cellFor(row, key, "usd"),
        cellFor(row, key, "eur"),
      ])
      return [row.name, ...cells]
    })
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = debtTab === "suppliers" ? "supplier-debts.xls" : "agent-debts.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const refresh = () => {
    setSearch("")
    setOrganizationFilter("Все организации")
    setAppliedOrganization("Все организации")
    setRefreshTick((value) => value + 1)
  }

  return (
    <main key={refreshTick} className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Долги доставщиков</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <div className="flex overflow-hidden rounded-sm border border-[#4f70e7]">
          {(
            [
              ["today", "Сегодня"],
              ["month", "Месяц"],
              ["custom", "Своя дата"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${period === key ? "bg-[#4f70e7] text-white" : "text-[#4f70e7]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-1.5 text-[15px]">
            <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="bg-transparent outline-none" />
            <span className="text-[#9aa3b6]">—</span>
            <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="bg-transparent outline-none" />
          </div>
        )}

        <div className="ml-auto flex overflow-hidden rounded-sm border border-[#4f70e7]">
          {(
            [
              ["suppliers", "Долги доставщиков"],
              ["agents", "Долги агентов"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setDebtTab(key); setSearch("") }}
              className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${debtTab === key ? "bg-[#4f70e7] text-white" : "text-[#4f70e7]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button onClick={downloadExcel} aria-label="Скачать" className="text-[#586174] hover:text-[#17233b]"><Download className="h-5 w-5" /></button>
        <button onClick={refresh} aria-label="Обновить" className="text-[#586174] hover:text-[#17233b]"><RefreshCw className="h-5 w-5" /></button>
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>
      </section>

      {filterOpen && (
        <section className="relative mx-6 mb-4 rounded-md border border-[#e1e5eb] bg-[#f6f9fc] px-6 py-6 md:mx-9">
          <button onClick={() => setFilterOpen(false)} aria-label="Закрыть фильтр" className="absolute right-4 top-4 text-[#9aa3b6] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Организация
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {organizations.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative min-w-[220px] border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Поиск по имени
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Введите имя" className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" />
            </label>
          </div>
          <button onClick={applyFilter} className="mt-6 rounded-md bg-[#6fcf97] px-8 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#5fbf87]">
            Применить
          </button>
        </section>
      )}

      {appliedOrganization !== "Все организации" && (
        <p className="mx-6 mb-2 text-sm text-[#586174] md:mx-9">Организация: <span className="font-semibold text-[#4f70e7]">{appliedOrganization}</span></p>
      )}

      {!cardsCollapsed && (
        <section className="relative grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-3 md:px-9">
          <div>
            <p className="text-[#586174]">Баланс на начало периода</p>
            <p className="font-semibold"><AmountCell value={totals.opening.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={totals.opening.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={totals.opening.usd} /> USD</p>
            <p className="mt-4 text-[#586174]">Отгрузка (Заказы)</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
          </div>
          <div>
            <p className="text-[#586174]">Возврат</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
            <p className="mt-4 text-[#586174]">Оплачено</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[#586174]">Корректировка</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
            <p className="mt-4 text-[#586174]">Баланс на конец периода</p>
            <p className="font-semibold"><AmountCell value={totals.opening.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={totals.opening.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={totals.opening.usd} /> USD</p>
          </div>
          <button
            onClick={() => setCardsCollapsed(true)}
            aria-label="Свернуть панель"
            className="absolute -right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#e1e5eb] bg-white text-[#9aa3b6] shadow-md hover:text-[#17233b]"
          >
            <ChevronsRight className="h-5 w-5" />
          </button>
        </section>
      )}
      {cardsCollapsed && (
        <div className="flex justify-end px-6 pb-4 md:px-9">
          <button onClick={() => setCardsCollapsed(false)} aria-label="Показать панель" className="flex items-center gap-1 text-sm font-medium text-[#4f70e7]">
            <ChevronsRight className="h-4 w-4 rotate-180" /> Показать итоги
          </button>
        </div>
      )}

      <section className="border-t border-[#e1e5eb] px-6 pt-4 text-sm text-[#586174] md:px-9">
        {filtered.length} {debtTab === "suppliers" ? "доставщиков" : "агентов"} из {totalLabel}
      </section>

      <section className="overflow-x-auto pb-10">
        <table className="min-w-[2300px] w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-[#edf2f7] text-[#253653]">
              <th className="border border-[#e1e5eb] px-4 py-2" />
              {groups.map((group) => (
                <th key={group} colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
              ))}
            </tr>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">{nameColumnLabel}</th>
              {groups.map((group) =>
                ["SUM", "USD", "Euro"].map((currency) => (
                  <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                <td className={`border-b border-[#e1e5eb] px-4 py-3.5 ${row.linkStyle ? "font-medium text-[#4f70e7] underline" : ""}`}>{row.name}</td>
                {groupKeys.map((key) =>
                  (["sum", "usd", "eur"] as const).map((currency) => (
                    <td key={`${row.id}-${key}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-3.5">
                      <AmountCell value={cellFor(row, key, currency)} />
                    </td>
                  )),
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={1 + groups.length * 3} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
