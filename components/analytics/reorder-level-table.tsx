"use client"

import type { ReactNode } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

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
    <span className="flex h-full min-h-[40px] w-full items-center px-3 font-semibold text-white" style={{ background: color }}>
      {children}
    </span>
  )
}

export function ReorderLevelTable({ rows, ordering, onOrderingChange, loading }: { rows: RecommendedRow[]; ordering: string; onOrderingChange: (next: string) => void; loading: boolean }) {
  const { t } = useLanguage()
  const unitOf = (row: RecommendedRow) => (row.unit ? ` ${t(row.unit)}` : "")
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
  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
      <table className="w-full border-collapse text-[13px] text-[#333]">
        <thead className="sticky top-0 z-[1] bg-[#f5f7fa] text-[#333] shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
          <tr>
            {columns.map((column) => (
              <th key={column.id} className={`border border-[#e4e8ed] px-3 py-2 text-center font-semibold ${column.id === "name" ? "sticky left-0 z-[2] min-w-[260px] bg-[#f5f7fa]" : ""}`}>
                {column.sortKey ? (
                  <button
                    type="button"
                    onClick={() => onOrderingChange(nextOrdering([ordering], column.sortKey!, "desc-first")[0] ?? "")}
                    className="inline-flex items-center gap-1 text-left"
                  >
                    {t(column.label)}
                    {ordering === column.sortKey ? <ArrowUp className="h-3.5 w-3.5 shrink-0" /> : ordering === `-${column.sortKey}` ? <ArrowDown className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                ) : (
                  t(column.label)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const background = index % 2 ? "#ffffff" : "#F4F8FB"
            return (
              <tr key={row.key} style={{ background }}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`h-[40px] border-b border-[#e8ecf0] ${pill.has(column.id) ? "p-0" : "px-3 py-0"} ${column.id === "name" ? "sticky left-0" : "whitespace-nowrap"}`}
                    style={column.id === "name" ? { background } : undefined}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
