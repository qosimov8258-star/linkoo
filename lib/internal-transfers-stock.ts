import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { getWarehouseItemCosts } from "@/lib/stock/costs"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"
import { unitWeightKg, type StockPickRow, type StockShortage } from "@/lib/internal-transfers-types"

// "Available in the warehouse" for the transfer and write-off documents, from
// the stock core (getStockBalances / getStockPending / getStockCatalog):
// Доступно = on hand − defects − reserved, as the demo's pickers show it; Брак
// (defective units) can only leave through lines flagged "defect", up to the
// defects on hand. A document must fit on its own day, today AND after every
// movement already booked for a later day (a give or write-off dated ahead
// must not let the same goods be spent twice), so the available quantity is
// the smallest of those balances. Costs are the cost of goods
// (lib/stock/costs.ts) at the document's day (the warehouse's own when it is
// its own cost scope).

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

export type ItemStock = {
  qty: number
  defects: number
  reserved: number
  /** Good units that may leave: min over the moments of (on hand − defects) − reserved. */
  available: number
  /** Defective units that may leave (lines flagged "defect"). */
  defectsAvailable: number
  cost: number
}

/** A day after every booked movement (the balance "in the end"). */
const FINAL_DAY = "9999-12-31"

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

/** Stock of every item of one warehouse on `day` (default today): what is on hand today,
 * and what may leave on that day (see the header). */
export async function warehouseStock(warehouse: string, day?: string, db: PgDb = getDb()): Promise<Map<string, ItemStock>> {
  const today = todayIso()
  const docDay = day && day < today ? day : today
  const [latest, onDay, final, pending, costs] = await Promise.all([
    balancesOn(warehouse, today, db),
    docDay < today ? balancesOn(warehouse, docDay, db) : Promise.resolve(null),
    balancesOn(warehouse, FINAL_DAY, db),
    getStockPending({ warehouses: [warehouse] }, db),
    getWarehouseItemCosts({ date: docDay }, db),
  ])
  const reserved = new Map<string, number>()
  const wanted = textKey(warehouse)
  for (const row of pending) if (textKey(row.warehouse) === wanted) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
  const result = new Map<string, ItemStock>()
  const keys = new Set([...latest.keys(), ...(onDay?.keys() ?? []), ...final.keys(), ...reserved.keys()])
  for (const key of keys) {
    const now = latest.get(key)
    const moments = [now, onDay ? onDay.get(key) : now, final.get(key)]
    const good = Math.min(...moments.map((balance) => (balance?.qty ?? 0) - (balance?.defects ?? 0)))
    const defects = Math.min(...moments.map((balance) => balance?.defects ?? 0))
    const r = reserved.get(key) ?? 0
    result.set(key, {
      qty: round6(now?.qty ?? 0),
      defects: round6(now?.defects ?? 0),
      reserved: round6(r),
      available: round6(good - r),
      defectsAvailable: round6(Math.max(0, defects)),
      cost: round6(costs.costOf(key, warehouse) ?? now?.cost ?? 0),
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

/** Lines whose total quantity exceeds what the warehouse has available (good units;
 * lines flagged `defect` against the defective units). */
export function findShortages(
  lines: Array<{ product: string; quantity: number; unit?: string; defect?: boolean }>,
  index: CatalogIndex,
  stock: Map<string, ItemStock>,
): StockShortage[] {
  const need = new Map<string, { key: string; defect: boolean; product: string; unit: string; required: number }>()
  for (const line of lines) {
    if (!(line.quantity > 0)) continue
    // Key as the ledger will book it (by name), so the check matches the movement.
    const key = ledgerKey(index, line.product)
    const defect = Boolean(line.defect)
    const id = `${key}\u0000${defect ? 1 : 0}`
    const current = need.get(id)
    if (current) current.required += line.quantity
    else need.set(id, { key, defect, product: line.product, unit: line.unit || index.byKey.get(key)?.unit || "", required: line.quantity })
  }
  const shortages: StockShortage[] = []
  for (const entry of need.values()) {
    const item = stock.get(entry.key)
    const available = (entry.defect ? item?.defectsAvailable : item?.available) ?? 0
    if (entry.required > available + 1e-9) {
      shortages.push({
        key: entry.key,
        product: entry.defect ? `${entry.product} (брак)` : entry.product,
        unit: entry.unit,
        required: round6(entry.required),
        available: round6(Math.max(0, available)),
        ...(entry.defect ? { defect: true } : {}),
      })
    }
  }
  return shortages
}

// ---------------------------------------------------------------------------
// Warehouses and inventories the documents depend on
// ---------------------------------------------------------------------------

export type WarehouseRef = { name: string; active: boolean }

/** The warehouses-table row of a name (fin_key match; the registry's spelling), or null. */
export async function findWarehouse(db: PgDb, name: string): Promise<WarehouseRef | null> {
  const wanted = textKey(name)
  if (!wanted) return null
  const row = (await db
    .prepare("SELECT name, COALESCE(active, 1) AS active FROM warehouses WHERE fin_key(name) = fin_key(@name) ORDER BY COALESCE(active, 1) DESC, id LIMIT 1")
    .get({ name })) as { name: string; active: number | boolean | null } | undefined
  return row ? { name: String(row.name).trim(), active: row.active === null || Boolean(Number(row.active)) } : null
}

/** Whether a confirmed inventory of `warehouse` counted the stock after `moment` (local
 * "YYYY-MM-DDTHH:mm:ss" of a movement on `day`): one dated after that day, or an
 * end-of-day one of that day confirmed at or after the moment. Undoing the movement
 * would then make the stock differ from the count. */
export async function countedByInventory(db: PgDb, warehouse: string, day: string, moment: string): Promise<boolean> {
  const exists = (await db.prepare("SELECT to_regclass('stock_inventories') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok || !day) return false
  const row = (await db
    .prepare(
      `SELECT 1 AS ok FROM stock_inventories
       WHERE status = 'confirmed' AND fin_key(warehouse) = fin_key(@warehouse)
         AND (fin_ts(inv_date)::date > @day::date
              OR (fin_ts(inv_date)::date = @day::date AND COALESCE(for_day_end, 0) = 1
                  AND COALESCE(fin_ts(NULLIF(btrim(confirmed_at), ''), true), fin_ts(created_at, true)) >= COALESCE(fin_ts(@moment), @day::timestamp)))
       LIMIT 1`,
    )
    .get({ warehouse, day, moment: moment || day })) as { ok: number } | undefined
  return Boolean(row)
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
      weight: unitWeightKg(item?.unit ?? "", item?.weight ?? 0),
      boxSize: item?.boxSize ?? 0,
      qty: s?.qty ?? 0,
      defects: s?.defects ?? 0,
      defectsAvailable: s?.defectsAvailable ?? 0,
      reserved: s?.reserved ?? 0,
      available: s?.available ?? 0,
      cost: round6(s?.cost ?? item?.fallbackCost ?? 0),
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
