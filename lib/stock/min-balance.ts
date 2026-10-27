import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { stockMovementsSql } from "@/lib/stock/ledger"
import type { StockItemKey } from "@/lib/stock/types"

// "No negative stock on any day" (business rule 8). An outflow booked on a day
// D (or the undo of an inflow booked on D) lowers the balance of EVERY day from
// D on, so it fits only when the smallest end-of-day balance over all those
// days (D itself, every later day with movements — today and the documents
// dated ahead included) covers it. The balance between two movement days is
// constant, so the minimum is taken over D and the days that have movements.
// One query over the stock core's movement ledger (lib/stock/ledger.ts) per
// call, whatever the number of days.

export type MinBalance = {
  /** On hand at the end of today (defective units included). */
  qty: number
  /** Defective units (Брак) on hand at the end of today. */
  defects: number
  /** Smallest end-of-day on-hand quantity (defects included) from the day on. */
  minQty: number
  /** Smallest end-of-day good quantity (on hand − defects) from the day on. */
  minGood: number
  /** Smallest end-of-day defective quantity from the day on. */
  minDefects: number
}

const round6 = (value: number) => {
  const result = Math.round((Number(value) || 0) * 1e6) / 1e6
  return Object.is(result, -0) ? 0 : result
}

/** Per item of one warehouse (fin_key match, like the stock core): today's balance
 * and the smallest end-of-day balances from `fromDay` (YYYY-MM-DD) to the last booked
 * movement. `excludeInventoryId` leaves one confirmed stock inventory out (its own
 * effect, e.g. when checking whether it may be cancelled). Items with no movement in
 * the warehouse are absent (all zero). */
export async function minBalancesFrom(
  warehouse: string,
  fromDay: string,
  db: PgDb = getDb(),
  options: { excludeInventoryId?: number } = {},
): Promise<Map<StockItemKey, MinBalance>> {
  const result = new Map<StockItemKey, MinBalance>()
  if (!String(warehouse ?? "").trim()) return result
  const { sql, params } = await stockMovementsSql({ excludeInventoryId: options.excludeInventoryId }, db)
  const rows = (await db
    .prepare(
      `WITH stk_d AS (
         SELECT m.item_key, m.day, SUM(m.qty) AS qty, COALESCE(SUM(m.qty) FILTER (WHERE m.is_defect = 1), 0) AS defects
         FROM (${sql}) m
         WHERE fin_key(m.warehouse) = fin_key(@stk_mb_wh)
         GROUP BY m.item_key, m.day
       ),
       stk_r AS (
         SELECT item_key, day, qty, defects,
                SUM(qty) OVER w AS run_qty, SUM(defects) OVER w AS run_defects
         FROM stk_d
         WINDOW w AS (PARTITION BY item_key ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
       )
       SELECT item_key,
              COALESCE(SUM(qty) FILTER (WHERE day <= @stk_mb_today), 0) AS qty,
              COALESCE(SUM(defects) FILTER (WHERE day <= @stk_mb_today), 0) AS defects,
              COALESCE(SUM(qty) FILTER (WHERE day <= @stk_mb_from), 0) AS base_qty,
              COALESCE(SUM(defects) FILTER (WHERE day <= @stk_mb_from), 0) AS base_defects,
              MIN(run_qty) FILTER (WHERE day > @stk_mb_from) AS min_qty,
              MIN(run_qty - run_defects) FILTER (WHERE day > @stk_mb_from) AS min_good,
              MIN(run_defects) FILTER (WHERE day > @stk_mb_from) AS min_defects
       FROM stk_r GROUP BY item_key`,
    )
    .all({ ...params, stk_mb_wh: warehouse, stk_mb_from: fromDay, stk_mb_today: todayIso() })) as Array<{
    item_key: string
    qty: number
    defects: number
    base_qty: number
    base_defects: number
    min_qty: number | null
    min_good: number | null
    min_defects: number | null
  }>
  for (const row of rows) {
    const baseQty = Number(row.base_qty) || 0
    const baseDefects = Number(row.base_defects) || 0
    const later = (value: number | null, base: number) => (value === null || value === undefined ? base : Math.min(base, Number(value) || 0))
    result.set(row.item_key, {
      qty: round6(Number(row.qty) || 0),
      defects: round6(Number(row.defects) || 0),
      minQty: round6(later(row.min_qty, baseQty)),
      minGood: round6(later(row.min_good, baseQty - baseDefects)),
      minDefects: round6(later(row.min_defects, baseDefects)),
    })
  }
  return result
}
