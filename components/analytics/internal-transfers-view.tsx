"use client"

import { ChangeEvent, Fragment, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  ListChecks,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react"

type Status = "принят" | "потвержден" | "отменен"

type Item = { id: number; product: string; quantity: number; weight: number; price: number }

type Transfer = {
  id: number
  fromWarehouse: string
  toWarehouse: string
  createdBy: string
  createdAt: string
  deliveredAt: string
  amount: number
  weight: number
  status: Status
  priceList: string
  organization: string
  invoiceNumber: string
  transportNumber: string
  driver: string
  comment: string
  items: Item[]
}

const warehouses = ["toshkent", "Manufacturing1", "Яндекс Лавка", "Suhrob sklad", "Toshkent sut ombori", "Центральный склад", "Чиланзарский склад", "123 test"]

const initialTransfers: Transfer[] = [
  { id: 59, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "16 янв. 2026", deliveredAt: "16 янв. 2026", amount: 1200000, weight: 0, status: "принят", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "robot moshina", quantity: 12, weight: 0, price: 100000 }] },
  { id: 58, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "09 янв. 2026", deliveredAt: "16 янв. 2026", amount: 78000, weight: 0, status: "принят", priceList: "878", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "g'ilof", quantity: 78, weight: 0, price: 1000 }] },
  { id: 57, fromWarehouse: "toshkent", toWarehouse: "Яндекс Лавка", createdBy: "Admin Ritm", createdAt: "07 янв. 2026", deliveredAt: "07 янв. 2026", amount: 0, weight: 0, status: "принят", priceList: "savdo", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [] },
  { id: 56, fromWarehouse: "toshkent", toWarehouse: "Яндекс Лавка", createdBy: "Admin Ritm", createdAt: "07 янв. 2026", deliveredAt: "07 янв. 2026", amount: 0, weight: 0, status: "потвержден", priceList: "donalik", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "avto 1.3 mator", quantity: 500, weight: 0, price: 0 }] },
  { id: 55, fromWarehouse: "Suhrob sklad", toWarehouse: "toshkent", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 60000, weight: 0, status: "потвержден", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 60, weight: 0, price: 1000 }] },
  { id: 54, fromWarehouse: "Suhrob sklad", toWarehouse: "toshkent", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 60000, weight: 0, status: "потвержден", priceList: "11111", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 60, weight: 0, price: 1000 }] },
  { id: 53, fromWarehouse: "toshkent", toWarehouse: "Manufacturing1", createdBy: "Admin Ritm", createdAt: "30 дек. 2025", deliveredAt: "30 дек. 2025", amount: 720000, weight: 0, status: "потвержден", priceList: "tovar", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "robot moshina", quantity: 72, weight: 0, price: 10000 }] },
  { id: 52, fromWarehouse: "Suhrob sklad", toWarehouse: "Toshkent sut ombori", createdBy: "Admin Ritm", createdAt: "20 дек. 2025", deliveredAt: "20 дек. 2025", amount: 1500000, weight: 0, status: "потвержден", priceList: "Bozor narx", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "energetik 1 l", quantity: 150, weight: 0, price: 10000 }] },
  { id: 51, fromWarehouse: "Центральный склад", toWarehouse: "Чиланзарский склад", createdBy: "Admin Ritm", createdAt: "10 дек. 2025", deliveredAt: "10 дек. 2025", amount: 45000, weight: 0, status: "принят", priceList: "Шт14", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "g'ilof", quantity: 45, weight: 0, price: 1000 }] },
  { id: 50, fromWarehouse: "toshkent", toWarehouse: "123 test", createdBy: "Admin Ritm", createdAt: "09 дек. 2025", deliveredAt: "17 дек. 2025", amount: 168000, weight: 0, status: "потвержден", priceList: "123123123", organization: "", invoiceNumber: "", transportNumber: "", driver: "", comment: "", items: [{ id: 1, product: "sndwch", quantity: 168, weight: 0, price: 1000 }] },
]

const generatedTransfers: Transfer[] = Array.from({ length: 36 }, (_, index) => {
  const id = 49 - index
  const from = warehouses[id % warehouses.length]
  const to = warehouses[(id + 3) % warehouses.length]
  const amount = (id * 3721) % 500000
  const status: Status = id % 4 === 0 ? "отменен" : id % 2 === 0 ? "принят" : "потвержден"
  const day = 1 + (id % 28)
  const month = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."][id % 12]
  const year = id > 20 ? 2025 : 2024
  return {
    id,
    fromWarehouse: from,
    toWarehouse: to,
    createdBy: "Admin Ritm",
    createdAt: `${String(day).padStart(2, "0")} ${month} ${year}`,
    deliveredAt: `${String(day).padStart(2, "0")} ${month} ${year}`,
    amount,
    weight: 0,
    status,
    priceList: "11111",
    organization: "",
    invoiceNumber: "",
    transportNumber: "",
    driver: "",
    comment: "",
    items: [{ id: 1, product: "sndwch", quantity: Math.max(1, Math.round(amount / 1000)), weight: 0, price: 1000 }],
  }
})

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
const favoriteItems = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

