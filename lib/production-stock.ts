import "server-only"

import type { PgDb } from "@/lib/db"
import { supplyCostLines, type IncomingItem } from "@/components/analytics/supplier-incomings-data"
import { itemKey, type ItemKind } from "@/lib/production-schema"
import { ensureIncomingsSchema } from "@/lib/supplier-incomings-repo"

// There is no per-product stock ledger elsewhere in the schema: warehouse
// documents keep their lines as JSON with product *names*. Production needs
// "available" quantities and an average cost per warehouse, so this derives
// them from those documents plus the production movements themselves.

export type CatalogItem = { key: string; kind: ItemKind; id: number; name: string; unit: string; type: string }
export type StockLine = { qty: number; inQty: number; inValue: number }
export type StockItem = CatalogItem & { available: number; defects: number; cost: number }

type JsonLine = Record<string, unknown>

function parseLines(value: unknown): JsonLine[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as JsonLine[]) : []
  } catch {
    return []
  }
}

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

/** On-hand quantity and incoming value per product name for one warehouse. */
export async function getWarehouseStock(db: PgDb, warehouse: string): Promise<Map<string, StockLine>> {
  const stock = new Map<string, StockLine>()
  const line = (name: unknown) => {
    const key = nameKey(String(name ?? ""))
    let entry = stock.get(key)
    if (!entry) {
      entry = { qty: 0, inQty: 0, inValue: 0 }
      stock.set(key, entry)
    }
    return entry
  }
  const receive = (name: unknown, qty: number, cost: number) => {
    const entry = line(name)
    entry.qty += qty
    if (qty > 0) {
      entry.inQty += qty
      entry.inValue += qty * cost
    }
  }
  if (!warehouse) return stock
  await ensureIncomingsSchema()

  // Only supplies accepted onto the warehouse ("Принять на склад") are stock,
  // costed with their additional expenses spread over the lines.
  const incomings = (await db
    .prepare(
      `SELECT i.items, (SELECT SUM(e.amount) FROM supplier_incoming_expenses e WHERE e.incoming_id = i.id) AS expenses_total
       FROM supplier_incomings i WHERE i.warehouse = ? AND i.status = 'принят'`,
    )
    .all(warehouse)) as Array<{ items: string; expenses_total: number | null }>
  for (const row of incomings) {
    const items = parseLines(row.items).map((item) => ({ ...item, product: String(item.product ?? ""), qty: num(item.qty), cost: num(item.cost) })) as unknown as IncomingItem[]
    for (const line of supplyCostLines({ items, expensesTotal: num(row.expenses_total) })) receive(line.product, line.qty, line.unitCost)
  }

  // A return leaves the warehouse once it has been handed over ("завершен").
  const returns = (await db.prepare("SELECT items FROM supplier_returns WHERE warehouse = ? AND status = 'завершен'").all(warehouse)) as Array<{ items: string }>
  for (const row of returns) for (const item of parseLines(row.items)) line(item.product).qty -= num(item.qty)

  const writeOffs = (await db.prepare("SELECT items FROM write_offs WHERE warehouse = ?").all(warehouse)) as Array<{ items: string }>
  for (const row of writeOffs) for (const item of parseLines(row.items)) line(item.product).qty -= num(item.qty)

  const transfers = (await db
    .prepare("SELECT from_warehouse, to_warehouse, items FROM internal_transfers WHERE (from_warehouse = ? OR to_warehouse = ?) AND status <> 'отменен'")
    .all(warehouse, warehouse)) as Array<{ from_warehouse: string; to_warehouse: string; items: string }>
  for (const row of transfers) {
    for (const item of parseLines(row.items)) {
      const qty = num(item.quantity)
      if (row.from_warehouse === warehouse) line(item.product).qty -= qty
      if (row.to_warehouse === warehouse) receive(item.product, qty, num(item.price))
    }
  }

  // Movements of cancelled batches never happened as far as stock goes.
  const movements = (await db
    .prepare(
      `SELECT m.direction, m.item_name, m.amount, m.cost, m.is_defect
       FROM production_movements m LEFT JOIN production_parties p ON p.id = m.party_id
       WHERE m.warehouse = ? AND (p.id IS NULL OR p.status <> 'cancelled')`,
    )
    .all(warehouse)) as Array<{ direction: string; item_name: string; amount: number; cost: number; is_defect: number }>
  for (const row of movements) {
    if (row.direction === "made") {
      if (!row.is_defect) receive(row.item_name, row.amount, row.cost)
    } else if (row.direction === "raw") {
      line(row.item_name).qty -= row.amount
    } else if (row.direction === "adjust") {
      line(row.item_name).qty += row.amount
    }
  }
  return stock
}

async function fallbackCosts(db: PgDb) {
  const rows = (await db.prepare("SELECT name, cost FROM products WHERE deleted = 0").all()) as Array<{ name: string; cost: number }>
  return new Map(rows.map((row) => [nameKey(row.name), num(row.cost)]))
}

export function averageCost(line: StockLine | undefined, fallback = 0) {
  if (line && line.inQty > 0) return line.inValue / line.inQty
  return fallback
}

/** Every catalog item with its available quantity, defect total and average
 * cost in the given warehouse — the source for raw-material pickers. */
export async function listWarehouseItems(db: PgDb, warehouse: string): Promise<StockItem[]> {
  const [catalog, stock, fallback] = await Promise.all([listCatalog(db), getWarehouseStock(db, warehouse), fallbackCosts(db)])
  const defects = await defectTotals(db, warehouse)
  return catalog.map((item) => {
    const line = stock.get(nameKey(item.name))
    return {
      ...item,
      available: line?.qty ?? 0,
      defects: defects.get(nameKey(item.name)) ?? 0,
      cost: averageCost(line, fallback.get(nameKey(item.name)) ?? 0),
    }
  })
}

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
