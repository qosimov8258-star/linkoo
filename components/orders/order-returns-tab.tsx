"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

/** GET /api/orders/[id]/return-docs: the client returns of the order (Продажи → Возвраты). */
type ReturnDoc = { id: number; reason: string; warehouse: string; date: string; amount: number; currency: string; status: "pending" | "accepted" | "cancelled" }
/** GET /api/orders/[id]/payments: the order's payments in the cash ledger (lib/orders-repo.ts OrderPaymentLine). */
type Payment = {
  kind: "payment" | "allocated" | "linko"
  /** A debt transaction copied from Linko: its type, cash transaction number, source return / order, its amount in the
   * base currency and the rate it was booked at (lib/orders-repo.ts LinkoPaymentLine). */
  linko?: { type: number; transaction: number | null; orderReturn: number | null; order: number | null; internal: number; rate: number | null; baseCurrency: string }
  id: number
  docNo: number
  date: string
  client: string
  user: string
  comment: string
  accepted: boolean
  amount: number
  currency: string
  orderAmount: number
  orderCurrency: string
}

/** "1 234,5 SUM": money with 2 decimals in its own currency (never another one). */
const money = (value: number, currency: string) => `${formatMoney(value)} ${currencyLabel(currency)}`.trim()

function useFetched<T>(url: string): T[] | null {
  const [rows, setRows] = useState<T[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(url)
      .then(async (response) => (response.ok ? ((await response.json()) as T[]) : []))
      .catch(() => [] as T[])
      .then((data) => alive && setRows(data))
    return () => {
      alive = false
    }
  }, [url])
  return rows
}

/** "Возврат" tab of the order card: the client returns of the order (Продажи → Возвраты, client_returns). */
export function OrderReturnsTab({ orderId, empty }: { orderId: number; empty: React.ReactNode }) {
  const { t, language } = useLanguage()
  const docs = useFetched<ReturnDoc>(`/api/orders/${orderId}/return-docs`)
  if (docs === null) return <div className="h-[120px]" />
  if (docs.length === 0) return <>{empty}</>
  const line = "border-b-2 border-dotted border-[#d9e0e5]"
  return (
    <div className="pb-[10px] text-[13px]">
      <div className={`grid h-[60px] grid-cols-[356px_1fr_95px_356px_119px] items-center ${line} pl-[5px] font-semibold`}>
        <span>{t("Причина возврата")}</span>
        <span>{t("Склад")}</span>
        <span className="text-right">{t("Дата возврата")}</span>
        <span className="text-right">{t("Сумма")}</span>
        <span />
      </div>
      {docs.map((doc) => (
        <div key={doc.id} className={`grid h-[60px] grid-cols-[356px_1fr_95px_356px_119px] items-center ${line} pl-[5px]`}>
          <span>{doc.reason}</span>
          <span>{doc.warehouse}</span>
          <span className="text-right">{formatDateText(doc.date, language)}</span>
          <span className="pr-0 text-right">{money(doc.amount, doc.currency)}</span>
          <span className={`text-right ${doc.status === "accepted" ? "text-[#81c784]" : doc.status === "cancelled" ? "text-[#e57373]" : "text-[#f0ad4e]"}`}>
            {t(doc.status === "accepted" ? "Принят" : doc.status === "cancelled" ? "Отменен" : "Ожидает")}
          </span>
        </div>
      ))}
    </div>
  )
}

/** "Список оплат по заказу": clicking the paid amount opens it. The cash ledger's payments linked to
 * the order plus the share of the client's other payments counted towards it (they add up to "Оплачено"). */
