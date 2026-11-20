// Amount precision (Настройки → Округление сумм): the reference's settings ROUND_AMOUNT_FOR_CURRENCY and
// SUPPLY_ROUND_AMOUNT, the number of decimals amounts are printed, rounded and typed with.
//
// The reference applies them in a few helpers that the whole app shares:
// - numberFormat(amount, suffix, precision = 3): Intl ru-RU with maximumFractionDigits =
//   Number(ROUND_AMOUNT_FOR_CURRENCY) || precision. A set value wins over the precision a call asks for, so with
//   "5" every amount, quantity and percentage it prints has up to five decimals (formatMoney, lib/finance/currency.ts);
// - round(value, precision = 3): Math.round(value + "e+" + digits) + "e-" + digits with the same digits (roundAmount);
// - the normalizer of typed amounts rounds a number typed with more decimals to the set digits, and cuts nothing
//   when the setting is not set (lib/number-input.ts);
// - the supply screens prefer SUPPLY_ROUND_AMOUNT, then ROUND_AMOUNT_FOR_CURRENCY (supplyAmountDigits).
// A value that is not set (or 0) leaves every call with its own default. A few screens of the reference print with
// a fixed precision instead (the stock movement report and the staff expenses floor to two decimals, price
// percentages use toFixed(1)): they use formatFixed.
//
// The values are kept on globalThis so every copy of this module (server components, SSR, route handlers, the
// browser bundle) reads the same ones: the server loads them from app_settings (lib/amount-precision-server.ts), the
// browser gets them from the root layout (components/ref/amount-precision-provider.tsx).

export type AmountPrecision = {
  /** ROUND_AMOUNT_FOR_CURRENCY: decimals of amounts; 0 = not set (each call keeps its default, mostly 3). */
  digits: number
  /** SUPPLY_ROUND_AMOUNT: decimals of the supply screens; 0 = as `digits`. */
  supplyDigits: number
}

/** The most decimals the setting accepts. */
export const MAX_AMOUNT_DIGITS = 10
/** The precision of a call that names none (the reference's numberFormat / round default). */
export const DEFAULT_AMOUNT_DIGITS = 3

type State = AmountPrecision & { loaded: boolean }

declare global {
  var __mezonAmountPrecision: State | undefined
}

const EMPTY: State = { digits: 0, supplyDigits: 0, loaded: false }

declare global {
  /** Set by lib/amount-precision-server.ts: starts loading the setting when a server process reads it first. */
  var __mezonAmountPrecisionKick: (() => void) | undefined
}

function state(): State {
  const current = globalThis.__mezonAmountPrecision
  if (current) return current
  if (typeof window === "undefined") globalThis.__mezonAmountPrecisionKick?.()
  return EMPTY
}

/** A stored or typed setting value as digits: an integer 1..MAX_AMOUNT_DIGITS, else 0 (not set). The reference reads
 * it with Number(value) || default, so "", "0" and text all mean "not set". */
export function parseAmountDigits(value: unknown): number {
  const number = Math.trunc(Number(String(value ?? "").trim()))
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(number, MAX_AMOUNT_DIGITS)
}

/** Sets the precision every formatter of this process / page reads. */
export function setAmountPrecision(value: Partial<AmountPrecision>): void {
  globalThis.__mezonAmountPrecision = {
    digits: parseAmountDigits(value.digits),
    supplyDigits: parseAmountDigits(value.supplyDigits),
    loaded: true,
  }
}

/** The stored setting as it is (0 = not set). */
export function amountPrecision(): AmountPrecision {
  const { digits, supplyDigits } = state()
  return { digits, supplyDigits }
}

/** Whether this process / page got the setting yet (a server process before its first load has not). */
export function amountPrecisionLoaded(): boolean {
  return state().loaded
}

/** Decimals of an amount: the setting, else `fallback` (the reference's `Number(ROUND_AMOUNT_FOR_CURRENCY) || precision`). */
export function amountDigits(fallback: number = DEFAULT_AMOUNT_DIGITS): number {
  return state().digits || fallback
}

/** Decimals of the supply screens (the reference's supplyNumberFormat): SUPPLY_ROUND_AMOUNT, then
 * ROUND_AMOUNT_FOR_CURRENCY, then `fallback`. */
export function supplyAmountDigits(fallback: number = DEFAULT_AMOUNT_DIGITS): number {
  const { digits, supplyDigits } = state()
  return supplyDigits || digits || fallback
}

/** `value` rounded to `digits` decimals with halves away from zero, on the number's shortest decimal text (so 1.005
 * → 1.01, not the 1.00 of value * 100 / 100). That is how the reference's screens print amounts (Intl rounds the
 * shortest decimal half away from zero) and how its server rounds a numeric; for positive amounts it is also its
 * round() (roundAmount, which takes a negative half toward +∞). Non-finite values give 0; -0 gives 0. */
export function roundToDigits(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  const places = Math.max(0, Math.min(20, Math.trunc(digits)))
  const size = Math.abs(value)
  const text = String(size)
  let rounded: number
  if (/e/i.test(text)) {
    // A number in exponent form ("1e-7", "1.5e+21") cannot take another exponent: plain arithmetic is exact enough
    // there (the reference turns such a value into NaN).
    const factor = 10 ** places
    rounded = Math.round(size * factor) / factor
  } else {
    rounded = Number(`${Math.round(Number(`${text}e+${places}`))}e-${places}`)
  }
  if (!Number.isFinite(rounded) || rounded === 0) return 0
  return value < 0 ? -rounded : rounded
}

/** The reference's round(value, precision = 3) of its screens' own math: to the setting's digits, else to `fallback`,
 * with Math.round on the shifted decimal text, so a half goes up toward +∞ (-0.370925 → -0.37092, 0.370925 →
 * 0.37093). An amount the reference only prints (a server figure) rounds as Intl does: roundToDigits. */
