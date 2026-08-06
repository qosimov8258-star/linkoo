"use client"

import { useMemo, useState } from "react"
import { Bookmark, ChevronDown, ChevronUp, Download, FolderOpen, Search, Star, X } from "lucide-react"

type Row = {
  product: string
  article: string
  barcode: string
  code: string
  type: string
  brand: string
  parentType: string
  productId: string
  inBlock: string
  warehouse: string
  organization: string
  blocksCount: number
  stock: number
  reserved: number
  stockKg: number
  reservedKg: number
  minStock: number
  skuCount: number
}

const rows: Row[] = [
  { product: "energetik 1 l", article: "123321", barcode: "4870001234567", code: "PRD-0001", type: "Напитки", brand: "Flash", parentType: "Напитки", productId: "P-1001", inBlock: "12 шт", warehouse: "Asosiy ombor", organization: "Linko", blocksCount: 26, stock: 306, reserved: 12, stockKg: 306, reservedKg: 12, minStock: 50, skuCount: 1 },
  { product: "g'ilof", article: "62", barcode: "4870002234567", code: "PRD-0002", type: "Упаковка", brand: "No brand", parentType: "Упаковка", productId: "P-1002", inBlock: "50 шт", warehouse: "Asosiy ombor", organization: "Linko", blocksCount: 1, stock: 19, reserved: 0, stockKg: 4, reservedKg: 0, minStock: 20, skuCount: 1 },
  { product: "robot moshina", article: "1009", barcode: "4870003234567", code: "PRD-0003", type: "Техника", brand: "Robot", parentType: "Техника", productId: "P-1003", inBlock: "1 шт", warehouse: "Tayyor mahsulotlar", organization: "Linko", blocksCount: 5215, stock: 5215, reserved: 120, stockKg: 5215, reservedKg: 120, minStock: 100, skuCount: 1 },
  { product: "sndwch", article: "334221", barcode: "4870004234567", code: "PRD-0004", type: "Продукты питания", brand: "Sendvich", parentType: "Продукты питания", productId: "P-1004", inBlock: "24 шт", warehouse: "Tayyor mahsulotlar", organization: "Linko", blocksCount: 51359, stock: 1232619, reserved: 4400, stockKg: 246524, reservedKg: 880, minStock: 5000, skuCount: 1 },
  { product: "334", article: "100-1232", barcode: "4870005234567", code: "PRD-0005", type: "oziq ovqat", brand: "No brand", parentType: "oziq ovqat", productId: "P-1005", inBlock: "10 шт", warehouse: "Asosiy ombor", organization: "Linko", blocksCount: 0, stock: 0, reserved: 0, stockKg: 0, reservedKg: 0, minStock: 10, skuCount: 1 },
  { product: "3453", article: "100-1232", barcode: "4870006234567", code: "PRD-0006", type: "Coca Cola", brand: "No brand", parentType: "oziq ovqat", productId: "P-1006", inBlock: "10 шт", warehouse: "Andijon ombori", organization: "Linko", blocksCount: 0, stock: 0, reserved: 0, stockKg: 0, reservedKg: 0, minStock: 10, skuCount: 1 },
  { product: "Alpen Gold Dark", article: "100-1232", barcode: "4870007234567", code: "PRD-0007", type: "Coca Cola", brand: "Alpen Gold", parentType: "oziq ovqat", productId: "P-1007", inBlock: "20 шт", warehouse: "Andijon ombori", organization: "Linko", blocksCount: 0, stock: 0, reserved: 0, stockKg: 0, reservedKg: 0, minStock: 15, skuCount: 1 },
  { product: "Alpen Goldfgd", article: "100-1232", barcode: "4870008234567", code: "PRD-0008", type: "oziq ovqat", brand: "Alpen Gold", parentType: "oziq ovqat", productId: "P-1008", inBlock: "20 шт", warehouse: "Xomashyo ombori", organization: "Linko", blocksCount: 550, stock: 11000, reserved: 300, stockKg: 2200, reservedKg: 60, minStock: 200, skuCount: 1 },
  { product: "Aqua de lux 0.33 bez gaz", article: "100-1232", barcode: "4870009234567", code: "PRD-0009", type: "Coca Cola", brand: "No brand", parentType: "Напитки", productId: "P-1009", inBlock: "24 шт", warehouse: "Asosiy ombor", organization: "Linko", blocksCount: 0, stock: 0, reserved: 0, stockKg: 0, reservedKg: 0, minStock: 30, skuCount: 1 },
  { product: "avto 1.3 mator", article: "100-1232", barcode: "4870010234567", code: "PRD-0010", type: "oziq ovqat", brand: "No brand", parentType: "Техника", productId: "P-1010", inBlock: "1 шт", warehouse: "Xomashyo ombori", organization: "Linko", blocksCount: 0, stock: 0, reserved: 0, stockKg: 0, reservedKg: 0, minStock: 5, skuCount: 1 },
]

