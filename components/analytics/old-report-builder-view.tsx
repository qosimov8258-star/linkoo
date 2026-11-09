"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import * as echarts from "echarts"
import { Search, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { appCurrencyColumn, useAppCurrency } from "@/lib/app-currency-context"
import { useLanguage } from "@/lib/i18n/language-context"
import type { BuilderResult } from "@/lib/report-builder-repo"
import { INFO_HINTS, INFO_ITEMS, salesColumns, salesFilters, salesGroupings, visitColumns, visitGroupings } from "./visit-builder-view"
import { BuilderPeriod, currentMonthPeriod, isoParam } from "./builder-period"
import { BuilderNoData, BuilderTable, builderNumber } from "./builder-table"

// Конструктор отчетов (the reference's "old" quick report, #/quick-report): the period, a "Модель" (the report
// model) and the toolbar panels; every panel applies with ПРИМЕНИТЬ and the table is built by the same engine as
// the new Конструктор (lib/report-builder-repo.ts). The lists of a panel are the ones of the chosen model; a model
// whose documents this app does not keep shows empty lists and "Нет данных за выбранный период".

const SALES_MODELS = [
  "Заказ и возврат по дате реализации",
  "Заказ и возврат по дате создания",
  "Продукты заказов по дате создания",
  "Продукты заказов по дате по дате доставки",
  "Продукты заказов по дате реализации со склада",
  "Заказы по дате доставки",
]
const MODELS = [
  ...SALES_MODELS.slice(0, 5),
  "Возвраты",
  "Возвраты по дате приемки",
  "Отказы",
  "Заказы по дате доставки",
  "Задачи",
  "Склад",
  "Остаток партий",
  "Магазины",
  "Визит",
  "Списание продукты",
  "Продукты поставок по дате поставки",
]
const VISIT_MODEL = "Визит"
const VISIT_FILTERS = ["Пользователь", "Статус", "Зона"]
/** The old builder's own name of a grouping (its list says "Ед. изм" where the new one says "Продукт Ед. изм"). */
const OLD_NAMES: Record<string, string> = { "Продукт Ед. изм": "Ед. изм" }
/** Prefix of an individual filter's key (lib/report-builder-repo.ts): the grouping's value contains the text. */
const CUSTOM_FILTER = "*"

type PanelKey = "columns" | "table" | "vertical" | "horizontal" | "filters" | "quick"
type TableOptions = { formatted: boolean; totalsRight: boolean; totalsBottom: boolean; merge: boolean; activeFilter: boolean }
type CustomFilter = { field: string; value: string }
type Settings = {
  model: string
  columns: string[]
  vertical: string[]
  horizontal: string[]
  filters: Record<string, string>
  custom: CustomFilter[]
  options: TableOptions
}
const DEFAULT_OPTIONS: TableOptions = { formatted: true, totalsRight: true, totalsBottom: true, merge: false, activeFilter: false }
const OPTION_LABELS: [keyof TableOptions, string][] = [
  ["formatted", "Форматированные числа"],
  ["totalsRight", "Итоги справа"],
  ["totalsBottom", "Итоги снизу"],
  ["merge", "Обьединение ячеек"],
  ["activeFilter", "Активный фильтр"],
]
const EMPTY_SETTINGS: Settings = { model: "", columns: [], vertical: [], horizontal: [], filters: {}, custom: [], options: DEFAULT_OPTIONS }

/** The view toggles of the reference (line, pie, histogram, table) with their hints. */
const VIEWS = [
  { name: "Линейный", path: "M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" },
  { name: "Круговая диаграмма", path: "M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" },
  { name: "Гистограмма", path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" },
  { name: "Таблица", path: "M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z" },
] as const
const TABLE_VIEW = 3

/** The checkbox of the reference's panels: 16 px, a #666 frame, filled #666 with a white tick. */
const BOX =
  "h-[16px] w-[16px] shrink-0 cursor-pointer appearance-none rounded-[2px] border-2 border-[#666] bg-white checked:border-[#666] checked:bg-[#666] checked:bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22><path%20fill=%22white%22%20d=%22M9%2016.2L4.8%2012l-1.4%201.4L9%2019%2021%207l-1.4-1.4z%22/></svg>')] checked:bg-[length:14px] checked:bg-center checked:bg-no-repeat"
const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const LINK = "flex items-center gap-[3px] text-[13px] text-[#1E4A9A] hover:underline"
const BUTTON = "flex h-[36px] min-w-[88px] items-center justify-center gap-[8px] rounded-[2px] pl-[12px] pr-[16px] text-[13px] text-white hover:brightness-95"
const CHIP = "flex h-full flex-col justify-center rounded-[3px] bg-[#1E4A9A] px-[5px] text-left text-[13px] leading-[16px] text-white hover:brightness-95"

const modelKind = (model: string): "sales" | "visits" | null => (SALES_MODELS.includes(model) ? "sales" : model === VISIT_MODEL ? "visits" : null)
const modelColumns = (model: string) => (modelKind(model) === "sales" ? salesColumns : modelKind(model) === "visits" ? visitColumns : [])
const modelGroupings = (model: string) => (modelKind(model) === "sales" ? salesGroupings : modelKind(model) === "visits" ? visitGroupings : [])
const modelFilters = (model: string) => (modelKind(model) === "sales" ? salesFilters : modelKind(model) === "visits" ? VISIT_FILTERS : [])
const toggleIn = (list: string[], item: string) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item])

