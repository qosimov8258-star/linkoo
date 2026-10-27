import "server-only"

import type { PgDb } from "@/lib/db"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import type { FinanceCurrency } from "@/lib/finance/types"

export type CurrencyContext = {
  base: string
  currencies: FinanceCurrency[]
  /** Units of base per 1 unit; base = 1; null = unknown. */
  rates: Record<string, number | null>
}

type CurrencyRow = { id: number; name: string; code: string; rate: number | null; is_base: number }

/** Currencies from the currencies table (canonical codes, base first, then by
 * id). With an empty table (a fresh install before its first currency) the list
 * is empty: SUM is only the internal unit (`base`, rate 1), not a listed currency,
 * so every money write is refused with "Валюта не найдена" until the first
 * currency is created — that one becomes the base (lib/currencies-repo.ts). */
export async function loadCurrencyContext(db: PgDb): Promise<CurrencyContext> {
  const rows = (await db.prepare("SELECT id, name, code, rate, is_base FROM currencies ORDER BY is_base DESC, id").all()) as CurrencyRow[]
  const currencies: FinanceCurrency[] = []
  for (const row of rows) {
    const code = normCurrency(row.code)
    if (currencies.some((currency) => currency.code === code)) continue
    currencies.push({ code, label: currencyLabel(code), name: row.name, rate: row.rate ? Number(row.rate) : null, isBase: Boolean(row.is_base), id: row.id })
  }
  if (!currencies.length) return { base: "SUM", currencies: [], rates: { SUM: 1 } }
  let base = currencies.find((currency) => currency.isBase)
  if (!base) {
    base = currencies.find((currency) => currency.code === "SUM") ?? currencies[0]
    base.isBase = true
  }
  base.rate = 1
  return { base: base.code, currencies, rates: Object.fromEntries(currencies.map((currency) => [currency.code, currency.rate])) }
}

/** Appends codes found in money rows that the currencies table lacks. */
export function withSeenCodes(ctx: CurrencyContext, codes: Iterable<string>): CurrencyContext {
  const known = new Set(ctx.currencies.map((currency) => currency.code))
  const extra = [...new Set(codes)].filter((code) => code && !known.has(code)).sort()
  if (!extra.length) return ctx
  const currencies = [
    ...ctx.currencies,
    ...extra.map((code) => ({ code, label: currencyLabel(code), name: code, rate: null, isBase: false, id: null })),
  ]
  return { ...ctx, currencies, rates: { ...ctx.rates, ...Object.fromEntries(extra.map((code) => [code, null])) } }
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
