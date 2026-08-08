"use client"

import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ListPlus,
  Package,
  Pencil,
  Percent,
  Plus,
  Printer,
  Search,
  Star,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"

type PaymentType = "Банковский счет" | "Наличный"
type Status = "принят" | "ожидает" | "отменен"

type IncomingItem = {
  id: number
  product: string
  expiry: string
  qty: number
  block: number
  kg: number
  netWeight: number
  cost: number
  total: number
}

type Incoming = {
  id: number
  supplier: string
  warehouse: string
  date: string
  paymentType: PaymentType
  contractNumber: string
  amount: number
  status: Status
  invoiceNumber: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: IncomingItem[]
}

const suppliers = ["Fardad", "Инвентаризация", "карим", "tillochi", "ANGOR MChJ", "Nestle Uzbekistan"]
const warehouses = ["Andijon skladi", "основной", "ANGOR", "Toshkent skladi", "Buxoro skladi"]
const branches = ["Toshkent", "Buxoro", "Andijon", "Samarqand", "Farg'ona"]
const organizations = ["05,08,2025", "Linko Distribution", "Linko Trade"]
const paymentTypes: PaymentType[] = ["Банковский счет", "Наличный"]
const products = ["coca-cola", "lipton", "sprayt", "energetik", "g'ilof", "baby still", "Lalaku", "Холодильник"]

const monthNames = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
]

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

