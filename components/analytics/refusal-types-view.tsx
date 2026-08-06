"use client"

import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type RefusalType = { id: number; name: string; resolution: string }

const seed: RefusalType[] = [
  { id: 20, name: "наблюдатель", resolution: "" },
  { id: 19, name: "тестчада", resolution: "органиш керак" },
  { id: 16, name: "oprosnik taski", resolution: "" },
  { id: 15, name: "oprosnik taski", resolution: "etua" },
  { id: 14, name: "Kliet olishni xohlamadi", resolution: "boshqa brendni maxsulotlari tavsiya qilindi" },
  { id: 13, name: "sababsiz javob", resolution: "???" },
  { id: 12, name: "puli yo'q", resolution: "" },
  { id: 11, name: "puli yo'q", resolution: "" },
  { id: 10, name: "uyu", resolution: "tyyy" },
  { id: 9, name: "sababi yo'q", resolution: "sababi aniqlansa kyn yechim qilinadi" },
  { id: 8, name: "Shaxriyor", resolution: "ksdlsdlsdjsdsldjs" },
  { id: 7, name: "sotuvchi almashgan", resolution: "keyingi safarga va'da berildi" },
  { id: 6, name: "Другая причин", resolution: "" },
  { id: 5, name: "Цены дорогие", resolution: "" },
  { id: 4, name: "Продукт не интересен", resolution: "" },
  { id: 3, name: "Имеется продукт конкурента", resolution: "" },
  { id: 2, name: "Точка закрыт", resolution: "" },
  { id: 1, name: "У клиента нету денег", resolution: "" },
]

export function RefusalTypesView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState(seed)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<RefusalType | null>(null)
  const [draft, setDraft] = useState({ name: "", resolution: "" })
  const [favorite, setFavorite] = useState(false)

  const rows = useMemo(
    () => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) || item.resolution.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  )

  function open(item?: RefusalType) {
    setEditing(item ?? { id: 0, name: "", resolution: "" })
    setDraft(item ? { name: item.name, resolution: item.resolution } : { name: "", resolution: "" })
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editing?.id) {
      setItems((list) => list.map((item) => (item.id === editing.id ? { ...item, ...draft, name: draft.name.trim() } : item)))
    } else {
      const id = Math.max(0, ...items.map((item) => item.id)) + 1
      setItems((list) => [{ id, name: draft.name.trim(), resolution: draft.resolution }, ...list])
    }
    setEditing(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-6 w-6 ${favorite ? "fill-[#4f70e7]" : "fill-slate-500 text-slate-500"}`} />
              Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Тип отказа
          </h1>
        </header>
      )}

      <section className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={() => open()} className="text-[17px] text-[#4f70e7] hover:underline">
            + добавить
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {rows.length} из {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Решение</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{item.id}</td>
                <td className="px-5 py-4 text-[#e0972a]">{item.name}</td>
                <td className="px-5 py-4 text-slate-700">{item.resolution}</td>
                <td>
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => open(item)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => setItems((list) => list.filter((row) => row.id !== item.id))} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
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
              <h2 className="text-xl font-bold">{editing.id ? "Изменить тип отказа" : "Добавить тип отказа"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">Наименование</label>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Решение</label>
            <input value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5" />
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
