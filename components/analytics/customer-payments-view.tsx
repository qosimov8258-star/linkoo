"use client"

import { useMemo, useState } from "react"
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
  Star,
  Trash2,
  Wallet,
} from "lucide-react"

type PaymentRow = {
  id: number
  client: string
  clientCode?: string
  createdBy: string
  paidAt: string
  acceptedAt: string
  agent: string
  organization: string
  amount: number
  currency: "SUM" | "USD"
  amountSumEquivalent?: number
  cashAmount: number
  kassa: string
  accepted: boolean
  comment: string
  icon: "cash" | "card"
}

const initialRows: PaymentRow[] = [
  { id: 2328, client: "Usman Dembele", createdBy: "Admin Ritm", paidAt: "18 июля 2026, 12:38", acceptedAt: "18 июля 2026, 12:38", agent: "Admin Ritm", organization: "05,08,2025", amount: 1000, currency: "USD", amountSumEquivalent: 12050000, cashAmount: 0, kassa: "xorazm Usd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2303, client: "Частное Лицо", createdBy: "Admin Ritm", paidAt: "01 мая 2026, 16:42", acceptedAt: "", agent: "Samandar Abdurahmonov", organization: "05,08,2025", amount: 100000, currency: "SUM", cashAmount: 100000, kassa: "", accepted: false, comment: "Не указано", icon: "card" },
  { id: 2299, client: "ИП Каркабаев", createdBy: "Admin Ritm", paidAt: "22 апр. 2026, 23:27", acceptedAt: "", agent: "Samandar Abdurahmonov", organization: "05,08,2025", amount: 30000, currency: "SUM", cashAmount: 30000, kassa: "", accepted: false, comment: "Не указано", icon: "cash" },
  { id: 2297, client: "Частное Лицо", createdBy: "Admin Ritm", paidAt: "22 апр. 2026, 23:16", acceptedAt: "22 апр. 2026, 23:16", agent: "Samandar Abdurahmonov", organization: "05,08,2025", amount: 70000, currency: "SUM", cashAmount: 70000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2295, client: "Частное Лицо", createdBy: "Admin Ritm", paidAt: "22 апр. 2026, 23:12", acceptedAt: "", agent: "Samandar Abdurahmonov", organization: "05,08,2025", amount: 150000, currency: "SUM", cashAmount: 150000, kassa: "", accepted: false, comment: "Не указано", icon: "cash" },
  { id: 2292, client: "test 20007", createdBy: "Admin Ritm", paidAt: "14 апр. 2026, 14:36", acceptedAt: "14 апр. 2026, 14:37", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 1000, currency: "SUM", cashAmount: 1000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2291, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "14 апр. 2026, 14:34", acceptedAt: "05 июля 2026, 18:44", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 500000, currency: "SUM", cashAmount: 500000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2289, client: "Asu market", createdBy: "Admin Ritm", paidAt: "30 мар. 2026, 13:00", acceptedAt: "30 мар. 2026, 13:00", agent: "Temur Raupov", organization: "Lalaku", amount: 600000, currency: "SUM", cashAmount: 600000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2288, client: "Asu market", createdBy: "Admin Ritm", paidAt: "30 мар. 2026, 12:58", acceptedAt: "30 мар. 2026, 12:58", agent: "Ares are", organization: "Lalaku", amount: 6000000, currency: "SUM", cashAmount: 6000000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2287, client: "Бахт маркет", clientCode: "1235685", createdBy: "Admin Ritm", paidAt: "30 мар. 2026, 12:58", acceptedAt: "30 мар. 2026, 12:58", agent: "Admin Ritm", organization: "Lalaku", amount: 66, currency: "SUM", cashAmount: 66, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2286, client: "Ritm ritm", createdBy: "Admin Ritm", paidAt: "30 мар. 2026, 12:58", acceptedAt: "30 мар. 2026, 12:58", agent: "Admin Ritm", organization: "Ichimliklar", amount: 150000, currency: "SUM", cashAmount: 150000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2285, client: "new klient707", createdBy: "Admin Ritm", paidAt: "30 мар. 2026, 12:58", acceptedAt: "30 мар. 2026, 12:58", agent: "Admin Ritm", organization: "energetik", amount: 1303651800, currency: "SUM", cashAmount: 1303651800, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2284, client: "new klient707", createdBy: "Admin Ritm", paidAt: "29 мар. 2026, 15:57", acceptedAt: "29 мар. 2026, 15:57", agent: "Admin Ritm", organization: "energetik", amount: 1000000, currency: "SUM", cashAmount: 1000000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2244, client: "Asu market", createdBy: "Admin Ritm", paidAt: "30 янв. 2026, 11:02", acceptedAt: "30 янв. 2026, 11:02", agent: "Temur Raupov", organization: "baby still", amount: 37, currency: "USD", amountSumEquivalent: 446621.45, cashAmount: 0, kassa: "xorazm Usd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2242, client: "Asu market", createdBy: "Admin Ritm", paidAt: "29 янв. 2026, 18:56", acceptedAt: "29 янв. 2026, 18:56", agent: "Temur Raupov", organization: "878", amount: 5000, currency: "SUM", cashAmount: 5000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2243, client: "Asu market", createdBy: "Admin Ritm", paidAt: "29 янв. 2026, 18:56", acceptedAt: "29 янв. 2026, 18:56", agent: "Temur Raupov", organization: "878", amount: 6940.74, currency: "SUM", cashAmount: 6940.74, kassa: "payme", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2240, client: "Asu market", createdBy: "Admin Ritm", paidAt: "28 янв. 2026, 23:25", acceptedAt: "28 янв. 2026, 23:25", agent: "Admin Ritm", organization: "05,08,2025", amount: 50000, currency: "SUM", cashAmount: 50000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2241, client: "Arslan", createdBy: "Admin Ritm", paidAt: "28 янв. 2026, 23:25", acceptedAt: "28 янв. 2026, 23:25", agent: "Admin Ritm", organization: "energetik", amount: 10000, currency: "SUM", cashAmount: 10000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2237, client: "Bohodir Axmedov", createdBy: "Admin Ritm", paidAt: "27 янв. 2026, 22:02", acceptedAt: "27 янв. 2026, 22:02", agent: "Не указано", organization: "Lalaku", amount: 12000, currency: "SUM", cashAmount: 12000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2236, client: "Bohodir Axmedov", createdBy: "Admin Ritm", paidAt: "27 янв. 2026, 21:56", acceptedAt: "27 янв. 2026, 21:56", agent: "Не указано", organization: "Lalaku", amount: 11940, currency: "SUM", cashAmount: 11940, kassa: "naqd", accepted: true, comment: "test", icon: "card" },
  { id: 2176, client: "Asu market", createdBy: "Admin Ritm", paidAt: "20 янв. 2026, 10:32", acceptedAt: "20 янв. 2026, 10:32", agent: "Temur Raupov", organization: "Konditerka", amount: 3980000, currency: "SUM", cashAmount: 3980000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2165, client: "Asu market", createdBy: "Admin Ritm", paidAt: "16 янв. 2026, 11:24", acceptedAt: "16 янв. 2026, 11:24", agent: "Temur Raupov", organization: "05,08,2025", amount: 9050000, currency: "SUM", cashAmount: 9050000, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2163, client: "Asu market", clientCode: "1234567891011", createdBy: "Admin Ritm", paidAt: "15 янв. 2026, 17:10", acceptedAt: "15 янв. 2026, 17:10", agent: "Temur Raupov", organization: "05,08,2025", amount: 100, currency: "SUM", cashAmount: 100, kassa: "kassa", accepted: true, comment: "Не указано", icon: "card" },
  { id: 2152, client: "Asu market", createdBy: "Admin Ritm", paidAt: "15 янв. 2026, 15:17", acceptedAt: "15 янв. 2026, 15:17", agent: "Temur Raupov", organization: "energetik", amount: 111111, currency: "SUM", cashAmount: 111111, kassa: "payme", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 2153, client: "Asu market", createdBy: "Admin Ritm", paidAt: "15 янв. 2026, 15:17", acceptedAt: "15 янв. 2026, 15:17", agent: "Temur Raupov", organization: "Lalaku", amount: 111111, currency: "SUM", cashAmount: 111111, kassa: "payme", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 4, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "23 сент. 2024, 14:12", acceptedAt: "23 сент. 2024, 14:12", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 12000, currency: "SUM", cashAmount: 12000, kassa: "SUM", accepted: true, comment: "Не указано", icon: "card" },
  { id: 6, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "26 сент. 2024, 12:52", acceptedAt: "26 сент. 2024, 12:52", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 0.009, currency: "USD", amountSumEquivalent: 100, cashAmount: 100, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 7, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "26 сент. 2024, 12:53", acceptedAt: "26 сент. 2024, 12:53", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 0.009, currency: "USD", amountSumEquivalent: 100, cashAmount: 100, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 8, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "26 сент. 2024, 12:53", acceptedAt: "26 сент. 2024, 12:53", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 100, currency: "SUM", cashAmount: 100, kassa: "SUM", accepted: true, comment: "Не указано", icon: "card" },
  { id: 10, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "26 сент. 2024, 12:56", acceptedAt: "26 сент. 2024, 12:56", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 0.009, currency: "USD", amountSumEquivalent: 100, cashAmount: 100, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 169, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "26 сент. 2024, 15:40", acceptedAt: "26 сент. 2024, 15:40", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 0.089, currency: "USD", amountSumEquivalent: 1000, cashAmount: 1000, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 15, client: "Pepsi Market", createdBy: "Тп 1 Алиса", paidAt: "08 окт. 2024, 12:55", acceptedAt: "08 окт. 2024, 13:02", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 50000, currency: "SUM", cashAmount: 50000, kassa: "SUM", accepted: true, comment: "Ichimliklardan", icon: "cash" },
  { id: 17, client: "Pepsi Market", createdBy: "Тп 1 Алиса", paidAt: "08 окт. 2024, 12:56", acceptedAt: "08 окт. 2024, 13:03", agent: "Тп 1 Исмоилов Гани", organization: "Electronika", amount: 20000, currency: "SUM", cashAmount: 20000, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 27, client: "Anvar Market", createdBy: "Тп 1 Алиса", paidAt: "18 окт. 2024, 11:49", acceptedAt: "29 дек. 2024, 10:39", agent: "xodim2 1", organization: "Electronika", amount: 100, currency: "SUM", cashAmount: 100, kassa: "SUM", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 127, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "12 нояб. 2024, 15:12", acceptedAt: "12 нояб. 2024, 15:12", agent: "Тп 1 Исмоилов Гани", organization: "Ichimliklar", amount: 1.08, currency: "USD", amountSumEquivalent: 12096, cashAmount: 0, kassa: "USD", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 408, client: "Pepsi Market", createdBy: "Admin Ritm", paidAt: "28 янв. 2025, 11:46", acceptedAt: "28 янв. 2025, 11:46", agent: "Тп 1 Исмоилов Гани", organization: "Pampers", amount: 0.76, currency: "SUM", cashAmount: 0.76, kassa: "payme", accepted: true, comment: "Не указано", icon: "card" },
  { id: 759, client: "Xorazm to'qqizinchi kilent", createdBy: "Admin Ritm", paidAt: "29 апр. 2025, 14:49", acceptedAt: "22 авг. 2025, 14:33", agent: "agent TIMUR 007", organization: "avto organizatsiya 2", amount: 1, currency: "USD", amountSumEquivalent: 12970, cashAmount: 0, kassa: "xorazm Usd", accepted: true, comment: "Не указано", icon: "cash" },
  { id: 1647, client: "ASU", clientCode: "123456789", createdBy: "Admin Ritm", paidAt: "22 нояб. 2025, 17:30", acceptedAt: "22 нояб. 2025, 17:30", agent: "Шохрух Туляганов", organization: "05,08,2025", amount: 1, currency: "SUM", cashAmount: 1, kassa: "naqd", accepted: true, comment: "Не указано", icon: "card" },
  { id: 1648, client: "Ritm 2", createdBy: "Admin Ritm", paidAt: "22 нояб. 2025, 17:32", acceptedAt: "22 нояб. 2025, 17:32", agent: "Шохрух Туляганов", organization: "878", amount: 1, currency: "SUM", cashAmount: 1, kassa: "naqd", accepted: true, comment: "Не указано", icon: "cash" },
]

const TOTAL_RECORDS = 367

const number = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: 3 }).format(value)

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
  const [favorite, setFavorite] = useState(false)
  const [rows, setRows] = useState(initialRows)
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

  const isDefaultFilters = !search.trim() && organizationFilter === "Все организации" && agentFilter === "Все агенты" && kassaFilter === "Все кассы"
  const TOTAL_PENDING = 3
  const TOTAL_ACCEPTED = 364
  const totalLabel = isDefaultFilters ? (tab === "pending" ? TOTAL_PENDING : tab === "accepted" ? TOTAL_ACCEPTED : TOTAL_RECORDS) : filtered.length

  // Итоговая шапка отражает всю базу (367 платежей), а не только видимую выборку строк.
  // Непринятые (3 платежа) полностью учтены в моке, поэтому их сумма реальная;
  // Принятые = Все − Непринятые, Все — фиксированная сумма по всей базе.
  const ALL_TOTALS = { sum: 16716206353.44, usd: 6508530.272, eur: 3431.107 }
  const pendingRows = rows.filter((row) => !row.accepted)
  const PENDING_TOTALS = pendingRows.reduce(
    (acc, row) => (row.currency === "SUM" ? { ...acc, sum: acc.sum + row.amount } : { ...acc, usd: acc.usd + row.amount }),
    { sum: 0, usd: 0, eur: 0 },
  )
  const ACCEPTED_TOTALS = { sum: ALL_TOTALS.sum - PENDING_TOTALS.sum, usd: ALL_TOTALS.usd - PENDING_TOTALS.usd, eur: ALL_TOTALS.eur - PENDING_TOTALS.eur }
  const SUMMARY_TOTALS = tab === "pending" ? PENDING_TOTALS : tab === "accepted" ? ACCEPTED_TOTALS : ALL_TOTALS

  const acceptToCashbox = () => {
    setRows((current) =>
      current.map((row) => {
        const isVisiblePending = !row.accepted && filtered.some((f) => f.id === row.id)
        if (!isVisiblePending) return row
        const now = new Date()
        const label = now.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        return { ...row, accepted: true, acceptedAt: label, kassa: "naqd" }
      }),
    )
  }

  const revertRow = (id: number) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, accepted: false, acceptedAt: "", kassa: "" } : row)))
  }

  const deleteRow = (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id))
  }

  const startEdit = (row: PaymentRow) => {
    setEditingId(row.id)
    setEditingComment(row.comment)
  }

  const saveEdit = (id: number) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, comment: editingComment || "Не указано" } : row)))
    setEditingId(null)
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
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Оплаты от клиентов</span>
        </button>
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
            {visible.map((row, index) => (
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
            {visible.length === 0 && (
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
