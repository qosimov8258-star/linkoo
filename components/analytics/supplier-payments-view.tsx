"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlignJustify,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Filter,
  Info,
  ListChecks,
  Search,
  Star,
  X,
} from "lucide-react"

import type { SupplierPaymentRow as PaymentRow } from "./supplier-payments-data"

const number = (value: number, fraction = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: 3 }).format(value)

const RU_MONTHS: Record<string, number> = {
  "янв.": 0, "февр.": 1, "мар.": 2, "апр.": 3, "мая": 4, "июня": 5,
  "июля": 6, "авг.": 7, "сент.": 8, "окт.": 9, "нояб.": 10, "дек.": 11,
}

function parseRuDate(value: string): number {
  const match = value.match(/(\d{1,2})\s+([а-яё.]+)\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?/i)
  if (!match) return 0
  const [, day, monthName, year, hour, minute] = match
  const month = RU_MONTHS[monthName.toLocaleLowerCase("ru")]
  if (month === undefined) return 0
  return new Date(Number(year), month, Number(day), Number(hour ?? 0), Number(minute ?? 0)).getTime()
}

function PaymentIcon({ type }: { type: "cash" | "card" }) {
  if (type === "card") return <CreditCard className="inline h-4 w-4 text-[#4f70e7]" />
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#4f70e7] text-[10px] font-bold text-white">S</span>
  )
}

