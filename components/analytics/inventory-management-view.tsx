"use client"

import { Fragment, useMemo, useState } from "react"
import Image from "next/image"
import { downloadExcelTable } from "@/lib/excel-export"
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Filter,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"

type InventoryItem = {
  id: number
  serialNumber: string
  client: string
  inventoryType: string
  inventoryCode: string
  warehouse: string
  condition: string
  responsible: string
  attachDate: string
  createdDate: string
  checkDate: string
  approved: boolean
}

type MovementLog = {
  id: number
  direction: "in" | "out"
  inventoryType: string
  inventoryCode: string
  createdAt: string
  movementDate: string
  client: string
  warehouse: string
  condition: string
  type: "Новый" | "Изъятие" | "Передача"
}

type CheckLog = {
  id: number
  client: string
  createdBy: string
  checkDate: string
  inventoryType: string
  inventoryCode: string
}

type RequestRow = {
  id: number
  type: string
  client: string
  inventoryType: string
  inventory: string
  requestedBy: string
  requestDate: string
  processedBy: string
  processedDate: string
  status: "В процессе" | "Подтверждено" | "Отклонено"
}

const conditions = ["Новый", "Хороший", "Средний"]
const responsibles = ["Admin Ritm", "Тп 2 Алиса", "Тп 1 Исмоилов Гани"]
const warehousesList = ["05,08,2025(1)", "toshkent", "Бухоро склад", "Яндекс Лавка", "ОЧАКОВО", "sklad tayoriga", "Suhrob sklad"]
const productTypes = ["g'ilof", "coca-cola", "Холодильник", "test inventar", "lipton", "Muzlatkich 2", "Marojna Xaladilnik", "Polka Xrusti"]

const unassignedItems: InventoryItem[] = [
  { id: 35, serialNumber: "", client: "", inventoryType: "g'ilof", inventoryCode: "", warehouse: "05,08,2025(1)", condition: "Новый", responsible: "Admin Ritm", attachDate: "14 мая 2026", createdDate: "14 мая 2026", checkDate: "14 мая 2026", approved: false },
  { id: 34, serialNumber: "171LRMNDM500001", client: "", inventoryType: "g'ilof", inventoryCode: "50", warehouse: "05,08,2025(1)", condition: "Новый", responsible: "Admin Ritm", attachDate: "14 мая 2026", createdDate: "14 мая 2026", checkDate: "14 мая 2026", approved: false },
  { id: 33, serialNumber: "", client: "", inventoryType: "g'ilof", inventoryCode: "", warehouse: "05,08,2025(1)", condition: "Новый", responsible: "Admin Ritm", attachDate: "14 мая 2026", createdDate: "14 мая 2026", checkDate: "14 мая 2026", approved: false },
  { id: 32, serialNumber: "123", client: "", inventoryType: "Marojna Xaladilnik", inventoryCode: "2", warehouse: "toshkent", condition: "Хороший", responsible: "Admin Ritm", attachDate: "21 дек. 2025", createdDate: "21 дек. 2025", checkDate: "21 дек. 2025", approved: false },
  { id: 31, serialNumber: "012399", client: "", inventoryType: "Polka Xrusti", inventoryCode: "10", warehouse: "Suhrob sklad", condition: "Хороший", responsible: "Admin Ritm", attachDate: "20 дек. 2025", createdDate: "20 дек. 2025", checkDate: "20 дек. 2025", approved: false },
  { id: 30, serialNumber: "123123", client: "", inventoryType: "coca-cola", inventoryCode: "0001", warehouse: "Яндекс Лавка", condition: "Новый", responsible: "Admin Ritm", attachDate: "10 дек. 2025", createdDate: "10 дек. 2025", checkDate: "10 дек. 2025", approved: false },
  { id: 27, serialNumber: "", client: "", inventoryType: "test inventar", inventoryCode: "2", warehouse: "toshkent", condition: "Средний", responsible: "Admin Ritm", attachDate: "10 окт. 2025", createdDate: "10 окт. 2025", checkDate: "10 окт. 2025", approved: false },
  { id: 26, serialNumber: "", client: "", inventoryType: "test inventar", inventoryCode: "3", warehouse: "toshkent", condition: "Средний", responsible: "Admin Ritm", attachDate: "24 сент. 2025", createdDate: "24 сент. 2025", checkDate: "24 сент. 2025", approved: false },
  { id: 24, serialNumber: "", client: "", inventoryType: "lipton", inventoryCode: "8", warehouse: "ОЧАКОВО", condition: "Хороший", responsible: "Admin Ritm", attachDate: "12 июля 2025", createdDate: "12 июля 2025", checkDate: "12 июля 2025", approved: false },
  { id: 23, serialNumber: "", client: "", inventoryType: "Muzlatkich 2", inventoryCode: "3", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "28 июня 2025", createdDate: "28 июня 2025", checkDate: "28 июня 2025", approved: false },
  { id: 16, serialNumber: "", client: "", inventoryType: "g'ilof", inventoryCode: "124", warehouse: "sklad tayoriga", condition: "Хороший", responsible: "Admin Ritm", attachDate: "10 апр. 2025", createdDate: "10 апр. 2025", checkDate: "10 апр. 2025", approved: false },
  { id: 15, serialNumber: "", client: "", inventoryType: "Холодильник", inventoryCode: "0002", warehouse: "Бухоро склад", condition: "Хороший", responsible: "Admin Ritm", attachDate: "02 апр. 2025", createdDate: "02 апр. 2025", checkDate: "02 апр. 2025", approved: false },
  { id: 14, serialNumber: "", client: "", inventoryType: "coca-cola", inventoryCode: "2", warehouse: "Яндекс Лавка", condition: "Новый", responsible: "Admin Ritm", attachDate: "22 мар. 2025", createdDate: "22 мар. 2025", checkDate: "22 мар. 2025", approved: false },
]

