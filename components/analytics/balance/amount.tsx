"use client"

import { formatMoney } from "@/lib/finance/currency"

// Signed money as the demo balance pages show it: 0 is a bare "0" (no
// currency), positive green, negative red. Table cells and summary cards use
// slightly different greens/reds in the demo.

export const BALANCE_COLORS = {
  table: { positive: "#8acb8d", negative: "#e57373" },
  card: { positive: "#48a34b", negative: "#E27676" },
} as const

export function balanceColor(value: number, variant: keyof typeof BALANCE_COLORS = "table"): string | undefined {
  if (value > 0) return BALANCE_COLORS[variant].positive
  if (value < 0) return BALANCE_COLORS[variant].negative
  return undefined
}

export function BalanceAmount({
  value,
  currency,
  variant = "table",
  digits = 2,
  className = "",
}: {
  value: number
  /** Currency label appended after non-zero amounts ("1 000 SUM"). */
  currency?: string
  variant?: keyof typeof BALANCE_COLORS
  /** Max fraction digits (van-sell/employee pages show up to 3). */
  digits?: number
  className?: string
}) {
  if (!value) return <span className={className}>0</span>
  return (
    <span className={`whitespace-nowrap font-semibold ${className}`} style={{ color: balanceColor(value, variant) }}>
      {formatMoney(value, digits)}
      {currency ? ` ${currency}` : ""}
    </span>
  )
}
