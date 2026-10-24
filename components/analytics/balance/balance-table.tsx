"use client"

import { useRef, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { ScrollButtons } from "@/components/ref/scroll-buttons"
import { currencyLabel } from "@/lib/finance/currency"
import type { BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// The demo's balance grid: a fixed first column (entity name), then one
// column group per movement field with a sub-column per visible currency.
// Cells are coloured by sign. Header clicks emit `ordering` keys in the
// format the /api/balances list accepts ("-end_balance.SUM", "name").

export type BalanceColumnGroup = { field: string; label: string }

export type SortCycle = "desc-first" | "asc-first"

/** Next ordering after clicking `key`: none → desc → asc → none ("desc-first",
 * cash balance) or none → asc → desc → none ("asc-first", server-sorted lists).
 * `multi` keeps the other keys (lodash orderBy style multi-sort). */
export function nextOrdering(ordering: string[], key: string, cycle: SortCycle = "asc-first", multi = false): string[] {
  const current = ordering.find((item) => item === key || item === `-${key}`)
  const rest = multi ? ordering.filter((item) => item !== current) : []
  const first = cycle === "desc-first" ? `-${key}` : key
  const second = cycle === "desc-first" ? key : `-${key}`
  if (!current) return [...rest, first]
  if (current === first) return multi ? ordering.map((item) => (item === current ? second : item)) : [second]
  return rest
}

function SortIcon({ ordering, sortKey, show = true }: { ordering: string[]; sortKey: string; show?: boolean }) {
  if (!show) return null
  if (ordering.includes(sortKey)) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering.includes(`-${sortKey}`)) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

export type BalanceTableProps<R extends BalanceRow> = {
  rows: R[]
  groups: BalanceColumnGroup[]
  /** Visible currency codes (sub-columns), e.g. BalanceListResult.visibleCurrencies. */
  currencies: string[]
  /** First (entity) column. */
  first: { label: string; render: (row: R) => ReactNode; width?: number; sortKey?: string }
  /** One column per group in the row's own currency (Баланс кассы): amounts get a currency suffix. */
  cellCurrency?: (row: R) => string
  /** Columns after the groups (e.g. Кассир, Тип). */
  trailing?: Array<{ label: string; render: (row: R) => ReactNode }>
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }
  ordering?: string[]
  onOrderingChange?: (next: string[]) => void
  sortCycle?: SortCycle
  multiSort?: boolean
  /** Cell click (field = null for the first/trailing columns). */
  onCellClick?: (row: R, field: string | null) => void
  digits?: number
  loading?: boolean
  emptyText?: string
  headerTone?: "light" | "blue"
  /** Reference page look: 30px side margins (the pages that sit directly on the grey page). */
  inset?: boolean
  /** Reference look of the client / van-sell balances: the select checkbox column follows the name column. */
  selectionAfterFirst?: boolean
  /** 31px rows of the reference debts tables. */
  compact?: boolean
  /** Reference look of the wide balance tables: fixed-width columns (px per currency column), horizontal scroll and the "»" buttons. */
  fixedWidth?: number
  footer?: ReactNode
}

export function BalanceTable<R extends BalanceRow>({
  rows,
  groups,
  currencies,
  first,
  cellCurrency,
  trailing = [],
  selection,
  ordering = [],
  onOrderingChange,
  sortCycle = "asc-first",
  multiSort = false,
  onCellClick,
  digits = 2,
  loading = false,
  emptyText = "По вашему запросу ничего не найдено",
  headerTone = "light",
  inset = false,
  selectionAfterFirst = false,
  compact = false,
  fixedWidth,
  footer,
}: BalanceTableProps<R>) {
  const { t } = useLanguage()
  const split = !cellCurrency
  const subColumns = split ? currencies : [""]
  const pageKeys = rows.map((row) => row.key)
  const allSelected = Boolean(selection) && pageKeys.length > 0 && pageKeys.every((key) => selection!.selected.has(key))
  const headClass = headerTone === "blue" ? "bg-[#4f71dc] text-white" : "bg-[#f0f4f9] text-[#374557]"
  const subHeadClass = headerTone === "blue" ? "bg-[#4f71dc] text-white" : "bg-[#f8fafc] text-[#374557]"
  const headCell = headerTone === "blue" ? "whitespace-nowrap px-[5px] py-[10px]" : "px-[5px] py-[5px]"
  const headWeight = headerTone === "blue" ? "font-bold" : "font-semibold"
  const bodyCell = headerTone === "blue" ? "border border-[#efefef] px-[5px] py-[10px] text-[#333]" : `border border-[#efefef] px-[5px] ${compact ? "py-[6px]" : "py-[8px]"}`
  const columnCount = (selection ? 1 : 0) + 1 + groups.length * Math.max(1, subColumns.length) + trailing.length

  const sortHeader = (sortKey: string, label: ReactNode) =>
    onOrderingChange ? (
      <button type="button" onClick={() => onOrderingChange(nextOrdering(ordering, sortKey, sortCycle, multiSort))} className="inline-flex items-center gap-1">
        {label}
        <SortIcon ordering={ordering} sortKey={sortKey} show={headerTone === "blue"} />
      </button>
    ) : (
      label
    )

  const toggleAll = () => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (allSelected) pageKeys.forEach((key) => next.delete(key))
    else pageKeys.forEach((key) => next.add(key))
    selection.onChange(next)
  }
  const toggleOne = (key: string) => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selection.onChange(next)
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const firstWidth = first.width ?? 220
  const selectWidth = selection ? 30 : 0
  // The reference draws the first currency group at the full column width and every later group 10px narrower.
  const laterWidth = fixedWidth ? fixedWidth - 10 : 0
  const cols = Math.max(1, subColumns.length)
  const tableWidth = fixedWidth ? firstWidth + selectWidth + cols * fixedWidth + Math.max(0, groups.length - 1) * cols * laterWidth + trailing.length * fixedWidth : undefined

  const selectHead = (left: number) => (
    <th rowSpan={split ? 2 : 1} className="sticky z-[2] w-10 border border-[#efefef] px-2 py-2" style={{ left, background: "inherit" }}>
      <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[#4f70e7]" aria-label={t("Выбрать все")} />
    </th>
  )
  const selectCell = (row: R, background: string, left: number) => (
    <td className="sticky border border-[#efefef] px-2 py-2 text-center" style={{ left, background }}>
      <input type="checkbox" checked={selection!.selected.has(row.key)} onChange={() => toggleOne(row.key)} className="h-4 w-4 accent-[#4f70e7]" />
    </td>
  )

  return (
    <div ref={scrollRef} className={`overflow-x-auto ${inset ? "mx-[30px]" : ""} ${loading ? "opacity-60" : ""}`}>
      {fixedWidth && <ScrollButtons targetRef={scrollRef} watch={rows.length} />}
      <table className={`border-collapse text-[13px] leading-[18px] ${fixedWidth ? "table-fixed" : "w-full"}`} style={tableWidth ? { width: tableWidth } : undefined}>
        {fixedWidth && (
          <colgroup>
            {selection && !selectionAfterFirst && <col style={{ width: selectWidth }} />}
            <col style={{ width: firstWidth }} />
            {selection && selectionAfterFirst && <col style={{ width: selectWidth }} />}
            {groups.flatMap((group, groupIndex) => subColumns.map((code) => <col key={`${group.field}.${code}`} style={{ width: groupIndex === 0 ? fixedWidth : laterWidth }} />))}
            {trailing.map((column) => (
              <col key={column.label} style={{ width: fixedWidth }} />
            ))}
          </colgroup>
        )}
        <thead className="sticky top-0 z-[1]">
          <tr className={headClass}>
            {selection && !selectionAfterFirst && selectHead(0)}
            <th
              rowSpan={split ? 2 : 1}
              className={`sticky z-[2] border border-[#efefef] text-center ${headWeight} ${headCell}`}
              style={{ left: selection && !selectionAfterFirst ? 40 : 0, minWidth: first.width ?? 220, background: "inherit" }}
            >
              {first.sortKey ? sortHeader(first.sortKey, t(first.label)) : t(first.label)}
            </th>
            {selection && selectionAfterFirst && selectHead(first.width ?? 220)}
            {groups.map((group) => (
              <th key={group.field} colSpan={subColumns.length} className={`border border-[#efefef] text-center ${headWeight} ${headCell}`}>
                {split ? t(group.label) : sortHeader(group.field, t(group.label))}
              </th>
            ))}
            {trailing.map((column) => (
              <th key={column.label} rowSpan={split ? 2 : 1} className={`border border-[#efefef] text-left ${headWeight} ${headCell}`}>
                {t(column.label)}
              </th>
            ))}
          </tr>
          {split && (
            <tr className={subHeadClass}>
              {groups.map((group) =>
                currencies.map((code) => (
                  <th key={`${group.field}.${code}`} className="border border-[#efefef] px-[5px] py-[5px] text-center font-medium whitespace-nowrap">
                    {sortHeader(`${group.field}.${code}`, currencyLabel(code))}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const background = index % 2 ? "#F4F8FB" : "#ffffff"
            const clickable = onCellClick ? "cursor-pointer" : ""
            return (
              <tr key={row.key} style={{ background }}>
                {selection && !selectionAfterFirst && selectCell(row, background, 0)}
                <td
                  className={`sticky ${bodyCell} ${clickable}`}
                  style={{ left: selection && !selectionAfterFirst ? 40 : 0, background }}
                  onClick={onCellClick ? () => onCellClick(row, null) : undefined}
                >
                  {first.render(row)}
                </td>
                {selection && selectionAfterFirst && selectCell(row, background, first.width ?? 220)}
                {groups.map((group) =>
                  subColumns.map((code) => {
                    const currency = code || cellCurrency!(row)
                    const value = row.currencies[currency]?.[group.field] ?? 0
                    return (
                      <td
                        key={`${group.field}.${code}`}
                        className={`${bodyCell} whitespace-nowrap ${fixedWidth ? "overflow-hidden text-ellipsis" : ""} ${clickable}`}
                        onClick={onCellClick ? () => onCellClick(row, group.field) : undefined}
                      >
                        <BalanceAmount value={value} digits={digits} currency={code ? undefined : currencyLabel(currency)} />
                      </td>
                    )
                  }),
                )}
                {trailing.map((column) => (
                  <td key={column.label} className={`${bodyCell} ${clickable}`} onClick={onCellClick ? () => onCellClick(row, null) : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={columnCount} className="border border-[#efefef] px-4 py-16 text-center text-[#9aa3b6]">
                {loading ? t("Загрузка...") : t(emptyText)}
              </td>
            </tr>
          )}
          {footer}
        </tbody>
      </table>
    </div>
  )
}