const assignedItems: InventoryItem[] = [
  { id: 29, serialNumber: "12322323", client: "Javohir qoratosh", inventoryType: "coca-cola", inventoryCode: "1", warehouse: "123 test", condition: "Новый", responsible: "Admin Ritm", attachDate: "10 дек. 2025", createdDate: "10 дек. 2025", checkDate: "10 дек. 2025", approved: false },
  { id: 28, serialNumber: "123123", client: "Pardachi Abbos", inventoryType: "Холодильник", inventoryCode: "0001", warehouse: "Бухоро склад", condition: "Хороший", responsible: "Admin Ritm", attachDate: "10 дек. 2025", createdDate: "09 дек. 2025", checkDate: "09 дек. 2025", approved: false },
  { id: 25, serialNumber: "202", client: "ТЕСТОВЫЙ КЛИЕНТ 10", inventoryType: "test inventar", inventoryCode: "303", warehouse: "toshkent", condition: "Средний", responsible: "Admin Ritm", attachDate: "23 нояб. 2025", createdDate: "23 нояб. 2025", checkDate: "20 июня 2025", approved: false },
  { id: 22, serialNumber: "45678923", client: "client shablon 2", inventoryType: "lipton", inventoryCode: "7", warehouse: "ОЧАКОВО", condition: "Хороший", responsible: "Admin Ritm", attachDate: "16 июня 2025", createdDate: "16 июня 2025", checkDate: "16 июня 2025", approved: false },
  { id: 21, serialNumber: "45678923", client: "client shablon 1", inventoryType: "Muzlatkich 2", inventoryCode: "2", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "13 июня 2025", createdDate: "13 июня 2025", checkDate: "13 июня 2025", approved: false },
  { id: 20, serialNumber: "6941948701540", client: "o'n to'rtinchi kilent", inventoryType: "g'ilof", inventoryCode: "123", warehouse: "sklad tayoriga", condition: "Хороший", responsible: "Admin Ritm", attachDate: "05 мая 2025", createdDate: "05 мая 2025", checkDate: "05 мая 2025", approved: false },
  { id: 19, serialNumber: "123456", client: "Turizm police", inventoryType: "Холодильник", inventoryCode: "123456", warehouse: "Бухоро склад", condition: "Хороший", responsible: "Admin Ritm", attachDate: "03 мая 2025", createdDate: "03 мая 2025", checkDate: "03 мая 2025", approved: false },
  { id: 18, serialNumber: "543534", client: "yangi mijoz", inventoryType: "Muzlatkich 2", inventoryCode: "1", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "16 апр. 2025", createdDate: "16 апр. 2025", checkDate: "16 апр. 2025", approved: false },
  { id: 17, serialNumber: "9789943573857", client: "teat", inventoryType: "Muzlatkich 2", inventoryCode: "12", warehouse: "toshkent", condition: "Хороший", responsible: "Admin Ritm", attachDate: "16 апр. 2025", createdDate: "16 апр. 2025", checkDate: "16 апр. 2025", approved: false },
  { id: 13, serialNumber: "334455", client: "Doston market", inventoryType: "coca-cola", inventoryCode: "4", warehouse: "Яндекс Лавка", condition: "Хороший", responsible: "Admin Ritm", attachDate: "14 мар. 2025", createdDate: "14 мар. 2025", checkDate: "14 мар. 2025", approved: false },
  { id: 12, serialNumber: "998877", client: "Pepsi Market", inventoryType: "Холодильник", inventoryCode: "0003", warehouse: "Бухоро склад", condition: "Средний", responsible: "Admin Ritm", attachDate: "02 мар. 2025", createdDate: "02 мар. 2025", checkDate: "02 мар. 2025", approved: false },
  { id: 11, serialNumber: "667788", client: "Usman Dembele", inventoryType: "lipton", inventoryCode: "9", warehouse: "ОЧАКОВО", condition: "Хороший", responsible: "Admin Ritm", attachDate: "18 февр. 2025", createdDate: "18 февр. 2025", checkDate: "18 февр. 2025", approved: false },
  { id: 10, serialNumber: "554433", client: "Asu market", inventoryType: "test inventar", inventoryCode: "4", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "10 февр. 2025", createdDate: "10 февр. 2025", checkDate: "10 февр. 2025", approved: false },
  { id: 9, serialNumber: "221100", client: "Arslan", inventoryType: "g'ilof", inventoryCode: "125", warehouse: "sklad tayoriga", condition: "Хороший", responsible: "Admin Ritm", attachDate: "28 янв. 2025", createdDate: "28 янв. 2025", checkDate: "28 янв. 2025", approved: false },
  { id: 8, serialNumber: "112233", client: "new klient707", inventoryType: "Muzlatkich 2", inventoryCode: "13", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "20 янв. 2025", createdDate: "20 янв. 2025", checkDate: "20 янв. 2025", approved: false },
  { id: 7, serialNumber: "776655", client: "Ritm ritm", inventoryType: "coca-cola", inventoryCode: "5", warehouse: "Яндекс Лавка", condition: "Хороший", responsible: "Admin Ritm", attachDate: "12 янв. 2025", createdDate: "12 янв. 2025", checkDate: "12 янв. 2025", approved: false },
  { id: 6, serialNumber: "554321", client: "Бахт маркет", inventoryType: "Холодильник", inventoryCode: "0004", warehouse: "Бухоро склад", condition: "Средний", responsible: "Admin Ritm", attachDate: "05 янв. 2025", createdDate: "05 янв. 2025", checkDate: "05 янв. 2025", approved: false },
  { id: 5, serialNumber: "998812", client: "ИП Каркабаев", inventoryType: "lipton", inventoryCode: "10", warehouse: "ОЧАКОВО", condition: "Хороший", responsible: "Admin Ritm", attachDate: "22 дек. 2024", createdDate: "22 дек. 2024", checkDate: "22 дек. 2024", approved: false },
  { id: 4, serialNumber: "665544", client: "Частное Лицо", inventoryType: "test inventar", inventoryCode: "5", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "10 дек. 2024", createdDate: "10 дек. 2024", checkDate: "10 дек. 2024", approved: false },
  { id: 3, serialNumber: "334422", client: "test 20007", inventoryType: "g'ilof", inventoryCode: "126", warehouse: "sklad tayoriga", condition: "Хороший", responsible: "Admin Ritm", attachDate: "28 нояб. 2024", createdDate: "28 нояб. 2024", checkDate: "28 нояб. 2024", approved: false },
  { id: 2, serialNumber: "112200", client: "Bohodir Axmedov", inventoryType: "Muzlatkich 2", inventoryCode: "14", warehouse: "toshkent", condition: "Новый", responsible: "Admin Ritm", attachDate: "15 нояб. 2024", createdDate: "15 нояб. 2024", checkDate: "15 нояб. 2024", approved: false },
  { id: 1, serialNumber: "998877", client: "Asu market", inventoryType: "coca-cola", inventoryCode: "6", warehouse: "Яндекс Лавка", condition: "Хороший", responsible: "Admin Ritm", attachDate: "20 окт. 2024", createdDate: "20 окт. 2024", checkDate: "20 окт. 2024", approved: false },
]

