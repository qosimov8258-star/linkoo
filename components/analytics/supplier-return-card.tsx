"use client"

import type { ReactNode } from "react"

import { RI, RefButton } from "@/components/ref/list-kit"
import { amountDigits } from "@/lib/amount-precision"
import { formatStatementDate, parseAnyDay } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

import { SupplierReturnPrintButton } from "./supplier-return-print"
import type { ReturnStatus, SupplierReturn } from "./supplier-returns-data"

// The supplier return card as Linko draws it (#/provider-return/<id>, modules 4661 / 4662):
// - the title bar: «Возврат поставщику №N» (+ « со старой базы данных»), then «Принять» (only while «Ожидает»), the
//   print menu, the pencil (disabled with «Со старой базы нельзя изменять» for an old-base return) and the trash
//   («Отменить»), for every status; a click anywhere else on the bar closes the card (there is no close button);
// - the left column: who added it, the supplier, organization, currency, payment type, price list (when set), the
//   return's day and branch; «СКЛАД»: the warehouse, «Время передачи» / «Передал» (kept after a cancel) and the status;
//   «Причина возврата:» with the comment in bold;
// - the right column: one tab «Список товаров»: № / Товар, Количество, Серия, Цена (CUR), Сумма (CUR), «Итого:».
// Linko prints «Тип оплаты» as «банковский счет» for every return (it reads a name the API does not send); the card
// shows the return's own payment type.

export const STATUS_LABEL: Record<ReturnStatus, string> = { завершен: "Завершен", "в процессе": "Ожидает", отменен: "Отменен" }
const STATUS_TEXT_COLOR: Record<ReturnStatus, string> = { завершен: "#81c784", "в процессе": "#f0ad4e", отменен: "#e57373" }
const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
// Linko's columns: xs3 «№ Товар», xs1 Количество, xs2 Серия, xs2 Цена, xs2 Сумма (12 per row, the last 2 empty); its rows
// stick out 8 px on both sides with 5 px inside on the left, and the dotted rule under a row is its ::after image.
const COLS = "-mx-[8px] pl-[5px] grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)]"
const CELL = "px-[8px]"
const DOTTED = "relative after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

/** Linko's numberFormat: the decimals of Настройки → Округление сумм (its ROUND_AMOUNT_FOR_CURRENCY; else `digits`),
 * thousands grouped, trailing zeros dropped. */
export function num(value: number, digits = 3) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(digits) })
}

/** A stored return day (YYYY-MM-DD; older rows "19.10.2026", "20 октября 2026") in the page language, without "г.". */
export function formatDay(value: string, language: string) {
  const day = parseAnyDay(value)
  return day ? formatStatementDate(day, language, false).replace(/\s*г\.$/, "") : value
}

/** «Итого» of the quantities as Linko prints it: Σ amount and the first line's measurement, which a supplier return's
 * lines never carry, so one plain number whatever the units. */
export function quantityTotal(items: SupplierReturn["items"]) {
  return num(items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0))
}

function Info({ label, children, valueStyle }: { label: string; children: ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <li className="flex justify-between gap-[10px] leading-[25px]">
      <span>{label}</span>
      <span className="text-right font-semibold" style={valueStyle}>
        {children}
      </span>
    </li>
  )
}

function IconButton({ icon, label, onClick, disabled, iconClass = "h-6 w-6" }: { icon: string; label: string; onClick: () => void; disabled?: boolean; iconClass?: string }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="relative z-[1] flex h-12 w-12 cursor-pointer items-center justify-center disabled:cursor-default">
      <svg viewBox="0 0 24 24" className={iconClass} style={{ fill: disabled ? "rgba(0,0,0,0.3)" : "#666" }} aria-hidden>
        <path d={icon} />
      </svg>
    </button>
  )
}