function Chevron() {
  return <svg viewBox="0 0 10 6" aria-hidden className="h-[5px] w-[8px] fill-none stroke-current"><path d="M1 1l4 4 4-4" strokeWidth="1.3" /></svg>
}

/** A chip's name on two lines as the reference prints it ("Оптимизация ⌄" over "таблицы"), in any language. */
function ChipLabel({ text }: { text: string }) {
  const space = text.indexOf(" ")
  return (
    <>
      <span className="flex items-center gap-[4px]">{space > 0 ? text.slice(0, space) : text} <Chevron /></span>
      {space > 0 && <span>{text.slice(space + 1)}</span>}
    </>
  )
}

function CircleClose({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="text-[#777] hover:text-black">
      <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] fill-current" aria-hidden>
        <path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      </svg>
    </button>
  )
}

/**
 * A toolbar panel of the reference: its title, ⊗, the content and ПРИМЕНИТЬ. As in the reference it is as tall as
 * its list (the page scrolls down to ПРИМЕНИТЬ); `padded` = false drops the 15 px under the content.
 */
function ToolbarPanel({ title, onClose, onApply, className = "", wide = false, padded = true, children }: { title: string; onClose: () => void; onApply: () => void; className?: string; wide?: boolean; padded?: boolean; children?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div role="dialog" aria-label={title} className={`absolute z-30 rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] ${wide ? "inset-x-0" : "w-[310px]"} ${className}`}>
      <header className="flex items-center justify-between px-[20px] pb-[8px] pt-[21px]">
        <h2 className="text-[15px] leading-[24px] text-[#555]">{title}</h2>
        <CircleClose onClick={onClose} label={t("Закрыть")} />
      </header>
      <div className={`px-[20px] ${padded ? "pb-[15px]" : ""}`}>{children}</div>
      <div className="px-[20px] pb-[10px] pt-[15px]">
        <button type="button" onClick={onApply} className={`h-[36px] min-w-[88px] rounded-[2px] bg-[#5d6474] px-[16px] text-[13px] uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-110 ${wide ? "" : "w-full"}`}>{t("ПРИМЕНИТЬ")}</button>
      </div>
    </div>
  )
}

/** A line of a panel list: the box, the name and, for the items the reference explains, ⓘ with the hint. */
function CheckItem({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start py-[5px] text-[13px] font-semibold leading-[20px]">
      <input type="checkbox" checked={checked} onChange={onChange} className={`${BOX} ml-[2px] mt-[2px]`} />
      <span className={`ml-[9px] ${hint ? "max-w-[180px]" : ""}`}>{label}</span>
      {hint && <span title={hint} className="ml-[5px] flex h-[24px] w-[24px] shrink-0 items-center justify-center"><InfoIcon /></span>}
    </label>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[20px] w-[20px] shrink-0 fill-none stroke-[#333]" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 10.5v6M12 7.2v.6" strokeLinecap="round" />
    </svg>
  )
}

function SelectLine({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const { t } = useLanguage()
  return (
    <label className="relative block h-[45px] border-b border-[#e0e0e0]">
      <span className={`absolute inset-x-0 top-[21px] truncate pr-6 text-[13px] leading-[18px] ${value ? "font-semibold text-[#1E4A9A]" : "text-black"}`}>{value || t(label)}</span>
      <select aria-label={t(label)} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        <option value="">{t(label)}</option>
        {options.map((option, index) => <option key={`${option}-${index}`} value={option}>{t(option)}</option>)}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[2px] right-[4px] h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}

/**
 * The "Модель" select of the reference (a searchable select): the label alone while empty; with a model, the label on
 * top, the model, ✕ and ▾. Typing filters the models, ↑/↓ move the marked one, Enter picks it, Esc closes the list.
 */
function ModelSelect({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [marked, setMarked] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = MODELS.filter((model) => !needle || t(model).toLocaleLowerCase("ru").includes(needle))

  const show = () => {
    setOpen(true)
    setMarked(Math.max(0, MODELS.indexOf(value)))
  }
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const pick = (model: string) => {
    onChange(model)
    close()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  // The marked model stays in sight while ↑/↓ move it.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${marked}"]`)?.scrollIntoView({ block: "nearest" })
  }, [open, marked])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) return show()
      const step = event.key === "ArrowDown" ? 1 : -1
      setMarked((current) => (shown.length ? (current + step + shown.length) % shown.length : 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (open && shown[marked]) pick(shown[marked])
      else if (!open) show()
    } else if (event.key === "Escape" && open) {
      event.stopPropagation()
      close()
    }
  }

  return (
    <div
      ref={ref}
      className="group relative h-[46px] w-[300px] cursor-text"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("[data-clear], [role=listbox]")) return
        event.preventDefault()
        input.current?.focus()
        if (open) close()
        else show()
      }}
    >
      <span className={`pointer-events-none absolute left-0 text-[13px] font-semibold leading-[18px] text-black ${value || query ? "top-[6px]" : "top-[21px]"}`}>{t("Модель")}</span>
      {value && !query && <span className="pointer-events-none absolute left-0 right-[44px] top-[22px] truncate text-[13px] leading-[18px] text-[#333]">{t(value)}</span>}
      <input
        ref={input}
        role="combobox"
        aria-label={t("Модель")}
        aria-expanded={open}
        aria-controls="old-builder-models"
        aria-autocomplete="list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setMarked(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery("")}
        className="absolute left-0 right-[44px] top-[22px] h-[18px] bg-transparent p-0 text-[13px] leading-[18px] text-[#333] outline-none"
      />
      {value && (
        <button type="button" data-clear aria-label={t("Очистить")} onClick={() => { onChange(""); close() }} className="absolute right-[26px] top-[22px] text-[#999] hover:text-[#d0011b]">
          <X className="h-[13px] w-[13px]" />
        </button>
      )}
      <svg viewBox="0 0 24 24" aria-hidden className={`pointer-events-none absolute right-[4px] top-[17px] h-[22px] w-[22px] fill-[#999] ${open ? "rotate-180" : ""}`}><path d="M7 10l5 5 5-5z" /></svg>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e7e7e7] group-focus-within:h-[2px] group-focus-within:bg-[#5d6474]" />
      {open && (
        <div ref={list} id="old-builder-models" role="listbox" aria-label={t("Модель")} className="absolute left-0 top-[calc(100%-1px)] z-40 max-h-[200px] w-full overflow-y-auto bg-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
          {shown.map((model, index) => (
            <div
              key={model}
              data-index={index}
              role="option"
              aria-selected={model === value}
              onMouseEnter={() => setMarked(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(model)}
              className={`cursor-pointer px-[10px] py-[8px] text-[13px] leading-[16px] text-[#333] ${index === marked ? "bg-[#efefef]" : ""}`}
            >
              {t(model)}
            </div>
          ))}
          {shown.length === 0 && <div className="px-[10px] py-[8px] text-[13px] leading-[16px] text-[#999]">{t("По вашему запросу ничего не найдено")}</div>}
        </div>
      )}
    </div>
  )
}