const columnFields = [
  ["blocksCount", "Кол-во блоков"],
  ["stock", "Остаток"],
  ["reserved", "Забронировано"],
  ["stockKg", "Остаток кг"],
  ["stockMinusMin", "Остаток - минималний остаток"],
  ["reservedKg", "Забронировано кг"],
  ["skuCount", "Количество SKU"],
] as const

const groupFields = [
  ["warehouse", "Склад"],
  ["product", "Продукт"],
  ["article", "Артикул продукта"],
  ["barcode", "Штрих код продукта"],
  ["code", "Код продукта"],
  ["type", "Тип продукта"],
  ["brand", "Бренд"],
  ["minStock", "Минималний остаток"],
  ["parentType", "Родительский тип продукта"],
  ["productId", "ИД продукта"],
  ["inBlock", "В блоке"],
] as const

type ColumnKey = (typeof columnFields)[number][0]
type GroupKey = (typeof groupFields)[number][0]

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function fieldValue(row: Row, key: ColumnKey): number {
  if (key === "stockMinusMin") return row.stock - row.minStock
  return row[key]
}

function CheckboxColumn({
  title,
  search,
  onSearch,
  options,
  selected,
  onToggle,
}: {
  title: string
  search: string
  onSearch: (value: string) => void
  options: readonly (readonly [string, string])[]
  selected: Set<string>
  onToggle: (key: string) => void
}) {
  const filtered = options.filter(([, label]) => label.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")))
  return (
    <div className="min-w-0">
      <h3 className="mb-4 text-[19px] font-semibold text-[#17233b]">{title}</h3>
      <label className="relative mb-3 block border-b border-[#dbe0e8] pb-2">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={`Поиск ${title.toLocaleLowerCase("ru").startsWith("колон") ? "колонки" : title.toLocaleLowerCase("ru").includes("вертик") ? "вертикальных группировки" : "горизонтальных группировки"}...`}
          className="w-full bg-transparent pr-7 text-[15px] text-[#17233b] outline-none placeholder:text-[#9aa3b6]"
        />
        <Search className="absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
      </label>
      <ul className="space-y-3">
        {filtered.map(([key, label]) => (
          <li key={key}>
            <label className="flex cursor-pointer items-center gap-3 text-[15px] text-[#17233b]">
              <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} className="h-[18px] w-[18px] shrink-0 accent-[#4f71dc]" />
              {label}
            </label>
          </li>
        ))}
        {filtered.length === 0 && <li className="text-sm text-[#9aa3b6]">Ничего не найдено</li>}
      </ul>
    </div>
  )
}

