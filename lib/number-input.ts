import { amountPrecision } from "@/lib/amount-precision"

// Amount fields as the reference types them (its normalize): the digits are grouped by spaces while they are typed
// ("85 000 000") and a comma is read as the decimal point. With Настройки → Округление сумм set (the reference's
// ROUND_AMOUNT_FOR_CURRENCY), a number typed with more decimals is rounded to them as the reference does
// (Number(value.toFixed(digits)): 1.123456 → 1.12346, 1.99999999 → 2); with the setting not set nothing is cut. A
// pasted "85 000 000" or "1 234,5" is read the same way. The field keeps this text; parseNumberInput reads the number.
// (The reference also groups the decimals it rounded, "1.12 346"; only the whole part is grouped here.)

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")

/** "85000000" → "85 000 000", "1234567,5" → "1 234 567.5", "12abc3" → "123"; "" stays "". Without `decimals` the typed
 * decimals follow the setting (rounded to its digits; all kept when it is not set); a field with a precision of its
 * own (a rate) passes `decimals` and keeps at most that many, cut. */
export function normalizeNumber(raw: string | number | null | undefined, decimals?: number): string {
  const text = String(raw ?? "")
    .replace(/[\s  ]/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.]/g, "")
  if (!text) return ""
  const [integer, ...rest] = text.split(".")
  const fraction = rest.join("")
  if (!rest.length) return group(integer)
  if (decimals !== undefined) return decimals <= 0 ? group(integer) : `${group(integer)}.${fraction.slice(0, decimals)}`
  const digits = amountPrecision().digits
  if (!digits || fraction.length <= digits) return `${group(integer)}.${fraction}`
  const rounded = String(Number(Number(`${integer || "0"}.${fraction}`).toFixed(digits)))
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rounded)
  // A number too long for a plain decimal text (1e21 and up) keeps its typed digits, cut.
  if (!match) return `${group(integer)}.${fraction.slice(0, digits)}`
  return match[2] ? `${group(match[1])}.${match[2]}` : group(match[1])
}

/** The number of an amount field's text ("85 000 000", "1 234,5"); NaN for an empty or unreadable text. */
export function parseNumberInput(text: string | number | null | undefined): number {
  const cleaned = String(text ?? "").replace(/[\s  ]/g, "").replace(/,/g, ".")
  if (!cleaned) return NaN
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : NaN
}

/** How many digits and decimal points come before `position` in a typed text (the caret, counted on what stays). */
export function significantBefore(text: string, position: number): number {
  return text.slice(0, position).replace(/,/g, ".").replace(/[^\d.]/g, "").length
}

/** The position in a normalized text right after its `count`-th digit / decimal point. */
export function positionAfter(text: string, count: number): number {
  let index = 0
  let seen = 0
  while (index < text.length && seen < count) {
    if (/[\d.]/.test(text[index])) seen += 1
    index += 1
  }
  return index
}
