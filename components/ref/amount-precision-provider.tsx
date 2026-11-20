"use client"

import type { ReactNode } from "react"

import { setAmountPrecision, type AmountPrecision } from "@/lib/amount-precision"

// Настройки → Округление сумм for the browser (and the server render of client components): the root layout reads
// the setting and passes it here. Set while rendering, before any child prints an amount (formatMoney); saving the
// setting reloads the page, which brings the new value.
export function AmountPrecisionProvider({ value, children }: { value: AmountPrecision; children: ReactNode }) {
  setAmountPrecision(value)
  return <>{children}</>
}
