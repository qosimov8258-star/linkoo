"use client"

import { useRef, useState, type ReactNode } from "react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { RecommendedRow } from "@/lib/stock-recommended"

// Table of "Рекомендованный запас" (demo c138 module 5165): Товар | Вес одной
// ед. | Тип | Бренд | Продано | Доля от продаж (%) | Доступно | Сред. дневные
// продажи | Запас дней | Рек. запас на 6 / 30 дней. "Доля" and "Запас дней"
// are coloured pills (demo thresholds). Numeric headers sort (desc → asc → none).

type Column = { id: string; label: string; sortKey?: string; render: (row: RecommendedRow) => ReactNode }

const number = (value: number, digits = 3) => (value ? formatMoney(value, digits) : "0")

/** Demo colours: share ≤ 2 % red, > 70 % green, else orange. */
function shareColor(value: number) {
  return value <= 2 ? "#e57373" : value > 70 ? "#81c784" : "#f0ad4e"
}

/** Demo colours: > 30 days green, > 14 orange, else red. */
function daysColor(value: number) {
  return value > 30 ? "#81c784" : value > 14 ? "#f0ad4e" : "#e57373"
}

function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="block h-[30.3px] w-full px-[5px] font-semibold leading-[30.3px] text-white" style={{ background: color }}>
      {children}
    </span>
  )
}

const MIN_ROWS = 3

export function ReorderLevelTable({
  rows,
  ordering,
  unit,
  onOrderingChange,
  loading,
}: {
  rows: RecommendedRow[]
  ordering: string
  unit: string
  onOrderingChange: (next: string) => void
  loading: boolean
}) {
  const { t } = useLanguage()
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(true)
  // The reference prints plain numbers in the default "Количество" mode; the unit follows only for weight / volume / blocks.
  const unitOf = (row: RecommendedRow) => (unit !== "measurement" && row.unit ? ` ${t(row.unit)}` : "")
  const columns: Column[] = [
    { id: "name", label: "Товар", render: (row) => row.name },
    { id: "weight", label: "Вес одной ед.", sortKey: "weight", render: (row) => (row.weight ? `${number(row.weight)} ${t("кг")}` : "0") },
    { id: "type", label: "Тип", render: (row) => row.type || t("Не указано") },
    { id: "brand", label: "Бренд", render: (row) => row.brand || t("Не указано") },
    { id: "sold", label: "Продано", sortKey: "sold", render: (row) => `${number(row.sold)}${unitOf(row)}` },
    { id: "salePart", label: "Доля от продаж (%)", sortKey: "salePart", render: (row) => <Pill color={shareColor(row.salePart)}>{number(row.salePart, 2)} %</Pill> },
    { id: "available", label: "Доступно", sortKey: "available", render: (row) => `${number(row.available)}${unitOf(row)}` },
    { id: "byDay", label: "Сред. дневные продажи", sortKey: "byDay", render: (row) => number(row.byDay, 2) },
    { id: "remainDays", label: "Запас дней", sortKey: "remainDays", render: (row) => <Pill color={daysColor(row.remainDays)}>{number(row.remainDays, 2)}</Pill> },
    { id: "week", label: "Рек. запас на 6 дней", sortKey: "week", render: (row) => `${number(row.week)}${unitOf(row)}` },
    { id: "month", label: "Рек. запас на 30 дней", sortKey: "month", render: (row) => `${number(row.month)}${unitOf(row)}` },
  ]
  const pill = new Set(["salePart", "remainDays"])
  // The reference grid: a 300px name column, 100px columns after it, a 65px header with a soft shadow, 31.3px rows.
  const template = { gridTemplateColumns: `300px repeat(${columns.length - 1}, minmax(100px, 1fr))`, minWidth: 300 + (columns.length - 1) * 100 }
  const cell = "min-w-0 border-b border-r border-[#efefef]"
  const filler = Math.max(0, MIN_ROWS - rows.length)
  return (
    <div className={`relative border border-black/10 text-[13px] text-[#333] ${loading ? "opacity-60" : ""}`}>
      <div
        ref={scroller}
        onScroll={(event) => setMore(event.currentTarget.scrollLeft + event.currentTarget.clientWidth < event.currentTarget.scrollWidth - 1)}
        className="overflow-x-auto"
      >
        <div style={template} className="grid h-[65px] [box-shadow:0_4px_14px_rgba(0,0,0,0.15)]">
          {columns.map((column) => {
            const sorted = column.sortKey && (ordering === column.sortKey || ordering === `-${column.sortKey}`)
            const label = column.id === "week" || column.id === "month" ? t("Рек. запас на {n} дней").replace("{n}", column.id === "week" ? "6" : "30") : t(column.label)
            return (
              <div key={column.id} className={`${cell} flex items-center justify-center bg-[#f0f4f9] px-[5px] text-center text-[13px] font-semibold leading-[18px] text-[#374557] ${sorted ? "[box-shadow:inset_0_-3px_0_rgba(0,0,0,0.6)]" : ""}`}>
                {column.sortKey ? (
                  <button type="button" onClick={() => onOrderingChange(nextOrdering([ordering], column.sortKey!, "desc-first")[0] ?? "")} className="block w-full text-center">
                    {label}
                  </button>
                ) : (
                  label
                )}
              </div>
            )
          })}
        </div>
        <div>
          {rows.map((row, index) => (
            <div key={row.key} style={template} className="grid">
              {columns.map((column) => (
                <div key={column.id} className={`${cell} ${index % 2 ? "bg-[#f4f8fb]" : "bg-white"} ${pill.has(column.id) ? "pr-px" : "px-[5px] py-[7px]"} ${column.id === "name" ? "break-words leading-[16.3px]" : "break-words leading-[16.3px]"}`}>
                  {column.render(row)}
                </div>
              ))}
            </div>
          ))}
          {Array.from({ length: filler }, (_, offset) => (
            <div key={`filler-${offset}`} style={template} className="grid">
              {columns.map((column) => (
                <div key={column.id} className={`${cell} h-[31.3px] ${(rows.length + offset) % 2 ? "bg-[#f4f8fb]" : "bg-white"}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {more && (
        <button
          type="button"
          aria-label={t("Вперед")}
          onClick={() => scroller.current?.scrollBy({ left: 400, behavior: "smooth" })}
          className="absolute right-0 top-[104px] flex h-[60px] w-[40px] items-center justify-center rounded-l-[30px] bg-black/[0.31] pl-[8px] text-white"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden><path d="M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM12.59 7.41L17.18 12l-4.59 4.59L18 18l6-6-6-6z" transform="translate(-3 0)" /></svg>
        </button>
      )}
    </div>
  )
}
