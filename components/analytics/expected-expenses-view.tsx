"use client"

import { Fragment, useMemo, useState } from "react"
import { ChevronDown, Search } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Status = "pending" | "confirmed" | "paid" | "cancelled"
type ExpenseRow = {
  id: number
  supplier: string
  date: string
  debt: number
  stock: number
  amount: number
  currency: "SUM" | "USD" | "Euro"
  status: Status
  comment?: string
}

const rows: ExpenseRow[] = []

const statusLabel: Record<Status, string> = {
  pending: "В ожидании",
  confirmed: "Подтвержден",
  paid: "Оплачен",
  cancelled: "Отменен",
}
const statusColor: Record<Status, string> = {
  pending: "text-[#e0952e]",
  confirmed: "text-[#5868f5]",
  paid: "text-[#3aa76d]",
  cancelled: "text-[#e5484d]",
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

export function ExpectedExpensesView() {
  const [tab, setTab] = useState<"pending" | "confirmed" | "paid" | "all">("all")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "all" && row.status !== tab) return false
      if (search.trim() && !row.supplier.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      return true
    })
  }, [search, tab])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleExpand = (id: number) => {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f71dc]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Ожидаемые расходы</span>
        </div>
      </header>

      <section className="grid grid-cols-1 border-b border-[#e1e5eb] bg-white text-center sm:grid-cols-4">
        {(
          [
            ["pending", "В ожидании"],
            ["confirmed", "Подтвержденные"],
            ["paid", "Оплаченные"],
            ["all", "Все"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); setExpandedId(null) }}
            className={`border-b-2 py-4 text-[16px] font-medium ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-4 border-b border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f71dc] p-1 text-[#4f71dc] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
      </section>

      <section className="overflow-x-auto bg-white pb-10">
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              {["№", "Поставщик", "Дата создания", "Задолженность", "Запас", "Сумма оплаты", "Статус"].map((title) => (
                <th key={title} className="whitespace-nowrap px-4 py-4 text-left font-semibold">{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <Fragment key={row.id}>
                <tr
                  onClick={() => toggleExpand(row.id)}
                  className={`cursor-pointer border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} hover:bg-[#eef2ff]`}
                >
                  <td className="px-4 py-4">{row.id}</td>
                  <td className="px-4 py-4 font-medium text-[#4f71dc]">{row.supplier}</td>
                  <td className="px-4 py-4">{row.date}</td>
                  <td className="px-4 py-4">{row.debt === 0 ? <span className="text-[#4f71dc]">0</span> : number(row.debt)}</td>
                  <td className="px-4 py-4">{row.stock === 0 ? <span className="text-[#4f71dc]">0</span> : number(row.stock)}</td>
                  <td className="px-4 py-4">{number(row.amount)} {row.currency}</td>
                  <td className={`px-4 py-4 font-medium ${statusColor[row.status]}`}>{statusLabel[row.status]}</td>
                </tr>
                {expandedId === row.id && (
                  <tr>
                    <td colSpan={7} className="bg-[#f6f9fc] px-6 py-6">
                      <div className="rounded-md bg-white p-6 shadow-md">
                        <h3 className="mb-5 text-lg font-bold">
                          Запрос №{row.id} <span className={statusColor[row.status]}>({statusLabel[row.status]})</span>
                        </h3>
                        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                          <div className="space-y-4">
                            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                              <span className="text-[#586174]">Поставщик</span>
                              <span className="font-semibold">{row.supplier}</span>
                            </div>
                            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                              <span className="text-[#586174]">Сумма оплаты</span>
                              <span className="font-semibold">{number(row.amount)} {row.currency}</span>
                            </div>
                            <h4 className="pt-3 text-[13px] font-bold uppercase tracking-wide text-[#586174]">Оплата:</h4>
                            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                              <span className="text-[#586174]">Баланс</span>
                              <span className="font-semibold">0 {row.currency}</span>
                            </div>
                            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                              <span className="text-[#586174]">Резерв</span>
                              <span className="font-semibold">0 {row.currency}</span>
                            </div>
                            <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                              <span className="text-[#586174]">К оплате</span>
                              <span className="font-semibold">{row.status === "cancelled" ? 0 : number(row.amount)} {row.currency}</span>
                            </div>
                          </div>
                          <div>
                            <h4 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-[#586174]">Комментарий:</h4>
                            <p>{row.comment ?? "Не указано"}</p>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
