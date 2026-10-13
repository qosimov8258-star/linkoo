"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  Download,
  Expand,
  ListFilter,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import type { OrderItemWithOrder } from "@/lib/order-items-repo"

type AgentSale = {
  agent: string
  saleQty: number
  saleSum: number
  returnQty: number
  returnSum: number
  discountQty: number
  discountSum: number
  bonusQty: number
  bonusSum: number
}

// Same defensive parser used across the analytics views: orderCreated is either an ISO
// date ("2026-08-02") or a Russian day+month string with no year ("06 сент. 14:23").
function parseOrderCreatedDate(value: string): Date | null {
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?/i)
  if (ru) {
    const monthNames = ["янв", "февр", "мар", "апр", "мая", "июня", "июля", "авг", "сент", "окт", "нояб", "дек"]
    const monthIndex = monthNames.indexOf(ru[2].toLowerCase())
    if (monthIndex >= 0) {
      const yearMatch = value.match(/(\d{4})/)
      const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
      const date = new Date(year, monthIndex, Number(ru[1]))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  return null
}

function isWithinRange(value: string, fromIso: string, toIso: string): boolean {
  const date = parseOrderCreatedDate(value)
  if (!date) return true
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T23:59:59`)
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime()
}

// Grouped by orderAgent. Returns come from items whose parent order type is "Возврат"
// (the only real signal for a return in this schema). Discount figures are the actual
// discount amount taken off each line (quantity × unitPrice × discountPercent / 100).
// There is no bonus concept anywhere in order_items, so bonus columns stay at 0 — no
// more fabricating a "показать бонусные продукты" number.
function buildAgentRows(items: OrderItemWithOrder[]): AgentSale[] {
  const map = new Map<string, AgentSale>()
  for (const item of items) {
    const key = item.orderAgent || "Не указано"
    const row = map.get(key) ?? { agent: key, saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0, discountQty: 0, discountSum: 0, bonusQty: 0, bonusSum: 0 }
    const discountAmount = item.quantity * item.unitPrice * (item.discountPercent / 100)
    if (item.discountPercent > 0) {
      row.discountQty += item.quantity
      row.discountSum += discountAmount
    }
    if (item.orderType === "Возврат") {
      row.returnQty += item.quantity
      row.returnSum += item.lineTotal
    } else {
      row.saleQty += item.quantity
      row.saleSum += item.lineTotal
    }
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => b.saleSum - a.saleSum)
}

const branches = ["Все филиалы", "777", "878", "Andijon", "AURUM samarqand"]
const organizations = ["Все организации", "Linko", "Time3 Distribution"]
const productTypes = ["Все типы товара", "Мыло", "Напитки", "Снеки"]
const statuses = ["Все статусы", "Завершено", "В процессе", "Отменено"]
const clients = ["Все клиенты", "Doston market", "Markus Vitinha", "Usman Dembele"]
const clientTypes = ["Все типы клиентов", "horeca", "market", "market100", "market101"]
const agents = ["Все агенты", "Admin Ritm"]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

export function SalesByAgentsView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [fullscreen, setFullscreen] = useState(false)
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [warehouseFrom, setWarehouseFrom] = useState(monthStart)
  const [warehouseTo, setWarehouseTo] = useState(today)
  const [branch, setBranch] = useState(branches[0])
  const [organization, setOrganization] = useState(organizations[0])
  const [productType, setProductType] = useState(productTypes[0])
  const [status, setStatus] = useState(statuses[0])
  const [client, setClient] = useState(clients[0])
  const [agent, setAgent] = useState(agents[0])
  const [clientType, setClientType] = useState(clientTypes[0])
  const [showBonus, setShowBonus] = useState(false)
  const [, setFilterVersion] = useState(0)

  const [items, setItems] = useState<OrderItemWithOrder[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState("")

  useEffect(() => {
    let cancelled = false
    setItemsLoading(true)
    fetch("/api/order-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as OrderItemWithOrder[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setItemsError("")
      })
      .catch(() => {
        if (!cancelled) setItemsError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => {
    const dateFiltered = mode === "created" ? items.filter((item) => isWithinRange(item.orderCreated, from, to)) : items
    return buildAgentRows(dateFiltered)
      .filter((row) => agent === agents[0] || row.agent === agent)
      .filter((row) => row.agent.toLowerCase().includes(query.toLowerCase()))
  }, [items, agent, query, mode, from, to])

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          saleQty: sum.saleQty + row.saleQty,
          saleSum: sum.saleSum + row.saleSum,
          returnQty: sum.returnQty + row.returnQty,
          returnSum: sum.returnSum + row.returnSum,
        }),
        { saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0 },
      ),
    [rows],
  )
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const shown = rows.slice((page - 1) * pageSize, page * pageSize)

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    if (from <= to && warehouseFrom <= warehouseTo) {
      setFilterVersion((value) => value + 1)
      setFilterOpen(false)
      setPage(1)
    }
  }

  function downloadCsv() {
    const header = "Агент;Продажа кол-во;Продажа сумма;Возврат кол-во;Возврат сумма;Фактическая продажа кол-во;Фактическая продажа сумма;Скидки;Бонус"
    const body = rows.map((row) => `${row.agent};${row.saleQty};${row.saleSum};${row.returnQty};${row.returnSum};${row.saleQty - row.returnQty};${row.saleSum - row.returnSum};${row.discountSum};${row.bonusSum}`)
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "sales-by-agents.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex items-center gap-3 border-b px-5 py-4 text-xl font-bold sm:px-10 sm:text-2xl">
        <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
        <span className="text-slate-500">|</span><h1 className="text-slate-600">Прибыль от агентов</h1>
      </header>
      <section className={`${fullscreen ? "fixed inset-0 z-[80] overflow-auto bg-white p-5" : "bg-white px-4 py-6 sm:px-10"}`}>
        <div className="flex flex-wrap items-center gap-5">
          <button type="button" onClick={() => setFilterOpen(true)} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white"><ListFilter className="mr-2 inline h-5 w-5" />Фильтр / 1</button>
          <strong className="text-[#5470e8]">{organization}</strong>
          <button type="button" onClick={downloadCsv} className="ml-auto rounded-md bg-[#71ce87] px-5 py-2.5 font-bold text-white"><Download className="mr-2 inline h-5 w-5" />Скачать</button>
          {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="rounded border px-3 py-2">Закрыть</button>}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Summary label="Сумма от продаж" value={totals.saleSum} qty={totals.saleQty} />
          <Summary label="Сумма возвратов" value={totals.returnSum} qty={totals.returnQty} />
          <Summary label="Фактические продажи" value={totals.saleSum - totals.returnSum} qty={totals.saleQty - totals.returnQty} right />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5 border-b pb-3">
          <label className="relative w-full max-w-lg"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-0 border-b px-0 py-2 pr-9 outline-none" /><Search className="absolute right-1 top-2 h-5 w-5" /></label>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="ml-auto"><option>10</option><option>25</option><option>50</option></select>
          <span>{rows.length ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, rows.length)} из ${rows.length}` : "0 из 0"}</span>
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>◀</button><button type="button" disabled={page === pages} onClick={() => setPage((value) => value + 1)}>▶</button>
          <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label="Полный экран"><Expand className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <p className="text-lg font-semibold text-[#5470e8]">ⓘ Это оперативный отчет. Для просмотра факта перейдите в другой раздел</p>
          <div className="flex"><button type="button" onClick={() => setMode("created")} className={`px-5 py-2.5 ${mode === "created" ? "bg-[#5470e8] text-white" : "border"}`}>ПОКАЗАТЬ ПРОДАЖУ ПО ДАТЕ СОЗДАНИЯ</button><button type="button" onClick={() => setMode("realized")} className={`px-5 py-2.5 ${mode === "realized" ? "bg-[#5470e8] text-white" : "border"}`}>ПРОДАЖА АГЕНТОВ ПО ДАТЕ РЕАЛИЗАЦИИ С ПРИБЫЛЬЮ</button></div>
        </div>
        {itemsLoading ? (
          <p className="px-3 py-16 text-center text-slate-400">Загрузка...</p>
        ) : itemsError ? (
          <p className="px-3 py-16 text-center text-red-600">{itemsError}</p>
        ) : (
          <div className="overflow-x-auto"><table className="min-w-[1250px] border-collapse"><thead className="bg-[#5470e8] text-white"><tr><th rowSpan={2} className="min-w-[300px] border-r border-white/30 px-5 py-4 text-left">Агент</th>{["Продажа", "Возврат в этом периоде", "Фактическая продажа", "Скидки", "Бонус"].map((item) => <th key={item} colSpan={2} className="border-r border-white/30 px-4 py-3 text-left">{item}</th>)}</tr><tr>{Array.from({ length: 5 }).flatMap((_, index) => [<th key={`${index}-q`} className="border-r border-white/30 px-4 py-3">Кол-во</th>, <th key={`${index}-s`} className="border-r border-white/30 px-4 py-3">Сумма</th>])}</tr></thead><tbody>{shown.map((row, index) => { const actualQty = row.saleQty - row.returnQty; const actualSum = row.saleSum - row.returnSum; return <tr key={row.agent} className={index % 2 ? "bg-white" : "bg-slate-50"}><td className="border-r px-5 py-3">{row.agent}</td>{[row.saleQty, row.saleSum, row.returnQty, row.returnSum, actualQty, actualSum, row.discountQty, row.discountSum, row.bonusQty, row.bonusSum].map((value, cell) => <td key={cell} className={`border-r px-4 py-3 text-right ${value > 0 ? "text-green-600" : value < 0 ? "text-red-500" : ""}`}>{typeof value === "number" ? value.toLocaleString("ru-RU") : value}</td>)}</tr>})}</tbody></table></div>
        )}
      </section>
      {filterOpen && <FilterDialog from={from} setFrom={setFrom} to={to} setTo={setTo} warehouseFrom={warehouseFrom} setWarehouseFrom={setWarehouseFrom} warehouseTo={warehouseTo} setWarehouseTo={setWarehouseTo} branch={branch} setBranch={setBranch} organization={organization} setOrganization={setOrganization} productType={productType} setProductType={setProductType} status={status} setStatus={setStatus} client={client} setClient={setClient} agent={agent} setAgent={setAgent} clientType={clientType} setClientType={setClientType} showBonus={showBonus} setShowBonus={setShowBonus} onClose={() => setFilterOpen(false)} onSubmit={applyFilters} />}
    </main>
  )
}

