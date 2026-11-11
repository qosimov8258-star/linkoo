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
import { BuilderPeriod, currentMonthPeriod, isoParam } from "./builder-period"
import { BuilderNoData, BuilderTable, builderNumber } from "./builder-table"

// Конструктор отчетов (the reference's "old" quick report, #/quick-report): the period, a "Модель" (the report
// model) and the toolbar panels; every panel applies with ПРИМЕНИТЬ. The models and what the panels of a model list
// (the measures of Колонки, the groupings, the selects of Быстрый фильтр, the fields of Фильтры) come from the
// server (GET /api/report-builder?kind=old, lib/old-report), which also builds the table. A field the reference
// lists and this app has no data for is greyed out.

type ModelRef = { key: string; name: string }
type FieldInfo = { id: string; name: string; hint?: string; supported: boolean }
type ModelInfo = { key: string; name: string; columns: FieldInfo[]; groups: FieldInfo[]; filters: FieldInfo[]; compare: FieldInfo[]; operations: { id: string; name: string }[] }

type PanelKey = "columns" | "table" | "vertical" | "horizontal" | "filters" | "quick"
type TableOptions = { formatted: boolean; totalsRight: boolean; totalsBottom: boolean; merge: boolean; activeFilter: boolean }
/** A row of «Фильтры»: what to filter, how, and the value. */
type CompareFilter = { field: string; op: string; value: string }
type Settings = {
  /** The model's key. */
  model: string
  /** Field ids of the model. */
  columns: string[]
  vertical: string[]
  horizontal: string[]
  /** «Быстрый фильтр»: filter id → the chosen values. */
  filters: Record<string, string[]>
  compare: CompareFilter[]
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
const EMPTY_SETTINGS: Settings = { model: "", columns: [], vertical: [], horizontal: [], filters: {}, compare: [], options: DEFAULT_OPTIONS }
const DEFAULT_OPERATION = "contains"
/** Version of the saved settings: 2 = a model key and field ids (1 kept the Russian names). */
const SAVED_VERSION = 2

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
function ToolbarPanel({ title, onClose, onApply, className = "", wide = false, padded = true, hideApply = false, children }: { title: string; onClose: () => void; onApply: () => void; className?: string; wide?: boolean; padded?: boolean; hideApply?: boolean; children?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div role="dialog" aria-label={title} className={`absolute z-30 rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] ${wide ? "inset-x-0" : "w-[310px]"} ${className}`}>
      <header className="flex items-center justify-between px-[20px] pb-[8px] pt-[21px]">
        <h2 className="text-[15px] leading-[24px] text-[#555]">{title}</h2>
        <CircleClose onClick={onClose} label={t("Закрыть")} />
      </header>
      <div className={`px-[20px] ${padded ? "pb-[15px]" : ""}`}>{children}</div>
      {!hideApply && (
        <div className="px-[20px] pb-[10px] pt-[15px]">
          <button type="button" onClick={onApply} className={`h-[36px] min-w-[88px] rounded-[2px] bg-[#5d6474] px-[16px] text-[13px] uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-110 ${wide ? "" : "w-full"}`}>{t("ПРИМЕНИТЬ")}</button>
        </div>
      )}
    </div>
  )
}

/** A line of a panel list: the box, the name and, for the items the reference explains, ⓘ with the hint. A field
 * this app has no data for is greyed out and cannot be ticked. */
function CheckItem({ checked, onChange, label, hint, disabled = false, disabledHint }: { checked: boolean; onChange: () => void; label: ReactNode; hint?: string; disabled?: boolean; disabledHint?: string }) {
  return (
    <label title={disabled ? disabledHint : undefined} className={`flex items-start py-[5px] text-[13px] font-semibold leading-[20px] ${disabled ? "cursor-not-allowed text-[#b5b5b5]" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={onChange} className={`${BOX} ml-[2px] mt-[2px] ${disabled ? "cursor-not-allowed border-[#c9c9c9]" : ""}`} />
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

/** A native select on an underline (the field and the operation of a «Фильтры» row). */
function LineSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string; disabled?: boolean }[] }) {
  const chosen = options.find((option) => option.id === value)
  return (
    <label className="relative block h-[45px] min-w-0 flex-1 border-b border-[#e0e0e0]">
      <span className={`absolute inset-x-0 top-[21px] truncate pr-6 text-[13px] leading-[18px] ${chosen ? "font-semibold text-[#1E4A9A]" : "text-black"}`}>{chosen ? chosen.name : label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
        <option value="">{label}</option>
        {options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.name}</option>)}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[2px] right-[4px] h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}

/**
 * A select of «Быстрый фильтр» as the reference has it: several values at once, a search, the picked values as
 * chips. The options are asked for when the list is first opened (`load`).
 */
function QuickSelect({ label, value, onChange, load, disabled = false }: { label: string; value: string[]; onChange: (value: string[]) => void; load: () => Promise<string[]>; disabled?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  const show = () => {
    if (disabled) return
    setOpen(true)
    if (options === null) {
      setFailed(false)
      load().then(setOptions, () => { setOptions(null); setFailed(true) })
    }
  }
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = (options ?? []).filter((option) => !needle || option.toLocaleLowerCase("ru").includes(needle))

  return (
    <div ref={ref} className="relative">
      <div
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-expanded={open}
        aria-controls={undefined}
        aria-disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) setOpen(false); else show() }
          else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false) }
        }}
        className={`relative min-h-[45px] border-b border-[#e0e0e0] pr-[44px] outline-none focus-visible:border-[#5d6474] ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className={`absolute left-0 truncate text-[13px] leading-[18px] ${value.length ? "top-[2px] text-[11px] text-[#777]" : `top-[21px] ${disabled ? "text-[#b5b5b5]" : "text-black"}`}`}>{label}</span>
        {value.length > 0 && (
          <span className="flex flex-wrap gap-[4px] pb-[5px] pt-[19px]">
            {value.map((item) => (
              <span key={item} className="flex max-w-full items-center overflow-hidden rounded-[2px] bg-[#e8eefa] text-[12px] leading-[20px] text-[#1E4A9A]">
                <button type="button" aria-label={`${t("Удалить")} ${item}`} onClick={(event) => { event.stopPropagation(); toggle(item) }} className="border-r border-[#c9d6f0] px-[5px] hover:bg-[#d5e0f6]">×</button>
                <span className="truncate px-[6px]">{item}</span>
              </span>
            ))}
          </span>
        )}
        {value.length > 0 && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onChange([]) }} className="absolute bottom-[8px] right-[26px] text-[#999] hover:text-[#d0011b]"><X className="h-[13px] w-[13px]" /></button>
        )}
        <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[2px] right-[4px] h-6 w-6 fill-[#999] ${open ? "rotate-180" : ""}`} aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-40 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} aria-label={`${t("Поиск")}: ${label}`} className="h-[34px] w-full border-b border-[#ececec] px-[10px] text-[13px] outline-none" />
          <div role="listbox" aria-label={label} aria-multiselectable className="max-h-[220px] overflow-y-auto">
            {options === null && <div className="px-[10px] py-[8px] text-[13px] text-[#999]">{t(failed ? "Не удалось загрузить данные" : "Загрузка...")}</div>}
            {options !== null && shown.length === 0 && <div className="px-[10px] py-[8px] text-[13px] text-[#999]">{t("По вашему запросу ничего не найдено")}</div>}
            {shown.slice(0, 300).map((option) => (
              <div key={option} role="option" aria-selected={value.includes(option)} onClick={() => toggle(option)} className={`cursor-pointer px-[10px] py-[8px] text-[13px] leading-[16px] ${value.includes(option) ? "bg-[#e8eefa] text-[#1E4A9A]" : "text-[#333] hover:bg-[#efefef]"}`}>{option}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The "Модель" select of the reference (a searchable select): the label alone while empty; with a model, the label on
 * top, the model, ✕ and ▾. Typing filters the models, ↑/↓ move the marked one, Enter picks it, Esc closes the list.
 */
function ModelSelect({ models, value, valueName, onChange }: { models: ModelRef[] | null; value: string; valueName: string; onChange: (model: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [marked, setMarked] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLocaleLowerCase("ru")
  const all = models ?? []
  const shown = all.filter((model) => !needle || t(model.name).toLocaleLowerCase("ru").includes(needle))

  const show = () => {
    setOpen(true)
    setMarked(Math.max(0, all.findIndex((model) => model.key === value)))
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
      if (open && shown[marked]) pick(shown[marked].key)
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
      {value && !query && <span className="pointer-events-none absolute left-0 right-[44px] top-[22px] truncate text-[13px] leading-[18px] text-[#333]">{t(valueName)}</span>}
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
          {models === null && <div className="px-[10px] py-[8px] text-[13px] leading-[16px] text-[#999]">{t("Загрузка...")}</div>}
          {shown.map((model, index) => (
            <div
              key={model.key}
              data-index={index}
              role="option"
              aria-selected={model.key === value}
              onMouseEnter={() => setMarked(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(model.key)}
              className={`cursor-pointer px-[10px] py-[8px] text-[13px] leading-[16px] text-[#333] ${index === marked ? "bg-[#efefef]" : ""}`}
            >
              {t(model.name)}
            </div>
          ))}
          {models !== null && shown.length === 0 && <div className="px-[10px] py-[8px] text-[13px] leading-[16px] text-[#999]">{t("По вашему запросу ничего не найдено")}</div>}
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

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [])

/** Saved settings of version 1 name their fields in Russian, some with the new builder's «Продукт …» / «Магазин …»
 * prefix: the field of the model's list that carries the name. */
function legacyId(list: FieldInfo[], name: string): string | null {
  const wanted = [name, name.replace(/^Продукт /, ""), name.replace(/^Магазин /, "")]
  for (const candidate of wanted) {
    const found = list.find((field) => field.name === candidate)
    if (found) return found.id
  }
  return null
}

export function OldReportBuilderView() {
  const { t } = useLanguage()
  const appCurrency = useAppCurrency()
  const [period, setPeriod] = useState(currentMonthPeriod)
  const [models, setModels] = useState<ModelRef[] | null>(null)
  const [infos, setInfos] = useState<Record<string, ModelInfo>>({})
  const [applied, setApplied] = useState<Settings>(EMPTY_SETTINGS)
  const [draft, setDraft] = useState<Settings>(EMPTY_SETTINGS)
  const [open, setOpen] = useState<PanelKey | null>(null)
  const [adding, setAdding] = useState<CompareFilter | null>(null)
  const [view, setView] = useState(TABLE_VIEW)
  const [hoverView, setHoverView] = useState<number | null>(null)
  const [snack, setSnack] = useState("")
  const [result, setResult] = useState<BuilderResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [listOpen, setListOpen] = useState<"reports" | "widgets" | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const infoRequests = useRef(new Map<string, Promise<ModelInfo | null>>())
  const optionRequests = useRef(new Map<string, Promise<string[]>>())

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

  // The models this user may build reports of.
  useEffect(() => {
    let cancelled = false
    fetch("/api/report-builder?kind=old")
      .then((response) => (response.ok ? (response.json() as Promise<{ models: ModelRef[] }>) : Promise.reject()))
      .then((data) => { if (!cancelled) setModels(Array.isArray(data.models) ? data.models : []) })
      .catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [])

  /** The panel lists of a model (asked once per model). */
  const loadInfo = useCallback((key: string): Promise<ModelInfo | null> => {
    let pending = infoRequests.current.get(key)
    if (!pending) {
      pending = fetch(`/api/report-builder?kind=old&model=${encodeURIComponent(key)}`)
        .then((response) => (response.ok ? (response.json() as Promise<ModelInfo>) : null))
        .then((info) => {
          if (info) setInfos((current) => ({ ...current, [key]: info }))
          else infoRequests.current.delete(key)
          return info
        })
        .catch(() => { infoRequests.current.delete(key); return null })
      infoRequests.current.set(key, pending)
    }
    return pending
  }, [])

  const modelKey = draft.model || applied.model
  useEffect(() => {
    if (modelKey) void loadInfo(modelKey)
  }, [modelKey, loadInfo])
  const info = modelKey ? infos[modelKey] : undefined
  const appliedInfo = applied.model ? infos[applied.model] : undefined

  const closePanel = useCallback(() => { setOpen(null); setAdding(null) }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closePanel() }
    const onDown = (event: MouseEvent) => { if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) closePanel() }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown) }
  }, [open, closePanel])

  const openPanel = (key: PanelKey) => {
    if (open === key) return closePanel()
    setDraft(applied)
    setAdding(null)
    setOpen(key)
  }
  const apply = () => {
    setApplied(draft)
    closePanel()
  }

  const chooseModel = (model: string) => {
    // Another model has other lists: what was chosen for the previous one does not carry over.
    const next: Settings = model === applied.model ? applied : { ...EMPTY_SETTINGS, model, options: applied.options }
    setApplied(next)
    setDraft(next)
    closePanel()
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
    setLoading(true)
    setError("")
    fetch("/api/report-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "old",
        model: applied.model,
        from: period.from,
        to: period.to,
        columns: applied.columns,
        vertical: applied.vertical,
        horizontal: applied.horizontal,
        filters: applied.filters,
        compare: applied.compare.filter((item) => item.field && item.value.trim()),
        showTotals: applied.options.totalsBottom,
      }),
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

  /** The options of a select of «Быстрый фильтр» (asked once per model, filter and period). */
  const loadOptions = (filter: string) => {
    const key = `${modelKey}\u0001${filter}\u0001${period.from}\u0001${period.to}`
    let pending = optionRequests.current.get(key)
    if (!pending) {
      pending = fetch(`/api/report-builder?kind=old&model=${encodeURIComponent(modelKey)}&filter=${encodeURIComponent(filter)}&from=${period.from}&to=${period.to}`)
        .then((response) => (response.ok ? (response.json() as Promise<{ options: string[] }>) : Promise.reject()))
        .then((data) => (Array.isArray(data.options) ? data.options : []))
      pending.catch(() => optionRequests.current.delete(key))
      optionRequests.current.set(key, pending)
    }
    return pending
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
        body: JSON.stringify({ name: saveName.trim(), config: { v: SAVED_VERSION, ...applied, modelName: appliedInfo?.name ?? "", from: period.from, to: period.to, view } }),
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

  /** Opens a saved report: its model, fields, filters, period and view. */
  const loadSaved = async (config: unknown) => {
    const data = (config && typeof config === "object" ? config : {}) as Record<string, unknown>
    const current = data.v === SAVED_VERSION
    // Version 1 kept the model's name.
    const key = current ? String(data.model ?? "") : ((models ?? []).find((model) => model.name === data.model)?.key ?? "")
    const found = key && (models ?? []).some((model) => model.key === key) ? await loadInfo(key) : null
    if (!found) {
      setListOpen(null)
      setSnack(t("Модель этого отчета недоступна"))
      return
    }
    const ids = (value: unknown, list: FieldInfo[]) =>
      strings(value).flatMap((item) => {
        const id = current ? (list.some((field) => field.id === item) ? item : null) : legacyId(list, item)
        return id ? [id] : []
      })
    const filters: Record<string, string[]> = {}
    if (data.filters && typeof data.filters === "object" && !Array.isArray(data.filters)) {
      for (const [name, value] of Object.entries(data.filters as Record<string, unknown>)) {
        const id = current ? (found.filters.some((field) => field.id === name) ? name : null) : legacyId(found.filters, name)
        const chosen = typeof value === "string" ? (value ? [value] : []) : strings(value)
        if (id && chosen.length) filters[id] = chosen
      }
    }
    const compare: CompareFilter[] = current && Array.isArray(data.compare)
      ? (data.compare as unknown[]).flatMap((item) => {
          const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>
          return typeof row.field === "string" && typeof row.op === "string" && typeof row.value === "string" && found.compare.some((field) => field.id === row.field)
            ? [{ field: row.field, op: row.op, value: row.value }]
            : []
        })
      : []
    const next: Settings = {
      model: key,
      columns: ids(data.columns, found.columns),
      vertical: ids(data.vertical, found.groups),
      horizontal: ids(data.horizontal, found.groups),
      filters,
      compare,
      options: { ...DEFAULT_OPTIONS, ...(data.options && typeof data.options === "object" ? (data.options as Partial<TableOptions>) : {}) },
    }
    setApplied(next)
    setDraft(next)
    const from = isoParam(typeof data.from === "string" ? data.from : null)
    const to = isoParam(typeof data.to === "string" ? data.to : null)
    if (from && to && from <= to) applyPeriod(from, to)
    setView(typeof data.view === "number" && data.view >= 0 && data.view <= TABLE_VIEW ? data.view : TABLE_VIEW)
    setListOpen(null)
  }

  const label = (field: FieldInfo) => appCurrencyColumn(field.name, t, appCurrency)
  const noData = t("В системе нет данных для этого поля")
  const fieldName = (list: FieldInfo[] | undefined, id: string) => { const field = list?.find((item) => item.id === id); return field ? label(field) : id }
  const operationName = (id: string) => t(info?.operations.find((item) => item.id === id)?.name ?? id)
  const quickCount = Object.values(applied.filters).filter((values) => values.length).length
  const compareCount = applied.compare.filter((item) => item.field && item.value.trim()).length
  const activeFilters = useMemo(
    () => [
      ...Object.entries(applied.filters).filter(([, values]) => values.length).map(([id, values]) => `${fieldName(appliedInfo?.filters, id)}: ${values.join(", ")}`),
      ...applied.compare.filter((item) => item.field && item.value.trim()).map((item) => `${fieldName(appliedInfo?.compare, item.field)} ${t(appliedInfo?.operations.find((op) => op.id === item.op)?.name ?? item.op)} ${item.value.trim()}`),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applied, appliedInfo, t],
  )
  const notices = [
    result?.unsupported.length ? `${t("Нет данных для")}: ${result.unsupported.map((item) => t(item)).join(", ")}` : "",
    result?.missingRates?.length ? `${t("Курс валюты не задан")}: ${result.missingRates.join(", ")}` : "",
  ].filter(Boolean)
  const groupItem = (field: FieldInfo, side: "vertical" | "horizontal") => (
    <CheckItem
      key={field.id}
      label={label(field)}
      hint={field.hint ? t(field.hint) : undefined}
      disabled={!field.supported}
      disabledHint={noData}
      checked={draft[side].includes(field.id)}
      onChange={() => setDraft((current) => {
        const other = side === "vertical" ? "horizontal" : "vertical"
        return { ...current, [side]: toggleIn(current[side], field.id), [other]: current[other].filter((value) => value !== field.id) }
      })}
    />
  )

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Конструктор отчетов")} /></div>

      <section className={`relative mx-[30px] ${CARD}`}>
        <div className="relative h-[50px] border-b border-[#ececec]">
          <BuilderPeriod from={period.from} to={period.to} onApply={applyPeriod} align="left" textClassName="text-[13px]" className="absolute left-[8px] top-[-3px] w-[200px]" />
          <div className="absolute left-[calc(33.333%+24px)] top-[0px]">
            <ModelSelect models={models} value={applied.model} valueName={(models ?? []).find((model) => model.key === applied.model)?.name ?? appliedInfo?.name ?? ""} onChange={chooseModel} />
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
                {(info?.columns ?? []).map((field) => (
                  <CheckItem key={field.id} label={label(field)} hint={field.hint ? t(field.hint) : undefined} disabled={!field.supported} disabledHint={noData} checked={draft.columns.includes(field.id)} onChange={() => setDraft((current) => ({ ...current, columns: toggleIn(current.columns, field.id) }))} />
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
                  {OPTION_LABELS.map(([key, name]) => (
                    <CheckItem key={key} label={t(name)} checked={draft.options[key]} onChange={() => setDraft((current) => ({ ...current, options: { ...current.options, [key]: !current.options[key] } }))} />
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
                  {(info?.groups ?? []).filter((field) => !draft.horizontal.includes(field.id)).map((field) => groupItem(field, "vertical"))}
                </ToolbarPanel>
              )}
            </div>
            <div className="relative">
              <button type="button" aria-expanded={open === "horizontal"} onClick={() => openPanel("horizontal")} className={`${CHIP} w-[135px] items-center text-center`}>
                <ChipLabel text={t("Горизонтальная групировка")} />
              </button>
              {open === "horizontal" && (
                <ToolbarPanel title={t("Горизонтальная групировка")} onClose={closePanel} onApply={apply} className="right-[-14px] top-0">
                  {(info?.groups ?? []).filter((field) => !draft.vertical.includes(field.id)).map((field) => groupItem(field, "horizontal"))}
                </ToolbarPanel>
              )}
            </div>
            <div className="relative flex items-center">
              <button type="button" aria-expanded={open === "filters"} onClick={() => openPanel("filters")} className={LINK}>
                {t("Фильтры")}{compareCount ? ` (${compareCount})` : ""} <Chevron />
              </button>
              {open === "filters" && (
                <ToolbarPanel title={t("Фильтры")} onClose={closePanel} onApply={apply} hideApply={!!adding} padded={false} className="right-[-16px] top-0">
                  {draft.compare.map((item, index) => (
                    <div key={index} className="flex items-center gap-[8px] border-t border-[#e0e0e0] py-[8px] text-[13px] leading-[18px]">
                      <span className="min-w-0 flex-1 break-words"><span className="font-semibold">{fieldName(info?.compare, item.field)}</span> {operationName(item.op)} <span className="font-semibold text-[#1E4A9A]">{item.value}</span></span>
                      <button type="button" aria-label={t("Удалить фильтр")} onClick={() => setDraft((current) => ({ ...current, compare: current.compare.filter((_, i) => i !== index) }))} className="text-[#777] hover:text-black"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="border-t border-[#e0e0e0]" />
                  <button type="button" onClick={() => setAdding(adding ? null : { field: "", op: DEFAULT_OPERATION, value: "" })} className="mt-[2px] block h-[36px] min-w-[88px] rounded-[2px] px-[16px] text-[13px] uppercase text-[#333] hover:bg-[#f2f2f2]">{t(adding ? "ОТМЕНИТЬ ДОБАВЛЕНИЕ" : "ДОБАВЛЕНИЕ ФИЛЬТРА")}</button>
                  {adding && (
                    <div className="pb-[10px]">
                      <div className="mt-[10px]"><LineSelect label={t("Что фильтровать")} value={adding.field} onChange={(field) => setAdding({ ...adding, field })} options={(info?.compare ?? []).map((field) => ({ id: field.id, name: label(field), disabled: !field.supported }))} /></div>
                      <div className="mt-[20px]"><LineSelect label={t("Как фильтровать")} value={adding.op} onChange={(op) => setAdding({ ...adding, op: op || DEFAULT_OPERATION })} options={(info?.operations ?? []).map((item) => ({ id: item.id, name: t(item.name) }))} /></div>
                      <input aria-label={t("Укажите значение")} placeholder={t("Укажите значение")} value={adding.value} maxLength={300} onChange={(event) => setAdding({ ...adding, value: event.target.value })} className="mt-[26px] h-[34px] w-full border-b border-[#e0e0e0] text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black focus:border-[#5d6474]" />
                      <button
                        type="button"
                        disabled={!adding.field || !adding.value.trim()}
                        onClick={() => { setDraft((current) => ({ ...current, compare: [...current.compare, { ...adding, value: adding.value.trim() }] })); setAdding(null) }}
                        className="mt-[38px] flex h-[36px] w-full items-center justify-center gap-[6px] rounded-[2px] bg-[#1E4A9A] text-[13px] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-110 disabled:opacity-50"
                      >
                        <span className="text-[18px] leading-none">+</span>{t("Создать")}
                      </button>
                    </div>
                  )}
                </ToolbarPanel>
              )}
            </div>
            <div className="flex items-center">
              <button type="button" aria-expanded={open === "quick"} onClick={() => openPanel("quick")} className={LINK}>
                {t("Быстрый фильтр")}{quickCount ? ` (${quickCount})` : ""} <Chevron />
              </button>
            </div>
          </div>

          {open === "quick" && (
            <ToolbarPanel title={t("Фильтр")} onClose={closePanel} onApply={apply} wide padded={false} className="top-0">
              {(info?.filters.length ?? 0) > 0 && (
                <div className="grid grid-cols-1 gap-x-[10px] gap-y-[22px] pb-[9px] pt-[18px] sm:grid-cols-2 lg:grid-cols-4">
                  {(info?.filters ?? []).map((field) => (
                    <QuickSelect key={`${modelKey}-${field.id}-${period.from}-${period.to}`} label={label(field)} disabled={!field.supported} value={draft.filters[field.id] ?? []} load={() => loadOptions(field.id)} onChange={(value) => setDraft((current) => ({ ...current, filters: { ...current.filters, [field.id]: value } }))} />
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
      {ready && notices.length > 0 && (
        <p role="status" className="mx-[30px] mt-[12px] text-[13px] leading-[18px] text-[#e57373]">{notices.join(" · ")}</p>
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

      {listOpen && <SavedReportsDialog kind={listOpen} models={models ?? []} onClose={() => setListOpen(null)} onOpen={(config) => void loadSaved(config)} />}

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
function SavedReportsDialog({ kind, models, onClose, onOpen }: { kind: "reports" | "widgets"; models: ModelRef[]; onClose: () => void; onOpen: (config: unknown) => void }) {
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
  // The model's name: of the list, else the one saved with the report (version 1 saved the name as the model).
  const modelOf = (report: SavedReport) => {
    const config = (report.config ?? {}) as { model?: unknown; modelName?: unknown }
    const model = typeof config.model === "string" ? config.model : ""
    return models.find((item) => item.key === model)?.name ?? (typeof config.modelName === "string" && config.modelName ? config.modelName : model)
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