const movementLogs: MovementLog[] = [
  { id: 1, direction: "in", inventoryType: "g'ilof", inventoryCode: "", createdAt: "14 мая 2026, 13:41", movementDate: "", client: "", warehouse: "05,08,2025(1)", condition: "Новый", type: "Новый" },
  { id: 2, direction: "in", inventoryType: "g'ilof", inventoryCode: "50", createdAt: "14 мая 2026, 13:35", movementDate: "14 мая 2026", client: "", warehouse: "05,08,2025(1)", condition: "Новый", type: "Новый" },
  { id: 3, direction: "out", inventoryType: "g'ilof", inventoryCode: "", createdAt: "14 мая 2026, 13:30", movementDate: "14 мая 2026", client: "3333333333333333333333333333", warehouse: "05,08,2025(1)", condition: "Новый", type: "Изъятие" },
  { id: 4, direction: "in", inventoryType: "g'ilof", inventoryCode: "", createdAt: "14 мая 2026, 13:21", movementDate: "", client: "3333333333333333333333333333", warehouse: "05,08,2025(1)", condition: "Новый", type: "Передача" },
  { id: 5, direction: "in", inventoryType: "g'ilof", inventoryCode: "", createdAt: "14 мая 2026, 13:21", movementDate: "", client: "", warehouse: "05,08,2025(1)", condition: "Новый", type: "Новый" },
  { id: 6, direction: "out", inventoryType: "test inventar", inventoryCode: "2", createdAt: "14 мая 2026, 13:12", movementDate: "14 мая 2026", client: "3333333333333333333333333333", warehouse: "toshkent", condition: "Новый", type: "Изъятие" },
  { id: 7, direction: "in", inventoryType: "test inventar", inventoryCode: "2", createdAt: "14 мая 2026, 13:09", movementDate: "14 мая 2026", client: "3333333333333333333333333333", warehouse: "toshkent", condition: "Новый", type: "Передача" },
  { id: 8, direction: "out", inventoryType: "test inventar", inventoryCode: "101", createdAt: "14 мая 2026, 13:07", movementDate: "14 мая 2026", client: "client shablon 2", warehouse: "toshkent", condition: "Новый", type: "Изъятие" },
  { id: 9, direction: "out", inventoryType: "Marojna Xaladilnik", inventoryCode: "2", createdAt: "02 мая 2026, 10:20", movementDate: "02 мая 2026", client: "test_dilmurod_produkt", warehouse: "toshkent", condition: "Новый", type: "Изъятие" },
  { id: 10, direction: "out", inventoryType: "Polka Xrusti", inventoryCode: "10", createdAt: "29 мар. 2026, 17:51", movementDate: "29 мар. 2026", client: "Klient_Karim195", warehouse: "Suhrob sklad", condition: "Хороший", type: "Изъятие" },
]

