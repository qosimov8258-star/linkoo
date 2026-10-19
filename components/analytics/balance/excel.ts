// Builders of the 2-D arrays handed to downloadExcelTable (lib/excel-export.ts)
// for the balance pages. `t` is useLanguage().t so headers follow the UI language.

import { currencyLabel, roundMoney } from "@/lib/finance/currency"
import type { BalanceRow, CurrencyBalance } from "@/lib/finance/types"

type Cell = string | number | null

export type ExcelColumn<R> = { label: string; value: (row: R) => Cell }

/** Header "<group> <CUR>" per group × currency, one line per row, optional totals line. */
export function balanceListExcelRows<R extends BalanceRow>({
  rows,
  groups,
  currencies,
  leading,
  trailing = [],
  totals,
  t,
}: {
  rows: R[]
  groups: Array<{ field: string; label: string }>
  /** Currency codes (sub-columns). */
  currencies: string[]
  /** Columns before the money groups (e.g. name, INN). */
  leading: ExcelColumn<R>[]
  trailing?: ExcelColumn<R>[]
  /** Adds an "Итого" line. */
  totals?: Record<string, CurrencyBalance>
  t: (text: string) => string
}): Cell[][] {
  const header: Cell[] = [
    ...leading.map((column) => t(column.label)),
    ...groups.flatMap((group) => currencies.map((code) => `${t(group.label)} ${currencyLabel(code)}`)),
    ...trailing.map((column) => t(column.label)),
  ]
  const body = rows.map((row) => [
    ...leading.map((column) => column.value(row)),
    ...groups.flatMap((group) => currencies.map((code) => roundMoney(row.currencies[code]?.[group.field] ?? 0))),
    ...trailing.map((column) => column.value(row)),
  ])
  if (totals) {
    body.push([
      ...leading.map((_, index) => (index === 0 ? t("Итого") : "")),
      ...groups.flatMap((group) => currencies.map((code) => roundMoney(totals[code]?.[group.field] ?? 0))),
      ...trailing.map(() => ""),
    ])
  }
  return [header, ...body]
}
