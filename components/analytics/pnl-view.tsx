"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { ReportEmpty, ReportPage, WidgetHeader, formatShortReportDate } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { PnlExpense, PnlFigures, PnlOptions, PnlRow, PnlStats } from "@/lib/pnl-stats-repo"

// "P&L" tab of the dashboard widgets: two periods side by side. Metric tabs choose the figure shown in the
// breakdown tables; "Убывающие" / "Возрастающие" keep only rows whose figure fell / rose between the periods.

const metricTabs: { label: string; pick: (figures: PnlFigures) => number }[] = [
  { label: "РЕАЛИЗАЦИЯ", pick: (figures) => figures.sales },
  { label: "ВОЗВРАТЫ", pick: (figures) => figures.returns },
  { label: "ЧИСТАЯ РЕАЛИЗАЦИЯ", pick: (figures) => figures.factSales },
  { label: "ВАЛОВАЯ ПРИБЫЛЬ", pick: (figures) => figures.profit },
  { label: "РЕНТАБЕЛЬНОСТЬ ВП", pick: (figures) => figures.rentability },
]
const sortModes = ["УБЫВАЮЩИЕ", "ВОЗРАСТАЮЩИЕ", "ВСЕ"] as const
type SortMode = (typeof sortModes)[number]

const pad = (value: number) => String(value).padStart(2, "0")
const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// the reference opens on "the same days of last month" against "this month so far"
function defaultPeriods(today = new Date()) {
  const year = today.getFullYear()
  const month = today.getMonth()
  const lastOfPrevious = new Date(year, month, 0).getDate()
  return {
    firstBegin: toIso(new Date(year, month - 1, 1)),
    firstEnd: toIso(new Date(year, month - 1, Math.min(today.getDate(), lastOfPrevious))),
    secondBegin: toIso(new Date(year, month, 1)),
    secondEnd: toIso(today),
  }
}

const format = (value: number) => {
  const rounded = Math.round(value) || 0
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.abs(rounded))
  return rounded < 0 ? `-${text}` : text
}

