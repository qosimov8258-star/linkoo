import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { convertAmount, normCurrency } from "@/lib/finance/currency"
import { findItemPrice, itemPriceEntries, type ItemPriceEntry } from "@/lib/item-prices"
import { getStockBalances, getStockPending } from "@/lib/stock/ledger"
import type { RepricingItemKind, RepricingPickRow } from "@/components/analytics/repricing-data"

// Items of "Переоценка": the product picker (demo REMAINDER_LIST search with "Доступно" + the
// item's price in the chosen list) and the available quantities that weigh the repricing sums.

export type CatalogItem = {
  kind: RepricingItemKind
  id: number
  key: string
  name: string
  article: string
  barcode: string
  unit: string
  entries: ItemPriceEntry[]
}

type ItemRow = {
  kind: RepricingItemKind
  id: number
  name: string
  article: string | null
  barcode: string | null
  unit: string | null
  price_lists: string | null
  price_list: string | null
  cash_price: string | null
  non_cash_price: string | null
}

const ITEMS_SQL = `
  SELECT 'product' AS kind, p.id, p.name, p.article, p.barcode, p.unit, p.price_lists,
         NULL::text AS price_list, NULL::text AS cash_price, NULL::text AS non_cash_price
    FROM products p WHERE COALESCE(p.deleted, 0) = 0
  UNION ALL
  SELECT 'raw_material', r.id, r.name, r.article, r.barcode, r.unit, to_jsonb(r)->>'price_lists',
         to_jsonb(r)->>'price_list', to_jsonb(r)->>'cash_price', to_jsonb(r)->>'non_cash_price'
    FROM raw_materials r WHERE COALESCE(to_jsonb(r)->>'deleted', '0') = '0'`

/** Every product and raw material that is not deleted, with their price entries. */
export async function repricingCatalog(db: PgDb = getDb()): Promise<CatalogItem[]> {
  const rows = (await db.prepare(ITEMS_SQL).all()) as ItemRow[]
  return rows
    .map((row) => ({
      kind: row.kind,
      id: Number(row.id),
      key: `${row.kind}:${row.id}`,
      name: row.name,
      article: row.article ?? "",
      barcode: /^не установлен/i.test(row.barcode ?? "") ? "" : (row.barcode ?? ""),
      unit: row.unit ?? "",
      entries: itemPriceEntries(row.price_lists, { priceList: row.price_list, cashPrice: row.cash_price, nonCashPrice: row.non_cash_price }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key))
}

/** Доступно per item key over every warehouse: on hand − defects − reserved (stock core, current moment). */
export async function availableByKey(db: PgDb = getDb()): Promise<Map<string, number>> {
  const [balances, pending] = await Promise.all([getStockBalances({}, db), getStockPending({}, db)])
  const available = new Map<string, number>()
  for (const balance of balances) available.set(balance.key, (available.get(balance.key) ?? 0) + balance.qty - balance.defects)
  for (const row of pending) if (row.reserved) available.set(row.key, (available.get(row.key) ?? 0) - row.reserved)
  for (const [key, value] of available) available.set(key, Math.round(value * 1e6) / 1e6)
  return available
}

/**
 * Picker rows for one price list: current cash price (in the entry's currency), the same price in
 * the LIST's currency (the currency of a repricing of this list) and the available quantity.
 */
export async function repricingPickRows(priceList: { name: string; currency: string }, search = ""): Promise<RepricingPickRow[]> {
  const db = getDb()
  const [catalog, available, context] = await Promise.all([repricingCatalog(db), availableByKey(db), loadCurrencyContext(db)])
  const listCurrency = normCurrency(priceList.currency)
  const needle = search.trim().toLowerCase()
  return catalog
    .filter((item) => !needle || `${item.name} ${item.article} ${item.barcode}`.toLowerCase().includes(needle))
    .map((item) => {
      const entry = findItemPrice(item.entries, priceList.name)
      const currency = normCurrency(entry?.currency, listCurrency)
      const listPrice = entry ? convertAmount(entry.cash, currency, listCurrency, context.rates) : null
      return {
        kind: item.kind,
        id: item.id,
        key: item.key,
        name: item.name,
        article: item.article,
        barcode: item.barcode,
        unit: item.unit,
        available: available.get(item.key) ?? 0,
        price: entry ? entry.cash : null,
        currency,
        listPrice: listPrice === null ? null : Math.round(listPrice * 1e6) / 1e6,
      }
    })
}

/** Current names / units of items by key (lines keep a snapshot; a renamed item shows its new name). */
export async function itemNames(db: PgDb, keys: string[]): Promise<Map<string, { name: string; unit: string }>> {
  const ids = (kind: RepricingItemKind) => [...new Set(keys.filter((key) => key.startsWith(`${kind}:`)).map((key) => Number(key.slice(kind.length + 1))).filter((id) => id > 0))]
  const names = new Map<string, { name: string; unit: string }>()
  const productIds = ids("product")
  const rawIds = ids("raw_material")
  if (productIds.length) {
    for (const row of (await db.prepare("SELECT id, name, unit FROM products WHERE id = ANY(?::int[])").all(productIds)) as Array<{ id: number; name: string; unit: string | null }>) {
      names.set(`product:${row.id}`, { name: row.name, unit: row.unit ?? "" })
    }
  }
  if (rawIds.length) {
    for (const row of (await db.prepare("SELECT id, name, unit FROM raw_materials WHERE id = ANY(?::int[])").all(rawIds)) as Array<{ id: number; name: string; unit: string | null }>) {
      names.set(`raw_material:${row.id}`, { name: row.name, unit: row.unit ?? "" })
    }
  }
  return names
}
