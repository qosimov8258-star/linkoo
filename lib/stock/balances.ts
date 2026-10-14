import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { todayIso } from "@/lib/finance/dates"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { stockTables, type StockTables } from "@/lib/stock/schema"
import { buildMovementsSql, buildPendingSql, COST_RECEIPT_FILTER } from "@/lib/stock/sources"
import type { StockBalance, StockBalanceQuery, StockCatalogItem, StockItemKey, StockPending } from "@/lib/stock/types"

// Balances = SUM of the signed movements up to a moment, per (warehouse,
// item). Average cost = weighted average of every receipt with a known cost
// (supply incl. its expenses, non-defective production output, inventory
// surplus at its cost) up to the same moment, across ALL warehouses (a
// transfer moves goods, not value); it falls back to the catalog cost.
// Warehouses are grouped by fin_key(name) and shown with the warehouses
// table's spelling when one matches.

export type StockBalanceRow = StockBalance & {
  /** fin_key of the warehouse name. */
  warehouseKey: string
  /** Receipts with a known cost up to the moment (all warehouses): quantity and value. */
  inQty: number
  inValue: number
}

const round = (value: number, digits = 6) => {
  const factor = 10 ** digits
  const result = Math.round((Number(value) || 0) * factor) / factor
  return Object.is(result, -0) ? 0 : result
}

/** The ledger SQL plus its parameters (see ledger.ts for the contract). */
export async function movementsQuery(
  options: { excludeInventoryId?: number } = {},
  db: PgDb = getDb(),
  tables?: StockTables,
): Promise<{ sql: string; params: Record<string, unknown>; tables: StockTables }> {
  const t = tables ?? (await stockTables(db))
  let base = "SUM"
  let rates: Record<string, number | null> = { SUM: 1 }
  if (t.has("currencies")) {
    const cc = await loadCurrencyContext(db)
    base = cc.base
    rates = cc.rates
  }
  return {
    sql: buildMovementsSql(t),
    params: { stk_base: base, stk_rates: JSON.stringify(rates), stk_exclude_inv: Number(options.excludeInventoryId) || 0 },
    tables: t,
  }
}

/** Canonical warehouse names by fin_key (the warehouses table's spelling). */
function warehouseNamesCte(t: StockTables): string {
  return t.has("warehouses")
    ? "stk_wh AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, name FROM warehouses WHERE fin_key(name) <> '' ORDER BY fin_key(name), id)"
    : "stk_wh AS (SELECT NULL::text AS k, NULL::text AS name WHERE false)"
}

/** Movements of the ledger up to the moment (end of `date`, or its start). */
function momentFilter(t: StockTables, startOfDay: boolean): string {
  if (!startOfDay) return "m.day <= @stk_day"
  // "На начало дня" inventories of that day apply before its other movements.
  const startInventory =
    t.has("stock_inventories") && t.col("stock_inventories", "for_day_end")
      ? ` OR (m.day = @stk_day AND m.doc_type = 'stock_inventories' AND EXISTS (SELECT 1 FROM stock_inventories z WHERE z.id = m.doc_id AND COALESCE(z.for_day_end, 0) = 0))`
      : ""
  return `(m.day < @stk_day${startInventory})`
}

function costOf(row: { in_qty: number | null; in_value: number | null }, fallback: number) {
  const inQty = Number(row.in_qty) || 0
  return inQty > 0 ? (Number(row.in_value) || 0) / inQty : fallback
}