export function SupplierPaymentsView() {
  const [favorite, setFavorite] = useState(false)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState("")
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [branchFilter, setBranchFilter] = useState("Все филиалы")
  const [supplierFilter, setSupplierFilter] = useState("Все поставщики")
  const [currencyFilter, setCurrencyFilter] = useState("Все валюты")
  const [appliedFilters, setAppliedFilters] = useState({
    date: "", organization: "Все организации", branch: "Все филиалы", supplier: "Все поставщики", currency: "Все валюты",
  })
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<keyof PaymentRow | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-payments")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить оплаты")
        return (await response.json()) as PaymentRow[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить оплаты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleSort = (key: keyof PaymentRow) => {
    if (sortKey === key) setSortDir((current) => (current === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const organizations = ["Все организации", ...new Set(rows.map((row) => row.organization))]
  const suppliers = ["Все поставщики", ...new Set(rows.map((row) => row.supplier))]
  const branches = ["Все филиалы", "Tashkent", "Xorazm", "Andijon"]
  const currencies = ["Все валюты", "SUM", "USD"]

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !row.supplier.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (appliedFilters.organization !== "Все организации" && row.organization !== appliedFilters.organization) return false
      if (appliedFilters.supplier !== "Все поставщики" && row.supplier !== appliedFilters.supplier) return false
      if (appliedFilters.currency !== "Все валюты" && row.currency !== appliedFilters.currency) return false
      return true
    })
  }, [appliedFilters, rows, search])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const isDateKey = sortKey === "paidAt"
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      let result: number
      if (isDateKey) {
        result = parseRuDate(String(av)) - parseRuDate(String(bv))
      } else if (typeof av === "string" && typeof bv === "string") {
        result = av.localeCompare(bv, "ru")
      } else {
        result = Number(av) - Number(bv)
      }
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [filtered, sortDir, sortKey])

  const maxPage = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const applyFilters = () => {
    setAppliedFilters({ date: dateFilter, organization: organizationFilter, branch: branchFilter, supplier: supplierFilter, currency: currencyFilter })
    setPage(1)
  }

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, row) => (row.currency === "USD" ? { ...acc, usd: acc.usd + row.amount } : { ...acc, sum: acc.sum + row.amount }),
      { sum: 0, usd: 0 },
    )
  }, [filtered])

  const downloadExcel = () => {
    const header = ["№", "Поставщик", "Создал", "Дата оплаты", "Организация", "Сумма", "Сумма в кассе", "Касса", "Комментарий"]
    const body = filtered.map((row) => [
      row.id,
      row.supplier,
      row.createdBy,
      row.paidAt,
      row.organization,
      `${number(row.amount)} ${row.currency}`,
      `${number(row.cashAmount)} SUM`,
      row.kassa,
      row.comment,
    ])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "supplier-payments.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Оплаты поставщикам</span>
        </button>
      </header>

      <div className="bg-[#4f5fd9] px-6 py-3 text-[15px] font-semibold text-white md:px-9">
        Оплаты поставщикам: {number(totals.sum, 0)} SUM , {number(totals.usd, 3)} USD
      </div>

      <section className="flex flex-wrap items-center gap-5 border-b border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
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
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronRight className="h-5 w-5" />
        </button>

        <button onClick={downloadExcel} aria-label="Скачать" className="ml-auto text-[#586174] hover:text-[#17233b]"><Download className="h-5 w-5" /></button>
        <ListChecks className="h-5 w-5 text-[#586174]" />
        <AlignJustify className="h-5 w-5 text-[#586174]" />
      </section>

      {filterOpen && (
        <section className="relative border-b border-[#e1e5eb] bg-white px-6 py-6 md:px-9">
          <button onClick={() => setFilterOpen(false)} aria-label="Закрыть фильтр" className="absolute right-6 top-6 text-[#9aa3b6] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
          <h3 className="mb-5 text-[15px] font-semibold text-[#586174]">Фильтр</h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Период
              <input
                type="text"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                placeholder="Укажите дату"
                className="mt-1 block w-full bg-transparent pr-6 text-[15px] font-normal text-[#586174] outline-none placeholder:text-[#9aa3b6]"
              />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Организация
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {organizations.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Филиалы
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {branches.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Поставщик
              <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {suppliers.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Валюта
              <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {currencies.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
          </div>
          <button onClick={applyFilters} className="mt-6 rounded-md bg-[#586174] px-8 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#4a5163]">
            Применить
          </button>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1400px] w-full border-collapse text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {(
                [
                  ["№", "id"],
                  ["Поставщик", "supplier"],
                  ["Создал", "createdBy"],
                  ["Дата оплаты", "paidAt"],
                  ["Организация", "organization"],
                  ["Сумма", "amount"],
                  ["Сумма в кассе", null],
                  ["Касса", "kassa"],
                  ["Комментарий", null],
                ] as const
              ).map(([title, key]) => (
                <th
                  key={title}
                  role={key ? "button" : undefined}
                  tabIndex={key ? 0 : undefined}
                  onClick={key ? () => toggleSort(key) : undefined}
                  onKeyDown={key ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSort(key) } } : undefined}
                  className={`whitespace-nowrap px-4 py-4 text-left font-semibold ${key ? "cursor-pointer select-none hover:bg-[#727b8e]" : ""}`}
                >
                  {key ? (
                    <span className="inline-flex items-center gap-1.5">
                      {title}
                      <ChevronDown className={`h-3.5 w-3.5 transition ${sortKey === key ? "opacity-100" : "opacity-50"} ${sortKey === key && sortDir === "desc" ? "rotate-180" : ""}`} />
                    </span>
                  ) : title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-[#9aa3b6]">Загрузка оплат...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row, index) => (
              <tr key={row.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                <td className="px-4 py-4 align-top">{row.id}</td>
                <td className="px-4 py-4 align-top font-medium text-[#17233b]">{row.supplier}</td>
                <td className="px-4 py-4 align-top">{row.createdBy}</td>
                <td className="px-4 py-4 align-top">{row.paidAt}</td>
                <td className="px-4 py-4 align-top">{row.organization}</td>
                <td className="px-4 py-4 align-top">
                  <div className="flex items-center gap-1.5 font-semibold text-[#3aa76d]">
                    {number(row.amount, row.currency === "USD" ? 0 : 0)} {row.currency} <PaymentIcon type={row.icon} />
                    {row.currency === "USD" && <Info className="h-3.5 w-3.5 text-[#9aa3b6]" />}
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  <div>{number(row.cashAmount)}</div>
                  <div className="text-[13px] text-[#586174]">{number(row.cashAmount)} SUM</div>
                </td>
                <td className="px-4 py-4 align-top">
                  <span className="font-medium text-[#4f70e7]">{row.kassa}</span>
                </td>
                <td className="px-4 py-4 align-top">{row.comment}</td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено по заданным фильтрам</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