const checkLogs: CheckLog[] = [
  { id: 6, client: "Одил бобо лимонадный", createdBy: "Тп 2 Алиса", checkDate: "18 мар. 2025, 16:55", inventoryType: "Холодильник", inventoryCode: "4" },
  { id: 5, client: "Абдулло кинап", createdBy: "Тп 2 Алиса", checkDate: "10 мар. 2025, 16:50", inventoryType: "Texnik apparat", inventoryCode: "100" },
  { id: 4, client: "Абдулло кинап", createdBy: "Тп 2 Алиса", checkDate: "10 мар. 2025, 16:48", inventoryType: "Texnik apparat", inventoryCode: "100" },
  { id: 3, client: "Pepsi Market", createdBy: "Тп 1 Исмоилов Гани", checkDate: "03 дек. 2024, 12:47", inventoryType: "Холодильник", inventoryCode: "152234" },
  { id: 2, client: "Doston market", createdBy: "Тп 1 Исмоилов Гани", checkDate: "22 нояб. 2024, 11:10", inventoryType: "g'ilof", inventoryCode: "60" },
  { id: 1, client: "Usman Dembele", createdBy: "Admin Ritm", checkDate: "05 нояб. 2024, 09:30", inventoryType: "coca-cola", inventoryCode: "3" },
]

const requestRows: RequestRow[] = []

const favoriteItems = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]
type MainTab = "requests" | "warehouse" | "attached" | "all" | "movements" | "checks"

