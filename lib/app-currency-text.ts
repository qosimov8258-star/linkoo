import { convertAmount, currencyLabel, currencyNames, formatMoney, normCurrency } from "@/lib/finance/currency"

// Настройки → Валюта приложения (lib/app-currency.ts), text side: an amount printed with another currency
// ("12 000 SOM", "110 ЕВРО", "-8 156 244 800 SUM") as the same amount in the app currency with the current
// rates ("0,96 USD"). Used by the DOM pass of every screen (components/ref/app-currency-dom.tsx) and by the
// Excel export (lib/excel-export.ts), which prints what the screen shows.

/** Names a currency is printed under: stored codes and spellings, the shown names (SOM, ЕВРО and the euro's
 * name in each UI language) and the names given on Валюты (currencyNames). Matched as whole words after an amount. */
const SPELLINGS = ["SOM", "SUM", "UZS", "СУМ", "сум", "сўм", "so'm", "USD", "EUR", "EURO", "Euro", "ЕВРО", "Евро", "€", "$", "RUB", "РУБ"]

/** An amount as the app prints it (ru-RU grouping: "1 234 567,5", "-8 156", "4,142", "0.45"). */
const AMOUNT = String.raw`[-−]?(?:\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseAmount(text: string): number {
  return Number(text.replace(/[   ]/g, "").replace("−", "-").replace(",", "."))
}

/**
 * The text converter of an app currency (`work`: canonical code; `rates`: units of the base currency per unit;
 * `euroName`: the euro's name in the UI language), or null without one. Amounts of other currencies are
 * converted; "1 234 SOM , 56 USD" (the app's one-total-per-currency print) becomes one sum once converted.
 */
export function appCurrencyTextConverter(work: string, rates: Record<string, number | null>, euroName = currencyLabel("EUR")): ((text: string) => string) | null {
  if (!work || !rates[work]) return null
  const canonical = (name: string) => (name === euroName ? "EUR" : normCurrency(name))
  const shownLabel = work === "EUR" ? euroName : currencyLabel(work)
  // Every spelling of another currency than the app one (the euro's name in the UI language and the names of
  // Валюты too).
  const names = [...new Set([...SPELLINGS, ...Object.values(currencyNames()), euroName])].filter((name) => name && canonical(name) !== work)
  if (!names.length) return null
  const alternatives = names.sort((a, b) => b.length - a.length).map(escape).join("|")
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.,])(${AMOUNT})[ \\u00a0\\u202f]?(${alternatives})(?![\\p{L}\\p{N}_])`, "gu")
  const quick = new RegExp(`(?:${alternatives})`, "u")
  const shownMoney = `(?:${AMOUNT})[ \\u00a0\\u202f]?${escape(shownLabel)}`
  const list = new RegExp(`(?<![\\p{L}\\p{N}_.,])${shownMoney}(?:\\s+,\\s+${shownMoney})+(?![\\p{L}\\p{N}_])`, "gu")
  const part = new RegExp(`(${AMOUNT})[ \\u00a0\\u202f]?${escape(shownLabel)}`, "gu")

  return (text: string): string => {
    if (!/\d/.test(text) || !quick.test(text)) return text
    const converted = text.replace(pattern, (whole, amount: string, name: string) => {
      const value = parseAmount(amount)
      if (!Number.isFinite(value)) return whole
      const result = convertAmount(value, canonical(name), work, rates)
      return result === null ? whole : `${formatMoney(result, 3)} ${shownLabel}`
    })
    if (converted === text) return text
    return converted.replace(list, (whole) => {
      let total = 0
      for (const match of whole.matchAll(part)) total += parseAmount(match[1])
      return Number.isFinite(total) ? `${formatMoney(total, 3)} ${shownLabel}` : whole
    })
  }
}

let current: ((text: string) => string) | null = null

/** Registers the converter of the page (components/ref/app-currency-dom.tsx), for the code outside React. */
export function setAppCurrencyText(converter: ((text: string) => string) | null): void {
  current = converter
}

/** `text` with its amounts in the app currency (unchanged without one). */
export function appCurrencyText(text: string): string {
  return current ? current(text) : text
}
