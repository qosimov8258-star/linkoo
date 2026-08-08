"use client"

import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  ListChecks,
  ListPlus,
  Pencil,
  Plus,
  Printer,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, ReactElement, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"

type Status = "завершен" | "в процессе" | "отменен"

type ReturnItem = { id: number; product: string; qty: number; series: string; price: number; total: number }

type SupplierReturn = {
  id: number
  fromWhom: string
  warehouse: string
  addedBy: string
  date: string
  time: string
  amount: number
  status: Status
  organization: string
  currency: string
  paymentType: string
  priceList: string
  branch: string
  transferTime: string
  reason: string
  items: ReturnItem[]
}

const suppliers = ["ali aliyev", "Otash", "Sarvar", "name of supply", "qarzdorman", "SaidQosimov", "PAM", "Salohiddin Pastavshik 1"]
const warehouses = ["sklad 11", "Яндекс Лавка", "toshkent", "Andijon skladi", "Said Qosimov", "11111", "Salohiddin Farg'ona Sklad"]
const branches = ["777", "878", "agent", "Andijon", "Buxoro"]
const organizations = ["ТестоваяОрганизация", "Linko Distribution"]
const priceLists = ["donalik", "11111", "savdo", "Bozor narx"]
const paymentTypes = ["банковский счет", "наличный"]
const products = ["energetik 1 l", "coca-cola", "lipton", "sprayt", "baby still", "g'ilof"]

const knownRows: Omit<SupplierReturn, "organization" | "currency" | "paymentType" | "priceList" | "branch" | "transferTime" | "reason" | "items">[] = [
  { id: 22, fromWhom: "ali aliyev", warehouse: "sklad 11", addedBy: "Admin Ritm", date: "29 дек. 2025", time: "17:09", amount: 18000, status: "завершен" },
  { id: 19, fromWhom: "ali aliyev", warehouse: "Яндекс Лавка", addedBy: "Admin Ritm", date: "10 дек. 2025", time: "13:41", amount: 0, status: "завершен" },
  { id: 18, fromWhom: "Otash", warehouse: "toshkent", addedBy: "Admin Ritm", date: "06 нояб. 2025", time: "14:53", amount: 0, status: "завершен" },
  { id: 17, fromWhom: "Sarvar", warehouse: "toshkent", addedBy: "Admin Ritm", date: "27 сент. 2025", time: "12:18", amount: 750, status: "завершен" },
  { id: 16, fromWhom: "name of supply", warehouse: "toshkent", addedBy: "Admin Ritm", date: "22 сент. 2025", time: "13:09", amount: 500000, status: "завершен" },
  { id: 13, fromWhom: "qarzdorman", warehouse: "toshkent", addedBy: "Admin Ritm", date: "03 сент. 2025", time: "15:44", amount: 632500, status: "завершен" },
  { id: 11, fromWhom: "SaidQosimov", warehouse: "Andijon skladi", addedBy: "Admin Ritm", date: "25 июля 2025", time: "16:10", amount: 10000, status: "завершен" },
  { id: 10, fromWhom: "SaidQosimov", warehouse: "Said Qosimov", addedBy: "Admin Ritm", date: "25 июля 2025", time: "15:43", amount: 110000, status: "завершен" },
  { id: 9, fromWhom: "PAM", warehouse: "11111", addedBy: "Admin Ritm", date: "28 июня 2025", time: "12:18", amount: 1107983877, status: "завершен" },
  { id: 8, fromWhom: "Salohiddin Pastavshik 1", warehouse: "Salohiddin Farg'ona Sklad", addedBy: "Admin Ritm", date: "23 июня 2025", time: "09:46", amount: 210000, status: "завершен" },
]

function seededItems(id: number, amount: number): ReturnItem[] {
  if (id === 19) return [{ id: 1, product: "energetik 1 l", qty: 60, series: "2025-12-11", price: 0, total: 0 }]
  const product = products[id % products.length]
  const qty = 1 + (id % 40)
  const price = qty ? Math.round(amount / qty) : 0
  return [{ id: 1, product, qty, series: "2025-11-01", price, total: amount }]
}

