"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  BarChart,
  ChevronDown,
  Expand,
  MapIcon,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

type Currency = "SUM" | "USD" | "Euro"
type Category = "unconfirmed" | "problem" | "planned-okb" | "closure"
type BalanceLine = { value: number; currency: Currency }

type ClientRow = {
  id: number
  name: string
  phone: string
  info?: string[]
  type: string
  zoneLabel: string
  zoneCity: string
  agent: string
  courier: string
  collector: string
  balance: BalanceLine[]
  colorBar: "green" | "red" | "gray" | "none"
  category: Category
  debtLimitType: "unlimited" | "amount"
  debtLimit?: number
  debtLimitCurrency?: Currency
}

const clients: ClientRow[] = []

const CATEGORY_TOTALS: Record<Category, number> = {
  unconfirmed: 0,
  problem: 0,
  "planned-okb": 0,
  closure: 0,
}
const TOTAL_ALL = 0

const debtLimitTypes =["Все типы", "Не ограничено", "По сумме"]
const problemSubTabs = ["Неправильный ИНН", "Нет территории", "Нет маршрута", "Все"] as const

const colorBarClass: Record<ClientRow["colorBar"], string> = {
  green: "bg-[#3aa76d]",
  red: "bg-[#e5484d]",
  gray: "bg-[#9aa3b6]",
  none: "bg-transparent",
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function BalanceCell({ lines }: { lines: BalanceLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className="space-y-0.5">
      {lines.map((line, index) => (
        <div key={index} className={line.value >= 0 ? "text-[#3aa76d]" : "text-[#e5484d]"}>
          {number(line.value)} {line.currency}
        </div>
      ))}
    </div>
  )
}

export function DebtLimitsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState(clients)
  const [tab, setTab] = useState<Category | "all">("unconfirmed")
  const [problemSubTab, setProblemSubTab] = useState<(typeof problemSubTabs)[number]>("Все")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [limitType, setLimitType] = useState(debtLimitTypes[0])
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [drawerTab, setDrawerTab] = useState<"activity" | "tasks" | "client" | "reports" | "refusals">("activity")
  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addDraft, setAddDraft] = useState({ name: "", phone: "", type: "" })
  const [addSaving, setAddSaving] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [bulkAction, setBulkAction] = useState<"edit" | "route" | null>(null)

  useEffect(() => {
    fetch("/api/debt-limits")
      .then((response) => (response.ok ? (response.json() as Promise<ClientRow[]>) : Promise.reject()))
      .then(setRows)
      .catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "all" && row.category !== tab) return false
      if (search.trim() && !row.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (limitType === "Не ограничено" && row.debtLimitType !== "unlimited") return false
      if (limitType === "По сумме" && row.debtLimitType !== "amount") return false
      return true
    })
  }, [limitType, rows, search, tab])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultFilters = !search.trim() && limitType === "Все типы"
  const fixedTotal = tab === "all" ? TOTAL_ALL : tab === "problem" ? CATEGORY_TOTALS.problem : CATEGORY_TOTALS[tab]
  const totalLabel = isDefaultFilters ? fixedTotal : filtered.length

  const changeTab = (value: Category | "all") => {
    setTab(value)
    setPage(1)
    setSelected(null)
  }

  const saveClientLimit = async (id: number, unlimited: boolean, limit: number, currency: Currency) => {
    try {
      const response = await fetch(`/api/debt-limits/${id}/limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlimited, limit, currency }),
      })
      if (!response.ok) {
        window.alert(t("Не удалось сохранить лимит"))
        return
      }
      const saved = (await response.json()) as ClientRow
      setRows((current) => current.map((row) => (row.id === id ? saved : row)))
      setSelected((current) => (current && current.id === id ? saved : current))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const deleteClient = async (id: number) => {
    try {
      const response = await fetch(`/api/debt-limits/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert(t("Не удалось удалить клиента"))
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
      setSelected(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const addPayment = async (id: number, amount: number, currency: Currency) => {
    try {
      const response = await fetch(`/api/debt-limits/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, currency }),
      })
      if (!response.ok) {
        window.alert(t("Не удалось добавить оплату"))
        return
      }
      const saved = (await response.json()) as ClientRow
      setRows((current) => current.map((row) => (row.id === id ? saved : row)))
      setSelected((current) => (current && current.id === id ? saved : current))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function submitAddClient(event: FormEvent) {
    event.preventDefault()
    if (!addDraft.name.trim()) return
    setAddSaving(true)
    try {
      const response = await fetch("/api/debt-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addDraft.name.trim(), phone: addDraft.phone.trim(), type: addDraft.type.trim() }),
      })
      if (!response.ok) {
        window.alert(t("Не удалось добавить клиента"))
        return
      }
      const created = (await response.json()) as ClientRow
      setRows((current) => [created, ...current])
      setAddDraft({ name: "", phone: "", type: "" })
      setAddOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setAddSaving(false)
    }
  }

  function downloadImportTemplate() {
    downloadExcelTable("shablon_klientov", [[t("Название"), t("Тел. номер"), t("Тип")]])
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(file)
      if (!excelRows.length) {
        window.alert(t("Не удалось найти клиентов для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], { "название": "name", "наименование": "name", "тел номер": "phone", "телефон": "phone", "тип": "type" })
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows
      const parsed: { name: string; phone: string; type: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.phone = row[1] ?? ""
          record.type = row[2] ?? ""
        }
        if (!record.name) continue
        parsed.push({ name: record.name, phone: record.phone || "", type: record.type || "" })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти клиентов для импорта в выбранном файле"))
        return
      }
      const created: ClientRow[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/debt-limits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ClientRow)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
      setImportOpen(false)
    } finally {
      setImportSaving(false)
    }
  }

  const downloadAll = () => {
    const header = [t("Название"), t("Тел. номер"), t("Тип"), t("Зона"), t("Ответственный агент"), t("Ответственный доставщик"), t("Ответственный инкассатор"), t("Тип лимита долга"), t("Лимит")]
    const body = filtered.map((row) => [
      row.name,
      row.phone,
      row.type,
      `${row.zoneLabel} ${row.zoneCity}`,
      row.agent,
      row.courier,
      row.collector,
      row.debtLimitType === "unlimited" ? t("Неограниченный долг") : t("По сумме"),
      row.debtLimitType === "unlimited" ? "" : `${number(row.debtLimit ?? 0)} ${row.debtLimitCurrency}`,
    ])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "clients.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Клиенты")}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={downloadAll} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><BarChart className="h-4 w-4" /> {t("Импортировать акции")}</button>
          <button onClick={() => setBulkAction("route")} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><MapIcon className="h-4 w-4" /> {t("Показать на карте")}</button>
          <button onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><Upload className="h-4 w-4" /> {t("Импортировать")}</button>
          <button onClick={() => setPage(1)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-4 font-semibold text-white"><RefreshCw className="h-4 w-4" /> {t("Обновить с excel")}</button>
          <button onClick={() => setAddOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-4 font-semibold text-white"><Plus className="h-4 w-4" /> {t("Добавить")}</button>
        </div>
      </header>

      <section className="grid grid-cols-1 border-b border-[#e1e5eb] bg-white text-center sm:grid-cols-5">
        {(
          [
            ["unconfirmed", "Не подтвержденные"],
            ["problem", "Проблемные"],
            ["planned-okb", "Плановый ОКБ"],
            ["closure", "Закрытие"],
            ["all", "Все"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => changeTab(key)}
            className={`border-b-2 py-4 text-[16px] font-medium ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {t(label)}
          </button>
        ))}
      </section>

      {tab === "problem" && (
        <section className="grid grid-cols-1 border-b border-[#e1e5eb] bg-white text-center sm:grid-cols-4">
          {problemSubTabs.map((label) => (
            <button
              key={label}
              onClick={() => setProblemSubTab(label)}
              className={`border-b-2 py-3 text-[15px] font-medium ${problemSubTab === label ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
            >
              {t(label)}
            </button>
          ))}
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {totalLabel}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
        <button onClick={() => setBulkAction("edit")} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white"><Pencil className="h-4 w-4" /> {t("Изменить")}</button>
        <button onClick={() => setBulkAction("route")} className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white"><TrendingUp className="h-4 w-4" /> {t("Уст. маршрут")}</button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Клиент")}
            <input placeholder={t("Введите имя...")} value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" />
          </label>
          {["Тип клиента", "Статус", "Показать только", "Последнее посещение", "Создал", "Зона", "Ответственный агент", "Ответственные доставщики", "Тип отказа", "Филиалы", "Инкассаторы", "Категория"].map((label) => (
            <label key={label} className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium text-[#17233b]">
              {t(label)}
              <select defaultValue="" className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                <option value="" />
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
            </label>
          ))}
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            {t("Тип лимита долга")}
            <select value={limitType} onChange={(event) => { setLimitType(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              {debtLimitTypes.map((option) => <option key={option} value={option}>{t(option)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-[15px] font-medium">
            <input type="checkbox" checked={limitType === "Не ограничено"} onChange={(event) => setLimitType(event.target.checked ? "Не ограничено" : "Все типы")} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Неограниченный долг")}
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1500px] w-full border-collapse text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="w-2 px-0 py-3" />
              {["Название", "Тел. номер", "Информация", "Тип", "Зона", "Ответственный агент", "Ответственный доставщик", "Ответственный инкассатор", "Баланс"].map((title) => (
                <th key={title} className="whitespace-nowrap px-4 py-3 text-left font-semibold">{t(title)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={row.id} onClick={() => { setSelected(row); setDrawerTab("activity") }} className={`cursor-pointer border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} hover:bg-[#eef2ff]`}>
                <td className={`w-2 p-0 ${colorBarClass[row.colorBar]}`} />
                <td className="px-4 py-3.5 font-medium text-[#4f70e7]">{row.name}</td>
                <td className="px-4 py-3.5">{row.phone}</td>
                <td className="px-4 py-3.5 text-[13px]">{row.info?.map((line, lineIndex) => <div key={lineIndex}>{line.includes(":") ? <>{line.split(":")[0]}: <b>{line.split(":").slice(1).join(":").trim()}</b></> : line}</div>)}</td>
                <td className="px-4 py-3.5">{row.type}</td>
                <td className="px-4 py-3.5">{row.zoneLabel}<br /><span className="text-[#4f70e7]">{row.zoneCity}</span></td>
                <td className="px-4 py-3.5">{row.agent}</td>
                <td className="px-4 py-3.5">{row.courier}</td>
                <td className="px-4 py-3.5">{row.collector}</td>
                <td className="px-4 py-3.5"><BalanceCell lines={row.balance} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-16 text-center text-[#9aa3b6]">{t("Ничего не найдено")}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && <ClientDrawer client={selected} tab={drawerTab} setTab={setDrawerTab} onClose={() => setSelected(null)} onSaveLimit={saveClientLimit} onDelete={deleteClient} onAddPayment={addPayment} />}

      {importOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setImportOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">{t("Импорт с Excel")}</h2>
              <button aria-label={t("Закрыть")} onClick={() => setImportOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="px-8 py-7">
              <button type="button" onClick={downloadImportTemplate} className="mb-4 block w-full text-center font-semibold text-[#4f70e7]">{t("1. Скачать шаблон")}</button>
              <label className="flex h-44 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#dbe0e8] text-[#586174] cursor-pointer">
                <Upload className="h-6 w-6" />
                <span>{importSaving ? t("Импорт...") : <>{t("Добавьте файл Excel или")} <span className="text-[#4f70e7] underline">{t("нажмите для выбора")}</span></>}</span>
                <input ref={importInputRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} disabled={importSaving} className="hidden" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={() => setImportOpen(false)} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">{t("Закрыть")}</button>
            </footer>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setAddOpen(false)}>
          <form onSubmit={submitAddClient} onClick={(event) => event.stopPropagation()} className="w-[480px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">{t("Добавить клиента")}</h2>
              <button type="button" aria-label={t("Закрыть")} onClick={() => setAddOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="space-y-6 px-8 py-7">
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Название")}
                <input autoFocus value={addDraft.name} onChange={(event) => setAddDraft((value) => ({ ...value, name: event.target.value }))} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Тел. номер")}
                <input value={addDraft.phone} onChange={(event) => setAddDraft((value) => ({ ...value, phone: event.target.value }))} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Тип")}
                <input value={addDraft.type} onChange={(event) => setAddDraft((value) => ({ ...value, type: event.target.value }))} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button type="submit" disabled={addSaving} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87] disabled:opacity-60">
                {addSaving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {bulkAction && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setBulkAction(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">{bulkAction === "edit" ? t("Изменить") : t("Установить маршрут")}</h2>
            <p className="mb-6 text-[#586174]">{t("Будет применено к")} {filtered.length} {t("клиентам из текущей выборки.")}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setBulkAction(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">{t("Отмена")}</button>
              <button onClick={() => setBulkAction(null)} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">{t("Применить")}</button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

function ClientDrawer({
  client,
  tab,
  setTab,
  onClose,
  onSaveLimit,
  onDelete,
  onAddPayment,
}: {
  client: ClientRow
  tab: "activity" | "tasks" | "client" | "reports" | "refusals"
  setTab: (value: "activity" | "tasks" | "client" | "reports" | "refusals") => void
  onClose: () => void
  onSaveLimit: (id: number, unlimited: boolean, limit: number, currency: Currency) => void
  onDelete: (id: number) => void
  onAddPayment: (id: number, amount: number, currency: Currency) => void
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const [unlimited, setUnlimited] = useState(client.debtLimitType === "unlimited")
  const [limit, setLimit] = useState(String(client.debtLimit ?? ""))
  const [currency, setCurrency] = useState<Currency>(client.debtLimitCurrency ?? "SUM")
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentCurrency, setPaymentCurrency] = useState<Currency>("SUM")
  const hasPhone = client.phone && client.phone !== "-"

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button aria-label={t("Закрыть")} onClick={onClose} className="flex-1 bg-black/40" />
      <aside className="w-[680px] max-w-[96vw] overflow-y-auto bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b px-6 py-5">
          <span className={`h-3 w-3 rounded-full ${colorBarClass[client.colorBar] || "bg-[#9aa3b6]"}`} />
          <h2 className="flex-1 text-lg font-bold uppercase tracking-wide">{client.name}</h2>
          <button type="button" onClick={() => setTab("client")} aria-label={t("Редактировать")} className="text-[#586174] hover:text-[#17233b]"><Pencil className="h-5 w-5" /></button>
          <button type="button" onClick={() => onDelete(client.id)} aria-label={t("Удалить")} className="text-[#e5484d] hover:text-[#c53238]"><Trash2 className="h-5 w-5" /></button>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>

        <nav className="flex border-b text-[13px] font-bold uppercase tracking-wide">
          {(
            [
              ["activity", "Активность"],
              ["tasks", "Задачи"],
              ["client", "Клиент"],
              ["reports", "Отчеты"],
              ["refusals", "Отказы"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`flex-1 border-b-2 py-4 ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}>{t(label)}</button>
          ))}
        </nav>

        {tab === "activity" && (
          <div className="space-y-8 px-6 py-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <p className="text-[#586174]">{t("Фактические продажи (30 дней)")}</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">{t("Прошло дней с последнего заказа")}</p>
                <p className="text-xl font-bold text-[#e5484d]">0</p>
              </div>
              <div>
                <p className="text-[#586174]">{t("Сумма продаж за период (30 дней)")}</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">{t("Прошло дней с последнего визита")}</p>
                <p className="text-xl font-bold text-[#e5484d]">0</p>
              </div>
              <div>
                <p className="text-[#586174]">{t("Сумма возврата с заказов за период (30 дней)")}</p>
                <p className="text-xl font-bold">0 SUM</p>
              </div>
              <div>
                <p className="text-[#586174]">{t("Комментарий отказа")}</p>
                <p className="text-xl font-bold">{t("Не указан")}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!hasPhone}
                onClick={() => hasPhone && (window.location.href = `tel:${client.phone}`)}
                className="flex items-center gap-2 rounded-md bg-[#6fcf97] px-5 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Phone className="h-4 w-4" /> {t("Позвонить")}
              </button>
              <button type="button" onClick={() => router.push("/analytics/sales")} className="flex items-center gap-2 rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white"><ShoppingCart className="h-4 w-4" /> {t("Заказать")}</button>
              <button type="button" onClick={() => setTab("refusals")} className="flex items-center gap-2 rounded-md bg-[#e5484d] px-5 py-2.5 font-semibold text-white"><XCircle className="h-4 w-4" /> {t("Отказ")}</button>
              <button type="button" onClick={() => setPaymentOpen(true)} className="flex items-center gap-2 rounded-md bg-[#3aa76d] px-5 py-2.5 font-semibold text-white"><Wallet className="h-4 w-4" /> {t("Добавить оплату")}</button>
            </div>

            {paymentOpen && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const amount = Number(paymentAmount)
                    if (amount > 0) onAddPayment(client.id, amount, paymentCurrency)
                    setPaymentAmount("")
                    setPaymentOpen(false)
                  }}
                  className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="text-lg font-bold">{t("Добавить оплату")}</h3>
                    <button type="button" onClick={() => setPaymentOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
                  </div>
                  <label className="mb-4 block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                    {t("Сумма")}
                    <input autoFocus type="number" min="0" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
                  </label>
                  <label className="mb-5 block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                    {t("Валюта")}
                    <select value={paymentCurrency} onChange={(event) => setPaymentCurrency(event.target.value as Currency)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none">
                      <option value="SUM">SUM</option>
                      <option value="USD">USD</option>
                      <option value="Euro">Euro</option>
                    </select>
                  </label>
                  <button type="submit" className="w-full rounded-md bg-[#3aa76d] py-3 font-semibold text-white">{t("Добавить")}</button>
                </form>
              </div>
            )}

            <div>
              <h3 className="mb-3 text-lg font-bold">{t("Агенты магазина")}</h3>
              <table className="w-full border-collapse text-[14px]">
                <thead className="text-[#586174]"><tr><th className="border-b py-2 text-left font-semibold">{t("Агент")}</th><th className="border-b py-2 text-left font-semibold">{t("Комментарий")}</th><th className="border-b py-2 text-left font-semibold">{t("Прайс лист")}</th><th className="border-b py-2" /></tr></thead>
                <tbody><tr><td className="py-6 text-center text-[#9aa3b6]" colSpan={4}>{t("Нет данных")}</td></tr></tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-bold">{t("Маршруты")}</h3>
              <table className="w-full border-collapse text-[14px]">
                <thead className="text-[#586174]"><tr><th className="border-b py-2 text-left font-semibold">{t("Агент")}</th><th className="border-b py-2 text-left font-semibold">{t("Частота посещения")}</th><th className="border-b py-2 text-left font-semibold">{t("Дни недели")}</th><th className="border-b py-2" /></tr></thead>
                <tbody>
                  <tr>
                    <td className="border-b py-3">{client.agent}</td>
                    <td className="border-b py-3">{t("Раз в неделю")}</td>
                    <td className="border-b py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                          <span key={day} className="rounded-sm bg-[#f6f9fc] px-2 py-1 text-[13px]">{t(day)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="border-b py-3"><Pencil className="h-4 w-4 text-[#586174]" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-bold">{t("Баланс")}</h3>
                <span className="text-[#4f70e7]">{t("05 Июля 2026 - 04 Авг. 2026")}</span>
              </div>
              <BalanceCell lines={client.balance} />
              {client.balance.length === 0 && <p className="text-[#9aa3b6]">0</p>}
              <p className="mt-3 text-[#586174]">{t("Последняя дата платежа")}: <span className="font-semibold text-[#17233b]">{t("01 янв. 2020")}</span></p>
            </div>
          </div>
        )}

        {tab === "client" && (
          <div className="space-y-7 px-6 py-6">
            <h3 className="text-lg font-bold">{t("Лимит долга")}</h3>
            <label className="flex items-center gap-2 text-[15px] font-medium">
              <input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
              {t("Неограниченный долг")}
            </label>
            {!unlimited && (
              <>
                <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                  {t("Лимит")}
                  <input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
                </label>
                <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                  {t("Валюта")}
                  <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
                    <option value="SUM">SUM</option>
                    <option value="USD">USD</option>
                    <option value="Euro">Euro</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
                </label>
              </>
            )}
            <button
              onClick={() => onSaveLimit(client.id, unlimited, Number(limit) || 0, currency)}
              className="rounded-md bg-[#4f70e7] px-6 py-3 font-semibold text-white"
            >
              {t("Сохранить")}
            </button>

            <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-t pt-6 text-[15px]">
              <div><p className="text-[#586174]">{t("Телефон")}</p><p className="font-semibold">{client.phone}</p></div>
              <div><p className="text-[#586174]">{t("Тип")}</p><p className="font-semibold">{client.type}</p></div>
              <div><p className="text-[#586174]">{t("Ответственный агент")}</p><p className="font-semibold">{client.agent}</p></div>
              <div><p className="text-[#586174]">{t("Ответственный доставщик")}</p><p className="font-semibold">{client.courier}</p></div>
            </div>
          </div>
        )}

        {(tab === "tasks" || tab === "reports" || tab === "refusals") && (
          <div className="flex flex-col items-center justify-center py-24">
            <Image src="/robot-mascot.png" alt={t("Робот-помощник")} width={110} height={110} className="h-24 w-24 object-contain" />
            <p className="mt-4 text-[#9aa3b6]">{t("Нет данных")}</p>
          </div>
        )}
      </aside>
    </div>
  )
}
