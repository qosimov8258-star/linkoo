// Rate math shared by the cash core and the cash dialogs (isomorphic).
// A "rate" here is always base-currency units per 1 unit of a currency (the
// currencies.rate convention, demo "1 USD = 12 500 SUM"); the base currency's
// rate is 1. Equivalent of the demo's finance/convert + helper module 0422.

import { normCurrency, roundMoney } from "@/lib/finance/currency"

export type RateMap = Record<string, number | null | undefined>

/** Base units per 1 unit of `code` (1 for the base currency); null = unknown. */
export function rateOf(code: string, rates: RateMap, base: string): number | null {
  const canonical = normCurrency(code, base)
  if (canonical === normCurrency(base)) return 1
  const rate = rates[canonical]
  return rate && rate > 0 ? rate : null
}

/** Converts through the base currency; null when a rate is missing. */
export function convertWithRates(amount: number, fromRate: number | null, toRate: number | null): number | null {
  if (!fromRate || !toRate) return null
  return (amount * fromRate) / toRate
}

/** Amount in `to` for `amount` of `from` with explicit or table rates. */
export function convertMoney(
  amount: number,
  from: string,
  to: string,
  rates: RateMap,
  base: string,
  overrides: { fromRate?: number | null; toRate?: number | null } = {},
): number | null {
  if (normCurrency(from, base) === normCurrency(to, base)) return amount
  const fromRate = overrides.fromRate && overrides.fromRate > 0 ? overrides.fromRate : rateOf(from, rates, base)
  const toRate = overrides.toRate && overrides.toRate > 0 ? overrides.toRate : rateOf(to, rates, base)
  return convertWithRates(amount, fromRate, toRate)
}

/**
 * Amount received by the target cashbox of a transfer ("Перевод"):
 * - same currency + percentage (cash ↔ bank "Процент"): amountFrom × percentage / 100;
 * - same currency otherwise: amountFrom;
 * - different currencies, `rate` as the demo's "Курс" field:
 *   target is the base currency → amountFrom × rate (rate = base per 1 source unit);
 *   source is the base currency → amountFrom ÷ rate (rate = base per 1 target unit);
 *   neither is base → amountFrom × rate (rate = target units per 1 source unit).
 *   Without `rate` the current table rates are used.
 * Returns null when a needed rate is unknown.
 */
export function transferAmountTo(params: {
  amountFrom: number
  fromCurrency: string
  toCurrency: string
  baseCurrency: string
  rates: RateMap
  rate?: number | null
  percentage?: number | null
}): { amountTo: number | null; rate: number | null } {
  const base = normCurrency(params.baseCurrency)
  const from = normCurrency(params.fromCurrency, base)
  const to = normCurrency(params.toCurrency, base)
  if (from === to) {
    const pct = params.percentage && params.percentage > 0 ? params.percentage : 100
    return { amountTo: roundMoney((params.amountFrom * pct) / 100, 5), rate: null }
  }
  let rate = params.rate && params.rate > 0 ? params.rate : null
  if (!rate) {
    const fromRate = rateOf(from, params.rates, base)
    const toRate = rateOf(to, params.rates, base)
    if (to === base) rate = fromRate
    else if (from === base) rate = toRate
    else rate = fromRate && toRate ? fromRate / toRate : null
  }
  if (!rate) return { amountTo: null, rate: null }
  const amountTo = from === base ? params.amountFrom / rate : params.amountFrom * rate
  return { amountTo: roundMoney(amountTo, 5), rate }
}
