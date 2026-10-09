"use client"

import { Loader2, X } from "lucide-react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { supplierPaymentTitle, type SupplyPaymentsResult } from "@/components/analytics/supplier-payments-data"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Supply card «Оплачено» link → "Список оплат по поставке №N" (demo main.js
// @7249349, finance/provider_debt_separations/?supply=N): the verified supplier
// payments linked to the supply (cash page «Расход» with the supply), with the
// amount credited and the part counted for the supply in its currency.

export function SupplyPaymentsDialog({ supplyId, onClose }: { supplyId: number; onClose: () => void }) {
  const { t, language } = useLanguage()
  const { data, loading, error, reload } = useCashJson<SupplyPaymentsResult>(`/api/supplier-incomings/${supplyId}/payments`)
  const rows = data?.rows ?? []
  const base = data?.baseCurrency ?? "SUM"
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-2 py-6 md:py-10" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[960px] rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[#e1e5eb] px-4 py-4 md:px-6">
          <h2 className="text-[16px] font-bold uppercase text-[#17233b] md:text-lg">
            {t("Список оплат по поставке")} №{supplyId}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading && !data ? (
          <div className="flex h-[160px] items-center justify-center text-[#9aa3b6]">
            <Loader2 className="h-6 w-6 animate-spin" aria-label={t("Загрузка...")} />
          </div>
        ) : error && !data ? (
          <div className="flex flex-wrap items-center gap-3 px-6 py-8 text-sm text-[#c94848]">
            <span>
              {t("Не удалось загрузить данные")}: {t(error)}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        ) : !rows.length ? (
          <p className="px-6 py-12 text-center text-[#9aa3b6]">{t("По данной поставке еще не произведено оплат")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[14px]">
              <thead className="bg-[#f2f5f8] text-left text-[#586174]">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("Дата")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Поставщик")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Пользователь")}</th>
                  <th className="px-4 py-3 font-semibold">{t("Описание")}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t("Сумма")}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t("На поставку")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-dashed border-slate-200 align-top">
                    <td className="whitespace-nowrap px-4 py-3">{row.date ? formatStatementDate(row.date, language, true) : ""}</td>
                    <td className="px-4 py-3">{row.supplier || t("Не указано")}</td>
                    <td className="px-4 py-3">{row.createdBy || t("Неизвестно")}</td>
                    <td className="px-4 py-3">
                      <div>
                        {t(supplierPaymentTitle(row.type))}
                        {row.docNo ? ` № ${row.docNo}` : ""}
                      </div>
                      {row.comment && (
                        <div className="text-[13px] text-[#586174]">
                          {t("Комментарий")}: {row.comment}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="whitespace-nowrap font-semibold">
                        {formatMoney(row.amount, 3)} {currencyLabel(row.currency)}
                      </div>
                      {row.currency !== base && row.baseAmount !== null && (
                        <div className="whitespace-nowrap text-[11px] text-[#666]">
                          {formatMoney(row.baseAmount, 3)} {currencyLabel(base)}
                          {row.rate ? ` (${formatMoney(row.rate, 5)})` : ""}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                      {formatMoney(row.allocated, 3)} {currencyLabel(data?.supplyCurrency ?? base)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#f6f9fc] font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-right">
                    {t("Итого")}:
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {formatMoney(data?.paid ?? 0, 3)} {currencyLabel(data?.supplyCurrency ?? base)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
