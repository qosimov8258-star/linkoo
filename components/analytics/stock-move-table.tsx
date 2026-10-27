"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Columns3 } from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { MOVE_GROUP_TITLES, shownMoveValue, type MoveColumn, type MoveField, type MoveGroupBy } from "@/lib/stock-movement-columns"
import type { MoveRow } from "@/lib/stock-movement-report"

// Table of "Остаток на определенную дату" (demo m3876): a sticky first column
// (Товар + артикул, or the warehouse / branch / brand / type), then one column
// group per movement with a "Кол-во" sub-column (+ "Стоимость" in cost / price
// mode). Outflows are shown positive. Sub-headers sort (ordering = field or
// field.value, asc → desc → none). Cells open the item detail filtered by kind.

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return null
}

const formatQty = (value: number) => (value ? formatMoney(value, 3) : "0")
const formatValue = (value: number) => (value ? formatMoney(value, 2) : "0")

export function StockMoveTable({
  rows,
  columns,
  groupBy,
  withValue,
  ordering,
  onOrderingChange,
  onRowClick,
  onCellClick,
  loading,
}: {
  rows: MoveRow[]
  columns: MoveColumn[]
  groupBy: MoveGroupBy
  withValue: boolean
  ordering: string
  onOrderingChange: (next: string) => void
  onRowClick: (row: MoveRow) => void
  onCellClick: (row: MoveRow, field: MoveField) => void
  loading: boolean
}) {
  const { t } = useLanguage()
  const sub = withValue ? 2 : 1
  const sort = (key: string) => onOrderingChange(nextOrdering(ordering ? [ordering] : [], key, "asc-first")[0] ?? "")
  const sortHeader = (key: string, label: string) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 whitespace-nowrap">
      {label}
      <SortIcon ordering={ordering} sortKey={key} />
    </button>
  )
  const clickableCells = groupBy === "product"
  // The reference grid: a 260px name column, 122px groups (the "order" group is 200px) in the quantity mode,
  // 200px groups in the price mode (two 100px columns); 29px header rows, rows of at least 31px.
  const colTemplate = columns.map((column) => (sub === 2 ? "minmax(200px,1fr)" : `minmax(100px,${column.field === "order" ? 200 : 122.3}fr)`)).join(" ")
  const template = { gridTemplateColumns: `260px ${colTemplate}` }
  const subTemplate = { gridTemplateColumns: `repeat(${sub}, minmax(0, 1fr))` }
  const head = "min-w-0 border-b border-r border-[#efefef] bg-[#f0f4f9] text-center text-[13px] font-semibold text-[#374557]"
  const cell = "min-w-0 border-b border-r border-[#efefef] px-[5px] py-[7px] leading-[16.3px]"
  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
      <div className="min-w-[1000px] border border-black/10 text-[13px] text-[#333]">
        <div style={template} className="grid">
          <div className={`${head} h-[30px]`} />
          {columns.map((column) => (
            <div key={column.field} className={`${head} h-[30px] truncate px-[5px] leading-[29px]`} title={t(column.label)}>
              {t(column.label)}
            </div>
          ))}
        </div>
        <div style={template} className="relative z-10 grid [box-shadow:0_4px_14px_rgba(0,0,0,0.15)]">
          <div className={`${head} flex h-[29px] items-center justify-center`}>
            {sortHeader("name", t(MOVE_GROUP_TITLES[groupBy]))}
          </div>
          {columns.map((column) => (
            <div key={column.field} style={subTemplate} className="grid">
              <ColumnSubHeaders field={column.field} withValue={withValue} sortHeader={sortHeader} headClass={head} />
            </div>
          ))}
        </div>
        <div>
          {rows.map((row, index) => {
            const background = index % 2 ? "bg-[#f4f8fb]" : "bg-white"
            return (
              <div key={row.key || "—"} style={template} className={`grid ${background}`}>
                <div className={`${cell} flex items-center`}>
                  <button type="button" onClick={() => onRowClick(row)} className="flex min-w-0 flex-col items-start text-left hover:text-[#4f71dc]">
                    <span className="break-words">{row.name || t("Не указано")}</span>
                    {groupBy === "product" && row.article && <span className="font-semibold text-[#71ce87]">{row.article}</span>}
                  </button>
                </div>
                {columns.map((column) => {
                  const qty = shownMoveValue(column, row.qty[column.field])
                  const value = shownMoveValue(column, row.value?.[column.field] ?? 0)
                  const linkable = clickableCells && !column.valueOnly && column.field !== "begin" && column.field !== "end"
                  return (
                    <div key={column.field} style={subTemplate} className="grid">
                      <div className={`${cell} whitespace-nowrap ${background}`}>
                        {column.valueOnly ? (
                          ""
                        ) : linkable ? (
                          <button type="button" onClick={() => onCellClick(row, column.field)} className="text-[#129fdd] hover:underline">
                            {formatQty(qty)}
                          </button>
                        ) : (
                          formatQty(qty)
                        )}
                      </div>
                      {withValue && <div className={`${cell} whitespace-nowrap`}>{formatValue(value)}</div>}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {!rows.length && <div className="px-4 py-16 text-center text-[#9aa3b6]">{loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}</div>}
        </div>
      </div>
    </div>
  )
}

function ColumnSubHeaders({ field, withValue, sortHeader, headClass }: { field: MoveField; withValue: boolean; sortHeader: (key: string, label: string) => ReactNode; headClass: string }) {
  const { t } = useLanguage()
  return (
    <>
      <div className={`${headClass} flex h-[29px] items-center justify-center`}>{sortHeader(field, t("Кол-во"))}</div>
      {withValue && <div className={`${headClass} flex h-[29px] items-center justify-center`}>{sortHeader(`${field}.value`, t("Стоимость"))}</div>}
    </>
  )
}

/** "Показать": which column groups are visible (stored per browser). */
export function StockMoveColumnPicker({ columns, hidden, onChange }: { columns: MoveColumn[]; hidden: MoveField[]; onChange: (next: MoveField[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-9 items-center gap-2 rounded-md border border-[#dbe0e8] px-3 text-[#586174] hover:border-[#4f70e7] hover:text-[#4f70e7]">
        <Columns3 className="h-4 w-4" /> {t("Показать")} <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-[95] mt-1 w-72 rounded-md border border-[#e1e5eb] bg-white py-2 shadow-lg">
          {columns.map((column) => (
            <label key={column.field} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[#17233b] hover:bg-[#f2f5f8]">
              <input
                type="checkbox"
                checked={!hidden.includes(column.field)}
                onChange={() => onChange(hidden.includes(column.field) ? hidden.filter((field) => field !== column.field) : [...hidden, column.field])}
                className="h-4 w-4 accent-[#4f70e7]"
              />
              {t(column.label)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
