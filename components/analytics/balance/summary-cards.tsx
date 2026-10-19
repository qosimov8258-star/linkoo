"use client"

import type { ReactNode } from "react"

import { balanceColor } from "@/components/analytics/balance/amount"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import type { CurrencyBalance } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Per-currency summary boxes of the balance pages (demo module 2344 / 3903):
// a grid of boxes, each with one or more metrics; every metric lists one
// line per visible currency ("1 234 SUM"), coloured by sign.

export type SummaryMetric = {
  /** Russian label (translated here). */
  label: string
  /** CurrencyBalance field, e.g. "begin_balance", "order". */
  field: string
  /** Optional custom value (e.g. cash + bank) instead of `field`. */
  value?: (balance: CurrencyBalance) => number
  /** Optional element after the label (e.g. an info tooltip). */
  hint?: ReactNode
  /** Clickable metric (cash detail type filter); `active` highlights it. */
  onClick?: () => void
  active?: boolean
}

export type SummaryBox = { metrics: SummaryMetric[]; align?: "left" | "right" }

export function BalanceSummaryCards({
  boxes,
  totals,
  currencies,
  digits = 2,
  loading = false,
}: {
  boxes: SummaryBox[]
  /** BalanceListResult.totals or StatementResult.summary. */
  totals: Record<string, CurrencyBalance>
  /** Codes to show, usually BalanceListResult.visibleCurrencies. */
  currencies: string[]
  digits?: number
  loading?: boolean
}) {
  const { t } = useLanguage()
  const columns = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[Math.min(5, boxes.length) as 1 | 2 | 3 | 4 | 5]
  return (
    <section className={`grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2 md:px-9 ${columns} ${loading ? "opacity-60" : ""}`}>
      {boxes.map((box, boxIndex) => (
        <div key={boxIndex} className={`flex flex-col gap-4 ${box.align === "right" ? "lg:items-end lg:text-right" : ""}`}>
          {box.metrics.map((metric) => {
            const content = (
              <>
                <p className="flex items-center gap-1 text-[#586174]">
                  {t(metric.label)}
                  {metric.hint}
                </p>
                {currencies.map((code) => {
                  const balance = totals[code]
                  const value = balance ? (metric.value ? metric.value(balance) : (balance[metric.field] ?? 0)) : 0
                  return (
                    <p key={code} className="font-semibold text-[#17233b]">
                      <span style={{ color: balanceColor(value, "card") }}>{formatMoney(value, digits)}</span> {currencyLabel(code)}
                    </p>
                  )
                })}
              </>
            )
            return metric.onClick ? (
              <button
                key={metric.field + metric.label}
                type="button"
                onClick={metric.onClick}
                className={`rounded-md px-2 py-1 text-left transition-colors hover:bg-[#f2f5f8] ${metric.active ? "bg-[#f2f5f8]" : ""}`}
              >
                {content}
              </button>
            ) : (
              <div key={metric.field + metric.label}>{content}</div>
            )
          })}
        </div>
      ))}
    </section>
  )
}
