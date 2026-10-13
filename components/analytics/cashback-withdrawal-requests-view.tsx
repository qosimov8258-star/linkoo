"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Filter, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Status = "pending" | "confirmed" | "rejected"

type RequestRow = {
  id: number
  client: string
  amount: number
  currency: "SUM" | "USD" | "Euro"
  status: Status
}

const initialRows: RequestRow[] = []

const statusMeta: Record<Status, { label: string; className: string }> = {
  pending: { label: "В ожидании", className: "text-[#e0952e]" },
  confirmed: { label: "Подтверждено", className: "text-[#3aa76d]" },
  rejected: { label: "Отклонено", className: "text-[#e5484d]" },
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

export function CashbackWithdrawalRequestsView() {
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState("Все статусы")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    fetch("/api/cashback-withdrawal-requests")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as RequestRow[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (statusFilter !== "Все статусы" && statusMeta[row.status].label !== statusFilter) return false
      return true
    })
  }, [rows, search, statusFilter])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const setStatus = async (id: number, status: Status) => {
    const previous = rows
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)))
    try {
      const response = await fetch(`/api/cashback-withdrawal-requests/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) throw new Error("failed")
      const updated = (await response.json()) as RequestRow
      setRows((current) => current.map((row) => (row.id === id ? updated : row)))
    } catch {
      setRows(previous)
      window.alert("Не удалось сохранить статус, попробуйте ещё раз")
    }
  }

  return (
    <main className="min-h-screen bg-[#f2f5f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f71dc]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Запросы на снятие кэшбэка</span>
        </div>
      </header>

      <section className="mx-4 mt-4 rounded-md bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-5 border-b border-[#e1e5eb] px-6 py-4">
          <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f71dc]">
            <Filter className="h-4 w-4" /> Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
          </button>

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
        </div>

        {filterOpen && (
          <div className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] px-6 py-6 sm:grid-cols-3">
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Статус
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {["Все статусы", "В ожидании", "Подтверждено", "Отклонено"].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
          </div>
        )}

        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[800px] border-collapse text-[14px]">
            <thead className="bg-[#5d6474] text-white">
              <tr>
                {["№", "Клиент", "Сумма", "Валюта", "Статус"].map((title) => (
                  <th key={title} className="whitespace-nowrap px-4 py-4 text-left font-semibold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={row.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4 align-top">{row.id}</td>
                  <td className="px-4 py-4 align-top">{row.client}</td>
                  <td className="px-4 py-4 align-top">{number(row.amount)}</td>
                  <td className="px-4 py-4 align-top">{row.currency}</td>
                  <td className="px-4 py-4 align-top">
                    {row.status === "pending" ? (
                      <div className="flex items-center gap-3">
                        <span className={`font-medium ${statusMeta[row.status].className}`}>{statusMeta[row.status].label}</span>
                        <button aria-label="Подтвердить" onClick={() => setStatus(row.id, "confirmed")} className="text-[#3aa76d] hover:text-[#2c8f5a]"><Check className="h-4 w-4" /></button>
                        <button aria-label="Отклонить" onClick={() => setStatus(row.id, "rejected")} className="text-[#e5484d] hover:text-[#c53238]"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <span className={`font-medium ${statusMeta[row.status].className}`}>{statusMeta[row.status].label}</span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено по заданным фильтрам</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
