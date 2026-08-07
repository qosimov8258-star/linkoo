"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type Position = { id: number; name: string; date: string }

const extraNames = [
  "Менеджер", "Кассир", "Экспедитор", "Мерчендайзер", "Бухгалтер", "Логист", "Складовщик", "Курьер", "Технолог",
  "Дизайнер", "Маркетолог", "Аналитик", "Юрист", "Секретарь", "HR-менеджер", "Контент-менеджер", "SMM-менеджер",
  "Программист", "Тестировщик", "Системный администратор", "Инженер", "Электрик", "Сантехник", "Уборщик", "Охранник",
  "Грузчик", "Комплектовщик", "Приемщик",
]

function generatePositions(): Position[] {
  const seed: [number, string, string][] = [
    [49, "РОП", "05 янв. 2026, 17:37"],
    [48, "HR", "05 янв. 2026, 17:37"],
    [47, "Водитель", "05 янв. 2026, 17:37"],
    [46, "Zakaz uruvchi", "25 дек. 2025, 12:57"],
    [45, "Varkteyk", "20 дек. 2025, 12:16"],
    [44, "Agentcha", "20 дек. 2025, 12:06"],
    [43, "fps_max", "20 дек. 2025, 12:06"],
    [42, "test_doljenost", "06 дек. 2025, 17:19"],
    [40, "derektor", "25 нояб. 2025, 19:59"],
    [39, "Sotuvchi", "25 нояб. 2025, 19:02"],
    [38, "Operator", "25 нояб. 2025, 19:02"],
  ]

  const rows: Position[] = seed.map(([id, name, date]) => ({ id, name, date }))
  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  let id = 37
  let index = 0
  while (rows.length < 39) {
    const day = 1 + (index % 28)
    const month = months[index % 12]
    const year = 2024 + (index % 2)
    const hour = String(9 + (index % 10)).padStart(2, "0")
    const minute = String((index * 7) % 60).padStart(2, "0")
    rows.push({ id, name: extraNames[index % extraNames.length], date: `${String(day).padStart(2, "0")} ${month} ${year}, ${hour}:${minute}` })
    id -= 1
    index += 1
  }
  return rows
}

const seedPositions = generatePositions()

export function PositionsView({ embedded = false }: { embedded?: boolean }) {
  const [positions, setPositions] = useState(seedPositions)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Position | null>(null)
  const [name, setName] = useState("")
  const pageSize = 25

  const filtered = useMemo(() => positions.filter((position) => position.name.toLowerCase().includes(query.toLowerCase())), [positions, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setName("")
    setEditing({ id: 0, name: "", date: "" })
  }

  function openEdit(position: Position) {
    setName(position.name)
    setEditing(position)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    if (editing?.id) {
      setPositions((list) => list.map((position) => (position.id === editing.id ? { ...position, name: name.trim() } : position)))
    } else {
      const id = Math.max(0, ...positions.map((position) => position.id)) + 1
      const today = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(".", "")
      setPositions((list) => [{ id, name: name.trim(), date: today }, ...list])
    }
    setEditing(null)
  }

  function remove(id: number) {
    setPositions((list) => list.filter((position) => position.id !== id))
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="text-[17px] text-[#4f70e7] hover:underline">
            + добавить должность
          </button>
          <label className="relative ml-4 w-72">
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
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {visible.map((position) => (
              <tr key={position.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{position.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{position.name}</td>
                <td className="px-5 py-4">{position.date}</td>
                <td>
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(position)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(position.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
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
              <h2 className="text-xl font-bold">{editing.id ? "Изменить должность" : "Добавить должность"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">
              Наименование <span className="text-red-500">*</span>
            </label>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mb-4 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]" />
            <div className="mt-6 flex justify-end">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold uppercase text-white hover:brightness-95">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
