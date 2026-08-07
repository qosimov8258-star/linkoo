"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Filter, Search, X } from "lucide-react"

import { MaterialReportView } from "@/components/analytics/material-report-view"

type Tab = "receipt" | "transfer" | "movement" | "receiptHistory" | "transferHistory"
type Row = Record<string, string | number>

const tabs: { id: Tab; label: string }[] = [
  { id: "receipt", label: "Приемка" },
  { id: "transfer", label: "Передача" },
  { id: "movement", label: "Движение товаров" },
  { id: "receiptHistory", label: "История Приемки" },
  { id: "transferHistory", label: "История Передачи" },
]

const movementRows: Row[] = [
  { dir: "up", product: "sndwch", quantity: "-22 sht", series: "-", date: "13 июля 2026, 16:17", warehouse: "Andijon skladi", type: "Заказ 1582" },
  { dir: "down", product: "robot moshina", quantity: "213 dona", series: "-", date: "10 июля 2026, 09:43", warehouse: "Andijon skladi", type: "Поставка 351" },
  { dir: "down", product: "robot moshina", quantity: "1 dona", series: "-", date: "10 июля 2026, 09:43", warehouse: "Andijon skladi", type: "Поставка 351" },
  { dir: "up", product: "sndwch", quantity: "-1 sht", series: "-", date: "24 июня 2026, 16:21", warehouse: "05,08,2025(1)", type: "Списание 69" },
  { dir: "down", product: "Arslan 111111", quantity: "1 Dona", series: "-", date: "23 июня 2026, 10:00", warehouse: "Andijon skladi", type: "Поставка 349" },
  { dir: "down", product: "sndwch", quantity: "1 sht", series: "-", date: "06 июня 2026, 11:20", warehouse: "Andijon skladi", type: "220" },
  { dir: "up", product: "Arslan 111111", quantity: "-85 Dona", series: "-", date: "16 мая 2026, 13:36", warehouse: "Andijon skladi", type: "Заказ 1577" },
  { dir: "down", product: "g'ilof", quantity: "1 шт", series: "-", date: "14 мая 2026, 13:30", warehouse: "05,08,2025(1)", type: "33" },
  { dir: "up", product: "g'ilof", quantity: "-1 шт", series: "-", date: "14 мая 2026, 13:21", warehouse: "05,08,2025(1)", type: "33" },
  { dir: "down", product: "g'ilof", quantity: "10 шт", series: "-", date: "14 мая 2026, 13:20", warehouse: "05,08,2025(1)", type: "Поставка 348" },
  { dir: "down", product: "test inventar", quantity: "1 dona", series: "-", date: "14 мая 2026, 13:12", warehouse: "toshkent", type: "27" },
  { dir: "up", product: "test inventar", quantity: "-1 dona", series: "-", date: "14 мая 2026, 13:09", warehouse: "toshkent", type: "27" },
  { dir: "down", product: "Nataxtari 0.25", quantity: "6 Dona", series: "-", date: "09 мая 2026, 09:45", warehouse: "05,08,2025(1)", type: "219" },
  { dir: "up", product: "spark123", quantity: "-1 шт", series: "-", date: "08 мая 2026, 16:13", warehouse: "Andijon skladi", type: "Заказ 1572" },
]

const receiptRows: Row[] = [
  { no: 222, person: "ЧЛ Ибраева Мадина Амангельдыева", type: "Возврат", date: "17 июля 2026", warehouse: "Andijon skladi" },
  { no: 221, person: "ЧЛ Ибраева Мадина Амангельдыева", type: "Возврат", date: "17 июля 2026", warehouse: "Andijon skladi" },
  { no: 350, person: "Fardad", type: "Поставка", date: "23 июня 2026", warehouse: "Andijon skladi" },
  { no: 218, person: "loe messi", type: "Возврат", date: "07 мая 2026", warehouse: "Andijon skladi" },
  { no: 344, person: "Fardad", type: "Поставка", date: "14 апр. 2026", warehouse: "Andijon skladi" },
  { no: 217, person: "new klient707", type: "Возврат", date: "28 мар. 2026", warehouse: "toshkent" },
  { no: 331, person: "Fardad", type: "Поставка", date: "06 мар. 2026", warehouse: "Andijon skladi" },
  { no: 216, person: "marketsavdo1", type: "Возврат", date: "04 мар. 2026", warehouse: "Suhrob sklad" },
  { no: 213, person: "Arslan", type: "Возврат", date: "03 февр. 2026", warehouse: "ПРОФРЕШ" },
]

