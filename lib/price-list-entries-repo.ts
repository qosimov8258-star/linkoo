import "server-only"

import { getDb, withTransaction } from "@/lib/db"
import { itemPriceEntries, priceListKey, setItemPrices } from "@/lib/item-prices"
import { ensurePriceListsSchema } from "@/lib/price-lists-repo"

// GET/POST /api/price-list-entries — the flat "product × price list" view that price analysis
// (components/analytics/price-analysis-view.tsx) reads. Prices live on the items now
// (products.price_lists / raw_materials.price_lists, lib/item-prices.ts), so the rows are derived
// from them; rows of the older price_list_entries table (if a database still has one) are added
// for pairs the items do not cover. The shape is unchanged: {id, priceList, product, cash, nonCash}.

export type PriceListEntry = {
  id: number
  priceList: string
  product: string
  cash: number
  nonCash: number
}

type ItemRow = { kind: "product" | "raw_material"; id: number; name: string; price_lists: string | null; price_list: string | null; cash_price: string | null; non_cash_price: string | null }

const ITEMS_SQL = `
  SELECT 'product' AS kind, p.id, p.name, p.price_lists, NULL::text AS price_list, NULL::text AS cash_price, NULL::text AS non_cash_price
    FROM products p WHERE COALESCE(p.deleted, 0) = 0
  UNION ALL
  SELECT 'raw_material', r.id, r.name, to_jsonb(r)->>'price_lists', to_jsonb(r)->>'price_list', to_jsonb(r)->>'cash_price', to_jsonb(r)->>'non_cash_price'
    FROM raw_materials r WHERE COALESCE(to_jsonb(r)->>'deleted', '0') = '0'`

export async function listPriceListEntries(): Promise<PriceListEntry[]> {
  const db = getDb()
  const rows = (await db.prepare(ITEMS_SQL).all()) as ItemRow[]
  const entries: PriceListEntry[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const entry of itemPriceEntries(row.price_lists, { priceList: row.price_list, cashPrice: row.cash_price, nonCashPrice: row.non_cash_price })) {
      const pair = `${priceListKey(entry.name)}\u0000${priceListKey(row.name)}`
      if (seen.has(pair)) continue
      seen.add(pair)
      entries.push({ id: entries.length + 1, priceList: entry.name, product: row.name, cash: entry.cash, nonCash: entry.nonCash })
    }
  }
  const legacy = (await db.prepare("SELECT to_regclass('price_list_entries') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (legacy?.ok) {
    const legacyRows = (await db.prepare("SELECT price_list, product, cash, non_cash FROM price_list_entries ORDER BY id DESC").all()) as Array<{
      price_list: string
      product: string
      cash: number
      non_cash: number
    }>
    for (const row of legacyRows) {
      const pair = `${priceListKey(row.price_list)}\u0000${priceListKey(row.product)}`
      if (seen.has(pair)) continue
      seen.add(pair)
      entries.push({ id: entries.length + 1, priceList: row.price_list, product: row.product, cash: Number(row.cash) || 0, nonCash: Number(row.non_cash) || 0 })
    }
  }
  return entries
}

export type PriceListEntryInput = {
  priceList: string
  product: string
  cash: number
  nonCash: number
}

/** Writes the price into the item (product first, then raw material, by fin_key of the name); null = not found. */
export async function createPriceListEntry(input: PriceListEntryInput): Promise<PriceListEntry | null | "price_list_not_found"> {
  await ensurePriceListsSchema()
  return withTransaction(async (tx) => {
    const list = (await tx.prepare("SELECT name, currency FROM price_lists WHERE fin_key(name) = fin_key(?) ORDER BY id LIMIT 1").get(input.priceList)) as
      | { name: string; currency: string | null }
      | undefined
    if (!list) return "price_list_not_found"
    const item =
      ((await tx.prepare("SELECT 'product' AS kind, id FROM products WHERE fin_key(name) = fin_key(?) AND COALESCE(deleted, 0) = 0 ORDER BY id LIMIT 1").get(input.product)) as
        | { kind: "product"; id: number }
        | undefined) ??
      ((await tx
        .prepare("SELECT 'raw_material' AS kind, id FROM raw_materials r WHERE fin_key(name) = fin_key(?) AND COALESCE(to_jsonb(r)->>'deleted', '0') = '0' ORDER BY id LIMIT 1")
        .get(input.product)) as
        | { kind: "raw_material"; id: number }
        | undefined)
    if (!item) return null
    const currency = list.currency || undefined
    const result = await setItemPrices(tx, item.kind, Number(item.id), [{ priceList: list.name, cash: input.cash, nonCash: input.nonCash, currency, nonCashCurrency: currency }], {
      live: true,
    })
    if (!result) return null
    return { id: Number(item.id), priceList: list.name, product: result.name, cash: input.cash, nonCash: input.nonCash }
  })
}