export function OrderPaymentsDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t, language } = useLanguage()
  const rows = useFetched<Payment>(`/api/orders/${orderId}/payments`)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const dotted = "after:absolute after:inset-x-2 after:bottom-0 after:border-b-2 after:border-dotted after:border-[#d9e0e5] after:content-['']"
  return createPortal(
    <div data-order-overlay onClick={onClose} className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]">
      <div onClick={(event) => event.stopPropagation()} className="relative max-h-[90vh] w-[900px] max-w-full overflow-auto bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <div className="relative h-[60px] border-b border-[#efefef]">
          <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{`${t("Список оплат по заказу")} № ${orderId}`}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>
        {/* Linko: an order without payments shows its wallet picture (270 px wide, 15 px from the top of a 270 px block)
            and the notice near its bottom, no table head. */}
        {rows !== null && rows.length === 0 ? (
          <div className="mx-[30px] flex h-[270px] items-end justify-center bg-[url('/payments-empty.png')] bg-[length:270px_auto] bg-[position:center_15px] bg-no-repeat pb-[45px]">
            <div className="w-[420px] text-center text-[13px] leading-4 text-[#797f94]">{t("По данному заказу еще не произведено оплат")}</div>
          </div>
        ) : (
        <div className="px-[22px] pt-[10px]">
          {/* Linko's dottedList rows: six equal columns (8 px padding), 20 px above and below, a dotted line 8 px in from
              the edges under every row but the last. */}
          <div className={`relative grid grid-cols-6 items-center py-5 font-semibold leading-4 [&>span]:px-2 ${dotted}`}>
            <span>{t("Дата")}</span>
            <span>{t("Клиент")}</span>
            <span>{t("Пользователь")}</span>
            <span>{t("Описание")}</span>
            <span className="text-right">{t("Сумма")}</span>
            <span className="text-right">{t("На заказ")}</span>
          </div>
          {rows === null ? (
            <p className="py-8 text-center text-[#888]">{t("Загрузка...")}</p>
          ) : (
            rows.map((row, index, all) => (
              <div key={`${row.kind}-${row.id}-${row.orderCurrency}`} className={`relative grid grid-cols-6 items-center py-5 leading-4 [&>span]:px-2 ${index < all.length - 1 ? dotted : ""}`}>
                <span>{row.date ? formatDateText(row.date, language, { withTime: true }) : "—"}</span>
                <span>{row.client}</span>
                {/* Linko: «Не известно» when the transaction has no user. */}
                <span>{row.user || (row.kind === "allocated" ? "—" : t("Не известно"))}</span>
                <span>
                  {row.kind === "allocated" ? t("Зачтено из оплат клиента") : <PaymentKind row={row} />}
                  {row.comment && (
                    <span className="block">
                      <strong>{t("Комментарий")}:</strong> {row.comment}
                    </span>
                  )}
                </span>
                {/* Linko: green above 0, red below; another currency than the base adds its base amount and rate. */}
                <span className={`text-right ${row.amount > 0 ? "text-[#81c784]" : row.amount < 0 ? "text-[#e57373]" : ""}`}>
                  {money(row.amount, row.currency)}
                  {row.linko && row.currency !== row.linko.baseCurrency && (
                    <span className="block">
                      {money(row.linko.internal, row.linko.baseCurrency)}{" "}
                      <span className="text-[11px] font-semibold text-[#666]">({Math.trunc(row.linko.rate ? row.linko.rate : row.linko.internal ? row.amount / row.linko.internal : 0)})</span>
                    </span>
                  )}
                </span>
                <span className="text-right">{money(row.orderAmount, row.orderCurrency)}</span>
              </div>
            ))
          )}
        </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Linko's description of a credit (its TransactionType with the transaction link): «Оплата» with the cash
 * transaction (or «кассир пока не принял»), «Возврат № N», «Заказ № N»… */
function PaymentKind({ row }: { row: Payment }) {
  const { t } = useLanguage()
  const link = "text-[#129fdd]"
  const type = row.linko?.type ?? 1
  const order = row.linko?.order ?? 0
  const orderReturn = row.linko?.orderReturn ?? 0
  const orderLink = (label: string) => (
    <a href={`/analytics/sales/${order}?search=${order}`} className={link}>
      {t(label)} № {order}
    </a>
  )
  switch (type) {
    case 1: {
      const number = row.linko ? (row.linko.transaction ?? 0) : row.docNo
      const accepted = row.linko ? number > 0 : row.accepted
      if (!accepted)
        return (
          <span>
            {t("Оплата")} <b className="text-[#e57373]">({t("кассир пока не принял")})</b>
          </span>
        )
      return (
        <span>
          {t("Оплата")}
          {number > 0 && (
            <a href={`/analytics/cash-management?search=${number}`} className={`ml-[4px] font-semibold ${link}`}>
              {`${t("Транзакция")}: № ${number}`}
            </a>
          )}
        </span>
      )
    }
    case 2:
      return <span>{t("Первоначальный баланс")}</span>
    case 3:
      return (
        <a href={`/analytics/returns/${orderReturn}?search=${orderReturn}`} className={link}>
          {t("Возврат")} № {orderReturn}
        </a>
      )
    case 4:
      return orderLink("Заказ")
    case 5:
      return <span>{t("Расход")}</span>
    case 6:
      return <span>{t("Отмена")}</span>
    case 7:
      return orderLink("Отмена заказа")
    case 8:
      return (
        <a href={`/analytics/returns/${orderReturn}?search=${orderReturn}`} className={link}>
          {t("Отмена возврата")} № {orderReturn}
        </a>
      )
    case 9:
      return <span>{t("Нет типа")}</span>
    case 10:
      return orderLink("Редактирование заказа")
    case 11:
      return orderLink("Скидка на заказ")
    case 12:
      return <span>{t("Индивидуальная скидка")}</span>
    default:
      return null
  }
}
