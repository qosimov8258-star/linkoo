"use client"

import { ChevronLeft, ChevronRight, Filter, Search } from "lucide-react"
import { useMemo, useState } from "react"

type Refusal = { id: number; date: string; agent: string; client: string; reason: string }

const seed: Refusal[] = [
  { id: 142, date: "10 мар. 2026", agent: "Admin Ritm", client: "Тестовый", reason: "Нет денег" },
  { id: 141, date: "10 мар. 2026", agent: "Admin Ritm", client: "Huvaydo market", reason: "Нет денег" },
  { id: 140, date: "10 мар. 2026", agent: "Admin Ritm", client: "Huvaydo market", reason: "Товары есть в наличии" },
  { id: 139, date: "10 мар. 2026", agent: "Admin Ritm", client: "Huvaydo market", reason: "Товары есть в наличии" },
  { id: 138, date: "03 февр. 2026", agent: "Temur Raupov", client: "Klient_Karim112", reason: "У клиента нету денег" },
  { id: 137, date: "26 янв. 2026", agent: "Fozil Agent", client: "test1", reason: "У клиента нету денег" },
  { id: 136, date: "24 янв. 2026", agent: "Admin Ritm", client: "new mera", reason: "sababsiz javob" },
  { id: 135, date: "24 янв. 2026", agent: "Ares are", client: "Маркет Савдо 114", reason: "Точка закрыт" },
  { id: 134, date: "25 дек. 2025", agent: "AboMuslim Raximov", client: "Anor Market", reason: "У клиента нету денег" },
  { id: 133, date: "24 дек. 2025", agent: "Fozil Agent", client: "Tinchlik market", reason: "Точка закрыт" },
  { id: 132, date: "23 дек. 2025", agent: "Ares are", client: "Tinchlik market", reason: "Точка закрыт" },
  { id: 131, date: "13 дек. 2025", agent: "Admin Ritm", client: "MTRK", reason: "Продукт не интересен" },
]

const rows = [...seed, ...Array.from({ length: 28 }, (_, i) => ({
  id: 130 - i,
  date: i < 5 ? "04 дек. 2025" : "07 нояб. 2025",
  agent: i % 3 === 0 ? "Temur Raupov" : i % 2 ? "Admin Ritm" : "Fozil Agent",
  client: i % 2 ? "Самсунг" : "client shablon 2",
  reason: i % 4 === 0 ? "Товары есть в наличии" : "У клиента нету денег",
}))]

export function RefusalsView() {
  const [query, setQuery] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const visible = useMemo(() => rows.filter((row) => `${row.id} ${row.client} ${row.agent} ${row.reason}`.toLowerCase().includes(query.toLowerCase())), [query])

  return <main className="min-h-screen bg-slate-100 pb-8 text-slate-800">
    <header className="flex items-center bg-slate-50 px-10 py-4">
      <h1 className="text-[27px] font-bold text-slate-600"><span className="text-[#5271df]">★ Избранные</span> <span className="font-normal">|</span> Отказы</h1>
    </header>
    <section className="mx-9 mt-1 bg-white shadow">
      <div className="flex min-h-16 items-center gap-5 px-2">
        <button onClick={() => setShowFilter(!showFilter)} className="text-[17px] text-[#5271df]">Показать фильтр⌄</button>
        <div className="relative ml-48 w-[380px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full border-b border-slate-300 px-2 py-2 pr-9 outline-none" placeholder="Поиск"/><Search className="absolute right-1 top-2 text-slate-300"/></div>
        <div className="ml-auto flex items-center gap-5 text-slate-600"><span>25⌄</span><span>1 - {Math.min(25, visible.length)} из 141</span><ChevronLeft className="rounded-full border"/><ChevronRight className="rounded-full border"/></div>
      </div>
      {showFilter && <div className="grid grid-cols-4 gap-5 border-t bg-slate-50 px-6 py-4 text-sm"><label>Агент<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder="Все агенты"/></label><label>Клиент<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder="Все клиенты"/></label><label>Причина<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder="Все причины"/></label><button onClick={() => setQuery("")} className="mt-5 h-10 rounded bg-[#5271df] px-5 font-semibold text-white"><Filter className="mr-2 inline h-4"/>Сбросить</button></div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left"><thead className="bg-[#626b7e] text-white"><tr>{["№", "Дата создания", "Агент", "Клиент", "Причина"].map((title) => <th key={title} className="px-9 py-4 text-[17px]">{title}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-b-2 border-dotted border-slate-200 hover:bg-blue-50"><td className="px-9 py-4">{row.id}</td><td className="px-9">{row.date}</td><td className="px-9">{row.agent}</td><td className="px-9">{row.client}</td><td className="px-9">{row.reason}</td></tr>)}</tbody></table></div>
    </section>
  </main>
}
