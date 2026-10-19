import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { computeStockBalances, computeStockPending, movementsQuery } from "@/lib/stock/balances"
import { loadStockCatalog } from "@/lib/stock/catalog"
import type { StockBalance, StockBalanceQuery, StockCatalogItem, StockPending } from "@/lib/stock/types"

// Stock core contract. The functions below are the ONLY entry points other
// modules use; their implementation lives in lib/stock/** (schema, sources,
// catalog, balances). See scratchpad stock/spec.md for the semantics of every source.

/**
 * SQL of the movement ledger: a SELECT (to be used as a subquery) with columns
 *   day        text  'YYYY-MM-DD' local day of the movement
 *   warehouse  text  warehouse name as written on the document
 *   item_key   text  StockItemKey
 *   qty        double precision  signed quantity
 *   value      double precision  signed value at document cost (0 when unknown)
 *   kind       text  StockMoveKind
 *   doc_type   text  source table, e.g. 'supplier_incomings'
 *   doc_id     integer
 *   is_defect  integer 0/1
 * Callers add their own WHERE / GROUP BY around it. `params` are the named
 * parameters the SQL uses (merge them with your own; keep names prefixed `stk_`).
 */
export async function stockMovementsSql(options: { excludeInventoryId?: number } = {}, db: PgDb = getDb()): Promise<{ sql: string; params: Record<string, unknown> }> {
  const { sql, params } = await movementsQuery(options, db)
  return { sql, params }
}

/** Every product and raw material with the fields the stock pages show. */
export async function getStockCatalog(db: PgDb = getDb()): Promise<StockCatalogItem[]> {
  return loadStockCatalog(db)
}

/** Balance per (item, warehouse) at the given moment; rows with qty = 0 and no movement are omitted. */
export async function getStockBalances(query: StockBalanceQuery = {}, db: PgDb = getDb()): Promise<StockBalance[]> {
  const rows = await computeStockBalances(query, db)
  return rows.map(({ key, warehouse, qty, value, cost, defects }) => ({ key, warehouse, qty, value, cost, defects }))
}

/** Reserved / in-transit quantities per (item, warehouse), current moment only. */
export async function getStockPending(query: { warehouses?: string[] } = {}, db: PgDb = getDb()): Promise<StockPending[]> {
  return computeStockPending(query, db)
}