const CARD = "bg-white pb-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const CELL = "border-b border-r border-[#efefef] px-[17.5px] py-[7.8px] text-[13px] leading-[19.5px] text-[#333]"
const HEAD = "whitespace-nowrap bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold leading-[19.5px] text-[#374557]"

type Line = { key: string; name: string; first: number; second: number; raw?: boolean; bold?: boolean; indent?: number; link?: boolean; toggle?: { open: boolean; onToggle: () => void } }
type SortKey = "first" | "second" | "diff"

function SortArrows({ active, dir, onSort }: { active: boolean; dir: "asc" | "desc"; onSort: (dir: "asc" | "desc") => void }) {
  return (
    <span className="relative ml-[5px] inline-block h-[15px] w-[15px] align-middle">
      <button type="button" aria-label="asc" onClick={() => onSort("asc")} className="absolute left-0 top-0">
        <svg viewBox="0 0 24 24" className={`h-[15px] w-[15px] ${active && dir === "asc" ? "fill-[#333]" : "fill-[#888]"}`}><path d="M7 14l5-5 5 5z" /></svg>
      </button>
      <button type="button" aria-label="desc" onClick={() => onSort("desc")} className="absolute left-0 top-[5px]">
        <svg viewBox="0 0 24 24" className={`h-[15px] w-[15px] ${active && dir === "desc" ? "fill-[#333]" : "fill-[#888]"}`}><path d="M7 10l5 5 5-5z" /></svg>
      </button>
    </span>
  )
}

function DiffCell({ first, second, wide = false }: { first: number; second: number; wide?: boolean }) {
  const diff = second - first
  const sign = Math.round(diff)
  const percent = first ? Math.round((diff / first) * 100) : 0
  const tone = sign === 0 ? "" : sign < 0 ? "bg-[#e57373] text-white" : "bg-[#8acb8d] text-white"
  return (
    <td className={`border-b border-r border-[#efefef] p-[5px] text-[13px] font-semibold leading-[19.5px] ${tone || "text-[#333]"}`}>
      <div className={`flex items-center justify-between ${wide ? "min-w-[189px]" : ""}`}>
        <span>{percent} %</span>
        <span>{format(diff)}</span>
      </div>
    </td>
  )
}

function CompareTable({ title, lines, sortable = false, total = false, widths, className = "" }: { title: string; lines: Line[]; sortable?: boolean; total?: boolean; widths?: string[]; className?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null)
  const rows = useMemo(() => {
    if (!sort) return lines
    const value = (line: Line) => (sort.key === "first" ? line.first : sort.key === "second" ? line.second : line.second - line.first)
    return [...lines].sort((a, b) => (sort.dir === "asc" ? value(a) - value(b) : value(b) - value(a)))
  }, [lines, sort])
  const firstTotal = lines.reduce((sum, line) => sum + line.first, 0)
  const secondTotal = lines.reduce((sum, line) => sum + line.second, 0)
  const head = (key: SortKey, label: string) => (
    <th className={HEAD}>
      {t(label)}
      {sortable && <SortArrows active={sort?.key === key} dir={sort?.dir ?? "asc"} onSort={(dir) => setSort({ key, dir })} />}
    </th>
  )
  return (
    <div className={`${CARD} ${className}`}>
      <div className="pb-[10px]">
        <table className={`w-full border-separate border-spacing-0 ${widths ? "table-fixed" : ""}`}>
          {widths && (
            <colgroup>
              {widths.map((width) => (
                <col key={width} style={{ width }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <th className={HEAD}>{t(title)}</th>
              {head("first", "Первый период")}
              {head("second", "Второй период")}
              {head("diff", "Разница")}
            </tr>
          </thead>
          {rows.length > 0 && (
            <tbody>
              {rows.map((line) => {
                const weight = line.bold ? "font-semibold" : ""
                return (
                  <tr key={line.key}>
                    <td className={`${CELL} ${weight}`} style={line.indent ? { paddingLeft: 17.5 + line.indent } : undefined}>
                      {line.toggle ? (
                        <div className="flex items-center justify-between">
                          <span>{t(line.name)}</span>
                          <button type="button" aria-label={t(line.name)} onClick={line.toggle.onToggle}>
                            <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-[#333] transition-transform ${line.toggle.open ? "rotate-180" : ""}`}><path d="M7.41 7.84L12 12.42l4.59-4.58L18 9.25l-6 6-6-6z" /></svg>
                          </button>
                        </div>
                      ) : line.link ? (
                        <button type="button" onClick={() => router.push("/clients/territory")} className="text-[13px] leading-[18px] text-[#129fdd]">{line.name}</button>
                      ) : line.raw ? (
                        line.name
                      ) : (
                        t(line.name)
                      )}
                    </td>
                    <td className={`${CELL} ${weight}`}>{format(line.first)}</td>
                    <td className={`${CELL} ${weight}`}>{format(line.second)}</td>
                    <DiffCell first={line.first} second={line.second} wide={!widths} />
                  </tr>
                )
              })}
              {total && (
                <tr>
                  <td className={`${CELL} font-semibold`}>{t("Итого")}</td>
                  <td className={`${CELL} font-semibold`}>{format(firstTotal)}</td>
                  <td className={`${CELL} font-semibold`}>{format(secondTotal)}</td>
                  <DiffCell first={firstTotal} second={secondTotal} wide={!widths} />
                </tr>
              )}
            </tbody>
          )}
        </table>
        {rows.length === 0 && <ReportEmpty text={t("Нет данных")} className="pb-[10px] pt-[20px]" />}
      </div>
    </div>
  )
}

const CARET = <path d="M7 10l5 5 5-5z" />

/** Date range of the reference filter: label, value and a small calendar icon; the value opens the range picker. */
function RangeField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[52px] cursor-pointer border-b border-[#e0e0e0]" onClick={() => !open && setOpen(true)}>
      <span className="absolute left-0 top-[7px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[242px] top-[7px] h-[15px] w-[15px] fill-[#ccc]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      <span className="absolute inset-x-0 top-[29px] text-[13px] leading-[18px] text-black">
        {formatShortReportDate(begin)} - {formatShortReportDate(end)}
      </span>
      {open && (
        <DateRangePicker
          begin={begin}
          end={end}
          positionClassName="left-0 top-[calc(100%+13px)]"
          onClose={() => setOpen(false)}
          onApply={(from, to) => {
            onChange(from, to)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Searchable multi-select of the reference filter: chips for the picked values, a list that narrows while typing. */
function SelectField({ label, values, options, loading, onChange }: { label: string; values: string[]; options: string[]; loading: boolean; onChange: (values: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const rest = options.filter((option) => !values.includes(option) && option.toLowerCase().includes(query.trim().toLowerCase()))
  const floating = open || values.length > 0
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <div className="relative h-[52px] cursor-text border-b border-[#e0e0e0]" onClick={() => setOpen(true)}>
      {floating ? (
        <span className="absolute left-0 top-[7px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
      ) : (
        <span className="absolute inset-x-0 top-[28px] text-[13px] font-semibold leading-[18px] text-black">{t(label)}</span>
      )}
      <div className={`absolute left-0 right-[44px] top-[23px] flex items-center gap-[5px] overflow-hidden text-[13px] leading-5 ${floating ? "" : "invisible"}`}>
        {values.map((value) => (
          <span key={value} className="flex h-5 shrink-0 items-stretch overflow-hidden font-semibold text-white">
            <button
              type="button"
              aria-label="remove"
              onClick={(event) => {
                event.stopPropagation()
                onChange(values.filter((item) => item !== value))
              }}
              className="border-r border-white/30 bg-[#5c6df3] px-[5px] text-[12px]"
            >
              ×
            </button>
            <span className="bg-[#5c6df3] px-[5px]">{value}</span>
          </span>
        ))}
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          className="h-5 min-w-[20px] flex-1 bg-transparent text-[13px] text-black outline-none"
          aria-label={t(label)}
        />
      </div>
      {values.length > 0 && (
        <button
          type="button"
          aria-label="clear"
          onClick={(event) => {
            event.stopPropagation()
            onChange([])
          }}
          className="absolute bottom-[8px] right-[22px] z-10 text-[18px] leading-none text-[#999]"
        >
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[6px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
        {open ? <path d="M7 14l5-5 5 5z" /> : CARET}
      </svg>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={(event) => { event.stopPropagation(); close() }} />
          <div className="absolute inset-x-0 top-full z-40 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {rest.length === 0 ? (
              <div className="h-8 px-[10px] text-[13px] font-semibold leading-8 text-[#999]">{loading ? t("Загрузка...") : t("Не найдено")}</div>
            ) : (
              rest.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange([...values, option])
                    close()
                  }}
                  className="block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold leading-9 text-[#333] hover:bg-[#f2f5f8]"
                >
                  {option}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

type Filters = { branches: string[]; zones: string[]; supervisors: string[]; agents: string[]; productTypes: string[]; products: string[] }
const noFilters: Filters = { branches: [], zones: [], supervisors: [], agents: [], productTypes: [], products: [] }

export function PnLView() {
  const { t } = useLanguage()
  const periods = useMemo(() => defaultPeriods(), [])
  const [draft, setDraft] = useState(periods)
  const [draftFilters, setDraftFilters] = useState<Filters>(noFilters)
  const [applied, setApplied] = useState({ periods, filters: noFilters })
  const [metric, setMetric] = useState(0)
  const [mode, setMode] = useState<SortMode>("ВСЕ")
  const [stats, setStats] = useState<PnlStats | null>(null)
  const [options, setOptions] = useState<PnlOptions | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/pnl-stats?options=1")
      .then((response) => (response.ok ? (response.json() as Promise<PnlOptions>) : null))
      .then((data) => {
        if (!cancelled && data) setOptions(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const { periods: range, filters } = applied
    const params = new URLSearchParams({ first_begin: range.firstBegin, first_end: range.firstEnd, second_begin: range.secondBegin, second_end: range.secondEnd })
    for (const key of ["branches", "zones", "agents", "productTypes", "products"] as const) {
      if (filters[key].length > 0) params.set(key, filters[key].join("|"))
    }
    fetch(`/api/pnl-stats?${params}`)
      .then((response) => (response.ok ? (response.json() as Promise<PnlStats>) : null))
      .then((data) => {
        if (!cancelled && data) setStats(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [applied])

  const keep = (first: number, second: number) => {
    const diff = Math.round(second - first)
    return mode === "ВСЕ" || (mode === "УБЫВАЮЩИЕ" ? diff < 0 : diff > 0)
  }
  const pick = metricTabs[metric].pick
  const groupLines = (rows: PnlRow[] | undefined, link = false): Line[] =>
    (rows ?? [])
      .map((row) => ({ key: row.name, name: row.name, first: pick(row.first), second: pick(row.second), raw: true, link }))
      .filter((line) => keep(line.first, line.second))

  const summary = stats?.summary
  const pair = (value: { first: number; second: number } | undefined, key: string, name: string, bold = false): Line => ({
    key,
    name,
    first: value?.first ?? 0,
    second: value?.second ?? 0,
    bold,
  })
  const topLines: Line[] = [
    pair(summary?.sales, "sales", "Реализовано"),
    pair(summary?.salesNetCost, "cost", "Себестоимость реализованной продукции"),
    pair(summary?.returns, "returns", "Возвраты"),
    pair(summary?.returnsNetCost, "returnsCost", "Себестоимость возвратов"),
    pair(summary?.salesProfit, "profit", "Валовая прибыль"),
    pair(summary?.salesProfitRentability, "rentability", "Рентабельность ВП"),
  ].filter((line) => keep(line.first, line.second))
  const expenseLines = (rows: PnlExpense[]): Line[] =>
    rows.flatMap((row) => [
      { key: `e${row.id}`, name: row.name, first: row.first, second: row.second, raw: true, indent: 10 },
      ...row.children.map((child) => ({ key: `e${row.id}-${child.id}`, name: child.name, first: child.first, second: child.second, raw: true, indent: 25 })),
    ])
  const leftLines: Line[] = [
    ...topLines,
    pair(summary?.otherIncome, "other", "Прочие приходы"),
    { ...pair(summary?.indirectExpenses, "indirect", "Косвенние расходы периода", true), toggle: { open: expanded, onToggle: () => setExpanded((current) => !current) } },
    ...(expanded ? expenseLines(stats?.indirectExpenses ?? []) : []),
    pair(summary?.salary, "salary", "Зарплата сотрудников"),
    pair(summary?.writeoffs, "writeoffs", "Списанные товары"),
    pair(summary?.inventoryPrice, "inventory", "Инвентаризация"),
    pair(summary?.netProfit, "net", "Чистая прибыль"),
    pair(summary?.netProfitRentability, "netRentability", "Рентабельность чистой прибыли в %"),
  ]

  const tabButton = "h-7 rounded-[5px] px-4 text-[13px] font-normal uppercase"
  const on = "text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
  const off = "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"

  return (
    <ReportPage>
      <WidgetHeader active="P&L" />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ periods: draft, filters: draftFilters })
        }}
        className="mx-[30px] bg-white px-[20px] pb-[10px] pt-[10px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
      >
        <h2 className="text-[15px] font-normal leading-[18.8px] text-[#5d6474]">{t("Фильтр")}</h2>
        <div className="mt-[7px] grid grid-cols-4 gap-x-[10.67px] gap-y-[15px]">
          <RangeField label="Первый период" begin={draft.firstBegin} end={draft.firstEnd} onChange={(from, to) => setDraft((current) => ({ ...current, firstBegin: from, firstEnd: to }))} />
          <RangeField label="Второй период" begin={draft.secondBegin} end={draft.secondEnd} onChange={(from, to) => setDraft((current) => ({ ...current, secondBegin: from, secondEnd: to }))} />
          <SelectField label="Филиалы" values={draftFilters.branches} options={options?.branches ?? []} loading={!options} onChange={(branches) => setDraftFilters((current) => ({ ...current, branches }))} />
          <SelectField label="Зона" values={draftFilters.zones} options={options?.zones ?? []} loading={!options} onChange={(zones) => setDraftFilters((current) => ({ ...current, zones }))} />
          <SelectField label="Супервайзер" values={draftFilters.supervisors} options={[]} loading={false} onChange={(supervisors) => setDraftFilters((current) => ({ ...current, supervisors }))} />
          <SelectField label="Агент" values={draftFilters.agents} options={options?.agents ?? []} loading={!options} onChange={(agents) => setDraftFilters((current) => ({ ...current, agents }))} />
          <SelectField label="Тип товара" values={draftFilters.productTypes} options={options?.productTypes ?? []} loading={!options} onChange={(productTypes) => setDraftFilters((current) => ({ ...current, productTypes }))} />
          <SelectField label="Товар" values={draftFilters.products} options={options?.products ?? []} loading={!options} onChange={(products) => setDraftFilters((current) => ({ ...current, products }))} />
        </div>
        <button type="submit" className="mt-[23px] block h-9 w-[113px] rounded-[3px] bg-[#5d6474] text-[13px] font-normal uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110">
          {t("Применить")}
        </button>
      </form>

      <section className="mx-[30px] mt-[22px] flex items-center">
        <div className="flex">
          {metricTabs.map((tab, index) => (
            <button key={tab.label} type="button" onClick={() => setMetric(index)} className={`${tabButton} ${metric === index ? `bg-[#4f71dc] ${on}` : off}`}>
              {t(tab.label)}
            </button>
          ))}
        </div>
        <div className="ml-auto mr-[7.1px] flex">
          {sortModes.map((item) => (
            <button key={item} type="button" onClick={() => setMode(item)} className={`${tabButton} ${item === "ВСЕ" ? "ml-[7.1px]" : ""} ${mode === item ? `bg-[#2bcd53] ${on}` : off}`}>
              {t(item)}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-[30px] mt-[22px] grid grid-cols-2 items-start gap-x-[16px] pb-8">
        <div className="space-y-[30px]">
          <CompareTable title="Филиал" lines={groupLines(stats?.branches)} sortable total />
          <CompareTable title="Наименование" lines={leftLines} widths={["33.3%", "19.56%", "18.96%", "28.18%"]} />
        </div>
        <div className="space-y-[30px]">
          <CompareTable title="Агент" lines={groupLines(stats?.agents)} sortable />
          <CompareTable title="Тип продукта" lines={groupLines(stats?.productTypes)} sortable />
          <CompareTable title="Бренд" lines={groupLines(stats?.brands)} sortable />
          <CompareTable title="Зона" lines={groupLines(stats?.zones, true)} sortable />
        </div>
      </section>
    </ReportPage>
  )
}
