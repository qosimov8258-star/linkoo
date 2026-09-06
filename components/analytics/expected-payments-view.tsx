"use client"

import { useMemo, useState } from "react"
import {
  AlignJustify,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Filter,
  ListChecks,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type PaymentType = "cash" | "transfer"

type OrderRow = {
  id: number
  client: string
  clientBranch?: string
  createdAt: string
  createdAtDate: string
  paidAt: string
  organization: string
  amount: number
  currency: "SUM" | "USD"
  remaining: number
  paymentType: PaymentType
}

const initialRows: OrderRow[] = []

const TOTAL_RECORDS = 0

const number = (value: number, fraction = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: 2 }).format(value)

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

function PaymentIcon({ type }: { type: PaymentType }) {
  if (type === "transfer") return <CreditCard className="inline h-4 w-4 text-[#4f70e7]" />
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-[#4f70e7] text-[10px] font-bold text-[#4f70e7]">$</span>
  )
}

const paymentTypeLabel: Record<PaymentType, string> = {
  cash: "Наличные",
  transfer: "Перечислением",
}

const filials = ["Tashkent", "Xorazm", "Andijon", "spark", "chilonzor"]
const kassas = ["naqd", "payme", "click", "Salohiddin Kassa Tashkent"]
const incomeCategories = ["Заказ", "Предоплата", "Возврат долга", "Прочее"]
const contracts = ["Договор №1", "Договор №2", "Без договора"]
const responsiblePersons = ["Admin Ritm", "Temur Raupov", "Samandar Abdurahmonov", "Шохрух Туляганов"]

export function ExpectedPaymentsView() {
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<keyof OrderRow | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [activeRowId, setActiveRowId] = useState<number | null>(null)

  const toggleSort = (key: keyof OrderRow) => {
    if (sortKey === key) setSortDir((current) => (current === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const organizations = ["Все организации", ...new Set(rows.map((row) => row.organization))]

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim()) {
        const needle = search.trim().toLocaleLowerCase("ru")
        const haystack = `${row.client} ${row.clientBranch ?? ""} ${row.id}`.toLocaleLowerCase("ru")
        if (!haystack.includes(needle)) return false
      }
      if (organizationFilter !== "Все организации" && row.organization !== organizationFilter) return false
      return true
    })
  }, [organizationFilter, rows, search])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const isDateKey = sortKey === "createdAt" || sortKey === "paidAt"
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

  const isDefaultFilters = !search.trim() && organizationFilter === "Все организации"
  const totalLabel = isDefaultFilters ? TOTAL_RECORDS : filtered.length

  const activeRow = rows.find((row) => row.id === activeRowId) ?? null

  const applyPayment = async (id: number, amount: number, confirmed: boolean) => {
    if (!confirmed) {
      setActiveRowId(null)
      return
    }
    const row = rows.find((item) => item.id === id)
    try {
      await fetch("/api/expected-payment-confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: id,
          client: row?.client ?? "",
          amount,
          currency: row?.currency ?? "SUM",
          date: new Date().toISOString(),
        }),
      })
    } catch {
      window.alert("Сервер недоступен, оплата не сохранена")
      return
    }
    setRows((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        const nextRemaining = Math.max(0, item.remaining - amount)
        return { ...item, remaining: nextRemaining }
      }),
    )
    setActiveRowId(null)
  }

  const downloadExcel = () => {
    const header = ["№ зак.", "Клиент", "Дата создания", "Дата оплаты", "Организация", "Сумма заказа", "Остаток"]
    const body = filtered.map((row) => [
      row.id,
      row.clientBranch ? `${row.client} (${row.clientBranch})` : row.client,
      row.createdAt,
      row.paidAt,
      row.organization,
      `${number(row.amount, 2)} ${row.currency}`,
      number(row.remaining, 2),
    ])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "expected-payments.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Ожидаемые оплаты</span>
        </div>
      </header>

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

        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {totalLabel}</span>

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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Организация
              <select value={organizationFilter} onChange={(event) => { setOrganizationFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {organizations.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
          </div>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1300px] w-full border-collapse text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {(
                [
                  ["№ зак.", "id"],
                  ["Клиент", "client"],
                  ["Дата создания", "createdAt"],
                  ["Дата оплаты", "paidAt"],
                  ["Организация", "organization"],
                  ["Сумма заказа", "amount"],
                  ["Остаток", "remaining"],
                ] as const
              ).map(([title, key]) => (
                <th
                  key={title}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSort(key)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSort(key) } }}
                  className={`whitespace-nowrap px-4 py-4 font-semibold cursor-pointer select-none hover:bg-[#727b8e] ${key === "amount" || key === "remaining" ? "text-right" : "text-left"}`}
                >
                  <span className={`inline-flex items-center gap-1.5 ${key === "amount" || key === "remaining" ? "flex-row-reverse" : ""}`}>
                    {title}
                    <ChevronDown className={`h-3.5 w-3.5 transition ${sortKey === key ? "opacity-100" : "opacity-50"} ${sortKey === key && sortDir === "desc" ? "rotate-180" : ""}`} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={row.id}
                onClick={() => setActiveRowId(row.id)}
                className={`cursor-pointer border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} hover:bg-[#eef2ff]`}
              >
                <td className="px-4 py-4 align-top">{row.id}</td>
                <td className="px-4 py-4 align-top">
                  <div>{row.client}</div>
                  {row.clientBranch && <div className="text-[13px] font-medium text-[#4f70e7] underline">{row.clientBranch}</div>}
                </td>
                <td className="px-4 py-4 align-top">{row.createdAt}</td>
                <td className="px-4 py-4 align-top">{row.paidAt}</td>
                <td className="px-4 py-4 align-top">{row.organization}</td>
                <td className="px-4 py-4 align-top text-right">
                  <div className="flex items-center justify-end gap-1.5 font-semibold text-[#17233b]">
                    {number(row.amount, 2)} {row.currency} <PaymentIcon type={row.paymentType} />
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-right font-semibold text-[#17233b]">{number(row.remaining, 2)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено по заданным фильтрам</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {activeRow && (
        <PaymentModal
          row={activeRow}
          onClose={() => setActiveRowId(null)}
          onSubmit={(amount, confirmed) => applyPayment(activeRow.id, amount, confirmed)}
        />
      )}
    </main>
  )
}

