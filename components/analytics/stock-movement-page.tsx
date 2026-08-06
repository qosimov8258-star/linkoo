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

const movements: Movement[] = [
  { product: "sndwch", amount: "-22 sht", direction: "out", series: "-", date: "13 июля 2026, 16:17", warehouse: "Andijon skladi", type: "Заказ 1582" },
  { product: "robot moshina", amount: "213 dona", direction: "in", series: "-", date: "10 июля 2026, 09:43", warehouse: "Andijon skladi", type: "Поставка 351" },
  { product: "robot moshina", amount: "1 dona", direction: "in", series: "-", date: "10 июля 2026, 09:43", warehouse: "Andijon skladi", type: "Поставка 351" },
  { product: "sndwch", amount: "-1 sht", direction: "out", series: "-", date: "24 июня 2026, 16:21", warehouse: "05,08,2025(1)", type: "Списание 69" },
  { product: "Arslan 111111", amount: "1 Dona", direction: "in", series: "-", date: "23 июня 2026, 10:00", warehouse: "Andijon skladi", type: "Поставка 349" },
  { product: "sndwch", amount: "1 sht", direction: "in", series: "-", date: "06 июня 2026, 11:20", warehouse: "Andijon skladi", type: "220" },
  { product: "Arslan 111111", amount: "-85 Dona", direction: "out", series: "-", date: "16 мая 2026, 13:36", warehouse: "Andijon skladi", type: "Заказ 1577" },
  { product: "g'ilof", amount: "1 шт", direction: "in", series: "-", date: "14 мая 2026, 13:30", warehouse: "05,08,2025(1)", type: "33" },
  { product: "g'ilof", amount: "-1 шт", direction: "out", series: "-", date: "14 мая 2026, 13:21", warehouse: "05,08,2025(1)", type: "33" },
  { product: "g'ilof", amount: "10 шт", direction: "in", series: "-", date: "14 мая 2026, 13:20", warehouse: "05,08,2025(1)", type: "Поставка 348" },
  { product: "test inventar", amount: "1 dona", direction: "in", series: "-", date: "14 мая 2026, 13:12", warehouse: "toshkent", type: "27" },
  { product: "test inventar", amount: "-1 dona", direction: "out", series: "-", date: "14 мая 2026, 13:09", warehouse: "toshkent", type: "27" },
  { product: "Nataxtari 0.25", amount: "6 Dona", direction: "in", series: "-", date: "09 мая 2026, 09:45", warehouse: "05,08,2025(1)", type: "219" },
  { product: "spark123", amount: "-1 шт", direction: "out", series: "-", date: "08 мая 2026, 16:13", warehouse: "Andijon skladi", type: "Заказ 1572" },
  { product: "Marojna Xaladilnik", amount: "1 Qop", direction: "in", series: "-", date: "02 мая 2026, 10:20", warehouse: "toshkent", type: "32" },
  { product: "Un", amount: "-1 kilogram", direction: "out", series: "-", date: "14 апр. 2026, 18:23", warehouse: "Сырьё Склад", type: "Партия 107" },
]

const receiptRows = [
  ["222", "ЧЛ Ибраева Мадина Амангельдыева", "Возврат", "17 июля 2026", "Andijon skladi"],
  ["221", "ЧЛ Ибраева Мадина Амангельдыева", "Возврат", "17 июля 2026", "Andijon skladi"],
  ["350", "Fardad", "Поставка", "23 июня 2026", "Andijon skladi"],
  ["218", "loe messi", "Возврат", "07 мая 2026", "Andijon skladi"],
  ["344", "Fardad", "Поставка", "14 апр. 2026", "Andijon skladi"],
  ["217", "new klient707", "Возврат", "28 мар. 2026", "toshkent"],
  ["331", "Fardad", "Поставка", "06 мар. 2026", "Andijon skladi"],
  ["216", "marketsavdo1", "Возврат", "04 мар. 2026", "Suhrob sklad"],
]

const transferRows = [
  ["1579", "24 мая 2026", "Andijon skladi", "Заказ", "Ashraf Hakimi", "Не указана", "Не указана"],
  ["1578", "24 мая 2026", "Andijon skladi", "Заказ", "Ashraf Hakimi", "Не указана", "Не указана"],
  ["1559", "23 мар. 2026", "toshkent", "Заказ", "klient 1", "Не указана", "Не указана"],
  ["1548", "07 февр. 2026", "Suhrob sklad", "Заказ", "Asu market", "Не указана", "Не указана"],
  ["56", "07 янв. 2026", "toshkent", "Передача", "Яндекс Лавка", "Admin Ritm", "Не указана"],
  ["55", "30 дек. 2025", "Suhrob sklad", "Передача", "toshkent", "Admin Ritm", "Не указана"],
]

const transferHistoryRows = [
  ["37", "16 авг. 2025", "сырия (000)", "Передача", "Toshkent sut ombori", "Не указана", "Не указана"],
  ["1582", "12 июля 2026", "Andijon skladi", "Заказ", "Doston market", "Admin Ritm", "13 июля 2026"],
  ["1577", "15 мая 2026", "Andijon skladi", "Заказ", "Частное Лицо", "Admin Ritm", "16 мая 2026"],
  ["1575", "08 мая 2026", "Andijon skladi", "Заказ", "klient 1", "Admin Ritm", "09 мая 2026"],
  ["1572", "25 апр. 2026", "Andijon skladi", "Заказ", "55521632", "Admin Ritm", "08 мая 2026"],
  ["1574", "04 мая 2026", "Andijon skladi", "Заказ", "ЧЛ Кылышбай", "Admin Ritm", "05 мая 2026"],
]

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
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</table></body></html>`
    const url = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "dvizhenie-tovarov.xls"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#f2f5f8] pb-10 text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-slate-200 bg-[#f1f4f7] px-9">
        <span className="mr-3 text-3xl text-[#5e6879]">★</span>
        <button className="text-[26px] font-semibold text-[#4f72e5]">Избранные</button>
        <span className="mx-4 h-8 w-px bg-[#5d6572]" />
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
              <button onClick={() => setFilterOpen(false)} className="mt-7 rounded bg-[#626c7e] px-5 py-3 text-white shadow-md">ПРИМЕНИТЬ</button>
            </div>
          )}

          <div className="overflow-x-auto">
            {tab === "movement" ? (
              <table className="w-full min-w-[1200px] border-collapse text-left text-[16px]">
                <thead><tr className="h-16 bg-[#626b7d] text-white">{["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"].map((h) => <th key={h} className="px-10 font-semibold">{h}</th>)}</tr></thead>
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
                <thead><tr className="h-16 bg-[#626b7d] text-white">{normalTable!.headers.map((h) => <th key={h} className="px-9 font-semibold">{h}</th>)}</tr></thead>
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
