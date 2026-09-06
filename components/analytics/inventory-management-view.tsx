"use client"

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import {
  inventoryConditions as conditions,
  inventoryProductTypes as productTypes,
  inventoryResponsibles as responsibles,
  inventoryWarehouses as warehousesList,
  type InventoryItem,
} from "./inventory-items-data"
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "серийный номер": "serialNumber", "серийный №": "serialNumber", "serial number": "serialNumber",
  "клиент": "client", "client": "client",
  "тип инвентаря": "inventoryType", "inventory type": "inventoryType",
  "инвентарный номер": "inventoryCode", "инвентарный №": "inventoryCode", "inventory code": "inventoryCode",
  "склад": "warehouse", "warehouse": "warehouse",
  "состояние": "condition", "condition": "condition",
  "ответственный": "responsible", "responsible": "responsible",
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

const movementLogs: MovementLog[] = []

const checkLogs: CheckLog[] = []

const requestRows: RequestRow[] = []

type MainTab = "requests" | "warehouse" | "attached" | "all" | "movements" | "checks"

export function InventoryManagementView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<MainTab>("requests")
  const [requestSubTab, setRequestSubTab] = useState<"in_progress" | "confirmed" | "rejected" | "all">("in_progress")
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<InventoryItem | null>(null)
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/inventory-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить инвентарь")
        return (await response.json()) as InventoryItem[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить инвентарь с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const itemInput = (data: Omit<InventoryItem, "id" | "createdDate">) => ({
    serialNumber: data.serialNumber,
    client: data.client,
    inventoryType: data.inventoryType,
    inventoryCode: data.inventoryCode,
    warehouse: data.warehouse,
    condition: data.condition,
    responsible: data.responsible,
    attachDate: data.attachDate,
    checkDate: data.checkDate,
    approved: data.approved,
  })

  const toggleApproved = async (id: number) => {
    const item = items.find((current) => current.id === id)
    if (!item) return
    try {
      const response = await fetch(`/api/inventory-items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemInput({ ...item, approved: !item.approved })),
      })
      if (!response.ok) return
      const saved = (await response.json()) as InventoryItem
      setItems((current) => current.map((current_) => (current_.id === id ? saved : current_)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  const deleteItem = async (id: number) => {
    try {
      const response = await fetch(`/api/inventory-items/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setItems((current) => current.filter((item) => item.id !== id))
      setExpandedId(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  const saveItem = async (data: InventoryItem) => {
    try {
      if (data.id) {
        const response = await fetch(`/api/inventory-items/${data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemInput(data)),
        })
        if (!response.ok) {
          window.alert(t("Не удалось сохранить инвентарь"))
          return
        }
        const saved = (await response.json()) as InventoryItem
        setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      } else {
        const response = await fetch("/api/inventory-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemInput(data)),
        })
        if (!response.ok) {
          window.alert(t("Не удалось создать инвентарь"))
          return
        }
        const saved = (await response.json()) as InventoryItem
        setItems((current) => [saved, ...current])
      }
      setAddOpen(false)
      setEditItem(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const updateTransfer = async (id: number, patch: Partial<InventoryItem>) => {
    const item = items.find((current) => current.id === id)
    if (!item) return
    try {
      const response = await fetch(`/api/inventory-items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemInput({ ...item, ...patch })),
      })
      if (!response.ok) return
      const saved = (await response.json()) as InventoryItem
      setItems((current) => current.map((current_) => (current_.id === id ? saved : current_)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function importFromExcel(file: File) {
    const rows = await readExcelRows(file)
    if (!rows.length) return { created: 0, total: 0, failed: 0 }

    const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
    const hasHeader = Array.from(fieldByIndex.values()).includes("inventoryType")
    const dataRows = hasHeader ? rows.slice(1) : rows

    const parsed: ReturnType<typeof itemInput>[] = []
    for (const row of dataRows) {
      const record: Record<string, string> = {}
      if (hasHeader) {
        row.forEach((cell, index) => {
          const field = fieldByIndex.get(index)
          if (field) record[field] = cell
        })
      } else {
        record.serialNumber = row[0] ?? ""
        record.client = row[1] ?? ""
        record.inventoryType = row[2] ?? ""
        record.inventoryCode = row[3] ?? ""
        record.warehouse = row[4] ?? ""
        record.condition = row[5] ?? ""
        record.responsible = row[6] ?? ""
      }
      if (!record.inventoryType || /^(тип инвентаря|inventory type)$/i.test(record.inventoryType)) continue
      parsed.push({
        serialNumber: record.serialNumber || "",
        client: record.client || "",
        inventoryType: record.inventoryType,
        inventoryCode: record.inventoryCode || "",
        warehouse: record.warehouse || warehousesList[0],
        condition: record.condition || conditions[0],
        responsible: record.responsible || responsibles[0],
        attachDate: "",
        checkDate: "",
        approved: false,
      })
    }
    if (!parsed.length) return { created: 0, total: 0, failed: 0 }

    const created: InventoryItem[] = []
    let failed = 0
    for (const item of parsed) {
      try {
        const response = await fetch("/api/inventory-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        })
        if (response.ok) created.push((await response.json()) as InventoryItem)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (created.length) setItems((current) => [...created, ...current])
    return { created: created.length, total: parsed.length, failed }
  }

  const downloadExcel = () => {
    const header = [t("№"), t("Серийный №"), t("Клиент"), t("Тип инвентаря"), t("Склад"), t("Дата прикрепления"), t("Дата проверки")]
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
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Работа с инвентарем")}</span>
        </div>
        {tab !== "requests" && (
          <div className="flex gap-3">
            <button onClick={downloadExcel} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white"><Download className="h-5 w-5" /> {t("Скачать Excel")}</button>
            <button onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white"><Upload className="h-5 w-5" /> {t("Импортировать")}</button>
            <button onClick={() => setAddOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white"><Plus className="h-5 w-5" /> {t("Добавить")}</button>
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
            {t(label)}
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
                {t(label)}
              </button>
            ))}
          </section>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <span className="flex items-center gap-2 text-[#4f70e7]">{t("Фильтр: 1 элемента")} <Pencil className="h-4 w-4" /> <button type="button" onClick={() => setSearch("")} aria-label={t("Сбросить фильтр")}><X className="h-5 w-5 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button></span>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">1 - 0 {t("из")} 0</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" />
            <ChevronRight className="h-5 w-5 text-[#9aa3b6]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                {["№", "Тип", "Клиент", "Тип инвентаря", "Инвентарь", "Запросил", "Дата запроса", "Обработал", "Дата обработки", "Статус"].map((title) => (
                  <th key={title} className="px-4 py-4 text-left font-semibold">{t(title)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requestRows.length === 0 && (
                <tr><td colSpan={10} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-1 text-[#9aa3b6]">
                    <Image src="/robot-mascot.png" alt={t("Робот-помощник")} width={120} height={120} className="h-28 w-28 object-contain" />
                    <span>{t("По вашему запросу ничего не найдено")}</span>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {(tab === "warehouse" || tab === "attached" || tab === "all") && (
        <>
          {loadError && <p className="px-6 py-3 text-sm text-red-500 md:px-9">{loadError}</p>}
          <div className="flex items-center bg-[#5a6ae0] text-white">
            <span className="flex-1 px-6 py-3 text-center">{t("Одобрено")}: {approvedCount}</span>
            <span className="flex-1 border-l border-white/20 px-6 py-3 text-center">{t("Не одобрено")}: {scopedItems.length - approvedCount}</span>
            <span className="flex-1 border-l border-white/20 px-6 py-3 text-center">{t("Итого")}: {scopedItems.length}</span>
          </div>

          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
              <Filter className="h-4 w-4" /> {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
            </button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}</span>
            <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40"><ChevronLeft className="h-5 w-5" /></button>
            <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40"><ChevronRight className="h-5 w-5" /></button>
          </section>

          {filterOpen && (
            <section className="border-b border-[#e1e5eb] px-6 pb-6 md:px-9">
              <div className="grid max-w-md gap-8">
                <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                  {t("Склад")}
                  <select className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                    <option>{t("Все склады")}</option>
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
                <th className="px-4 py-4 text-left font-semibold">{t("№")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Серийный №")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Клиент")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Тип инвентаря")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Склад")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Дата прикрепления")}</th>
                <th className="px-4 py-4 text-left font-semibold">{t("Дата проверки")}</th>
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
                        aria-label={item.approved ? t("Одобрено") : t("Не одобрено")}
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
                            <h3 className="text-xl font-semibold">{t("№")} {item.id}</h3>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() =>
                                  downloadExcelTable(`inventory-${item.id}.xls`, [
                                    [t("Склад"), t("Тип"), t("Состояние"), t("Клиент"), t("Серийный номер"), t("Инвентарный номер"), t("Дата прикрепления"), t("Дата создания"), t("Ответственный"), t("Одобрено")],
                                    [item.warehouse, item.inventoryType, item.condition, item.client || "—", item.serialNumber || "—", item.inventoryCode || "—", item.attachDate, item.createdDate, item.responsible, item.approved ? t("Да") : t("Нет")],
                                  ])
                                }
                                className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"
                              >
                                <Eye className="h-4 w-4" /> {t("Просмотреть")}
                              </button>
                              <button onClick={() => setTransferItem(item)} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"><ArrowLeftRight className="h-4 w-4" /> {t("Передача / Изъятие")}</button>
                              <button onClick={() => setEditItem(item)} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-4 py-2 font-semibold text-white"><Pencil className="h-4 w-4" /> {t("Изменить")}</button>
                              <button aria-label={item.approved ? t("Одобрено") : t("Не одобрено")} onClick={() => toggleApproved(item.id)}>
                                {item.approved ? <CheckCircle2 className="h-6 w-6 text-[#39ca79]" /> : <XCircle className="h-6 w-6 text-[#9aa3b6]" />}
                              </button>
                              <button aria-label={t("Удалить")} onClick={() => deleteItem(item.id)}><Trash2 className="h-5 w-5 text-[#9aa3b6] hover:text-[#e5484d]" /></button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                            <dl className="space-y-3 text-[15px]">
                              <DetailRow label={t("Склад")} value={item.warehouse} />
                              <DetailRow label={t("Тип")} value={item.inventoryType} />
                              <DetailRow label={t("Состояние")} value={item.condition} />
                              <DetailRow label={t("Клиент")} value={item.client || "—"} />
                              <DetailRow label={t("Серийный номер")} value={item.serialNumber || "—"} />
                              <DetailRow label={t("Инвентарный номер")} value={item.inventoryCode || "—"} />
                              <DetailRow label={t("Дата прикрепления")} value={item.attachDate} />
                              <DetailRow label={t("Дата создания")} value={item.createdDate} />
                              <div className="flex items-baseline justify-between gap-6">
                                <dt className="text-[#586174]">{t("Одобрено")}</dt>
                                <dd>{item.approved ? <CheckCircle2 className="h-5 w-5 text-[#39ca79]" /> : <X className="h-5 w-5 text-[#e5484d]" />}</dd>
                              </div>
                            </dl>
                            <div>
                              <p className="mb-2 font-semibold uppercase tracking-wide text-[#586174]">{t("Ответственный")}:</p>
                              <p>{item.responsible}</p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">{t("Ничего не найдено")}</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {tab === "movements" && (
        <>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]"><Filter className="h-4 w-4" /> {t("Показать фильтр")}</button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">{movementLogs.length ? 1 : 0} - {movementLogs.length} {t("из")} {movementLogs.length}</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" /><ChevronRight className="h-5 w-5 text-[#4f70e7]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["Инвентарь", "Дата создания", "Дата движения", "Клиент", "Склад", "Состояние", "Тип"].map((title) => <th key={title} className="px-4 py-4 text-left font-semibold">{t(title)}</th>)}</tr>
            </thead>
            <tbody>
              {movementLogs.filter((log) => !search.trim() || log.inventoryType.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).map((log, index) => (
                <tr key={log.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4">
                    <span className={`mr-2 inline-block ${log.direction === "in" ? "text-[#39ca79]" : "text-[#e5484d]"}`}>{log.direction === "in" ? "↓" : "↑"}</span>
                    {log.inventoryType} {log.inventoryCode && <span className="text-[#586174]">({t("№")}{log.inventoryCode})</span>}
                  </td>
                  <td className="px-4 py-4">{log.createdAt}</td>
                  <td className="px-4 py-4">{log.movementDate}</td>
                  <td className="px-4 py-4 text-[#4f70e7]">{log.client}</td>
                  <td className="px-4 py-4">{log.warehouse}</td>
                  <td className="px-4 py-4">{log.condition}</td>
                  <td className="px-4 py-4">{t(log.type)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "checks" && (
        <>
          <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]"><Filter className="h-4 w-4" /> {t("Показать фильтр")}</button>
            <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
              <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 bg-transparent text-[#586174]">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select>
            <span className="text-[#586174]">1 - {checkLogs.length} {t("из")} {checkLogs.length}</span>
            <ChevronLeft className="h-5 w-5 text-[#9aa3b6]" /><ChevronRight className="h-5 w-5 text-[#9aa3b6]" />
          </section>
          <table className="w-full border-collapse text-[15px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["№", "Клиент", "Создал", "Дата проверки", "Инвентарь", "Изображений"].map((title) => <th key={title} className="px-4 py-4 text-left font-semibold">{t(title)}</th>)}</tr>
            </thead>
            <tbody>
              {checkLogs.filter((log) => !search.trim() || log.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))).map((log, index) => (
                <tr key={log.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4">{log.id} <span className="block text-xs text-[#4f70e7]">{t("(ком.)")}</span></td>
                  <td className="px-4 py-4">{log.client}</td>
                  <td className="px-4 py-4">{log.createdBy}</td>
                  <td className="px-4 py-4">{log.checkDate}</td>
                  <td className="px-4 py-4">{log.inventoryType} <span className="text-[#586174]">({t("№")}{log.inventoryCode})</span></td>
                  <td className="px-4 py-4"><span className="flex h-16 w-16 items-center justify-center rounded bg-[#f2f5f8] text-xs text-[#9aa3b6]">img</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {(addOpen || editItem) && (
        <InventoryFormModal
          mode={addOpen ? "add" : "edit"}
          item={editItem}
          onClose={() => { setAddOpen(false); setEditItem(null) }}
          onSave={saveItem}
        />
      )}

      {transferItem && (
        <TransferModal
          item={transferItem}
          onClose={() => setTransferItem(null)}
          onSave={(patch) => {
            void updateTransfer(transferItem.id, patch)
            setTransferItem(null)
          }}
        />
      )}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={importFromExcel} />}
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
  const { t } = useLanguage()
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
          <h2 className="text-lg font-bold uppercase tracking-wide">{mode === "add" ? t("Добавление инвентаря") : t("Изменение инвентаря")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </div>
        <div className="space-y-6 px-8 py-8">
          {mode === "edit" && <p className="text-xs text-[#9aa3b6]">{t("Текущий Клиент")}:</p>}
          <Field label={t("Склад")} required value={warehouse} onChange={setWarehouse} options={warehousesList} error={touched && !warehouse ? t("Обязательное поле") : ""} />
          <Field label={t("Продукт")} required value={product} onChange={setProduct} options={productTypes} error={touched && !product ? t("Обязательное поле") : ""} />
          <Field label={t("Состояние")} required value={condition} onChange={setCondition} options={conditions} error={touched && !condition ? t("Обязательное поле") : ""} />
          <Field label={t("Ответственный")} required value={responsible} onChange={setResponsible} options={responsibles} />
          <Field label={t("Клиент")} value={client} onChange={setClient} options={["Doston market", "Pepsi Market", "Usman Dembele"]} />
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Серийный номер")} <span className="text-red-500">*</span>
            <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !serialNumber && <p className="mt-1 text-sm text-[#e5484d]">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Инвентарный номер")} <span className="text-red-500">*</span>
            <input value={inventoryCode} onChange={(event) => setInventoryCode(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
            {touched && !inventoryCode && <p className="mt-1 text-sm text-[#e5484d]">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Дата")} <span className="text-red-500">*</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий...")} className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <div className="flex items-center justify-center border-t p-8 md:border-l md:border-t-0">
          <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]">
            <span className="text-2xl">🖼</span> {t("Добавьте фото")}
          </div>
        </div>
        <div className="col-span-full flex justify-end border-t px-8 py-5">
          <button onClick={submit} className="font-bold uppercase tracking-wide text-[#4f70e7]">{t("Сохранить")}</button>
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

function TransferModal({
  item,
  onClose,
  onSave,
}: {
  item: InventoryItem
  onClose: () => void
  onSave: (patch: Partial<InventoryItem>) => void
}) {
  const { t } = useLanguage()
  const [client, setClient] = useState("")
  const [date, setDate] = useState("")
  const [condition, setCondition] = useState(item.condition)
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{t("Передача / Изъятие")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-6 px-8 py-7">
          <h3 className="font-bold uppercase tracking-wide text-[#586174]">{t("Информация")}:</h3>
          <DetailRow label={t("Тип")} value={item.inventoryType} />
          <DetailRow label={t("Серийный номер")} value={item.serialNumber || "—"} />
          <DetailRow label={t("Инвентарный номер")} value={item.inventoryCode || "—"} />
          <h3 className="pt-3 font-bold uppercase tracking-wide text-[#586174]">{t("Передача")}</h3>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Передать клиенту")}
            <select value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Doston market</option><option>Pepsi Market</option><option>Usman Dembele</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Дата передачи")}
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Состояние")}
            <select value={condition} onChange={(event) => setCondition(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              {conditions.map((option) => <option key={option}>{option}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Комментарий...")} className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={() => onSave({ client, condition, attachDate: date || item.attachDate })}
            className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white"
          >
            {t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (file: File) => Promise<{ created: number; total: number; failed: number }> }) {
  const { t } = useLanguage()
  const [agent, setAgent] = useState("")
  const [zone, setZone] = useState("")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    if (!importFile) return
    setImporting(true)
    try {
      const { created, total, failed } = await onImport(importFile)
      if (!total) window.alert(t("Не удалось найти инвентарь для импорта в выбранном файле"))
      else if (failed) window.alert(`${t("Импортировано")} ${created} ${t("из")} ${total}. ${t("Не удалось сохранить")}: ${failed}`)
      onClose()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{t("Импорт с Excel")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Агент")}
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {responsibles.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Зона")}
            <select value={zone} onChange={(event) => setZone(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>Andijon shaharchasi</option><option>chilonzor</option><option>Yunusobod</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <button
            type="button"
            onClick={() => downloadExcelTable("inventory-import-template.xls", [[t("Серийный номер"), t("Клиент"), t("Тип инвентаря"), t("Инвентарный номер"), t("Склад"), t("Состояние"), t("Ответственный")]])}
            className="block w-full text-center font-semibold text-[#4f70e7]"
          >
            1. {t("Скачать шаблон")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setImportFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-[#dbe0e8] text-center text-sm text-[#586174]"
          >
            <FileText className="h-8 w-8" />
            <span>{importFile ? importFile.name : <>{t("Добавьте файл Excel или")} <span className="text-[#4f70e7]">{t("нажмите для выбора")}</span></>}</span>
          </button>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={handleSave}
            disabled={!importFile || importing}
            className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {importing ? t("Импорт...") : t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default InventoryManagementView
