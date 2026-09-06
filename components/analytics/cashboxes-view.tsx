"use client"

import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { branches, cashboxCurrencies as currencies, cashiers, paymentTypes, type Cashbox } from "./cashboxes-data"
import { useLanguage } from "@/lib/i18n/language-context"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "валюта": "currency", "currency": "currency",
  "кассир": "cashier", "cashier": "cashier",
  "филиал": "branch", "branch": "branch",
  "тип оплаты": "paymentType", "payment type": "paymentType",
}

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
function fmtDate(date: Date, t: (text: string) => string = (text) => text) {
  return `${String(date.getDate()).padStart(2, "0")} ${t(monthNames[date.getMonth()])} ${date.getFullYear()}`
}
function fmtDateTime(date: Date, t: (text: string) => string = (text) => text) {
  return `${fmtDate(date, t)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
function fmtSum(value: number, currency = "SUM") {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`
}

function emptyCashboxDraft() {
  return { name: "", currency: currencies[0], cashier: "", branch: "", paymentType: "", vansell: false, orderNumber: "1" }
}

export function CashboxesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [managing, setManaging] = useState(false)

  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyCashboxDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
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
        if (!cancelled) setLoadError(t("Не удалось загрузить кассы с сервера"))
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
    if (!window.confirm(t("Удалить кассу?"))) return
    try {
      const response = await fetch(`/api/cashboxes/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось удалить кассу"))
        return
      }
      setCashboxes((current) => current.filter((box) => box.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
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
        setFormError(data.error || t("Не удалось сохранить кассу"))
        return
      }
      const saved = (await response.json()) as Cashbox
      setCashboxes((current) => (isEdit ? current.map((box) => (box.id === editingId ? saved : box)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      setFormError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("cashboxes-template", [[t("Наименование"), t("Валюта"), t("Кассир"), t("Филиал"), t("Тип оплаты")]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { name: string; currency: string; cashier: string; branch: string; paymentType: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.currency = row[1] ?? ""
          record.cashier = row[2] ?? ""
          record.branch = row[3] ?? ""
          record.paymentType = row[4] ?? ""
        }
        if (!record.name || /^(наименование|название|name)$/i.test(record.name)) continue
        parsed.push({
          name: record.name,
          currency: currencies.includes(record.currency) ? record.currency : currencies[0],
          cashier: cashiers.includes(record.cashier) ? record.cashier : cashiers[0],
          branch: branches.includes(record.branch) ? record.branch : "",
          paymentType: paymentTypes.includes(record.paymentType) ? record.paymentType : paymentTypes[0],
        })
      }

      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      const created: Cashbox[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/cashboxes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, currency: item.currency, cashier: item.cashier, branch: item.branch, paymentType: item.paymentType, vansell: false, orderNumber: 1 }),
          })
          if (response.ok) created.push((await response.json()) as Cashbox)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setCashboxes((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
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
    if (!window.confirm(t("Удалить запись?"))) return
    setLedger((current) => current.filter((entry) => entry.id !== id))
    setLedgerMenuId(null)
  }
  function printEntry(entry: LedgerEntry) {
    setLedgerMenuId(null)
    const win = window.open("", "_blank", "width=420,height=560")
    if (!win) return
    win.document.write(`<pre style="font-family:sans-serif;padding:24px">${t("Касса")}: ${entry.cashboxName}\n${t("Описание")}: ${entry.description}\n${t("Филиал")}: ${entry.branch}\n${t("Организация")}: ${entry.organization}\n${t("Дата")}: ${fmtDateTime(entry.date, t)}\n${t("Сумма")}: ${fmtSum(entry.amount)}</pre>`)
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
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 2, cashboxName: to, description: `${t("Перевод из")} ${from}`, category: t("Перевод"), clientName: "", branch: "-", organization: "-", comment: "", date: now, amount },
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 1, cashboxName: from, description: `${t("Перевод в")} ${to}`, category: t("Перевод"), clientName: "", branch: "-", organization: "-", comment: "", date: now, amount: -amount },
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
      { id: Math.max(0, ...current.map((entry) => entry.id)) + 1, cashboxName: request.cashboxName, description: `${t("Принято денег с")} ${request.createdBy}`, category: "", clientName: "", branch: request.branch, organization: request.organization, comment: "", date: new Date(), amount: request.amount },
      ...current,
    ])
    setPending((current) => current.filter((item) => item.id !== request.id))
  }

  const pendingTotal = pending.reduce((sum, item) => sum + item.amount, 0)

  if (managing) {
    return (
      <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-600">{t("Управление кассами")}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setAcceptOpen(true)} className="rounded border border-[#4f70e7] px-4 py-2.5 font-semibold text-[#4f70e7] hover:bg-blue-50">
              {t("Принять наличные")}{pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
            <button type="button" onClick={() => setTransferOpen(true)} className="inline-flex items-center gap-2 rounded border border-[#4f70e7] px-4 py-2.5 font-semibold text-[#4f70e7] hover:bg-blue-50">
              <ArrowLeftRight className="h-4 w-4" /> {t("Перевод")}
            </button>
            <button type="button" onClick={() => setRequestOpen(true)} className="rounded bg-[#6ccd8b] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              {t("Запрос средств")}
            </button>
            <button type="button" onClick={() => setManaging(false)} className="rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              {t("К кассам")}
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
              {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition-transform ${ledgerFilterOpen ? "rotate-180" : ""}`} />
            </button>
            <label className="relative w-64">
              <input value={ledgerQuery} onChange={(event) => { setLedgerQuery(event.target.value); setLedgerPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
              <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
            </label>
            <span className="ml-auto text-slate-500">25</span>
            <span className="text-slate-500">
              {ledgerFiltered.length ? (ledgerSafePage - 1) * ledgerPageSize + 1 : 0} - {Math.min(ledgerSafePage * ledgerPageSize, ledgerFiltered.length)} {t("из")} {ledgerFiltered.length}
            </span>
            <button type="button" onClick={() => setLedgerPage((value) => Math.max(1, value - 1))} disabled={ledgerSafePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
              <ChevronLeft className="h-5 w-5 text-slate-400" />
            </button>
            <button type="button" onClick={() => setLedgerPage((value) => Math.min(ledgerPageCount, value + 1))} disabled={ledgerSafePage >= ledgerPageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          {ledgerFilterOpen && (
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <label className="text-sm text-slate-600">
                {t("Касса")}:{" "}
                <select value={ledgerCashboxFilter} onChange={(event) => { setLedgerCashboxFilter(event.target.value); setLedgerPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                  <option value="all">{t("Все")}</option>
                  {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                </select>
              </label>
            </div>
          )}

          <table className="w-full text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">№</th>
                <th className="px-5 py-5">{t("Детали")}</th>
                <th className="px-5 py-5">{t("Указанная дата")}</th>
                <th className="px-5 py-5 text-right">{t("Сумма")}</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {ledgerVisible.map((entry) => (
                <tr key={entry.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 align-top">{entry.id}</td>
                  <td className="px-5 py-4 align-top text-sm">
                    <p>{t("Касса")}: <span className="text-[#4f70e7]">{entry.cashboxName}</span></p>
                    <p>
                      {t("Описание")}: {entry.description}
                      {entry.clientName && <> <span className="text-[#4f70e7]">{entry.clientName}</span></>}
                      {entry.category && <>, {t("Категория")}: <span className="text-[#4f70e7]">{entry.category}</span></>}
                    </p>
                    <p>
                      {t("Филиал")}: {entry.branch}, {t("Организация")}: {entry.organization}
                      {entry.comment && <>, {t("Комментарий")}: {entry.comment}</>}
                    </p>
                  </td>
                  <td className="px-5 py-4 align-top whitespace-nowrap">{fmtDateTime(entry.date, t)}</td>
                  <td className={`px-5 py-4 align-top text-right font-medium whitespace-nowrap ${entry.amount < 0 ? "text-rose-500" : "text-emerald-600"}`}>
                    {entry.amount > 0 ? "+" : ""}{fmtSum(entry.amount, cashboxes.find((box) => box.name === entry.cashboxName)?.currency ?? "SUM")}
                  </td>
                  <td className="relative px-3 py-4 align-top text-right">
                    <button type="button" onClick={() => setLedgerMenuId((current) => (current === entry.id ? null : entry.id))} aria-label={t("Ещё")} className="text-slate-500 hover:text-slate-800">
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {ledgerMenuId === entry.id && (
                      <div className="absolute right-3 top-12 z-30 w-40 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                        <button type="button" onClick={() => openEditEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Pencil className="h-4 w-4" /> {t("Изменить")}
                        </button>
                        <button type="button" onClick={() => printEntry(entry)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Printer className="h-4 w-4" /> {t("Печать")}
                        </button>
                        <button type="button" onClick={() => removeEntry(entry.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-500 hover:bg-slate-50">
                          <Trash2 className="h-4 w-4" /> {t("Удалить")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {ledgerVisible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-9 py-10 text-center text-slate-400">{t("Ничего не найдено")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {editingEntryId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={saveEntry} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">{t("Изменить запись")}</b>
                <button type="button" onClick={() => setEditingEntryId(null)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Описание")}
                  <input autoFocus value={entryDraft.description} onChange={(event) => setEntryDraft((value) => ({ ...value, description: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Сумма")}
                  <input type="number" value={entryDraft.amount} onChange={(event) => setEntryDraft((value) => ({ ...value, amount: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">{t("Сохранить")}</button>
              </footer>
            </form>
          </div>
        )}

        {transferOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={submitTransfer} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">{t("Перевод между кассами")}</b>
                <button type="button" onClick={() => setTransferOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Из кассы")} <span className="text-red-500">*</span>
                  <select name="from" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("В кассу")} <span className="text-red-500">*</span>
                  <select name="to" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Сумма")} <span className="text-red-500">*</span>
                  <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">{t("Перевести")}</button>
              </footer>
            </form>
          </div>
        )}

        {requestOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <form onSubmit={submitRequest} className="w-full max-w-md rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">{t("Запрос средств")}</b>
                <button type="button" onClick={() => setRequestOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
              </header>
              <div className="space-y-5 p-8">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Касса")} <span className="text-red-500">*</span>
                  <select name="cashboxName" required className="mt-2 block w-full bg-white outline-none">
                    {cashboxes.map((box) => <option key={box.id} value={box.name}>{box.name}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Филиал")}
                  <select name="branch" className="mt-2 block w-full bg-white outline-none">
                    {branches.map((branch) => <option key={branch} value={branch}>{t(branch)}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Организация")}
                  <input name="organization" defaultValue="05,08,2025" className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {t("Сумма")} <span className="text-red-500">*</span>
                  <input name="amount" type="number" required className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <footer className="flex justify-end border-t p-5">
                <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">{t("Отправить")}</button>
              </footer>
            </form>
          </div>
        )}

        {acceptOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded bg-white">
              <header className="flex items-center justify-between border-b p-6">
                <b className="uppercase">{t("Принять наличные")}</b>
                <button type="button" onClick={() => setAcceptOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
              </header>
              <div className="flex-1 overflow-y-auto p-6">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-2 pr-4">{t("Создал")}</th>
                      <th className="py-2 pr-4">{t("Касса")}</th>
                      <th className="py-2 pr-4">{t("Филиал")}</th>
                      <th className="py-2 pr-4">{t("Организация")}</th>
                      <th className="py-2 pr-4">{t("Сумма")}</th>
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
                            <Coins className="h-4 w-4" /> {t("Принять")}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {pending.length === 0 && (
                      <tr><td colSpan={6} className="py-8 text-center text-slate-400">{t("Нет запросов на приём")}</td></tr>
                    )}
                  </tbody>
                </table>
                {pending.length > 0 && (
                  <p className="mt-4 text-sm">{t("Общая сумма")}: <span className="font-semibold text-[#4f70e7]">{fmtSum(pendingTotal)}</span></p>
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
            <Plus className="h-4 w-4" /> {t("Добавить кассу")}
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
            <FileText className="h-4 w-4" /> {t("Импорт с Excel")}
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setManaging(true)} className="ml-auto inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2.5 font-semibold text-white hover:brightness-95">
            <ArrowLeftRight className="h-4 w-4" /> {t("Управлять кассами")}
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">{t("Наименование")}</th>
              <th className="px-5 py-5">{t("Валюта")}</th>
              <th className="px-5 py-5">{t("Кассир")}</th>
              <th className="px-5 py-5">{t("Тип")}</th>
              <th className="px-5 py-5">{t("Вэнсел")}</th>
              <th className="px-5 py-5">{t("Порядковый номер")}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-9 py-10 text-center text-slate-400">{t("Загрузка касс...")}</td></tr>
            ) : loadError ? (
              <tr><td colSpan={8} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((box) => (
              <tr key={box.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{box.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{box.name}</td>
                <td className="px-5 py-4">{box.currency}</td>
                <td className="px-5 py-4">{t(box.cashier)}</td>
                <td className="px-5 py-4">{t(box.paymentType)}</td>
                <td className="px-5 py-4"><span className={`inline-block h-3 w-3 rounded-full ${box.vansell ? "bg-emerald-500" : "bg-rose-500"}`} /></td>
                <td className="px-5 py-4">{box.orderNumber}</td>
                <td className="relative px-3 py-4 text-right">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(box)} aria-label={t("Изменить")}><Pencil className="h-5 w-5" /></button>
                    <button type="button" onClick={() => removeCashbox(box.id)} aria-label={t("Удалить")}><Trash2 className="h-5 w-5" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-9 py-10 text-center text-slate-400">{t("Ничего не найдено")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCashbox} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? t("Изменить кассу") : t("Добавить кассу")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Наименование")} <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Валюта")} <span className="text-red-500">*</span>
                <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Кассир")} <span className="text-red-500">*</span>
                <select value={draft.cashier} onChange={(event) => setDraft((value) => ({ ...value, cashier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="" disabled>{t("Выберите кассира")}</option>
                  {cashiers.map((cashier) => <option key={cashier} value={cashier}>{t(cashier)}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Филиал")}
                <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">{t("Не указано")}</option>
                  {branches.map((branch) => <option key={branch} value={branch}>{t(branch)}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Тип оплаты")} <span className="text-red-500">*</span>
                <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="" disabled>{t("Выберите тип")}</option>
                  {paymentTypes.map((type) => <option key={type} value={type}>{t(type)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.vansell} onChange={(event) => setDraft((value) => ({ ...value, vansell: event.target.checked }))} className="h-4 w-4 accent-[#4f70e7]" />
                {t("Вэнсел")}
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Порядковый номер")} <span className="text-red-500">*</span>
                <input type="number" value={draft.orderNumber} onChange={(event) => setDraft((value) => ({ ...value, orderNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{t("Импорт с Excel")}</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                {t("1. Скачать шаблон")}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