export function roundAmount(value: number, fallback: number = DEFAULT_AMOUNT_DIGITS): number {
  if (!Number.isFinite(value) || value === 0) return 0
  const places = Math.max(0, Math.min(20, Math.trunc(amountDigits(fallback))))
  const text = String(value)
  // A number in exponent form cannot take another exponent (the reference turns it into NaN): plain arithmetic.
  const rounded = /e/i.test(text)
    ? Math.round(value * 10 ** places) / 10 ** places
    : Number(`${Math.round(Number(`${text}e+${places}`))}e-${places}`)
  return Number.isFinite(rounded) && rounded !== 0 ? rounded : 0
}

const formatters = new Map<number, Intl.NumberFormat>()

function formatter(digits: number): Intl.NumberFormat {
  let format = formatters.get(digits)
  if (!format) {
    format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits })
    formatters.set(digits, format)
  }
  return format
}

/** `value` with up to `digits` decimals, ru-RU grouping ("1 234 567,5"), the way Intl prints it (as the reference
 * does: no rounding of its own first). A value that rounds to zero prints "0", never "-0". */
export function printDigits(value: number, digits: number): string {
  const places = Math.max(0, Math.min(20, Math.trunc(digits)))
  if (!Number.isFinite(value) || roundToDigits(value, places) === 0) return formatter(places).format(0)
  return formatter(places).format(value)
}

/** "1 234 567,5" with up to `digits` decimals whatever the setting is: the reference's screens that print with a
 * fixed precision (toFixed, or its two-decimal formatters). `floor` cuts instead of rounding (the stock movement
 * report: lodash floor(value, 2)). */
export function formatFixed(value: number, digits: number, options: { floor?: boolean } = {}): string {
  const places = Math.max(0, Math.min(20, Math.trunc(digits)))
  if (options.floor && Number.isFinite(value)) {
    const factor = 10 ** places
    // The small rounding first keeps 0.29 * 100 (28.999999999999996) at 29 before the floor.
    return printDigits(Math.floor(roundToDigits(value * factor, 6)) / factor, places)
  }
  return printDigits(value, places)
}

/** A finite number as an integer of decimal units: its shortest decimal text ("0.1", "1e-7") read exactly; a decimal
 * text ("-4477.499960145", a numeric column read as text) is read as it is. */
function decimalUnits(value: number | string): { units: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value).trim())
  if (!match) return { units: BigInt(0), scale: 0 }
  const [, sign, whole, fraction = "", exponent = "0"] = match
  let digits = `${whole}${fraction}`
  let scale = fraction.length - Number(exponent)
  if (scale < 0) {
    digits += "0".repeat(-scale)
    scale = 0
  }
  const units = BigInt(digits)
  return { units: sign ? -units : units, scale }
}

/** 10^n as a bigint (the ** operator on bigints needs a newer compile target). */
function tenTo(n: number): bigint {
  return BigInt(`1${"0".repeat(Math.max(0, n))}`)
}

/** A running sum of amounts as their decimal texts add up (`add`, then `value`: the nearest number to the exact sum):
 * 0.1 + 0.2 = 0.3, and a band of a few hundred order totals ends on the decimals the reference's server sums to, where
 * float additions drift a unit in the last place. Non-finite values are left out. */
export class AmountSum {
  private units = BigInt(0)
  private scale = 0

  /** Adds an amount: a number, or a decimal text kept to its last digit (a numeric column read as text). */
  add(value: number | string): this {
    if (typeof value === "number" && (!Number.isFinite(value) || value === 0)) return this
    return this.addUnits(decimalUnits(value))
  }

  /** Adds a × b, multiplied as exact decimals (their shortest texts), rounded to `scale` decimals when given (halves
   * away from zero, as a numeric column of that scale stores the product: Linko's client_transactions.internal keeps
   * amount × rate to 9 decimals). A float product drifts in the 16th digit, which a large balance shows. */
  addProduct(a: number, b: number, scale?: number): this {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return this
    const x = decimalUnits(a)
    const y = decimalUnits(b)
    let units = x.units * y.units
    let unitScale = x.scale + y.scale
    if (scale !== undefined && scale >= 0 && unitScale > scale) {
      const divisor = tenTo(unitScale - scale)
      const negative = units < BigInt(0)
      const size = negative ? -units : units
      const rest = size % divisor
      const kept = size / divisor + (rest * BigInt(2) >= divisor ? BigInt(1) : BigInt(0))
      units = negative ? -kept : kept
      unitScale = scale
    }
    return this.addUnits({ units, scale: unitScale })
  }

  private addUnits(part: { units: bigint; scale: number }): this {
    if (part.scale > this.scale) {
      this.units *= tenTo(part.scale - this.scale)
      this.scale = part.scale
    }
    this.units += part.units * tenTo(this.scale - part.scale)
    return this
  }

  value(): number {
    if (!this.scale) return Number(this.units)
    const negative = this.units < BigInt(0)
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, "0")
    return Number(`${negative ? "-" : ""}${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`)
  }
}

/** The exact decimal sum of `values` as a number (AmountSum). */
export function sumAmounts(values: Iterable<number>): number {
  const sum = new AmountSum()
  for (const value of values) sum.add(value)
  return sum.value()
}

/** An amount of the supply screens: the reference's supplyNumberFormat (SUPPLY_ROUND_AMOUNT, then
 * ROUND_AMOUNT_FOR_CURRENCY, then `fallback` decimals). */
export function formatSupplyAmount(value: number, fallback: number = DEFAULT_AMOUNT_DIGITS): string {
  return printDigits(value, supplyAmountDigits(fallback))
}
