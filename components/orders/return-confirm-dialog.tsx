"use client"

import { X } from "lucide-react"
import { createPortal } from "react-dom"

import { amountDigits } from "@/lib/amount-precision"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Step 2 of «Добавление возврата» / «Изменение возврата» (Linko's preview dialog of ReturnCreateForm): the lines the
// server would save (POST /api/client-returns/preview), «Общая сумма возврата» per currency and «Оформить возврат».
// X only closes it (back to the form, nothing saved).

export type ReturnPreviewLine = { productName: string; unit: string; orderId: number | null; quantity: number; price: number; currency: string; total: number }

/** Linko's dottedList line under a row (an image there): 2px dots #d9e0e5 every 8px, 2px high, the row's full width.
 * A background, not a ::after: a table row's pseudo-element would take a column of the fixed table. */
export const DOTTED_LINE = "bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] bg-[length:8px_2px] bg-left-bottom bg-repeat-x"

/** Linko's numberFormat: «10 000», «0,5» (at most `digits` decimals; the decimals of Настройки → Округление сумм, its
 * ROUND_AMOUNT_FOR_CURRENCY, override every precision it is given), then the suffix. */
export function returnNumber(value: number, suffix = "", digits = 3) {
  const text = (Number.isFinite(value) ? value : 0).toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(digits) }).replace(/ /g, " ")
  return suffix ? `${text} ${suffix}` : text
}

export function ReturnConfirmDialog({ lines, saving, error, onClose, onSubmit }: { lines: ReturnPreviewLine[]; saving: boolean; error?: string; onClose: () => void; onSubmit: () => void }) {
  const { t } = useLanguage()
  const sums = new Map<string, number>()
  for (const line of lines) sums.set(line.currency, (sums.get(line.currency) ?? 0) + line.quantity * line.price)
  const unit = (value: string) => (value ? t(value) : "")
  return createPortal(
    <div className="fixed inset-0 z-[1501] flex items-start justify-center overflow-y-auto bg-black/[0.54] py-[64px] font-sans text-[13px] text-[#333]" role="dialog" aria-modal="true" aria-label={t("Подтверждение возврата")}>
      <div className="relative my-auto w-[600px] max-w-[calc(100vw-32px)] bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <span className="text-[13px] font-bold uppercase">{t("Подтверждение возврата")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="px-[30px]">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center pb-[20px] pt-[20px] text-center text-[13px] text-[#666]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="mb-[10px] w-[175px]" />
              <div>{t("По вашему запросу ничего не найдено")}</div>
            </div>
          ) : (
            // Linko's rows: 20px above and below, the grid's 8px gutters (its row reaches 8px past the padding, where its
            // dotted line starts), a dotted line under every row, the last one too.
            <div className="-mx-[8px] leading-[16px] [&>div>span]:px-[8px]">
              <div className={`grid grid-cols-12 items-center py-[20px] font-semibold ${DOTTED_LINE}`}>
                <span className="col-span-4">{t("Наименование")}</span>
                <span className="col-span-2">{t("Заказ")}</span>
                <span className="col-span-2">{t("Кол-во")}</span>
                <span className="col-span-2">{t("Цена")}</span>
                <span className="col-span-2 text-right">{t("Сумма")}</span>
              </div>
              {lines.map((line, index) => (
                <div key={index} className={`grid grid-cols-12 items-center py-[20px] ${DOTTED_LINE}`}>
                  <span className="col-span-4 break-words">{line.productName}</span>
                  <span className="col-span-2">{line.orderId ?? ""}</span>
                  <span className="col-span-2">{returnNumber(line.quantity, unit(line.unit))}</span>
                  <span className="col-span-2">{returnNumber(line.price, currencyLabel(line.currency))}</span>
                  <span className="col-span-2 text-right">{returnNumber(line.quantity * line.price, currencyLabel(line.currency))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="-mx-[30px] bg-[#f2f5f8] px-[30px] py-[15px] font-bold uppercase leading-[16px]">
            {t("Общая сумма возврата")}:{" "}
            {[...sums].map(([currency, sum], index) => (
              <span key={currency} className="mr-[5px] font-semibold">
                {returnNumber(sum, currencyLabel(currency))}
                {index < sums.size - 1 ? "," : ""}
              </span>
            ))}
          </div>
          {error && <div className="-mx-[30px] px-[30px] pt-[10px] text-[13px] text-[#f44336]">{error}</div>}
        </div>
        {lines.length > 0 && (
          <div className="flex items-center justify-end py-[10px] pl-[30px] pr-[14px]">
            <button type="button" disabled={saving} onClick={onSubmit} className="h-9 min-w-[88px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/[0.04] disabled:opacity-50">
              {t("Оформить возврат")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
