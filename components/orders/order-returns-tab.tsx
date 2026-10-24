"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

type ReturnDoc = { id: number; reason: string; warehouse: string; date: string; amount: number; currency: string; status: string }
type Payment = { id: number; date: string; client: string; user: string; returnId: number; txId: number; kind: number; comment: string; amount: number; orderAmount: number; currency: string }

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const pad = (value: number) => String(value).padStart(2, "0")
const money = (value: number) => Math.round(value * 100) / 100 === Math.round(value) ? Math.round(value).toLocaleString("ru-RU") : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })

function ruDate(iso: string, withTime = false) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
  return withTime ? `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}` : day
}

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

/** "Возврат" tab of the order card: the return documents of the order (reference GET sales/order_return/?order=). */
export function OrderReturnsTab({ orderId, currency, empty }: { orderId: number; currency: string; empty: React.ReactNode }) {
  const { t } = useLanguage()
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
        <span className="text-right">{`${t("Сумма")} (${currency})`}</span>
        <span />
      </div>
      {docs.map((doc, index) => (
        <div key={`${doc.id}-${index}`} className={`grid h-[60px] grid-cols-[356px_1fr_95px_356px_119px] items-center ${line} pl-[5px]`}>
          <span>{doc.reason}</span>
          <span>{doc.warehouse}</span>
          <span className="text-right">{ruDate(doc.date)}</span>
          <span className="pr-0 text-right">{money(doc.amount)}</span>
          <span className={`text-right ${doc.status === "2" ? "text-[#81c784]" : doc.status === "3" ? "text-[#e57373]" : "text-[#f0ad4e]"}`}>
            {t(doc.status === "2" ? "Принят" : doc.status === "3" ? "Отменен" : "Ожидает")}
          </span>
        </div>
      ))}
    </div>
  )
}

/** "Список оплат по заказу": clicking the paid amount opens it (reference GET sales/debt_transactions/?order=). */
export function OrderPaymentsDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t } = useLanguage()
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
          <button type="button" aria-label="close" onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
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
            {(rows ?? []).map((row, index, all) => (
              <div key={row.id} className={`grid min-h-[88px] grid-cols-6 items-center py-[10px] [&>span]:pr-[16px] ${index < all.length - 1 ? line : ""}`}>
                <span>{ruDate(row.date, true)}</span>
                <span>{row.client}</span>
                <span>{row.user}</span>
                <span>
                  {row.returnId ? (
                    <span className="text-[#129fdd]">{`${t("Возврат")} № ${row.returnId}`}</span>
                  ) : row.kind === 1 ? (
                    <>
                      {t("Оплата")} {row.txId > 0 && <span className="font-semibold text-[#129fdd]">{`${t("Транзакция")}: № ${row.txId}`}</span>}
                    </>
                  ) : (
                    row.comment
                  )}
                </span>
                <span className="text-right text-[#81c784]">{`${money(row.amount)} ${row.currency}`}</span>
                <span className="text-right">{`${money(row.orderAmount)} ${row.currency}`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
