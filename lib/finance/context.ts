import "server-only"

import { storedAppCurrency } from "@/lib/app-currency"
import type { PgDb } from "@/lib/db"
import { convertAmount, currencyLabel, normCurrency, setCurrencyNames } from "@/lib/finance/currency"
import type { FinanceCurrency } from "@/lib/finance/types"

export type CurrencyContext = {
  base: string
  /** The currencies the app works in: every currency of Валюты, or only the app currency when one is chosen. */
  currencies: FinanceCurrency[]
  /** Every currency of Валюты (rates of stored documents in other currencies). */
  all: FinanceCurrency[]
  /** Units of base per 1 unit; base = 1; null = unknown. Every currency of Валюты, also with an app currency. */
  rates: Record<string, number | null>
  /** The app currency of Настройки → Валюта приложения ('' = all). When set, `currencies` holds only it
   * and amounts of other currencies are shown converted into it (toWork). */
  work: string
}

/** `amount` of `currency` in the app currency (unchanged when there is none); null when a rate is unknown. */
export function toWork(ctx: CurrencyContext, amount: number, currency: string): number | null {
  if (!ctx.work) return amount
  return convertAmount(amount, currency || ctx.base, ctx.work, ctx.rates)
}

/** Reports kept in the base currency (P&L, stock value, management totals): the currency they are
 * shown in (the app currency when one is chosen) and the factor a base amount is multiplied by. */
export function baseReportCurrency(ctx: CurrencyContext): { code: string; factor: number } {
  const rate = ctx.work ? ctx.rates[ctx.work] : null
  return ctx.work && rate ? { code: ctx.work, factor: 1 / rate } : { code: ctx.base, factor: 1 }
}

/** Amounts per currency in the app currency: one entry (the sum of the converted amounts; a currency without a
 * rate counts 0) when one is chosen, the list as it is without one. */
export function foldToWork<T extends { currency: string }>(ctx: CurrencyContext, list: T[], amountOf: (item: T) => number, make: (currency: string, amount: number) => T): T[] {
  if (!ctx.work) return list
  if (!list.length) return list
  const total = list.reduce((sum, item) => sum + (toWork(ctx, amountOf(item), item.currency) ?? 0), 0)
  return [make(ctx.work, total)]
}

/** SQL factor that turns an amount of the currency `curExpr` (a canonical code, fin_cur) into the app currency
 * (current rates inlined as numbers; 0 for a currency without a rate). Only meaningful when `ctx.work` is set. */
export function workFactorSql(ctx: CurrencyContext, curExpr: string): string {
  const workRate = ctx.work ? ctx.rates[ctx.work] : null
  if (!workRate) return "1"
  const cases = Object.entries(ctx.rates)
    .filter(([code, rate]) => /^[A-Z0-9$€]{1,12}$/u.test(code) && rate)
    .map(([code, rate]) => `WHEN '${code}' THEN ${Number(rate) / workRate}`)
  return `(CASE ${curExpr} ${cases.join(" ")} ELSE 0 END)::float8`
}

/** Canonical code of a list's "Валюта" filter, '' = no filter. With an app currency every row is shown in it:
 * filtering by it keeps every row. */
export function currencyFilter(ctx: Pick<CurrencyContext, "base" | "work">, requested: string | null | undefined): string {
  if (!String(requested ?? "").trim()) return ""
  const code = normCurrency(requested, ctx.base)
  return ctx.work && code === ctx.work ? "" : code
}

type CurrencyRow = { id: number; name: string; code: string; rate: number | null; is_base: number }

/** Currencies from the currencies table (canonical codes, base first, then by
 * id). With an empty table (a fresh install before its first currency) the list
 * is empty: SUM is only the internal unit (`base`, rate 1), not a listed currency,
 * so every money write is refused with "Валюта не найдена" until the first
 * currency is created — that one becomes the base (lib/currencies-repo.ts). */
export async function loadCurrencyContext(db: PgDb): Promise<CurrencyContext> {
  const rows = (await db.prepare("SELECT id, name, code, rate, is_base FROM currencies ORDER BY is_base DESC, id").all()) as CurrencyRow[]
  // The names of Валюты are the names every screen prints (currencyLabel, lib/finance/currency.ts).
  setCurrencyNames(rows)
  const currencies: FinanceCurrency[] = []
  for (const row of rows) {
    const code = normCurrency(row.code)
    if (currencies.some((currency) => currency.code === code)) continue
    currencies.push({ code, label: currencyLabel(code), name: row.name, rate: row.rate ? Number(row.rate) : null, isBase: Boolean(row.is_base), id: row.id })
  }
  if (!currencies.length) return { base: "SUM", currencies: [], all: [], rates: { SUM: 1 }, work: "" }
  let base = currencies.find((currency) => currency.isBase)
  if (!base) {
    base = currencies.find((currency) => currency.code === "SUM") ?? currencies[0]
    base.isBase = true
  }
  base.rate = 1
  const rates = Object.fromEntries(currencies.map((currency) => [currency.code, currency.rate]))
  // Настройки → Валюта приложения: a stored code no longer in Валюты counts as none (lib/app-currency.ts).
  const stored = await storedAppCurrency(db)
  const work = stored && currencies.some((currency) => currency.code === stored) ? stored : ""
  const listed = work ? currencies.filter((currency) => currency.code === work) : currencies
  return { base: base.code, currencies: listed, all: currencies, rates, work }
}

/** Appends codes found in money rows that the currencies table lacks. */
export function withSeenCodes(ctx: CurrencyContext, codes: Iterable<string>): CurrencyContext {
  // With an app currency the money rows are converted into it: no other code is listed.
  if (ctx.work) return ctx
  const known = new Set(ctx.currencies.map((currency) => currency.code))
  const extra = [...new Set(codes)].filter((code) => code && !known.has(code)).sort()
  if (!extra.length) return ctx
  const seen = extra.map((code) => ({ code, label: currencyLabel(code), name: code, rate: null, isBase: false, id: null }))
  const currencies = [...ctx.currencies, ...seen]
  return { ...ctx, currencies, all: [...ctx.all, ...seen], rates: { ...ctx.rates, ...Object.fromEntries(extra.map((code) => [code, null])) } }
}

/** Canonical code of `value` when it is a currency of the currencies table,
 * else null (always null while the table is empty) — the check every money
 * write does before storing a currency ("Валюта не найдена"). */
export async function resolveCurrencyCode(db: PgDb, value: string | null | undefined): Promise<string | null> {
  if (!String(value ?? "").trim()) return null
  const code = normCurrency(value)
  const context = await loadCurrencyContext(db)
  return context.currencies.some((currency) => currency.code === code) ? code : null
}
