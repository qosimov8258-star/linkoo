import "server-only"

import type { PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import type { FinanceSchema } from "@/lib/finance/schema"
import { computeStockBalances } from "@/lib/stock/balances"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { loadCostLedger, warehouseItemCosts } from "@/lib/stock/costs"

// Stock value at net cost per warehouse as of given days, read from the stock
// core (lib/stock): the same movement ledger and cost of goods the "Остаток" /
// "Остаток на определенную дату" pages show. Value = Σ (on-hand quantity −
// Брак) × the item's moving-average cost at the end of that day
// (lib/stock/costs.ts, contract 1; a warehouse that is its own cost scope at
// its own average), in base currency. The schema and currency context
// arguments are kept for the callers; the core resolves both itself.

/** Stock value (base currency) per warehouse name (nameKey) for each
 * inclusive cut-off day. */
export async function stockValuesAsOf(db: PgDb, _s: FinanceSchema, _cc: CurrencyContext, days: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>()
  const [catalog, ledger] = await Promise.all([loadStockCatalog(db), loadCostLedger(db)])
  for (const day of new Set(days)) {
    const values = new Map<string, number>()
    const { costs, byWarehouse } = warehouseItemCosts(ledger, day)
    for (const row of await computeStockBalances({ date: day }, db, catalog, costs, byWarehouse)) {
      values.set(row.warehouseKey, (values.get(row.warehouseKey) ?? 0) + row.value)
    }
    result.set(day, values)
  }
  return result
}
