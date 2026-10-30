import { normCurrency } from "@/lib/finance/currency"

// The price-list price a new order line starts with (order card "+ добавить товар"; meant for the
// order form's priceOf too, so both paths agree).
//
// A product's price-list entry may carry its own currency; an entry without one is in its price
// list's currency (price_lists.currency, always set: the base currency for a new list). This is the
// rule of lib/item-prices.ts (priceBounds) and the repricing readers:
//   cash     → entry.currency, else the list's currency;
//   non-cash → entry.nonCashCurrency, else entry.currency, else the list's currency.
// The price is offered only when that currency is known and equals the order currency. A price of
// another currency, or of an unknown one, is never taken (a 9 900 SUM price is not 9 900 USD); the
// user types the price instead. There is no hard-coded currency fallback.

export type OrderListPriceEntry = { name: string; cash?: number; nonCash?: number; currency?: string; nonCashCurrency?: string }
export type OrderPriceList = { name: string; currency?: string | null }

/** JS twin of the SQL fin_key() / priceListKey(): lower-case, trimmed, whitespace (NBSP too) collapsed. */
export function priceListNameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Canonical currency code, or "" when empty (never a default currency). */
function code(value: string | null | undefined): string {
  return normCurrency(value, "")
}

/**
 * The price of the order's price list for a new line, or null when there is none in the order
 * currency: no entry for the list, the entry's currency is unknown or another one, or the price is
 * not a positive finite number (the user types the price then).
 */
export function orderListPrice(
  entries: OrderListPriceEntry[] | null | undefined,
  options: { priceList: string | null | undefined; lists: OrderPriceList[] | null | undefined; orderCurrency: string | null | undefined; nonCash: boolean },
): number | null {
  const key = priceListNameKey(options.priceList)
  const orderCurrency = code(options.orderCurrency)
  if (!key || !orderCurrency) return null
  const entry = entries?.find((row) => priceListNameKey(row.name) === key)
  if (!entry) return null
  const listCurrency = code(options.lists?.find((list) => priceListNameKey(list.name) === key)?.currency)
  const entryCurrency = options.nonCash ? code(entry.nonCashCurrency) || code(entry.currency) || listCurrency : code(entry.currency) || listCurrency
  if (!entryCurrency || entryCurrency !== orderCurrency) return null
  const value = options.nonCash ? (entry.nonCash ?? entry.cash) : entry.cash
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}