/** The reference's empty card: the robot 15 px under the card's edge and the message under it. */
function BuilderEmpty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center pb-[28px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="-mt-[6px] w-[157px]" />
      <span className="-mt-[8px] text-[13px] leading-[19.5px] text-[#999]">{text}</span>
    </div>
  )
}

/** A chart of the generated table: the first measure (line / histogram: every measure) by the rows' first grouping. */
function BuilderChart({ result, view }: { result: BuilderResult; view: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { t } = useLanguage()
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const vertical = result.vertical ?? []
    const columns = result.columns ?? []
    const names = result.rows.map((row) => (vertical.length ? row.slice(0, vertical.length).join(" / ") : t("Итого")))
    // Each measure over all the horizontal values of a row (the per-row totals when the columns are split).
    const valueOf = (rowIndex: number, column: number): number => {
      const total = result.rowTotals?.[rowIndex]?.[column]
      if (typeof total === "number") return total
      const cell = result.rows[rowIndex][vertical.length + column]
      return typeof cell === "number" ? cell : 0
    }
    const palette = ["#1E4A9A", "#ff8a65", "#4db6ac", "#2bcd53", "#ab47bc", "#ffca28", "#5d6474", "#ef5350"]
    if (view === 1) {
      chart.setOption({
        color: palette,
        tooltip: { trigger: "item", valueFormatter: (value: number) => builderNumber(value) },
        legend: { type: "scroll", bottom: 0 },
        series: [{ type: "pie", radius: ["0%", "70%"], center: ["50%", "45%"], name: t(columns[0] ?? ""), data: names.map((name, index) => ({ name, value: valueOf(index, 0) })) }],
      })
    } else {
      chart.setOption({
        color: palette,
        tooltip: { trigger: "axis", valueFormatter: (value: number) => builderNumber(value) },
        legend: { type: "scroll", bottom: 0, data: columns.map((column) => t(column)) },
        grid: { left: 90, right: 30, top: 30, bottom: 70 },
        xAxis: { type: "category", data: names, axisLabel: { interval: 0, rotate: names.length > 6 ? 30 : 0 } },
        yAxis: { type: "value", axisLabel: { formatter: (value: number) => builderNumber(value) } },
        series: columns.map((column, index) => ({ type: view === 0 ? "line" : "bar", barMaxWidth: 80, name: t(column), data: names.map((_, rowIndex) => valueOf(rowIndex, index)) })),
      })
    }
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    return () => { window.removeEventListener("resize", resize); chart.dispose() }
  }, [result, view, t])
  return <div ref={ref} className="h-[460px] w-full" />
}

