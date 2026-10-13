"use client"

import { CreditCard, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { FormEvent, useEffect, useMemo, useState } from "react"

const SUBSCRIPTION_PERIODS = ["Месяц", "Год"] as const
const SUBSCRIPTION_STATUSES = ["Активна", "Приостановлена", "Отменена"] as const

type Subscription = {
  id: number
  planName: string
  price: number
  billingPeriod: string
  status: string
  renewsAt: string
  note: string
}

const emptyDraft = {
  planName: "",
  price: 0,
  billingPeriod: SUBSCRIPTION_PERIODS[0] as string,
  status: SUBSCRIPTION_STATUSES[0] as string,
  renewsAt: "",
  note: "",
}

const statusColors: Record<string, string> = {
  "Активна": "bg-emerald-50 text-emerald-600",
  "Приостановлена": "bg-amber-50 text-amber-600",
  "Отменена": "bg-red-50 text-red-600",
}

function formatSum(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} SUM`
}

export function SubscriptionsView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState<Subscription[]>([])
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<Subscription | null>(null)
  const [draft, setDraft] = useState(emptyDraft)

  useEffect(() => {
    let cancelled = false
    fetch("/api/subscriptions")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить подписки")
        return (await response.json()) as Subscription[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить подписки с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => items.filter((item) => item.planName.toLowerCase().includes(query.toLowerCase())), [items, query])

  function open(item?: Subscription) {
    setEditing(item ?? { id: 0, ...emptyDraft })
    setDraft(
      item
        ? { planName: item.planName, price: item.price, billingPeriod: item.billingPeriod, status: item.status, renewsAt: item.renewsAt, note: item.note }
        : emptyDraft,
    )
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.planName.trim()) return
    const body = JSON.stringify(draft)
    try {
      if (editing?.id) {
        const response = await fetch(`/api/subscriptions/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить подписку")
          return
        }
        const saved = (await response.json()) as Subscription
        setItems((list) => list.map((item) => (item.id === editing.id ? saved : item)))
      } else {
        const response = await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось добавить подписку")
          return
        }
        const saved = (await response.json()) as Subscription
        setItems((list) => [saved, ...list])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/subscriptions/${id}`, { method: "DELETE" })
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
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
            <span className="mx-2 text-slate-400">|</span> Подписки
          </h1>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={() => open()} className="text-[17px] text-[#4f71dc] hover:underline">
            + добавить
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">
            {rows.length} из {items.length}
          </span>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">Тариф</th>
              <th className="px-5 py-5">Цена</th>
              <th className="px-5 py-5">Период</th>
              <th className="px-5 py-5">Продление</th>
              <th className="px-5 py-5">Статус</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <CreditCard className="h-5 w-5 text-slate-400" />
                    {item.planName}
                  </div>
                </td>
                <td className="px-5 py-4 text-slate-600">{formatSum(item.price)}</td>
                <td className="px-5 py-4 text-slate-600">{item.billingPeriod}</td>
                <td className="px-5 py-4 text-slate-600">{item.renewsAt || "—"}</td>
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
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
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
              <h2 className="text-xl font-bold">{editing.id ? "Изменить подписку" : "Добавить подписку"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">Тариф</label>
            <input autoFocus value={draft.planName} onChange={(event) => setDraft({ ...draft, planName: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Цена</label>
            <input type="number" min={0} value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Период</label>
            <select value={draft.billingPeriod} onChange={(event) => setDraft({ ...draft, billingPeriod: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {SUBSCRIPTION_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
            <label className="mb-2 block font-medium">Дата продления</label>
            <input type="date" value={draft.renewsAt} onChange={(event) => setDraft({ ...draft, renewsAt: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Статус</label>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {SUBSCRIPTION_STATUSES.map((status) => (
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
