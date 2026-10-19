import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"
import type { StockPickRow, StockShortage } from "@/lib/internal-transfers-types"

// "Available in the warehouse" for the transfer and write-off documents, from
// the stock core only (getStockBalances / getStockPending / getStockCatalog):
// Доступно = on hand − defects − reserved, as the demo's pickers show it. A
// document dated in the past must fit both on that day and today, so the
// available quantity is the smaller of the two balances.

/** JS twin of fin_key(): lower-cased, trimmed, inner whitespace collapsed. */
export function textKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function round6(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Serialises stock-changing documents of one warehouse (transaction-scoped lock). */
export async function lockWarehouseStock(tx: PgDb, warehouses: string[]): Promise<void> {
  const keys = [...new Set(warehouses.map(textKey).filter(Boolean))].sort()
  for (const key of keys) await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@k)) AS ok").get({ k: `linko-stock:${key}` })
}

export type ItemStock = { qty: number; defects: number; reserved: number; available: number; cost: number }

async function balancesOn(warehouse: string, date: string, db: PgDb) {
  const wanted = textKey(warehouse)
  const map = new Map<string, { qty: number; defects: number; value: number; cost: number }>()
  for (const row of await getStockBalances({ warehouses: [warehouse], date }, db)) {
    if (textKey(row.warehouse) !== wanted) continue
    const current = map.get(row.key)
    if (!current) map.set(row.key, { qty: row.qty, defects: row.defects, value: row.value, cost: row.cost })
    else {
      current.qty += row.qty
      current.defects += row.defects
      current.value += row.value
    }
  }
  return map
}

/** Stock of every item of one warehouse at the end of `day` (default today). */
export async function warehouseStock(warehouse: string, day?: string, db: PgDb = getDb()): Promise<Map<string, ItemStock>> {
  const today = todayIso()
  const moment = day && day > today ? day : today
  const [latest, onDay, pending] = await Promise.all([
    balancesOn(warehouse, moment, db),
    day && day < today ? balancesOn(warehouse, day, db) : Promise.resolve(null),
    getStockPending({ warehouses: [warehouse] }, db),
  ])
  const reserved = new Map<string, number>()
  const wanted = textKey(warehouse)
  for (const row of pending) if (textKey(row.warehouse) === wanted) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
  const result = new Map<string, ItemStock>()
  const keys = new Set([...latest.keys(), ...(onDay?.keys() ?? []), ...reserved.keys()])
  for (const key of keys) {
    const now = latest.get(key)
    const then = onDay ? onDay.get(key) : now
    const qtyNow = (now?.qty ?? 0) - (now?.defects ?? 0)
    const qtyThen = (then?.qty ?? 0) - (then?.defects ?? 0)
    const free = Math.min(qtyNow, qtyThen)
    const r = reserved.get(key) ?? 0
    result.set(key, {
      qty: round6(now?.qty ?? 0),
      defects: round6(now?.defects ?? 0),
      reserved: round6(r),
      available: round6(free - r),
      cost: round6(now?.cost ?? then?.cost ?? 0),
    })
  }
  return result
}

/** Catalog by key plus a name lookup that matches the core (products first). */
export type CatalogIndex = { byKey: Map<string, StockCatalogItem>; byName: Map<string, StockCatalogItem>; items: StockCatalogItem[] }

export async function catalogIndex(db: PgDb = getDb()): Promise<CatalogIndex> {
  const items = await getStockCatalog(db)
  const byKey = new Map(items.map((item) => [item.key, item]))
  const byName = new Map<string, StockCatalogItem>()
  // getStockCatalog lists products first, then raw materials (same priority as the ledger).
  for (const item of items) {
    const key = textKey(item.name)
    if (key && !byName.has(key)) byName.set(key, item)
  }
  return { byKey, byName, items }
}

/** The stock key the ledger will give a document line (by its name, as the core does). */
export function ledgerKey(index: CatalogIndex, name: string): string {
  const item = index.byName.get(textKey(name))
  return item ? item.key : `name:${textKey(name)}`
}

/** A line as entered: catalog key (picker) or product name (legacy / Excel). */
export type LineRef = { key?: string; product?: string }