function PaymentModal({
  row,
  onClose,
  onSubmit,
}: {
  row: OrderRow
  onClose: () => void
  onSubmit: (amount: number, confirmed: boolean) => void
}) {
  const [date, setDate] = useState(row.createdAtDate)
  const [filial, setFilial] = useState("")
  const [kassa, setKassa] = useState("")
  const [incomeCategory, setIncomeCategory] = useState("Заказ")
  const [contract, setContract] = useState("")
  const [amount, setAmount] = useState(String(row.remaining))
  const [responsible, setResponsible] = useState("")
  const [comment, setComment] = useState("")
  const [confirmed, setConfirmed] = useState(true)

  const submit = () => {
    const parsed = Number(amount.replace(",", "."))
    onSubmit(Number.isFinite(parsed) ? parsed : 0, confirmed)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-[560px] overflow-y-auto rounded-md bg-white shadow-2xl">
        <div className="relative bg-[#eef1f6] px-6 py-5">
          <button onClick={onClose} aria-label="Закрыть" className="absolute right-4 top-4 text-[#9aa3b6] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">
            <div>Заказ №{row.id}</div>
            <div>Тип оплаты: <span className="font-semibold text-[#4f70e7]">{paymentTypeLabel[row.paymentType]}</span></div>
            <div>Клиент: <span className="font-semibold">{row.client}</span></div>
            <div>Сумма заказа: <span className="font-semibold">{number(row.amount, 2)} {row.currency}</span></div>
            <div>Организация: <span className="font-semibold">{row.organization}</span></div>
            <div>Остаток: <span className="font-semibold">{number(row.remaining, 2)} {row.currency}</span></div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] text-[#586174]">
            Дата создания
            <input value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent pr-6 text-[15px] font-medium text-[#17233b] outline-none" />
            <Calendar className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Филиал
            <select value={filial} onChange={(event) => setFilial(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value=""></option>
              {filials.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Касса
            <select value={kassa} onChange={(event) => setKassa(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value=""></option>
              {kassas.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Категория прихода
            <select value={incomeCategory} onChange={(event) => setIncomeCategory(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-12 text-[15px] font-normal outline-none">
              {incomeCategories.map((option) => <option key={option}>{option}</option>)}
            </select>
            {incomeCategory && (
              <button type="button" onClick={() => setIncomeCategory("")} aria-label="Очистить" className="absolute right-6 top-6 text-[#9aa3b6] hover:text-[#17233b]">
                <X className="h-4 w-4" />
              </button>
            )}
            <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Контракт
            <select value={contract} onChange={(event) => setContract(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value=""></option>
              {contracts.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] text-[#586174]">
            Сумма
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="mt-1 block w-full bg-transparent text-[15px] font-medium text-[#17233b] outline-none" />
          </label>

          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Ответственный персонал
            <select value={responsible} onChange={(event) => setResponsible(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value=""></option>
              {responsiblePersons.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
          </label>

          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px]">
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий..." rows={2} className="mt-1 block w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          </label>

          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4 rounded border-[#9aa3b6] accent-[#4f70e7]" />
            Подтвержденный приход (Я получил деньги)
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 text-sm font-semibold text-[#586174] hover:bg-[#f6f9fc]">Отмена</button>
            <button onClick={submit} className="rounded-md bg-[#4f5fd9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3f4ec9]">Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  )
}