function Summary({ label, value, qty, right = false }: { label: string; value: number; qty: number; right?: boolean }) {
  return <div className={`border px-5 py-3 ${right ? "text-right" : ""}`}><p className="text-slate-500">{label}</p><strong className="text-xl text-[#71ce87]">{value.toLocaleString("ru-RU")} SUM <small className="text-base text-slate-700">({qty} шт)</small></strong></div>
}

type Setter = (value: string) => void
function FilterDialog(props: { from: string; setFrom: Setter; to: string; setTo: Setter; warehouseFrom: string; setWarehouseFrom: Setter; warehouseTo: string; setWarehouseTo: Setter; branch: string; setBranch: Setter; organization: string; setOrganization: Setter; productType: string; setProductType: Setter; status: string; setStatus: Setter; client: string; setClient: Setter; agent: string; setAgent: Setter; clientType: string; setClientType: Setter; showBonus: boolean; setShowBonus: (value: boolean) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-2 pt-3"><form onSubmit={props.onSubmit} className="w-full max-w-[1840px] bg-white p-9 shadow-2xl"><header className="flex justify-between"><h2 className="font-bold">Фильтр</h2><button type="button" onClick={props.onClose}><X /></button></header><div className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-4"><DatePair label="Период создания" from={props.from} setFrom={props.setFrom} to={props.to} setTo={props.setTo} /><DatePair label="Период передачи со склада" from={props.warehouseFrom} setFrom={props.setWarehouseFrom} to={props.warehouseTo} setTo={props.setWarehouseTo} /><Select label="Филиалы" value={props.branch} setter={props.setBranch} options={branches} /><Select label="Организация" value={props.organization} setter={props.setOrganization} options={organizations} /><Select label="Тип товара" value={props.productType} setter={props.setProductType} options={productTypes} /><Select label="Статус" value={props.status} setter={props.setStatus} options={statuses} /><Select label="Клиент" value={props.client} setter={props.setClient} options={clients} /><Select label="Агент" value={props.agent} setter={props.setAgent} options={agents} /><Select label="Тип клиента" value={props.clientType} setter={props.setClientType} options={clientTypes} /><label className="flex items-center gap-3"><input type="checkbox" checked={props.showBonus} onChange={(event) => props.setShowBonus(event.target.checked)} className="h-5 w-5" />Показать бонусные продукты</label></div><button type="submit" className="mt-3 w-full rounded bg-[#71ce87] py-3 font-bold text-white">Применить</button></form></div>
}
function DatePair({ label, from, setFrom, to, setTo }: { label: string; from: string; setFrom: Setter; to: string; setTo: Setter }) { return <fieldset><legend className="text-xs">{label}</legend><div className="grid grid-cols-2 gap-2"><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="border-b py-2" /><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="border-b py-2" /></div></fieldset> }
function Select({ label, value, setter, options }: { label: string; value: string; setter: Setter; options: string[] }) { return <label>{label}<select value={value} onChange={(event) => setter(event.target.value)} className="block w-full border-0 border-b bg-white py-2">{options.map((option) => <option key={option}>{option}</option>)}</select></label> }