const knownRows: Omit<Incoming, "organization" | "branch" | "phone" | "email" | "initiator" | "paid" | "time" | "comment" | "items">[] = [
  { id: 351, supplier: "Fardad", warehouse: "Andijon skladi", date: "06 июля 2026", paymentType: "Банковский счет", contractNumber: "", amount: 256800, status: "принят", invoiceNumber: "" },
  { id: 350, supplier: "Fardad", warehouse: "Andijon skladi", date: "23 июня 2026", paymentType: "Банковский счет", contractNumber: "", amount: 25400, status: "ожидает", invoiceNumber: "" },
  { id: 349, supplier: "Fardad", warehouse: "Andijon skladi", date: "23 июня 2026", paymentType: "Наличный", contractNumber: "", amount: 2000, status: "принят", invoiceNumber: "" },
  { id: 348, supplier: "Инвентаризация", warehouse: "05,08,2025(1)", date: "14 мая 2026", paymentType: "Наличный", contractNumber: "", amount: 205.22, status: "принят", invoiceNumber: "" },
  { id: 346, supplier: "Инвентаризация", warehouse: "Andijon skladi", date: "22 апр. 2026", paymentType: "Наличный", contractNumber: "", amount: 10000, status: "принят", invoiceNumber: "" },
  { id: 345, supplier: "Fardad", warehouse: "основной", date: "20 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 300000, status: "принят", invoiceNumber: "" },
  { id: 344, supplier: "Fardad", warehouse: "Andijon skladi", date: "14 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 100, status: "ожидает", invoiceNumber: "" },
  { id: 343, supplier: "карим", warehouse: "ANGOR", date: "11 апр. 2026", paymentType: "Банковский счет", contractNumber: "", amount: 120708500, status: "принят", invoiceNumber: "" },
  { id: 342, supplier: "Fardad", warehouse: "основной", date: "10 апр. 2026", paymentType: "Банковский счет", contractNumber: "19", amount: 36000, status: "принят", invoiceNumber: "" },
  { id: 341, supplier: "tillochi", warehouse: "Andijon skladi", date: "06 апр. 2026", paymentType: "Наличный", contractNumber: "", amount: 36212550, status: "принят", invoiceNumber: "" },
]

function seededItems(id: number, amount: number): IncomingItem[] {
  const product = products[id % products.length]
  const qty = 1 + (id % 12)
  const cost = Math.round((amount / qty) * 100) / 100
  return [{ id: 1, product, expiry: "", qty, block: 0, kg: 0, netWeight: 0, cost, total: amount }]
}

function generateRows(): Incoming[] {
  const baseline = new Date(2026, 3, 6)
  const statusPool: Status[] = ["принят", "принят", "принят", "принят", "ожидает", "принят", "принят", "отменен"]
  const rows: Incoming[] = []

  for (const row of knownRows) {
    rows.push({
      ...row,
      organization: "05,08,2025",
      branch: "Buxoro",
      phone: "Не указан",
      email: "Не указан",
      initiator: "Admin Ritm",
      paid: 0,
      time: "14 мая 2026, 13:20",
      comment: "",
      items: id_items(row.id, row.amount),
    })
  }

  function id_items(id: number, amount: number) {
    return seededItems(id, amount)
  }

  for (let id = 340; id >= 37; id -= 1) {
    if (id === 347) continue
    const offsetDays = (341 - id) * 3
    const date = new Date(baseline)
    date.setDate(date.getDate() - offsetDays)
    const supplier = suppliers[id % suppliers.length]
    const warehouse = warehouses[id % warehouses.length]
    const paymentType = paymentTypes[id % paymentTypes.length]
    const status = statusPool[id % statusPool.length]
    const amount = 5000 + ((id * 3733) % 480000)
    rows.push({
      id,
      supplier,
      warehouse,
      date: formatDate(date),
      paymentType,
      contractNumber: id % 5 === 0 ? String(10 + (id % 40)) : "",
      amount,
      status,
      invoiceNumber: "",
      organization: organizations[id % organizations.length],
      branch: branches[id % branches.length],
      phone: "Не указан",
      email: "Не указан",
      initiator: "Admin Ritm",
      paid: status === "принят" ? amount : 0,
      time: `${formatDate(date)}, ${String(8 + (id % 10)).padStart(2, "0")}:${String((id * 7) % 60).padStart(2, "0")}`,
      comment: "",
      items: seededItems(id, amount),
    })
  }

  return rows
}

const statusStyles: Record<Status, string> = {
  принят: "text-emerald-500",
  ожидает: "text-amber-500",
  отменен: "text-rose-500",
}
const statusDots: Record<Status, string> = {
  принят: "bg-emerald-500",
  ожидает: "bg-amber-500",
  отменен: "bg-rose-500",
}

type DraftItem = { id: number; product: string; qty: number; cost: number }
type Tab = "items" | "cost" | "expenses" | "logs"

function emptyDraft() {
  return {
    supplier: suppliers[0],
    branch: branches[0],
    warehouse: warehouses[0],
    organization: organizations[0],
    currency: "SUM",
    paymentType: paymentTypes[0] as string,
    date: formatDate(new Date()),
    expectedFactoryExit: "",
    expectedCustomsArrival: "",
    contractNumber: "",
    invoiceNumber: "",
    invoiceDate: "",
    comment: "",
  }
}

export function SupplierIncomingsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Incoming[]>(generateRows)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<Tab>("items")
  const [markupTarget, setMarkupTarget] = useState<Incoming | null>(null)
  const [markupPercent, setMarkupPercent] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.supplier.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (statusFilter !== "all" && row.status !== statusFilter) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      return true
    })
  }, [rows, query, statusFilter, warehouseFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: Incoming) {
    setExpandedId((current) => (current === row.id ? null : row.id))
    setDetailTab("items")
  }

  function openCreate() {
    setDraft(emptyDraft())
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: Incoming) {
    setDraft({
      supplier: row.supplier,
      branch: row.branch,
      warehouse: row.warehouse,
      organization: row.organization,
      currency: "SUM",
      paymentType: row.paymentType,
      date: row.date,
      expectedFactoryExit: "",
      expectedCustomsArrival: "",
      contractNumber: row.contractNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: "",
      comment: row.comment,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, cost: item.cost })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: products[0], qty: 1, cost: 0 }])
  }

  function addFromList(product: string) {
    setDraftItems((current) => {
      if (current.some((item) => item.product === product)) return current
      return [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product, qty: 1, cost: 0 }]
    })
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? "")
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const parsed: DraftItem[] = []
      let nextId = Math.max(0, ...draftItems.map((item) => item.id)) + 1
      for (const line of lines) {
        const cells = line.split(/\t|,|;/).map((cell) => cell.replace(/<[^>]+>/g, "").trim()).filter(Boolean)
        if (cells.length < 1) continue
        const [product, qtyRaw, costRaw] = cells
        if (!product || /^(товар|product|наименование)$/i.test(product)) continue
        parsed.push({ id: nextId++, product, qty: Number(qtyRaw) || 1, cost: Number(costRaw) || 0 })
      }
      if (parsed.length) setDraftItems((current) => [...current, ...parsed])
    }
    reader.readAsText(file)
    event.target.value = ""
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.cost, 0)
  const draftTotalQty = draftItems.reduce((sum, item) => sum + item.qty, 0)

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draftItems.length) return
    const items: IncomingItem[] = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      expiry: "",
      qty: item.qty,
      block: 0,
      kg: 0,
      netWeight: 0,
      cost: item.cost,
      total: item.qty * item.cost,
    }))
    if (editingId !== null) {
      setRows((current) =>
        current.map((row) =>
          row.id === editingId
            ? {
                ...row,
                supplier: draft.supplier,
                warehouse: draft.warehouse,
                branch: draft.branch,
                organization: draft.organization,
                paymentType: draft.paymentType as PaymentType,
                date: draft.date,
                contractNumber: draft.contractNumber,
                invoiceNumber: draft.invoiceNumber,
                comment: draft.comment,
                amount: draftTotalCost,
                items,
              }
            : row,
        ),
      )
    } else {
      const id = Math.max(0, ...rows.map((row) => row.id)) + 1
      const newRow: Incoming = {
        id,
        supplier: draft.supplier,
        warehouse: draft.warehouse,
        date: draft.date,
        paymentType: draft.paymentType as PaymentType,
        contractNumber: draft.contractNumber,
        amount: draftTotalCost,
        status: "ожидает",
        invoiceNumber: draft.invoiceNumber,
        organization: draft.organization,
        branch: draft.branch,
        phone: "Не указан",
        email: "Не указан",
        initiator: "Admin Ritm",
        paid: 0,
        time: `${draft.date}, ${new Date().toTimeString().slice(0, 5)}`,
        comment: draft.comment,
        items,
      }
      setRows((current) => [newRow, ...current])
    }
    setModalOpen(false)
  }

  function cancelSupply(row: Incoming) {
    if (!window.confirm(`Отменить приёмку поставки № ${row.id}?`)) return
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "отменен" } : item)))
  }

  function downloadRow(row: Incoming) {
    downloadExcelTable(`postavka-${row.id}`, [
      ["№", "Товар", "Количество", "Стоимость", "Итог"],
      ...row.items.map((item) => [item.id, item.product, `${item.qty} шт`, item.cost, item.total]),
    ])
  }

  function downloadList() {
    downloadExcelTable("prihod-ot-postavshikov", [
      ["№", "Поставщик", "Склад", "Дата поставки", "Тип оплаты", "Номер договора", "Сумма поставки", "Статус", "Счет фактура"],
      ...filtered.map((row) => [row.id, row.supplier, row.warehouse, row.date, row.paymentType, row.contractNumber, row.amount, row.status, row.invoiceNumber]),
    ])
  }

  function applyMarkup(event: FormEvent) {
    event.preventDefault()
    if (!markupTarget) return
    const percent = Number(markupPercent)
    if (!percent) {
      setMarkupTarget(null)
      setMarkupPercent("")
      return
    }
    setRows((current) =>
      current.map((row) => {
        if (row.id !== markupTarget.id) return row
        const items = row.items.map((item) => {
          const cost = Math.round(item.cost * (1 + percent / 100) * 100) / 100
          return { ...item, cost, total: Math.round(cost * item.qty * 100) / 100 }
        })
        return { ...row, items, amount: items.reduce((sum, item) => sum + item.total, 0) }
      }),
    )
    setMarkupTarget(null)
    setMarkupPercent("")
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "items", label: "Список товаров" },
    { id: "cost", label: "Себестоимость" },
    { id: "expenses", label: "Доп. расходы" },
    { id: "logs", label: "Логи" },
  ]

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Приход от поставщиков
          </h1>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> Добавить
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              Статус:{" "}
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | Status); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                <option value="принят">принят</option>
                <option value="ожидает">ожидает</option>
                <option value="отменен">отменен</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Склад:{" "}
              <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse} value={warehouse}>{warehouse}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
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
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f70e7]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Поставщик</th>
              <th className="px-5 py-5">Склад</th>
              <th className="px-5 py-5">Дата поставки</th>
              <th className="px-5 py-5">Тип оплаты</th>
              <th className="px-5 py-5">Номер договора</th>
              <th className="px-5 py-5">Сумма поставки</th>
              <th className="px-5 py-5">Статус</th>
              <th className="px-5 py-5">Счет фактура</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{row.supplier}</td>
                  <td className="px-5 py-4">{row.warehouse}</td>
                  <td className="px-5 py-4">{row.date}</td>
                  <td className="px-5 py-4">{row.paymentType}</td>
                  <td className="px-5 py-4">{row.contractNumber}</td>
                  <td className="px-5 py-4">{formatMoney(row.amount)}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${statusDots[row.status]}`} /> {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">{row.invoiceNumber}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={9} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-baseline gap-3">
                            <h2 className="text-xl font-bold text-slate-700">Поставка № {row.id}</h2>
                            <span className="font-medium text-emerald-500">{row.supplier}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setMarkupTarget(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Percent className="h-4 w-4" /> Наценка
                            </button>
                            <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Pencil className="h-4 w-4" /> Изменить
                            </button>
                            <button type="button" onClick={() => downloadRow(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Download className="h-4 w-4" /> Скачать
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelSupply(row)}
                              disabled={row.status === "отменен"}
                              className="inline-flex items-center gap-2 rounded bg-[#ff8967] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
                            >
                              <Ban className="h-4 w-4" /> Отменить приёмку
                            </button>
                            <button type="button" onClick={() => window.print()} aria-label="Печать" className="text-slate-500 hover:text-[#4f70e7]">
                              <Printer className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="mb-6 grid gap-6 sm:grid-cols-3">
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Поставщик:</dt><dd className="font-medium">{row.supplier}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Договор №</dt><dd className="font-medium">{row.contractNumber || "Не указан"}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Организация:</dt><dd className="font-medium">{row.organization}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Филиал:</dt><dd className="font-medium">{row.branch}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Телефон:</dt><dd className="font-medium">{row.phone}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">E-mail:</dt><dd className="font-medium">{row.email}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Инициатор:</dt><dd className="font-medium">{row.initiator}</dd></div>
                          </dl>

                          <div>
                            <p className="mb-2 font-bold uppercase tracking-wide text-slate-700">Баланс</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Стоимость поставки</dt><dd className="font-medium">{formatMoney(row.amount)}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Тип оплаты</dt><dd className="font-medium">{row.paymentType}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Оплачено:</dt><dd className="font-medium">{formatMoney(row.paid)}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Остаток:</dt><dd className="font-medium text-rose-500">{formatMoney(row.amount - row.paid)}</dd></div>
                            </dl>
                            <p className="mb-2 mt-4 font-bold uppercase tracking-wide text-slate-700">Доп. расходы</p>
                            <p className="text-sm text-slate-500">Нет дополнительных расходов</p>
                          </div>

                          <div>
                            <p className="mb-2 font-bold uppercase tracking-wide text-slate-700">Исполнение</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Склад:</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Статус:</dt><dd className={`font-medium ${statusStyles[row.status]}`}>{row.status === "принят" ? "Завершен" : row.status === "ожидает" ? "В ожидании" : "Отменен"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Принимать на склад:</dt><dd className="font-medium text-emerald-500">{row.status === "отменен" ? "Нельзя" : "Можно"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Время приемки:</dt><dd className="font-medium">{row.time}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата поставки:</dt><dd className="font-medium">{row.date}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Комментарии:</dt><dd className="font-medium">{row.comment || "Не указан"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Счет фактура:</dt><dd className="font-medium">{row.invoiceNumber || "Не указан"}</dd></div>
                            </dl>
                          </div>
                        </div>

                        <div className="mb-3 flex gap-6 border-b border-slate-200">
                          {tabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDetailTab(tab.id)}
                              className={`border-b-2 pb-2 text-sm font-medium ${detailTab === tab.id ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        {detailTab === "items" && (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="py-2 pr-4">№</th>
                                <th className="py-2 pr-4">Товар</th>
                                <th className="py-2 pr-4">Срок годности</th>
                                <th className="py-2 pr-4">Количество</th>
                                <th className="py-2 pr-4">Блок</th>
                                <th className="py-2 pr-4">Кг.</th>
                                <th className="py-2 pr-4">Вес нетто.</th>
                                <th className="py-2 pr-4">Стоимость</th>
                                <th className="py-2 pr-4">Итог</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item) => (
                                <tr key={item.id} className="border-t border-slate-100">
                                  <td className="py-2 pr-4">{item.id}</td>
                                  <td className="py-2 pr-4">{item.product}</td>
                                  <td className="py-2 pr-4">{item.expiry || "—"}</td>
                                  <td className="py-2 pr-4">{item.qty} шт</td>
                                  <td className="py-2 pr-4">{item.block}</td>
                                  <td className="py-2 pr-4">{item.kg}</td>
                                  <td className="py-2 pr-4">{item.netWeight}</td>
                                  <td className="py-2 pr-4">{item.cost.toLocaleString("ru-RU")}</td>
                                  <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-slate-300 font-bold">
                                <td className="py-2 pr-4" colSpan={3}>Итого:</td>
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.qty, 0)} шт</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4" />
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.cost, 0).toLocaleString("ru-RU")}</td>
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.total, 0).toLocaleString("ru-RU")}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {detailTab === "cost" && (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="py-2 pr-4">Товар</th>
                                <th className="py-2 pr-4">Себестоимость за ед.</th>
                                <th className="py-2 pr-4">Итог</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item) => (
                                <tr key={item.id} className="border-t border-slate-100">
                                  <td className="py-2 pr-4">{item.product}</td>
                                  <td className="py-2 pr-4">{item.cost.toLocaleString("ru-RU")} SUM</td>
                                  <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")} SUM</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {detailTab === "expenses" && <p className="text-sm text-slate-500">Нет дополнительных расходов</p>}

                        {detailTab === "logs" && (
                          <ul className="space-y-2 text-sm text-slate-600">
                            <li>{row.time} — Поставка создана инициатором {row.initiator}</li>
                            {row.status !== "ожидает" && <li>{row.time} — Статус изменён на «{row.status}»</li>}
                          </ul>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <Package className="h-14 w-14 text-slate-300" />
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {markupTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={applyMarkup} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">Наценка — поставка № {markupTarget.id}</b>
              <button type="button" onClick={() => setMarkupTarget(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="block text-sm font-medium text-slate-600">
              Процент наценки (%)
              <input
                autoFocus
                type="number"
                value={markupPercent}
                onChange={(event) => setMarkupPercent(event.target.value)}
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setMarkupTarget(null)} className="rounded border px-4 py-2">Отмена</button>
              <button type="submit" className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">Применить</button>
            </div>
          </form>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `Изменить поставку № ${editingId}` : "Добавление поставки"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-8">
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Поставщик *
                    <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {suppliers.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Филиал *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {branches.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Склад назначения *
                    <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {warehouses.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block font-medium">
                    Оставить комментарий...
                    <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={2} className="mt-2 block w-full resize-none border-b border-slate-200 outline-none" />
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Организация *
                    <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {organizations.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Валюта оплаты *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option>SUM</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Тип оплаты *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {paymentTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Дата поставки *
                    <input value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Ожидаемый выход с завода
                    <input value={draft.expectedFactoryExit} onChange={(event) => setDraft((value) => ({ ...value, expectedFactoryExit: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Ожидаемое прибытие в таможню
                    <input value={draft.expectedCustomsArrival} onChange={(event) => setDraft((value) => ({ ...value, expectedCustomsArrival: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Номер договора
                    <input value={draft.contractNumber} onChange={(event) => setDraft((value) => ({ ...value, contractNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Номер счет фактура
                    <input value={draft.invoiceNumber} onChange={(event) => setDraft((value) => ({ ...value, invoiceNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Дата счет фактуры
                    <input value={draft.invoiceDate} onChange={(event) => setDraft((value) => ({ ...value, invoiceDate: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-slate-800">Список товаров</p>
                  <div className="flex items-center gap-4 text-sm">
                    <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                      <Plus className="h-4 w-4" /> добавить товар
                    </button>
                    <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                      <ListPlus className="h-4 w-4" /> добавить из списка
                    </button>
                    <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                      <Upload className="h-4 w-4" /> импортировать с excel
                    </button>
                    <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
                  </div>
                </div>

                {draftItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-12 text-slate-400">
                    <FileSpreadsheet className="h-12 w-12" />
                    <p>
                      Вы еще не выбрали ни одного товара.{" "}
                      <button type="button" onClick={addBlankItem} className="text-[#4f70e7] hover:underline">
                        Добавить товар?
                      </button>
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-2 pr-4">Товар</th>
                        <th className="py-2 pr-4">Количество</th>
                        <th className="py-2 pr-4">Цена</th>
                        <th className="py-2 pr-4">Итог</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">
                            <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className="bg-white outline-none">
                              {products.map((product) => <option key={product}>{product}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-20 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.cost} onChange={(event) => updateDraftItem(item.id, { cost: Number(event.target.value) })} className="w-28 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">{(item.qty * item.cost).toLocaleString("ru-RU")}</td>
                          <td className="py-2 pr-4 text-right">
                            <button type="button" onClick={() => removeDraftItem(item.id)} aria-label="Удалить" className="text-slate-400 hover:text-rose-500">
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-between border-t p-5">
              <div className="text-sm text-slate-600">
                Общая стоимость: <b>{formatMoney(draftTotalCost)}</b> &nbsp; Общее кол-во: <b>{draftTotalQty} ед</b>
              </div>
              <button type="submit" className="font-bold uppercase text-sky-500">
                Сохранить
              </button>
            </footer>
          </form>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">Добавить из списка</b>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2">
              {products.map((product) => (
                <label key={product} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draftItems.some((item) => item.product === product)} onChange={() => addFromList(product)} />
                  {product}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">Готово</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