export function SupplierReturnCard({
  row,
  baseCurrency,
  busy,
  onClose,
  onAccept,
  onEdit,
  onCancel,
}: {
  row: SupplierReturn
  baseCurrency: string
  busy?: boolean
  onClose: () => void
  onAccept: () => void
  onEdit: () => void
  onCancel: () => void
}) {
  const { t, language } = useLanguage()
  const currency = row.currency || baseCurrency
  const payment = row.paymentType ? t(row.paymentType) : ""
  return (
    // The list puts it between its two cards (SplitDetailList); Linko's card ends with a 1 px dotted rule.
    <div className="border-b border-dotted border-[#eee] bg-white text-left text-[13px] text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        {/* Linko's title bar: a click on it (not on its buttons) closes the card. */}
        <button type="button" aria-label={t("Свернуть")} tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-pointer" />
        <h2 className="pointer-events-none relative text-[18px] font-semibold leading-[24px] text-[#333]">
          {t("Возврат поставщику №")}
          {row.id}
          {row.fromOldBase && <span className="text-[14px] font-light text-[rgb(140,140,140)]"> {t("со старой базы данных")}</span>}
        </h2>
        <div className="relative flex items-center">
          {row.status === "в процессе" && (
            <span className="relative z-[1] mr-[8px]">
              <RefButton icon={CHECK_CIRCLE} label={t("Принять")} disabled={busy} onClick={onAccept} exact />
            </span>
          )}
          <SupplierReturnPrintButton id={row.id} />
          <IconButton icon={RI.edit} label={row.fromOldBase ? t("Со старой базы нельзя изменять") : t("Изменить")} disabled={row.fromOldBase} onClick={onEdit} />
          <IconButton icon={RI.trash} label={t("Отменить")} disabled={busy} onClick={onCancel} iconClass="h-5 w-5" />
        </div>
      </div>

      <div className="grid grid-cols-[347.7px_minmax(0,1fr)]">
        <div className="border-r border-[#efefef]">
          <ul className="px-[30px] py-[15px]">
            <Info label={`${t("Добавил")}:`}>{row.addedBy}</Info>
            <Info label={`${t("Поставщик")}:`}>{row.fromWhom}</Info>
            <Info label={`${t("Организация")}:`}>{row.organization}</Info>
            <Info label={`${t("Валюта")}:`}>{currency}</Info>
            <Info label={`${t("Тип оплаты")}:`}>{payment}</Info>
            {row.priceList && <Info label={`${t("Прайс лист")}:`}>{row.priceList}</Info>}
            <Info label={`${t("Дата возврата")}:`}>
              <span data-no-translate>{`${formatDay(row.date, language)}${row.time ? `, ${row.time}` : ""}`}</span>
            </Info>
            {row.branch && <Info label={`${t("Филиал")}:`}>{row.branch}</Info>}
          </ul>
          <div className="border-t border-[#efefef] px-[30px] py-[15px]">
            <p className="mb-[10px] font-semibold uppercase leading-[16px]">{t("Склад")}</p>
            <ul>
              <Info label={`${t("Склад")}:`}>{row.warehouse}</Info>
              <Info label={`${t("Время передачи")}:`}>
                {row.transferTime ? <span data-no-translate>{formatDateText(row.transferTime, language, { withTime: true })}</span> : t("Не установлено")}
              </Info>
              <Info label={`${t("Передал")}:`}>{row.transferredBy || t("Не принят")}</Info>
              <Info label={`${t("Статус")}:`} valueStyle={{ color: STATUS_TEXT_COLOR[row.status] }}>
                {t(STATUS_LABEL[row.status])}
              </Info>
            </ul>
          </div>
          <div className="border-t border-[#efefef] px-[30px] pb-[20px] pt-[15px] leading-[25px]">
            {t("Причина возврата:")}&nbsp;<strong className="font-semibold">{row.reason}</strong>
          </div>
        </div>

        <div className="min-w-0 px-[30px] pb-[20px]">
          <div className="border-b border-[#efefef]">
            <span className="flex h-[48px] w-[450px] max-w-full items-center justify-center border-b-2 border-[#1E4A9A] pt-[3.4px] text-[13px] font-medium text-black">{t("Список товаров")}</span>
          </div>
          <div className="pr-[30px]">
            <div className={`grid ${COLS} ${DOTTED} min-h-[60px] items-center font-semibold`}>
              <span className={CELL}>
                {t("№")}&nbsp;&nbsp;&nbsp;{t("Товар")}
              </span>
              <span className={`${CELL} text-right`}>{t("Количество")}</span>
              <span className={`${CELL} text-right`}>{t("Серия")}</span>
              <span className={`${CELL} text-right`}>{`${t("Цена")} (${currency})`}</span>
              <span className={`${CELL} text-right`}>{`${t("Сумма")} (${currency})`}</span>
            </div>
            {row.items.map((item, index) => (
              <div key={`${item.id}-${index}`} className={`grid ${COLS} ${DOTTED} min-h-[60px] items-center hover:bg-[#f2f5f8]`}>
                <span className={CELL}>
                  <strong className="font-semibold">{index + 1}</strong>&nbsp;&nbsp;&nbsp;{item.product}
                </span>
                <span className={`${CELL} text-right`}>{num(Number(item.qty))}</span>
                <span className={`${CELL} text-right`} data-no-translate>
                  {item.series}
                </span>
                <span className={`${CELL} text-right`}>{num(Number(item.price))}</span>
                <span className={`${CELL} text-right`}>{num(Number(item.qty) * Number(item.price))}</span>
              </div>
            ))}
            <div className={`mt-[19px] grid ${COLS} items-center font-semibold`}>
              <span className={CELL}>{t("Итого")}:</span>
              <span className={`${CELL} text-right`}>{quantityTotal(row.items)}</span>
              <span />
              <span />
              <span className={`${CELL} text-right`}>{num(row.amount)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
