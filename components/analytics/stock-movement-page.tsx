"use client"

import { useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

type TabId = "receipt" | "transfer" | "movement" | "receiptHistory" | "transferHistory"

type Movement = {
  product: string
  amount: string
  direction: "in" | "out"
  series: string
  date: string
  warehouse: string
  type: string
}

const tabs: { id: TabId; label: string }[] = [
  { id: "receipt", label: "Приемка" },
  { id: "transfer", label: "Передача" },
  { id: "movement", label: "Движение товаров" },
  { id: "receiptHistory", label: "История Приемки" },
  { id: "transferHistory", label: "История Передачи" },
]

const movements: Movement[] = []

const receiptRows: string[][] = []

const transferRows: string[][] = []

const transferHistoryRows: string[][] = []

const tableConfig: Record<Exclude<TabId, "movement">, { headers: string[]; rows: string[][] }> = {
  receipt: { headers: ["№", "От кого", "Тип", "Дата приемки", "Склад"], rows: receiptRows },
  transfer: { headers: ["№", "Дата запроса", "Склад", "Тип", "Кому", "Передал", "Дата передачи"], rows: transferRows },
  receiptHistory: { headers: ["№ заказа", "От кого", "Тип", "Дата приемки", "Принял", "Склад"], rows: receiptRows.map((r) => [r[0], r[1], r[2], r[3], "Admin Ritm", r[4]]) },
  transferHistory: { headers: ["№", "Дата запроса", "Склад", "Тип", "Кому", "Передал", "Дата передачи"], rows: transferHistoryRows },
}

function includesQuery(values: string[], query: string) {
  return values.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

export function StockMovementPage() {
  const [tab, setTab] = useState<TabId>("movement")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouse, setWarehouse] = useState("")
  const [type, setType] = useState("")

  const filteredMovements = useMemo(
    () => movements.filter((row) => includesQuery(Object.values(row), query) && (!warehouse || row.warehouse === warehouse) && (!type || row.type.startsWith(type))),
    [query, warehouse, type],
  )

  const normalTable = tab === "movement" ? null : tableConfig[tab]
  const filteredNormalRows = normalTable?.rows.filter((row) => includesQuery(row, query)) ?? []

  const downloadExcel = () => {
    const headers = tab === "movement" ? ["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"] : normalTable!.headers
    const rows = tab === "movement"
      ? filteredMovements.map((r) => [r.product, r.amount, r.series, r.date, r.warehouse, r.type])
      : filteredNormalRows
    downloadExcelTable("dvizhenie-tovarov", [headers, ...rows])
  }

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#f2f5f8] pb-10 text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-slate-200 bg-[#f1f4f7] px-9">
        <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
        <span className="mx-4 h-8 w-px bg-[#5d6474]" />
        <h1 className="text-[25px] font-semibold text-[#596273]">План приемок и передач</h1>
      </header>

      <section className="mx-9 mt-0 overflow-visible">
        <nav className="grid h-[66px] grid-cols-5 rounded-sm bg-white shadow-md">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setQuery("") }}
              className={`relative text-[17px] transition-colors hover:bg-slate-50 ${tab === item.id ? "text-black" : "text-black"}`}
            >
              {item.label}
              {tab === item.id && <span className="absolute inset-x-0 bottom-0 h-1 bg-[#5572e8]" />}
            </button>
          ))}
        </nav>

        <div className="relative mt-6 bg-white shadow-md">
          <div className="flex h-[62px] items-center gap-8 px-2">
            <button onClick={() => setFilterOpen((v) => !v)} className="flex items-center gap-2 text-[17px] text-[#526fe4]">
              <Filter className="h-5 w-5" /> Показать фильтр <span className="text-xs">⌄</span>
            </button>
            <label className="ml-[285px] flex w-[370px] items-center border-b border-slate-300 text-slate-400">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="h-11 min-w-0 flex-1 bg-transparent px-1 text-[17px] text-slate-800 outline-none" />
              <Search className="h-6 w-6 text-slate-300" />
            </label>
            <div className="ml-auto flex items-center gap-5 text-[#566070]">
              <span>25⌄</span><span>1 - {Math.min(25, tab === "movement" ? filteredMovements.length : filteredNormalRows.length)} из {tab === "movement" ? filteredMovements.length : filteredNormalRows.length}</span>
              <ChevronLeft className="h-7 w-7 rounded-full border-2 border-slate-300 p-1 text-slate-400" />
              <ChevronRight className="h-7 w-7 rounded-full border-2 border-slate-400 p-1" />
              <button onClick={downloadExcel} aria-label="Скачать Excel" title="Скачать Excel"><Download className="h-7 w-7" /></button>
            </div>
          </div>

          {filterOpen && (
            <div className="absolute left-0 top-0 z-30 w-[390px] bg-white p-6 shadow-2xl">
              <div className="mb-12 flex items-center justify-between text-xl text-[#596273]">
                <span>Фильтр</span><button onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 p-0.5" /></button>
              </div>
              {tab === "movement" && <>
                <Select label="Тип продукта" options={["Все", "Оборудование", "Продукты", "Сырьё"]} />
                <Select label="Тип" value={type} onChange={setType} options={["Все", "Заказ", "Поставка", "Списание", "Партия"]} />
                <Select label="Товар" options={["Все", "sndwch", "robot moshina", "g'ilof", "test inventar"]} />
              </>}
              <Select label="Склад" value={warehouse} onChange={setWarehouse} options={["Все", "Andijon skladi", "05,08,2025(1)", "toshkent", "Сырьё Склад"]} />
              <Select label="Статус" options={["Все", "Активный", "Завершен"]} />
              <label className="mt-7 block border-b border-slate-300 pb-2">
                <span className="mb-2 block text-xs">Период</span>
                <input type="text" defaultValue="01 июля 2026 - 31 июля 2026" className="w-full outline-none" />
              </label>
              <button onClick={() => setFilterOpen(false)} className="mt-7 rounded bg-[#5d6474] px-5 py-3 text-white shadow-md">ПРИМЕНИТЬ</button>
            </div>
          )}

          <div className="overflow-x-auto">
            {tab === "movement" ? (
              <table className="w-full min-w-[1200px] border-collapse text-left text-[16px]">
                <thead><tr className="h-16 bg-[#5d6474] text-white">{["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"].map((h) => <th key={h} className="px-10 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{filteredMovements.map((row, index) => (
                  <tr key={`${row.product}-${index}`} className="h-[63px] border-b border-dashed border-slate-300 odd:bg-white even:bg-[#f1f5f8]">
                    <td className="px-10"><span className={`mr-2 inline-flex ${row.direction === "in" ? "text-[#65c87a]" : "text-[#ff6b72]"}`}>{row.direction === "in" ? <ArrowDown className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}</span>{row.product}</td>
                    <td className="px-10">{row.amount}</td><td className="px-10">{row.series}</td><td className="px-10">{row.date}</td><td className="px-10">{row.warehouse}</td>
                    <td className="px-10">{row.type.split(" ").map((part, i) => /\d/.test(part) ? <span key={i} className="text-[#0099ed]"> {part}</span> : <span key={i}>{part} </span>)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : (
              <table className="w-full min-w-[1100px] border-collapse text-left text-[16px]">
                <thead><tr className="h-16 bg-[#5d6474] text-white">{normalTable!.headers.map((h) => <th key={h} className="px-9 font-semibold">{h}</th>)}</tr></thead>
                <tbody>{filteredNormalRows.map((row, index) => <tr key={index} className="h-[63px] border-b border-dashed border-slate-300 odd:bg-white even:bg-[#f1f5f8]">{row.map((cell, i) => <td key={i} className="px-9">{cell}</td>)}</tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function Select({ label, options, value, onChange }: { label: string; options: string[]; value?: string; onChange?: (value: string) => void }) {
  return <label className="mb-6 block"><span className="mb-2 block font-semibold">{label}</span><select value={value} onChange={(e) => onChange?.(e.target.value === "Все" ? "" : e.target.value)} className="h-11 w-full border-b-2 border-slate-400 bg-white outline-none"><option value="">Все</option>{options.filter((o) => o !== "Все").map((o) => <option key={o}>{o}</option>)}</select></label>
}
