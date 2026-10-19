"use client"

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
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
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
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
  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
      <table className="w-full border-collapse text-[14px]">
        <thead className="sticky top-0 z-[1] bg-[#4f71dc] text-white">
          <tr>
            <th rowSpan={2} className="sticky left-0 z-[2] min-w-[260px] border border-[#6d8ae3] bg-[#4f71dc] px-4 py-2 text-left font-semibold">
              {sortHeader("name", t(MOVE_GROUP_TITLES[groupBy]))}
            </th>
            {columns.map((column) => (
              <th key={column.field} colSpan={sub} className="border border-[#6d8ae3] px-3 py-2 text-center font-semibold">
                {t(column.label)}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((column) => (
              <ColumnSubHeaders key={column.field} field={column.field} withValue={withValue} sortHeader={sortHeader} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const background = index % 2 ? "#F4F8FB" : "#ffffff"
            return (
              <tr key={row.key || "—"} style={{ background }}>
                <td className="sticky left-0 border-b border-r border-[#efefef] px-4 py-2" style={{ background }}>
                  <button type="button" onClick={() => onRowClick(row)} className="flex flex-col items-start text-left hover:font-semibold hover:text-[#4f71dc]">
                    <span>{row.name || t("Не указано")}</span>
                    {groupBy === "product" && (row.article || row.unit) && (
                      <span className="text-[12px] font-semibold text-[#71ce87]">
                        {row.article}
                        {row.article && row.unit ? " · " : ""}
                        {row.unit ? t(row.unit) : ""}
                      </span>
                    )}
                  </button>
                </td>
                {columns.map((column) => {
                  const qty = shownMoveValue(column, row.qty[column.field])
                  const value = shownMoveValue(column, row.value?.[column.field] ?? 0)
                  const linkable = clickableCells && column.field !== "begin" && column.field !== "end" && qty !== 0
                  return (
                    <Fragment key={column.field}>
                      <td className="whitespace-nowrap border-b border-r border-[#efefef] px-3 py-2">
                        {linkable ? (
                          <button type="button" onClick={() => onCellClick(row, column.field)} className="text-[#4f71dc] hover:underline">
                            {formatQty(qty)}
                          </button>
                        ) : (
                          formatQty(qty)
                        )}
                      </td>
                      {withValue && <td className="whitespace-nowrap border-b border-r border-[#efefef] px-3 py-2">{formatValue(value)}</td>}
                    </Fragment>
                  )
                })}
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={1 + columns.length * sub} className="px-4 py-16 text-center text-[#9aa3b6]">
                {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ColumnSubHeaders({ field, withValue, sortHeader }: { field: MoveField; withValue: boolean; sortHeader: (key: string, label: string) => ReactNode }) {
  const { t } = useLanguage()
  return (
    <>
      <th className="border border-[#6d8ae3] px-3 py-1.5 text-left text-[13px] font-medium">{sortHeader(field, t("Кол-во"))}</th>
      {withValue && <th className="border border-[#6d8ae3] px-3 py-1.5 text-left text-[13px] font-medium">{sortHeader(`${field}.value`, t("Стоимость"))}</th>}
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
