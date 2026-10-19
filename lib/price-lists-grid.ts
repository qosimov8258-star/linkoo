import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { findItemPrice, itemPriceEntries, setItemPrices, type ItemPriceChange, type ItemPriceEntry } from "@/lib/item-prices"
import { optionalNumber, type PriceGridSaveInput } from "@/lib/price-lists-api"
import { priceListsByIds } from "@/lib/price-lists-repo"
import { getStockBalances, getStockCatalog } from "@/lib/stock/ledger"
import type { PriceGridEntry, PriceGridKind, PriceGridResult, PriceGridRow, PriceGridSaveResult } from "@/components/analytics/price-lists-data"

// Price-setting grid "Установить цену в прайс-лист" (demo c9 module 4389 + set-price serializers,
// API sales/price_list_item/add_items_separately/): items (products that are not deleted + raw
// materials) × the chosen price lists, with cash / non-cash price, currencies and min / max.
// Saving writes every item through lib/item-prices.ts in ONE transaction.

type ItemRow = {
  kind: PriceGridKind
  id: number
  name: string
  article: string | null
  barcode: string | null
  type: string | null
  brand: string | null
  unit: string | null
  price_lists: string | null
  price_list: string | null
  cash_price: string | null
  non_cash_price: string | null
}

const ITEMS_SQL = `
  SELECT 'product' AS kind, p.id, p.name, p.article, p.barcode, p.type, p.brand, p.unit, p.price_lists,
         NULL::text AS price_list, NULL::text AS cash_price, NULL::text AS non_cash_price
    FROM products p WHERE COALESCE(p.deleted, 0) = 0
  UNION ALL
  SELECT 'raw_material', r.id, r.name, r.article, r.barcode, r.type, r.brand, r.unit, to_jsonb(r)->>'price_lists',
         to_jsonb(r)->>'price_list', to_jsonb(r)->>'cash_price', to_jsonb(r)->>'non_cash_price'
    FROM raw_materials r`

function itemEntries(row: ItemRow): ItemPriceEntry[] {
  return itemPriceEntries(row.price_lists, { priceList: row.price_list, cashPrice: row.cash_price, nonCashPrice: row.non_cash_price })
}

const clean = (value: string | null) => {
  const text = String(value ?? "").trim()
  return /^(не установлен|не указано|no brand)$/i.test(text) ? "" : text
}

export type PriceGridQuery = {
  priceListIds: number[]
  search: string
  type: string
  brand: string
  kind: PriceGridKind | ""
  page: number
  /** 0 = every matching row (template / markup). */
  pageSize: number
  withCost: boolean
}

