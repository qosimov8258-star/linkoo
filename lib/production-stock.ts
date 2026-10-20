import "server-only"

import type { PgDb } from "@/lib/db"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { lockWarehouseStock, shortageMessage, warehouseStock } from "@/lib/internal-transfers-stock"
import type { StockShortage } from "@/lib/internal-transfers-types"
import { itemKey, ProductionError, textKey, type ItemKind } from "@/lib/production-schema"
import { getItemCosts } from "@/lib/stock/costs"
import { getStockBalances } from "@/lib/stock/ledger"

// Production's view of the stock core (lib/stock): quantities per warehouse
// for the raw-material / product pickers, the stock checks of every
// stock-reducing production movement, and unit costs. Quantities come from
// the shared movement ledger (supplies, supplier returns, write-offs,
// internal transfers, production, stock inventories, orders), so production,
// "Остаток" and the management balance agree. Production movements are
// booked with their exact item key (kind:id), so everything here is keyed
// by item key, not by name.
//   available = on hand − defects − reserved, the smaller of that day and
//               today (a document dated in the past must fit both), exactly
//               what transfers and write-offs check;
//   cost      = the ONE cost of goods (lib/stock/costs.ts) at the end of the day.

export type CatalogItem = { key: string; kind: ItemKind; id: number; name: string; unit: string; type: string }
export type StockItem = CatalogItem & {
  /** What can be consumed / moved out (see above). */
  available: number
  /** On hand at the end of the day, defective units included (what a count finds). */
  onHand: number
  /** Defective units (production brak) included in onHand. */
  stockDefects: number
  /** "Брак" of the pickers: everything booked as defective here by batches that were not cancelled. */
  defects: number
  cost: number
}

