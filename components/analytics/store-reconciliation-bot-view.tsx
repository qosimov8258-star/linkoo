"use client"

import { useEffect, useMemo, useState } from "react"
import { BarChart, ChevronDown, Expand, MinusCircle, Pencil, PlusCircle, Search, Send } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Money = { euro: number; sum: number; usd: number }
type ClientRow = {
  id: number
  client: string
  connected: boolean
  debtTerm?: string
  daysAfterPayment: number
  daysAfterOrder: number
  amount: Money
  sumCash: number
  sumTransfer: number
  usdCash: number
  usdTransfer: number
  euroCash: number
  euroTransfer: number
  orders: number
  altSumTransfer?: number
  altAmountSum?: number
}

const zero: Money = { euro: 0, sum: 0, usd: 0 }

type ApiRow = {
  id: number
  client: string
  connected: boolean
  debtTerm: string
  daysAfterPayment: number
  daysAfterOrder: number
  amountSum: number
  amountEuro: number
  sumCash: number
  sumTransfer: number
  usdCash: number
  usdTransfer: number
  euroCash: number
  euroTransfer: number
  orders: number
  altSumTransfer: number
  altAmountSum: number
}

function apiRowToClientRow(row: ApiRow): ClientRow {
  return {
    id: row.id,
    client: row.client,
    connected: row.connected,
    debtTerm: row.debtTerm || undefined,
    daysAfterPayment: row.daysAfterPayment,
    daysAfterOrder: row.daysAfterOrder,
    amount: { sum: row.amountSum, euro: row.amountEuro, usd: 0 },
    sumCash: row.sumCash,
    sumTransfer: row.sumTransfer,
    usdCash: row.usdCash,
    usdTransfer: row.usdTransfer,
    euroCash: row.euroCash,
    euroTransfer: row.euroTransfer,
    orders: row.orders,
    altSumTransfer: row.altSumTransfer,
    altAmountSum: row.altAmountSum,
  }
}

function clientRowToApiInput(row: ClientRow) {
  return {
    client: row.client,
    connected: row.connected,
    debtTerm: row.debtTerm ?? "",
    daysAfterPayment: row.daysAfterPayment,
    daysAfterOrder: row.daysAfterOrder,
    amountSum: row.amount.sum,
    amountEuro: row.amount.euro,
    sumCash: row.sumCash,
    sumTransfer: row.sumTransfer,
    usdCash: row.usdCash,
    usdTransfer: row.usdTransfer,
    euroCash: row.euroCash,
    euroTransfer: row.euroTransfer,
    orders: row.orders,
    altSumTransfer: row.altSumTransfer ?? 0,
    altAmountSum: row.altAmountSum ?? 0,
  }
}

const TOTAL_CLIENTS = 0