export function OldReportBuilderView() {
  const { t } = useLanguage()
  const appCurrency = useAppCurrency()
  const [period, setPeriod] = useState(currentMonthPeriod)
  const [applied, setApplied] = useState<Settings>(EMPTY_SETTINGS)
  const [draft, setDraft] = useState<Settings>(EMPTY_SETTINGS)
  const [open, setOpen] = useState<PanelKey | null>(null)
  const [view, setView] = useState(TABLE_VIEW)
  const [hoverView, setHoverView] = useState<number | null>(null)
  const [snack, setSnack] = useState("")
  const [result, setResult] = useState<BuilderResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [filterOptions, setFilterOptions] = useState<Record<string, Record<string, string[]>>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [listOpen, setListOpen] = useState<"reports" | "widgets" | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const request = useRef(0)

  // The period of the URL (?beginDate=…&endDate=…), as the reference keeps it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const from = isoParam(params.get("beginDate"))
    const to = isoParam(params.get("endDate"))
    if (from && to && from <= to) setPeriod({ from, to })
  }, [])

  useEffect(() => {
    if (!snack) return
    const timer = window.setTimeout(() => setSnack(""), 3000)
    return () => window.clearTimeout(timer)
  }, [snack])

  // Filter values of the model's engine (GET /api/report-builder?kind=…), loaded once per kind.
  const kind = modelKind(draft.model || applied.model)
  useEffect(() => {
    if (!kind || filterOptions[kind]) return
    let cancelled = false
    fetch(`/api/report-builder?kind=${kind}`)
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, string[]>>) : Promise.reject()))
      .then((data) => { if (!cancelled) setFilterOptions((current) => ({ ...current, [kind]: data })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [kind, filterOptions])

  const closePanel = useCallback(() => setOpen(null), [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closePanel() }
    const onDown = (event: MouseEvent) => { if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) closePanel() }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown) }
  }, [open, closePanel])

  const openPanel = (key: PanelKey) => {
    if (open === key) return setOpen(null)
    setDraft(applied)
    setOpen(key)
  }
  const apply = () => {
    setApplied(draft)
    setOpen(null)
  }

  const chooseModel = (model: string) => {
    // Another model has other lists: what was chosen for the previous one does not carry over.
    const next: Settings = model === applied.model ? applied : { ...EMPTY_SETTINGS, model, options: applied.options }
    setApplied(next)
    setDraft(next)
    setOpen(null)
  }

  // The report of the applied settings: rebuilt on every ПРИМЕНИТЬ, a new period or another model.
  const ready = !!applied.model && applied.columns.length > 0
  useEffect(() => {
    const id = ++request.current
    if (!ready) {
      setResult(null)
      setError("")
      return
    }
    const engine = modelKind(applied.model)
    if (!engine) {
      setResult({ headers: [], rows: [], totals: null, unsupported: [], count: 0 })
      setError("")
      return
    }
    const filters: Record<string, string> = { ...applied.filters }
    for (const filter of applied.custom) if (filter.field && filter.value.trim()) filters[`${CUSTOM_FILTER}${filter.field}`] = filter.value.trim()
    setLoading(true)
    setError("")
    fetch("/api/report-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: engine, tab: applied.model.toUpperCase(), from: period.from, to: period.to, columns: applied.columns, vertical: applied.vertical, horizontal: applied.horizontal, filters, showTotals: applied.options.totalsBottom }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (BuilderResult & { error?: string }) | null
        if (id !== request.current) return
        if (!response.ok || !data || data.error) {
          setResult(null)
          setError(data?.error || "Не удалось сформировать отчет")
          return
        }
        setResult(data)
      })
      .catch(() => { if (id === request.current) { setResult(null); setError("Не удалось сформировать отчет") } })
      .finally(() => { if (id === request.current) setLoading(false) })
  }, [ready, applied, period])

  const applyPeriod = (from: string, to: string) => {
    setPeriod({ from, to })
    const params = new URLSearchParams(window.location.search)
    params.set("beginDate", from)
    params.set("endDate", to)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
  }

  const hasTable = !!result && result.rows.length > 0
  const chooseView = (index: number) => {
    if (index !== TABLE_VIEW && !hasTable) {
      setSnack(t("Заполните данные и сохраните"))
      return
    }
    setView(index)
  }

  const download = () => {
    if (!result || !hasTable) {
      setSnack(t("Заполните данные и сохраните"))
      return
    }
    const vertical = result.vertical ?? []
    const columns = result.columns ?? []
    const keys = result.keys?.length ? result.keys : [""]
    const right = applied.options.totalsRight && !!result.rowTotals
    const value = (cell: string | number | undefined) => (typeof cell === "number" ? (applied.options.formatted ? builderNumber(cell) : cell) : (cell ?? ""))
    const header = [...(vertical.length ? vertical.map((name) => t(name)) : [""]), ...columns.flatMap((column) => [...keys.map((key) => [key, appCurrencyColumn(column, t, appCurrency)].filter(Boolean).join(" · ")), ...(right ? [`${appCurrencyColumn(column, t, appCurrency)} · ${t("Итого")}`] : [])])]
    const line = (row: (string | number)[], rowTotal?: (string | number)[]) => columns.flatMap((_, column) => [...keys.map((__, key) => value(row[vertical.length + key * columns.length + column])), ...(right ? [value(rowTotal?.[column])] : [])])
    const body = result.rows.map((row, index) => [...(vertical.length ? row.slice(0, vertical.length) : [""]), ...line(row, result.rowTotals?.[index])])
    const totals = result.totals ? [[t("Итого"), ...vertical.slice(1).map(() => ""), ...line(result.totals, result.grandTotals)]] : []
    downloadExcelTable(`${t("Конструктор отчетов")}.xls`, [header, ...body, ...totals])
  }

  const openSave = () => {
    if (!ready) {
      setSnack(t("Заполните данные и сохраните"))
      return
    }
    setSaveName("")
    setSaveOpen(true)
  }
  const save = async () => {
    if (!saveName.trim()) return
    try {
      const response = await fetch("/api/old-saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), config: { ...applied, from: period.from, to: period.to, view } }),
      })
      if (response.ok) {
        setSaveOpen(false)
        setSnack(t("Настройки отчета сохранены"))
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setSnack(t(data?.error || "Не удалось сохранить"))
      }
    } catch {
      setSnack(t("Не удалось сохранить"))
    }
  }

  const loadSaved = (config: unknown) => {
    const data = (config && typeof config === "object" ? config : {}) as Partial<Settings> & { from?: string; to?: string; view?: number }
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
    const next: Settings = {
      model: typeof data.model === "string" && MODELS.includes(data.model) ? data.model : "",
      columns: list(data.columns),
      vertical: list(data.vertical),
      horizontal: list(data.horizontal),
      filters: data.filters && typeof data.filters === "object" && !Array.isArray(data.filters) ? (data.filters as Record<string, string>) : {},
      custom: Array.isArray(data.custom) ? data.custom.filter((item): item is CustomFilter => !!item && typeof item.field === "string" && typeof item.value === "string") : [],
      options: { ...DEFAULT_OPTIONS, ...(data.options && typeof data.options === "object" ? data.options : {}) },
    }
    setApplied(next)
    setDraft(next)
    const from = isoParam(typeof data.from === "string" ? data.from : null)
    const to = isoParam(typeof data.to === "string" ? data.to : null)
    if (from && to && from <= to) applyPeriod(from, to)
    setView(typeof data.view === "number" && data.view >= 0 && data.view <= TABLE_VIEW ? data.view : TABLE_VIEW)
    setListOpen(null)
  }

  // Panel lists of the model (the draft's: a panel shows what is being chosen).
  const columns = modelColumns(draft.model)
  const groupings = modelGroupings(draft.model)
  const filterLabels = modelFilters(draft.model)
  const options = (kind && filterOptions[kind]) || {}
  const groupName = (name: string) => t(OLD_NAMES[name] ?? name)
  const activeFilters = useMemo(
    () => [
      ...Object.entries(applied.filters).filter(([, value]) => value).map(([label, value]) => `${t(label)}: ${value}`),
      ...applied.custom.filter((filter) => filter.field && filter.value.trim()).map((filter) => `${groupName(filter.field)}: ${filter.value.trim()}`),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applied, t],
  )

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Конструктор отчетов")} /></div>

      <section className={`relative mx-[30px] ${CARD}`}>
        <div className="relative h-[50px] border-b border-[#ececec]">
          <BuilderPeriod from={period.from} to={period.to} onApply={applyPeriod} align="left" textClassName="text-[13px]" className="absolute left-[8px] top-[-3px] w-[200px]" />
          <div className="absolute left-[calc(33.333%+24px)] top-[0px]">
            <ModelSelect value={applied.model} onChange={chooseModel} />
          </div>
          <div className="absolute right-[30px] top-[11px] flex">
            {VIEWS.map((item, index) => (
              <div key={item.name} className="relative" onMouseEnter={() => setHoverView(index)} onMouseLeave={() => setHoverView(null)}>
                <button type="button" aria-label={t(item.name)} aria-pressed={view === index} onClick={() => chooseView(index)} className={`flex h-[28px] w-[50px] items-center justify-center rounded-[5px] ${view === index ? "bg-[#1E4A9A]" : "bg-[#dadada]"}`}>
                  <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] fill-white" aria-hidden><path d={item.path} /></svg>
                </button>
                {hoverView === index && (
                  <span role="tooltip" className="pointer-events-none absolute right-full top-1/2 z-40 mr-[13px] -translate-y-1/2 whitespace-nowrap rounded-[3px] bg-[#41444a] px-[20px] py-[7px] text-[13px] leading-[20px] text-white">{t(item.name)}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div ref={toolbarRef} className="relative flex h-[50px] items-stretch py-[4px] pl-[30px] pr-[47px]">
          <div className="relative flex items-center">
            <button type="button" aria-expanded={open === "columns"} onClick={() => openPanel("columns")} className={LINK}>{t("Колонки")} <Chevron /></button>
            {open === "columns" && (
              <ToolbarPanel title={t("Колонки")} onClose={closePanel} onApply={apply} className="left-[-30px] top-[-4px]">
                {columns.map((item) => (
                  <CheckItem key={item} label={appCurrencyColumn(item, t, appCurrency)} hint={INFO_ITEMS.has(item) ? (INFO_HINTS[item] ? t(INFO_HINTS[item]) : appCurrencyColumn(item, t, appCurrency)) : undefined} checked={draft.columns.includes(item)} onChange={() => setDraft((current) => ({ ...current, columns: toggleIn(current.columns, item) }))} />
                ))}
              </ToolbarPanel>
            )}
          </div>
          <div className="ml-[70px] flex items-start gap-[14px] pt-[4px]">
            <button type="button" onClick={download} className={`${BUTTON} bg-[#4db6ac]`}>
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white" aria-hidden><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
              {t("Скачать")}
            </button>
            <button type="button" onClick={openSave} className={`${BUTTON} bg-[#1E4A9A]`}>
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white" aria-hidden><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z" /></svg>
              {t("Сохранить")}
            </button>
            <button type="button" onClick={() => setListOpen("reports")} className={`${BUTTON} bg-[#ff8a65]`}>
              <FolderStar />
              {t("Отчеты")}
            </button>
            <button type="button" onClick={() => setListOpen("widgets")} className={`${BUTTON} bg-[#ff8a65]`}>
              <FolderStar />
              {t("Виджеты")}
            </button>
          </div>

          <div className="ml-auto flex items-stretch gap-[14px]">
            <div className="relative">
              <button type="button" aria-expanded={open === "table"} onClick={() => openPanel("table")} className={`${CHIP} w-[114px]`}>
                <ChipLabel text={t("Оптимизация таблицы")} />
              </button>
              {open === "table" && (
                <ToolbarPanel title={t("Оптимизация таблицы")} onClose={closePanel} onApply={apply} className="right-[-14px] top-0">
                  {OPTION_LABELS.map(([key, label]) => (
                    <CheckItem key={key} label={t(label)} checked={draft.options[key]} onChange={() => setDraft((current) => ({ ...current, options: { ...current.options, [key]: !current.options[key] } }))} />
                  ))}
                </ToolbarPanel>
              )}
            </div>
            <div className="relative">
              <button type="button" aria-expanded={open === "vertical"} onClick={() => openPanel("vertical")} className={`${CHIP} w-[114px]`}>
                <ChipLabel text={t("Вертикальная групировка")} />
              </button>
              {open === "vertical" && (
                <ToolbarPanel title={t("Вертикальная групировка")} onClose={closePanel} onApply={apply} className="right-[-14px] top-0">
                  {groupings.filter((item) => !draft.horizontal.includes(item)).map((item) => (
                    <CheckItem key={item} label={groupName(item)} hint={INFO_ITEMS.has(item) ? (INFO_HINTS[item] ? t(INFO_HINTS[item]) : groupName(item)) : undefined} checked={draft.vertical.includes(item)} onChange={() => setDraft((current) => ({ ...current, vertical: toggleIn(current.vertical, item), horizontal: current.horizontal.filter((value) => value !== item) }))} />
                  ))}
                </ToolbarPanel>
              )}
            </div>
            <div className="relative">
              <button type="button" aria-expanded={open === "horizontal"} onClick={() => openPanel("horizontal")} className={`${CHIP} w-[135px] items-center text-center`}>
                <ChipLabel text={t("Горизонтальная групировка")} />
              </button>
              {open === "horizontal" && (
                <ToolbarPanel title={t("Горизонтальная групировка")} onClose={closePanel} onApply={apply} className="right-[-14px] top-0">
                  {groupings.filter((item) => !draft.vertical.includes(item)).map((item) => (
                    <CheckItem key={item} label={groupName(item)} hint={INFO_ITEMS.has(item) ? (INFO_HINTS[item] ? t(INFO_HINTS[item]) : groupName(item)) : undefined} checked={draft.horizontal.includes(item)} onChange={() => setDraft((current) => ({ ...current, horizontal: toggleIn(current.horizontal, item), vertical: current.vertical.filter((value) => value !== item) }))} />
                  ))}
                </ToolbarPanel>
              )}
            </div>
            <div className="relative flex items-center">
              <button type="button" aria-expanded={open === "filters"} onClick={() => openPanel("filters")} className={LINK}>
                {t("Фильтры")}{applied.custom.some((filter) => filter.field && filter.value.trim()) ? ` (${applied.custom.filter((filter) => filter.field && filter.value.trim()).length})` : ""} <Chevron />
              </button>
              {open === "filters" && (
                <ToolbarPanel title={t("Фильтры")} onClose={closePanel} onApply={apply} padded={false} className="right-[-16px] top-0">
                  <div className="mt-[14px] border-t border-[#e0e0e0]" />
                  {draft.custom.map((filter, index) => (
                    <div key={index} className="mt-[10px] flex items-end gap-[8px]">
                      <select aria-label={t("Поле")} value={filter.field} onChange={(event) => { const field = event.target.value; setDraft((current) => ({ ...current, custom: current.custom.map((item, i) => (i === index ? { ...item, field } : item)) })) }} className="h-[34px] min-w-0 flex-1 border-b border-[#e0e0e0] bg-white text-[13px] outline-none">
                        <option value="">{t("Поле")}</option>
                        {groupings.map((item) => <option key={item} value={item}>{groupName(item)}</option>)}
                      </select>
                      <input aria-label={t("Значение фильтра")} value={filter.value} placeholder={t("Значение фильтра")} onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, custom: current.custom.map((item, i) => (i === index ? { ...item, value } : item)) })) }} className="h-[34px] min-w-0 flex-1 border-b border-[#e0e0e0] text-[13px] outline-none" />
                      <button type="button" aria-label={t("Удалить фильтр")} onClick={() => setDraft((current) => ({ ...current, custom: current.custom.filter((_, i) => i !== index) }))} className="pb-[8px] text-[#777] hover:text-black"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, custom: [...current.custom, { field: "", value: "" }] }))} className="block h-[36px] min-w-[88px] rounded-[2px] px-[16px] text-[13px] uppercase text-[#333] hover:bg-[#f2f2f2]">{t("ДОБАВЛЕНИЕ ФИЛЬТРА")}</button>
                </ToolbarPanel>
              )}
            </div>
            <div className="flex items-center">
              <button type="button" aria-expanded={open === "quick"} onClick={() => openPanel("quick")} className={LINK}>
                {t("Быстрый фильтр")}{Object.values(applied.filters).filter(Boolean).length ? ` (${Object.values(applied.filters).filter(Boolean).length})` : ""} <Chevron />
              </button>
            </div>
          </div>

          {open === "quick" && (
            <ToolbarPanel title={t("Фильтр")} onClose={closePanel} onApply={apply} wide padded={false} className="top-0">
              {filterLabels.length > 0 && (
                <div className="grid grid-cols-1 gap-x-[10px] gap-y-[22px] pb-[9px] pt-[18px] sm:grid-cols-2 lg:grid-cols-4">
                  {filterLabels.map((label) => (
                    <SelectLine key={label} label={label} value={draft.filters[label] ?? ""} options={options[label] ?? []} onChange={(value) => setDraft((current) => ({ ...current, filters: { ...current.filters, [label]: value } }))} />
                  ))}
                </div>
              )}
            </ToolbarPanel>
          )}
        </div>
      </section>

      {applied.options.activeFilter && activeFilters.length > 0 && (
        <div className="mx-[30px] mt-[12px] flex flex-wrap gap-[8px] text-[12px]">
          <span className="font-semibold text-[#555]">{t("Активный фильтр")}:</span>
          {activeFilters.map((item) => <span key={item} className="rounded-[3px] bg-white px-[8px] py-[2px] text-[#1E4A9A] shadow-[0_1px_3px_rgba(0,0,0,0.12)]">{item}</span>)}
        </div>
      )}

      {!ready ? (
        <section className={`mx-[30px] mt-[20px] ${CARD}`}>
          <BuilderEmpty text={t("Выберите замеры и группировки, затем примените изменения")} />
        </section>
      ) : loading && !result ? (
        <section className={`mx-[30px] mt-[20px] ${CARD}`}>
          <BuilderEmpty text={t("Загрузка...")} />
        </section>
      ) : error ? (
        <section className={`mx-[30px] mt-[20px] ${CARD}`}>
          <BuilderEmpty text={t(error)} />
        </section>
      ) : !hasTable ? (
        <BuilderNoData className="mx-[30px] mt-[20px]" />
      ) : view === TABLE_VIEW ? (
        <div className={`mx-[30px] mt-[20px] overflow-x-auto rounded-[8px] ${CARD} ${loading ? "opacity-60" : ""}`}>
          <BuilderTable result={result} formatted={applied.options.formatted} totalsRight={applied.options.totalsRight} merge={applied.options.merge} />
        </div>
      ) : (
        <section className={`mx-[30px] mt-[20px] p-[20px] ${CARD}`}>
          <BuilderChart result={result} view={view} />
        </section>
      )}

      {saveOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setSaveOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="old-save-title" onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-[520px] rounded-[4px] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#e8e8e8] px-[30px] py-[20px]">
              <h2 id="old-save-title" className="text-[14px] font-bold uppercase">{t("СОХРАНИТЬ ТАБЛИЦУ")}</h2>
              <button type="button" onClick={() => setSaveOpen(false)} aria-label={t("Закрыть")} className="text-[#555] hover:text-black"><X className="h-6 w-6" /></button>
            </header>
            <div className="px-[30px] py-[24px]">
              <label className="block">
                <span className="mb-2 block text-[13px] font-semibold text-[#555]">{t("Название таблицы")}</span>
                <input autoFocus value={saveName} onChange={(event) => setSaveName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save() }} maxLength={255} className="w-full border-0 border-b border-[#d5d5d5] pb-2 text-[14px] outline-none focus:border-[#1E4A9A]" />
              </label>
            </div>
            <footer className="flex justify-end border-t border-[#e8e8e8] px-[30px] py-[16px]">
              <button type="button" disabled={!saveName.trim()} onClick={() => void save()} className="text-[13px] font-semibold uppercase text-[#1E4A9A] disabled:text-[#bbb]">{t("Сохранить")}</button>
            </footer>
          </div>
        </div>
      )}

      {listOpen && <SavedReportsDialog kind={listOpen} onClose={() => setListOpen(null)} onOpen={loadSaved} />}

      {snack && (
        <div role="status" className="fixed bottom-0 left-1/2 z-[120] min-w-[288px] -translate-x-1/2 rounded-t-[2px] bg-[#333] px-[24px] py-[14px] text-[14px] leading-[20px] text-white shadow-lg">{snack}</div>
      )}
    </ReportPage>
  )
}

function FolderStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white" aria-hidden>
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2.06 11L15 15.28 12.06 17l.78-3.33-2.59-2.24 3.41-.29L15 8l1.34 3.14 3.41.29-2.59 2.24.78 3.33z" />
    </svg>
  )
}

type SavedReport = { id: number; name: string; config: unknown }

/** "ОТЧЕТЫ" / "ВИДЖЕТЫ": the saved reports of the builder, full screen, as the reference opens them. */
function SavedReportsDialog({ kind, onClose, onOpen }: { kind: "reports" | "widgets"; onClose: () => void; onOpen: (config: unknown) => void }) {
  const { t } = useLanguage()
  const tabs = kind === "reports"
    ? ["Мои отчеты", "Отчеты сотрудников", "Все", "Шаблоны отчетов", "Статические виджеты"]
    : ["Мои виджеты", "Виджеты сотрудников", "Все", "Шаблоны виджетов", "Статические виджеты"]
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [reports, setReports] = useState<SavedReport[] | null>(null)
  const PAGE = 25

  useEffect(() => {
    let cancelled = false
    fetch("/api/old-saved-reports")
      .then((response) => (response.ok ? (response.json() as Promise<SavedReport[]>) : Promise.reject()))
      .then((data) => { if (!cancelled) setReports(data) })
      .catch(() => { if (!cancelled) setReports([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // This app keeps the reports of its own users only: "Мои" and "Все" list them, the other tabs have none.
  const own = tab === 0 || tab === 2
  const needle = query.trim().toLocaleLowerCase("ru")
  const list = (own ? reports ?? [] : []).filter((report) => !needle || report.name.toLocaleLowerCase("ru").includes(needle))
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * PAGE, current * PAGE + PAGE)
  const modelOf = (report: SavedReport) => {
    const model = (report.config as { model?: unknown } | null)?.model
    return typeof model === "string" ? model : ""
  }
  const chartOf = (report: SavedReport) => {
    const view = (report.config as { view?: unknown } | null)?.view
    return typeof view === "number" && view >= 0 && view < TABLE_VIEW ? VIEWS[view].name : "Отсутствует"
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="old-reports-title" className="fixed inset-0 z-[110] flex flex-col bg-white">
      <header className="flex h-[56px] items-center justify-between border-b border-[#e0e0e0] px-[30px]">
        <h2 id="old-reports-title" className="text-[13px] font-bold uppercase">{t(kind === "reports" ? "ОТЧЕТЫ" : "ВИДЖЕТЫ")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555] hover:text-black"><X className="h-[22px] w-[22px]" /></button>
      </header>
      <nav className="grid grid-cols-5 shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
        {tabs.map((item, index) => (
          <button key={item} type="button" onClick={() => { setTab(index); setPage(0) }} className={`h-[52px] border-b-[3px] text-[13px] ${tab === index ? "border-[#1E4A9A] text-black" : "border-transparent text-[#333]"}`}>{t(item)}</button>
        ))}
      </nav>
      <div className="flex items-center justify-between border-b border-[#e8e8e8] px-[30px] py-[14px]">
        <label className="relative w-[275px]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder={t("Поиск таблицы...")} className="h-[32px] w-full border-b border-[#d5d5d5] pr-[30px] text-[13px] outline-none placeholder:text-[#999]" />
          <Search className="absolute right-[-20px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#999]" />
        </label>
        <div className="flex items-center gap-[10px] text-[13px] text-[#555]">
          <span>{list.length ? `${current * PAGE + 1} - ${current * PAGE + shown.length}` : "0 - 0"} {t("из")} {list.length}</span>
          <button type="button" aria-label={t("Назад")} disabled={current === 0} onClick={() => setPage(current - 1)} className="flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-current text-[#777] disabled:text-[#ccc]"><svg viewBox="0 0 24 24" className="h-[12px] w-[12px] fill-current"><path d="M15 6v12l-8-6z" /></svg></button>
          <button type="button" aria-label={t("Вперед")} disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-current text-[#777] disabled:text-[#ccc]"><svg viewBox="0 0 24 24" className="h-[12px] w-[12px] fill-current"><path d="M9 6v12l8-6z" /></svg></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[1fr_3fr_3fr_2fr_3fr_2fr] items-center border-b border-dotted border-[#bbb] px-[30px] py-[18px] text-center text-[13px] font-bold">
          <span className="text-left">№</span><span>{t("Название")}</span><span>{t("Модель")}</span><span>{t("Тип")}</span><span>{t("Тип графика")}</span><span />
        </div>
        {reports === null && <p className="py-[40px] text-center text-[13px] text-[#999]">{t("Загрузка...")}</p>}
        {reports !== null && shown.map((report) => (
          <button key={report.id} type="button" onClick={() => onOpen(report.config)} className="grid w-full grid-cols-[1fr_3fr_3fr_2fr_3fr_2fr] items-center border-b border-dotted border-[#bbb] px-[30px] py-[14px] text-center text-[13px] hover:bg-[#f5f5f5]">
            <span className="text-left">{report.id}</span>
            <span>{report.name}</span>
            <span>{modelOf(report) ? t(modelOf(report)) : ""}</span>
            <span>{t("Таблица")}</span>
            <span>{t(chartOf(report))}</span>
            <span />
          </button>
        ))}
        {reports !== null && shown.length === 0 && <p className="py-[40px] text-center text-[13px] text-[#999]">{t("По вашему запросу ничего не найдено")}</p>}
      </div>
    </div>
  )
}