const transferRows: Row[] = [
  { no: 1579, requestDate: "24 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Ashraf Hakimi", sender: "Не указана", transferDate: "Не указана" },
  { no: 1578, requestDate: "24 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Ashraf Hakimi", sender: "Не указана", transferDate: "Не указана" },
  { no: 1559, requestDate: "23 мар. 2026", warehouse: "toshkent", type: "Заказ", to: "klient 1", sender: "Не указана", transferDate: "Не указана" },
  { no: 1548, requestDate: "07 февр. 2026", warehouse: "Suhrob sklad", type: "Заказ", to: "Asu market", sender: "Не указана", transferDate: "Не указана" },
  { no: 1541, requestDate: "03 февр. 2026", warehouse: "toshkent", type: "Заказ", to: "Klient_Karim139", sender: "Не указана", transferDate: "Не указана" },
  { no: 56, requestDate: "07 янв. 2026", warehouse: "toshkent", type: "Передача", to: "Яндекс Лавка", sender: "Admin Ritm", transferDate: "Не указана" },
]

const receiptHistoryRows: Row[] = [
  { no: 351, person: "Fardad", type: "Поставка", date: "10 июля 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 349, person: "Fardad", type: "Поставка", date: "23 июня 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 220, person: "klient 1", type: "Возврат", date: "06 июня 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 348, person: "Инвентаризация", type: "Поставка", date: "14 мая 2026", accepted: "Admin Ritm", warehouse: "05,08,2025(1)" },
  { no: 219, person: "Бахт маркет", type: "Возврат", date: "09 мая 2026", accepted: "Admin Ritm", warehouse: "05,08,2025(1)" },
  { no: 346, person: "Инвентаризация", type: "Поставка", date: "22 апр. 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
]

const transferHistoryRows: Row[] = [
  { no: 37, requestDate: "16 авг. 2025", warehouse: "сырия (000)", type: "Передача", to: "Toshkent sut ombori", sender: "Не указана", transferDate: "Не указана" },
  { no: 1582, requestDate: "12 июля 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Doston market", sender: "Admin Ritm", transferDate: "13 июля 2026" },
  { no: 1577, requestDate: "15 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Частное Лицо", sender: "Admin Ritm", transferDate: "16 мая 2026" },
  { no: 1575, requestDate: "08 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "klient 1", sender: "Admin Ritm", transferDate: "09 мая 2026" },
  { no: 1572, requestDate: "25 апр. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "55521632", sender: "Admin Ritm", transferDate: "08 мая 2026" },
  { no: 1574, requestDate: "04 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "ЧЛ Кылышбай", sender: "Admin Ritm", transferDate: "05 мая 2026" },
]

const configs: Record<Tab, { headers: [string, string][]; rows: Row[] }> = {
  movement: { headers: [["product", "Товар"], ["quantity", "Кол-во"], ["series", "Серия"], ["date", "Дата"], ["warehouse", "Склад"], ["type", "Тип"]], rows: movementRows },
  receipt: { headers: [["no", "№"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["warehouse", "Склад"]], rows: receiptRows },
  transfer: { headers: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]], rows: transferRows },
  receiptHistory: { headers: [["no", "№ заказа"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["accepted", "Принял"], ["warehouse", "Склад"]], rows: receiptHistoryRows },
  transferHistory: { headers: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]], rows: transferHistoryRows },
}

export function GoodsMovementView() {
  const [tab, setTab] = useState<Tab>("movement")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 25
  const config = configs[tab]
  const rows = useMemo(() => config.rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase())), [config, query])
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const shown = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (tab === "movement") {
    return <MaterialReportView />
  }

  function downloadExcel() {
    const head = config.headers.map(([, title]) => `<th>${title}</th>`).join("")
    const body = rows.map((row) => `<tr>${config.headers.map(([key]) => `<td>${String(row[key] ?? "")}</td>`).join("")}</tr>`).join("")
    const html = `\ufeff<html><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `goods-movement-${tab}.xls`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <div className="relative space-y-6 pb-8">
    <div className="grid grid-cols-5 overflow-hidden rounded-sm bg-white shadow">
      {tabs.map((item) => <button key={item.id} onClick={() => { setTab(item.id); setQuery(""); setPage(1) }} className={`h-16 border-b-4 text-[17px] transition ${tab === item.id ? "border-[#526fe4] text-[#526fe4]" : "border-transparent text-slate-900 hover:bg-slate-50"}`}>{item.label}</button>)}
    </div>

    <section className="overflow-hidden rounded-sm bg-white shadow">
      <div className="flex h-16 items-center gap-8 px-2">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 text-[#526fe4]"><Filter className="h-4 w-4" />Показать фильтр⌄</button>
        <label className="relative ml-72 w-96 max-w-[30vw]"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 px-1 py-2 outline-none focus:border-[#526fe4]"/><Search className="absolute right-1 top-2 h-6 w-6 text-slate-300" /></label>
        <div className="ml-auto flex items-center gap-5 text-slate-500"><span>25⌄</span><span>{rows.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, rows.length)} из {rows.length}</span><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30"><ChevronLeft /></button><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30"><ChevronRight /></button><button onClick={downloadExcel} title="Скачать Excel"><Download className="h-6 w-6 text-slate-600" /></button></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-left text-[16px]">
          <thead className="bg-[#626b7e] text-white"><tr>{config.headers.map(([key, title]) => <th key={key} className="h-16 px-9 font-semibold">{title}</th>)}</tr></thead>
          <tbody>{shown.map((row, index) => <tr key={`${tab}-${index}`} className="h-[62px] border-b border-dashed border-slate-200 even:bg-[#f2f6f9]">{config.headers.map(([key]) => <td key={key} className="px-9">{key === "product" ? <span className="flex items-center gap-2">{row.dir === "up" ? <ArrowUp className="h-4 w-4 text-red-400" /> : <ArrowDown className="h-4 w-4 text-green-500" />}{String(row[key])}</span> : key === "type" && /\d/.test(String(row[key])) ? <span>{String(row[key]).replace(/(\d+)/, "")} <b className="font-normal text-sky-500">{String(row[key]).match(/\d+/)?.[0]}</b></span> : String(row[key] ?? "")}</td>)}</tr>)}</tbody>
        </table>
        {!rows.length && <div className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</div>}
      </div>
    </section>

    {filterOpen && <div className="absolute left-0 top-20 z-30 w-[390px] rounded-sm bg-white p-6 shadow-2xl">
      <div className="mb-12 flex items-center justify-between text-xl text-slate-500"><span>Фильтр</span><button onClick={() => setFilterOpen(false)}><X /></button></div>
      <div className="space-y-8">{(tab === "receiptHistory" ? ["Склад", "Тип", "Принял"] : tab === "transferHistory" ? ["Склад", "Тип", "Передал"] : ["Склад", "Тип"]).map((label) => <label key={label} className="block border-b border-slate-300 pb-2 font-medium">{label}<span className="float-right text-slate-400">⌄</span></label>)}<label className="block border-b border-slate-300 pb-2"><small className="block">{tab.includes("transfer") || tab === "transferHistory" ? "Дата передачи" : "Дата приемки"}</small>01 июля 2026 - 31 июля 2026</label><button onClick={() => setFilterOpen(false)} className="rounded bg-[#626b7e] px-5 py-3 text-white shadow">ПРИМЕНИТЬ</button></div>
    </div>}
  </div>
}
