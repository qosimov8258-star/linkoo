import "server-only"

import type { PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import type { FinanceSchema } from "@/lib/finance/schema"
import { computeStockBalances } from "@/lib/stock/balances"
import { loadStockCatalog } from "@/lib/stock/catalog"

// Stock value at net cost per warehouse as of given days, read from the stock
// core (lib/stock): the same movement ledger and average cost the "Остаток" /
// "Остаток на определенную дату" pages show. Value = Σ on-hand quantity ×
// average cost of every receipt with a known cost up to that day (all
// warehouses; fallback = catalog cost), in base currency. The schema and
// currency context arguments are kept for the callers; the core resolves both
// itself.

/** Stock value (base currency) per warehouse name (nameKey) for each
 * inclusive cut-off day. */
export async function stockValuesAsOf(db: PgDb, _s: FinanceSchema, _cc: CurrencyContext, days: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>()
  const catalog = await loadStockCatalog(db)
  for (const day of new Set(days)) {
    const values = new Map<string, number>()
    for (const row of await computeStockBalances({ date: day }, db, catalog)) {
      values.set(row.warehouseKey, (values.get(row.warehouseKey) ?? 0) + row.value)
    }
    result.set(day, values)
  }
  return result
}
