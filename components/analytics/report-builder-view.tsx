"use client"

import { useCallback, useEffect, useState } from "react"
import { Bookmark, Download, FolderOpen, Search, X } from "lucide-react"

import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { NewReportBuilderSave } from "@/lib/new-report-builder-types"
import type { BuilderResult } from "@/lib/report-builder-repo"
import { BuilderPeriod, currentMonthPeriod, isoParam } from "./builder-period"
import { savedList, savedPeriod, savedRecord, useBuilderSaves } from "./builder-saves"
import { BuilderNoData, BuilderTable, builderNumber } from "./builder-table"
import { CHECKBOX } from "./visit-builder-view"

// «Конструктор отчетов по текущим остаткам» — the reference's #/new-quick-report/?category=remainder: two models
// in the header, ТЕКУЩИЙ ОСТАТОК (product_balances: what every warehouse holds now, whatever the period) and СКЛАД
// (stock_transaction: the stock movements of the period); Колонки, Вертикальная / Горизонтальная групировка and
// Фильтр of the model (Показать итоги, the model's quick filters, individual filters), the period, «Сформировать
// отчет», «Скачать», «Сохранить» / «Отчеты» (shared with the other constructors, lib builder-saves). The lists and
// the table come from the report engine of the old builder (GET / POST /api/report-builder kind "old",
// lib/old-report): the same fields as the reference's report_many_config of the category.

const MODELS = [
  { key: "product_balances", label: "ТЕКУЩИЙ ОСТАТОК" },
  { key: "stock_transaction", label: "СКЛАД" },
] as const
type ModelKey = (typeof MODELS)[number]["key"]
const isModel = (value: unknown): value is ModelKey => MODELS.some((model) => model.key === value)

type FieldInfo = { id: string; name: string; hint?: string; supported: boolean }
type ModelInfo = { key: string; name: string; columns: FieldInfo[]; groups: FieldInfo[]; filters: FieldInfo[]; compare: FieldInfo[]; operations: { id: string; name: string }[] }
type Compare = { field: string; op: string; value: string }
type Period = { from: string; to: string }

