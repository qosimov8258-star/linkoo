"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Download, FolderOpen } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

const tableOptimizations = ["Обычная", "Компактная", "С переносом строк"]
const verticalGroupings = ["Без группировки", "По неделям", "По месяцам"]

export function TrendBuilderView() {
  const router = useRouter()
  const [columns, setColumns] = useState<string[]>([])
  const [generated, setGenerated] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [from, setFrom] = useState("2026-08-01")
  const [to, setTo] = useState("2026-08-15")
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [tableOptimization, setTableOptimization] = useState(tableOptimizations[0])
  const [verticalGrouping, setVerticalGrouping] = useState(verticalGroupings[0])
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const measures = ["Сумма заказов", "Количество заказов", "Количество клиентов", "Средний чек"]
  const toggle = (item: string) => setColumns((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])
  const selected = columns.length ? columns : ["Сумма заказов"]
  const exportExcel = () => downloadExcelTable("trend-report.xls", [["Период", ...selected], ["01.08.2026", ...selected.map((_, index) => 1200000 + index * 180000)], ["08.08.2026", ...selected.map((_, index) => 1490000 + index * 180000)], ["15.08.2026", ...selected.map((_, index) => 1750000 + index * 180000)]])
  const addToReports = async () => {
    try {
      const response = await fetch("/api/trend-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Тренд ${from} - ${to}`,
          config: { columns: selected, from, to, tableOptimization, verticalGrouping },
        }),
      })
      if (response.ok) setSaved(true)
    } catch {
      // network error - keep the button in its non-saved state
    }
  }
  return <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] text-[#17233b]"><header className="px-9 py-5"><div className="flex items-center gap-3"><FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f71dc]" /><span className="text-3xl text-slate-500">|</span><h1 className="text-2xl font-bold text-slate-600">Тенденция</h1></div></header><section className="mx-9 rounded-md bg-white shadow-sm"><div className="flex items-center border-b px-6 py-3"><div className="relative"><button onClick={() => setDateOpen((v) => !v)} className="rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white">⌄ Сверка даты</button>{dateOpen && <div className="absolute left-0 top-full z-20 flex gap-4 border border-slate-200 bg-white p-4 shadow-xl"><label className="text-xs">От<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block border-b py-1" /></label><label className="text-xs">До<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block border-b py-1" /></label></div>}</div><label className="mx-auto w-96 border-b"><strong className="block">Модель</strong><select className="w-full bg-transparent py-1 outline-none"><option>Продукты заказов по дате создания</option><option>Заказы и возвраты</option></select></label></div><div className="flex flex-wrap items-center gap-5 px-9 py-3"><div className="relative"><button onClick={() => setColumnsOpen((v) => !v)} className="rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white">⌄ Колонки</button>{columnsOpen && <div className="absolute left-0 top-full z-20 w-56 border border-slate-200 bg-white p-3 shadow-xl">{measures.map((item) => <label key={item} className="mb-2 flex gap-2 text-sm"><input type="checkbox" checked={columns.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div>}</div><button onClick={exportExcel} className="flex items-center gap-2 rounded bg-[#71ce87] px-5 py-3 font-semibold text-white"><Download />Сформировать Excel</button><button onClick={addToReports} className="rounded bg-[#ff8967] px-5 py-3 font-semibold text-white">★ {saved ? "Добавлено" : "Добавить в отчеты"}</button><button onClick={() => router.push("/analytics/report-list")} className="flex items-center gap-2 rounded bg-[#ff8967] px-5 py-3 font-semibold text-white"><FolderOpen />Отчеты (1)</button><div className="relative ml-auto"><button onClick={() => setOpenDropdown((v) => (v === "table" ? null : "table"))} className="rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white">Оптимизация таблицы: {tableOptimization}⌄</button>{openDropdown === "table" && <div className="absolute right-0 top-full z-20 w-56 border border-slate-200 bg-white py-1 shadow-xl">{tableOptimizations.map((item) => <button key={item} onClick={() => { setTableOptimization(item); setOpenDropdown(null) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div><div className="relative"><button onClick={() => setOpenDropdown((v) => (v === "vertical" ? null : "vertical"))} className="rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white">Вертикальная группировка: {verticalGrouping}⌄</button>{openDropdown === "vertical" && <div className="absolute right-0 top-full z-20 w-56 border border-slate-200 bg-white py-1 shadow-xl">{verticalGroupings.map((item) => <button key={item} onClick={() => { setVerticalGrouping(item); setOpenDropdown(null) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div><div className="relative"><button onClick={() => setFiltersOpen((v) => !v)} className="rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white">⌄ Фильтры</button>{filtersOpen && <div className="absolute right-0 top-full z-20 w-64 border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-xl">Фильтры по колонкам появятся здесь после выбора замеров.</div>}</div></div></section><section className="mx-9 mt-6 min-h-[340px] bg-white shadow-sm">{!generated ? <div className="flex min-h-[340px] flex-col items-center justify-center"><img src="/robot-mascot.png" alt="Робот-помощник" className="h-40 w-40 object-contain" /><p className="mt-3 text-slate-400">Выберите замеры и группировки, затем примените изменения</p><div className="mt-5 flex gap-5">{measures.map((item) => <label key={item} className="flex gap-2"><input type="checkbox" checked={columns.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div><button onClick={() => setGenerated(true)} className="mt-6 rounded bg-[#27cd58] px-6 py-3 font-semibold text-white">ПРИМЕНИТЬ ИЗМЕНЕНИЯ</button></div> : <div className="p-8"><table className="w-full border-collapse"><thead><tr className="bg-slate-100"><th className="border p-3 text-left">Период</th>{selected.map((item) => <th key={item} className="border p-3 text-right">{item}</th>)}</tr></thead><tbody>{["01.08.2026", "08.08.2026", "15.08.2026"].map((day, row) => <tr key={day}><td className="border p-3">{day}</td>{selected.map((item, col) => <td key={item} className="border p-3 text-right">{(1200000 + row * 290000 + col * 180000).toLocaleString("ru-RU")}</td>)}</tr>)}</tbody></table></div>}</section></main>
}