/** Canonical item of a line: by key when it is a catalog item, else by name. */
export function resolveLine(index: CatalogIndex, line: LineRef): { key: string; item: StockCatalogItem | undefined; name: string } {
  const byKey = line.key ? index.byKey.get(line.key) : undefined
  if (byKey) return { key: byKey.key, item: byKey, name: byKey.name }
  const name = String(line.product ?? "").trim()
  const item = index.byName.get(textKey(name))
  if (item) return { key: item.key, item, name: item.name }
  return { key: line.key && line.key.startsWith("name:") ? line.key : `name:${textKey(name)}`, item: undefined, name }
}

/** Lines whose total quantity exceeds what the warehouse has available. */
export function findShortages(
  lines: Array<{ product: string; quantity: number; unit?: string }>,
  index: CatalogIndex,
  stock: Map<string, ItemStock>,
): StockShortage[] {
  const need = new Map<string, { product: string; unit: string; required: number }>()
  for (const line of lines) {
    if (!(line.quantity > 0)) continue
    // Key as the ledger will book it (by name), so the check matches the movement.
    const key = ledgerKey(index, line.product)
    const current = need.get(key)
    if (current) current.required += line.quantity
    else need.set(key, { product: line.product, unit: line.unit || index.byKey.get(key)?.unit || "", required: line.quantity })
  }
  const shortages: StockShortage[] = []
  for (const [key, entry] of need) {
    const available = stock.get(key)?.available ?? 0
    if (entry.required > available + 1e-9) shortages.push({ key, product: entry.product, unit: entry.unit, required: round6(entry.required), available: round6(Math.max(0, available)) })
  }
  return shortages
}

const qtyText = (value: number, unit: string) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value).replace(/ /g, " ")}${unit ? ` ${unit}` : ""}`

/** "Недостаточно товара на складе «A»: sndwch — доступно 5 шт, требуется 8 шт; …". */
export function shortageMessage(warehouse: string, shortages: StockShortage[]): string {
  const parts = shortages.slice(0, 5).map((s) => `${s.product} — доступно ${qtyText(s.available, s.unit)}, требуется ${qtyText(s.required, s.unit)}`)
  const more = shortages.length > 5 ? `; … (+${shortages.length - 5})` : ""
  return `Недостаточно товара на складе «${warehouse}»: ${parts.join("; ")}${more}`
}

/** Picker rows of one warehouse: every catalog item with a balance there (and
 * the extra keys, e.g. lines of an edited document), with the price-list price. */
export async function stockPickRows(warehouse: string, options: { priceList?: string; day?: string; includeKeys?: string[] } = {}, db: PgDb = getDb()): Promise<StockPickRow[]> {
  const [index, stock] = await Promise.all([catalogIndex(db), warehouseStock(warehouse, options.day, db)])
  const include = new Set(options.includeKeys ?? [])
  const priceList = String(options.priceList ?? "").trim()
  const rows: StockPickRow[] = []
  const seen = new Set<string>()
  const push = (key: string, item: StockCatalogItem | undefined, s: ItemStock | undefined) => {
    seen.add(key)
    rows.push({
      key,
      name: item?.name ?? key.replace(/^name:/, ""),
      article: item?.article ?? "",
      type: item?.type ?? "",
      brand: item?.brand ?? "",
      unit: item?.unit ?? "",
      weight: item?.weight ?? 0,
      boxSize: item?.boxSize ?? 0,
      qty: s?.qty ?? 0,
      defects: s?.defects ?? 0,
      reserved: s?.reserved ?? 0,
      available: s?.available ?? 0,
      cost: round6(s?.cost || item?.fallbackCost || 0),
      price: priceList && item ? (item.prices[priceList] ?? 0) : 0,
    })
  }
  for (const item of index.items) {
    const s = stock.get(item.key)
    if ((s && (s.qty !== 0 || s.reserved !== 0)) || include.has(item.key)) push(item.key, item, s)
  }
  for (const [key, s] of stock) if (!seen.has(key) && s.qty !== 0) push(key, undefined, s)
  for (const key of include) if (!seen.has(key)) push(key, index.byKey.get(key), stock.get(key))
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key))
  return rows
}
