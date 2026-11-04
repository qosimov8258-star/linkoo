"use client"

import { createContext, useContext, type ReactNode } from "react"

import { convertAmount, currencyLabel, normCurrency } from "@/lib/finance/currency"

// The app currency (Настройки → Валюта приложения, lib/app-currency.ts) for client components:
// read once by the root layout. `code` '' = every currency; `rates` = units of the base currency
// per unit of every currency of Валюты (base = 1), to show stored amounts in the app currency.
export type AppCurrencyInfo = { code: string; rates: Record<string, number | null> }

const AppCurrencyContext = createContext<AppCurrencyInfo>({ code: "", rates: {} })

export function AppCurrencyProvider({ value, children }: { value: AppCurrencyInfo; children: ReactNode }) {
  return <AppCurrencyContext.Provider value={value}>{children}</AppCurrencyContext.Provider>
}

/** Canonical code of the app currency, or '' when every currency is used. */
export function useAppCurrency(): string {
  return useContext(AppCurrencyContext).code
}

export function useAppCurrencyInfo(): AppCurrencyInfo {
  return useContext(AppCurrencyContext)
}

/** `codes` reduced to the app currency (any spelling: SUM / sum / SOM); all of them without one. */
export function onlyAppCurrency<T extends string>(codes: readonly T[], work: string): T[] {
  if (!work) return [...codes]
  const kept = codes.filter((code) => normCurrency(code) === work)
  return kept.length ? kept : ([work] as T[])
}

/** `amount` of `currency` in the app currency (as it is without one); null when a rate is unknown. */
export function inAppCurrency(info: AppCurrencyInfo, amount: number, currency: string): number | null {
  if (!info.code) return amount
  return convertAmount(amount, currency, info.code, info.rates)
}

/** Amounts per currency folded into one amount of the app currency (unchanged without one). */
export function foldToAppCurrency<T extends { currency: string; amount: number }>(info: AppCurrencyInfo, parts: T[]): Array<{ currency: string; amount: number }> {
  if (!info.code) return parts
  let total = 0
  for (const part of parts) total += inAppCurrency(info, part.amount, part.currency) ?? 0
  return [{ currency: info.code, amount: total }]
}

/** Order lines in the app currency (unit price and line total converted with the current rates; a line
 * whose rate is unknown counts 0); the lines as they are without one. */
export function linesInAppCurrency<T extends { currency: string; unitPrice: number; lineTotal: number }>(info: AppCurrencyInfo, lines: T[]): T[] {
  if (!info.code) return lines
  return lines.map((line) => ({
    ...line,
    currency: info.code,
    unitPrice: inAppCurrency(info, line.unitPrice, line.currency) ?? 0,
    lineTotal: inAppCurrency(info, line.lineTotal, line.currency) ?? 0,
  }))
}

/** A report-builder column named after the base currency ("Сумма заказов, SUM", the reference's name) carries the
 * app currency instead when one is set: its amounts are in it then. */
export function appCurrencyColumn(column: string, t: (text: string) => string, work: string): string {
  return work && column.endsWith(", SUM") ? `${t(column.slice(0, -", SUM".length))}, ${currencyLabel(work)}` : t(column)
}
