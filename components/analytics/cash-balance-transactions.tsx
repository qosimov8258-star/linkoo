"use client"

import { Banknote, CreditCard } from "lucide-react"

import { OperationDetails, type DetailsPopup } from "@/components/analytics/cash-management-details"
import { CASH_GREEN, CASH_RED, formatCash } from "@/components/analytics/cash-management-shared"
import { formatMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { CashOperation } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Транзакции (<касса>)" rows of the cash balance detail (demo TransactionGridList with isCashbox): № | Дата | Создал |
// Описание | Сумма in the reference's 1 / 3 / 2 / 2 / 4 columns. Описание = TransactionsFormat without the
// organization, then the «Клиент:» / «Поставщик:» lines; Сумма = the amount with the payment-type icon and, for another
// currency, the base amount with its rate.

type Translate = (text: string) => string

/** Plain-text Описание (Excel export). */
export function cashOperationText(row: CashOperation, t: Translate): string {
  const parts = [`${t("Описание")}: ${t(row.title)}`]
  if (row.category?.name) parts.push(`${t("Категория")}: ${row.category.name}`)
  if (row.branch) parts.push(`${t("Филиал")}: ${row.branch}`)
  if (row.transfer?.accumulatedFrom || row.transfer?.accumulatedTo) parts.push(`${t("Деньги за период")}: ${row.transfer.accumulatedFrom} — ${row.transfer.accumulatedTo}`)
  if (row.comment) parts.push(`${t("Комментарий")}: ${row.comment}`)
  if (row.client?.name) parts.push(`${t("Клиент")}: ${row.client.name}`)
  if (row.type !== 10 && row.supplier?.name) parts.push(`${t("Поставщик")}: ${row.supplier.name}`)
  return parts.join(", ")
}

function PaymentTypeIcon({ bank }: { bank: boolean }) {
  const { t } = useLanguage()
  const label = bank ? t("банковский счет") : t("наличные")
  return (
    <span title={label} aria-label={label} className="inline-flex shrink-0">
      {bank ? <CreditCard className="h-[18px] w-[18px] text-[#6261b0]" /> : <Banknote className="h-[18px] w-[18px] text-[#1E4A9A]" />}
    </span>
  )
}

const GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,4fr)] gap-x-4"

export function CashTransactionsTable({ rows, loading, onPopup }: { rows: CashOperation[]; loading: boolean; onPopup?: (popup: DetailsPopup) => void }) {
  const { t, language } = useLanguage()
  return (
    <div className={`overflow-x-auto pb-10 ${loading ? "opacity-60" : ""}`}>
      <div className="min-w-[900px]">
        <div className={`${GRID} -mx-[32px] min-h-[50px] items-center border-b border-dotted border-[#dde1e5] px-[32px] py-[5px] font-semibold text-[#666]`}>
          <span>{t("№")}</span>
          <span>{t("Дата")}</span>
          <span>{t("Создал")}</span>
          <span>{t("Описание")}</span>
          <span className="text-right">{t("Сумма")}</span>
        </div>
        {rows.map((row) => {
          const color = row.amount > 0 ? CASH_GREEN : row.amount < 0 ? CASH_RED : undefined
          const foreign = row.currency !== row.baseCurrency && row.baseAmount !== null
          return (
            <div key={row.key} className={`${GRID} -mx-[32px] min-h-[50px] items-center border-b border-dotted border-[#dde1e5] px-[32px] py-[5px] hover:bg-[#f2f5f8]`}>
              <span>{row.docNo}</span>
              <span className="whitespace-nowrap">{formatStatementDate(row.date, language)}</span>
              <span className="break-words">{row.createdBy}</span>
              <div className="min-w-0 break-words">
                <OperationDetails operation={row} showCashbox={false} cashbox onPopup={onPopup} />
              </div>
              <div className="text-right font-semibold" style={{ color }}>
                <div className="flex items-center justify-end gap-[5px] whitespace-nowrap">
                  <span>{formatCash(row.amount, row.currency)}</span>
                  <PaymentTypeIcon bank={row.cashbox.type === "bank"} />
                </div>
                {foreign && (
                  <div className="whitespace-nowrap">
                    {formatCash(row.baseAmount ?? 0, row.baseCurrency)}{" "}
                    {row.rate ? <span className="text-[11px] font-semibold text-[#666]">({formatMoney(row.rate, 3)})</span> : null}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
