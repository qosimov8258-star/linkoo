"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Download, FolderOpen } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const measures = ["Сумма продаж", "Количество заказов", "Количество клиентов", "Средний чек"]
const groupings = ["Модель", "Филиал", "Бренд", "Продукт", "Агент"]
const tableOptimizations = ["Обычная", "Компактная", "С переносом строк"]
const verticalGroupings = ["Без группировки", "По модели", "По филиалу"]
const horizontalGroupings = ["Без группировки", "По месяцам", "По кварталам"]

export function OldReportBuilderView() {
  const router = useRouter()
  const [chosen, setChosen] = useState<string[]>([])
  const [showReport, setShowReport] = useState(false)
  const [saved, setSaved] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [tableOptimization, setTableOptimization] = useState(tableOptimizations[0])
  const [verticalGrouping, setVerticalGrouping] = useState(verticalGroupings[0])
  const [horizontalGrouping, setHorizontalGrouping] = useState(horizontalGroupings[0])
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [quickFilterOpen, setQuickFilterOpen] = useState(false)
  const [quickFilter, setQuickFilter] = useState("")
  const toggle = (item: string) => setChosen((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])
  const selected = chosen.length ? chosen : ["Сумма продаж"]
  const download = () => downloadExcelTable("old-report-builder.xls", [["Модель", ...selected], ["Стандарт", ...selected.map(() => 0)], ["Премиум", ...selected.map(() => 0)]])
  const save = async () => {
    try {
      const config = { chosen, tableOptimization, verticalGrouping, horizontalGrouping }
      const response = await fetch("/api/old-saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Отчёт ${new Date().toLocaleString("ru-RU")}`, config }),
      })
      if (response.ok) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 1800)
      }
    } catch {
      // ignore network failures, no flash on failure
    }
  }
  return <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] text-[#17233b]"><header className="px-9 py-5"><div className="flex items-center gap-3"><FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f71dc]" /><span className="text-3xl text-slate-500">|</span><h1 className="text-2xl font-bold text-slate-600">Конструктор отчетов</h1></div></header><section className="mx-9 rounded-md bg-white shadow-sm"><div className="flex items-center gap-5 border-b px-12 py-4"><span className="font-bold text-[#4f71dc]">01 Авг. 2026 - 31 Авг. 2026</span><label className="mx-auto flex w-96 items-center gap-2 border-b py-1">Модель<select className="ml-auto bg-transparent outline-none"><option>Все модели</option><option>Стандарт</option><option>Премиум</option></select></label></div><div className="flex flex-wrap items-center gap-4 px-10 py-3">
  <div className="relative"><button onClick={() => setColumnsOpen((v) => !v)} className="text-[#4f71dc]">Колонки⌄</button>{columnsOpen && <div className="absolute left-0 top-full z-20 w-56 border border-slate-200 bg-white p-3 shadow-xl">{measures.map((item) => <label key={item} className="mb-2 flex gap-2 text-sm"><input type="checkbox" checked={chosen.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div>}</div>
  <button onClick={download} className="flex items-center gap-2 rounded bg-[#4db6ac] px-5 py-3 font-semibold text-white"><Download />Скачать</button>
  <button onClick={() => void save()} className="flex items-center gap-2 rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white"><Bookmark />{saved ? "Сохранено ✓" : "Сохранить"}</button>
  <button onClick={() => router.push("/analytics/report-list")} className="flex items-center gap-2 rounded bg-[#ff8967] px-5 py-3 font-semibold text-white"><FolderOpen />Отчеты</button>
  <button onClick={() => router.push("/analytics/flexible-dashboard")} className="flex items-center gap-2 rounded bg-[#ff8967] px-5 py-3 font-semibold text-white"><FolderOpen />Виджеты</button>
  <div className="relative ml-auto"><button onClick={() => setOpenDropdown((v) => (v === "table" ? null : "table"))} className="rounded bg-[#4f71dc] px-4 py-3 font-semibold text-white">Оптимизация таблицы: {tableOptimization}⌄</button>{openDropdown === "table" && <div className="absolute right-0 top-full z-20 w-56 border border-slate-200 bg-white py-1 shadow-xl">{tableOptimizations.map((item) => <button key={item} onClick={() => { setTableOptimization(item); setOpenDropdown(null) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div>
  <div className="relative"><button onClick={() => setOpenDropdown((v) => (v === "vertical" ? null : "vertical"))} className="rounded bg-[#4f71dc] px-4 py-3 font-semibold text-white">Вертикальная группировка: {verticalGrouping}⌄</button>{openDropdown === "vertical" && <div className="absolute right-0 top-full z-20 w-56 border border-slate-200 bg-white py-1 shadow-xl">{verticalGroupings.map((item) => <button key={item} onClick={() => { setVerticalGrouping(item); setOpenDropdown(null) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div>
  <div className="relative"><button onClick={() => setOpenDropdown((v) => (v === "horizontal" ? null : "horizontal"))} className="rounded bg-[#4f71dc] px-4 py-3 font-semibold text-white">Горизонтальная группировка: {horizontalGrouping}⌄</button>{openDropdown === "horizontal" && <div className="absolute right-0 top-full z-20 w-56 border border-slate-200 bg-white py-1 shadow-xl">{horizontalGroupings.map((item) => <button key={item} onClick={() => { setHorizontalGrouping(item); setOpenDropdown(null) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div>
  <div className="relative"><button onClick={() => setFiltersOpen((v) => !v)} className="text-[#4f71dc]">Фильтры⌄</button>{filtersOpen && <div className="absolute right-0 top-full z-20 w-64 border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-xl">Фильтры по колонкам появятся здесь после выбора замеров.</div>}</div>
  <div className="relative"><button onClick={() => setQuickFilterOpen((v) => !v)} className="text-[#4f71dc]">Быстрый фильтр⌄</button>{quickFilterOpen && <div className="absolute right-0 top-full z-20 w-64 border border-slate-200 bg-white p-3 shadow-xl"><input autoFocus value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} placeholder="Модель..." className="w-full border-b border-slate-300 py-2 text-sm outline-none" /></div>}</div>
</div></section><section className="mx-9 mt-6 min-h-[340px] bg-white shadow-sm">{!showReport ? <div className="flex min-h-[340px] flex-col items-center justify-center"><img src="/robot-mascot.png" alt="Робот-помощник" className="h-40 w-40 object-contain" /><p className="mt-3 text-slate-400">Выберите замеры и группировки, затем примените изменения</p><div className="mt-6 flex gap-10">{[["Замеры", measures], ["Группировка", groupings]].map(([title, values]) => <div key={String(title)} className="w-56"><p className="mb-3 font-semibold">{title}</p>{(values as string[]).map((item) => <label className="mb-2 flex gap-2" key={item}><input type="checkbox" checked={chosen.includes(item)} onChange={() => toggle(item)} />{item}</label>)}</div>)}</div><button onClick={() => setShowReport(true)} className="mt-6 rounded bg-[#27cd58] px-6 py-3 font-semibold text-white">ПРИМЕНИТЬ ИЗМЕНЕНИЯ</button></div> : <div className="p-8"><table className="w-full border-collapse"><thead><tr className="bg-slate-100"><th className="border p-3 text-left">Модель</th>{selected.map((item) => <th key={item} className="border p-3 text-right">{item}</th>)}</tr></thead><tbody>{["Стандарт", "Премиум", "Эконом"].filter((model) => model.toLowerCase().includes(quickFilter.toLowerCase())).map((model) => <tr key={model}><td className="border p-3">{model}</td>{selected.map((item) => <td key={item} className="border p-3 text-right">{(0).toLocaleString("ru-RU")}</td>)}</tr>)}</tbody></table></div>}</section></main>
}
