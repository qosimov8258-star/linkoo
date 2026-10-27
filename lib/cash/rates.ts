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

// --- "Перевод" guards (contract: a transfer between cashboxes never creates money) ----------

/** Same currency, cash ↔ bank ("Процент"): the target receives 50 %…100 % of what left the
 * source. Above 100 % the transfer would create money; a commission above half of the amount
 * is a typo (e.g. "2" typed for a 2 % commission). */
export const TRANSFER_MIN_PERCENTAGE = 50
export const TRANSFER_MAX_PERCENTAGE = 100
/** Different currencies: the value received, priced at the table rates ("Валюты"), may be at most
 * 10 % below the value sent (exchange spread, bank commission, a slightly stale table)... */
export const TRANSFER_RATE_TOLERANCE = 0.1
/** ...and at most 2 % above it (rounding of the rate / a table a little behind the market). The
 * asymmetry keeps the contract: a round trip through another currency gains at most ~4 %, while a
 * symmetric ±10 % let two transfers create ~21 % with no income document. */
export const TRANSFER_MAX_GAIN = 0.02
/** Rounding slack of an explicit amount (0.01 of the currency). */
const AMOUNT_SLACK = 0.01

export type TransferField = "amountTo" | "percentage" | "rate"

export type TransferResolution =
  | { ok: true; amountTo: number; rate: number | null; percentage: number | null }
  | { ok: false; error: string; field: TransferField }

/**
 * Validates and completes the amounts of a transfer (server and dialog share it):
 * - same currency, same type (cash → cash, bank → bank): the target gets exactly amountFrom;
 *   a different explicit amountTo, or a percentage other than 100, is refused;
 * - same currency, cash ↔ bank: amountTo = amountFrom × percentage / 100 with the percentage in
 *   TRANSFER_MIN_PERCENTAGE…TRANSFER_MAX_PERCENTAGE (an explicit amountTo must imply such a share);
 * - different currencies: amountTo follows transferAmountTo (explicit "Курс", else the table);
 *   an explicit amountTo implies its own rate. When both currencies have table rates, the value
 *   received must stay between −TRANSFER_RATE_TOLERANCE and +TRANSFER_MAX_GAIN of the value sent.
 * The amount received is always above zero (a tiny amount that rounds to 0 is "Укажите сумму").
 * The returned error is a Russian message (an i18n key) and the input field it belongs to.
 */
export function resolveTransfer(params: {
  amountFrom: number
  fromCurrency: string
  toCurrency: string
  fromType: string
  toType: string
  baseCurrency: string
  rates: RateMap
  amountTo?: number | null
  rate?: number | null
  percentage?: number | null
}): TransferResolution {
  const base = normCurrency(params.baseCurrency)
  const from = normCurrency(params.fromCurrency, base)
  const to = normCurrency(params.toCurrency, base)
  const amountFrom = params.amountFrom
  const explicitTo = params.amountTo !== null && params.amountTo !== undefined && Number.isFinite(params.amountTo) && params.amountTo > 0 ? params.amountTo : null
  const percentage = params.percentage !== null && params.percentage !== undefined && Number.isFinite(params.percentage) ? params.percentage : null

  if (from === to) {
    if (params.fromType === params.toType) {
      if (percentage !== null && Math.abs(percentage - 100) > 1e-9) {
        return { ok: false, error: "Процент указывается только при переводе между наличной и безналичной кассой", field: "percentage" }
      }
      if (explicitTo !== null && Math.abs(explicitTo - amountFrom) > AMOUNT_SLACK) {
        return { ok: false, error: "При переводе в той же валюте касса-получатель получает ту же сумму", field: "amountTo" }
      }
      return { ok: true, amountTo: amountFrom, rate: null, percentage: null }
    }
    if (explicitTo !== null) {
      const share = (explicitTo / amountFrom) * 100
      if (percentage !== null && Math.abs((amountFrom * percentage) / 100 - explicitTo) > AMOUNT_SLACK) {
        return { ok: false, error: "Сумма получателя не совпадает с процентом", field: "amountTo" }
      }
      if (share < TRANSFER_MIN_PERCENTAGE - 1e-9 || explicitTo > amountFrom + AMOUNT_SLACK) {
        return { ok: false, error: "Касса-получатель может получить от 50 % до 100 % суммы перевода", field: "amountTo" }
      }
      return { ok: true, amountTo: Math.min(explicitTo, amountFrom), rate: null, percentage: roundMoney(Math.min(share, 100), 5) }
    }
    const pct = percentage ?? 100
    if (!(pct >= TRANSFER_MIN_PERCENTAGE && pct <= TRANSFER_MAX_PERCENTAGE)) {
      return { ok: false, error: "Процент должен быть от 50 до 100", field: "percentage" }
    }
    const received = roundMoney((amountFrom * pct) / 100, 5)
    if (!(received > 0)) return { ok: false, error: "Укажите сумму", field: "amountTo" }
    return { ok: true, amountTo: received, rate: null, percentage: pct }
  }

  let amountTo: number
  let rate: number | null
  if (explicitTo !== null) {
    amountTo = explicitTo
    rate = roundMoney(from === base ? amountFrom / explicitTo : explicitTo / amountFrom, 10)
    const given = params.rate && params.rate > 0 ? params.rate : null
    if (given) {
      const expected = transferAmountTo({ amountFrom, fromCurrency: from, toCurrency: to, baseCurrency: base, rates: params.rates, rate: given }).amountTo
      if (expected !== null && Math.abs(expected - explicitTo) > Math.max(AMOUNT_SLACK, explicitTo * 0.001)) {
        return { ok: false, error: "Сумма получателя не совпадает с курсом", field: "amountTo" }
      }
      rate = given
    }
  } else {
    const computed = transferAmountTo({ amountFrom, fromCurrency: from, toCurrency: to, baseCurrency: base, rates: params.rates, rate: params.rate })
    if (computed.amountTo === null) return { ok: false, error: "Курс валюты не задан", field: "rate" }
    amountTo = computed.amountTo
    rate = computed.rate
  }
  // A tiny amount whose converted value rounds to 0 is not a transfer (and not a rate problem).
  if (!(amountTo > 0)) return { ok: false, error: "Укажите сумму", field: "amountTo" }
  // Value check at the table rates (skipped when a currency has no rate: nothing to compare with):
  // the received value may fall short by the spread, but never exceed the sent value by more than
  // TRANSFER_MAX_GAIN.
  const fromRate = rateOf(from, params.rates, base)
  const toRate = rateOf(to, params.rates, base)
  if (fromRate && toRate) {
    const ratio = (amountTo * toRate) / (amountFrom * fromRate)
    const field: TransferField = explicitTo !== null ? "amountTo" : "rate"
    if (ratio < 1 - TRANSFER_RATE_TOLERANCE - 1e-9) {
      return { ok: false, error: "Курс перевода отличается от курса валюты более чем на 10 %", field }
    }
    if (ratio > 1 + TRANSFER_MAX_GAIN + 1e-9) {
      return { ok: false, error: "Курс перевода выгоднее курса валюты более чем на 2 %", field }
    }
  }
  return { ok: true, amountTo, rate, percentage: null }
}
