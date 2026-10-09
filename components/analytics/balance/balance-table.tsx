"use client"

import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
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

function SortIcon({ ordering, sortKey }: { ordering: string[]; sortKey: string }) {
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
  footer,
}: BalanceTableProps<R>) {
  const { t } = useLanguage()
  const split = !cellCurrency
  const subColumns = split ? currencies : [""]
  const pageKeys = rows.map((row) => row.key)
  const allSelected = Boolean(selection) && pageKeys.length > 0 && pageKeys.every((key) => selection!.selected.has(key))
  const headClass = headerTone === "blue" ? "bg-[#4f71dc] text-white" : "bg-[#edf2f7] text-[#253653]"
  const subHeadClass = headerTone === "blue" ? "bg-[#4f71dc] text-white" : "bg-white text-[#17233b]"
  const columnCount = (selection ? 1 : 0) + 1 + groups.length * Math.max(1, subColumns.length) + trailing.length

  const sortHeader = (sortKey: string, label: ReactNode) =>
    onOrderingChange ? (
      <button type="button" onClick={() => onOrderingChange(nextOrdering(ordering, sortKey, sortCycle, multiSort))} className="inline-flex items-center gap-1">
        {label}
        <SortIcon ordering={ordering} sortKey={sortKey} />
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

  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
      <table className="w-full border-collapse text-[14px]">
        <thead className="sticky top-0 z-[1]">
          <tr className={headClass}>
            {selection && (
              <th rowSpan={split ? 2 : 1} className="sticky left-0 z-[2] w-10 border border-[#e1e5eb] px-2 py-2" style={{ background: "inherit" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[#4f70e7]" aria-label={t("Выбрать все")} />
              </th>
            )}
            <th
              rowSpan={split ? 2 : 1}
              className="sticky z-[2] border border-[#e1e5eb] px-4 py-2 text-left font-semibold"
              style={{ left: selection ? 40 : 0, minWidth: first.width ?? 220, background: "inherit" }}
            >
              {first.sortKey ? sortHeader(first.sortKey, t(first.label)) : t(first.label)}
            </th>
            {groups.map((group) => (
              <th key={group.field} colSpan={subColumns.length} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">
                {split ? t(group.label) : sortHeader(group.field, t(group.label))}
              </th>
            ))}
            {trailing.map((column) => (
              <th key={column.label} rowSpan={split ? 2 : 1} className="border border-[#e1e5eb] px-4 py-2 text-left font-medium">
                {t(column.label)}
              </th>
            ))}
          </tr>
          {split && (
            <tr className={subHeadClass}>
              {groups.map((group) =>
                currencies.map((code) => (
                  <th key={`${group.field}.${code}`} className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold whitespace-nowrap">
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
                {selection && (
                  <td className="sticky left-0 border-b border-[#e1e5eb] px-2 py-3 text-center" style={{ background }}>
                    <input type="checkbox" checked={selection.selected.has(row.key)} onChange={() => toggleOne(row.key)} className="h-4 w-4 accent-[#4f70e7]" />
                  </td>
                )}
                <td
                  className={`sticky border-b border-[#e1e5eb] px-4 py-3 ${clickable}`}
                  style={{ left: selection ? 40 : 0, background }}
                  onClick={onCellClick ? () => onCellClick(row, null) : undefined}
                >
                  {first.render(row)}
                </td>
                {groups.map((group) =>
                  subColumns.map((code) => {
                    const currency = code || cellCurrency!(row)
                    const value = row.currencies[currency]?.[group.field] ?? 0
                    return (
                      <td
                        key={`${group.field}.${code}`}
                        className={`border-b border-[#e1e5eb] px-4 py-3 whitespace-nowrap ${clickable}`}
                        onClick={onCellClick ? () => onCellClick(row, group.field) : undefined}
                      >
                        <BalanceAmount value={value} digits={digits} currency={code ? undefined : currencyLabel(currency)} />
                      </td>
                    )
                  }),
                )}
                {trailing.map((column) => (
                  <td key={column.label} className={`border-b border-[#e1e5eb] px-4 py-3 ${clickable}`} onClick={onCellClick ? () => onCellClick(row, null) : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={columnCount} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">
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
