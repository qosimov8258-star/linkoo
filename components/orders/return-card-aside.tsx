"use client"

import type { ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import type { ClientReturnItem, ClientReturnRow } from "./returns-view"

// The title and the left column of a return card (Продажи → Возвраты), like Linko's: «Возврат №N» (« со старой базы
// данных» for a return of the catalog), then the order link, who added it, the client (a click opens its shop card over
// the return), the financial account, zone, price list, dates, people, organization, branch and payment type; the
// warehouse block (acceptance); the reason and the comment.

/** A return line with what the card shows of a line copied from Linko. */
export type ReturnCardItem = ClientReturnItem & {
  /** The order line id of «Заказ: N от … (id)» (Linko's for a copied line, null when Linko has none). */
  orderLineId?: number | null
  isBonus?: boolean
  promotion?: string
}

/** A return with the card fields the API adds. */
export type ReturnCardRow = Omit<ClientReturnRow, "items"> & {
  priceList?: string
  /** Linko's own name of the payment type of a copied return («Наличные», «cash»). */
  paymentTypeName?: string
  items?: ReturnCardItem[]
}

/** A return of the catalog, not of order lines (Linko's return_from_old_base): no «Заказ» column, a title note. */
export function isOldBaseReturn(row: ReturnCardRow): boolean {
  return row.fromOrder === false
}

// moment's Russian short months, as Linko prints them ("04 мар. 2026", "17 июля 2026").
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const STATUS: Record<ClientReturnRow["status"], { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "text-[#f0ad4e]" },
  accepted: { label: "Принят", color: "text-[#81c784]" },
  cancelled: { label: "Отменен", color: "text-[#e57373]" },
}
const PAYMENT_LABEL: Record<string, string> = { cash: "Наличные", bank: "Перечисление" }

const pad = (part: number) => String(part).padStart(2, "0")

/** A UTC moment (ISO, or the app's "2026-01-29 08:09:14" without a zone) as a Date, null when unreadable. */
function utc(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** «Дата возврата»: the return's day with its stored local time ("17 июля 2026, 08:24"). A return made here stores only
 * the day of its form, so the time comes from its creation moment (Linko's created_date has both). */
function dayTime(value: string, createdAt?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value ?? "")
  if (!match) return value
  const day = `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`
  if (match[4]) return `${day}, ${match[4]}:${match[5]}`
  const created = utc(createdAt)
  return created ? `${day}, ${pad(created.getHours())}:${pad(created.getMinutes())}` : day
}

/** A UTC moment (ISO, or the app's "2026-01-29 08:09:14" without a zone) in the viewer's time. */
function moment(value: string | null | undefined) {
  if (!value) return ""
  const date = utc(value)
  if (!date) return value
  return `${pad(date.getDate())} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** «Возврат №218 со старой базы данных» (the note gray, 14px, light). */
export function ReturnCardTitle({ row }: { row: ReturnCardRow }) {
  const { t } = useLanguage()
  return (
    <>
      {t("Возврат")} №{row.id}
      {isOldBaseReturn(row) ? (
        <span className="text-[14px] font-light text-[#8c8c8c]">
          {" "}
          {t("со старой базы данных")}
        </span>
      ) : null}
    </>
  )
}

export function ReturnCardAside({ row, onOpenShop }: { row: ReturnCardRow; onOpenShop: (shopId: number) => void }) {
  const { t } = useLanguage()
  const line = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex gap-[10px] leading-[25px]">
      <span className="flex-none">{t(label)}:</span>
      <span className={`min-w-0 flex-1 break-words text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )
  const block = "border-b border-[#efefef] px-[30px] py-[15px]"
  const accepted = row.acceptedAt ? t(moment(row.acceptedAt)) : ""
  const payment = row.paymentTypeName || (PAYMENT_LABEL[row.paymentType ?? ""] ? t(PAYMENT_LABEL[row.paymentType ?? ""]) : t("Не указано"))
  const status = STATUS[row.status] ?? STATUS.pending

  return (
    <aside className="border-r border-[#efefef]">
      <ul className={block}>
        {row.orderId ? (
          <li className="leading-[25px]">
            <a href={`/analytics/sales/${row.orderId}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#129fdd] hover:underline">
              {t("Заказ")} №{row.orderId}
            </a>
          </li>
        ) : null}
        {line("Добавил", row.createdBy || "—")}
        {/* The shop: its card opens over the return (?openShopDetail=<shop id>). */}
        {row.client
          ? line(
              "Клиент",
              row.clientId ? (
                <button type="button" onClick={() => onOpenShop(row.clientId!)} className="cursor-pointer text-right font-semibold text-[#1E4A9A]">
                  {row.client}
                </button>
              ) : (
                row.client
              ),
            )
          : null}
        {row.account ? line("Финансовый счет", row.account) : null}
        {line("Зона", row.zone || t("Не указано"))}
        {row.priceList ? line("Прайс лист", row.priceList) : null}
        {line("Дата возврата", t(dayTime(row.returnDate, row.createdAt)))}
        {line("Доставщик", row.deliverer || t("Не указано"))}
        {line("Ответственный агент", row.agent || t("Не указано"))}
        {line("Организация", row.organization || t("Не указано"))}
        {row.branch ? line("Филиал", row.branch) : null}
        {line("Тип оплаты", payment)}
      </ul>
      <ul className={block}>
        <li className="mb-[10px] font-semibold uppercase leading-[1.25]">{t("СКЛАД")}</li>
        {line("Склад", row.warehouse || t("Не указан"))}
        {line("Начало приемки", accepted || t("Не установлено"))}
        {line("Конец приемки", accepted || t("Не установлен"))}
        {line("Принял", row.acceptedAt ? row.acceptedBy || "—" : t("Не принят"))}
        {line("Статус", t(status.label), status.color)}
      </ul>
      <ul className={block}>
        {line("Причина возврата", row.reason || t("Не указано"))}
        {line("Комментарий", row.comment || t("Не указано"))}
      </ul>
    </aside>
  )
}
