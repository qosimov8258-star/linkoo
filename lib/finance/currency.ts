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

/** Canonical currency code ("sum" → "SUM", "Euro" → "EUR"); `fallback` for empty input. A name given on
 * Валюты (setCurrencyNames) is read back as its currency's code too ("Dollar" → "USD").
 * Keep in sync with the SQL function fin_cur() in lib/finance/schema.ts (stored codes only). */
export function normCurrency(value: string | null | undefined, fallback = "SUM"): string {
  const code = String(value ?? "").trim().toUpperCase()
  if (!code) return fallback
  return ALIASES[code] ?? namedCodes[code] ?? code
}

/** Shown names of the canonical codes while Валюты gives none (the user's decision of 2026-11-04: SOM, USD,
 * ЕВРО instead of the demo's SUM / Euro). Stored codes stay SUM / EUR; both names are aliases above. */
const DEFAULT_LABELS: Record<string, string> = { SUM: "SOM", EUR: "ЕВРО" }

/** The names of Валюты ("Наименование", editable for every currency, the base one too), by canonical code:
 * what the user wrote there is what every screen prints. Set from the currencies table on the server
 * (lib/finance/context.ts loadCurrencyContext) and in the browser by the root layout
 * (lib/app-currency-context.tsx AppCurrencyProvider). */
let customLabels: Record<string, string> = {}
/** Upper-cased custom name → canonical code (normCurrency reads names back). */
let namedCodes: Record<string, string> = {}
let namesPattern: RegExp | null = null

/** Takes the names of Валюты (`code` → `name`, or the rows themselves). Empty names keep the default. */
export function setCurrencyNames(names: Record<string, string> | ReadonlyArray<{ code: string; name: string }>): void {
  const entries: Array<readonly [string, string]> = Array.isArray(names)
    ? (names as ReadonlyArray<{ code: string; name: string }>).map((row) => [row.code, row.name] as const)
    : Object.entries(names as Record<string, string>)
  const next: Record<string, string> = {}
  for (const [code, name] of entries) {
    const canonical = ALIASES[String(code ?? "").trim().toUpperCase()] ?? String(code ?? "").trim().toUpperCase()
    const label = String(name ?? "").replace(/\s+/g, " ").trim()
    if (canonical && label && !(canonical in next)) next[canonical] = label
  }
  if (JSON.stringify(next) === JSON.stringify(customLabels)) return
  customLabels = next
  namedCodes = {}
  for (const [code, label] of Object.entries(next)) {
    const key = label.toUpperCase()
    if (!(key in ALIASES) && !(key in namedCodes)) namedCodes[key] = code
  }
  namesPattern = null
}

/** The names set from Валюты (canonical code → name). */
export function currencyNames(): Record<string, string> {
  return customLabels
}

/** Label printed next to amounts and in currency selects: the name of Валюты (SOM, USD, ЕВРО by default). */
export function currencyLabel(code: string): string {
  const canonical = normCurrency(code)
  return customLabels[canonical] ?? DEFAULT_LABELS[canonical] ?? canonical
}

/** Linko lists currencies by its own names (Euro, SUM, USD): the codes in alphabetical order. The labels shown here
 *  (SOM, USD, ЕВРО, or a name set in Валюты) sort differently, so every list that follows Linko compares the codes. */
export function compareCurrencyCodes(a: string, b: string): number {
  return normCurrency(a).localeCompare(normCurrency(b), "en")
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Stored codes and spellings printed as they are (amount strings like "1 000 SUM", "Сумма (SUM)" literals,
 * option texts), the default shown names (SOM, ЕВРО) and every code of Валюты. Whole words only and
 * case-sensitive, so "SUMMARY" or "sum" are untouched. */
function storedNames(): RegExp {
  if (namesPattern) return namesPattern
  const words = new Set(["SUM", "SOM", "USD", "EURO", "EUR", "Euro", "ЕВРО", ...Object.keys(customLabels)])
  const alternatives = [...words].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")
  namesPattern = new RegExp(`(?<![\\p{L}\\p{N}_'’])(${alternatives})(?![\\p{L}\\p{N}_'’])`, "gu")
  return namesPattern
}

/** Text with the stored currency names replaced by the shown ones of Валюты ("100 SUM" → "100 SOM",
 * "Euro" → "ЕВРО", or the names the user gave). `euro` is the euro's name in the UI language (the dictionary's
 * entry for the euro's name: EVRO, EURO …). Used by the DOM pass of lib/i18n/dom-translator.tsx for every
 * screen and by the Excel export. */
export function showCurrencyNames(text: string, euro = currencyLabel("EUR")): string {
  const pattern = storedNames()
  pattern.lastIndex = 0
  if (!pattern.test(text)) return text
  pattern.lastIndex = 0
  return text.replace(pattern, (name) => (normCurrency(name) === "EUR" ? euro : currencyLabel(name)))
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

/** The currencies that have an amount to show in `fields` (the columns a table or a summary prints), in the order of
 * the currency list: non-zero in one of `sources` (totals, rows). Unlike visibleCurrencyCodes it does not look at
 * the fields that are not printed, so a currency whose only amounts are elsewhere (a money request in EUR on the
 * balance tab) gets no column of zeros. Never empty: with nothing to show, the first currency. */
export function currenciesWithAmounts(
  currencies: Pick<FinanceCurrency, "code">[],
  fields: readonly string[],
  sources: Array<Record<string, CurrencyBalance | Record<string, number> | undefined> | undefined>,
): string[] {
  const used = currencies
    .map((currency) => currency.code)
    .filter((code) =>
      sources.some((source) => {
        const balance = source?.[code] as Record<string, unknown> | undefined
        return !!balance && fields.some((field) => typeof balance[field] === "number" && Math.abs(balance[field] as number) > 1e-9)
      }),
    )
  if (used.length) return used
  return currencies.length ? [currencies[0].code] : []
}

/** Rounds away float noise. Three decimals by default, like the reference's amounts (7 079 026,149). */
export function roundMoney(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** "1 234 567,5" (ru-RU grouping, up to `maxDigits` decimals, no currency). The reference shows up to three decimals. */
export function formatMoney(value: number, maxDigits = 3): string {
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
