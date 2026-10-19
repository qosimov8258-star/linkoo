import "server-only"

import type { PgDb } from "@/lib/db"

// Shared writer of item prices (contract: goods spec "Shared price writer").
//
// Prices live on the item: products.price_lists and raw_materials.price_lists are JSON TEXT
// arrays of { name, cash, nonCash, min, max, currency?, nonCashCurrency? } — PriceListEntry of
// components/analytics/products-data.ts, re-declared here so this module does not depend on a
// client data file. `name` is the price-list NAME (price_lists.name), matched by fin_key (case,
// surrounding / repeated spaces ignored). Readers: the stock core (lib/stock/catalog.ts, price
// mode), supplier incomings "Переоценка", price formation, the product dialogs, Прайс-листы and
// Переоценка.
//
// setItemPrices() upserts entries of ONE item and recomputes the derived columns
//   price_min / price_max = min / max of every positive cash and nonCash price of the item,
//   price_updated_date    = "17 окт. 2026" (local day; products only, or wherever the column exists).
// It runs on the db handle it is given, so pass the transaction handle of withTransaction() and the
// write commits / rolls back with the caller's document. The item row is locked (FOR UPDATE) for the
// rest of that transaction.

export type ItemPriceKind = "product" | "raw_material"

/** One price-list entry of an item (unknown extra fields of stored entries are preserved). */
export type ItemPriceEntry = {
  name: string
  cash: number
  nonCash: number
  min: number
  max: number
  currency?: string
  nonCashCurrency?: string
}

/**
 * Change of one price list of the item. Omitted fields keep the stored value; a NEW entry gets
 * cash 0, nonCash = cash, min / max 0, nonCashCurrency = currency. `remove: true` deletes the
 * entry (used to undo a price that did not exist before).
 */
export type ItemPriceChange = {
  priceList: string
  cash?: number
  nonCash?: number
  currency?: string
  nonCashCurrency?: string
  min?: number
  max?: number
  remove?: boolean
}

export type SetItemPricesResult = {
  kind: ItemPriceKind
  id: number
  name: string
  /** Entry of each change's price list BEFORE the write (null = there was none), same order as `changes`. */
  previous: Array<ItemPriceEntry | null>
  /** Every entry of the item after the write. */
  entries: ItemPriceEntry[]
  priceMin: number
  priceMax: number
  priceUpdatedDate: string
  /** False when the stored JSON did not change (nothing was written). */
  changed: boolean
}

const TABLES: Record<ItemPriceKind, string> = { product: "products", raw_material: "raw_materials" }

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** JS twin of the SQL fin_key(): lower-case, trimmed, whitespace (NBSP too) collapsed. */
export function priceListKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** "17 окт. 2026" of the local (Asia/Tashkent, UTC+5) day — the products.price_updated_date format. */
export function priceDateLabel(now = new Date()): string {
  const iso = new Date(now.getTime() + 5 * 3600_000).toISOString()
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

function money(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

function leadingNumber(value: unknown): number {
  const match = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  return match ? money(match[0].replace(/[\s ]/g, "")) : 0
}

/** Parses a price_lists JSON value; invalid JSON / entries without a name are dropped. */
export function parseItemPrices(json: string | null | undefined): ItemPriceEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json || "[]")
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const entries: ItemPriceEntry[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue
    const value = raw as Record<string, unknown>
    const name = String(value.name ?? "").trim()
    if (!name) continue
    const entry: ItemPriceEntry = { ...(value as object), name, cash: money(value.cash), nonCash: money(value.nonCash), min: money(value.min), max: money(value.max) }
    if (typeof value.currency !== "string" || !value.currency) delete entry.currency
    if (typeof value.nonCashCurrency !== "string" || !value.nonCashCurrency) delete entry.nonCashCurrency
    entries.push(entry)
  }
  return entries
}

/**
 * Entries of an item including the legacy single price list of raw materials saved before the
 * multi-list form (price_list / cash_price / non_cash_price, read while the JSON is empty).
 */
export function itemPriceEntries(json: string | null | undefined, legacy?: { priceList?: string | null; cashPrice?: unknown; nonCashPrice?: unknown }): ItemPriceEntry[] {
  const entries = parseItemPrices(json)
  if (entries.length || !legacy?.priceList?.trim()) return entries
  const cash = leadingNumber(legacy.cashPrice)
  const nonCash = legacy.nonCashPrice === null || legacy.nonCashPrice === undefined || legacy.nonCashPrice === "" ? cash : leadingNumber(legacy.nonCashPrice)
  return [{ name: legacy.priceList.trim(), cash, nonCash, min: 0, max: 0 }]
}

/** The entry of `priceList` (fin_key match), or null. */
export function findItemPrice(entries: ItemPriceEntry[], priceList: string): ItemPriceEntry | null {
  const key = priceListKey(priceList)
  return entries.find((entry) => priceListKey(entry.name) === key) ?? null
}

/** Derived price_min / price_max: every positive cash / nonCash price of the item. */
export function priceBounds(entries: ItemPriceEntry[]): { priceMin: number; priceMax: number } {
  const prices = entries.flatMap((entry) => [entry.cash, entry.nonCash]).filter((value) => value > 0)
  return { priceMin: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0 }
}

// --- columns that exist (raw_materials gets price_lists / price_min / price_max lazily from its repo) ---

