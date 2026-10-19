"use client"

import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import type { Cashbox as RawCashbox } from "@/components/analytics/cashboxes-data"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

type Cashbox = { id: number; name: string; currency: string; balance: number }
type LedgerEntry = {
  id: number
  cashboxId: number
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: Date
  amount: number
}
type ApiEntry = {
  id: number
  cashboxId: number
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: string
  amount: number
}

function apiToEntry(api: ApiEntry): LedgerEntry {
  return { ...api, date: new Date(api.date) }
}
function entryToPayload(entry: Omit<LedgerEntry, "id">) {
  return {
    cashboxId: entry.cashboxId,
    description: entry.description,
    category: entry.category,
    clientName: entry.clientName,
    branch: entry.branch,
    organization: entry.organization,
    comment: entry.comment,
    date: entry.date.toISOString(),
    amount: entry.amount,
  }
}
function withBalances(rawCashboxes: RawCashbox[], entries: LedgerEntry[]): Cashbox[] {
  return rawCashboxes.map((box) => ({
    id: box.id,
    name: box.name,
    currency: box.currency,
    balance: entries.filter((entry) => entry.cashboxId === box.id).reduce((sum, entry) => sum + entry.amount, 0),
  }))
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

function emptyMoveDraft() {
  return { clientName: "", branch: "", organization: "", amount: "" }
}
function emptyEntryDraft() {
  return { description: "", category: "", branch: "", organization: "", amount: "" }
}

type ModalKind = "accept" | "bulk" | "income" | "expense" | "transfer" | "request" | null

export function CashManagementView() {
  const [rawCashboxes, setRawCashboxes] = useState<RawCashbox[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const cashboxes = useMemo(() => withBalances(rawCashboxes, ledger), [rawCashboxes, ledger])
  const [selectedId, setSelectedId] = useState<number | "all">("all")
  const [modal, setModal] = useState<ModalKind>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [periodFrom, setPeriodFrom] = useState("")
  const [periodTo, setPeriodTo] = useState("")

  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState({ description: "", amount: "" })
  const pageSize = 25

  const [acceptDraft, setAcceptDraft] = useState(emptyMoveDraft)
  const [bulkRows, setBulkRows] = useState([{ clientName: "", amount: "" }])
  const [entryDraft, setEntryDraft] = useState(emptyEntryDraft)

  useEffect(() => {
    fetch("/api/cashboxes")
      .then((response) => (response.ok ? (response.json() as Promise<RawCashbox[]>) : Promise.reject()))
      .then(setRawCashboxes)
      .catch(() => {})
    fetch("/api/cash-management-entries")
      .then((response) => (response.ok ? (response.json() as Promise<ApiEntry[]>) : Promise.reject()))
      .then((rows) => setLedger(rows.map(apiToEntry)))
      .catch(() => {})
  }, [])

  const selectedCashbox = selectedId === "all" ? null : cashboxes.find((box) => box.id === selectedId) ?? null

  function flash(message: string) {
    setNotice(message)
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 3000)
  }

  const scopedLedger = useMemo(() => {
    let list = selectedId === "all" ? ledger : ledger.filter((entry) => entry.cashboxId === selectedId)
    if (periodFrom) list = list.filter((entry) => entry.date >= new Date(periodFrom))
    if (periodTo) { const to = new Date(periodTo); to.setHours(23, 59, 59, 999); list = list.filter((entry) => entry.date <= to) }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((entry) => entry.description.toLowerCase().includes(q) || entry.clientName.toLowerCase().includes(q) || entry.organization.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [ledger, selectedId, query, periodFrom, periodTo])

  const pageCount = Math.max(1, Math.ceil(scopedLedger.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = scopedLedger.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function pushEntry(entry: Omit<LedgerEntry, "id">): Promise<boolean> {
    try {
      const response = await fetch("/api/cash-management-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryToPayload(entry)),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить запись")
        return false
      }
      const saved = (await response.json()) as ApiEntry
      setLedger((current) => [apiToEntry(saved), ...current])
      return true
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
      return false
    }
  }

  async function submitAccept(event: FormEvent) {
    event.preventDefault()
    if (!selectedCashbox) return
    const amount = Number(acceptDraft.amount)
    if (!acceptDraft.clientName.trim() || !amount) return
    const ok = await pushEntry({
      cashboxId: selectedCashbox.id, description: `Приход на счет клиента ${acceptDraft.clientName.trim()}`, category: "Клиент",
      clientName: acceptDraft.clientName.trim(), branch: acceptDraft.branch || "-", organization: acceptDraft.organization || "-", comment: "", date: new Date(), amount,
    })
    if (!ok) return
    setAcceptDraft(emptyMoveDraft())
    setModal(null)
    flash("Деньги приняты")
  }

  async function submitBulk(event: FormEvent) {
    event.preventDefault()
    if (!selectedCashbox) return
    let count = 0
    for (const row of bulkRows) {
      const amount = Number(row.amount)
      if (!row.clientName.trim() || !amount) continue
      const ok = await pushEntry({
        cashboxId: selectedCashbox.id, description: `Приход на счет клиента ${row.clientName.trim()}`, category: "Клиент",
        clientName: row.clientName.trim(), branch: "-", organization: "-", comment: "", date: new Date(), amount,
      })
      if (ok) count += 1
    }
    setBulkRows([{ clientName: "", amount: "" }])
    setModal(null)
    flash(`Групповой приход добавлен: ${count}`)
  }

  async function submitEntry(kind: "income" | "expense", event: FormEvent) {
    event.preventDefault()
    if (!selectedCashbox) return
    const amount = Number(entryDraft.amount)
    if (!entryDraft.description.trim() || !amount) return
    const ok = await pushEntry({
      cashboxId: selectedCashbox.id, description: entryDraft.description.trim(), category: entryDraft.category || "",
      clientName: "", branch: entryDraft.branch || "-", organization: entryDraft.organization || "-", comment: "",
      date: new Date(), amount: kind === "expense" ? -Math.abs(amount) : Math.abs(amount),
    })
    if (!ok) return
    setEntryDraft(emptyEntryDraft())
    setModal(null)
    flash(kind === "expense" ? "Расход добавлен" : "Приход добавлен")
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault()
    const form = new FormData(event.target as HTMLFormElement)
    const to = Number(form.get("to"))
    const amount = Number(form.get("amount"))
    if (!selectedCashbox || !to || !amount || to === selectedCashbox.id) return
    const toBox = cashboxes.find((box) => box.id === to)
    const now = new Date()
    const ok1 = await pushEntry({ cashboxId: selectedCashbox.id, description: `Перевод в ${toBox?.name ?? ""}`, category: "Перевод", clientName: "", branch: "-", organization: "-", comment: "", date: now, amount: -amount })
    const ok2 = await pushEntry({ cashboxId: to, description: `Перевод из ${selectedCashbox.name}`, category: "Перевод", clientName: "", branch: "-", organization: "-", comment: "", date: now, amount })
    if (!ok1 || !ok2) return
    setModal(null)
    flash("Перевод выполнен")
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    setModal(null)
    flash("Запрос средств отправлен")
  }

  function openEditEntry(entry: LedgerEntry) {
    setEditDraft({ description: entry.description, amount: String(entry.amount) })
    setEditingId(entry.id)
    setMenuId(null)
  }
  async function saveEditEntry(event: FormEvent) {
    event.preventDefault()
    const entry = ledger.find((item) => item.id === editingId)
    if (!entry) return
    const amount = Number(editDraft.amount)
    if (!editDraft.description.trim() || Number.isNaN(amount)) return
    try {
      const response = await fetch(`/api/cash-management-entries/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entryToPayload({ ...entry, description: editDraft.description.trim(), amount })),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить запись")
        return
      }
      const saved = (await response.json()) as ApiEntry
      setLedger((current) => current.map((item) => (item.id === editingId ? apiToEntry(saved) : item)))
      setEditingId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }
  async function removeEntry(entry: LedgerEntry) {
    if (!window.confirm("Удалить запись?")) return
    setMenuId(null)
    try {
      const response = await fetch(`/api/cash-management-entries/${entry.id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить запись")
        return
      }
      setLedger((current) => current.filter((item) => item.id !== entry.id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }
  function printEntry(entry: LedgerEntry) {
    setMenuId(null)
    const win = window.open("", "_blank", "width=420,height=560")
    if (!win) return
    win.document.write(`<pre style="font-family:sans-serif;padding:24px">Описание: ${entry.description}\nФилиал: ${entry.branch}\nОрганизация: ${entry.organization}\nДата: ${fmtDateTime(entry.date)}\nСумма: ${fmtSum(entry.amount)}</pre>`)
    win.document.close()
    win.focus()
    win.print()
  }

  function downloadList() {
    const header = ["№", "Описание", "Категория", "Филиал", "Организация", "Дата", "Сумма"]
    const rows = scopedLedger.map((entry) => [entry.id, entry.description, entry.category, entry.branch, entry.organization, fmtDateTime(entry.date), entry.amount])
    downloadExcelTable("cash-management.xls", [header, ...rows])
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8]">
      <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" /> <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> Управления кассой
        </h1>
        {selectedCashbox && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setModal("accept")} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <CreditCard className="h-4 w-4" /> Принять деньги
            </button>
            <button type="button" onClick={() => setModal("bulk")} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <Users className="h-4 w-4" /> Груповой приход
            </button>
            <button type="button" onClick={() => setModal("income")} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Приход
            </button>
            <button type="button" onClick={() => setModal("expense")} className="inline-flex items-center gap-2 rounded bg-rose-500 px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <Minus className="h-4 w-4" /> Расход
            </button>
          </div>
        )}
      </header>

      {notice && (
        <div className="mx-9 mt-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{notice}</div>
      )}

      <div className="flex gap-5 px-9 py-4 text-[13px]">
        <aside className="w-72 shrink-0 overflow-hidden rounded bg-white shadow">
          <p className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-700">Кассы</p>
          <button
            type="button"
            onClick={() => setSelectedId("all")}
            className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedId === "all" ? "bg-blue-50" : ""}`}
          >
            <span className="block font-medium text-slate-700">Общий объем</span>
            <span className="block text-sm text-slate-400">во всех кассах</span>
          </button>
          {cashboxes.map((box) => (
            <button
              key={box.id}
              type="button"
              onClick={() => { setSelectedId(box.id); setPage(1) }}
              className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selectedId === box.id ? "bg-blue-50" : ""}`}
            >
              <span>
                <span className="block font-medium text-slate-700">{box.name}</span>
                <span className="block text-sm text-emerald-600">{fmtSum(box.balance, box.currency)}</span>
              </span>
              <CreditCard className="h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-700">{selectedId === "all" ? "Общий объем" : selectedCashbox?.name}</h2>
            {(
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => (selectedCashbox ? setModal("transfer") : window.alert("Выберите кассу"))} className="h-[26px] rounded-[2px] border border-[#4f71dc] px-4 text-[13px] text-[#4f71dc] hover:bg-blue-50">
                  <ArrowLeftRight className="mr-1.5 inline h-4 w-4" /> Перевод
                </button>
                <button type="button" onClick={() => (selectedCashbox ? setModal("request") : window.alert("Выберите кассу"))} className="h-[26px] rounded-[2px] border border-[#71ce87] px-4 text-[13px] text-[#71ce87] hover:bg-emerald-50">
                  Запрос средств
                </button>
                <button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="История" className={`rounded-full border p-2 ${historyOpen ? "border-[#4f71dc] text-[#4f71dc]" : "border-slate-300 text-slate-500"}`}>
                  <Clock className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <section className="overflow-hidden rounded bg-white shadow">
            <div className="flex flex-wrap items-center gap-4 px-5 py-3">
              <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
                Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
              </button>
              <label className="relative w-64">
                <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
                <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
              </label>
              <span className="ml-auto text-slate-500">25</span>
              <span className="text-slate-500">
                {scopedLedger.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, scopedLedger.length)} из {scopedLedger.length}
              </span>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
                <ChevronLeft className="h-5 w-5 text-slate-400" />
              </button>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
              <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f71dc]">
                <Download className="h-5 w-5" />
              </button>
            </div>

            {(filterOpen || historyOpen) && (
              <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
                <label className="text-sm text-slate-600">
                  Период с:{" "}
                  <input type="date" value={periodFrom} onChange={(event) => { setPeriodFrom(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1" />
                </label>
                <label className="text-sm text-slate-600">
                  по:{" "}
                  <input type="date" value={periodTo} onChange={(event) => { setPeriodTo(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1" />
                </label>
              </div>
            )}

            <table className="w-full text-left">
              <thead className="bg-[#5d6474] text-white">
                <tr>
                  <th className="px-9 py-4 text-[13px]">№</th>
                  {selectedId === "all" && <th className="px-5 py-4 text-[13px]">Касса</th>}
                  <th className="px-5 py-4 text-[13px]">Детали</th>
                  <th className="px-5 py-4 text-[13px]">Указанная дата</th>
                  <th className="px-5 py-4 text-[13px] text-right">Сумма</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                    <td className="px-9 py-4 align-top">{entry.id}</td>
                    {selectedId === "all" && <td className="px-5 py-4 align-top">{cashboxes.find((box) => box.id === entry.cashboxId)?.name}</td>}
                    <td className="px-5 py-4 align-top text-sm">
                      <p>
                        Описание: {entry.description}
                        {entry.category && <>, Категория: <span className="text-[#4f71dc]">{entry.category}</span></>}
                        {`, Филиал: ${entry.branch}, Организация: ${entry.organization}`}
                      </p>
                      {entry.clientName ? <p>Клиент: <span className="text-[#4f71dc]">{entry.clientName}</span></p> : entry.comment ? <p>Комментарий: {entry.comment}</p> : null}
                    </td>
                    <td className="px-5 py-4 align-top whitespace-nowrap">{fmtDateTime(entry.date)}</td>
                    <td className={`px-5 py-4 align-top text-right font-medium whitespace-nowrap ${entry.amount < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                      {entry.amount > 0 ? "+" : ""}{fmtSum(entry.amount, cashboxes.find((box) => box.id === entry.cashboxId)?.currency ?? "SUM")}
                    </td>
                    <td className="relative px-3 py-4 align-top text-right">
                      <button type="button" onClick={() => setMenuId((current) => (current === entry.id ? null : entry.id))} aria-label="Ещё" className="text-slate-500 hover:text-slate-800">
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      {menuId === entry.id && (
                        <div className="absolute right-3 top-12 z-30 w-40 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                          <button type="button" onClick={() => openEditEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                            <Pencil className="h-4 w-4" /> Изменить
                          </button>
                          <button type="button" onClick={() => printEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                            <Printer className="h-4 w-4" /> Печать
                          </button>
                          <button type="button" onClick={() => removeEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-500 hover:bg-slate-50">
                            <Trash2 className="h-4 w-4" /> Удалить
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={selectedId === "all" ? 6 : 5} className="px-9 py-10 text-center text-slate-400">Ничего не найдено</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </section>
      </div>

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveEditEntry} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Изменить запись</b>
              <button type="button" onClick={() => setEditingId(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Описание
                <input autoFocus value={editDraft.description} onChange={(event) => setEditDraft((value) => ({ ...value, description: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сумма
                <input type="number" value={editDraft.amount} onChange={(event) => setEditDraft((value) => ({ ...value, amount: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
            </footer>
          </form>
        </div>
      )}

      {modal === "accept" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={submitAccept} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Принять деньги</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Клиент <span className="text-red-500">*</span>
                <input autoFocus value={acceptDraft.clientName} onChange={(event) => setAcceptDraft((value) => ({ ...value, clientName: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Филиал
                <input value={acceptDraft.branch} onChange={(event) => setAcceptDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Организация
                <input value={acceptDraft.organization} onChange={(event) => setAcceptDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сумма <span className="text-red-500">*</span>
                <input type="number" value={acceptDraft.amount} onChange={(event) => setAcceptDraft((value) => ({ ...value, amount: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Принять</button>
            </footer>
          </form>
        </div>
      )}

      {modal === "bulk" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={submitBulk} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Групповой приход</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-8">
              {bulkRows.map((row, index) => (
                <div key={index} className="flex items-end gap-3">
                  <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                    Клиент
                    <input value={row.clientName} onChange={(event) => setBulkRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, clientName: event.target.value } : item)))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block w-36 border-b border-slate-200 pb-2 font-medium">
                    Сумма
                    <input type="number" value={row.amount} onChange={(event) => setBulkRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, amount: event.target.value } : item)))} className="mt-2 block w-full outline-none" />
                  </label>
                  {bulkRows.length > 1 && (
                    <button type="button" onClick={() => setBulkRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить строку" className="mb-2 text-rose-500">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setBulkRows((current) => [...current, { clientName: "", amount: "" }])} className="text-sm text-[#4f71dc] hover:underline">
                + добавить строку
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
            </footer>
          </form>
        </div>
      )}

      {(modal === "income" || modal === "expense") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={(event) => submitEntry(modal, event)} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{modal === "expense" ? "Расход" : "Приход"}</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Описание <span className="text-red-500">*</span>
                <input autoFocus value={entryDraft.description} onChange={(event) => setEntryDraft((value) => ({ ...value, description: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Категория
                <input value={entryDraft.category} onChange={(event) => setEntryDraft((value) => ({ ...value, category: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Филиал
                <input value={entryDraft.branch} onChange={(event) => setEntryDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Организация
                <input value={entryDraft.organization} onChange={(event) => setEntryDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сумма <span className="text-red-500">*</span>
                <input type="number" value={entryDraft.amount} onChange={(event) => setEntryDraft((value) => ({ ...value, amount: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className={`rounded px-6 py-3 font-semibold text-white hover:brightness-95 ${modal === "expense" ? "bg-rose-500" : "bg-[#71ce87]"}`}>Сохранить</button>
            </footer>
          </form>
        </div>
      )}

      {modal === "transfer" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={submitTransfer} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Перевод</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <p className="text-sm text-slate-600">Из кассы: <span className="font-medium">{selectedCashbox?.name}</span></p>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                В кассу <span className="text-red-500">*</span>
                <select name="to" required className="mt-2 block w-full bg-white outline-none">
                  {cashboxes.filter((box) => box.id !== selectedCashbox?.id).map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сумма <span className="text-red-500">*</span>
                <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Перевести</button>
            </footer>
          </form>
        </div>
      )}

      {modal === "request" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={submitRequest} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Запрос средств</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <p className="text-sm text-slate-600">Касса: <span className="font-medium">{selectedCashbox?.name}</span></p>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сумма <span className="text-red-500">*</span>
                <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Комментарий
                <input name="comment" className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Отправить</button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
