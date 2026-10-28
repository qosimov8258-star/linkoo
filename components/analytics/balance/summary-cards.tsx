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
  hideCurrency = false,
  marginClass = "mx-[30px]",
  plain = false,
  compact = false,
  neutral = false,
  gapped = false,
}: {
  boxes: SummaryBox[]
  /** BalanceListResult.totals or StatementResult.summary. */
  totals: Record<string, CurrencyBalance>
  /** Codes to show, usually BalanceListResult.visibleCurrencies. */
  currencies: string[]
  digits?: number
  loading?: boolean
  /** The reference shows bare numbers (no currency names) on some pages, e.g. supplier balance. */
  hideCurrency?: boolean
  /** Horizontal margin of the cards box (30px on most pages, 10px on "Баланс филиалов"). */
  marginClass?: string
  /** Reference "Сверка" look: grey 13px title, 14px values on a 30px pitch, no bold. */
  plain?: boolean
  /** The reference balance pages: 13px grey title, 14px semibold values on a 20px pitch. */
  compact?: boolean
  /** Black values whatever the sign (the supplier debts report). */
  neutral?: boolean
  /** Separate white cards with a gap instead of one bordered box. */
  gapped?: boolean
}) {
  const { t } = useLanguage()
  const columns = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[Math.min(5, boxes.length) as 1 | 2 | 3 | 4 | 5]
  // Reference order of the lines: Euro, SUM, USD (alphabetical by label).
  const lines = [...currencies].sort((a, b) => currencyLabel(a).localeCompare(currencyLabel(b)))
  return (
    <section className={`${marginClass} ${gapped ? "mb-[10px] -mt-px" : compact ? "mb-[10px] mt-[5px]" : "my-[10px]"} grid grid-cols-1 sm:grid-cols-2 ${gapped ? "gap-x-[16px]" : "border border-[#efefef] bg-white"} ${columns} ${loading ? "opacity-60" : ""}`}>
      {boxes.map((box, boxIndex) => (
        <div key={boxIndex} className={`flex flex-col ${compact ? "gap-[10.75px] px-[16px] pb-[9px] pt-[11px]" : plain ? "gap-[10px] px-[16px] py-[10px]" : "gap-[10px] px-[15px] py-[10px]"} border-[#efefef] ${gapped ? "border bg-white" : "lg:border-r lg:last:border-r-0"} ${box.align === "right" ? "lg:items-end lg:text-right" : ""}`}>
          {box.metrics.map((metric) => {
            const content = (
              <>
                <p className={`flex items-center gap-1 text-[13px] ${compact ? "mb-[5px] font-normal leading-[16.25px] text-[#666]" : "leading-[18px]"} ${compact ? "" : plain ? "mb-[4px] font-normal text-[#666]" : "font-medium text-[#333]"}`}>
                  {t(metric.label)}
                  {metric.hint}
                </p>
                {lines.map((code) => {
                  const balance = totals[code]
                  const value = balance ? (metric.value ? metric.value(balance) : (balance[metric.field] ?? 0)) : 0
                  return (
                    <p key={code} className={compact ? "text-[14px] font-semibold leading-[20px] text-black" : plain ? "text-[14px] font-normal leading-[30px]" : "text-[16px] font-semibold leading-[20px] text-[#333]"} style={{ color: neutral ? "#000" : balanceColor(value, "card") }}>
                      {formatMoney(value, digits)}{hideCurrency ? "" : ` ${currencyLabel(code)}`}
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