const TOTALS_BY_MODE = {
  created: {
    cash: { euro: 0, sum: 0, usd: 0 },
    transfer: { euro: 0, sum: 0, usd: 0 },
    total: { euro: 0, sum: 0, usd: 0 },
  },
  realized: {
    cash: { euro: 0, sum: 0, usd: 0 },
    transfer: { euro: 0, sum: 0, usd: 0 },
    total: { euro: 0, sum: 0, usd: 0 },
  },
} as const

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountText({ value }: { value: number }) {
  if (value === 0) return <span className="text-[#17233b]">0</span>
  return <span className={value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"}>{number(value)}</span>
}

export function StoreReconciliationBotView() {
  const [rows, setRows] = useState<ClientRow[]>([])
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [connectTarget, setConnectTarget] = useState<ClientRow | null>(null)
  const [editTarget, setEditTarget] = useState<ClientRow | null>(null)
  const [editName, setEditName] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/store-reconciliation-rows")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: ApiRow[]) => {
        if (cancelled) return
        setRows(Array.isArray(data) ? data.map(apiRowToClientRow) : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_CLIENTS : filtered.length
  const totals = TOTALS_BY_MODE[mode]

  const toggleConnection = async (id: number) => {
    const target = rows.find((row) => row.id === id)
    if (!target) return
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connected: !target.connected }),
      })
      if (!response.ok) {
        window.alert("Не удалось изменить подключение")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => current.map((row) => (row.id === id ? apiRowToClientRow(saved) : row)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setConnectTarget(null)
    }
  }

  const removeRow = async (id: number) => {
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить строку")
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const duplicateRow = async (row: ClientRow) => {
    const copy: ClientRow = { ...row, client: `${row.client} (копия)`, connected: false }
    try {
      const response = await fetch("/api/store-reconciliation-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientRowToApiInput(copy)),
      })
      if (!response.ok) {
        window.alert("Не удалось дублировать строку")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => {
        const index = current.findIndex((item) => item.id === row.id)
        const inserted = apiRowToClientRow(saved)
        return [...current.slice(0, index + 1), inserted, ...current.slice(index + 1)]
      })
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const startEdit = (row: ClientRow) => {
    setEditTarget(row)
    setEditName(row.client)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    try {
      const response = await fetch(`/api/store-reconciliation-rows/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: editName || editTarget.client }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить клиента")
        return
      }
      const saved = (await response.json()) as ApiRow
      setRows((current) => current.map((row) => (row.id === editTarget.id ? apiRowToClientRow(saved) : row)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setEditTarget(null)
    }
  }

  const downloadAll = () => {
    const header = ["Клиент", "Статус сверки", "Срок долга", "Прошло дней после оплаты", "Прошло дней после заказа", "Сумма", "Euro нал.", "Euro переч.", "SUM нал.", "SUM переч.", "USD нал.", "USD переч.", "Кол-во заказов"]
    const body = filtered.map((row) => {
      const sumTransfer = mode === "realized" && row.altSumTransfer !== undefined ? row.altSumTransfer : row.sumTransfer
      const amountSum = mode === "realized" && row.altAmountSum !== undefined ? row.altAmountSum : row.amount.sum
      return [
        row.client,
        row.connected ? "Подключен" : "Не подключен",
        row.debtTerm ?? "Не указано",
        row.daysAfterPayment,
        row.daysAfterOrder,
        amountSum,
        row.amount.euro,
        row.euroTransfer,
        row.sumCash,
        sumTransfer,
        row.usdCash,
        row.usdTransfer,
        row.orders,
      ]
    })
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "store-reconciliation.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Сверка счетов</span>
        </div>
        <div className="ml-auto flex overflow-hidden rounded-md">
          <button onClick={() => setMode("created")} className={`px-6 py-3 font-semibold ${mode === "created" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] border border-[#e1e5eb]"}`}>По дате создания</button>
          <button onClick={() => setMode("realized")} className={`px-6 py-3 font-semibold ${mode === "realized" ? "bg-[#3aca6a] text-white" : "bg-white text-[#586174] border border-[#e1e5eb]"}`}>По дате реализации</button>
        </div>
      </header>

      <section className="grid grid-cols-1 divide-y divide-[#e1e5eb] border-b border-[#e1e5eb] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-6 py-5 md:px-9">
          <p className="text-[#586174]">Наличными</p>
          <p className="font-semibold"><AmountText value={totals.cash.euro} /> Euro</p>
          <p className="font-semibold"><AmountText value={totals.cash.sum} /> SUM</p>
          <p className="font-semibold"><AmountText value={totals.cash.usd} /> USD</p>
        </div>
        <div className="px-6 py-5 md:px-9">
          <p className="text-[#586174]">Перечисления</p>
          <p className="font-semibold"><AmountText value={totals.transfer.euro} /> Euro</p>
          <p className="font-semibold"><AmountText value={totals.transfer.sum} /> SUM</p>
          <p className="font-semibold"><AmountText value={totals.transfer.usd} /> USD</p>
        </div>
        <div className="px-6 py-5 text-right md:px-9">
          <p className="text-[#586174]">Общий</p>
          <p className="font-semibold"><AmountText value={totals.total.euro} /> Euro</p>
          <p className="font-semibold"><AmountText value={totals.total.sum} /> SUM</p>
          <p className="font-semibold"><AmountText value={totals.total.usd} /> USD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white">
          <BarChart className="h-5 w-5" /> Скачать
        </button>
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
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Клиент
            <input placeholder="Введите имя..." value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead className="bg-[#edf2f7] text-[#253653]">
            <tr>
              {["Клиент", "Статус сверки", "Срок долга", "Прошло дней после оплаты", "Прошло дней после заказа", "Сумма", "Euro нал.", "Euro переч.", "SUM нал.", "SUM переч.", "USD нал.", "USD переч.", "Кол-во заказов"].map((title) => (
                <th key={title} className="whitespace-nowrap border border-[#e1e5eb] px-4 py-3 text-left font-semibold">{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const sumTransfer = mode === "realized" && row.altSumTransfer !== undefined ? row.altSumTransfer : row.sumTransfer
              const amountSum = mode === "realized" && row.altAmountSum !== undefined ? row.altAmountSum : row.amount.sum
              return (
                <tr key={row.id} className={`group ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="relative border border-[#e1e5eb] px-4 py-3.5">
                    <div className="group-hover:invisible">{row.client}</div>
                    <div className="invisible absolute inset-0 flex items-center gap-3 px-4 group-hover:visible">
                      <button aria-label="Редактировать" onClick={() => startEdit(row)} className="text-[#586174] hover:text-[#17233b]"><Pencil className="h-4 w-4" /></button>
                      <button aria-label="Телеграм" title="Телеграм" onClick={() => setConnectTarget(row)} className="text-[#4f70e7] hover:text-[#3a5bd0]"><Send className="h-4 w-4" /></button>
                      <button aria-label="Удалить" onClick={() => removeRow(row.id)} className="text-[#e5484d] hover:text-[#c53238]"><MinusCircle className="h-4 w-4" /></button>
                      <button aria-label="Добавить" title="Дублировать" onClick={() => duplicateRow(row)} className="text-[#3aa76d] hover:text-[#2c8f5a]"><PlusCircle className="h-4 w-4" /></button>
                    </div>
                  </td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5">
                    <button onClick={() => setConnectTarget(row)} className={row.connected ? "text-[#3aa76d]" : "text-[#4f70e7]"}>
                      {row.connected ? "Подключен" : "Не подключен"}
                    </button>
                  </td>
                  <td className={`border border-[#e1e5eb] px-4 py-3.5 ${row.debtTerm ? "text-[#e0952e]" : ""}`}>{row.debtTerm ?? "Не указано"}</td>
                  <td className={`border border-[#e1e5eb] px-4 py-3.5 ${row.daysAfterPayment > 0 ? "text-[#e5484d]" : ""}`}>{row.daysAfterPayment} дня</td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5">{row.daysAfterOrder} дня</td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={amountSum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.amount.euro} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.euroTransfer} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.sumCash} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={sumTransfer} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.usdCash} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.usdTransfer} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-3.5">{row.orders}</td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={13} className="border border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {connectTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setConnectTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Send className="h-5 w-5 text-[#4f70e7]" /> Подключение через Telegram-бот</h2>
            <p className="mb-6 text-[#586174]">
              {connectTarget.connected
                ? <>Клиент <b>{connectTarget.client}</b> подключен к боту сверки. Отключить?</>
                : <>Отправить клиенту <b>{connectTarget.client}</b> приглашение подключиться к боту сверки в Telegram?</>}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConnectTarget(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">Отмена</button>
              <button onClick={() => toggleConnection(connectTarget.id)} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">
                {connectTarget.connected ? "Отключить" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setEditTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">Редактировать клиента</h2>
            <label className="mb-6 block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
              Название
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
            </label>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditTarget(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">Отмена</button>
              <button onClick={saveEdit} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
