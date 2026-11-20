"use client"

import { amountDigits } from "@/lib/amount-precision"
import { useLanguage } from "@/lib/i18n/language-context"

import { isOldBaseReturn, type ReturnCardItem, type ReturnCardRow } from "./return-card-aside"
import { ReturnItemMarksPanel, ReturnItemMarksToggle, useReturnItemMarksOpen } from "./return-item-marks"

// «Список товаров» of a return card, like Linko's: the «Заказ» column (not for a return of the catalog, nor when the
// first line has no order), the line number, the product with «(бонус)», «Заказ: N от <day> (<order line id>)» and
// «Акция: <name>», the quantity, «Блок» (boxes with the loose rest under them), the price and the sum; «Итого:» sums
// the quantity with the unit written right after it («10шт») and gives the return's amount («Общая сумма <currency>»
// and the amount for a return without lines). A cancelled return's lines show no order line id (Linko clears it).

const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
// Linko's columns (bootstrap xs-1/1/2/2/2/2/2, or xs-1/3/2/2/2/2 without «Заказ»), as rendered widths of its card.
const COLS_WITH_ORDER = "grid-cols-[minmax(0,98fr)_minmax(0,99fr)_minmax(0,180fr)_minmax(0,199fr)_minmax(0,197fr)_minmax(0,197fr)_minmax(0,197fr)]"
const COLS_NO_ORDER = "grid-cols-[minmax(0,98fr)_minmax(0,279fr)_minmax(0,199fr)_minmax(0,197fr)_minmax(0,197fr)_minmax(0,197fr)]"
// A row of the list (header and lines): Linko's min-height 60px, padding 10px 0, centred, its dotted line drawn inside.
const ROW = "relative min-h-[60px] items-center py-[10px] after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dotted after:border-[#c7ced4]"

/** Linko's numberFormat: up to `digits` decimals (those of Настройки → Округление сумм when set), trailing zeros
 * dropped, thousands grouped ("1 500", "0,5"). */
function num(value: number, digits = 3) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(digits) })
}

/** The order's day in the viewer's time ("20 янв. 2026") from its UTC creation moment. */
function orderDay(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** Linko's «Блок»: the quantity in boxes, and the loose rest on a line of its own; "0" for a product without a box. */
function BlockCell({ item, t }: { item: ReturnCardItem; t: (text: string) => string }) {
  const box = Number(item.boxAmount) || 0
  if (!(box > 0)) return <>0</>
  const rest = Math.round((item.quantity - Math.floor(item.quantity / box + 1e-9) * box) * 1e9) / 1e9
  return (
    <>
      {num(item.quantity / box)} {item.boxUnit ? t(item.boxUnit) : t("блок")}
      {rest > 0 ? (
        <>
          <br />
          <span className="text-[11px]">
            (+{num(rest)} {item.unit ? t(item.unit) : ""})
          </span>
        </>
      ) : null}
    </>
  )
}

/** «Итого» quantity: the sum with its unit right after it ("241кг", only the unit when it is 0). Linko adds up every line
 * under the first line's unit ("100kg" for 97 kg + 3 ШТ); here each unit keeps its own sum ("97kg, 3ШТ"), units
 * spelled in another case ("шт" / "ШТ") counted as one, in the order of the lines. */
function totalQuantity(items: ReturnCardItem[], t: (text: string) => string) {
  const byUnit = new Map<string, { unit: string; quantity: number }>()
  for (const item of items) {
    const unit = item.unit ?? ""
    const sum = byUnit.get(unit.toLowerCase()) ?? { unit, quantity: 0 }
    sum.quantity += item.quantity
    byUnit.set(unit.toLowerCase(), sum)
  }
  return [...byUnit.values()].map(({ unit, quantity }) => `${quantity > 0 ? num(quantity) : ""}${unit ? t(unit) : ""}`).join(", ")
}

export function ReturnItemsTab({ row }: { row: ReturnCardRow }) {
  const { t } = useLanguage()
  const items = row.items ?? []
  const withOrder = !isOldBaseReturn(row) && Boolean(items[0]?.orderId)
  const cols = withOrder ? COLS_WITH_ORDER : COLS_NO_ORDER
  const marks = useReturnItemMarksOpen(row.id)
  const orderLink = (orderId: number) => (
    <a href={`/analytics/sales/${orderId}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#129fdd] hover:underline">
      {orderId}
    </a>
  )

  return (
    <div className="leading-[1.25]">
      {/* Linko's list: rows of at least 60px, content centred, a dotted line at the bottom; it scrolls past 445px. */}
      <div className="max-h-[445px] overflow-y-auto overflow-x-hidden">
        <div className={`grid ${cols} ${ROW} font-semibold`}>
          {withOrder ? <span>{t("Заказ")}</span> : null}
          <span>{t("№")}</span>
          <span>{t("Товар")}</span>
          <span className="text-right">{t("Количество")}</span>
          <span className="text-right">{t("Блок")}</span>
          <span className="text-right">{`${t("Цена")} (${row.currency})`}</span>
          <span className="text-right">{`${t("Сумма")} (${row.currency})`}</span>
        </div>
        {items.map((item, index) => {
          const orderId = item.orderId ?? (isOldBaseReturn(row) ? null : row.orderId)
          const lineId = item.orderLineId === undefined ? item.orderItemId : item.orderLineId
          return (
            <div key={item.id} className={`grid ${cols} ${ROW}`}>
              {withOrder ? <span>{orderId ? orderLink(orderId) : null}</span> : null}
              <span className="flex items-center">
                <span className="font-semibold">{index + 1}</span>
                <ReturnItemMarksToggle open={marks.isOpen(item.id)} onToggle={() => marks.toggle(item.id)} />
              </span>
              <span className="block min-w-0 break-words">
                <strong className="font-semibold">{item.productName}</strong>
                {item.isBonus ? (
                  <strong className="font-semibold text-[#81c784]">
                    {" "}
                    ({t("бонус")})
                  </strong>
                ) : null}
                {orderId ? (
                  <span className="block">
                    {t("Заказ")}: {orderId}
                    {item.orderCreatedAt ? ` ${t("от")} ${t(orderDay(item.orderCreatedAt))}` : ""}
                    {lineId ? <span className="text-[12px]"> ({lineId})</span> : null}
                  </span>
                ) : null}
                {item.promotion ? (
                  <span className="block">
                    {t("Акция")}: {item.promotion}
                  </span>
                ) : null}
              </span>
              <span className="text-right">
                {num(item.quantity)} {item.unit ? t(item.unit) : ""}
              </span>
              <span className="text-right">
                <BlockCell item={item} t={t} />
              </span>
              <span className="text-right">{num(item.price)}</span>
              <span className="text-right">{num(item.total)}</span>
              {marks.isOpen(item.id) ? <ReturnItemMarksPanel returnId={row.id} itemId={item.id} /> : null}
            </div>
          )
        })}
      </div>
      {/* Linko's summary row: «Итого:» with the quantity, or «Общая сумма <currency>» alone for a return without lines. */}
      <div className={`grid ${cols} mt-[20px] font-semibold`}>
        <span className={withOrder ? "col-span-3" : "col-span-2"}>{items.length ? t("Итого:") : `${t("Общая сумма")} ${row.currency}`}</span>
        <span className="text-right">{items.length ? totalQuantity(items, t) : null}</span>
        <span />
        <span />
        <span className="text-right">{num(row.amount)}</span>
      </div>
    </div>
  )
}