export function parsePriceGridQuery(url: string): PriceGridQuery {
  const params = new URL(url).searchParams
  const ids = [...new Set(params.getAll("priceList").flatMap((value) => value.split(/[-,]/)).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 50)
  const kind = params.get("kind")
  const pageSize = Number(params.get("pageSize") ?? 25)
  return {
    priceListIds: ids,
    search: (params.get("search") ?? "").trim().slice(0, 200),
    type: (params.get("type") ?? "").trim(),
    brand: (params.get("brand") ?? "").trim(),
    kind: kind === "product" || kind === "raw_material" ? kind : "",
    page: Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 ? Math.min(5000, Math.floor(pageSize)) : 25,
    withCost: params.get("cost") === "1",
  }
}

/** Average stock cost per item key (value / qty over warehouses with stock), else the catalog cost. */
async function itemCosts(db: PgDb): Promise<Map<string, number>> {
  const [catalog, balances] = await Promise.all([getStockCatalog(db), getStockBalances({}, db)])
  const totals = new Map<string, { qty: number; value: number }>()
  for (const balance of balances) {
    if (!(balance.qty > 0)) continue
    const total = totals.get(balance.key) ?? { qty: 0, value: 0 }
    total.qty += balance.qty
    total.value += balance.value
    totals.set(balance.key, total)
  }
  const costs = new Map<string, number>()
  for (const item of catalog) {
    const total = totals.get(item.key)
    costs.set(item.key, total && total.qty > 0 && total.value > 0 ? Math.round((total.value / total.qty) * 100) / 100 : item.fallbackCost)
  }
  return costs
}

export async function priceGrid(query: PriceGridQuery): Promise<PriceGridResult> {
  const db = getDb()
  const priceLists = (await priceListsByIds(db, query.priceListIds)).sort((a, b) => query.priceListIds.indexOf(a.id) - query.priceListIds.indexOf(b.id))
  const rows = (await db.prepare(ITEMS_SQL).all()) as ItemRow[]
  const needle = query.search.toLowerCase()
  const types = new Set<string>()
  const brands = new Set<string>()
  const matched: ItemRow[] = []
  for (const row of rows) {
    const type = clean(row.type)
    const brand = clean(row.brand)
    if (type) types.add(type)
    if (brand) brands.add(brand)
    if (query.kind && row.kind !== query.kind) continue
    if (query.type && type !== query.type) continue
    if (query.brand && brand !== query.brand) continue
    if (needle && !`${row.name} ${row.article ?? ""} ${row.barcode ?? ""}`.toLowerCase().includes(needle)) continue
    matched.push(row)
  }
  matched.sort((a, b) => a.name.localeCompare(b.name, "ru") || (a.kind === b.kind ? a.id - b.id : a.kind === "product" ? -1 : 1))
  const pageRows = query.pageSize > 0 ? matched.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) : matched
  const costs = query.withCost ? await itemCosts(db) : new Map<string, number>()
  const results = pageRows.map((row): PriceGridRow => {
    const key = `${row.kind}:${row.id}`
    const entries = itemEntries(row)
    const prices: Record<string, PriceGridEntry> = {}
    for (const list of priceLists) {
      const entry = findItemPrice(entries, list.name)
      if (!entry) continue
      prices[String(list.id)] = {
        cash: entry.cash,
        nonCash: entry.nonCash,
        min: entry.min,
        max: entry.max,
        currency: normCurrency(entry.currency, list.currency),
        nonCashCurrency: normCurrency(entry.nonCashCurrency ?? entry.currency, list.currency),
      }
    }
    return {
      kind: row.kind,
      id: Number(row.id),
      key,
      name: row.name,
      article: row.article ?? "",
      barcode: /^не установлен/i.test(row.barcode ?? "") ? "" : (row.barcode ?? ""),
      type: clean(row.type),
      brand: clean(row.brand),
      unit: row.unit ?? "",
      cost: costs.get(key) ?? 0,
      prices,
    }
  })
  return {
    count: matched.length,
    results,
    priceLists: priceLists.map((list) => ({ id: list.id, name: list.name, currency: list.currency })),
    types: [...types].sort((a, b) => a.localeCompare(b, "ru")),
    brands: [...brands].sort((a, b) => a.localeCompare(b, "ru")),
  }
}

export class PriceGridError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Demo POST sales/price_list_item/add_items_separately/: writes the grid in one transaction. */
export async function savePriceGrid(input: PriceGridSaveInput): Promise<PriceGridSaveResult> {
  const ids = [...new Set(input.rows.flatMap((row) => row.prices.map((price) => price.priceListId)))]
  const lists = await priceListsByIds(getDb(), ids)
  const names = new Map(lists.map((list) => [list.id, list.name]))
  const missing = ids.filter((id) => !names.has(id))
  if (missing.length) throw new PriceGridError("Прайс-лист не найден")
  const cashCurrency = normCurrency(input.cashCurrency)
  const nonCashCurrency = normCurrency(input.nonCashCurrency || input.cashCurrency)
  return withTransaction(async (tx) => {
    let updated = 0
    const skipped: PriceGridSaveResult["skipped"] = []
    for (const row of input.rows) {
      const changes: ItemPriceChange[] = []
      for (const price of row.prices) {
        const cash = optionalNumber(price.cash)
        const nonCash = optionalNumber(price.nonCash)
        const min = optionalNumber(price.min)
        const max = optionalNumber(price.max)
        if (cash === undefined && nonCash === undefined && min === undefined && max === undefined) continue
        if ([cash, nonCash, min, max].some((value) => value !== undefined && value < 0)) throw new PriceGridError("Цена не может быть отрицательной")
        changes.push({
          priceList: names.get(price.priceListId)!,
          cash,
          nonCash,
          min,
          max,
          currency: cash !== undefined ? cashCurrency : undefined,
          nonCashCurrency: nonCash !== undefined || cash !== undefined ? nonCashCurrency : undefined,
        })
      }
      if (!changes.length) continue
      const result = await setItemPrices(tx, row.kind, row.id, changes)
      if (!result) skipped.push({ kind: row.kind, id: row.id })
      else if (result.changed) updated += 1
    }
    return { updated, skipped }
  })
}
