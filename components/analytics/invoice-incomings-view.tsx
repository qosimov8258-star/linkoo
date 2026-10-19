"use client"

import { FileText, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const INVOICE_INCOMING_STATUSES = ["Получен", "Проведён", "Отклонён"] as const

type Invoice = {
  id: number
  documentNumber: string
  supplier: string
  date: string
  amount: number
  branch: string
  status: string
  note: string
}

const emptyDraft = {
  documentNumber: "",
  supplier: "",
  date: "",
  amount: 0,
  branch: "",
  status: INVOICE_INCOMING_STATUSES[0] as string,
  note: "",
}

const statusColors: Record<string, string> = {
  "Получен": "bg-sky-50 text-sky-600",
  "Проведён": "bg-emerald-50 text-emerald-600",
  "Отклонён": "bg-red-50 text-red-600",
}

function formatSum(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} SUM`
}

export function InvoiceIncomingsView() {
  const [items, setItems] = useState<Invoice[]>([])
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [draft, setDraft] = useState(emptyDraft)

  useEffect(() => {
    let cancelled = false
    fetch("/api/invoice-incomings")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить входящие счета-фактуры")
        return (await response.json()) as Invoice[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить входящие счета-фактуры с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () =>
      items.filter(
        (item) =>
          item.supplier.toLowerCase().includes(query.toLowerCase()) ||
          item.documentNumber.toLowerCase().includes(query.toLowerCase()),
      ),
    [items, query],
  )

  const total = useMemo(() => rows.reduce((sum, item) => sum + item.amount, 0), [rows])

  function open(item?: Invoice) {
    setEditing(item ?? { id: 0, ...emptyDraft })
    setDraft(
      item
        ? { documentNumber: item.documentNumber, supplier: item.supplier, date: item.date, amount: item.amount, branch: item.branch, status: item.status, note: item.note }
        : emptyDraft,
    )
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.supplier.trim()) return
    const body = JSON.stringify(draft)
    try {
      if (editing?.id) {
        const response = await fetch(`/api/invoice-incomings/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить документ")
          return
        }
        const saved = (await response.json()) as Invoice
        setItems((list) => list.map((item) => (item.id === editing.id ? saved : item)))
      } else {
        const response = await fetch("/api/invoice-incomings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось добавить документ")
          return
        }
        const saved = (await response.json()) as Invoice
        setItems((list) => [saved, ...list])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/invoice-incomings/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить запись")
        return
      }
      setItems((list) => list.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7">
      <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> Входящие счет фактуры
        </h1>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={() => open()} className="text-[17px] text-[#4f71dc] hover:underline">
            + добавить
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">Итого: {formatSum(total)}</span>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-4 text-[13px]">№ документа</th>
              <th className="px-5 py-4 text-[13px]">Поставщик</th>
              <th className="px-5 py-4 text-[13px]">Дата</th>
              <th className="px-5 py-4 text-[13px]">Сумма</th>
              <th className="px-5 py-4 text-[13px]">Филиал</th>
              <th className="px-5 py-4 text-[13px]">Статус</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <FileText className="h-5 w-5 text-slate-400" />
                    {item.documentNumber || "—"}
                  </div>
                </td>
                <td className="px-5 py-4 text-slate-600">{item.supplier}</td>
                <td className="px-5 py-4 text-slate-600">{item.date || "—"}</td>
                <td className="px-5 py-4 text-slate-600">{formatSum(item.amount)}</td>
                <td className="px-5 py-4 text-slate-600">{item.branch || "—"}</td>
                <td className="px-5 py-4">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColors[item.status] ?? "bg-slate-100 text-slate-500"}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => open(item)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(item.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">{editing.id ? "Изменить документ" : "Добавить документ"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">№ документа</label>
            <input autoFocus value={draft.documentNumber} onChange={(event) => setDraft({ ...draft, documentNumber: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Поставщик</label>
            <input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Дата</label>
            <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Сумма</label>
            <input type="number" min={0} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Филиал</label>
            <input value={draft.branch} onChange={(event) => setDraft({ ...draft, branch: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Статус</label>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {INVOICE_INCOMING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <label className="mb-2 block font-medium">Примечание</label>
            <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5" />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="submit" className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white">
                <Plus className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