function num(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const round6 = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

const RAW_NOT_DELETED = "COALESCE(to_jsonb(raw_materials)->>'deleted', '0') = '0'"

export async function listCatalog(db: PgDb): Promise<CatalogItem[]> {
  const products = (await db.prepare("SELECT id, name, unit, type FROM products WHERE deleted = 0 ORDER BY name").all()) as Array<{ id: number; name: string; unit: string; type: string }>
  const rawMaterials = (await db.prepare(`SELECT id, name, unit, type FROM raw_materials WHERE ${RAW_NOT_DELETED} ORDER BY name`).all()) as Array<{ id: number; name: string; unit: string; type: string }>
  return [
    ...rawMaterials.map((row) => ({ key: itemKey("raw_material", row.id), kind: "raw_material" as const, id: row.id, name: row.name, unit: row.unit, type: row.type })),
    ...products.map((row) => ({ key: itemKey("product", row.id), kind: "product" as const, id: row.id, name: row.name, unit: row.unit, type: row.type })),
  ]
}

/** A product / raw material that can be used in new records (deleted ones are not). */
export async function getCatalogItem(db: PgDb, kind: ItemKind, id: number): Promise<CatalogItem | null> {
  const sql =
    kind === "product"
      ? "SELECT id, name, unit, type FROM products WHERE id = ? AND deleted = 0"
      : `SELECT id, name, unit, type FROM raw_materials WHERE id = ? AND ${RAW_NOT_DELETED}`
  const row = (await db.prepare(sql).get(id)) as { id: number; name: string; unit: string; type: string } | undefined
  return row ? { key: itemKey(kind, row.id), kind, id: row.id, name: row.name, unit: row.unit, type: row.type } : null
}

/** Like getCatalogItem, but a missing item refuses the request (404). */
export async function requireCatalogItem(db: PgDb, kind: ItemKind, id: number): Promise<CatalogItem> {
  const item = await getCatalogItem(db, kind, id)
  if (!item) throw new ProductionError(404, `Товар не найден: ${itemKey(kind, id)}`)
  return item
}

/** The movement day: a real calendar day, not after today. */
export function assertMovementDay(day: string): string {
  if (!isIsoDay(day)) throw new ProductionError(400, "Неверная дата")
  if (day > todayIso()) throw new ProductionError(400, "Дата не может быть позже сегодняшнего дня")
  return day
}

/** The warehouses-table row of a name (matched like the stock core: fin_key), active ones first. */
export async function findWarehouse(db: PgDb, name: string): Promise<{ name: string; active: boolean } | null> {
  const wanted = textKey(name)
  if (!wanted) return null
  const rows = (await db.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM warehouses ORDER BY COALESCE(active, 1) DESC, id").all()) as Array<{ id: number; name: string; active: number }>
  const row = rows.find((entry) => textKey(entry.name) === wanted)
  return row ? { name: String(row.name).trim(), active: Number(row.active) === 1 } : null
}

/** New stock movements need an existing, active warehouse (an inactive one is closed to movements). */
export async function assertWarehouseOpen(db: PgDb, name: string): Promise<void> {
  if (!textKey(name)) throw new ProductionError(400, "У этапа не указан склад")
  const found = await findWarehouse(db, name)
  if (!found) throw new ProductionError(400, "Склад не найден")
  if (!found.active) throw new ProductionError(400, "Склад неактивен")
}

/** On hand (defects included) per item key in one warehouse at the end of `day`. */
export async function warehouseOnHand(db: PgDb, warehouse: string, day: string): Promise<Map<string, { qty: number; defects: number }>> {
  const result = new Map<string, { qty: number; defects: number }>()
  const wanted = textKey(warehouse)
  if (!wanted) return result
  for (const row of await getStockBalances({ warehouses: [warehouse], date: day }, db)) {
    if (textKey(row.warehouse) !== wanted) continue
    const current = result.get(row.key) ?? { qty: 0, defects: 0 }
    current.qty = round6(current.qty + row.qty)
    current.defects = round6(current.defects + row.defects)
    result.set(row.key, current)
  }
  return result
}

/** Every catalog item with its available / on-hand quantity, brak and unit
 * cost in the warehouse at the end of `day` (default today) — the source of
 * the raw-material pickers and of the "Сверить" dialog. */
export async function listWarehouseItems(db: PgDb, warehouse: string, day = todayIso()): Promise<StockItem[]> {
  const hasWarehouse = Boolean(textKey(warehouse))
  const [catalog, stock, onHand, costs, defects] = await Promise.all([
    listCatalog(db),
    hasWarehouse ? warehouseStock(warehouse, day, db) : Promise.resolve(new Map()),
    hasWarehouse ? warehouseOnHand(db, warehouse, day) : Promise.resolve(new Map<string, { qty: number; defects: number }>()),
    getItemCosts({ date: day }, db),
    hasWarehouse ? defectTotals(db, warehouse) : Promise.resolve(new Map<string, number>()),
  ])
  return catalog.map((item) => ({
    ...item,
    available: stock.get(item.key)?.available ?? 0,
    onHand: onHand.get(item.key)?.qty ?? 0,
    stockDefects: onHand.get(item.key)?.defects ?? 0,
    defects: defects.get(item.key) ?? 0,
    cost: round6(costs.get(item.key) ?? 0),
  }))
}

/** "Брак" shown in the pickers: every defect booked in the warehouse (output
 * and raw material) by batches that were not cancelled. */
async function defectTotals(db: PgDb, warehouse: string) {
  const rows = (await db
    .prepare(
      `SELECT m.warehouse, m.item_kind, m.item_id, SUM(m.amount) AS total
       FROM production_movements m LEFT JOIN production_parties p ON p.id = m.party_id
       WHERE m.is_defect = 1 AND (p.id IS NULL OR p.status <> 'cancelled')
       GROUP BY m.warehouse, m.item_kind, m.item_id`,
    )
    .all()) as Array<{ warehouse: string; item_kind: string; item_id: number; total: number }>
  const wanted = textKey(warehouse)
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (textKey(row.warehouse) !== wanted) continue
    const key = itemKey(row.item_kind, row.item_id)
    totals.set(key, round6((totals.get(key) ?? 0) + num(row.total)))
  }
  return totals
}

/** Unit cost per item key at the end of `day` (the shared cost of goods). */
export async function itemCosts(db: PgDb, day: string): Promise<Map<string, number>> {
  return getItemCosts({ date: day }, db)
}

/** A change of the warehouse's available stock caused by a production write:
 * qty > 0 takes stock away (raw use, removing output), qty < 0 gives it back.
 * `defect` needs concern the defective units (removing brak output). */
export type StockNeed = { key: string; name: string; unit: string; qty: number; date: string; defect?: boolean }

/** Locks the warehouse (same lock as transfers / write-offs) and refuses the
 * write with 409 when it would take more than is available — on the day of
 * each movement and today. Good units are checked against what may leave,
 * defective ones against the brak on hand. Runs inside the caller's transaction. */
export async function ensureAvailable(tx: PgDb, warehouse: string, needs: StockNeed[], prefix = ""): Promise<void> {
  if (!needs.some((need) => need.qty > 0)) return
  await lockWarehouseStock(tx, [warehouse])
  const today = todayIso()
  const dayOf = (need: StockNeed) => (isIsoDay(need.date) && need.date < today ? need.date : today)
  const days = [...new Set(needs.map(dayOf))].sort()
  for (const day of days) {
    // Everything booked up to that day must fit (later lines do not exist yet then).
    const required = new Map<string, { key: string; defect: boolean; name: string; unit: string; qty: number }>()
    for (const need of needs) {
      if (dayOf(need) > day) continue
      const id = `${need.key}|${need.defect ? 1 : 0}`
      const current = required.get(id) ?? { key: need.key, defect: Boolean(need.defect), name: need.name, unit: need.unit, qty: 0 }
      current.qty += need.qty
      required.set(id, current)
    }
    if (![...required.values()].some((entry) => entry.qty > 1e-9)) continue
    const stock = await warehouseStock(warehouse, day, tx)
    const shortages: StockShortage[] = []
    for (const entry of required.values()) {
      const item = stock.get(entry.key)
      const available = (entry.defect ? item?.defectsAvailable : item?.available) ?? 0
      if (entry.qty > available + 1e-9) {
        shortages.push({
          key: entry.key,
          product: entry.defect ? `${entry.name} (брак)` : entry.name,
          unit: entry.unit,
          required: round6(entry.qty),
          available: round6(Math.max(0, available)),
          ...(entry.defect ? { defect: true } : {}),
        })
      }
    }
    if (shortages.length) throw new ProductionError(409, `${prefix}${shortageMessage(warehouse, shortages)}`, { shortages, date: day })
  }
}
