"use client"

import { Pencil, Plus, Trash2, X } from "lucide-react"
import { FormEvent, useState } from "react"

type ClientType = { id: number; name: string; supplier: string; date: string }

const initialTypes: ClientType[] = [
  { id: 1, name: "chakana savdo", supplier: "javohir Sobirov", date: "28 дек. 2024" },
  { id: 2, name: "Herat Market", supplier: "Quvonchbek Admin", date: "21 янв. 2026" },
  { id: 3, name: "horeca", supplier: "Admin Ritm", date: "08 июня 2026" },
  { id: 4, name: "market", supplier: "Не указано", date: "15 мая 2025" },
  ...Array.from({ length: 36 }, (_, index) => ({ id: index + 5, name: `market${index + 100}`, supplier: "Не указано", date: "07 янв. 2026" })),
]

const menu = [
  ["Персонал", "Подписки", "Сотрудники", "Смены", "Должности", "Права доступа", "Транспорт", "Сессия"],
  ["Финансы", "Валюты", "Кассы", "Категории приходов", "Категории расходов"],
  ["Продукты", "Типы продуктов", "Измерения", "Бренд", "Атрибуты", "Значение атрибута", "Продукты конкурентов"],
]

export function ClientTypesView() {
  const [items, setItems] = useState(initialTypes)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<ClientType | null>(null)
  const [draft, setDraft] = useState({ name: "", supplier: "" })

  const visible = items.filter((item) => `${item.name} ${item.supplier}`.toLowerCase().includes(query.toLowerCase()))
  function openAdd() { setEditing({ id: 0, name: "", supplier: "", date: "" }); setDraft({ name: "", supplier: "" }) }
  function openEdit(item: ClientType) { setEditing(item); setDraft({ name: item.name, supplier: item.supplier }) }
  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editing?.id) setItems((current) => current.map((item) => item.id === editing.id ? { ...item, ...draft } : item))
    else setItems((current) => [{ id: Date.now(), name: draft.name.trim(), supplier: draft.supplier.trim() || "Не указано", date: "05 авг. 2026" }, ...current])
    setEditing(null)
  }

  return <main className="min-h-screen bg-white text-slate-800">
    <div className="flex min-h-screen">
      <aside className="hidden w-[245px] shrink-0 bg-slate-100 px-9 pt-9 lg:block">
        {menu.map(([title, ...children]) => <section key={title} className="mb-9"><h2 className="mb-3 font-bold">{title}</h2><div className="space-y-3 pl-8 text-[16px] text-slate-700">{children.map((child) => <div key={child}>{child}</div>)}</div></section>)}
      </aside>
      <section className="min-w-0 flex-1">
        <div className="px-7 py-5"><div className="flex items-center justify-between"><button onClick={openAdd} className="text-[17px] text-[#5474e6] hover:underline">+ добавить тип клиента</button><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-56 border-b border-slate-300 px-2 py-2 outline-none focus:border-[#5474e6]" /></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[800px] border-collapse text-[16px]"><thead className="bg-[#626b7e] text-left text-white"><tr><th className="px-9 py-5">Наименование</th><th className="px-8 py-5">Доставщик</th><th className="px-8 py-5">Дата создания</th><th className="w-28 px-5 py-5" /></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50"><td className="px-9 py-[18px] font-medium">{item.name}</td><td className="px-8 py-[18px]">{item.supplier}</td><td className="px-8 py-[18px]">{item.date}</td><td className="px-4 py-[18px]"><div className="hidden justify-end gap-3 text-slate-500 group-hover:flex"><button onClick={() => openEdit(item)} aria-label="Изменить"><Pencil className="h-5 w-5" /></button><button onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} aria-label="Удалить"><Trash2 className="h-5 w-5" /></button></div></td></tr>)}</tbody></table></div>
      </section>
    </div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold">{editing.id ? "Изменить тип клиента" : "Добавить тип клиента"}</h2><button type="button" onClick={() => setEditing(null)}><X /></button></div><label className="mb-2 block font-medium">Наименование</label><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" /><label className="mb-2 block font-medium">Доставщик</label><input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5" /><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">Отмена</button><button className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white"><Plus className="h-4 w-4" />Сохранить</button></div></form></div>}
  </main>
}