function generateRows(): SupplierReturn[] {
  const rows: SupplierReturn[] = knownRows.map((row) => ({
    ...row,
    organization: "ТестоваяОрганизация",
    currency: "SUM",
    paymentType: "банковский счет",
    priceList: "donalik",
    branch: "777",
    transferTime: `${row.date}, ${row.time}`,
    reason: "",
    items: seededItems(row.id, row.amount),
  }))

  const extras: [number, string, string, string, number, Status][] = [
    [7, "ali aliyev", "sklad 11", "20 июня 2025", 15000, "завершен"],
    [6, "Sarvar", "toshkent", "14 июня 2025", 320000, "в процессе"],
    [4, "Otash", "Andijon skladi", "02 июня 2025", 8500, "завершен"],
    [3, "qarzdorman", "toshkent", "28 мая 2025", 45000, "в процессе"],
    [1, "PAM", "11111", "19 мая 2025", 92000, "завершен"],
  ]

  for (const [id, fromWhom, warehouse, date, amount, status] of extras) {
    rows.push({
      id,
      fromWhom,
      warehouse,
      addedBy: "Admin Ritm",
      date,
      time: `${String(9 + (id % 8)).padStart(2, "0")}:${String((id * 11) % 60).padStart(2, "0")}`,
      amount,
      status,
      organization: "ТестоваяОрганизация",
      currency: "SUM",
      paymentType: "банковский счет",
      priceList: "donalik",
      branch: "777",
      transferTime: `${date}, ${String(9 + (id % 8)).padStart(2, "0")}:${String((id * 11) % 60).padStart(2, "0")}`,
      reason: "",
      items: seededItems(id, amount),
    })
  }

  return rows.sort((a, b) => b.id - a.id)
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

const statusIcon: Record<Status, ReactElement> = {
  завершен: <CheckCheck className="h-5 w-5 text-emerald-500" />,
  "в процессе": <Clock className="h-5 w-5 text-amber-500" />,
  отменен: <XCircle className="h-5 w-5 text-rose-500" />,
}

type DraftItem = { id: number; product: string; qty: number; series: string; price: number }

function emptyDraft() {
  return {
    supplier: "",
    warehouse: "",
    organization: "",
    branch: "",
    currency: "",
    priceList: "",
    paymentType: "",
    date: formatToday(),
    comment: "",
  }
}

function formatToday() {
  const date = new Date()
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
}

export function SupplierReturnsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<SupplierReturn[]>(generateRows)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [filterActive, setFilterActive] = useState(true)
  const [filterEditorOpen, setFilterEditorOpen] = useState(false)
  const [includedStatuses, setIncludedStatuses] = useState<Status[]>(["завершен", "в процессе"])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.fromWhom.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (filterActive && !includedStatuses.includes(row.status)) return false
      return true
    })
  }, [rows, query, filterActive, includedStatuses])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: SupplierReturn) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function toggleStatus(status: Status) {
    setIncludedStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]))
  }

  function openCreate() {
    setDraft(emptyDraft())
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: SupplierReturn) {
    setDraft({
      supplier: row.fromWhom,
      warehouse: row.warehouse,
      organization: row.organization,
      branch: row.branch,
      currency: row.currency,
      priceList: row.priceList,
      paymentType: row.paymentType,
      date: row.date,
      comment: row.reason,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, series: item.series, price: item.price })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  function removeRow(row: SupplierReturn) {
    if (!window.confirm(`Удалить возврат № ${row.id}?`)) return
    setRows((current) => current.filter((item) => item.id !== row.id))
    if (expandedId === row.id) setExpandedId(null)
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: products[0], qty: 1, series: "", price: 0 }])
  }

  function addFromList(product: string) {
    setDraftItems((current) => {
      if (current.some((item) => item.product === product)) return current
      return [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product, qty: 1, series: "", price: 0 }]
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
        const [product, qtyRaw, , priceRaw] = cells
        if (!product || /^(товар|product|наименование)$/i.test(product)) continue
        parsed.push({ id: nextId++, product, qty: Number(qtyRaw) || 1, series: "", price: Number(priceRaw) || 0 })
      }
      if (parsed.length) setDraftItems((current) => [...current, ...parsed])
    }
    reader.readAsText(file)
    event.target.value = ""
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.price, 0)
  const draftTotalQty = draftItems.reduce((sum, item) => sum + item.qty, 0)

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.supplier || !draftItems.length) return
    const items: ReturnItem[] = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      qty: item.qty,
      series: item.series,
      price: item.price,
      total: item.qty * item.price,
    }))
    if (editingId !== null) {
      setRows((current) =>
        current.map((row) =>
          row.id === editingId
            ? {
                ...row,
                fromWhom: draft.supplier,
                warehouse: draft.warehouse,
                organization: draft.organization,
                branch: draft.branch,
                currency: draft.currency,
                priceList: draft.priceList,
                paymentType: draft.paymentType,
                date: draft.date,
                reason: draft.comment,
                amount: draftTotalCost,
                items,
              }
            : row,
        ),
      )
    } else {
      const id = Math.max(0, ...rows.map((row) => row.id)) + 1
      const now = new Date().toTimeString().slice(0, 5)
      const newRow: SupplierReturn = {
        id,
        fromWhom: draft.supplier,
        warehouse: draft.warehouse,
        addedBy: "Admin Ritm",
        date: draft.date,
        time: now,
        amount: draftTotalCost,
        status: "в процессе",
        organization: draft.organization,
        currency: draft.currency,
        paymentType: draft.paymentType,
        priceList: draft.priceList,
        branch: draft.branch,
        transferTime: `${draft.date}, ${now}`,
        reason: draft.comment,
        items,
      }
      setRows((current) => [newRow, ...current])
    }
    setModalOpen(false)
  }

  function downloadList() {
    downloadExcelTable("vozvrat-postavshikam", [
      ["№", "От кого", "Склад", "Добавил", "Дата возврата", "Сумма возврата", "Статус"],
      ...filtered.map((row) => [row.id, row.fromWhom, row.warehouse, row.addedBy, `${row.date}, ${row.time}`, row.amount, row.status]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Возврат поставщиков
          </h1>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> Добавить
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          {filterActive ? (
            <div className="flex items-center gap-2 text-slate-600">
              <span>Фильтр: {includedStatuses.length} элемента</span>
              <button type="button" onClick={() => setFilterEditorOpen(true)} aria-label="Изменить фильтр" className="text-slate-400 hover:text-[#4f70e7]">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setFilterActive(false)} aria-label="Очистить фильтр" className="text-slate-400 hover:text-rose-500">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setFilterActive(true); setFilterEditorOpen(true) }} className="text-[#4f70e7] hover:underline">
              Показать фильтр
            </button>
          )}

          <label className="relative ml-2 w-64">
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
          <ListChecks className="h-5 w-5 text-slate-400" />
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
              <th className="px-5 py-5">От кого</th>
              <th className="px-5 py-5">Склад</th>
              <th className="px-5 py-5">Добавил</th>
              <th className="px-5 py-5">Дата возврата</th>
              <th className="px-5 py-5">Сумма возврата</th>
              <th className="px-5 py-5">Статус</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{row.fromWhom}</td>
                  <td className="px-5 py-4">{row.warehouse}</td>
                  <td className="px-5 py-4">{row.addedBy}</td>
                  <td className="px-5 py-4">{row.date}, {row.time}</td>
                  <td className="px-5 py-4">{formatMoney(row.amount)}</td>
                  <td className="px-5 py-4">{statusIcon[row.status]}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={7} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">Возврат поставщику №{row.id}</h2>
                          <div className="flex items-center gap-4 text-slate-500">
                            <button type="button" onClick={() => window.print()} aria-label="Печать" className="hover:text-[#4f70e7]">
                              <Printer className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => openEdit(row)} aria-label="Изменить" className="hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => removeRow(row)} aria-label="Удалить" className="hover:text-rose-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Добавил:</dt><dd className="font-medium">{row.addedBy}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Поставщик:</dt><dd className="font-medium">{row.fromWhom}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Организация:</dt><dd className="font-medium">{row.organization}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Валюта:</dt><dd className="font-medium">{row.currency}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Тип оплаты:</dt><dd className="font-medium">{row.paymentType}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Прайс лист:</dt><dd className="font-medium">{row.priceList}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата возврата:</dt><dd className="font-medium">{row.date}, {row.time}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Филиал:</dt><dd className="font-medium">{row.branch}</dd></div>
                            </dl>

                            <p className="mb-2 mt-5 font-bold uppercase tracking-wide text-slate-700">Склад</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Склад:</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Время передачи:</dt><dd className="font-medium">{row.transferTime}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Передал:</dt><dd className="font-medium">{row.addedBy}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Статус:</dt><dd className="font-medium text-emerald-500">{row.status === "завершен" ? "Завершен" : row.status === "в процессе" ? "В процессе" : "Отменен"}</dd></div>
                            </dl>

                            <p className="mb-1 mt-5 font-bold uppercase tracking-wide text-slate-700">Причина возврата:</p>
                            <p className="text-sm text-slate-500">{row.reason || " "}</p>
                          </div>

                          <div>
                            <div className="mb-3 border-b border-slate-200">
                              <span className="inline-block border-b-2 border-[#4f70e7] pb-2 text-sm font-medium text-[#4f70e7]">Список товаров</span>
                            </div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">№</th>
                                  <th className="py-2 pr-4">Товар</th>
                                  <th className="py-2 pr-4">Количество</th>
                                  <th className="py-2 pr-4">Серия</th>
                                  <th className="py-2 pr-4">Цена (SUM)</th>
                                  <th className="py-2 pr-4">Сумма (SUM)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item) => (
                                  <tr key={item.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{item.id}</td>
                                    <td className="py-2 pr-4">{item.product}</td>
                                    <td className="py-2 pr-4">{item.qty}</td>
                                    <td className="py-2 pr-4">{item.series || "—"}</td>
                                    <td className="py-2 pr-4">{item.price.toLocaleString("ru-RU")}</td>
                                    <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")}</td>
                                  </tr>
                                ))}
                                <tr className="border-t border-slate-300 font-bold">
                                  <td className="py-2 pr-4" colSpan={2}>Итого:</td>
                                  <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.qty, 0)}</td>
                                  <td className="py-2 pr-4" />
                                  <td className="py-2 pr-4" />
                                  <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.total, 0).toLocaleString("ru-RU")}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
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
            <FileSpreadsheet className="h-14 w-14 text-slate-300" />
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {filterEditorOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-xs rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">Фильтр по статусу</b>
              <button type="button" onClick={() => setFilterEditorOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2 text-sm">
              {(["завершен", "в процессе", "отменен"] as Status[]).map((status) => (
                <label key={status} className="flex items-center gap-2">
                  <input type="checkbox" checked={includedStatuses.includes(status)} onChange={() => toggleStatus(status)} />
                  {status}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setFilterEditorOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">Применить</button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `Изменить возврат №${editingId}` : "Возврат поставщика"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-8 sm:grid-cols-[1fr_1.4fr]">
                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Поставщик *
                    <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {suppliers.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Склад назначения *
                    <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {warehouses.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Организация *
                    <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {organizations.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Филиал *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {branches.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Валюта *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      <option>SUM</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Прайс лист *
                    <select value={draft.priceList} onChange={(event) => setDraft((value) => ({ ...value, priceList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {priceLists.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Тип оплаты *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">Выберите...</option>
                      {paymentTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Дата создания *
                    <input value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block font-medium">
                    Оставить комментарий...
                    <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={2} className="mt-2 block w-full resize-none border-b border-slate-200 outline-none" />
                  </label>
                </div>

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-slate-800">Список товаров</p>
                    {draft.supplier && (
                      <div className="flex items-center gap-4 text-sm">
                        <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <Plus className="h-4 w-4" /> добавить товар
                        </button>
                        <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <ListPlus className="h-4 w-4" /> добавить из списка
                        </button>
                        <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-[#4f70e7] hover:bg-slate-200">
                          <Upload className="h-4 w-4" /> импортировать с excel
                        </button>
                        <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
                      </div>
                    )}
                  </div>

                  {!draft.supplier ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
                      <FileSpreadsheet className="h-12 w-12" />
                      <p>Для добавления товаров выберите клиента.</p>
                    </div>
                  ) : draftItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
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
                          <th className="py-2 pr-4">Кол-во</th>
                          <th className="py-2 pr-4">Серия</th>
                          <th className="py-2 pr-4">Цена</th>
                          <th className="py-2 pr-4">Сумма</th>
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
                              <input type="number" min={0} value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-16 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input value={item.series} onChange={(event) => updateDraftItem(item.id, { series: event.target.value })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} value={item.price} onChange={(event) => updateDraftItem(item.id, { price: Number(event.target.value) })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">{(item.qty * item.price).toLocaleString("ru-RU")}</td>
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
            </div>

            <footer className="flex items-center justify-between border-t p-5">
              <div className="text-sm text-slate-600">
                Общая стоимость: <b>{draftTotalCost.toLocaleString("ru-RU")}</b> &nbsp; Общее кол-во: <b>{draftTotalQty} ед</b>
              </div>
              <button type="submit" className="font-bold uppercase text-sky-500">
                Оформить
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
