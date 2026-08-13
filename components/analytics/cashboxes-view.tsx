"use client"

import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import { branches, cashboxCurrencies as currencies, cashiers, knownCashboxes, paymentTypes, type Cashbox } from "./cashboxes-data"

type LedgerEntry = {
  id: number
  cashboxName: string
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: Date
  amount: number
}

type PendingRequest = {
  id: number
  createdBy: string
  cashboxName: string
  branch: string
  organization: string
  amount: number
  date: Date
}

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmtDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}
function fmtDateTime(date: Date) {
  return `${fmtDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
function fmtSum(value: number, currency = "SUM") {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`
}

const knownLedger: LedgerEntry[] = [
  { id: 629, cashboxName: "Salohiddin Kassa Tashkent", description: "Снято со счета клиента", category: "keshbek", clientName: "", branch: "777", organization: "05,08,2025", comment: "", date: new Date(2026, 7, 4, 18, 42), amount: -35000 },
  { id: 628, cashboxName: "xorazm Usd", description: "Приход на счет клиента", category: "Клиент", clientName: "Usman Dembele", branch: "buxoro", organization: "05,08,2025", comment: "", date: new Date(2026, 6, 18, 12, 38), amount: 12050 },
  { id: 627, cashboxName: "naqd", description: "Принято денег с Admin Ritm", category: "", clientName: "", branch: "Ташкент", organization: "Ichimliklar", comment: "", date: new Date(2026, 6, 5, 18, 44), amount: 500000 },
  { id: 626, cashboxName: "naqd", description: "Выдача денег для Кэшбека", category: "keshbek", clientName: "Частное Лицо", branch: "777", organization: "05,08,2025", comment: "312", date: new Date(2026, 3, 22, 15, 20), amount: -20000 },
  { id: 624, cashboxName: "naqd", description: "Принято денег с Admin Ritm", category: "", clientName: "", branch: "Samarqand", organization: "05,08,2025", comment: "", date: new Date(2026, 3, 22, 23, 16), amount: 70000 },
  { id: 621, cashboxName: "naqd", description: "Принято денег с Admin Ritm", category: "", clientName: "", branch: "Ташкент", organization: "Ichimliklar", comment: "", date: new Date(2026, 3, 14, 14, 37), amount: 1000 },
]

const descriptionPool = ["Принято денег с Admin Ritm", "Приход на счет клиента", "Выдача денег для Кэшбека", "Оплата поставщику", "Инкассация", "Перевод между кассами"]
const LEDGER_TOTAL = 548

function buildLedger(): LedgerEntry[] {
  const entries = [...knownLedger]
  const baseline = new Date(2026, 3, 14, 14, 37)
  let id = 620
  let step = 0
  while (entries.length < LEDGER_TOTAL) {
    step += 1
    id -= 1
    const date = new Date(baseline)
    date.setMinutes(date.getMinutes() - step * 53)
    const cashbox = knownCashboxes[step % knownCashboxes.length]
    const amount = (id % 3 === 0 ? -1 : 1) * (((id * 173) % 90000) + 1000)
    entries.push({
      id, cashboxName: cashbox.name, description: descriptionPool[step % descriptionPool.length], category: step % 4 === 0 ? "keshbek" : "",
      clientName: step % 5 === 0 ? "Частное Лицо" : "", branch: branches[step % branches.length], organization: step % 3 === 0 ? "Ichimliklar" : "05,08,2025",
      comment: "", date, amount,
    })
  }
  return entries
}

function emptyCashboxDraft() {
  return { name: "", currency: currencies[0], cashier: "", branch: "", paymentType: "", vansell: false, orderNumber: "1" }
}

