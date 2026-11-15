"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bookmark, Download, FolderOpen, Info, Search, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { CHECKBOX, INFO_HINTS, INFO_ITEMS, salesColumns, salesFilters, salesGroupings } from "./visit-builder-view"
import { BuilderPeriod, currentMonthPeriod, isoParam } from "./builder-period"
import { savedList, savedPeriod, savedRecord, useBuilderSaves } from "./builder-saves"
import { BuilderNoData, BuilderTable, builderNumber } from "./builder-table"
import { appCurrencyColumn, useAppCurrency } from "@/lib/app-currency-context"
import { useLanguage } from "@/lib/i18n/language-context"
import type { NewReportBuilderSave } from "@/lib/new-report-builder-types"
import type { BuilderResult } from "@/lib/report-builder-repo"

const mainReportTypes = ["ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ", "ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ СОЗДАНИЯ", "ПРОДУКТЫ ЗАКАЗОВ ПО ДАТЕ СОЗДАНИЯ"]
const otherReportTypes = ["Продукты заказов по дате по дате доставки", "Продукты заказов по дате реализации со склада", "Возвраты", "Возвраты по дате приемки", "Отказы", "Заказы по дате доставки", "Задачи", "Склад", "Остаток партий", "Магазины"]
const reportTypes = [...mainReportTypes, ...otherReportTypes]
/** The models whose documents are this app's orders (lib/report-builder-repo.ts): the rest have no data source here. */
const SALES_MODELS = new Set([...mainReportTypes, "Продукты заказов по дате по дате доставки", "Продукты заказов по дате реализации со склада", "Заказы по дате доставки"])
/** Prefix of an individual filter's key (lib/report-builder-repo.ts): the grouping's value contains the text. */
const CUSTOM_FILTER = "*"

type CustomFilter = { field: string; value: string }
type Period = { from: string; to: string }

function OptionList({ title, placeholder, items, selected, onToggle }: { title: string; placeholder: string; items: string[]; selected: string[]; onToggle: (item: string) => void }) {
  const { t } = useLanguage()
  const appCurrency = useAppCurrency()
  const [query, setQuery] = useState("")
  const needle = query.trim().toLocaleLowerCase("ru")
  const visible = items.filter((item) => !needle || t(item).toLocaleLowerCase("ru").includes(needle) || item.toLocaleLowerCase("ru").includes(needle))
  return (
    <section className="min-w-0 px-[20px] pb-[30px] pt-[18px]">
      <h2 className="text-[15px] font-semibold leading-[18.75px]">{t(title)}</h2>
      <label className="relative mt-[11px] block">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(placeholder)} className="h-[42px] w-full rounded-[3px] bg-[#f2f5f8] px-[11px] pr-10 text-[12px] outline-none placeholder:text-[#999]" />
        <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />
      </label>
      <div className="mt-[11px]">
        {visible.map((item) => (
          <label key={item} className={`flex ${INFO_ITEMS.has(item) ? "min-h-[34px]" : "min-h-[30px]"} cursor-pointer items-center gap-[9px] text-[13px] font-semibold`}>
            <input type="checkbox" checked={selected.includes(item)} onChange={() => onToggle(item)} className={`${CHECKBOX} ml-[3px]`} />
            {appCurrencyColumn(item, t, appCurrency)}
            {INFO_ITEMS.has(item) && (
              <span title={INFO_HINTS[item] ? t(INFO_HINTS[item]) : t(item)} className="inline-flex">
                <Info className="h-[18px] w-[18px] text-[#555]" />
              </span>
            )}
          </label>
        ))}
        {visible.length === 0 && <p className="text-[13px] text-[#999]">{t("Ничего не найдено")}</p>}
      </div>
    </section>
  )
}

function FilterSelect({ label, value, onChange, options, first = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; first?: boolean }) {
  const { t } = useLanguage()
  return (
    <label className={`relative ml-[7px] mr-[13px] block h-[45px] border-b border-[#e0e0e0] ${first ? "mt-[9px]" : "mt-[22px]"}`}>
      <span className={`absolute inset-x-0 top-[21px] truncate pr-6 text-[13px] leading-[18px] ${value ? "font-semibold text-[#1E4A9A]" : "text-black"}`}>{value ? value : t(label)}</span>
      <select aria-label={t(label)} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        <option value="">{t(label)}</option>
        {options.map((option, index) => <option key={`${option}-${index}`} value={option}>{option}</option>)}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[4px] right-0 h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}

/** The URL of the page (the reference keeps beginDate / endDate / openGrouping in it). */
function writeUrl(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search)
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name)
    else params.set(name, value)
  }
  const query = params.toString()
  window.history.replaceState(window.history.state, "", query ? `${window.location.pathname}?${query}` : window.location.pathname)
}

