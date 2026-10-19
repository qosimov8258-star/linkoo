"use client"

import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import type { CurrencyBalance } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Summary cards of "Баланс кассы" (demo module of the cashbox statistics):
// 4 equal columns — [Баланс на начало периода] [Приход / Расход за период]
// [Перевод на кассу / Перевод с кассы] [Баланс на конец периода, right
// aligned]. Every metric is its own bordered box with one "<amount> <currency>"
// line per currency. Unlike the other balance pages the colour is fixed per
// metric, not by sign: incomes green, expenses red, begin/end plain. In the
// detail the four movement boxes are clickable (type filter, active #f2f5f8).

type Metric = { label: string; field: string; color?: string }

const GREEN = "#8acb8d"
const RED = "#e57373"

const COLUMNS: Metric[][] = [
  [{ label: "Баланс на начало периода", field: "begin_balance" }],
  [
    { label: "Приход за период", field: "income", color: GREEN },
    { label: "Расход за период", field: "expenses", color: RED },
  ],
  [
    { label: "Перевод на кассу", field: "transfer_income", color: GREEN },
    { label: "Перевод с кассы", field: "transfer_expense", color: RED },
  ],
  [{ label: "Баланс на конец периода", field: "end_balance" }],
]

export function CashBalanceSummary({
  totals,
  currencies,
  loading = false,
  activeField,
  onMetricClick,
}: {
  /** BalanceListResult.totals (list) or StatementResult.summary (detail). */
  totals: Record<string, CurrencyBalance>
  /** Currency codes, one line each. */
  currencies: string[]
  loading?: boolean
  /** Movement column of the active type filter (detail). */
  activeField?: string
  /** Detail only: click on a movement box (income / expenses / transfer_income / transfer_expense). */
  onMetricClick?: (field: string) => void
}) {
  const { t } = useLanguage()
  return (
    <section className={`grid grid-cols-1 gap-[10px] px-6 py-5 sm:grid-cols-2 md:px-9 lg:grid-cols-4 ${loading ? "opacity-60" : ""}`}>
      {COLUMNS.map((metrics, index) => (
        <div key={index} className={`flex flex-col gap-[10px] ${index === COLUMNS.length - 1 ? "lg:text-right" : ""}`}>
          {metrics.map((metric) => {
            const content = (
              <>
                <span className="block text-[13px] font-medium text-[#17233b]">{t(metric.label)}</span>
                {currencies.map((code) => (
                  <span key={code} className="block" style={metric.color ? { color: metric.color } : undefined}>
                    {formatMoney(totals[code]?.[metric.field] ?? 0)} {currencyLabel(code)}
                  </span>
                ))}
              </>
            )
            const boxClass = "rounded-[2px] border border-[#efefef] px-[15px] py-[10px] text-[16px] font-semibold text-[#17233b]"
            const clickable = Boolean(onMetricClick && metric.color)
            return clickable ? (
              <button
                key={metric.field}
                type="button"
                onClick={() => onMetricClick?.(metric.field)}
                className={`${boxClass} block w-full cursor-pointer text-left transition-colors hover:bg-[#f2f5f8] ${activeField === metric.field ? "bg-[#f2f5f8]" : ""}`}
              >
                {content}
              </button>
            ) : (
              <div key={metric.field} className={boxClass}>
                {content}
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
