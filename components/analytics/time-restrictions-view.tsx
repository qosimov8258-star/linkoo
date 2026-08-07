"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, X } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type TimeRestriction = { id: number; name: string; from: string; to: string; fullDay: boolean }

const seed: TimeRestriction[] = [
  { id: 1, name: "Создания заказа", from: "00:00", to: "23:59", fullDay: true },
  { id: 2, name: "Редактировать заказ", from: "00:00", to: "23:59", fullDay: true },
]

export function TimeRestrictionsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState(seed)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<TimeRestriction | null>(null)
  const [draft, setDraft] = useState({ fullDay: true, from: "00:00", to: "23:59" })
  const pageSize = 25

  const filtered = useMemo(() => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())), [rows, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openEdit(row: TimeRestriction) {
    setDraft({ fullDay: row.fullDay, from: row.from, to: row.to })
    setEditing(row)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setRows((current) => current.map((row) => (row.id === editing.id ? { ...row, ...draft } : row)))
    setEditing(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <label className="relative w-72">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Наименование</th>
              <th className="px-5 py-5">Время работы</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-5">{row.name}</td>
                <td className="px-5 py-5">{row.fullDay ? "Работает полный день" : `${row.from} — ${row.to}`}</td>
                <td className="px-5 py-5 text-right">
                  <button type="button" onClick={() => openEdit(row)} aria-label="Изменить" className="text-slate-500 hover:text-[#4f70e7]">
                    <Pencil className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">{editing.name}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-4 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={draft.fullDay} onChange={(event) => setDraft((value) => ({ ...value, fullDay: event.target.checked }))} className="h-5 w-5" />
              Работает полный день
            </label>
            {!draft.fullDay && (
              <div className="mb-4 grid grid-cols-2 gap-4">
                <label className="text-sm font-medium">
                  От
                  <input type="time" value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} className="mt-1 block w-full rounded border border-slate-300 px-3 py-2" />
                </label>
                <label className="text-sm font-medium">
                  До
                  <input type="time" value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} className="mt-1 block w-full rounded border border-slate-300 px-3 py-2" />
                </label>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="submit" className="rounded bg-[#5474e6] px-4 py-2 font-semibold text-white">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