const WANTED = ["price_lists", "price_min", "price_max", "price_updated_date", "price_list", "cash_price", "non_cash_price"]
const columnCache = new Map<string, { columns: Set<string>; at: number }>()

async function itemColumns(db: PgDb, table: string): Promise<Set<string>> {
  const cached = columnCache.get(table)
  if (cached && (WANTED.every((column) => cached.columns.has(column)) || Date.now() - cached.at < 60_000)) return cached.columns
  const rows = (await db
    .prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?")
    .all(table)) as Array<{ column_name: string }>
  const columns = new Set(rows.map((row) => row.column_name))
  columnCache.set(table, { columns, at: Date.now() })
  return columns
}

function checkPrice(value: number | undefined, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new RangeError(`Некорректная цена: ${field}`)
  return Math.round(value * 1e6) / 1e6
}

function applyChange(entries: ItemPriceEntry[], change: ItemPriceChange): ItemPriceEntry[] {
  const key = priceListKey(change.priceList)
  const index = entries.findIndex((entry) => priceListKey(entry.name) === key)
  if (change.remove) return index < 0 ? entries : entries.filter((_, position) => position !== index)
  const cash = checkPrice(change.cash, "cash")
  const nonCash = checkPrice(change.nonCash, "nonCash")
  const min = checkPrice(change.min, "min")
  const max = checkPrice(change.max, "max")
  const currency = change.currency?.trim() || undefined
  const nonCashCurrency = change.nonCashCurrency?.trim() || undefined
  if (index < 0) {
    const entry: ItemPriceEntry = { name: change.priceList.trim(), cash: cash ?? 0, nonCash: nonCash ?? cash ?? 0, min: min ?? 0, max: max ?? 0 }
    if (currency) entry.currency = currency
    if (nonCashCurrency ?? currency) entry.nonCashCurrency = nonCashCurrency ?? currency
    return [...entries, entry]
  }
  const next = { ...entries[index] }
  if (cash !== undefined) next.cash = cash
  if (nonCash !== undefined) next.nonCash = nonCash
  if (min !== undefined) next.min = min
  if (max !== undefined) next.max = max
  if (currency) next.currency = currency
  if (nonCashCurrency) next.nonCashCurrency = nonCashCurrency
  return entries.map((entry, position) => (position === index ? next : entry))
}

/**
 * Upserts price-list entries of one product / raw material and recomputes price_min, price_max and
 * price_updated_date. Runs on `db` (pass the caller's transaction handle). Returns null when the
 * item does not exist. Throws RangeError for a negative / non-finite price.
 */
export async function setItemPrices(db: PgDb, kind: ItemPriceKind, id: number, changes: ItemPriceChange[]): Promise<SetItemPricesResult | null> {
  const table = TABLES[kind]
  if (!table) throw new Error(`Unknown item kind: ${kind}`)
  const columns = await itemColumns(db, table)
  if (!columns.has("price_lists")) throw new Error(`${table}.price_lists does not exist`)
  const legacy = kind === "raw_material" && columns.has("price_list") && columns.has("cash_price")
  const select = [
    "id",
    "name",
    "price_lists",
    columns.has("price_updated_date") ? "price_updated_date" : "NULL AS price_updated_date",
    ...(legacy ? ["price_list", "cash_price", columns.has("non_cash_price") ? "non_cash_price" : "NULL AS non_cash_price"] : []),
  ]
  const row = (await db.prepare(`SELECT ${select.join(", ")} FROM ${table} WHERE id = ? FOR UPDATE`).get(id)) as
    | {
        id: number
        name: string
        price_lists: string | null
        price_updated_date: string | null
        price_list?: string | null
        cash_price?: string | null
        non_cash_price?: string | null
      }
    | undefined
  if (!row) return null

  // A raw material saved before the multi-list form keeps its only price in price_list / cash_price
  // (the stock catalog reads it while the JSON is empty) — carry it into the JSON on the first write.
  let entries = itemPriceEntries(row.price_lists, legacy ? { priceList: row.price_list, cashPrice: row.cash_price, nonCashPrice: row.non_cash_price } : undefined)
  const before = JSON.stringify(entries)
  const previous: Array<ItemPriceEntry | null> = []
  for (const change of changes) {
    if (!change || !String(change.priceList ?? "").trim()) throw new RangeError("Не указан прайс-лист")
    const found = findItemPrice(entries, change.priceList)
    previous.push(found ? { ...found } : null)
    entries = applyChange(entries, change)
  }

  const { priceMin, priceMax } = priceBounds(entries)
  const json = JSON.stringify(entries)
  const changed = json !== before
  let priceUpdatedDate = row.price_updated_date ?? ""
  if (changed) {
    priceUpdatedDate = priceDateLabel()
    const sets = ["price_lists = @json"]
    if (columns.has("price_min")) sets.push("price_min = @priceMin")
    if (columns.has("price_max")) sets.push("price_max = @priceMax")
    if (columns.has("price_updated_date")) sets.push("price_updated_date = @date")
    if (columns.has("updated_at")) sets.push("updated_at = datetime('now')")
    // Removing the last price of a legacy raw material must not resurrect the legacy column.
    if (legacy && !entries.length && row.price_list?.trim()) sets.push("price_list = ''")
    await db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = @id`).run({ json, priceMin, priceMax, date: priceUpdatedDate, id })
  }
  return { kind, id: Number(row.id), name: row.name, previous, entries, priceMin, priceMax, priceUpdatedDate, changed }
}
