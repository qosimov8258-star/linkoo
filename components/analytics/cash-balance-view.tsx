"use client"

import { useMemo, useState } from "react"
import { BarChart, Calendar, ChevronsUpDown, Filter, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

type Currency = "SUM" | "USD" | "Euro"
type Register = {
  id: number
  name: string
  openingAmount: number
  openingCurrency: Currency
  income: number
  expense: number
  transferIn: number
  transferOut: number
  cashier: string
  type: "Наличными" | "Перечислением"
}

const registers: Register[] = [
  { id: 1, name: "aaaa1", openingAmount: 20, openingCurrency: "Euro", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 2, name: "adaw", openingAmount: 223123, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Перечислением" },
  { id: 3, name: "Агент", openingAmount: 0, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Перечислением" },
  { id: 4, name: "Ahmad", openingAmount: 0, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "onec onec", type: "Перечислением" },
  { id: 5, name: "Карим2", openingAmount: 23.36, openingCurrency: "USD", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 6, name: "Карим1", openingAmount: 191040, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 7, name: "kassa11", openingAmount: 500010000, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Перечислением" },
  { id: 8, name: "naqd", openingAmount: 24973894819.94, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Temur Raupov", type: "Перечислением" },
  { id: 9, name: "ПРОФРЕШ", openingAmount: 131598640, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 10, name: "payme", openingAmount: 73985451.5, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Админ 1", type: "Перечислением" },
  { id: 11, name: "Salohiddin Kassa Tashkent", openingAmount: 56370751, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Salohiddin Kassir Tashkent", type: "Наличными" },
  { id: 12, name: "SUM", openingAmount: 55238744, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 13, name: "Xorazm kassasi", openingAmount: 21203400, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "universal kassir", type: "Наличными" },
  { id: 14, name: "Salohiddin Kassa Farg'ona", openingAmount: 15325002, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Salohiddin Kassir Farg'ona", type: "Наличными" },
  { id: 15, name: "Pullar", openingAmount: 12432000, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 16, name: "novza", openingAmount: 10826200, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "test test", type: "Наличными" },
  { id: 17, name: "05,08,2025", openingAmount: 9900000, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 18, name: "Касса Центральный — Наличные", openingAmount: 6800000, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Шохрух Туляганов", type: "Наличными" },
  { id: 19, name: "Orbit", openingAmount: 5853090, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Тп 2 Алиса", type: "Наличными" },
  { id: 20, name: "test_dilmurod_kassa", openingAmount: 5000000, openingCurrency: "USD", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Admin Ritm", type: "Наличными" },
  { id: 21, name: "Касса Центральный — Карта", openingAmount: 2100000, openingCurrency: "SUM", income: 0, expense: 0, transferIn: 0, transferOut: 0, cashier: "Шохрух Туляганов", type: "Перечислением" },
]

const FIXED_TOTALS = { opening: { euro: 20, sum: 25884392057.44, usd: 6577793.296 }, closing: { euro: 20, sum: 25884392057.44, usd: 6577793.296 } }

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function formatDate(date: Date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

function AmountCell({ amount, currency }: { amount: number; currency: Currency }) {
  if (amount === 0) return <span>0</span>
  const color = amount > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(amount)} {currency}</span>
}

function ZeroCell() {
  return <span>0</span>
}

type SortKey = "opening" | "income" | "expense" | "transferIn" | "transferOut" | "closing"
type SortDir = "asc" | "desc"

function SortableHeader({ label, sortKey, active, dir, onSort }: { label: string; sortKey: SortKey; active: boolean; dir: SortDir; onSort: (key: SortKey) => void }) {
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(sortKey) } }}
      className="cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-semibold text-white hover:bg-[#4462d1]"
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        <ChevronsUpDown className={`h-3.5 w-3.5 transition ${active ? "text-white" : "text-white/60"} ${active && dir === "desc" ? "rotate-180" : ""}`} />
      </span>
    </th>
  )
}

export function CashBalanceView() {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const today = useMemo(() => new Date(), [])
  const defaultFrom = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() - 2); return d }, [today])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [appliedFrom, setAppliedFrom] = useState(() => formatDate(defaultFrom))
  const [appliedTo, setAppliedTo] = useState(() => formatDate(today))

  const filterCount = appliedFrom && appliedTo ? 1 : 0

  const sorted = useMemo(() => {
    if (!sortKey) return registers
    const copy = [...registers]
    copy.sort((a, b) => {
      const valueOf = (row: Register) => {
        if (sortKey === "opening") return row.openingAmount
        if (sortKey === "closing") return row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
        return row[sortKey]
      }
      const result = valueOf(a) - valueOf(b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const applyFilter = () => {
    if (dateFrom) setAppliedFrom(formatDate(new Date(dateFrom)))
    if (dateTo) setAppliedTo(formatDate(new Date(dateTo)))
    setFilterOpen(false)
  }

  const downloadAll = () => {
    const header = ["Кассы", "Баланс на начало периода", "Приход за период", "Расход за период", "Перевод на кассу", "Перевод с кассы", "Баланс на конец периода", "Кассир", "Тип"]
    const body = sorted.map((row) => {
      const closing = row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
      return [
        row.name,
        row.openingAmount === 0 ? "0" : `${money(row.openingAmount)} ${row.openingCurrency}`,
        row.income,
        row.expense,
        row.transferIn,
        row.transferOut,
        closing === 0 ? "0" : `${money(closing)} ${row.openingCurrency}`,
        row.cashier,
        row.type,
      ]
    })
    downloadExcelTable("cash-balance.xls", [header, ...body])
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f71dc]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс кассы</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Фильтр / {filterCount}
        </button>
        <span className="font-semibold text-[#4f71dc]">{appliedFrom} - {appliedTo}</span>
        <span className="text-[#586174]">Во всей организации</span>
        <button onClick={downloadAll} className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold">{FIXED_TOTALS.opening.euro} Euro</p>
          <p className="font-semibold">{money(FIXED_TOTALS.opening.sum)} SUM</p>
          <p className="font-semibold">{money(FIXED_TOTALS.opening.usd)} USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Приход за период</p>
          <p className="font-semibold text-[#3aa76d]">0 Euro</p>
          <p className="font-semibold text-[#3aa76d]">0 SUM</p>
          <p className="font-semibold text-[#3aa76d]">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Перевод на кассу</p>
          <p className="font-semibold text-[#3aa76d]">0 Euro</p>
          <p className="font-semibold text-[#3aa76d]">0 SUM</p>
          <p className="font-semibold text-[#3aa76d]">0 USD</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold">{FIXED_TOTALS.closing.euro} Euro</p>
          <p className="font-semibold">{money(FIXED_TOTALS.closing.sum)} SUM</p>
          <p className="font-semibold">{money(FIXED_TOTALS.closing.usd)} USD</p>
        </div>
        <div className="sm:col-start-2 lg:col-start-2">
          <p className="text-[#586174]">Расход за период</p>
          <p className="font-semibold text-[#e5484d]">0 Euro</p>
          <p className="font-semibold text-[#e5484d]">0 SUM</p>
          <p className="font-semibold text-[#e5484d]">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Перевод с кассы</p>
          <p className="font-semibold text-[#e5484d]">0 Euro</p>
          <p className="font-semibold text-[#e5484d]">0 SUM</p>
          <p className="font-semibold text-[#e5484d]">0 USD</p>
        </div>
      </section>

      <section className="overflow-x-auto pb-10">
        <table className="min-w-[1400px] w-full border-collapse text-[14px]">
          <thead className="bg-[#4f71dc]">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-white">Кассы</th>
              <SortableHeader label="Баланс на начало периода" sortKey="opening" active={sortKey === "opening"} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Приход за период" sortKey="income" active={sortKey === "income"} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Расход за период" sortKey="expense" active={sortKey === "expense"} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Перевод на кассу" sortKey="transferIn" active={sortKey === "transferIn"} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Перевод с кассы" sortKey="transferOut" active={sortKey === "transferOut"} dir={sortDir} onSort={toggleSort} />
              <SortableHeader label="Баланс на конец периода" sortKey="closing" active={sortKey === "closing"} dir={sortDir} onSort={toggleSort} />
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-white">Кассир</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-white">Тип</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const closing = row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
              return (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-4">{row.name}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><AmountCell amount={row.openingAmount} currency={row.openingCurrency} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><ZeroCell /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><ZeroCell /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><ZeroCell /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><ZeroCell /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4"><AmountCell amount={closing} currency={row.openingCurrency} /></td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4">{row.cashier}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-4">{row.type}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-24" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </header>
            <div className="px-8 py-7">
              <div className="mb-2 flex items-center justify-between text-[13px] font-medium text-[#586174]">
                <span>Диапазон дат</span>
                <Calendar className="h-4 w-4 text-[#9aa3b6]" />
              </div>
              <div className="flex items-center gap-3 border-b border-[#dbe0e8] pb-2">
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} placeholder="Укажите дату" className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#9aa3b6]" />
                <span className="text-[#9aa3b6]">—</span>
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} placeholder="Укажите дату" className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              </div>
            </div>
            <div className="px-8 pb-8">
              <button onClick={applyFilter} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">Применить</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
