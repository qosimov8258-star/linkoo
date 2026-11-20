"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

// Linko's «ВЫПОЛНИТЬ» dialog of the orders list (its openDelivery=true): the list's green «Передать» (Активные) and
// «Доставлен» (Доставляется) ask «Подтверждение запроса» for the ticked orders of the list, can also set the transfer day
// (accepted_time) and the delivery day, and «ДА» changes the status (Linko's orderChangeStatusAction).

export type DeliveryDates = { transferDate?: string; deliveryDate?: string }

const CALENDAR = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const BOX_OFF = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

export function OrderDeliveryDialog({ ids, saving, onClose, onConfirm }: { ids: number[]; saving: boolean; onClose: () => void; onConfirm: (dates: DeliveryDates) => void }) {
  const { t } = useLanguage()
  const [transfer, setTransfer] = useState<string | null>(null)
  const [delivery, setDelivery] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const field = (check: string, label: string, value: string | null, set: (value: string | null) => void) => (
    <div key={label}>
      <label className="flex h-[30px] cursor-pointer items-center gap-[2px] font-semibold text-black">
        <input type="checkbox" checked={value !== null} onChange={() => set(value === null ? "" : null)} className="sr-only" />
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#5d6474]" aria-hidden>
          <path d={value !== null ? BOX_ON : BOX_OFF} />
        </svg>
        {t(check)}
      </label>
      {value !== null && (
        // Linko's DateField: the label inside the line, the calendar icon at its right; room below it for the picker.
        <label className="relative mb-[64px] mt-[14px] block h-[30px] border-b border-[#e0e0e0]">
          <span className="pointer-events-none absolute left-0 top-[6px] font-semibold text-black">{value ? "" : t(label)}</span>
          <input
            type="date"
            value={value}
            onChange={(event) => set(event.target.value)}
            aria-label={t(label)}
            className={`absolute inset-0 bg-transparent text-[13px] outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-6 [&::-webkit-calendar-picker-indicator]:w-6 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 ${value ? "text-black" : "text-transparent"}`}
          />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[5px] right-[2px] h-[18px] w-[18px] fill-[#ccc]" aria-hidden>
            <path d={CALENDAR} />
          </svg>
        </label>
      )}
    </div>
  )

  return createPortal(
    <div data-order-overlay className="fixed inset-0 z-[1501] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]" onClick={onClose}>
      <div role="dialog" aria-label={t("Выполнить")} onClick={(event) => event.stopPropagation()} className="w-[500px] max-w-[calc(100vw-32px)] bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <span className="font-bold uppercase">{t("Выполнить")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </div>
        <p className="px-[30px] py-[19px] leading-[18px]">{t("Подтверждение запроса")}</p>
        <div className="bg-[#f2f5f8] px-[30px] pb-[23px] pt-[19px]">
          <p className="mb-[19px] font-semibold leading-[18px]">
            {t("Выбранные заказы:")} {ids.join(", ")}
          </p>
          {field("Изменить дату передачи", "Дата передачи", transfer, setTransfer)}
          {field("Изменить дату доставки", "Дата доставки", delivery, setDelivery)}
        </div>
        <div className="mt-[14px] flex h-[56px] items-center justify-end border-t border-[#efefef] pr-[24px]">
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm({ transferDate: transfer || undefined, deliveryDate: delivery || undefined })}
            className="h-9 min-w-[64px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/[0.04] disabled:opacity-50"
          >
            {t("Да")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
