"use client"

import { useMemo, useState } from "react"

import { appCurrencyColumn, useAppCurrency } from "@/lib/app-currency-context"
import { useLanguage } from "@/lib/i18n/language-context"
import type { BuilderResult } from "@/lib/report-builder-repo"

/**
 * The generated table of the report builders as the reference prints it (its pandas report_html): brand-blue
 * header rows (the measures over the horizontal values, then the grouping names), striped rows, a bold "Итого"
 * row, numbers with space-grouped thousands and a decimal point. A header click sorts by that column (⇅:
 * ascending, descending, back to the report's order). `totalsRight` adds a column per measure over the
 * horizontal values; `merge` joins repeated grouping cells; `formatted` = false prints the bare numbers.
 */
export function BuilderTable({
  result,
  formatted = true,
  totalsRight = false,
  merge = false,
}: {
  result: BuilderResult
  formatted?: boolean
  totalsRight?: boolean
  merge?: boolean
}) {
  const { t } = useLanguage()
  const appCurrency = useAppCurrency()
  const vertical = useMemo(() => result.vertical ?? [], [result])
  const columns = useMemo(() => result.columns ?? [], [result])
  const keys = useMemo(() => (result.keys?.length ? result.keys : [""]), [result])
  const horizontal = keys.length > 1 || keys[0] !== ""
  const withRight = totalsRight && horizontal && !!result.rowTotals
  const groupCount = Math.max(vertical.length, 1)
  const [sort, setSort] = useState<{ index: number; dir: 1 | -1 } | null>(null)

  /** The value of `column` under horizontal `key` in a result row (rows are key-major, as the engine sends them). */
  const at = (row: (string | number)[], keyIndex: number, columnIndex: number) => row[vertical.length + keyIndex * columns.length + columnIndex]

  // Leaf columns in the reference's order: measure by measure, each over the horizontal values (+ its total).
  const leaves = useMemo(() => {
    const list: { column: number; key: number | "total" }[] = []
    columns.forEach((_, column) => {
      keys.forEach((__, key) => list.push({ column, key }))
      if (withRight) list.push({ column, key: "total" })
    })
    return list
  }, [columns, keys, withRight])

  const valueOf = (rowIndex: number, leaf: { column: number; key: number | "total" }) =>
    leaf.key === "total" ? result.rowTotals?.[rowIndex]?.[leaf.column] : at(result.rows[rowIndex], leaf.key, leaf.column)

  const order = useMemo(() => {
    const indexes = result.rows.map((_, index) => index)
    if (!sort) return indexes
    const pick = (rowIndex: number) =>
      sort.index < vertical.length ? result.rows[rowIndex][sort.index] : valueOf(rowIndex, leaves[sort.index - vertical.length])
    return indexes.sort((a, b) => {
      const x = pick(a)
      const y = pick(b)
      const diff = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "ru", { numeric: true })
      return diff * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, sort, leaves])

  const toggleSort = (index: number) =>
    setSort((current) => (current?.index !== index ? { index, dir: 1 } : current.dir === 1 ? { index, dir: -1 } : null))

  const number = (value: string | number | undefined) => (typeof value === "number" ? builderNumber(value, formatted) : (value ?? ""))
  const head = "h-[27px] border-r border-white/25 px-[5px] text-left text-[12px] font-bold text-white last:border-r-0"
  const cell = "h-[27px] border-r border-[#ececec] px-[5px] text-left last:border-r-0"

  const sortIcon = (index: number) => (
    <svg viewBox="0 0 10 14" aria-hidden className={`absolute right-[4px] top-1/2 h-[11px] w-[8px] -translate-y-1/2 fill-white ${sort?.index === index ? "" : "opacity-90"}`}>
      {(sort?.index !== index || sort.dir === -1) && <path d="M5 0l4 5H1z" />}
      {(sort?.index !== index || sort.dir === 1) && <path d="M5 14l4-5H1z" />}
    </svg>
  )

  // Repeated grouping values of the rows above (merged cells), per grouping column.
  const spans = useMemo(() => {
    if (!merge) return null
    const rows = order.map((index) => result.rows[index])
    return rows.map((row, i) =>
      vertical.map((_, c) => {
        const same = (j: number) => j > 0 && rows[j].slice(0, c + 1).join("\u0000") === rows[j - 1].slice(0, c + 1).join("\u0000")
        if (same(i)) return 0
        let n = 1
        while (i + n < rows.length && same(i + n)) n++
        return n
      }),
    )
  }, [merge, order, result.rows, vertical])

  const measureTitle = (column: string) => appCurrencyColumn(column, t, appCurrency)

  return (
    <table className="w-full border-collapse text-[13px] text-[#333]">
      <thead className="bg-[#1E4A9A]">
        <tr>
          <th colSpan={groupCount} className={head} />
          {columns.map((column, index) => (
            <th key={`${column}-${index}`} colSpan={keys.length + (withRight ? 1 : 0)} className={`${head} relative pr-[16px]`}>
              {measureTitle(column)}
              {!horizontal && (
                <button type="button" aria-label={`${t("Сортировка")} ${measureTitle(column)}`} onClick={() => toggleSort(vertical.length + index)} className="absolute inset-0">
                  {sortIcon(vertical.length + index)}
                </button>
              )}
            </th>
          ))}
        </tr>
        {horizontal && (
          <tr>
            <th colSpan={groupCount} className={head} />
            {leaves.map((leaf, index) => (
              <th key={index} className={`${head} relative border-t border-white/25 pr-[16px] font-semibold`}>
                {leaf.key === "total" ? t("Итого") : keys[leaf.key]}
                <button type="button" aria-label={t("Сортировка")} onClick={() => toggleSort(vertical.length + index)} className="absolute inset-0">
                  {sortIcon(vertical.length + index)}
                </button>
              </th>
            ))}
          </tr>
        )}
        <tr>
          {(vertical.length ? vertical : [""]).map((name, index) => (
            <th key={`${name}-${index}`} className={`${head} relative border-t border-white/25 pr-[16px]`}>
              {name ? t(name) : ""}
              {name && (
                <button type="button" aria-label={`${t("Сортировка")} ${t(name)}`} onClick={() => toggleSort(index)} className="absolute inset-0">
                  {sortIcon(index)}
                </button>
              )}
            </th>
          ))}
          {leaves.map((_, index) => <th key={index} className={`${head} border-t border-white/25`} />)}
        </tr>
      </thead>
      <tbody>
        {order.map((rowIndex, position) => {
          const row = result.rows[rowIndex]
          return (
            <tr key={rowIndex} className={`border-b border-[#ececec] ${position % 2 ? "bg-[#f9f9f9]" : "bg-white"}`}>
              {vertical.length === 0 && <td className={`${cell} font-semibold`} />}
              {vertical.map((_, c) => {
                const span = spans?.[position]?.[c]
                if (spans && !span) return null
                return (
                  <td key={c} rowSpan={spans ? span : undefined} className={`${cell} font-semibold ${spans ? "align-top" : ""}`}>
                    {String(row[c] ?? "")}
                  </td>
                )
              })}
              {leaves.map((leaf, index) => (
                <td key={index} className={`${cell} ${leaf.key === "total" ? "font-semibold" : ""}`}>
                  {number(valueOf(rowIndex, leaf))}
                </td>
              ))}
            </tr>
          )
        })}
        {result.totals && (
          <tr className="border-b border-[#ececec] bg-white text-[14px] font-bold">
            <td colSpan={groupCount} className={cell}>{t("Итого")}</td>
            {leaves.map((leaf, index) => (
              <td key={index} className={cell}>
                {number(leaf.key === "total" ? result.grandTotals?.[leaf.column] : at(result.totals as (string | number)[], leaf.key, leaf.column))}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** "162 270 518.01": the reference's numbers (space-grouped thousands, a decimal point, no trailing zeros). */
export function builderNumber(value: number, grouped = true): string {
  if (!Number.isFinite(value)) return ""
  const rounded = Math.round(value * 1000) / 1000
  const text = Math.abs(rounded) < 1e21 ? rounded.toFixed(3).replace(/\.?0+$/, "") : String(rounded)
  if (!grouped) return text
  const [integer, fraction] = text.split(".")
  const sign = integer.startsWith("-") ? "-" : ""
  const digits = sign ? integer.slice(1) : integer
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction ? `.${fraction}` : ""}`
}

/** The reference's empty result: "Нет данных за выбранный период" in a white strip. */
export function BuilderNoData({ className = "" }: { className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`rounded-[8px] bg-white ${className}`}>
      <p className="text-[20px] font-bold leading-[25px] text-[#333]">{t("Нет данных за выбранный период")}</p>
    </div>
  )
}
