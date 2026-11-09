// Amount fields as the reference types them (its normalizeNumber): the digits are grouped by spaces while they
// are typed ("85 000 000"), a comma is read as the decimal point and at most three decimals are kept. A pasted
// "85 000 000" or "1 234,5" is read the same way. The field keeps this text; parseNumberInput reads the number.

/** "85000000" → "85 000 000", "1234567,5" → "1 234 567.5", "12abc3" → "123"; "" stays "". */
export function normalizeNumber(raw: string | number | null | undefined, decimals = 3): string {
  const text = String(raw ?? "")
    .replace(/[\s  ]/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.]/g, "")
  if (!text) return ""
  const [integer, ...rest] = text.split(".")
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  if (!rest.length || decimals <= 0) return grouped
  return `${grouped}.${rest.join("").slice(0, decimals)}`
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
