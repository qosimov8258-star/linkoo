"use client"

import { useEffect, useMemo, useState } from "react"
import { Bookmark, ChevronDown, ChevronUp, Download, FolderOpen, Search, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage, monthRangeLabel } from "@/components/ref/report-kit"
import { CHECKBOX } from "./visit-builder-view"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

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

const rows: Row[] = []

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
  const { t } = useLanguage()
  const needle = search.trim().toLocaleLowerCase()
  const filtered = options.filter(([, label]) => label.toLocaleLowerCase("ru").includes(needle) || t(label).toLocaleLowerCase().includes(needle))
  return (
    <div className="min-w-0 border-r border-[#ececec] px-[20px] pb-[30px] pt-[20px] last:border-0">
      <h3 className="text-[15px] font-bold leading-[18px]">{t(title)}</h3>
      <label className="relative mt-[11px] block">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t(`Поиск ${title.toLocaleLowerCase("ru").startsWith("колон") ? "колонки" : title.toLocaleLowerCase("ru").includes("вертик") ? "вертикальных группировки" : "горизонтальных группировки"}...`)}
          className="h-[42px] w-full rounded-[3px] bg-[#f2f5f8] px-[11px] pr-10 text-[12px] outline-none placeholder:text-[#999]"
        />
        <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />
      </label>
      <div className="mt-[14px]">
        {filtered.map(([key, label]) => (
          <label key={key} className="flex min-h-[30px] cursor-pointer items-center gap-[9px] text-[13px] font-medium">
            <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} className={CHECKBOX} />
            {t(label)}
          </label>
        ))}
        {filtered.length === 0 && <p className="text-[13px] text-[#999]">{t("Ничего не найдено")}</p>}
      </div>
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
  const { t } = useLanguage()
  const [mode, setMode] = useState<"stock" | "warehouse">("stock")
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [dateRange, setDateRange] = useState(() => monthRangeLabel())

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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/saved-reports")
      .then((response) => (response.ok ? (response.json() as Promise<{ id: number; name: string }[]>) : []))
      .then((reports) => {
        if (!cancelled) setSavedReports(reports)
      })
      .catch(() => {
        // keep the empty local list if the request fails
      })
    return () => {
      cancelled = true
    }
  }, [])
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
    downloadExcelTable("konstruktor-otcheta.xls", [header, ...body])
  }

  const saveReport = async () => {
    if (saving) return
    setSaving(true)
    const name = `Мой отчёт ${savedReports.length + 1}`
    const config = {
      mode,
      dateRange,
      columns: [...selectedColumns],
      vertical: [...verticalGroups],
      horizontal: [...horizontalGroups],
      showTotals,
      filterProduct,
      filterWarehouse,
      filterType,
      filterBrand,
      filterOrganization,
      customFilters,
    }
    try {
      const response = await fetch("/api/saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      })
      if (response.ok) {
        const saved = (await response.json()) as { id: number; name: string }
        setSavedReports((current) => [...current, { id: saved.id, name: saved.name }])
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      }
    } catch {
      // ignore network failures, no flash on failure
    }
    setSaving(false)
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
    <ReportPage>
      <div className="pl-[28px] pr-[38px]">
        <RefHeader title="Конструктор">
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {([["stock", "ТЕКУЩИЙ ОСТАТОК"], ["warehouse", "СКЛАД"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setMode(key)} className={`h-[30px] px-4 text-[13px] font-medium ${mode === key ? "bg-[#2bcd53] text-white" : "bg-white text-black"}`}>{t(label)}</button>
            ))}
          </div>
        </RefHeader>
      </div>

      <div className="mx-7 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <section className="flex h-[60px] flex-wrap items-center gap-[15px] px-[30px]">
        <button onClick={() => void saveReport()} disabled={saving} className="flex h-[38px] items-center rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60">
          <Bookmark className="mr-3 h-[18px] w-[18px] fill-white" /> {savedFlash ? t("Сохранено ✓") : saving ? t("Сохранение...") : t("Сохранить")}
        </button>

        <div className="relative">
          <button onClick={() => setReportsOpen((value) => !value)} className="flex h-[38px] items-center rounded-[3px] bg-[#ff8a6f] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
            <FolderOpen className="mr-3 h-[18px] w-[18px] fill-white" /> {t("Отчеты")}
          </button>
          {reportsOpen && (
            <div className="absolute left-0 top-[42px] z-30 w-64 border border-[#e8e8e8] bg-white p-3 shadow-xl">
              {savedReports.length === 0 && <p className="px-2 py-3 text-[13px] text-[#999]">{t("Пока нет сохранённых отчётов")}</p>}
              {savedReports.map((saved) => (
                <button key={saved.id} onClick={() => { setReportsOpen(false); generateReport() }} className="block w-full rounded px-2 py-2 text-left text-[13px] hover:bg-[#f2f5f8]">{saved.name}</button>
              ))}
            </div>
          )}
        </div>

        <button onClick={exportReport} className="flex h-[38px] items-center rounded-[3px] bg-[#4db6ac] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
          <Download className="mr-3 h-[18px] w-[18px]" /> {t("Скачать")}
        </button>

        <div className="ml-auto flex items-center gap-[19px]">
          <input value={dateRange} onChange={(event) => setDateRange(event.target.value)} className="w-[190px] bg-transparent text-right text-[12px] font-bold text-[#4f71dc] outline-none" />
          <button onClick={() => setSettingsOpen((value) => !value)} className="h-[38px] w-[215px] rounded-[3px] bg-[#4f71dc] text-[13px] font-medium uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
            <span>{settingsOpen ? `${t("Скрыть настройки")} ▲` : `${t("Показать настройки")} ▼`}</span>
          </button>
          <button onClick={generateReport} className="h-[38px] w-[195px] rounded-[3px] bg-[#2bcd53] text-[13px] font-medium uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
            {t("Сформировать отчет")}
          </button>
        </div>
      </section>

      {settingsOpen && (
        <section className="grid grid-cols-1 border-t border-[#ececec] shadow-[0_2px_6px_rgba(0,0,0,0.12)] md:grid-cols-4">
          <CheckboxColumn title="Колонки" search={columnSearch} onSearch={setColumnSearch} options={columnFields} selected={selectedColumns} onToggle={(key) => setSelectedColumns((current) => toggleInSet(current, key as ColumnKey))} />
          <CheckboxColumn title="Вертикальная группировка" search={verticalSearch} onSearch={setVerticalSearch} options={groupFields} selected={verticalGroups} onToggle={(key) => setVerticalGroups((current) => toggleInSet(current, key as GroupKey))} />
          <CheckboxColumn title="Горизонтальная группировка" search={horizontalSearch} onSearch={setHorizontalSearch} options={groupFields} selected={horizontalGroups} onToggle={(key) => setHorizontalGroups((current) => toggleInSet(current, key as GroupKey))} />

          <div className="min-w-0 px-[20px] pb-[20px] pt-[20px]">
            <h3 className="text-[15px] font-bold leading-[18px]">{t("Фильтр")}</h3>
            <label className="mb-[8px] mt-[11px] flex cursor-pointer items-center gap-[9px] text-[13px] font-medium">
              <input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} className={CHECKBOX} />
              {t("Показать итоги")}
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
              <label key={label} className="relative mt-[22px] block h-[45px] border-b border-[#e0e0e0]">
                <span className="absolute inset-x-0 top-[18px] text-[13px] leading-[18px]">{value && !value.startsWith("Все") ? value : t(label)}</span>
                <select value={value} onChange={(event) => setter(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
                  {options.map((option) => <option key={option} value={option}>{option.startsWith("Все") ? t(option) : option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute bottom-[8px] right-0 h-4 w-4 text-[#999]" />
              </label>
            ))}

            {customFilters.map((filter) => (
              <div key={filter.id} className="mb-4 flex items-end gap-2">
                <label className="block flex-1 border-b border-[#dbe0e8] pb-2 text-[13px] font-medium">
                  <select value={filter.field} onChange={(event) => setCustomFilters((current) => current.map((item) => item.id === filter.id ? { ...item, field: event.target.value as GroupKey } : item))} className="block w-full bg-transparent text-[14px] outline-none">
                    {groupFields.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
                  </select>
                  <input
                    value={filter.value}
                    onChange={(event) => setCustomFilters((current) => current.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item))}
                    placeholder={t("Значение...")}
                    className="mt-1 block w-full bg-transparent text-[14px] outline-none placeholder:text-[#9aa3b6]"
                  />
                </label>
                <button aria-label={t("Удалить фильтр")} onClick={() => setCustomFilters((current) => current.filter((item) => item.id !== filter.id))} className="mb-2 text-[#9aa3b6] hover:text-[#e5484d]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button onClick={addCustomFilter} className="mt-[18px] h-9 w-full rounded-[3px] bg-[#4f71dc] text-[13px] font-medium uppercase text-white hover:brightness-95">
              <span>{t("Добавить индивидуальный фильтр")}</span>
            </button>
          </div>
        </section>
      )}
      </div>

      {generated && (
        <section className="mx-7 mt-3 overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <table className="min-w-[900px] w-full border-collapse text-[15px]">
            <thead className="bg-[#edf2f7] text-[#253653]">
              <tr>
                {generated.vertical.map((key) => (
                  <th key={key} className="border border-[#e1e5eb] px-4 py-3 text-left font-semibold">{t(groupFields.find(([k]) => k === key)?.[1] ?? "")}</th>
                ))}
                {generated.columns.map((key) => (
                  <th key={key} className="border border-[#e1e5eb] px-4 py-3 text-right font-semibold">{t(columnFields.find(([k]) => k === key)?.[1] ?? "")}</th>
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
                  <td className="border border-[#e1e5eb] px-4 py-2.5" colSpan={generated.vertical.length}>{t("Итого")}</td>
                  {generated.columns.map((key) => (
                    <td key={key} className="border border-[#e1e5eb] px-4 py-2.5 text-right">
                      {number(generated.groups.reduce((sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + fieldValue(row, key), 0), 0))}
                    </td>
                  ))}
                </tr>
              )}
              {generated.groups.length === 0 && (
                <tr><td colSpan={generated.vertical.length + generated.columns.length} className="border border-[#e1e5eb] px-4 py-10 text-center text-[#9aa3b6]">{t("По заданным фильтрам ничего не найдено")}</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </ReportPage>
  )
}