export function NewReportBuilderView() {
  const { t } = useLanguage()
  const [type, setType] = useState(reportTypes[0])
  const [othersOpen, setOthersOpen] = useState(false)
  const othersRef = useRef<HTMLDivElement>(null)
  const isOtherActive = otherReportTypes.includes(type)
  const [settings, setSettings] = useState(true)
  const [period, setPeriod] = useState<Period>(currentMonthPeriod)
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [vertical, setVertical] = useState<string[]>([])
  const [horizontal, setHorizontal] = useState<string[]>([])
  const [showTotals, setShowTotals] = useState(true)
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({})
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([])
  const [result, setResult] = useState<BuilderResult | null>(null)
  /** "none": the generated report is empty (or the model has no data here). */
  const [shown, setShown] = useState<"table" | "none" | null>(null)
  const [dirty, setDirty] = useState(true)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState("")

  // The period and the settings panel of the URL (?beginDate=…&endDate=…&openGrouping=…), as the reference keeps them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const from = isoParam(params.get("beginDate"))
    const to = isoParam(params.get("endDate"))
    if (from && to && from <= to) setPeriod({ from, to })
    if (params.get("openGrouping") === "false") setSettings(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/report-builder?kind=sales")
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, string[]>>) : Promise.reject()))
      .then((data) => { if (!cancelled) setFilterOptions(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const changed = useCallback(() => setDirty(true), [])

  const toggleIn = (list: string[], item: string) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item])
  const toggleColumn = (item: string) => { setSelectedColumns((current) => toggleIn(current, item)); changed() }
  // A grouping is either vertical or horizontal: the one chosen in a list leaves the other list.
  const toggleVertical = (item: string) => { setVertical((current) => toggleIn(current, item)); setHorizontal((current) => current.filter((value) => value !== item)); changed() }
  const toggleHorizontal = (item: string) => { setHorizontal((current) => toggleIn(current, item)); setVertical((current) => current.filter((value) => value !== item)); changed() }

  const showSettings = (open: boolean) => {
    setSettings(open)
    writeUrl({ openGrouping: String(open) })
  }

  const applyPeriod = (from: string, to: string) => {
    setPeriod({ from, to })
    changed()
    writeUrl({ beginDate: from, endDate: to, openGrouping: String(settings) })
  }

  const chooseType = (item: string) => {
    setType(item)
    setOthersOpen(false)
    setResult(null)
    setShown(null)
    changed()
  }

  async function generate(): Promise<BuilderResult | null> {
    setMessage("")
    if (!SALES_MODELS.has(type) || selectedColumns.length === 0) {
      // The reference answers an empty request (or a model without documents here) with its no-data page.
      setResult(null)
      setShown("none")
      setDirty(false)
      showSettings(false)
      return null
    }
    setRunning(true)
    try {
      const filters: Record<string, string> = { ...filterValues }
      for (const filter of customFilters) if (filter.field && filter.value.trim()) filters[`${CUSTOM_FILTER}${filter.field}`] = filter.value.trim()
      const response = await fetch("/api/report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "sales", tab: type.toUpperCase(), from: period.from, to: period.to, columns: selectedColumns, vertical, horizontal, filters, showTotals }),
      })
      const data = (await response.json().catch(() => null)) as (BuilderResult & { error?: string }) | null
      if (!response.ok || !data || data.error) {
        setMessage(t(data?.error || "Не удалось сформировать отчет"))
        return null
      }
      setResult(data)
      setShown(data.rows.length ? "table" : "none")
      setDirty(false)
      showSettings(false)
      const notes = [
        data.unsupported.length ? `${t("Нет данных для")}: ${data.unsupported.map((item) => t(item)).join(", ")}` : "",
        data.missingRates?.length ? `${t("Курс валюты не задан")}: ${data.missingRates.join(", ")}` : "",
      ].filter(Boolean)
      if (notes.length) setMessage(notes.join(". "))
      return data
    } catch {
      setMessage(t("Не удалось сформировать отчет"))
      return null
    } finally {
      setRunning(false)
    }
  }

  const exportExcel = async () => {
    const data = !dirty && result ? result : await generate()
    if (!data || !data.rows.length) return
    const vert = data.vertical ?? []
    const columns = data.columns ?? []
    const keys = data.keys?.length ? data.keys : [""]
    const header = [...(vert.length ? vert.map((name) => t(name)) : [""]), ...columns.flatMap((column) => keys.map((key) => [key, t(column)].filter(Boolean).join(" · ")))]
    const cell = (row: (string | number)[], key: number, column: number) => {
      const value = row[vert.length + key * columns.length + column]
      return typeof value === "number" ? builderNumber(value) : value
    }
    const body = data.rows.map((row) => [...(vert.length ? row.slice(0, vert.length) : [""]), ...columns.flatMap((_, column) => keys.map((__, key) => cell(row, key, column)))])
    const totals = data.totals ? [[t("Итого"), ...vert.slice(1).map(() => ""), ...columns.flatMap((_, column) => keys.map((__, key) => cell(data.totals as (string | number)[], key, column)))]] : []
    downloadExcelTable(`${t("Конструктор")}.xls`, [header, ...body, ...totals])
  }

  useEffect(() => {
    if (!othersOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOthersOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [othersOpen])

  useEffect(() => {
    if (!othersOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (othersRef.current && !othersRef.current.contains(event.target as Node)) setOthersOpen(false)
    }
    window.addEventListener("mousedown", onPointerDown)
    return () => window.removeEventListener("mousedown", onPointerDown)
  }, [othersOpen])

  /** A saved report of this constructor back on screen: its model and every setting. */
  const loadSavedReport = (report: NewReportBuilderSave) => {
    const config = report.config
    setType(reportTypes.includes(report.reportType) ? report.reportType : type)
    setSelectedColumns(savedList(config.selectedColumns))
    setVertical(savedList(config.vertical ?? config.verticalGroups))
    setHorizontal(savedList(config.horizontal ?? config.horizontalGroups))
    setShowTotals(typeof config.showTotals === "boolean" ? config.showTotals : true)
    setFilterValues(savedRecord(config.filterValues))
    setCustomFilters(Array.isArray(config.customFilters) ? (config.customFilters as unknown[]).filter((item): item is CustomFilter => !!item && typeof item === "object" && typeof (item as CustomFilter).field === "string" && typeof (item as CustomFilter).value === "string") : [])
    const next = savedPeriod(config)
    setPeriod(next)
    writeUrl({ beginDate: next.from, endDate: next.to, openGrouping: "true" })
    setSettings(true)
    setResult(null)
    setShown(null)
    setDirty(true)
  }

  const saves = useBuilderSaves({
    page: "general",
    snapshot: () => ({
      reportType: type,
      config: { selectedColumns, vertical, horizontal, showTotals, filterValues, customFilters, from: period.from, to: period.to },
    }),
    onLoad: loadSavedReport,
    onMessage: setMessage,
  })

  const filterKeys = salesFilters
  const generateIdle = !dirty && shown !== null

  return <ReportPage>
    <div className="pl-[30px] pr-[38px]">
      <RefHeader title={t("Конструктор")}>
        <div className="flex shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {mainReportTypes.map((item, index) => <button type="button" key={item} onClick={() => chooseType(item)} className={`h-[32px] px-4 text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${type === item ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(item)}</button>)}
          <div ref={othersRef} className="relative">
            <button type="button" aria-expanded={othersOpen} onClick={() => setOthersOpen((value) => !value)} className={`h-[32px] rounded-r-[3px] px-4 text-[13px] font-medium ${isOtherActive ? "bg-[#2bcd53] text-white" : "bg-white text-black"}`}>{isOtherActive ? t(type) : t("ДРУГИЕ")}</button>
            {othersOpen && <div role="menu" className="absolute right-0 top-full z-50 mt-1 max-h-[420px] w-[380px] overflow-y-auto border border-[#e8e8e8] bg-white shadow-xl">{otherReportTypes.map((item) => <button type="button" role="menuitem" key={item} onClick={() => chooseType(item)} className={`block w-full border-b border-[#f1f1f1] px-5 py-3 text-left text-[13px] last:border-b-0 hover:bg-[#f2f5f8] ${type === item ? "bg-[#f2f5f8] font-semibold text-[#1E4A9A]" : ""}`}>{t(item)}</button>)}</div>}
          </div>
        </div>
      </RefHeader>
    </div>
    <section className="mx-7 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="flex min-h-[60px] flex-wrap items-center gap-[15px] px-[30px]">
        <button type="button" onClick={saves.openSave} className="flex h-[36px] items-center rounded-[3px] bg-[#1E4A9A] px-[15px] text-[13px] text-white hover:brightness-95"><Bookmark className="mr-[10px] h-[18px] w-[18px] fill-white" />{t("Сохранить")}</button>
        <button type="button" onClick={saves.openReports} className="flex h-[36px] items-center rounded-[3px] bg-[#ff8a65] px-[15px] text-[13px] text-white hover:brightness-95"><FolderOpen className="mr-[10px] h-[18px] w-[18px] fill-white" />{t("Отчеты")}</button>
        <button type="button" onClick={() => void exportExcel()} className="flex h-[36px] items-center rounded-[3px] bg-[#4db6ac] px-[15px] text-[13px] text-white hover:brightness-95"><Download className="mr-[10px] h-[18px] w-[18px]" />{t("Скачать")}</button>
        <div className="ml-auto flex flex-wrap items-center gap-[19px]">
          <BuilderPeriod from={period.from} to={period.to} onApply={applyPeriod} align="right" />
          <button type="button" aria-expanded={settings} onClick={() => showSettings(!settings)} className="flex h-[36px] w-[215px] items-center justify-center gap-[8px] rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
            <span>{settings ? t("СКРЫТЬ НАСТРОЙКИ") : t("ПОКАЗАТЬ НАСТРОЙКИ")}</span>
            <svg viewBox="0 0 10 6" aria-hidden className={`h-[6px] w-[10px] fill-white ${settings ? "rotate-180" : ""}`}><path d="M0 0h10L5 6z" /></svg>
          </button>
          <button type="button" disabled={running} onClick={() => void generate()} className={`h-[36px] w-[195px] rounded-[3px] bg-[#2bcd53] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95 disabled:cursor-wait ${generateIdle || running ? "opacity-50" : ""}`}>{t("СФОРМИРОВАТЬ ОТЧЕТ")}</button>
        </div>
      </div>
      {message && <div className="flex items-center justify-between border-t border-blue-100 bg-blue-50 px-[30px] py-2 text-[13px] text-blue-700">{message}<button type="button" onClick={() => setMessage("")} aria-label={t("Закрыть сообщение")}>×</button></div>}
      {settings && (
        <div className="grid grid-cols-1 divide-y divide-[#ececec] border-t border-[#ececec] shadow-[0_2px_6px_rgba(0,0,0,0.12)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <OptionList title="Колонки" placeholder="Поиск колонки..." items={salesColumns} selected={selectedColumns} onToggle={toggleColumn} />
          <OptionList title="Вертикальная групировка" placeholder="Поиск вертикальных группировки..." items={salesGroupings.filter((item) => !horizontal.includes(item))} selected={vertical} onToggle={toggleVertical} />
          <OptionList title="Горизонтальная групировка" placeholder="Поиск горизонтальных группировки..." items={salesGroupings.filter((item) => !vertical.includes(item))} selected={horizontal} onToggle={toggleHorizontal} />
          <section className="pb-[20px] pl-[23px] pr-[17px] pt-[18px]">
            <h2 className="text-[15px] font-semibold leading-[18.75px]">{t("Фильтр")}</h2>
            <label className="mt-[11px] flex cursor-pointer items-center gap-[9px] text-[13px] font-semibold"><input type="checkbox" checked={showTotals} onChange={(event) => { setShowTotals(event.target.checked); changed() }} className={CHECKBOX} />{t("Показать итоги")}</label>
            {filterKeys.map((label, index) => (
              <FilterSelect key={label} first={index === 0} label={label} value={filterValues[label] ?? ""} options={filterOptions[label] ?? []} onChange={(value) => { setFilterValues((current) => ({ ...current, [label]: value })); changed() }} />
            ))}
            {customFilters.map((filter, index) => (
              <div key={index} className="mt-[18px] flex items-end gap-[8px]">
                <select aria-label={t("Индивидуальный фильтр")} value={filter.field} onChange={(event) => { const field = event.target.value; setCustomFilters((current) => current.map((item, i) => (i === index ? { ...item, field } : item))); changed() }} className="h-[36px] min-w-0 flex-1 border-b border-[#e0e0e0] bg-white text-[13px] outline-none">
                  <option value="">{t("Индивидуальный фильтр")}</option>
                  {salesGroupings.map((item) => <option key={item} value={item}>{t(item)}</option>)}
                </select>
                <input aria-label={t("Значение фильтра")} value={filter.value} onChange={(event) => { const value = event.target.value; setCustomFilters((current) => current.map((item, i) => (i === index ? { ...item, value } : item))); changed() }} placeholder={t("Значение фильтра")} className="h-[36px] min-w-0 flex-1 border-b border-[#e0e0e0] text-[13px] outline-none" />
                <button type="button" onClick={() => { setCustomFilters((current) => current.filter((_, i) => i !== index)); changed() }} aria-label={t("Удалить фильтр")} className="pb-[6px] text-[#777] hover:text-black"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setCustomFilters((current) => [...current, { field: "", value: "" }])} className="mt-[18px] h-9 w-full rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium uppercase text-white hover:brightness-95">{t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}</button>
          </section>
        </div>
      )}
    </section>

    {shown === "none" && <BuilderNoData className="mx-7 mt-[30px]" />}
    {shown === "table" && result && (
      <div className="mx-7 mt-[30px] overflow-x-auto rounded-[8px] bg-white">
        <BuilderTable result={result} />
      </div>
    )}

    {saves.dialogs}
  </ReportPage>
}
