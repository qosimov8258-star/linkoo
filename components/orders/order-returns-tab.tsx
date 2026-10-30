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
  kind: "payment" | "allocated"
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
  const line = "border-b-2 border-dotted border-[#d9e0e5]"
  return createPortal(
    <div data-order-overlay onClick={onClose} className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]">
      <div onClick={(event) => event.stopPropagation()} className="relative max-h-[90vh] w-[900px] max-w-full overflow-auto bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <div className="relative h-[60px] border-b border-[#efefef]">
          <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{`${t("Список оплат по заказу")} № ${orderId}`}</span>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>
        <div className="overflow-hidden px-[30px] pb-[8px]">
          <div className="w-[856px]">
            <div className={`grid h-[65px] grid-cols-6 items-center ${line} font-semibold [&>span]:pr-[16px]`}>
              <span>{t("Дата")}</span>
              <span>{t("Клиент")}</span>
              <span>{t("Пользователь")}</span>
              <span>{t("Описание")}</span>
              <span className="text-right">{t("Сумма")}</span>
              <span className="text-right">{t("На заказ")}</span>
            </div>
            {rows === null ? (
              <p className="py-8 text-center text-[#888]">{t("Загрузка...")}</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-[#888]">{t("По вашему запросу ничего не найдено")}</p>
            ) : (
              rows.map((row, index, all) => (
                <div key={`${row.kind}-${row.id}-${row.orderCurrency}`} className={`grid min-h-[88px] grid-cols-6 items-center py-[10px] [&>span]:pr-[16px] ${index < all.length - 1 ? line : ""}`}>
                  <span>{row.date ? formatDateText(row.date, language, { withTime: true }) : "—"}</span>
                  <span>{row.client}</span>
                  <span>{row.user || "—"}</span>
                  <span>
                    {row.kind === "allocated" ? (
                      t("Зачтено из оплат клиента")
                    ) : (
                      <>
                        {t("Оплата")} {row.docNo > 0 && <span className="font-semibold text-[#129fdd]">{`${t("Транзакция")}: № ${row.docNo}`}</span>}
                        {row.comment && <span className="block text-[#666]">{row.comment}</span>}
                        {!row.accepted && <span className="block text-[#f0ad4e]">{t("Ожидает подтверждения")}</span>}
                      </>
                    )}
                  </span>
                  <span className="text-right text-[#81c784]">{money(row.amount, row.currency)}</span>
                  <span className="text-right">{money(row.orderAmount, row.orderCurrency)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