function toggleInSet<T>(set: Set<T>, value: T) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function ReportBuilderView() {
  const [favorite, setFavorite] = useState(false)
  const [mode, setMode] = useState<"stock" | "warehouse">("stock")
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [dateRange, setDateRange] = useState("01 Авг. 2026 - 31 Авг. 2026")

  const [columnSearch, setColumnSearch] = useState("")
  const [verticalSearch, setVerticalSearch] = useState("")
  const [horizontalSearch, setHorizontalSearch] = useState("")

  const [selectedColumns, setSelectedColumns] = useState<Set<ColumnKey>>(new Set())
  const [verticalGroups, setVerticalGroups] = useState<Set<GroupKey>>(new Set())
  const [horizontalGroups, setHorizontalGroups] = useState<Set<GroupKey>>(new Set())

  const [showTotals, setShowTotals] = useState(true)
  const [filterProduct, setFilterProduct] = useState("Все продукты")
  const [filterWarehouse, setFilterWarehouse] = useState("Все склады")
  const [filterType, setFilterType] = useState("Все типы")
  const [filterBrand, setFilterBrand] = useState("Все бренды")
  const [filterOrganization, setFilterOrganization] = useState("Все организации")
  const [customFilters, setCustomFilters] = useState<{ id: number; field: GroupKey; value: string }[]>([])
  const [nextFilterId, setNextFilterId] = useState(1)

  const [savedReports, setSavedReports] = useState<{ id: number; name: string }[]>([])
  const [savedFlash, setSavedFlash] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [generated, setGenerated] = useState<{ columns: ColumnKey[]; vertical: GroupKey[]; horizontal: GroupKey[]; groups: { key: string; label: string; rows: Row[] }[] } | null>(null)

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filterProduct !== "Все продукты" && row.product !== filterProduct) return false
      if (filterWarehouse !== "Все склады" && row.warehouse !== filterWarehouse) return false
      if (filterType !== "Все типы" && row.type !== filterType) return false
      if (filterBrand !== "Все бренды" && row.brand !== filterBrand) return false
      if (filterOrganization !== "Все организации" && row.organization !== filterOrganization) return false
      for (const custom of customFilters) {
        if (!custom.value.trim()) continue
        const raw = custom.field === "minStock" ? String(row.minStock) : String(row[custom.field as keyof Row])
        if (!raw.toLocaleLowerCase("ru").includes(custom.value.trim().toLocaleLowerCase("ru"))) return false
      }
      return true
    })
  }, [customFilters, filterBrand, filterOrganization, filterProduct, filterType, filterWarehouse])

  const generateReport = () => {
    const verticalList = [...verticalGroups]
    const horizontalList = [...horizontalGroups]
    const columnsList: ColumnKey[] = selectedColumns.size ? [...selectedColumns] : ["stock"]
    const groupKeys = verticalList.length ? verticalList : (["product"] as GroupKey[])

    const map = new Map<string, { key: string; label: string; rows: Row[] }>()
    for (const row of filteredRows) {
      const key = groupKeys.map((field) => (field === "minStock" ? row.minStock : row[field])).join(" / ")
      const label = groupKeys.map((field) => (field === "minStock" ? String(row.minStock) : String(row[field]))).join(" / ")
      const existing = map.get(key)
      if (existing) existing.rows.push(row)
      else map.set(key, { key, label, rows: [row] })
    }

    setGenerated({ columns: columnsList, vertical: groupKeys, horizontal: horizontalList, groups: [...map.values()] })
    setSettingsOpen(false)
  }

  const exportReport = () => {
    const report = generated ?? (() => {
      generateReport()
      return null
    })()
    if (!report) return
    const header = [...report.vertical.map((key) => groupFields.find(([k]) => k === key)?.[1] ?? key), ...report.columns.map((key) => columnFields.find(([k]) => k === key)?.[1] ?? key)]
    const body = report.groups.map((group) => {
      const labelParts = group.label.split(" / ")
      const values = report.columns.map((key) => number(group.rows.reduce((sum, row) => sum + fieldValue(row, key), 0)))
      return [...labelParts, ...values]
    })
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "konstruktor-otcheta.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const saveReport = () => {
    setSavedReports((current) => [...current, { id: nextFilterId + 1000 + current.length, name: `Мой отчёт ${current.length + 1}` }])
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  const addCustomFilter = () => {
    setCustomFilters((current) => [...current, { id: nextFilterId, field: "product", value: "" }])
    setNextFilterId((value) => value + 1)
  }

  const productOptions = ["Все продукты", ...new Set(rows.map((row) => row.product))]
  const warehouseOptions = ["Все склады", ...new Set(rows.map((row) => row.warehouse))]
  const typeOptions = ["Все типы", ...new Set(rows.map((row) => row.type))]
  const brandOptions = ["Все бренды", ...new Set(rows.map((row) => row.brand))]
  const organizationOptions = ["Все организации", ...new Set(rows.map((row) => row.organization))]

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Конструктор</span>
        </button>

        <div className="flex overflow-hidden rounded-full shadow-sm">
          <button
            onClick={() => setMode("stock")}
            className={`px-6 py-2.5 text-[15px] font-bold tracking-wide ${mode === "stock" ? "bg-[#2bcd53] text-white" : "bg-white text-[#17233b]"}`}
          >
            ТЕКУЩИЙ ОСТАТОК
          </button>
          <button
            onClick={() => setMode("warehouse")}
            className={`px-6 py-2.5 text-[15px] font-bold tracking-wide ${mode === "warehouse" ? "bg-[#2bcd53] text-white" : "bg-white text-[#17233b]"}`}
          >
            СКЛАД
          </button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 border-b border-[#e1e5eb] bg-white px-6 py-4 md:px-9">
        <button onClick={saveReport} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
          <Bookmark className="h-5 w-5" /> {savedFlash ? "Сохранено ✓" : "Сохранить"}
        </button>

        <div className="relative">
          <button onClick={() => setReportsOpen((value) => !value)} className="flex h-11 items-center gap-2 rounded-md bg-[#ff8a65] px-5 font-semibold text-white">
            <FolderOpen className="h-5 w-5" /> Отчеты
          </button>
          {reportsOpen && (
            <div className="absolute left-0 top-12 z-30 w-64 rounded-md border border-[#e1e5eb] bg-white p-3 shadow-xl">
              {savedReports.length === 0 && <p className="px-2 py-3 text-sm text-[#9aa3b6]">Пока нет сохранённых отчётов</p>}
              {savedReports.map((saved) => (
                <button
                  key={saved.id}
                  onClick={() => { setReportsOpen(false); generateReport() }}
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-[#f2f5f8]"
                >
                  {saved.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={exportReport} className="flex h-11 items-center gap-2 rounded-md bg-[#4db6ac] px-5 font-semibold text-white">
          <Download className="h-5 w-5" /> Скачать
        </button>

        <input
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value)}
          className="h-11 min-w-[220px] bg-transparent px-2 text-[15px] font-semibold text-[#4f71dc] outline-none"
        />

        <button
          onClick={() => setSettingsOpen((value) => !value)}
          className="ml-auto flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold uppercase tracking-wide text-white"
        >
          {settingsOpen ? "Скрыть настройки" : "Показать настройки"}
          {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <button onClick={generateReport} className="flex h-11 items-center gap-2 rounded-md bg-[#2bcd53] px-6 font-semibold uppercase tracking-wide text-white">
          Сформировать отчет
        </button>
      </section>

      {settingsOpen && (
        <section className="grid grid-cols-1 gap-8 bg-white px-6 py-8 md:grid-cols-4 md:px-9">
          <CheckboxColumn title="Колонки" search={columnSearch} onSearch={setColumnSearch} options={columnFields} selected={selectedColumns} onToggle={(key) => setSelectedColumns((current) => toggleInSet(current, key as ColumnKey))} />
          <CheckboxColumn title="Вертикальная группировка" search={verticalSearch} onSearch={setVerticalSearch} options={groupFields} selected={verticalGroups} onToggle={(key) => setVerticalGroups((current) => toggleInSet(current, key as GroupKey))} />
          <CheckboxColumn title="Горизонтальнаяя группировка" search={horizontalSearch} onSearch={setHorizontalSearch} options={groupFields} selected={horizontalGroups} onToggle={(key) => setHorizontalGroups((current) => toggleInSet(current, key as GroupKey))} />

          <div className="min-w-0">
            <h3 className="mb-4 text-[19px] font-semibold text-[#17233b]">Фильтр</h3>
            <label className="mb-6 flex items-center gap-3 text-[15px] font-medium">
              <input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} className="h-[18px] w-[18px] accent-[#4f71dc]" />
              Показать итоги
            </label>

            {(
              [
                ["Продукт", filterProduct, setFilterProduct, productOptions],
                ["Склад", filterWarehouse, setFilterWarehouse, warehouseOptions],
                ["Тип продукта", filterType, setFilterType, typeOptions],
                ["Бренд", filterBrand, setFilterBrand, brandOptions],
                ["Организация", filterOrganization, setFilterOrganization, organizationOptions],
              ] as const
            ).map(([label, value, setter, options]) => (
              <label key={label} className="relative mb-7 block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                {label}
                <select value={value} onChange={(event) => setter(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                  {options.map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
              </label>
            ))}

            {customFilters.map((filter) => (
              <div key={filter.id} className="mb-4 flex items-end gap-2">
                <label className="block flex-1 border-b border-[#dbe0e8] pb-2 text-[13px] font-medium">
                  <select value={filter.field} onChange={(event) => setCustomFilters((current) => current.map((item) => item.id === filter.id ? { ...item, field: event.target.value as GroupKey } : item))} className="block w-full bg-transparent text-[14px] outline-none">
                    {groupFields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <input
                    value={filter.value}
                    onChange={(event) => setCustomFilters((current) => current.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item))}
                    placeholder="Значение..."
                    className="mt-1 block w-full bg-transparent text-[14px] outline-none placeholder:text-[#9aa3b6]"
                  />
                </label>
                <button aria-label="Удалить фильтр" onClick={() => setCustomFilters((current) => current.filter((item) => item.id !== filter.id))} className="mb-2 text-[#9aa3b6] hover:text-[#e5484d]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button onClick={addCustomFilter} className="w-full rounded-md bg-[#4f71dc] py-3 font-semibold uppercase tracking-wide text-white">
              Добавить индивидуальный фильтр
            </button>
          </div>
        </section>
      )}

      {generated && (
        <section className="overflow-x-auto bg-white px-6 pb-10 md:px-9">
          <table className="min-w-[900px] w-full border-collapse text-[15px]">
            <thead className="bg-[#edf2f7] text-[#253653]">
              <tr>
                {generated.vertical.map((key) => (
                  <th key={key} className="border border-[#e1e5eb] px-4 py-3 text-left font-semibold">{groupFields.find(([k]) => k === key)?.[1]}</th>
                ))}
                {generated.columns.map((key) => (
                  <th key={key} className="border border-[#e1e5eb] px-4 py-3 text-right font-semibold">{columnFields.find(([k]) => k === key)?.[1]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {generated.groups.map((group, index) => (
                <tr key={group.key} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  {group.label.split(" / ").map((part, partIndex) => (
                    <td key={partIndex} className="border border-[#e1e5eb] px-4 py-2.5">{part || "—"}</td>
                  ))}
                  {generated.columns.map((key) => (
                    <td key={key} className="border border-[#e1e5eb] px-4 py-2.5 text-right">{number(group.rows.reduce((sum, row) => sum + fieldValue(row, key), 0))}</td>
                  ))}
                </tr>
              ))}
              {showTotals && generated.groups.length > 0 && (
                <tr className="bg-[#edf2f7] font-semibold">
                  <td className="border border-[#e1e5eb] px-4 py-2.5" colSpan={generated.vertical.length}>Итого</td>
                  {generated.columns.map((key) => (
                    <td key={key} className="border border-[#e1e5eb] px-4 py-2.5 text-right">
                      {number(generated.groups.reduce((sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + fieldValue(row, key), 0), 0))}
                    </td>
                  ))}
                </tr>
              )}
              {generated.groups.length === 0 && (
                <tr><td colSpan={generated.vertical.length + generated.columns.length} className="border border-[#e1e5eb] px-4 py-10 text-center text-[#9aa3b6]">По заданным фильтрам ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