function statusColor(status: Status) {
  if (status === "принят") return "#39ca79"
  if (status === "потвержден") return "#4f8ff0"
  return "#e5484d"
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function InternalTransfersView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [transfers, setTransfers] = useState([...initialTransfers, ...generatedTransfers])
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [fromFilter, setFromFilter] = useState("Все склады")
  const [toFilter, setToFilter] = useState("Все склады")
  const [showCancelled, setShowCancelled] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<"items" | "logs">("items")
  const [formOpen, setFormOpen] = useState<{ mode: "add" | "edit"; transfer: Transfer | null } | null>(null)

  const filtered = useMemo(() => {
    return transfers.filter((transfer) => {
      if (!showCancelled && transfer.status === "отменен") return false
      if (search.trim() && !String(transfer.id).includes(search.trim()) && !transfer.fromWarehouse.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")) && !transfer.toWarehouse.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (fromFilter !== "Все склады" && transfer.fromWarehouse !== fromFilter) return false
      if (toFilter !== "Все склады" && transfer.toWarehouse !== toFilter) return false
      return true
    })
  }, [fromFilter, search, showCancelled, toFilter, transfers])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const deleteTransfer = (id: number) => {
    setTransfers((current) => current.filter((transfer) => transfer.id !== id))
    setExpandedId(null)
  }

  const saveTransfer = (data: Transfer) => {
    setTransfers((current) => {
      const exists = data.id !== 0 && current.some((transfer) => transfer.id === data.id)
      if (exists) return current.map((transfer) => (transfer.id === data.id ? data : transfer))
      const nextId = Math.max(0, ...current.map((transfer) => transfer.id)) + 1
      return [{ ...data, id: nextId }, ...current]
    })
    setFormOpen(null)
  }

  const downloadAll = () => {
    const header = ["№", "Со склада", "На склад", "Создал", "Дата создания", "Дата доставки", "Сумма", "Статус"]
    const body = filtered.map((transfer) => [transfer.id, transfer.fromWarehouse, transfer.toWarehouse, transfer.createdBy, transfer.createdAt, transfer.deliveredAt, number(transfer.amount), transfer.status])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "internal-transfers.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e1e5eb] px-6 py-5 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Передачи между складами</span>
        </button>
        <button onClick={() => setFormOpen({ mode: "add", transfer: null })} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white">
          <Plus className="h-5 w-5" /> Добавить
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          <Filter className="h-4 w-4" /> Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>

        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>

        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>

        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronRight className="h-5 w-5" />
        </button>
        <ListChecks className="h-5 w-5 text-[#586174]" />
        <button onClick={downloadAll} aria-label="Скачать"><Download className="h-5 w-5 text-[#586174]" /></button>
      </section>

      {filterOpen && (
        <section className="border-b border-[#e1e5eb] px-6 py-6 md:px-9">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg text-[#586174]">Фильтр</h2>
            <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
          </div>
          <div className="grid max-w-md gap-8">
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              Со склада
              <select value={fromFilter} onChange={(event) => { setFromFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {["Все склады", ...warehouses].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              На склад
              <select value={toFilter} onChange={(event) => { setToFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {["Все склады", ...warehouses].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="flex items-center gap-3 text-[15px] font-medium">
              <input type="checkbox" checked={showCancelled} onChange={(event) => { setShowCancelled(event.target.checked); setPage(1) }} className="h-[18px] w-[18px] accent-[#4f71dc]" />
              Показать отмененные передачи
            </label>
          </div>
          <button onClick={() => setFilterOpen(false)} className="mt-6 rounded-sm bg-[#586174] px-6 py-3 font-bold uppercase tracking-wide text-white">Применить</button>
        </section>
      )}

      <section className="overflow-x-auto">
        <table className="min-w-[1300px] w-full border-collapse text-[15px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-4 py-4 text-left font-semibold">№</th>
              <th className="px-4 py-4 text-left font-semibold">Со склада</th>
              <th className="px-4 py-4 text-left font-semibold">На склад</th>
              <th className="px-4 py-4 text-left font-semibold">Создал</th>
              <th className="px-4 py-4 text-left font-semibold">Дата создания</th>
              <th className="px-4 py-4 text-left font-semibold">Дата доставки</th>
              <th className="px-4 py-4 text-left font-semibold">Сумма</th>
              <th className="px-4 py-4 text-left font-semibold">Статус</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((transfer, index) => (
              <Fragment key={transfer.id}>
                <tr
                  onClick={() => { setExpandedId((current) => (current === transfer.id ? null : transfer.id)); setDetailTab("items") }}
                  className={`cursor-pointer border-b border-dashed border-slate-200 hover:bg-[#eef2fb] ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}
                >
                  <td className="px-4 py-4">{transfer.id}</td>
                  <td className="px-4 py-4 text-[#4f70e7]">{transfer.fromWarehouse}</td>
                  <td className="px-4 py-4 text-[#4f70e7]">{transfer.toWarehouse}</td>
                  <td className="px-4 py-4">{transfer.createdBy}</td>
                  <td className="px-4 py-4">{transfer.createdAt}</td>
                  <td className="px-4 py-4">{transfer.deliveredAt}</td>
                  <td className="px-4 py-4">
                    <div>{number(transfer.amount)}</div>
                    <div className="text-[#4f70e7]">{number(transfer.weight)} кг</div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor(transfer.status) }} /> {transfer.status}
                    </span>
                  </td>
                </tr>
                {expandedId === transfer.id && (
                  <tr key={`${transfer.id}-detail`}>
                    <td colSpan={8} className="bg-white p-0">
                      <TransferDetail
                        transfer={transfer}
                        tab={detailTab}
                        onTabChange={setDetailTab}
                        onEdit={() => setFormOpen({ mode: "edit", transfer })}
                        onDelete={() => deleteTransfer(transfer.id)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {favoritesOpen && (
        <div className="fixed inset-0 z-[100] flex">
          <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)} className="flex-1 bg-black/40" />
          <aside className="w-[420px] max-w-[90vw] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">Избранные</h2>
              <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)}><X className="h-6 w-6 text-slate-600" /></button>
            </header>
            {favoriteItems.map((item, index) => (
              <button
                key={`${item}-${index}`}
                type="button"
                onClick={() => { setFavorite(true); setFavoritesOpen(false) }}
                className="flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg"
              >
                {item} <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </aside>
        </div>
      )}

      {formOpen && (
        <TransferFormModal
          mode={formOpen.mode}
          transfer={formOpen.transfer}
          onClose={() => setFormOpen(null)}
          onSave={saveTransfer}
        />
      )}
    </main>
  )
}

function TransferDetail({
  transfer,
  tab,
  onTabChange,
  onEdit,
  onDelete,
}: {
  transfer: Transfer
  tab: "items" | "logs"
  onTabChange: (tab: "items" | "logs") => void
  onEdit: () => void
  onDelete: () => void
}) {
  const totalQuantity = transfer.items.reduce((sum, item) => sum + item.quantity, 0)
  const totalWeight = transfer.items.reduce((sum, item) => sum + item.weight, 0)
  const totalSum = transfer.items.reduce((sum, item) => sum + item.quantity * item.price, 0)

  return (
    <div onClick={(event) => event.stopPropagation()} className="border-y border-[#e1e5eb] bg-white px-9 py-7 shadow-inner">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-xl font-semibold">Передача № {transfer.id}</h3>
        <div className="flex items-center gap-5 text-[#586174]">
          <Clock className="h-5 w-5" />
          <ListChecks className="h-5 w-5 text-[#4f70e7]" />
          <RefreshCw className="h-5 w-5" />
          <Download className="h-5 w-5" />
          <Printer className="h-5 w-5" />
          <button onClick={onEdit} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"><Pencil className="h-4 w-4" /> Изменить</button>
          <button onClick={onDelete} className="flex items-center gap-2 rounded-md bg-[#f28b82] px-4 py-2 font-semibold text-white"><Trash2 className="h-4 w-4" /> Удалить</button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-3">
        <dl className="space-y-3 text-[15px]">
          <Row label="Со склада:" value={transfer.fromWarehouse} />
          <Row label="На склад:" value={transfer.toWarehouse} />
          <Row label="Прайс лист:" value={transfer.priceList || "Не указано"} />
          <Row label="Организация:" value={transfer.organization || "Не указано"} />
        </dl>
        <dl className="space-y-3 text-[15px]">
          <Row label="Номер накладной:" value={transfer.invoiceNumber || "Не указано"} />
          <Row label="Номер транспорта:" value={transfer.transportNumber || "Не указано"} />
          <Row label="Водитель:" value={transfer.driver || "Не указано"} />
        </dl>
        <dl className="space-y-3 text-[15px]">
          <Row label="Статус:" value={transfer.status === "принят" ? "Принят" : transfer.status === "потвержден" ? "Потвержден" : "Отменен"} valueClass="text-[#4f70e7]" />
          <Row label="Дата доставки:" value={transfer.deliveredAt} />
          <Row label="Дата создания:" value={transfer.createdAt} />
          <Row label="Дата приемки:" value="Не указано" />
          <Row label="Дата передачи:" value="Не указано" />
          <Row label="Комментарий:" value={transfer.comment || "Комментарий отсутствует"} />
        </dl>
      </div>

      <div className="mb-4 flex gap-8 border-b border-[#e1e5eb]">
        <button onClick={() => onTabChange("items")} className={`border-b-2 pb-3 font-medium ${tab === "items" ? "border-[#4f70e7] text-[#17233b]" : "border-transparent text-[#9aa3b6]"}`}>Товары</button>
        <button onClick={() => onTabChange("logs")} className={`border-b-2 pb-3 font-medium ${tab === "logs" ? "border-[#4f70e7] text-[#17233b]" : "border-transparent text-[#9aa3b6]"}`}>Логи</button>
      </div>

      {tab === "items" ? (
        <table className="w-full border-collapse text-[15px]">
          <thead className="bg-[#f2f5f8] text-[#586174]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Товар</th>
              <th className="px-4 py-3 text-left font-medium">Количество</th>
              <th className="px-4 py-3 text-left font-medium">Вес</th>
              <th className="px-4 py-3 text-left font-medium">Цена</th>
              <th className="px-4 py-3 text-left font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item) => (
              <tr key={item.id} className="border-t border-dashed border-slate-200">
                <td className="px-4 py-3">{item.product}</td>
                <td className="px-4 py-3">{number(item.quantity)} шт</td>
                <td className="px-4 py-3">{number(item.weight)}</td>
                <td className="px-4 py-3">{number(item.price)} SUM</td>
                <td className="px-4 py-3">{number(item.quantity * item.price)} SUM</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 font-semibold">
              <td className="px-4 py-3">Итого</td>
              <td className="px-4 py-3">{number(totalQuantity)}</td>
              <td className="px-4 py-3">{number(totalWeight)} кг</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3">{number(totalSum)} SUM</td>
            </tr>
            {transfer.items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[#9aa3b6]">Товары не добавлены</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="space-y-3 text-[15px] text-[#586174]">
          <p>{transfer.createdAt} — передача создана пользователем {transfer.createdBy}</p>
          <p>{transfer.deliveredAt} — статус изменён на «{transfer.status}»</p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-[#586174]">{label}</dt>
      <dd className={`text-right font-medium ${valueClass}`}>{value}</dd>
    </div>
  )
}

function TransferFormModal({
  mode,
  transfer,
  onClose,
  onSave,
}: {
  mode: "add" | "edit"
  transfer: Transfer | null
  onClose: () => void
  onSave: (transfer: Transfer) => void
}) {
  const [fromWarehouse, setFromWarehouse] = useState(transfer?.fromWarehouse ?? "")
  const [toWarehouse, setToWarehouse] = useState(transfer?.toWarehouse ?? "")
  const [deliveredAt, setDeliveredAt] = useState(todayISO())
  const [createdAt, setCreatedAt] = useState(todayISO())
  const [priceList, setPriceList] = useState(transfer?.priceList ?? "")
  const [currency, setCurrency] = useState("SUM")
  const [organization, setOrganization] = useState(transfer?.organization ?? "")
  const [invoiceNumber, setInvoiceNumber] = useState(transfer?.invoiceNumber ?? "")
  const [transportNumber, setTransportNumber] = useState(transfer?.transportNumber ?? "")
  const [driver, setDriver] = useState(transfer?.driver ?? "")
  const [items, setItems] = useState<Item[]>(transfer?.items.length ? transfer.items : [])
  const [touched, setTouched] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const totalSum = items.reduce((sum, item) => sum + item.quantity * item.price, 0)

  const addFromList = () => {
    setItems((current) => [...current, { id: (current.at(-1)?.id ?? 0) + 1, product: "", quantity: 0, weight: 0, price: 0 }])
  }
  const importFromExcel = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const lines = String(reader.result ?? "").split(/\r?\n/).filter(Boolean)
      const parsed = lines
        .map((line) => line.split(/[;,\t]/).map((cell) => cell.trim()))
        .filter(([product]) => product && !/^(наименование|товар|product)$/i.test(product))
        .map(([product, quantity, price], index) => ({
          id: Date.now() + index,
          product,
          quantity: Number(quantity) || 0,
          weight: 0,
          price: Number(price) || 0,
        }))
      if (parsed.length) setItems((current) => [...current, ...parsed])
    }
    reader.readAsText(file)
  }
  const updateItem = (id: number, patch: Partial<Item>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }
  const removeItem = (id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  const submit = () => {
    setTouched(true)
    if (!fromWarehouse || !toWarehouse) return
    onSave({
      id: transfer?.id ?? 0,
      fromWarehouse,
      toWarehouse,
      createdBy: transfer?.createdBy ?? "Admin Ritm",
      createdAt,
      deliveredAt,
      amount: totalSum,
      weight: 0,
      status: transfer?.status ?? "потвержден",
      priceList,
      organization,
      invoiceNumber,
      transportNumber,
      driver,
      comment: transfer?.comment ?? "",
      items,
    })
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-white">
      <header className="flex items-center justify-between border-b px-9 py-6">
        <h2 className="text-lg font-bold uppercase tracking-wide">{mode === "add" ? "Добавить передачу товаров" : "Изменить передачу товаров"}</h2>
        <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[380px_1fr]">
        <div className="space-y-7 border-b px-9 py-8 md:border-b-0 md:border-r">
          <h3 className="font-medium text-[#586174]">Условия передачи товара</h3>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Со склада <span className="text-red-500">*</span>
            <select value={fromWarehouse} onChange={(event) => setFromWarehouse(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {warehouses.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            {touched && !fromWarehouse && <p className="mt-1 text-sm text-[#e5484d]">Склад не выбран</p>}
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            На склад <span className="text-red-500">*</span>
            <select value={toWarehouse} onChange={(event) => setToWarehouse(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {warehouses.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            {touched && !toWarehouse && <p className="mt-1 text-sm text-[#e5484d]">Склад не выбран</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Дата доставки <span className="text-red-500">*</span>
            <input type="date" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Дата создания <span className="text-red-500">*</span>
            <input type="date" value={createdAt} onChange={(event) => setCreatedAt(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Прайс лист <span className="text-red-500">*</span>
            <input value={priceList} onChange={(event) => setPriceList(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option>SUM</option><option>USD</option><option>Euro</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Организация
            <input value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Номер накладной
            <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Номер транспорта
            <input value={transportNumber} onChange={(event) => setTransportNumber(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Водитель
            <input value={driver} onChange={(event) => setDriver(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
        </div>

        <div className="px-9 py-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-medium text-[#586174]">Список товаров</h3>
            <div className="flex items-center gap-6">
              <button onClick={addFromList} className="text-sm font-semibold uppercase tracking-wide text-[#586174]">Добавить из списка</button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={importFromExcel} className="hidden" />
              <button type="button" onClick={() => importInputRef.current?.click()} className="flex items-center gap-2 rounded-md bg-[#69cd87] px-4 py-2 text-sm font-semibold text-white"><Upload className="h-4 w-4" /> Импортировать с Excel</button>
            </div>
          </div>
          <div className="rounded bg-[#f2f5f8]">
            <div className="grid grid-cols-[1fr_140px_140px_60px] items-center gap-6 px-4 py-3 text-sm font-medium text-[#586174]">
              <span>Наименование</span><span>Кол-во</span><span>Цена</span><span />
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_140px_140px_60px] items-center gap-6 border-t border-white px-4 py-3">
                <input value={item.product} onChange={(event) => updateItem(item.id, { product: event.target.value })} placeholder="Наименование" className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none" />
                <input type="number" value={item.quantity || ""} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none" />
                <input type="number" value={item.price || ""} onChange={(event) => updateItem(item.id, { price: Number(event.target.value) })} className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none" />
                <button aria-label="Удалить товар" onClick={() => removeItem(item.id)} className="text-[#9aa3b6] hover:text-[#e5484d]"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {items.length === 0 && <p className="px-4 py-6 text-sm text-[#9aa3b6]">Список товаров пуст</p>}
          </div>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t px-9 py-5">
        <div className="flex items-center gap-6 text-[15px]">
          <span className="text-[#586174]">Сумма: <b className="text-[#17233b]">{number(totalSum)}</b></span>
          <span className="text-[#586174]">Общее кол-во: <b className="text-[#4f70e7]">{number(totalQuantity)} ед</b></span>
        </div>
        <button onClick={submit} className="font-bold uppercase tracking-wide text-[#4f70e7]">Добавить</button>
      </footer>
    </div>
  )
}