export function CashboxesView({ embedded = false }: { embedded?: boolean }) {
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [ledger, setLedger] = useState<LedgerEntry[]>(buildLedger)
  const [pending, setPending] = useState<PendingRequest[]>([
    { id: 1, createdBy: "Admin Ritm", cashboxName: "naqd", branch: "Ташкент", organization: "05,08,2025", amount: 100000, date: new Date(2026, 7, 1) },
    { id: 2, createdBy: "Admin Ritm", cashboxName: "Не указано", branch: "Ташкент", organization: "05,08,2025", amount: 180000, date: new Date(2026, 7, 1) },
  ])
  const [managing, setManaging] = useState(false)

  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyCashboxDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/cashboxes")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить кассы")
        return (await response.json()) as Cashbox[]
      })
      .then((data) => {
        if (cancelled) return
        setCashboxes(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить кассы с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [ledgerQuery, setLedgerQuery] = useState("")
  const [ledgerFilterOpen, setLedgerFilterOpen] = useState(false)
  const [ledgerCashboxFilter, setLedgerCashboxFilter] = useState("all")
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerMenuId, setLedgerMenuId] = useState<number | null>(null)
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null)
  const [entryDraft, setEntryDraft] = useState({ description: "", amount: "" })
  const [transferOpen, setTransferOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const ledgerPageSize = 25

  const balances = useMemo(() => {
    const totals = new Map<string, { amount: number; currency: string }>()
    for (const entry of ledger) {
      const box = cashboxes.find((item) => item.name === entry.cashboxName)
      const currency = box?.currency ?? "SUM"
      const current = totals.get(entry.cashboxName) ?? { amount: 0, currency }
      totals.set(entry.cashboxName, { amount: current.amount + entry.amount, currency })
    }
    return totals
  }, [ledger, cashboxes])

  const filtered = useMemo(() => {
    if (!query.trim()) return cashboxes
    const q = query.trim().toLowerCase()
    return cashboxes.filter((box) => box.name.toLowerCase().includes(q))
  }, [cashboxes, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const ledgerFiltered = useMemo(() => {
    return ledger.filter((entry) => {
      if (ledgerCashboxFilter !== "all" && entry.cashboxName !== ledgerCashboxFilter) return false
      if (!ledgerQuery.trim()) return true
      const q = ledgerQuery.trim().toLowerCase()
      return entry.description.toLowerCase().includes(q) || entry.cashboxName.toLowerCase().includes(q) || entry.organization.toLowerCase().includes(q)
    })
  }, [ledger, ledgerQuery, ledgerCashboxFilter])
  const ledgerPageCount = Math.max(1, Math.ceil(ledgerFiltered.length / ledgerPageSize))
  const ledgerSafePage = Math.min(ledgerPage, ledgerPageCount)
  const ledgerVisible = ledgerFiltered.slice((ledgerSafePage - 1) * ledgerPageSize, ledgerSafePage * ledgerPageSize)

  function openCreate() {
    setDraft(emptyCashboxDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }
  function openEdit(box: Cashbox) {
    setDraft({ name: box.name, currency: box.currency, cashier: box.cashier, branch: box.branch, paymentType: box.paymentType, vansell: box.vansell, orderNumber: String(box.orderNumber) })
    setFormError("")
    setEditingId(box.id)
    setModalOpen(true)
  }
  async function removeCashbox(id: number) {
    if (!window.confirm("Удалить кассу?")) return
    try {
      const response = await fetch(`/api/cashboxes/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить кассу")
        return
      }
      setCashboxes((current) => current.filter((box) => box.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }
  async function saveCashbox(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name || !draft.currency || !draft.cashier || !draft.paymentType || !draft.orderNumber) return

    const body = {
      name,
      currency: draft.currency,
      cashier: draft.cashier,
      branch: draft.branch,
      paymentType: draft.paymentType,
      vansell: draft.vansell,
      orderNumber: Number(draft.orderNumber) || 1,
    }

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/cashboxes/${editingId}` : "/api/cashboxes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить кассу")
        return
      }
      const saved = (await response.json()) as Cashbox
      setCashboxes((current) => (isEdit ? current.map((box) => (box.id === editingId ? saved : box)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function openEditEntry(entry: LedgerEntry) {
    setEntryDraft({ description: entry.description, amount: String(entry.amount) })
    setEditingEntryId(entry.id)
    setLedgerMenuId(null)
  }
  function saveEntry(event: FormEvent) {
    event.preventDefault()
    const amount = Number(entryDraft.amount)
    if (!entryDraft.description.trim() || Number.isNaN(amount)) return
    setLedger((current) => current.map((entry) => (entry.id === editingEntryId ? { ...entry, description: entryDraft.description.trim(), amount } : entry)))
    setEditingEntryId(null)
  }
  function removeEntry(id: number) {
    if (!window.confirm("Удалить запись?")) return
    setLedger((current) => current.filter((entry) => entry.id !== id))
    setLedgerMenuId(null)
  }
  function printEntry(entry: LedgerEntry) {
    setLedgerMenuId(null)
    const win = window.open("", "_blank", "width=420,height=560")
    if (!win) return
    win.document.write(`<pre style="font-family:sans-serif;padding:24px">Касса: ${entry.cashboxName}\nОписание: ${entry.description}\nФилиал: ${entry.branch}\nОрганизация: ${entry.organization}\nДата: ${fmtDateTime(entry.date)}\nСумма: ${fmtSum(entry.amount)}</pre>`)
    win.document.close()
    win.focus()
    win.print()
  }

  function submitTransfer(event: FormEvent) {
    event.preventDefault()
    const form = new FormData(event.target as HTMLFormElement)
    const from = String(form.get("from") ?? "")
    const to = String(form.get("to") ?? "")
    const amount = Number(form.get("amount") ?? 0)
    if (!from || !to || from === to || !amount) return
    const now = new Date()
    setLedger((current) => [
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 2, cashboxName: to, description: `Перевод из ${from}`, category: "Перевод", clientName: "", branch: "-", organization: "-", comment: "", date: now, amount },
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 1, cashboxName: from, description: `Перевод в ${to}`, category: "Перевод", clientName: "", branch: "-", organization: "-", comment: "", date: now, amount: -amount },
      ...current,
    ])
    setTransferOpen(false)
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    const form = new FormData(event.target as HTMLFormElement)
    const cashboxName = String(form.get("cashboxName") ?? "")
    const branch = String(form.get("branch") ?? "")
    const organization = String(form.get("organization") ?? "")
    const amount = Number(form.get("amount") ?? 0)
    if (!cashboxName || !amount) return
    setPending((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, createdBy: "Admin Ritm", cashboxName, branch, organization, amount, date: new Date() }])
    setRequestOpen(false)
  }

  function acceptRequest(request: PendingRequest) {
    setLedger((current) => [
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 1, cashboxName: request.cashboxName, description: `Принято денег с ${request.createdBy}`, category: "", clientName: "", branch: request.branch, organization: request.organization, comment: "", date: new Date(), amount: request.amount },
      ...current,
    ])
    setPending((current) => current.filter((item) => item.id !== request.id))
  }

  const pendingTotal = pending.reduce((sum, item) => sum + item.amount, 0)

  if (managing) {
    return (
      <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-600">Управление кассами</h1>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setAcceptOpen(true)} className="rounded border border-[#4f70e7] px-4 py-2.5 font-semibold text-[#4f70e7] hover:bg-blue-50">
              Принять наличные{pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
            <button type="button" onClick={() => setTransferOpen(true)} className="inline-flex items-center gap-2 rounded border border-[#4f70e7] px-4 py-2.5 font-semibold text-[#4f70e7] hover:bg-blue-50">
              <ArrowLeftRight className="h-4 w-4" /> Перевод
            </button>
            <button type="button" onClick={() => setRequestOpen(true)} className="rounded bg-[#6ccd8b] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              Запрос средств
            </button>
            <button type="button" onClick={() => setManaging(false)} className="rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              К кассам
            </button>
          </div>
        </header>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cashboxes.slice(0, 8).map((box) => {
            const balance = balances.get(box.name)
            return (
              <div key={box.id} className="flex items-center gap-3 rounded bg-white p-4 shadow">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#4f70e7]"><Wallet className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-500">{box.name}</p>
                  <p className="font-semibold text-slate-700">{fmtSum(balance?.amount ?? 0, balance?.currency ?? box.currency)}</p>
                </div>
              </div>
            )
          })}
        </section>

        <section className="overflow-hidden rounded bg-white shadow">
          <div className="flex flex-wrap items-center gap-4 px-5 py-3">
            <button type="button" onClick={() => setLedgerFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
              Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${ledgerFilterOpen ? "rotate-180" : ""}`} />
            </button>
            <label className="relative w-64">
              <input value={ledgerQuery} onChange={(event) => { setLedgerQuery(event.target.value); setLedgerPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
              <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
            </label>
            <span className="ml-auto text-slate-500">25</span>
            <span className="text-slate-500">
              {ledgerFiltered.length ? (ledgerSafePage - 1) * ledgerPageSize + 1 : 0} - {Math.min(ledgerSafePage * ledgerPageSize, ledgerFiltered.length)} из {ledgerFiltered.length}
            </span>
            <button type="button" onClick={() => setLedgerPage((value) => Math.max(1, value - 1))} disabled={ledgerSafePage <= 1} aria-label="Назад" className="disabled:opacity-30">
              <ChevronLeft className="h-5 w-5 text-slate-400" />
            </button>
            <button type="button" onClick={() => setLedgerPage((value) => Math.min(ledgerPageCount, value + 1))} disabled={ledgerSafePage >= ledgerPageCount} aria-label="Вперед" className="disabled:opacity-30">
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          {ledgerFilterOpen && (
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <label className="text-sm text-slate-600">
                Касса:{" "}
                <select value={ledgerCashboxFilter} onChange={(event) => { setLedgerCashboxFilter(event.target.value); setLedgerPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                  <option value="all">Все</option>
                  {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                </select>
              </label>
            </div>
          )}

          <table className="w-full text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">№</th>
                <th className="px-5 py-5">Детали</th>
                <th className="px-5 py-5">Указанная дата</th>
                <th className="px-5 py-5 text-right">Сумма</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {ledgerVisible.map((entry) => (
                <tr key={entry.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 align-top">{entry.id}</td>
                  <td className="px-5 py-4 align-top text-sm">
                    <p>Касса: <span className="text-[#4f70e7]">{entry.cashboxName}</span></p>
                    <p>
                      Описание: {entry.description}
                      {entry.clientName && <> <span className="text-[#4f70e7]">{entry.clientName}</span></>}
                      {entry.category && <>, Категория: <span className="text-[#4f70e7]">{entry.category}</span></>}
                    </p>
                    <p>
                      Филиал: {entry.branch}, Организация: {entry.organization}
                      {entry.comment && <>, Комментарий: {entry.comment}</>}
                    </p>
                  </td>
                  <td className="px-5 py-4 align-top whitespace-nowrap">{fmtDateTime(entry.date)}</td>
                  <td className={`px-5 py-4 align-top text-right font-medium whitespace-nowrap ${entry.amount < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                    {entry.amount > 0 ? "+" : ""}{fmtSum(entry.amount, cashboxes.find((box) => box.name === entry.cashboxName)?.currency ?? "SUM")}
                  </td>
                  <td className="relative px-3 py-4 align-top text-right">
                    <button type="button" onClick={() => setLedgerMenuId((current) => (current === entry.id ? null : entry.id))} aria-label="Ещё" className="text-slate-500 hover:text-slate-800">
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {ledgerMenuId === entry.id && (
                      <div className="absolute right-3 top-12 z-30 w-40 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                        <button type="button" onClick={() => openEditEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Pencil className="h-4 w-4" /> Изменить
                        </button>
                        <button type="button" onClick={() => printEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Printer className="h-4 w-4" /> Печать
                        </button>
                        <button type="button" onClick={() => removeEntry(entry.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-500 hover:bg-slate-50">
                          <Trash2 className="h-4 w-4" /> Удалить
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {ledgerVisible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-9 py-10 text-center text-slate-400">Ничего не найдено</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {editingEntryId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={saveEntry} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">Изменить запись</b>
                <button type="button" onClick={() => setEditingEntryId(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Описание
                  <input autoFocus value={entryDraft.description} onChange={(event) => setEntryDraft((value) => ({ ...value, description: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Сумма
                  <input type="number" value={entryDraft.amount} onChange={(event) => setEntryDraft((value) => ({ ...value, amount: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
              </footer>
            </form>
          </div>
        )}

        {transferOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={submitTransfer} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">Перевод между кассами</b>
                <button type="button" onClick={() => setTransferOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Из кассы <span className="text-red-500">*</span>
                  <select name="from" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  В кассу <span className="text-red-500">*</span>
                  <select name="to" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Сумма <span className="text-red-500">*</span>
                  <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">Перевести</button>
              </footer>
            </form>
          </div>
        )}

        {requestOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={submitRequest} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">Запрос средств</b>
                <button type="button" onClick={() => setRequestOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Касса <span className="text-red-500">*</span>
                  <select name="cashboxName" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Филиал
                  <select name="branch" className="mt-2 block w-full bg-white outline-none">
                    {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Организация
                  <input name="organization" defaultValue="05,08,2025" className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Сумма <span className="text-red-500">*</span>
                  <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">Отправить</button>
              </footer>
            </form>
          </div>
        )}

        {acceptOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">Принять наличные</b>
                <button type="button" onClick={() => setAcceptOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
              </header>
              <div className="flex-1 overflow-y-auto p-6">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-2 pr-4">Создал</th>
                      <th className="py-2 pr-4">Касса</th>
                      <th className="py-2 pr-4">Филиал</th>
                      <th className="py-2 pr-4">Организация</th>
                      <th className="py-2 pr-4">Сумма</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((request) => (
                      <tr key={request.id} className="border-t border-slate-100">
                        <td className="py-3 pr-4">{request.createdBy}</td>
                        <td className="py-3 pr-4">{request.cashboxName}</td>
                        <td className="py-3 pr-4">{request.branch}</td>
                        <td className="py-3 pr-4">{request.organization}</td>
                        <td className="py-3 pr-4 text-[#4f70e7]">{fmtSum(request.amount)}</td>
                        <td className="py-3">
                          <button type="button" onClick={() => acceptRequest(request)} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-xs font-semibold text-white hover:brightness-95">
                            <Coins className="h-4 w-4" /> Принять
                          </button>
                        </td>
                      </tr>
                    ))}
                    {pending.length === 0 && (
                      <tr><td colSpan={6} className="py-8 text-center text-slate-400">Нет запросов на приём</td></tr>
                    )}
                  </tbody>
                </table>
                {pending.length > 0 && (
                  <p className="mt-4 text-sm">Общая сумма: <span className="font-semibold text-[#4f70e7]">{fmtSum(pendingTotal)}</span></p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> Добавить кассу
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setManaging(true)} className="ml-auto inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2.5 font-semibold text-white hover:brightness-95">
            <ArrowLeftRight className="h-4 w-4" /> Управлять кассами
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Валюта</th>
              <th className="px-5 py-5">Кассир</th>
              <th className="px-5 py-5">Тип</th>
              <th className="px-5 py-5">Вэнсел</th>
              <th className="px-5 py-5">Порядковый номер</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-9 py-10 text-center text-slate-400">Загрузка касс...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={8} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((box) => (
              <tr key={box.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{box.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{box.name}</td>
                <td className="px-5 py-4">{box.currency}</td>
                <td className="px-5 py-4">{box.cashier}</td>
                <td className="px-5 py-4">{box.paymentType}</td>
                <td className="px-5 py-4"><span className={`inline-block h-3 w-3 rounded-full ${box.vansell ? "bg-emerald-500" : "bg-rose-500"}`} /></td>
                <td className="px-5 py-4">{box.orderNumber}</td>
                <td className="relative px-3 py-4 text-right">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(box)} aria-label="Изменить"><Pencil className="h-5 w-5" /></button>
                    <button type="button" onClick={() => removeCashbox(box.id)} aria-label="Удалить"><Trash2 className="h-5 w-5" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-9 py-10 text-center text-slate-400">Ничего не найдено</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCashbox} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить кассу" : "Добавить кассу"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Валюта <span className="text-red-500">*</span>
                <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Кассир <span className="text-red-500">*</span>
                <select value={draft.cashier} onChange={(event) => setDraft((value) => ({ ...value, cashier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="" disabled>Выберите кассира</option>
                  {cashiers.map((cashier) => <option key={cashier} value={cashier}>{cashier}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Филиал
                <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Не указано</option>
                  {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Тип оплаты <span className="text-red-500">*</span>
                <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="" disabled>Выберите тип</option>
                  {paymentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.vansell} onChange={(event) => setDraft((value) => ({ ...value, vansell: event.target.checked }))} className="h-4 w-4 accent-[#4f70e7]" />
                Вэнсел
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Порядковый номер <span className="text-red-500">*</span>
                <input type="number" value={draft.orderNumber} onChange={(event) => setDraft((value) => ({ ...value, orderNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
