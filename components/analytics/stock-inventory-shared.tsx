"use client"

import { formatCashDate } from "@/components/analytics/cash-management-shared"
import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import {
  STOCK_INVENTORY_STATUS_COLORS,
  STOCK_INVENTORY_STATUS_LABELS,
  type StockInventoryDetail,
  type StockInventoryRow,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared bits of the "Инвентаризация" page: number / date formatting as the
// demo prints them ("160 587 шт", "205,2": the decimals of Настройки → Округление сумм,
// the reference's ROUND_AMOUNT_FOR_CURRENCY), the status dot and the Excel sheets.

type Translate = (text: string) => string
type Cell = string | number

/** "1 234,5 шт" (Linko's numberFormat: ru grouping, the setting's decimals) — quantities. */
export function formatQty(value: number, unit = ""): string {
  return `${formatMoney(value)}${unit ? ` ${unit}` : ""}`
}

/** "+3 шт" / "-2 шт" / "0 шт" — differences. */
export function formatDiff(value: number, unit = ""): string {
  return `${value > 0 ? "+" : ""}${formatQty(value, unit)}`
}

/** "80 140,37296" (+ currency) — sums. */
export function formatSum(value: number, currency = ""): string {
  return `${formatMoney(value)}${currency ? ` ${currencyLabel(currency)}` : ""}`
}

export function diffColor(value: number): string | undefined {
  if (value > 0) return "#3aa76d"
  if (value < 0) return "#e5484d"
  return undefined
}

/** Linko's "Дата создания" (list and card): the inventory day, date only ("14 мая 2026") — the chosen day of "На
 * определенную дату", the day it was made (or moved to in «Изменение») of "По факту проведения". */
export function inventoryDateText(row: Pick<StockInventoryRow, "invDate">, language: string): string {
  return row.invDate ? formatCashDate(row.invDate, language, false) : ""
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
      roundMoney(row.totalPrice),
    ]),
  ]
}

/** «Скачать Excel» of the card (Linko's excelTitles, file and sheet «Товары»): Наименование | Серия | Баланс (до) |
 * Баланс (после) | Разница (quantities with their unit, the difference without a plus) | Сумма; an empty cell reads
 * «Не указано»; no total row. */
export function inventoryItemsSheet(detail: StockInventoryDetail, t: Translate): Cell[][] {
  const empty = t("Не указано")
  const text = (value: string) => value.trim() || empty
  return [
    [t("Наименование"), t("Серия"), t("Баланс (до)"), t("Баланс (после)"), t("Разница"), t("Сумма")],
    ...detail.items.map((item) => [
      text(item.name),
      text(item.series),
      formatQty(item.balanceAmount, item.unit),
      formatQty(item.amount, item.unit),
      formatQty(item.diff, item.unit),
      roundMoney(item.totalPrice),
    ]),
  ]
}
