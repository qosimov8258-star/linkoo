"use client"

import type { ReactNode } from "react"

import { formatCashDate } from "@/components/analytics/cash-management-shared"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { TRANSFER_STATUS_COLORS, TRANSFER_STATUS_TITLES, type Transfer, type TransferStatus } from "@/lib/internal-transfers-types"

// Shared bits of "Передачи между складами" and "Списание": number / date
// formatting as the demo prints it ("1 200 000", "0 кг", "160 587 шт"), the
// status dot and the Excel sheets.

type Translate = (text: string) => string
type Cell = string | number

/** "1 234,5 шт" (up to 3 decimals, ru grouping). */
export function formatQty(value: number, unit = ""): string {
  return `${formatMoney(value, 3)}${unit ? ` ${unit}` : ""}`
}

/** "1 234,56" (+ currency). */
export function formatSum(value: number, currency = ""): string {
  return `${formatMoney(value, 2)}${currency ? ` ${currencyLabel(currency)}` : ""}`
}

/** "12 кг" (pass the translated unit). */
export function formatWeight(value: number, unit = "кг"): string {
  return `${formatMoney(value, 3)} ${unit}`
}

/** "16 янв. 2026" / with ", 11:53" — '' stays ''. */
export function docDate(value: string, language: string, withTime = false): string {
  if (!value) return ""
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/)
  // The reference prints dates with moment's ru short months ("06 февр. 2026", "24 июня 2026"), no "г.".
  if (language === "ru" && iso) {
    const label = `${iso[3]} ${RU_SHORT_MONTHS[Number(iso[2]) - 1]} ${iso[1]}`
    return withTime && value.length > 10 && iso[4] ? `${label}, ${iso[4]}` : label
  }
  return formatCashDate(value, language, withTime && value.length > 10)
}

const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** Status with the demo dot; `title` = the capitalised detail label. */
export function TransferStatusLabel({ status, title = false, wrap = false }: { status: TransferStatus; title?: boolean; wrap?: boolean }) {
  const { t } = useLanguage()
  // The list prints the dot inline so that a long status wraps under it, like the reference.
  if (wrap) {
    return (
      <span>
        <i className="mr-[6px] inline-block h-[7px] w-[7px] rounded-full" style={{ background: TRANSFER_STATUS_COLORS[status] }} /> {t(title ? TRANSFER_STATUS_TITLES[status] : status)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      <span className="mr-2 inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: TRANSFER_STATUS_COLORS[status] }} />
      {t(title ? TRANSFER_STATUS_TITLES[status] : status)}
    </span>
  )
}

/** One label / value row of a detail's left column. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-b border-dashed border-[#e1e5eb] py-1.5 leading-[22px] last:border-none">
      <span className="text-[#586174]">{label}:</span>
      <span className="max-w-[70%] break-words text-right font-semibold text-[#17233b]">{children}</span>
    </li>
  )
}

/** Demo list Excel ("Выбранные передачи Excel"): № | Со склада | На склад | Создал | Дата создания | Дата доставки | Сумма | Вес | Статус. */
export function transfersListSheet(rows: Transfer[], t: Translate, language: string): Cell[][] {
  return [
    ["№", t("Со склада"), t("На склад"), t("Создал"), t("Дата создания"), t("Дата доставки"), t("Сумма"), t("Вес"), t("Статус")],
    ...rows.map((row) => [
      row.id,
      row.fromWarehouse,
      row.toWarehouse,
      row.createdBy,
      docDate(row.createdAt, language),
      docDate(row.deliveredAt, language),
      Math.round(row.amount * 100) / 100,
      row.weight,
      t(row.status),
    ]),
  ]
}

/** One transfer's lines ("Скачать Excel" of the detail) + "Итого". */
export function transferItemsSheet(transfer: Transfer, t: Translate): Cell[][] {
  const qty = transfer.items.reduce((sum, item) => sum + item.quantity, 0)
  const weight = transfer.items.reduce((sum, item) => sum + item.quantity * item.weight, 0)
  return [
    [`${t("Передача")} № ${transfer.id}`, `${transfer.fromWarehouse} → ${transfer.toWarehouse}`],
    [],
    ["№", t("Товар"), t("Артикул"), t("Количество"), t("Ед. изм."), t("Вес"), t("Серия"), t("Цена"), t("Сумма")],
    ...transfer.items.map((item, index) => [
      index + 1,
      item.product,
      item.article,
      item.quantity,
      item.unit,
      Math.round(item.quantity * item.weight * 1000) / 1000,
      item.series || "-",
      item.price,
      Math.round(item.quantity * item.price * 100) / 100,
    ]),
    [t("Итого"), "", "", qty, "", Math.round(weight * 1000) / 1000, "", "", Math.round(transfer.amount * 100) / 100],
  ]
}
