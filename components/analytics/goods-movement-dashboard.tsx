"use client"

import { Fragment, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Download, Filter, ListChecks, MoreVertical, Printer, Search, Star, X } from "lucide-react"

type Tab = "receipt" | "transfer" | "movement" | "receiptHistory" | "transferHistory"

type ReceiptItem = { product: string; type: string; qty: string }
type ReceiptRow = { no: number; person: string; type: string; date: string; warehouse: string; items: ReceiptItem[]; creator: string; comment: string }
type ReceiptHistoryRow = { no: number; person: string; type: string; date: string; accepted: string; warehouse: string }
type TransferRow = { no: number; requestDate: string; warehouse: string; type: string; to: string; sender: string; transferDate: string }
type MovementRow = { dir: "up" | "down"; product: string; quantity: string; series: string; date: string; warehouse: string; type: string }

const tabs: { id: Tab; label: string }[] = [
  { id: "receipt", label: "Приемка" },
  { id: "transfer", label: "Передача" },
  { id: "movement", label: "Движение товаров" },
  { id: "receiptHistory", label: "История Приемки" },
  { id: "transferHistory", label: "История Передачи" },
]

const suppliers = ["Fardad", "Инвентаризация", "карим", "tillochi", "ЧЛ Ибраева Мадина Амангельдыева", "loe messi", "new klient707", "marketsavdo1", "Arslan", "Бахт маркет", "klient 1", "PAM"]
const warehouses = ["Andijon skladi", "toshkent", "Suhrob sklad", "ПРОФРЕШ", "05,08,2025(1)", "основной", "ANGOR"]
const receiptTypes = ["Поставка", "Возврат"]
const itemProducts: ReceiptItem[] = [
  { product: "sndwch", type: "oziq ovqat", qty: "1 sht" },
  { product: "g'ilof", type: "idish", qty: "1 шт" },
  { product: "robot moshina", type: "Texnika", qty: "1 dona" },
  { product: "Arslan 111111", type: "напитки", qty: "1 Dona" },
  { product: "energetik 1 l", type: "напитки", qty: "1 sht" },
]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownReceipts: Omit<ReceiptRow, "items" | "creator" | "comment">[] = [
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

function buildReceipts(): ReceiptRow[] {
  const baseline = new Date(2026, 1, 3)
  const rows: ReceiptRow[] = knownReceipts.map((row, index) => ({
    ...row,
    items: [itemProducts[index % itemProducts.length]],
    creator: "Admin Ritm",
    comment: "Комментарий отсутствует",
  }))
  const extraIds = [210, 205, 198, 190, 180, 170, 160]
  extraIds.forEach((id, index) => {
    const date = new Date(baseline)
    date.setDate(date.getDate() - (index + 1) * 9)
    rows.push({
      no: id,
      person: suppliers[id % suppliers.length],
      type: receiptTypes[id % receiptTypes.length],
      date: fmt(date),
      warehouse: warehouses[id % warehouses.length],
      items: [itemProducts[id % itemProducts.length]],
      creator: "Admin Ritm",
      comment: "Комментарий отсутствует",
    })
  })
  return rows
}

const knownReceiptHistory: ReceiptHistoryRow[] = [
  { no: 351, person: "Fardad", type: "Поставка", date: "10 июля 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 349, person: "Fardad", type: "Поставка", date: "23 июня 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 220, person: "klient 1", type: "Возврат", date: "06 июня 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 348, person: "Инвентаризация", type: "Поставка", date: "14 мая 2026", accepted: "Admin Ritm", warehouse: "05,08,2025(1)" },
  { no: 219, person: "Бахт маркет", type: "Возврат", date: "09 мая 2026", accepted: "Admin Ritm", warehouse: "05,08,2025(1)" },
  { no: 346, person: "Инвентаризация", type: "Поставка", date: "22 апр. 2026", accepted: "Admin Ritm", warehouse: "Andijon skladi" },
  { no: 345, person: "Fardad", type: "Поставка", date: "20 апр. 2026", accepted: "Admin Ritm", warehouse: "основной" },
  { no: 343, person: "карим", type: "Поставка", date: "11 апр. 2026", accepted: "Admin Ritm", warehouse: "ANGOR" },
  { no: 342, person: "Fardad", type: "Поставка", date: "10 апр. 2026", accepted: "Admin Ritm", warehouse: "основной" },
]

function buildReceiptHistory(): ReceiptHistoryRow[] {
  const rows = [...knownReceiptHistory]
  const baseline = new Date(2026, 3, 10)
  const target = 512
  let id = 340
  let step = 0
  while (rows.length < target) {
    const date = new Date(baseline)
    date.setDate(date.getDate() - step * 4)
    rows.push({
      no: id,
      person: suppliers[id % suppliers.length],
      type: receiptTypes[id % receiptTypes.length],
      date: fmt(date),
      accepted: "Admin Ritm",
      warehouse: warehouses[id % warehouses.length],
    })
    id -= 1
    step += 1
  }
  return rows
}

const knownTransfers: TransferRow[] = [
  { no: 1579, requestDate: "24 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Ashraf Hakimi", sender: "Не указана", transferDate: "Не указана" },
  { no: 1578, requestDate: "24 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Ashraf Hakimi", sender: "Не указана", transferDate: "Не указана" },
  { no: 1559, requestDate: "23 мар. 2026", warehouse: "toshkent", type: "Заказ", to: "klient 1", sender: "Не указана", transferDate: "Не указана" },
  { no: 1548, requestDate: "07 февр. 2026", warehouse: "Suhrob sklad", type: "Заказ", to: "Asu market", sender: "Не указана", transferDate: "Не указана" },
  { no: 1541, requestDate: "03 февр. 2026", warehouse: "toshkent", type: "Заказ", to: "Klient_Karim139", sender: "Не указана", transferDate: "Не указана" },
  { no: 1540, requestDate: "03 февр. 2026", warehouse: "toshkent", type: "Заказ", to: "Klient_Karim110", sender: "Не указана", transferDate: "Не указана" },
  { no: 1539, requestDate: "02 февр. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "145 Rasta", sender: "Не указана", transferDate: "Не указана" },
  { no: 1538, requestDate: "02 февр. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Pepsi Market", sender: "Не указана", transferDate: "Не указана" },
  { no: 56, requestDate: "07 янв. 2026", warehouse: "toshkent", type: "Передача", to: "Яндекс Лавка", sender: "Admin Ritm", transferDate: "Не указана" },
]

const transferToPool = ["145 Rasta", "Pepsi Market", "Asu market", "klient 1", "Doston market", "Частное Лицо", "55521632", "ЧЛ Кылышбай"]

function buildTransfers(): TransferRow[] {
  const rows = [...knownTransfers]
  const baseline = new Date(2026, 0, 7)
  let id = 1535
  let step = 0
  while (rows.length < 19) {
    const date = new Date(baseline)
    date.setDate(date.getDate() - step * 6)
    rows.push({
      no: id,
      requestDate: fmt(date),
      warehouse: warehouses[id % warehouses.length],
      type: id % 6 === 0 ? "Передача" : "Заказ",
      to: transferToPool[id % transferToPool.length],
      sender: "Не указана",
      transferDate: "Не указана",
    })
    id -= 3
    step += 1
  }
  return rows
}

const knownTransferHistory: TransferRow[] = [
  { no: 37, requestDate: "16 авг. 2025", warehouse: "сырия (000)", type: "Передача", to: "Toshkent sut ombori", sender: "Не указана", transferDate: "Не указана" },
  { no: 1582, requestDate: "12 июля 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Doston market", sender: "Admin Ritm", transferDate: "13 июля 2026" },
  { no: 1577, requestDate: "15 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Частное Лицо", sender: "Admin Ritm", transferDate: "16 мая 2026" },
  { no: 1575, requestDate: "08 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "klient 1", sender: "Admin Ritm", transferDate: "09 мая 2026" },
  { no: 1572, requestDate: "25 апр. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "55521632", sender: "Admin Ritm", transferDate: "08 мая 2026" },
  { no: 1574, requestDate: "04 мая 2026", warehouse: "Andijon skladi", type: "Заказ", to: "ЧЛ Кылышбай", sender: "Admin Ritm", transferDate: "05 мая 2026" },
  { no: 1568, requestDate: "22 апр. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Частное Лицо", sender: "Admin Ritm", transferDate: "23 апр. 2026" },
  { no: 1562, requestDate: "29 мар. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "Частное Лицо", sender: "Admin Ritm", transferDate: "30 мар. 2026" },
  { no: 1561, requestDate: "23 мар. 2026", warehouse: "Andijon skladi", type: "Заказ", to: "ЧЛ Ибраева Мадина Амангельдыева", sender: "Admin Ritm", transferDate: "24 мар. 2026" },
]

function buildTransferHistory(): TransferRow[] {
  const rows = [...knownTransferHistory]
  const baseline = new Date(2026, 2, 23)
  const target = 622
  let id = 1558
  let step = 0
  while (rows.length < target) {
    const requestDate = new Date(baseline)
    requestDate.setDate(requestDate.getDate() - step * 3)
    const transferDate = new Date(requestDate)
    transferDate.setDate(transferDate.getDate() + 1)
    rows.push({
      no: id,
      requestDate: fmt(requestDate),
      warehouse: warehouses[id % warehouses.length],
      type: "Заказ",
      to: transferToPool[id % transferToPool.length],
      sender: "Admin Ritm",
      transferDate: fmt(transferDate),
    })
    id -= 1
    step += 1
  }
  return rows
}

const knownMovements: MovementRow[] = [
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

const movementProducts = ["sndwch", "robot moshina", "Arslan 111111", "g'ilof", "test inventar", "Nataxtari 0.25", "spark123", "energetik 1 l", "coca-cola", "lipton"]
const movementTypeWords = ["Заказ", "Поставка", "Списание"]

function buildMovements(): MovementRow[] {
  const rows = [...knownMovements]
  const baseline = new Date(2026, 4, 8)
  const target = 2009
  let step = 0
  let docId = 1570
  while (rows.length < target) {
    const date = new Date(baseline)
    date.setDate(date.getDate() - Math.floor(step / 4))
    const dir: "up" | "down" = step % 2 === 0 ? "up" : "down"
    const qty = 1 + (step % 40)
    const product = movementProducts[step % movementProducts.length]
    const typeWord = movementTypeWords[step % movementTypeWords.length]
    rows.push({
      dir,
      product,
      quantity: `${dir === "up" ? "-" : ""}${qty} sht`,
      series: "-",
      date: `${fmt(date)}, ${String(8 + (step % 10)).padStart(2, "0")}:${String((step * 7) % 60).padStart(2, "0")}`,
      warehouse: warehouses[step % warehouses.length],
      type: `${typeWord} ${docId}`,
    })
    docId -= 1
    step += 1
  }
  return rows
}

type Row = ReceiptRow | ReceiptHistoryRow | TransferRow | MovementRow

export function GoodsMovementView() {
  const [tab, setTab] = useState<Tab>("receipt")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [expandedReceipt, setExpandedReceipt] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const [receipts, setReceipts] = useState<ReceiptRow[]>(buildReceipts)
  const [receiptHistory, setReceiptHistory] = useState<ReceiptHistoryRow[]>(buildReceiptHistory)
  const [transfers] = useState<TransferRow[]>(buildTransfers)
  const [transferHistory] = useState<TransferRow[]>(buildTransferHistory)
  const [movements] = useState<MovementRow[]>(buildMovements)

  const pageSize = 25

  const sourceRows: Row[] =
    tab === "receipt" ? receipts :
    tab === "receiptHistory" ? receiptHistory :
    tab === "transfer" ? transfers :
    tab === "transferHistory" ? transferHistory :
    movements

  const availableWarehouses = useMemo(() => Array.from(new Set(sourceRows.map((row) => row.warehouse))), [sourceRows])
  const availableTypes = useMemo(() => Array.from(new Set(sourceRows.map((row) => row.type))), [sourceRows])

  const filteredRows = useMemo(() => {
    return sourceRows.filter((row) => {
      if (query && !Object.values(row).join(" ").toLowerCase().includes(query.toLowerCase())) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      if (typeFilter !== "all" && row.type !== typeFilter) return false
      return true
    })
  }, [sourceRows, query, warehouseFilter, typeFilter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changeTab(next: Tab) {
    setTab(next)
    setQuery("")
    setPage(1)
    setWarehouseFilter("all")
    setTypeFilter("all")
    setExpandedReceipt(null)
    setFilterOpen(false)
  }

  function acceptReceipt(row: ReceiptRow) {
    setReceipts((current) => current.filter((item) => item.no !== row.no))
    setReceiptHistory((current) => [
      { no: row.no, person: row.person, type: row.type, date: row.date, accepted: "Admin Ritm", warehouse: row.warehouse },
      ...current,
    ])
    setExpandedReceipt(null)
  }

  function downloadExcel() {
    const headers: Record<Tab, [string, string][]> = {
      receipt: [["no", "№"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["warehouse", "Склад"]],
      transfer: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]],
      movement: [["product", "Товар"], ["quantity", "Кол-во"], ["series", "Серия"], ["date", "Дата"], ["warehouse", "Склад"], ["type", "Тип"]],
      receiptHistory: [["no", "№ заказа"], ["person", "От кого"], ["type", "Тип"], ["date", "Дата приемки"], ["accepted", "Принял"], ["warehouse", "Склад"]],
      transferHistory: [["no", "№"], ["requestDate", "Дата запроса"], ["warehouse", "Склад"], ["type", "Тип"], ["to", "Кому"], ["sender", "Передал"], ["transferDate", "Дата передачи"]],
    }
    const config = headers[tab]
    const head = config.map(([, title]) => `<th>${title}</th>`).join("")
    const body = filteredRows
      .map((row) => `<tr>${config.map(([key]) => `<td>${String((row as Record<string, unknown>)[key] ?? "")}</td>`).join("")}</tr>`)
      .join("")
    const html = `﻿<html><head><meta charset="utf-8"></head><body><table border="1"><tr>${head}</tr>${body}</table></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `plan-priemok-peredach-${tab}.xls`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center text-2xl font-bold text-slate-600">
          <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
            <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
          </button>
          <span className="mx-2 text-slate-400">|</span> План приемок и передач
        </h1>
        {tab === "movement" && (
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Ещё" className="text-slate-500 hover:text-slate-800">
              <MoreVertical className="h-6 w-6" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-30 w-52 rounded border border-slate-200 bg-white py-1 shadow-xl">
                <button type="button" onClick={() => { downloadExcel(); setMenuOpen(false) }} className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Скачать список</button>
                <button type="button" onClick={() => setMenuOpen(false)} className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50">Настройка колонок</button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="relative space-y-6 pb-8">
        <div className="grid grid-cols-5 overflow-hidden rounded-sm bg-white shadow">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeTab(item.id)}
              className={`h-16 border-b-4 text-[17px] transition ${tab === item.id ? "border-[#526fe4] text-[#526fe4]" : "border-transparent text-slate-900 hover:bg-slate-50"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-sm bg-white shadow">
          <div className="flex h-16 flex-wrap items-center gap-4 px-5">
            <button type="button" onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 text-[#526fe4]">
              <Filter className="h-4 w-4" />Показать фильтр⌄
            </button>
            <label className="relative w-96 max-w-[35vw]">
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 px-1 py-2 outline-none focus:border-[#526fe4]" />
              <Search className="absolute right-1 top-2 h-6 w-6 text-slate-300" />
            </label>
            <div className="ml-auto flex items-center gap-5 text-slate-500">
              <span>25⌄</span>
              <span>{filteredRows.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filteredRows.length)} из {filteredRows.length}</span>
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30"><ChevronLeft /></button>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30"><ChevronRight /></button>
              {tab === "movement" && <ListChecks className="h-5 w-5 text-slate-400" />}
              <button type="button" onClick={downloadExcel} aria-label="Скачать Excel"><Download className="h-6 w-6 text-slate-600" /></button>
            </div>
          </div>

          {filterOpen && (
            <div className="absolute left-0 top-20 z-30 w-[390px] rounded-sm bg-white p-6 shadow-2xl">
              <div className="mb-8 flex items-center justify-between text-xl text-slate-500">
                <span>Фильтр</span>
                <button type="button" onClick={() => setFilterOpen(false)} aria-label="Закрыть"><X /></button>
              </div>
              <div className="space-y-6">
                <label className="block border-b border-slate-300 pb-2 font-medium">
                  Склад
                  <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="mt-2 block w-full bg-white outline-none">
                    <option value="all">Все</option>
                    {availableWarehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-300 pb-2 font-medium">
                  Тип
                  <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="mt-2 block w-full bg-white outline-none">
                    <option value="all">Все</option>
                    {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#626b7e] px-5 py-3 text-white shadow">ПРИМЕНИТЬ</button>
              </div>
            </div>
          )}

          {tab === "receipt" && (
            <table className="w-full text-left">
              <thead className="bg-[#626b7e] text-white">
                <tr><th className="h-16 px-9 font-semibold">№</th><th className="px-5 font-semibold">От кого</th><th className="px-5 font-semibold">Тип</th><th className="px-5 font-semibold">Дата приемки</th><th className="px-5 font-semibold">Склад</th></tr>
              </thead>
              <tbody>
                {(visible as ReceiptRow[]).map((row) => (
                  <Fragment key={row.no}>
                    <tr onClick={() => setExpandedReceipt((current) => (current === row.no ? null : row.no))} className="h-[62px] cursor-pointer border-b border-dashed border-slate-200 even:bg-[#f2f6f9] hover:bg-slate-50">
                      <td className="px-9 text-[#4f70e7]">{row.no}</td>
                      <td className="px-5">{row.person}</td>
                      <td className="px-5">{row.type}</td>
                      <td className="px-5">{row.date}</td>
                      <td className="px-5">{row.warehouse}</td>
                    </tr>
                    {expandedReceipt === row.no && (
                      <tr>
                        <td colSpan={5} className="bg-[#f8fafc] p-0">
                          <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="mb-5 flex items-center justify-end gap-4 text-slate-500">
                              <button type="button" onClick={() => window.print()} aria-label="Печать" className="hover:text-[#4f70e7]"><Printer className="h-5 w-5" /></button>
                              <button type="button" onClick={() => acceptReceipt(row)} aria-label="Принять" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4f70e7] text-white hover:brightness-95">
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
                              <div>
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="text-slate-500"><th className="py-2 pr-4">Товар</th><th className="py-2 pr-4">Тип товара</th><th className="py-2 pr-4">Кол-во</th></tr>
                                  </thead>
                                  <tbody>
                                    {row.items.map((item) => (
                                      <tr key={item.product} className="border-t border-dashed border-slate-200">
                                        <td className="py-2 pr-4">{item.product}</td>
                                        <td className="py-2 pr-4">{item.type}</td>
                                        <td className="py-2 pr-4">{item.qty}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <p className="mt-3 font-semibold text-slate-700">Общее количество {row.items[0]?.qty}</p>
                              </div>
                              <div>
                                <p className="text-slate-500">Создал:</p>
                                <p className="mb-4 font-semibold text-slate-800">{row.creator}</p>
                                <p className="text-slate-500">Комментарий:</p>
                                <p className="font-semibold text-slate-800">{row.comment}</p>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {visible.length === 0 && <tr><td colSpan={5} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "transfer" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left">
                <thead className="bg-[#626b7e] text-white">
                  <tr><th className="h-16 px-9 font-semibold">№</th><th className="px-5 font-semibold">Дата запроса</th><th className="px-5 font-semibold">Склад</th><th className="px-5 font-semibold">Тип</th><th className="px-5 font-semibold">Кому</th><th className="px-5 font-semibold">Передал</th><th className="px-5 font-semibold">Дата передачи</th></tr>
                </thead>
                <tbody>
                  {(visible as TransferRow[]).map((row) => (
                    <tr key={row.no} className="h-[62px] border-b border-dashed border-slate-200 even:bg-[#f2f6f9]">
                      <td className="px-9 text-[#4f70e7]">{row.no}</td><td className="px-5">{row.requestDate}</td><td className="px-5">{row.warehouse}</td><td className="px-5">{row.type}</td><td className="px-5">{row.to}</td><td className="px-5">{row.sender}</td><td className="px-5">{row.transferDate}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && <tr><td colSpan={7} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "movement" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="bg-[#626b7e] text-white">
                  <tr><th className="h-16 px-9 font-semibold">Товар</th><th className="px-5 font-semibold">Кол-во</th><th className="px-5 font-semibold">Серия</th><th className="px-5 font-semibold">Дата</th><th className="px-5 font-semibold">Склад</th><th className="px-5 font-semibold">Тип</th></tr>
                </thead>
                <tbody>
                  {(visible as MovementRow[]).map((row, index) => {
                    const [word, docId] = row.type.split(" ")
                    return (
                      <tr key={`${row.type}-${row.date}-${index}`} className="h-[62px] border-b border-dashed border-slate-200 even:bg-[#f2f6f9]">
                        <td className="px-9"><span className="flex items-center gap-2">{row.dir === "up" ? <ArrowUp className="h-4 w-4 text-red-400" /> : <ArrowDown className="h-4 w-4 text-green-500" />}{row.product}</span></td>
                        <td className="px-5">{row.quantity}</td>
                        <td className="px-5">{row.series}</td>
                        <td className="px-5">{row.date}</td>
                        <td className="px-5">{row.warehouse}</td>
                        <td className="px-5">{docId ? <span>{word} <b className="font-normal text-sky-500">{docId}</b></span> : word}</td>
                      </tr>
                    )
                  })}
                  {visible.length === 0 && <tr><td colSpan={6} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "receiptHistory" && (
            <table className="w-full text-left">
              <thead className="bg-[#626b7e] text-white">
                <tr><th className="h-16 px-9 font-semibold">№ заказа</th><th className="px-5 font-semibold">От кого</th><th className="px-5 font-semibold">Тип</th><th className="px-5 font-semibold">Дата приемки</th><th className="px-5 font-semibold">Принял</th><th className="px-5 font-semibold">Склад</th></tr>
              </thead>
              <tbody>
                {(visible as ReceiptHistoryRow[]).map((row) => (
                  <tr key={row.no} className="h-[62px] border-b border-dashed border-slate-200 even:bg-[#f2f6f9]">
                    <td className="px-9 text-[#4f70e7]">{row.no}</td><td className="px-5">{row.person}</td><td className="px-5">{row.type}</td><td className="px-5">{row.date}</td><td className="px-5">{row.accepted}</td><td className="px-5">{row.warehouse}</td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={6} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "transferHistory" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left">
                <thead className="bg-[#626b7e] text-white">
                  <tr><th className="h-16 px-9 font-semibold">№</th><th className="px-5 font-semibold">Дата запроса</th><th className="px-5 font-semibold">Склад</th><th className="px-5 font-semibold">Тип</th><th className="px-5 font-semibold">Кому</th><th className="px-5 font-semibold">Передал</th><th className="px-5 font-semibold">Дата передачи</th></tr>
                </thead>
                <tbody>
                  {(visible as TransferRow[]).map((row) => (
                    <tr key={row.no} className="h-[62px] border-b border-dashed border-slate-200 even:bg-[#f2f6f9]">
                      <td className="px-9 text-[#4f70e7]">{row.no}</td><td className="px-5">{row.requestDate}</td><td className="px-5">{row.warehouse}</td><td className="px-5">{row.type}</td><td className="px-5">{row.to}</td><td className="px-5">{row.sender}</td><td className="px-5">{row.transferDate}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && <tr><td colSpan={7} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
