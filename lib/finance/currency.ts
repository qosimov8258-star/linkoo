// Currency helpers shared by the finance server code and the balance UI.
// Money rows spell currencies inconsistently (SUM/sum/UZS, USD/usd,
// EUR/eur/euro/Euro), so everything is normalised to one canonical code.

import type { CurrencyBalance, FinanceCurrency } from "@/lib/finance/types"

const ALIASES: Record<string, string> = {
  SUM: "SUM",
  UZS: "SUM",
  "СУМ": "SUM",
  "СЎМ": "SUM",
  "SO'M": "SUM",
  SOM: "SUM",
  USD: "USD",
  $: "USD",
  EUR: "EUR",
  EURO: "EUR",
  "€": "EUR",
  "ЕВРО": "EUR",
  RUB: "RUB",
  RUR: "RUB",
  "РУБ": "RUB",
}

/** Canonical currency code ("sum" → "SUM", "Euro" → "EUR"); `fallback` for empty input.
 * Keep in sync with the SQL function fin_cur() in lib/finance/schema.ts. */
export function normCurrency(value: string | null | undefined, fallback = "SUM"): string {
  const code = String(value ?? "").trim().toUpperCase()
  if (!code) return fallback
  return ALIASES[code] ?? code
}

/** Label the demo prints next to amounts: SUM, USD, Euro. */
export function currencyLabel(code: string): string {
  const canonical = normCurrency(code)
  return canonical === "EUR" ? "Euro" : canonical
}

/** Lower-case code used by the older *_balance_transactions ledgers (sum/usd/eur). */
export function ledgerCurrency(code: string): string {
  return normCurrency(code).toLowerCase()
}

/** Demo rule (module 154): show only currencies that have a non-zero value in
 * any field of `totals`; if every currency is all-zero, keep only the first. */
export function visibleCurrencyCodes(currencies: Pick<FinanceCurrency, "code">[], totals: Record<string, CurrencyBalance | Record<string, number> | undefined>): string[] {
  const used = currencies
    .map((currency) => currency.code)
    .filter((code) => Object.values(totals[code] ?? {}).some((value) => typeof value === "number" && Math.abs(value) > 1e-9))
  if (used.length) return used
  return currencies.length ? [currencies[0].code] : []
}

/** Rounds away float noise (amount columns are REAL in Postgres). */
export function roundMoney(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** "1 234 567,5" (ru-RU grouping, up to `maxDigits` decimals, no currency). */
export function formatMoney(value: number, maxDigits = 2): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: maxDigits }).format(roundMoney(value, maxDigits))
}

/** Converts `amount` of `from` into `to` with current rates (units of base per unit). null when a rate is unknown. */
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number | null | undefined>): number | null {
  if (normCurrency(from) === normCurrency(to)) return amount
  const fromRate = rates[normCurrency(from)]
  const toRate = rates[normCurrency(to)]
  if (!fromRate || !toRate) return null
  return (amount * fromRate) / toRate
}
