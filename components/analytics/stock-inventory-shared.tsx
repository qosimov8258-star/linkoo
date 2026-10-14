"use client"

import { formatCashDate } from "@/components/analytics/cash-management-shared"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import {
  STOCK_INVENTORY_STATUS_COLORS,
  STOCK_INVENTORY_STATUS_LABELS,
  type StockInventoryDetail,
  type StockInventoryRow,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared bits of the "Инвентаризация" page: number / date formatting as the
// demo prints them ("160 587 шт", "+3 шт"), the status dot and the Excel sheets.

type Translate = (text: string) => string
type Cell = string | number

/** "1 234,5 шт" (up to 3 decimals, ru grouping) — quantities. */
export function formatQty(value: number, unit = ""): string {
  return `${formatMoney(value, 3)}${unit ? ` ${unit}` : ""}`
}

/** "+3 шт" / "-2 шт" / "0 шт" — differences. */
export function formatDiff(value: number, unit = ""): string {
  return `${value > 0 ? "+" : ""}${formatQty(value, unit)}`
}

/** "1 234,56" (+ currency) — sums. */
export function formatSum(value: number, currency = ""): string {
  return `${formatMoney(value, 2)}${currency ? ` ${currencyLabel(currency)}` : ""}`
}

export function diffColor(value: number): string | undefined {
  if (value > 0) return "#3aa76d"
  if (value < 0) return "#e5484d"
  return undefined
}

/** Demo "Дата создания": date + time for "По факту проведения", the chosen day otherwise. */
export function inventoryDateText(row: Pick<StockInventoryRow, "type" | "createdDate" | "invDate">, language: string): string {
  if (row.type === "custom_date") return formatCashDate(row.invDate, language, false)
  return row.createdDate ? formatCashDate(row.createdDate, language, row.createdDate.length > 10) : ""
}

export function StatusLabel({ status }: { status: StockInventoryStatus }) {
  const { t } = useLanguage()
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full" style={{ background: STOCK_INVENTORY_STATUS_COLORS[status] }} />
      {t(STOCK_INVENTORY_STATUS_LABELS[status])}
    </span>
  )
}

/** List sheet (demo excelData "Инвентаризация"). */
export function inventoryListSheet(rows: StockInventoryRow[], t: Translate, language: string): Cell[][] {
  return [
    ["№", t("Склад"), t("Создал"), t("Дата создания"), t("Комментарий"), t("Статус"), t("Сумма")],
    ...rows.map((row) => [
      row.id,
      row.warehouse,
      row.createdBy,
      inventoryDateText(row, language),
      row.comment || t("Комментариев нет"),
      t(STOCK_INVENTORY_STATUS_LABELS[row.status]),
      Math.round(row.totalPrice * 100) / 100,
    ]),
  ]
}

/** One inventory's lines (demo detail excelTitles) + "Итого". */
export function inventoryItemsSheet(detail: StockInventoryDetail, t: Translate): Cell[][] {
  return [
    [t("Наименование"), t("Артикул"), t("Серия"), t("Баланс (до)"), t("Баланс (после)"), t("Разница"), t("Ед. изм."), `${t("Сумма")} ${currencyLabel(detail.currency)}`.trim()],
    ...detail.items.map((item) => [item.name, item.article, item.series || "-", item.balanceAmount, item.amount, item.diff, item.unit, Math.round(item.totalPrice * 100) / 100]),
    [t("Итого"), "", "", "", "", "", "", Math.round(detail.totalPrice * 100) / 100],
  ]
}
