"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { BarChart, ChevronDown, ChevronRight, Filter, Search, Star, Trash2, X } from "lucide-react"

type PayrollRow = { id: number; employee: string; sum: number }

const rows: PayrollRow[] = []

const favoriteItemsInitial = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toInputDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function formatLongDate(date: Date) {
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function PayrollExpensesView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [favoriteItems, setFavoriteItems] = useState(favoriteItemsInitial)
  const [hoveredFavorite, setHoveredFavorite] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)

  const today = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])
  const monthEnd = useMemo(() => new Date(today.getFullYear(), today.getMonth() + 1, 0), [today])
  const [rangeFrom, setRangeFrom] = useState(() => toInputDate(monthStart))
  const [rangeTo, setRangeTo] = useState(() => toInputDate(monthEnd))
  const [appliedRange, setAppliedRange] = useState(() => `${formatLongDate(monthStart)} - ${formatLongDate(monthEnd)}`)
  const [branch, setBranch] = useState("Все филиалы")
  const [organization, setOrganization] = useState("Все организации")

  const filtered = useMemo(
    () => rows.filter((row) => row.employee.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const applyFilter = () => {
    setAppliedRange(`${formatLongDate(new Date(rangeFrom))} - ${formatLongDate(new Date(rangeTo))}`)
    setFilterOpen(false)
  }

  const removeFavorite = (index: number) => {
    setFavoriteItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const downloadAll = () => {
    const header = ["Сотрудник", "Сумма (SUM)"]
    const body = filtered.map((row) => [row.employee, number(row.sum)])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "payroll-expenses.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Расходы на персонал</span>
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Фильтр
        </button>
        <span className="font-semibold text-[#4f70e7]">Во всей организации</span>
        <button onClick={downloadAll} className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
      </section>

      <section className="flex flex-wrap items-center gap-4 border-t border-[#e1e5eb] px-6 py-4 md:px-9">
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 1} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
      </section>

      <section className="border-t border-[#e1e5eb]">
        {visible.length > 0 ? (
          <table className="w-full border-collapse text-[14px]">
            <thead className="bg-[#f6f9fc] text-[#586174]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Сотрудник</th>
                <th className="px-4 py-3 text-left font-semibold">Сумма (SUM)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{row.employee}</td>
                  <td className="border-t border-[#e1e5eb] px-4 py-3.5">{number(row.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col items-center justify-center py-24">
            <Image src="/robot-mascot.png" alt="Робот-помощник" width={120} height={120} className="h-28 w-28 object-contain" />
            <p className="mt-4 text-[#9aa3b6]">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 pt-24" onClick={() => setFilterOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#586174]">Фильтр</h2>
              <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
            </div>
            <div className="mb-7">
              <p className="mb-1 text-[13px] font-medium text-[#586174]">Диапазон дат</p>
              <div className="flex items-center gap-2 border-b border-[#dbe0e8] pb-2 text-[15px]">
                <input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} className="w-full bg-transparent outline-none" />
                <span className="text-[#9aa3b6]">—</span>
                <input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} className="w-full bg-transparent outline-none" />
              </div>
            </div>
            <label className="relative mb-7 block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Филиалы
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {["Все филиалы", "Самарканд", "Ташкент", "Наманган"].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative mb-7 block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Организация
              <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {["Все организации", "Linko"].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <button onClick={applyFilter} className="block w-full rounded-md bg-[#6fcf97] py-3.5 text-center font-semibold text-white hover:bg-[#5fbf87]">Применить</button>
            <p className="sr-only">{appliedRange}</p>
          </div>
        </div>
      )}

      {favoritesOpen && (
        <div className="fixed inset-0 z-[100] flex">
          <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)} className="flex-1 bg-black/40" />
          <aside className="w-[420px] max-w-[90vw] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">Избранные</h2>
              <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)}><X className="h-6 w-6 text-slate-600" /></button>
            </header>
            {favoriteItems.map((item, index) => (
              <div
                key={`${item}-${index}`}
                onMouseEnter={() => setHoveredFavorite(index)}
                onMouseLeave={() => setHoveredFavorite((current) => (current === index ? null : current))}
                className={`flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg ${hoveredFavorite === index ? "bg-[#eaf0fd]" : ""}`}
              >
                <button type="button" onClick={() => { setFavorite(true); setFavoritesOpen(false) }} className="flex flex-1 items-center gap-3 text-left">
                  {hoveredFavorite === index && (
                    <span role="button" aria-label="Удалить из избранного" onClick={(event) => { event.stopPropagation(); removeFavorite(index) }} className="text-slate-600 hover:text-[#e5484d]">
                      <Trash2 className="h-5 w-5" />
                    </span>
                  )}
                  {item}
                </button>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            ))}
          </aside>
        </div>
      )}
    </main>
  )
}
