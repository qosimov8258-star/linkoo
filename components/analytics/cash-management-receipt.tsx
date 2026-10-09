"use client"

import { useEffect } from "react"
import { Printer, X } from "lucide-react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { ErrorBlock, LoadingBlock, formatCashDate } from "@/components/analytics/cash-management-shared"
import type { CashReceipt } from "@/lib/cash/types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// "Печать" → receipt "Квитанция № …" (demo chunk 35 module 4605): full-page
// layout printed with window.print() 500 ms after it renders. Data:
// GET /api/cash/operations/[key]/receipt. The print stylesheet hides the rest
// of the page so only the receipt is printed.

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #cash-receipt-print, #cash-receipt-print * { visibility: visible !important; }
  #cash-receipt-print { position: absolute !important; inset: 0 !important; overflow: visible !important; }
  #cash-receipt-print .no-print { display: none !important; }
}
`

export function CashReceiptPrint({ operationKey, onClose }: { operationKey: string; onClose: () => void }) {
  const { t, language } = useLanguage()
  const { data, loading, error, reload } = useCashJson<CashReceipt>(`/api/cash/operations/${encodeURIComponent(operationKey)}/receipt`)

  useEffect(() => {
    if (!data) return
    const timer = window.setTimeout(() => window.print(), 500)
    return () => window.clearTimeout(timer)
  }, [data])

  const base = data ? currencyLabel(data.baseCurrency) : ""
  return (
    <div id="cash-receipt-print" className="fixed inset-0 z-[400] overflow-y-auto bg-white text-[#000]">
      <style>{PRINT_CSS}</style>
      <div className="no-print sticky top-0 flex justify-end gap-3 border-b border-[#e1e5eb] bg-white px-4 py-2">
        <button type="button" disabled={!data} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-[#4f70e7] px-3 py-1.5 text-[14px] font-semibold text-[#4f70e7] disabled:opacity-40">
          <Printer className="h-4 w-4" /> {t("Печать")}
        </button>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
          <X className="h-5 w-5" />
        </button>
      </div>
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock error={error} onRetry={reload} />}
      {data && (
        <div className="mx-auto max-w-[800px] px-6 py-8 text-[14px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-black pb-3">
            <h1 className="text-[22px] font-bold">
              {t("Квитанция")} № {data.docNo}
            </h1>
            <span>
              {t("Добавлено")}: {formatCashDate(data.createdAt, language)}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
            <p>
              <b>{t("Касса")}:</b> {data.cashbox}
            </p>
            <p>
              <b>{t("Организация")}:</b> {data.organization || "—"}
            </p>
            <p>
              <b>{t("Дата")}:</b> {formatCashDate(data.date, language, false)}
            </p>
            <p>
              <b>{t("Категория")}:</b> {data.category ? t(data.category) : "—"}
            </p>
          </div>
          <table className="mt-6 w-full border-collapse text-[14px]">
            <thead>
              <tr>
                <th className="border border-black px-2 py-1.5 text-left">№</th>
                <th className="border border-black px-2 py-1.5 text-left">{t("Наименование")}</th>
                <th className="border border-black px-2 py-1.5 text-right">{t("Сумма")}</th>
                <th className="border border-black px-2 py-1.5 text-right">{t("Курс")}</th>
                <th className="border border-black px-2 py-1.5 text-right">
                  {t("В основной валюте")} ({base})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.n}>
                  <td className="border border-black px-2 py-1.5">{row.n}</td>
                  <td className="border border-black px-2 py-1.5">{row.name || t(data.title)}</td>
                  <td className="border border-black px-2 py-1.5 text-right whitespace-nowrap">
                    {formatMoney(row.amount, 3)} {currencyLabel(row.currency)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right">{row.rate !== null ? formatMoney(row.rate, 5) : "—"}</td>
                  <td className="border border-black px-2 py-1.5 text-right whitespace-nowrap">{row.baseAmount !== null ? formatMoney(row.baseAmount, 3) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-right text-[16px] font-bold">
            {t("Итого")}: {data.total !== null ? `${formatMoney(data.total, 3)} ${base}` : "—"}
          </p>
          <div className="mt-12 grid grid-cols-2 gap-8">
            <p>{t("Подпись")}: ______________________</p>
            <p>{t("Подпись")}: ______________________</p>
          </div>
        </div>
      )}
    </div>
  )
}
