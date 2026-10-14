import "server-only"

import type { PgDb } from "@/lib/db"
import { nameKey as warehouseKey } from "@/lib/finance/entities"
import { itemKey, type ItemKind } from "@/lib/production-schema"
import { computeStockBalances } from "@/lib/stock/balances"
import { loadStockCatalog } from "@/lib/stock/catalog"

// Production's view of the stock core (lib/stock): "available" quantities
// and average costs per warehouse for the raw-material / product pickers and
// for costing production movements. The quantities come from the shared
// movement ledger (supplies, supplier returns, write-offs, internal
// transfers, production, stock inventories, orders), so production, "Остаток"
// and the management balance agree. Available = on hand − production defects.
// Average cost = weighted average of every receipt with a known cost across
// all warehouses (falls back to the catalog cost).

export type CatalogItem = { key: string; kind: ItemKind; id: number; name: string; unit: string; type: string }
/** qty = available quantity in the warehouse; inQty / inValue = receipts with
 * a known cost (all warehouses), so inValue / inQty is the average cost. */
export type StockLine = { qty: number; inQty: number; inValue: number }
export type StockItem = CatalogItem & { available: number; defects: number; cost: number }

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function nameKey(name: string) {
  return name.trim().toLocaleLowerCase("ru")
}

export async function listCatalog(db: PgDb): Promise<CatalogItem[]> {
  const products = (await db.prepare("SELECT id, name, unit, type FROM products WHERE deleted = 0 ORDER BY name").all()) as Array<{ id: number; name: string; unit: string; type: string }>
  const rawMaterials = (await db.prepare("SELECT id, name, unit, type FROM raw_materials ORDER BY name").all()) as Array<{ id: number; name: string; unit: string; type: string }>
  return [
    ...rawMaterials.map((row) => ({ key: itemKey("raw_material", row.id), kind: "raw_material" as const, id: row.id, name: row.name, unit: row.unit, type: row.type })),
    ...products.map((row) => ({ key: itemKey("product", row.id), kind: "product" as const, id: row.id, name: row.name, unit: row.unit, type: row.type })),
  ]
}

export async function getCatalogItem(db: PgDb, kind: ItemKind, id: number): Promise<CatalogItem | null> {
  const table = kind === "product" ? "products" : "raw_materials"
  const row = (await db.prepare(`SELECT id, name, unit, type FROM ${table} WHERE id = ?`).get(id)) as
    | { id: number; name: string; unit: string; type: string }
    | undefined
  return row ? { key: itemKey(kind, row.id), kind, id: row.id, name: row.name, unit: row.unit, type: row.type } : null
}

/** Available quantity (on hand − defects) per product name in one warehouse,
 * plus the receipt totals behind each item's average cost. Items received
 * elsewhere but never moved here are included with qty 0 (for their cost). */
export async function getWarehouseStock(db: PgDb, warehouse: string): Promise<Map<string, StockLine>> {
  const stock = new Map<string, StockLine>()
  if (!warehouse) return stock
  const catalog = await loadStockCatalog(db)
  const rows = await computeStockBalances({}, db, catalog)
  const names = new Map(catalog.map((item) => [item.key, item.name]))
  const target = warehouseKey(warehouse)
  for (const row of rows) {
    const name = names.get(row.key) ?? (row.key.startsWith("name:") ? row.key.slice(5) : null)
    if (name === null) continue
    const key = nameKey(name)
    let entry = stock.get(key)
    if (!entry) stock.set(key, (entry = { qty: 0, inQty: row.inQty, inValue: row.inValue }))
    if (row.warehouseKey === target) entry.qty += row.qty - row.defects
  }
  return stock
}

export function averageCost(line: StockLine | undefined, fallback = 0) {
  if (line && line.inQty > 0) return line.inValue / line.inQty
  return fallback
}

/** Every catalog item with its available quantity, defect total and average
 * cost in the given warehouse — the source for raw-material pickers. */
export async function listWarehouseItems(db: PgDb, warehouse: string): Promise<StockItem[]> {
  const [catalog, stock, stockCatalog, defects] = await Promise.all([listCatalog(db), getWarehouseStock(db, warehouse), loadStockCatalog(db), defectTotals(db, warehouse)])
  const fallback = new Map(stockCatalog.map((item) => [item.key, item.fallbackCost]))
  return catalog.map((item) => {
    const line = stock.get(nameKey(item.name))
    return {
      ...item,
      available: line?.qty ?? 0,
      defects: defects.get(nameKey(item.name)) ?? 0,
      cost: averageCost(line, fallback.get(item.key) ?? 0),
    }
  })
}

/** "Брак" shown in the pickers: every defect booked in the warehouse (output
 * and raw material) by batches that were not cancelled. */
async function defectTotals(db: PgDb, warehouse: string) {
  const rows = (await db
    .prepare(
      `SELECT m.item_name, SUM(m.amount) AS total
       FROM production_movements m LEFT JOIN production_parties p ON p.id = m.party_id
       WHERE m.warehouse = ? AND m.is_defect = 1 AND (p.id IS NULL OR p.status <> 'cancelled')
       GROUP BY m.item_name`,
    )
    .all(warehouse)) as Array<{ item_name: string; total: number }>
  return new Map(rows.map((row) => [nameKey(row.item_name), num(row.total)]))
}