/** Balance rows with the receipt totals behind their average cost. */
export async function computeStockBalances(
  query: StockBalanceQuery = {},
  db: PgDb = getDb(),
  catalog?: StockCatalogItem[],
): Promise<StockBalanceRow[]> {
  const { sql, params, tables: t } = await movementsQuery({ excludeInventoryId: query.excludeInventoryId }, db)
  const warehouses = (query.warehouses ?? []).map((name) => String(name ?? "")).filter((name) => name.trim())
  const whFilter = warehouses.length ? "AND fin_key(warehouse) IN (SELECT fin_key(x) FROM unnest(@stk_whs::text[]) AS x)" : ""
  const rows = (await db
    .prepare(
      `WITH stk_mv AS MATERIALIZED (SELECT m.warehouse, m.item_key, m.qty, m.value, m.kind, m.is_defect FROM (${sql}) m WHERE ${momentFilter(t, Boolean(query.startOfDay))}),
       stk_cost AS (
         SELECT item_key, SUM(value) FILTER (WHERE ${COST_RECEIPT_FILTER}) AS in_value, SUM(qty) FILTER (WHERE ${COST_RECEIPT_FILTER}) AS in_qty
         FROM stk_mv GROUP BY item_key
       ),
       stk_bal0 AS (
         SELECT warehouse, item_key, SUM(qty) AS qty, SUM(qty) FILTER (WHERE is_defect = 1) AS defects FROM stk_mv GROUP BY 1, 2
       ),
       stk_bal AS (
         SELECT fin_key(warehouse) AS wk, MIN(warehouse) AS wh, item_key, SUM(qty) AS qty, COALESCE(SUM(defects), 0) AS defects
         FROM stk_bal0 WHERE fin_key(warehouse) <> '' ${whFilter} GROUP BY 1, 3
       ),
       ${warehouseNamesCte(t)}
       SELECT b.wk, COALESCE(w.name, b.wh) AS warehouse, b.item_key, b.qty, b.defects, c.in_value, c.in_qty
       FROM stk_bal b LEFT JOIN stk_cost c ON c.item_key = b.item_key LEFT JOIN stk_wh w ON w.k = b.wk`,
    )
    .all({ ...params, stk_day: query.date || todayIso(), stk_whs: warehouses })) as Array<{
    wk: string
    warehouse: string
    item_key: string
    qty: number
    defects: number
    in_value: number | null
    in_qty: number | null
  }>
  const items = catalog ?? (await loadStockCatalog(db, t))
  const fallback = new Map(items.map((item) => [item.key, item.fallbackCost]))
  return rows.map((row) => {
    const qty = round(row.qty)
    const cost = costOf(row, fallback.get(row.item_key) ?? 0)
    return {
      key: row.item_key,
      warehouse: row.warehouse,
      warehouseKey: row.wk,
      qty,
      value: round(qty * cost, 4),
      cost: round(cost, 6),
      defects: round(row.defects),
      inQty: round(Number(row.in_qty) || 0),
      inValue: round(Number(row.in_value) || 0, 4),
    }
  })
}

/** Average unit cost per item at the end of `date` (all warehouses), with
 * the catalog fallback for items never received. */
export async function getStockAverageCosts(
  query: { date?: string; startOfDay?: boolean } = {},
  db: PgDb = getDb(),
  catalog?: StockCatalogItem[],
): Promise<Map<StockItemKey, number>> {
  const { sql, params, tables: t } = await movementsQuery({}, db)
  const rows = (await db
    .prepare(
      `SELECT item_key, SUM(value) FILTER (WHERE ${COST_RECEIPT_FILTER}) AS in_value, SUM(qty) FILTER (WHERE ${COST_RECEIPT_FILTER}) AS in_qty
       FROM (${sql}) m WHERE ${momentFilter(t, Boolean(query.startOfDay))} GROUP BY item_key`,
    )
    .all({ ...params, stk_day: query.date || todayIso() })) as Array<{ item_key: string; in_value: number | null; in_qty: number | null }>
  const items = catalog ?? (await loadStockCatalog(db, t))
  const costs = new Map(items.map((item) => [item.key, item.fallbackCost]))
  for (const row of rows) costs.set(row.item_key, costOf(row, costs.get(row.item_key) ?? 0))
  return costs
}

export async function computeStockPending(query: { warehouses?: string[] } = {}, db: PgDb = getDb()): Promise<StockPending[]> {
  const t = await stockTables(db)
  const warehouses = (query.warehouses ?? []).map((name) => String(name ?? "")).filter((name) => name.trim())
  const whFilter = warehouses.length ? "AND fin_key(p.warehouse) IN (SELECT fin_key(x) FROM unnest(@stk_whs::text[]) AS x)" : ""
  const statement = db.prepare(
    `WITH stk_p AS (${buildPendingSql(t)}), ${warehouseNamesCte(t)}
     SELECT COALESCE(MIN(w.name), MIN(p.warehouse)) AS warehouse, p.item_key, SUM(p.reserved) AS reserved, SUM(p.transit) AS transit
     FROM stk_p p LEFT JOIN stk_wh w ON w.k = fin_key(p.warehouse)
     WHERE fin_key(p.warehouse) <> '' ${whFilter}
     GROUP BY fin_key(p.warehouse), p.item_key
     HAVING SUM(p.reserved) <> 0 OR SUM(p.transit) <> 0`,
  )
  const rows = (await (warehouses.length ? statement.all({ stk_whs: warehouses }) : statement.all())) as Array<{
    warehouse: string
    item_key: string
    reserved: number
    transit: number
  }>
  return rows.map((row) => ({ key: row.item_key, warehouse: row.warehouse, reserved: round(row.reserved), transit: round(row.transit) }))
}