export function InventoryManagementView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [tab, setTab] = useState<MainTab>("requests")
  const [requestSubTab, setRequestSubTab] = useState<"in_progress" | "confirmed" | "rejected" | "all">("in_progress")
  const [items, setItems] = useState([...unassignedItems, ...assignedItems])
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const scopedItems = useMemo(() => {
    if (tab === "warehouse") return items.filter((item) => !item.client)
    if (tab === "attached") return items.filter((item) => item.client)
    return items
  }, [items, tab])

  const filtered = useMemo(() => {
    return scopedItems.filter((item) => {
      if (!search.trim()) return true
      const needle = search.trim().toLocaleLowerCase("ru")
      return item.inventoryType.toLocaleLowerCase("ru").includes(needle) || item.client.toLocaleLowerCase("ru").includes(needle) || item.serialNumber.includes(search.trim())
    })
  }, [scopedItems, search])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const approvedCount = scopedItems.filter((item) => item.approved).length

  const toggleApproved = (id: number) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, approved: !item.approved } : item)))
  }
  const deleteItem = (id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    setExpandedId(null)
  }
  const saveItem = (data: InventoryItem) => {
    setItems((current) => {
      const exists = current.some((item) => item.id === data.id)
      if (exists) return current.map((item) => (item.id === data.id ? data : item))
      const nextId = Math.max(0, ...current.map((item) => item.id)) + 1
      return [{ ...data, id: nextId }, ...current]
    })
    setAddOpen(false)
    setEditItem(null)
  }

  const downloadExcel = () => {
    const header = ["№", "Серийный №", "Клиент", "Тип инвентаря", "Склад", "Дата прикрепления", "Дата проверки"]
    const body = filtered.map((item) => [item.id, item.serialNumber, item.client, item.inventoryType, item.warehouse, item.attachDate, item.checkDate])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "inventory.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const mainTabs: { key: MainTab; label: string }[] = [
    { key: "requests", label: "Запросы" },
    { key: "warehouse", label: "На складе" },
    { key: "attached", label: "Прикрепление" },
    { key: "all", label: "Все" },
    { key: "movements", label: "История движений" },
    { key: "checks", label: "История проверки" },
  ]

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e1e5eb] px-6 py-5 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Работа с инвентарем</span>
        </button>
        {tab !== "requests" && (
          <div className="flex gap-3">
            <button onClick={downloadExcel} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white"><Download className="h-5 w-5" /> Скачать Excel</button>
            <button onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white"><Upload className="h-5 w-5" /> Импортировать</button>
            <button onClick={() => setAddOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white"><Plus className="h-5 w-5" /> Добавить</button>
          </div>
        )}
      </header>

      <section className="flex border-b border-[#e1e5eb]">
        {mainTabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1); setExpandedId(null) }}
            className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === key ? "border-[#4f70e7] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {label}
          </button>
        ))}
      </section>

      {tab === "requests" && (
        <>
          <section className="grid grid-cols-4 border-b border-[#e1e5eb]">
            {(
              [
                ["in_progress", "В процессе"],
                ["confirmed", "Подтверждено"],
                ["rejected", "Отклонено"],
                ["all", "Все"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRequestSubTab(key)}
                className={`border-b-2 py-4 text-[15px] font-medium ${requestSubTab === key ? "border-[#4f70e7] text-[#17233b]" : "border-transparent text-[#586174]"}`}
              >
                {label}
              </button>
            ))}
          </section>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <span className="flex items-center gap-2 text-[#4f70e7]">Фильтр: 1 элемента <Pencil className="h-4 w-4" /> <button type="button" onClick={() => setSearch("")} aria-label="Сбросить фильтр"><X className="h-5 w-5 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button></span>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">1 - 0 из 0</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" />
            <ChevronRight className="h-5 w-5 text-[#9aa3b6]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                {["№", "Тип", "Клиент", "Тип инвентаря", "Инвентарь", "Запросил", "Дата запроса", "Обработал", "Дата обработки", "Статус"].map((title) => (
                  <th key={title} className="px-4 py-4 text-left font-semibold">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requestRows.length === 0 && (
                <tr><td colSpan={10} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-1 text-[#9aa3b6]">
                    <Image src="/robot-mascot.png" alt="Робот-помощник" width={120} height={120} className="h-28 w-28 object-contain" />
                    <span>По вашему запросу ничего не найдено</span>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {(tab === "warehouse" || tab === "attached" || tab === "all") && (
        <>
          <div className="flex items-center bg-[#5a6ae0] text-white">
            <span className="flex-1 px-6 py-3 text-center">Одобрено: {approvedCount}</span>
            <span className="flex-1 border-l border-white/20 px-6 py-3 text-center">Не одобрено: {scopedItems.length - approvedCount}</span>
            <span className="flex-1 border-l border-white/20 px-6 py-3 text-center">Итого: {scopedItems.length}</span>
          </div>

          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
              <Filter className="h-4 w-4" /> Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
            </button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>
            <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40"><ChevronLeft className="h-5 w-5" /></button>
            <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40"><ChevronRight className="h-5 w-5" /></button>
          </section>

          {filterOpen && (
            <section className="border-b border-[#e1e5eb] px-6 pb-6 md:px-9">
              <div className="grid max-w-md gap-8">
                <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                  Склад
                  <select className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                    <option>Все склады</option>
                    {warehousesList.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
                </label>
              </div>
            </section>
          )}

          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-4 py-4 text-left font-semibold">№</th>
                <th className="px-4 py-4 text-left font-semibold">Серийный №</th>
                <th className="px-4 py-4 text-left font-semibold">Клиент</th>
                <th className="px-4 py-4 text-left font-semibold">Тип инвентаря</th>
                <th className="px-4 py-4 text-left font-semibold">Склад</th>
                <th className="px-4 py-4 text-left font-semibold">Дата прикрепления</th>
                <th className="px-4 py-4 text-left font-semibold">Дата проверки</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, index) => (
                <Fragment key={item.id}>
                  <tr
                    onClick={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                    className={`cursor-pointer border-b border-dashed border-slate-200 hover:bg-[#eef2fb] ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}
                  >
                    <td className="px-4 py-4">{item.id}</td>
                    <td className="px-4 py-4">{item.serialNumber}</td>
                    <td className="px-4 py-4 text-[#4f70e7]">{item.client}</td>
                    <td className="px-4 py-4">
                      <div>{item.inventoryType}</div>
                      {item.inventoryCode && <div className="text-[#4f70e7]">{item.inventoryCode}</div>}
                    </td>
                    <td className="px-4 py-4">{item.warehouse}</td>
                    <td className="px-4 py-4">{item.attachDate}</td>
                    <td className="flex items-center justify-between px-4 py-4">
                      {item.checkDate}
                      <button
                        aria-label={item.approved ? "Одобрено" : "Не одобрено"}
                        onClick={(event) => { event.stopPropagation(); toggleApproved(item.id) }}
                      >
                        {item.approved ? <CheckCircle2 className="h-5 w-5 text-[#39ca79]" /> : <X className="h-5 w-5 text-[#e5484d]" />}
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr>
                      <td colSpan={7} className="bg-white p-0">
                        <div onClick={(event) => event.stopPropagation()} className="border-y border-[#e1e5eb] px-9 py-7 shadow-inner">
                          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                            <h3 className="text-xl font-semibold">№ {item.id}</h3>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  downloadExcelTable(`inventory-${item.id}.xls`, [
                                    ["Склад", "Тип", "Состояние", "Клиент", "Серийный номер", "Инвентарный номер", "Дата прикрепления", "Дата создания", "Ответственный", "Одобрено"],
                                    [item.warehouse, item.inventoryType, item.condition, item.client || "—", item.serialNumber || "—", item.inventoryCode || "—", item.attachDate, item.createdDate, item.responsible, item.approved ? "Да" : "Нет"],
                                  ])
                                }
                                className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"
                              >
                                <Eye className="h-4 w-4" /> Просмотреть
                              </button>
                              <button onClick={() => setTransferItem(item)} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"><ArrowLeftRight className="h-4 w-4" /> Передача / Изъятие</button>
                              <button onClick={() => setEditItem(item)} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"><Pencil className="h-4 w-4" /> Изменить</button>
                              <button aria-label={item.approved ? "Одобрено" : "Не одобрено"} onClick={() => toggleApproved(item.id)}>
                                {item.approved ? <CheckCircle2 className="h-6 w-6 text-[#39ca79]" /> : <XCircle className="h-6 w-6 text-[#9aa3b6]" />}
                              </button>
                              <button aria-label="Удалить" onClick={() => deleteItem(item.id)}><Trash2 className="h-5 w-5 text-[#9aa3b6] hover:text-[#e5484d]" /></button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                            <dl className="space-y-3 text-[15px]">
                              <DetailRow label="Склад" value={item.warehouse} />
                              <DetailRow label="Тип" value={item.inventoryType} />
                              <DetailRow label="Состояние" value={item.condition} />
                              <DetailRow label="Клиент" value={item.client || "—"} />
                              <DetailRow label="Серийный номер" value={item.serialNumber || "—"} />
                              <DetailRow label="Инвентарный номер" value={item.inventoryCode || "—"} />
                              <DetailRow label="Дата прикрепления" value={item.attachDate} />
                              <DetailRow label="Дата создания" value={item.createdDate} />
                              <div className="flex items-baseline justify-between gap-6">
                                <dt className="text-[#586174]">Одобрено</dt>
                                <dd>{item.approved ? <CheckCircle2 className="h-5 w-5 text-[#39ca79]" /> : <X className="h-5 w-5 text-[#e5484d]" />}</dd>
                              </div>
                            </dl>
                            <div>
                              <p className="mb-2 font-semibold uppercase tracking-wide text-[#586174]">Ответственный:</p>
                              <p>{item.responsible}</p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {tab === "movements" && (
        <>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]"><Filter className="h-4 w-4" /> Показать фильтр</button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">1 - {movementLogs.length} из 115</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" /><ChevronRight className="h-5 w-5 text-[#4f70e7]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["Инвентарь", "Дата создания", "Дата движения", "Клиент", "Склад", "Состояние", "Тип"].map((title) => <th key={title} className="px-4 py-4 text-left font-semibold">{title}</th>)}</tr>
            </thead>
            <tbody>
              {movementLogs.filter((log) => !search.trim() || log.inventoryType.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).map((log, index) => (
                <tr key={log.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4">
                    <span className={`mr-2 inline-block ${log.direction === "in" ? "text-[#39ca79]" : "text-[#e5484d]"}`}>{log.direction === "in" ? "↓" : "↑"}</span>
                    {log.inventoryType} {log.inventoryCode && <span className="text-[#586174]">(№{log.inventoryCode})</span>}
                  </td>
                  <td className="px-4 py-4">{log.createdAt}</td>
                  <td className="px-4 py-4">{log.movementDate}</td>
                  <td className="px-4 py-4 text-[#4f70e7]">{log.client}</td>
                  <td className="px-4 py-4">{log.warehouse}</td>
                  <td className="px-4 py-4">{log.condition}</td>
                  <td className="px-4 py-4">{log.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "checks" && (
        <>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]"><Filter className="h-4 w-4" /> Показать фильтр</button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">1 - {checkLogs.length} из {checkLogs.length}</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" /><ChevronRight className="h-5 w-5 text-[#9aa3b6]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["№", "Клиент", "Создал", "Дата проверки", "Инвентарь", "Изображений"].map((title) => <th key={title} className="px-4 py-4 text-left font-semibold">{title}</th>)}</tr>
            </thead>
            <tbody>
              {checkLogs.filter((log) => !search.trim() || log.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).map((log, index) => (
                <tr key={log.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4">{log.id} <span className="block text-xs text-[#4f70e7]">(ком.)</span></td>
                  <td className="px-4 py-4">{log.client}</td>
                  <td className="px-4 py-4">{log.createdBy}</td>
                  <td className="px-4 py-4">{log.checkDate}</td>
                  <td className="px-4 py-4">{log.inventoryType} <span className="text-[#586174]">(№{log.inventoryCode})</span></td>
                  <td className="px-4 py-4"><span className="flex h-16 w-16 items-center justify-center rounded bg-[#f2f5f8] text-xs text-[#9aa3b6]">img</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {favoritesOpen && (
        <div className="fixed inset-0 z-[100] flex">
          <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)} className="flex-1 bg-black/40" />
          <aside className="w-[420px] max-w-[90vw] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">Избранные</h2>
              <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)}><X className="h-6 w-6 text-slate-600" /></button>
            </header>
            {favoriteItems.map((item, index) => (
              <button key={`${item}-${index}`} onClick={() => { setFavorite(true); setFavoritesOpen(false) }} className="flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg">
                {item} <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </aside>
        </div>
      )}

      {(addOpen || editItem) && (
        <InventoryFormModal
          mode={addOpen ? "add" : "edit"}
          item={editItem}
          onClose={() => { setAddOpen(false); setEditItem(null) }}
          onSave={saveItem}
        />
      )}

      {transferItem && <TransferModal item={transferItem} onClose={() => setTransferItem(null)} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </main>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-[#586174]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}

function InventoryFormModal({
  mode,
  item,
  onClose,
  onSave,
}: {
  mode: "add" | "edit"
  item: InventoryItem | null
  onClose: () => void
  onSave: (item: InventoryItem) => void
}) {
  const [warehouse, setWarehouse] = useState(item?.warehouse ?? "")
  const [product, setProduct] = useState(item?.inventoryType ?? "")
  const [condition, setCondition] = useState(item?.condition ?? "")
  const [responsible, setResponsible] = useState(item?.responsible ?? "")
  const [client, setClient] = useState(item?.client ?? "")
  const [serialNumber, setSerialNumber] = useState(item?.serialNumber ?? "")
  const [inventoryCode, setInventoryCode] = useState(item?.inventoryCode ?? "")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)

  const submit = () => {
    setTouched(true)
    if (!warehouse || !product || !condition || !serialNumber || !inventoryCode) return
    onSave({
      id: item?.id ?? 0,
      serialNumber,
      client,
      inventoryType: product,
      inventoryCode,
      warehouse,
      condition,
      responsible,
      attachDate: date,
      createdDate: item?.createdDate ?? date,
      checkDate: item?.checkDate ?? date,
      approved: item?.approved ?? false,
    })
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 py-10" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="grid w-[960px] max-w-[95vw] grid-cols-1 rounded-md bg-white shadow-2xl md:grid-cols-[1fr_320px]">
        <div className="col-span-full flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{mode === "add" ? "Добавление инвентаря" : "Изменение инвентаря"}</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </div>
        <div className="space-y-6 px-8 py-8">
          {mode === "edit" && <p className="text-xs text-[#9aa3b6]">Текущий Клиент:</p>}
          <Field label="Склад" required value={warehouse} onChange={setWarehouse} options={warehousesList} error={touched && !warehouse ? "Обязательное поле" : ""} />
          <Field label="Продукт" required value={product} onChange={setProduct} options={productTypes} error={touched && !product ? "Обязательное поле" : ""} />
          <Field label="Состояние" required value={condition} onChange={setCondition} options={conditions} error={touched && !condition ? "Обязательное поле" : ""} />
          <Field label="Ответственный" required value={responsible} onChange={setResponsible} options={responsibles} />
          <Field label="Клиент" value={client} onChange={setClient} options={["Doston market", "Pepsi Market", "Usman Dembele"]} />
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Серийный номер <span className="text-red-500">*</span>
            <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !serialNumber && <p className="mt-1 text-sm text-[#e5484d]">Обязательное поле</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Инвентарный номер <span className="text-red-500">*</span>
            <input value={inventoryCode} onChange={(event) => setInventoryCode(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !inventoryCode && <p className="mt-1 text-sm text-[#e5484d]">Обязательное поле</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Дата <span className="text-red-500">*</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий..." className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <div className="flex items-center justify-center border-t p-8 md:border-l md:border-t-0">
          <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]">
            <span className="text-2xl">🖼</span> Добавьте фото
          </div>
        </div>
        <div className="col-span-full flex justify-end border-t px-8 py-5">
          <button onClick={submit} className="font-bold uppercase tracking-wide text-[#4f70e7]">Сохранить</button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  value,
  onChange,
  options,
  error,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  options: string[]
  error?: string
}) {
  return (
    <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
      {label} {required && <span className="text-red-500">*</span>}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
        <option value="" />
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
      {error && <p className="mt-1 text-sm text-[#e5484d]">{error}</p>}
    </label>
  )
}

function TransferModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const [client, setClient] = useState("")
  const [date, setDate] = useState("")
  const [condition, setCondition] = useState(item.condition)
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">Передача / Изъятие</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-6 px-8 py-7">
          <h3 className="font-bold uppercase tracking-wide text-[#586174]">Информация:</h3>
          <DetailRow label="Тип" value={item.inventoryType} />
          <DetailRow label="Серийный номер" value={item.serialNumber || "—"} />
          <DetailRow label="Инвентарный номер" value={item.inventoryCode || "—"} />
          <h3 className="pt-3 font-bold uppercase tracking-wide text-[#586174]">Передача</h3>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Передать клиенту
            <select value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Doston market</option><option>Pepsi Market</option><option>Usman Dembele</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Дата передачи
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Состояние
            <select value={condition} onChange={(event) => setCondition(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              {conditions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий..." className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={onClose} className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const [agent, setAgent] = useState("")
  const [zone, setZone] = useState("")
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">Импорт с Excel</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Агент
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {responsibles.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Зона
            <select value={zone} onChange={(event) => setZone(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Andijon shaharchasi</option><option>chilonzor</option><option>Yunusobod</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <button
            type="button"
            onClick={() => downloadExcelTable("inventory-import-template.xls", [["Серийный номер", "Клиент", "Тип инвентаря", "Инвентарный номер", "Склад", "Состояние", "Ответственный"]])}
            className="block w-full text-center font-semibold text-[#4f70e7]"
          >
            1. Скачать шаблон
          </button>
          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]">
            <input type="file" accept=".xlsx,.xls" className="hidden" />
            <span className="text-2xl">📄</span>
            <span>Добавьте файл Excel или <span className="text-[#4f70e7]">нажмите для выбора</span></span>
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={onClose} className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}

export default InventoryManagementView