function OptionList({
  title,
  placeholder,
  items,
  selected,
  onToggle,
}: {
  title: string
  placeholder: string
  items: FieldInfo[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const needle = query.trim().toLocaleLowerCase("ru")
  const visible = items.filter((item) => !needle || t(item.name).toLocaleLowerCase("ru").includes(needle) || item.name.toLocaleLowerCase("ru").includes(needle))
  return (
    <section className="min-w-0 px-[20px] pb-[30px] pt-[18px]">
      <h2 className="text-[15px] font-semibold leading-[18.75px]">{t(title)}</h2>
      <label className="relative mt-[11px] block">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(placeholder)} className="h-[42px] w-full rounded-[3px] bg-[#f2f5f8] px-[11px] pr-10 text-[12px] outline-none placeholder:text-[#999]" />
        <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />
      </label>
      <div className="mt-[11px]">
        {visible.map((item) => (
          <label key={item.id} title={item.supported ? item.hint && t(item.hint) : t("Нет данных")} className={`flex min-h-[30px] items-center gap-[9px] text-[13px] font-semibold ${item.supported ? "cursor-pointer" : "cursor-not-allowed text-[#aaa]"}`}>
            <input type="checkbox" disabled={!item.supported} checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} className={`${CHECKBOX} ml-[3px]`} />
            {t(item.name)}
          </label>
        ))}
        {items.length > 0 && visible.length === 0 && <p className="text-[13px] text-[#999]">{t("Ничего не найдено")}</p>}
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
        {options.map((option, index) => (
          <option key={`${option}-${index}`} value={option}>
            {option}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[4px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
        <path d="M7 10l5 5 5-5z" />
      </svg>
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

const toggleIn = (list: string[], item: string) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item])

export function ReportBuilderView() {
  const { t } = useLanguage()
  const [model, setModel] = useState<ModelKey>("product_balances")
  const [info, setInfo] = useState<Partial<Record<ModelKey, ModelInfo>>>({})
  const [settings, setSettings] = useState(true)
  const [period, setPeriod] = useState<Period>(currentMonthPeriod)
  const [columns, setColumns] = useState<string[]>([])
  const [vertical, setVertical] = useState<string[]>([])
  const [horizontal, setHorizontal] = useState<string[]>([])
  const [showTotals, setShowTotals] = useState(true)
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({})
  const [compare, setCompare] = useState<Compare[]>([])
  const [result, setResult] = useState<BuilderResult | null>(null)
  /** "none": the generated report is empty (or nothing was chosen). */
  const [shown, setShown] = useState<"table" | "none" | null>(null)
  const [dirty, setDirty] = useState(true)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState("")
  const current = info[model]

  // The period and the settings panel of the URL (?beginDate=…&endDate=…&openGrouping=…), as the reference keeps them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const from = isoParam(params.get("beginDate"))
    const to = isoParam(params.get("endDate"))
    if (from && to && from <= to) setPeriod({ from, to })
    if (params.get("openGrouping") === "false") setSettings(false)
  }, [])

  // The panel lists of the model (once per model).
  useEffect(() => {
    if (info[model]) return
    let cancelled = false
    fetch(`/api/report-builder?kind=old&model=${model}`)
      .then((response) => (response.ok ? (response.json() as Promise<ModelInfo>) : Promise.reject(response.status)))
      .then((data) => {
        if (!cancelled) setInfo((list) => ({ ...list, [model]: data }))
      })
      .catch(() => {
        if (!cancelled) setMessage(t("Не удалось загрузить данные"))
      })
    return () => {
      cancelled = true
    }
  }, [info, model, t])

  // The options of the model's quick filters: what the records of the period hold (Текущий остаток: today's).
  const filterIds = (current?.filters ?? []).filter((filter) => filter.supported).map((filter) => filter.id).join(",")
  useEffect(() => {
    if (!filterIds) return
    let cancelled = false
    const ids = filterIds.split(",")
    void Promise.all(
      ids.map((id) =>
        fetch(`/api/report-builder?kind=old&model=${model}&filter=${encodeURIComponent(id)}&from=${period.from}&to=${period.to}`)
          .then((response) => (response.ok ? (response.json() as Promise<{ options?: string[] }>) : { options: [] }))
          .then((data) => [id, data.options ?? []] as const)
          .catch(() => [id, [] as string[]] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setFilterOptions(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [filterIds, model, period.from, period.to])

  const changed = useCallback(() => setDirty(true), [])
  const toggleColumn = (id: string) => {
    setColumns((list) => toggleIn(list, id))
    changed()
  }
  // A grouping is either vertical or horizontal: the one chosen in a list leaves the other list.
  const toggleVertical = (id: string) => {
    setVertical((list) => toggleIn(list, id))
    setHorizontal((list) => list.filter((value) => value !== id))
    changed()
  }
  const toggleHorizontal = (id: string) => {
    setHorizontal((list) => toggleIn(list, id))
    setVertical((list) => list.filter((value) => value !== id))
    changed()
  }

  const showSettings = (open: boolean) => {
    setSettings(open)
    writeUrl({ openGrouping: String(open) })
  }

  const applyPeriod = (from: string, to: string) => {
    setPeriod({ from, to })
    changed()
    writeUrl({ beginDate: from, endDate: to, openGrouping: String(settings) })
  }

  /** Another model starts from an empty panel (its fields are not the other model's). */
  const chooseModel = (next: ModelKey) => {
    if (next === model) return
    setModel(next)
    setColumns([])
    setVertical([])
    setHorizontal([])
    setFilterValues({})
    setFilterOptions({})
    setCompare([])
    setResult(null)
    setShown(null)
    setMessage("")
    changed()
  }

  async function generate(): Promise<BuilderResult | null> {
    setMessage("")
    if (columns.length === 0) {
      // The reference answers a report without columns with its no-data page.
      setResult(null)
      setShown("none")
      setDirty(false)
      showSettings(false)
      return null
    }
    setRunning(true)
    try {
      const filters = Object.fromEntries(Object.entries(filterValues).filter(([, value]) => value).map(([id, value]) => [id, [value]]))
      const response = await fetch("/api/report-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "old",
          model,
          from: period.from,
          to: period.to,
          columns,
          vertical,
          horizontal,
          filters,
          compare: compare.filter((item) => item.field && item.op && item.value.trim()),
          showTotals,
        }),
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
    const cols = data.columns ?? []
    const keys = data.keys?.length ? data.keys : [""]
    const header = [...(vert.length ? vert.map((name) => t(name)) : [""]), ...cols.flatMap((column) => keys.map((key) => [key, t(column)].filter(Boolean).join(" · ")))]
    const cell = (row: (string | number)[], key: number, column: number) => {
      const value = row[vert.length + key * cols.length + column]
      return typeof value === "number" ? builderNumber(value) : value
    }
    const body = data.rows.map((row) => [...(vert.length ? row.slice(0, vert.length) : [""]), ...cols.flatMap((_, column) => keys.map((__, key) => cell(row, key, column)))])
    const totals = data.totals ? [[t("Итого"), ...vert.slice(1).map(() => ""), ...cols.flatMap((_, column) => keys.map((__, key) => cell(data.totals as (string | number)[], key, column)))]] : []
    downloadExcelTable(`${t("Конструктор")}.xls`, [header, ...body, ...totals])
  }

  /** A saved report of this constructor back on screen: its model and every setting. */
  const loadSavedReport = (report: NewReportBuilderSave) => {
    const config = report.config
    const next = isModel(config.model) ? config.model : model
    setModel(next)
    setColumns(savedList(config.columns))
    setVertical(savedList(config.vertical))
    setHorizontal(savedList(config.horizontal))
    setShowTotals(typeof config.showTotals === "boolean" ? config.showTotals : true)
    setFilterValues(savedRecord(config.filterValues))
    setCompare(
      Array.isArray(config.compare)
        ? (config.compare as unknown[]).filter(
            (item): item is Compare => !!item && typeof item === "object" && typeof (item as Compare).field === "string" && typeof (item as Compare).op === "string" && typeof (item as Compare).value === "string",
          )
        : [],
    )
    const saved = savedPeriod(config)
    setPeriod(saved)
    writeUrl({ beginDate: saved.from, endDate: saved.to, openGrouping: "true" })
    setSettings(true)
    setResult(null)
    setShown(null)
    setDirty(true)
  }

  const saves = useBuilderSaves({
    page: "stock",
    snapshot: () => ({
      reportType: MODELS.find((item) => item.key === model)?.label ?? model,
      config: { model, columns, vertical, horizontal, showTotals, filterValues, compare, from: period.from, to: period.to },
    }),
    onLoad: loadSavedReport,
    onMessage: setMessage,
  })

  const groups = current?.groups ?? []
  const compareFields = (current?.compare ?? []).filter((field) => field.supported)
  const generateIdle = !dirty && shown !== null

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Конструктор")}>
          <div className="flex shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {MODELS.map((item, index) => (
              <button
                type="button"
                key={item.key}
                onClick={() => chooseModel(item.key)}
                className={`h-[32px] px-4 text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : "rounded-r-[3px]"} ${model === item.key ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </RefHeader>
      </div>
      <section className="mx-7 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex min-h-[60px] flex-wrap items-center gap-[15px] px-[30px]">
          <button type="button" onClick={saves.openSave} className="flex h-[36px] items-center rounded-[3px] bg-[#1E4A9A] px-[15px] text-[13px] text-white hover:brightness-95">
            <Bookmark className="mr-[10px] h-[18px] w-[18px] fill-white" />
            {t("Сохранить")}
          </button>
          <button type="button" onClick={saves.openReports} className="flex h-[36px] items-center rounded-[3px] bg-[#ff8a65] px-[15px] text-[13px] text-white hover:brightness-95">
            <FolderOpen className="mr-[10px] h-[18px] w-[18px] fill-white" />
            {t("Отчеты")}
          </button>
          <button type="button" onClick={() => void exportExcel()} className="flex h-[36px] items-center rounded-[3px] bg-[#4db6ac] px-[15px] text-[13px] text-white hover:brightness-95">
            <Download className="mr-[10px] h-[18px] w-[18px]" />
            {t("Скачать")}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-[19px]">
            <BuilderPeriod from={period.from} to={period.to} onApply={applyPeriod} align="right" />
            <button type="button" aria-expanded={settings} onClick={() => showSettings(!settings)} className="flex h-[36px] w-[215px] items-center justify-center gap-[8px] rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95">
              <span>{settings ? t("СКРЫТЬ НАСТРОЙКИ") : t("ПОКАЗАТЬ НАСТРОЙКИ")}</span>
              <svg viewBox="0 0 10 6" aria-hidden className={`h-[6px] w-[10px] fill-white ${settings ? "rotate-180" : ""}`}>
                <path d="M0 0h10L5 6z" />
              </svg>
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => void generate()}
              className={`h-[36px] w-[195px] rounded-[3px] bg-[#2bcd53] text-[13px] font-medium text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)] hover:brightness-95 disabled:cursor-wait ${generateIdle || running ? "opacity-50" : ""}`}
            >
              {t("СФОРМИРОВАТЬ ОТЧЕТ")}
            </button>
          </div>
        </div>
        {message && (
          <div className="flex items-center justify-between border-t border-blue-100 bg-blue-50 px-[30px] py-2 text-[13px] text-blue-700">
            {message}
            <button type="button" onClick={() => setMessage("")} aria-label={t("Закрыть сообщение")}>
              ×
            </button>
          </div>
        )}
        {settings && (
          <div className="grid grid-cols-1 divide-y divide-[#ececec] border-t border-[#ececec] shadow-[0_2px_6px_rgba(0,0,0,0.12)] lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            <OptionList key={`c-${model}`} title="Колонки" placeholder="Поиск колонки..." items={current?.columns ?? []} selected={columns} onToggle={toggleColumn} />
            <OptionList key={`v-${model}`} title="Вертикальная групировка" placeholder="Поиск вертикальных группировки..." items={groups.filter((item) => !horizontal.includes(item.id))} selected={vertical} onToggle={toggleVertical} />
            <OptionList key={`h-${model}`} title="Горизонтальная групировка" placeholder="Поиск горизонтальных группировки..." items={groups.filter((item) => !vertical.includes(item.id))} selected={horizontal} onToggle={toggleHorizontal} />
            <section className="pb-[20px] pl-[23px] pr-[17px] pt-[18px]">
              <h2 className="text-[15px] font-semibold leading-[18.75px]">{t("Фильтр")}</h2>
              <label className="mt-[11px] flex cursor-pointer items-center gap-[9px] text-[13px] font-semibold">
                <input
                  type="checkbox"
                  checked={showTotals}
                  onChange={(event) => {
                    setShowTotals(event.target.checked)
                    changed()
                  }}
                  className={CHECKBOX}
                />
                {t("Показать итоги")}
              </label>
              {(current?.filters ?? []).map((filter, index) => (
                <FilterSelect
                  key={filter.id}
                  first={index === 0}
                  label={filter.name}
                  value={filterValues[filter.id] ?? ""}
                  options={filterOptions[filter.id] ?? []}
                  onChange={(value) => {
                    setFilterValues((list) => ({ ...list, [filter.id]: value }))
                    changed()
                  }}
                />
              ))}
              {compare.map((item, index) => (
                <div key={index} className="mt-[18px] flex items-end gap-[8px]">
                  <select
                    aria-label={t("Индивидуальный фильтр")}
                    value={item.field}
                    onChange={(event) => {
                      const field = event.target.value
                      setCompare((list) => list.map((entry, i) => (i === index ? { ...entry, field } : entry)))
                      changed()
                    }}
                    className="h-[36px] min-w-0 flex-1 border-b border-[#e0e0e0] bg-white text-[13px] outline-none"
                  >
                    <option value="">{t("Индивидуальный фильтр")}</option>
                    {compareFields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {t(field.name)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("Условие")}
                    value={item.op}
                    onChange={(event) => {
                      const op = event.target.value
                      setCompare((list) => list.map((entry, i) => (i === index ? { ...entry, op } : entry)))
                      changed()
                    }}
                    className="h-[36px] w-[110px] border-b border-[#e0e0e0] bg-white text-[13px] outline-none"
                  >
                    {(current?.operations ?? []).map((operation) => (
                      <option key={operation.id} value={operation.id}>
                        {t(operation.name)}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t("Значение фильтра")}
                    value={item.value}
                    onChange={(event) => {
                      const value = event.target.value
                      setCompare((list) => list.map((entry, i) => (i === index ? { ...entry, value } : entry)))
                      changed()
                    }}
                    placeholder={t("Значение фильтра")}
                    className="h-[36px] w-[80px] min-w-0 border-b border-[#e0e0e0] text-[13px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCompare((list) => list.filter((_, i) => i !== index))
                      changed()
                    }}
                    aria-label={t("Удалить фильтр")}
                    className="pb-[6px] text-[#777] hover:text-black"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={!compareFields.length}
                onClick={() => setCompare((list) => [...list, { field: compareFields[0]?.id ?? "", op: current?.operations[0]?.id ?? "contains", value: "" }])}
                className="mt-[18px] h-9 w-full rounded-[3px] bg-[#1E4A9A] text-[13px] font-medium uppercase text-white hover:brightness-95 disabled:opacity-50"
              >
                {t("ДОБАВИТЬ ИНДИВИДУАЛЬНЫЙ ФИЛЬТР")}
              </button>
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
  )
}
