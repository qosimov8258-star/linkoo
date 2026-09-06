"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  Filter,
  Info,
  ListChecks,
  Pencil,
  RefreshCw,
  Reply,
  AlignJustify,
  Search,
  Trash2,
  Wallet,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import type { PaymentRow } from "./customer-payments-data"

const number = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)

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

export function CustomerPaymentsView() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<"pending" | "accepted" | "all">("all")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [agentFilter, setAgentFilter] = useState("Все агенты")
  const [kassaFilter, setKassaFilter] = useState("Все кассы")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingComment, setEditingComment] = useState("")
  const [sortKey, setSortKey] = useState<keyof PaymentRow | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/customer-payments")
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
  const agents = ["Все агенты", ...new Set(rows.map((row) => row.agent))]
  const kassas = ["Все кассы", ...new Set(rows.map((row) => row.kassa).filter(Boolean))]

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab === "pending" && row.accepted) return false
      if (tab === "accepted" && !row.accepted) return false
      if (search.trim() && !row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (organizationFilter !== "Все организации" && row.organization !== organizationFilter) return false
      if (agentFilter !== "Все агенты" && row.agent !== agentFilter) return false
      if (kassaFilter !== "Все кассы" && row.kassa !== kassaFilter) return false
      return true
    })
  }, [agentFilter, kassaFilter, organizationFilter, rows, search, tab])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const isDateKey = sortKey === "paidAt" || sortKey === "acceptedAt"
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

  const pendingRows = rows.filter((row) => !row.accepted)
  const acceptedRows = rows.filter((row) => row.accepted)
  const isDefaultFilters = !search.trim() && organizationFilter === "Все организации" && agentFilter === "Все агенты" && kassaFilter === "Все кассы"
  const totalLabel = isDefaultFilters ? (tab === "pending" ? pendingRows.length : tab === "accepted" ? acceptedRows.length : rows.length) : filtered.length

  // Сводная шапка отражает реальные данные из базы (не только видимую выборку строк).
  function sumTotals(source: PaymentRow[]) {
    return source.reduce(
      (acc, row) => (row.currency === "SUM" ? { ...acc, sum: acc.sum + row.amount } : { ...acc, usd: acc.usd + row.amount }),
      { sum: 0, usd: 0, eur: 0 },
    )
  }
  const SUMMARY_TOTALS = sumTotals(tab === "pending" ? pendingRows : tab === "accepted" ? acceptedRows : rows)

  const acceptToCashbox = async () => {
    const now = new Date()
    const label = now.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    const idsToAccept = rows.filter((row) => !row.accepted && filtered.some((f) => f.id === row.id)).map((row) => row.id)
    if (!idsToAccept.length) return

    setRows((current) =>
      current.map((row) => (idsToAccept.includes(row.id) ? { ...row, accepted: true, acceptedAt: label, kassa: "naqd" } : row)),
    )
    await Promise.all(
      idsToAccept.map((id) =>
        fetch(`/api/customer-payments/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true, acceptedAt: label, kassa: "naqd" }),
        }),
      ),
    )
  }

  const revertRow = async (id: number) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, accepted: false, acceptedAt: "", kassa: "" } : row)))
    await fetch(`/api/customer-payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted: false, acceptedAt: "", kassa: "" }),
    })
  }

  const deleteRow = async (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id))
    await fetch(`/api/customer-payments/${id}`, { method: "DELETE" })
  }

  const startEdit = (row: PaymentRow) => {
    setEditingId(row.id)
    setEditingComment(row.comment)
  }

  const saveEdit = async (id: number) => {
    const comment = editingComment || "Не указано"
    setRows((current) => current.map((row) => (row.id === id ? { ...row, comment } : row)))
    setEditingId(null)
    await fetch(`/api/customer-payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    })
  }

  const downloadExcel = () => {
    const header = ["№", "Клиент", "Создал", "Дата оплаты", "Дата приемки", "Ответственный агент", "Организация", "Сумма", "Сумма в кассе", "Касса", "Комментарий"]
    const body = filtered.map((row) => [
      row.id,
      row.client,
      row.createdBy,
      row.paidAt,
      row.acceptedAt || "-",
      row.agent,
      row.organization,
      `${number(row.amount, row.currency === "USD" ? 0 : 0)} ${row.currency}`,
      `${number(row.cashAmount)} SUM`,
      row.kassa || "Не принято",
      row.comment,
    ])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "customer-payments.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Оплаты от клиентов</span>
        </div>
        <button onClick={downloadExcel} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white">
          <Download className="h-5 w-5" /> Скачать Excel
        </button>
      </header>

      <div className="bg-[#4f5fd9] px-6 py-3 text-[15px] font-semibold text-white md:px-9">
        Оплаты от клиентов: {number(SUMMARY_TOTALS.sum, 2)} SUM , {number(SUMMARY_TOTALS.usd, 3)} USD , {number(SUMMARY_TOTALS.eur, 3)} Euro
      </div>

      <section className="grid grid-cols-3 bg-white text-center">
        {(
          [
            ["pending", "Не принятые"],
            ["accepted", "Принятые"],
            ["all", "Все"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1) }}
            className={`border-b-2 py-4 text-[16px] font-medium ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {label}
          </button>
        ))}
      </section>

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
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>

        <ListChecks className="h-5 w-5 text-[#586174]" />
        <button onClick={downloadExcel} aria-label="Скачать"><Download className="h-5 w-5 text-[#586174]" /></button>
        <AlignJustify className="h-5 w-5 text-[#586174]" />
        <button onClick={() => setPage(1)} aria-label="Обновить"><RefreshCw className="h-5 w-5 text-[#586174]" /></button>
        <Pencil className="h-5 w-5 text-[#586174]" />

        <button onClick={acceptToCashbox} className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4f5fd9] px-5 font-semibold text-white">
          <Wallet className="h-5 w-5" /> Принять на кассу
        </button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          {(
            [
              ["Организация", organizationFilter, setOrganizationFilter, organizations],
              ["Ответственный агент", agentFilter, setAgentFilter, agents],
              ["Касса", kassaFilter, setKassaFilter, kassas],
            ] as const
          ).map(([label, value, setter, options]) => (
            <label key={label} className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              {label}
              <select value={value} onChange={(event) => { setter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {options.map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
          ))}
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {(
                [
                  ["№", "id"],
                  ["Клиент", "client"],
                  ["Создал", "createdBy"],
                  ["Дата оплаты", "paidAt"],
                  ["Дата приемки", "acceptedAt"],
                  ["Ответственный агент", "agent"],
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
              <tr><td colSpan={11} className="px-4 py-16 text-center text-[#9aa3b6]">Загрузка оплат...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={11} className="px-4 py-16 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row, index) => (
              <tr key={row.id} className={`group relative border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                <td className="px-4 py-4 align-top">{row.id}</td>
                <td className="px-4 py-4 align-top">
                  <div>{row.client}</div>
                  {row.clientCode && <div className="text-[13px] font-medium text-[#4f70e7]">{row.clientCode}</div>}
                </td>
                <td className="px-4 py-4 align-top">{row.createdBy}</td>
                <td className="px-4 py-4 align-top">{row.paidAt}</td>
                <td className="px-4 py-4 align-top">{row.acceptedAt || "-"}</td>
                <td className="px-4 py-4 align-top">{row.agent}</td>
                <td className="px-4 py-4 align-top">{row.organization}</td>
                <td className="px-4 py-4 align-top">
                  <div className="flex items-center gap-1.5 font-semibold text-[#3aa76d]">
                    {number(row.amount, row.currency === "USD" ? 0 : 0)} {row.currency} <PaymentIcon type={row.icon} />
                    {row.currency === "USD" && <Info className="h-3.5 w-3.5 text-[#9aa3b6]" />}
                  </div>
                  {row.currency === "USD" && <div className="text-[13px] text-[#586174]">{number(row.amountSumEquivalent ?? 0, 2)} SUM</div>}
                </td>
                <td className="px-4 py-4 align-top">
                  {row.currency === "USD" ? (
                    <>
                      <div className="flex items-center gap-1">{number(row.amount, 0)} {row.currency} <Info className="h-3.5 w-3.5 text-[#9aa3b6]" /></div>
                      <div className="text-[13px] text-[#586174]">0 SUM</div>
                    </>
                  ) : (
                    `${number(row.cashAmount)} SUM`
                  )}
                </td>
                <td className="relative px-4 py-4 align-top">
                  <div className="group-hover:invisible">
                    {row.accepted
                      ? <span className="font-medium text-[#4f70e7]">{row.kassa}</span>
                      : <span className="text-[#17233b]">Не принято</span>}
                  </div>
                  <div className="invisible absolute inset-0 flex items-center gap-3 px-4 group-hover:visible">
                    <button aria-label="История" onClick={() => setHistoryOpenId(row.id)} className="text-[#e0a83e] hover:text-[#c98f22]"><Clock className="h-4 w-4" /></button>
                    <button aria-label="Вернуть" onClick={() => revertRow(row.id)} className="text-[#586174] hover:text-[#17233b]"><Reply className="h-4 w-4" /></button>
                    <button aria-label="Редактировать" onClick={() => startEdit(row)} className="text-[#e5484d] hover:text-[#c53238]"><Pencil className="h-4 w-4" /></button>
                    <button aria-label="Удалить" onClick={() => deleteRow(row.id)} className="text-[#e5484d] hover:text-[#c53238]"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  {editingId === row.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editingComment}
                        onChange={(event) => setEditingComment(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && saveEdit(row.id)}
                        className="w-full border-b border-[#4f70e7] bg-transparent text-sm outline-none"
                      />
                      <button onClick={() => saveEdit(row.id)} className="text-xs font-semibold text-[#4f70e7]">OK</button>
                    </div>
                  ) : (
                    row.comment
                  )}
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено по заданным фильтрам</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {historyOpenId !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={() => setHistoryOpenId(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[420px] rounded-md bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-bold">История платежа №{historyOpenId}</h3>
            <ul className="space-y-3 text-sm text-[#586174]">
              <li>Платёж создан — {rows.find((row) => row.id === historyOpenId)?.createdBy}</li>
              <li>Дата оплаты — {rows.find((row) => row.id === historyOpenId)?.paidAt}</li>
              <li>Статус — {rows.find((row) => row.id === historyOpenId)?.accepted ? "Принято на кассу" : "Ожидает принятия"}</li>
            </ul>
            <button onClick={() => setHistoryOpenId(null)} className="mt-6 w-full rounded-md bg-[#4f5fd9] py-2.5 font-semibold text-white">Закрыть</button>
          </div>
        </div>
      )}
    </main>
  )
}
