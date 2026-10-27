import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import type { LedgerAverage, LedgerPosting } from "@/lib/net-cost-ledger"
import { finKey } from "@/lib/net-cost-sync"
import { loadLedgerInputs, runLedgers, sourcesFingerprint } from "@/lib/net-cost-sync"
import { loadStockCatalog } from "@/lib/stock/catalog"
import type { StockItemKey } from "@/lib/stock/types"

// The ONE cost of goods of the app (contract 1). Every reader of an item's cost
// uses this: Остаток (cost mode), the management balance stock value, the
// price grid / markup, Формирование цен and products.cost, inventory and
// write-off line costs, transfer values. The value is the moving-average net
// cost of the "Себестоимость" ledger (lib/net-cost-ledger.ts), scope "Общий",
// in the base currency, at the end of `date` (default today). Items that never
// moved fall back to the catalog cost.
//
// A warehouse with its own manual cost entry ("Себестоимость" → a warehouse)
// is its own scope from that day: getWarehouseItemCosts adds those warehouses'
// averages, so stock values per warehouse (management balance, Остаток
// values, the lines of documents of that warehouse) equal the ledger's.
//
// The ledger is run once per state of its sources (the same fingerprint the
// "Себестоимость" page uses: every row of every table the stock core reads,
// the manual cost entries, today's date) and kept per process; it also yields
// the value postings that "Остаток на определенную дату" sums (issues at the
// moving average, so begin + Σ movements = end in value too).
//
// Import rule: lib/stock/balances.ts and lib/stock/ledger.ts must not import
// this module (it reads the ledger through them).

export type ItemCostQuery = {
  /** End of this local day (YYYY-MM-DD); default today. */
  date?: string
}

export type CostLedger = {
  fingerprint: string
  /** "Общий" average at the end of every day that had events, per item (by day). */
  averages: Map<StockItemKey, LedgerAverage[]>
  /** Averages of the warehouses that are their own scope: item → fin_key(warehouse) → by day. */
  own: Map<StockItemKey, Map<string, LedgerAverage[]>>
  /** Every value change per item (movements at their ledger value, revaluations). */
  postings: Map<StockItemKey, LedgerPosting[]>
  /** Catalog cost of the items (used when an item has no history up to the date). */
  fallback: Map<StockItemKey, number>
}

declare global {
  var __linkoCostLedger: { fingerprint: string; ledger: Promise<CostLedger> } | undefined
}

const round6 = (value: number) => {
  const result = Math.round((Number(value) || 0) * 1e6) / 1e6
  return Object.is(result, -0) ? 0 : result
}

async function buildCostLedger(db: PgDb, fingerprint: string): Promise<CostLedger> {
  const [inputs, catalog] = await Promise.all([loadLedgerInputs(db), loadStockCatalog(db)])
  const results = runLedgers(inputs, { trace: true })
  const averages = new Map<StockItemKey, LedgerAverage[]>()
  const own = new Map<StockItemKey, Map<string, LedgerAverage[]>>()
  const postings = new Map<StockItemKey, LedgerPosting[]>()
  for (const [key, result] of results) {
    if (result.averages?.length) averages.set(key, result.averages)
    if (result.postings?.length) postings.set(key, result.postings)
    for (const entry of result.ownAverages ?? []) {
      const byWarehouse = own.get(key) ?? new Map<string, LedgerAverage[]>()
      own.set(key, byWarehouse)
      const list = byWarehouse.get(entry.wk) ?? []
      byWarehouse.set(entry.wk, list)
      list.push({ day: entry.day, avg: entry.avg })
    }
  }
  return { fingerprint, averages, own, postings, fallback: new Map(catalog.map((item) => [item.key, item.fallbackCost])) }
}

/** The traced cost ledger of the current state of the sources (cached per process). */
export async function loadCostLedger(db: PgDb = getDb()): Promise<CostLedger> {
  const fingerprint = await sourcesFingerprint(db)
  const cached = globalThis.__linkoCostLedger
  if (cached && cached.fingerprint === fingerprint) return cached.ledger
  const ledger = buildCostLedger(db, fingerprint)
  globalThis.__linkoCostLedger = { fingerprint, ledger }
  ledger.catch(() => {
    if (globalThis.__linkoCostLedger?.ledger === ledger) globalThis.__linkoCostLedger = undefined
  })
  return ledger
}

/** The last average on or before `day` (undefined when the item had no events yet). */
function averageOn(list: LedgerAverage[], day: string): number | undefined {
  let low = 0
  let high = list.length - 1
  let found: number | undefined
  while (low <= high) {
    const middle = (low + high) >> 1
    if (list[middle].day <= day) {
      found = list[middle].avg
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/** Unit cost per item key from a loaded ledger (see getItemCosts). */
export function costsFromLedger(ledger: CostLedger, date?: string): Map<StockItemKey, number> {
  const day = date || todayIso()
  const costs = new Map(ledger.fallback)
  for (const [key, list] of ledger.averages) {
    const average = averageOn(list, day)
    if (average !== undefined) costs.set(key, round6(average))
    else if (!costs.has(key)) costs.set(key, 0)
  }
  return costs
}

/** Unit cost (base currency) per item key at the end of the day. */
export async function getItemCosts(query: ItemCostQuery = {}, db: PgDb = getDb()): Promise<Map<StockItemKey, number>> {
  return costsFromLedger(await loadCostLedger(db), query.date)
}

/** Unit cost of one item; 0 when unknown. */
export async function getItemCost(key: StockItemKey, query: ItemCostQuery = {}, db: PgDb = getDb()): Promise<number> {
  return (await getItemCosts(query, db)).get(key) ?? 0
}

/** Unit costs of the warehouses that are their own cost scope at the end of the day:
 * item key → fin_key(warehouse) → cost (the other warehouses use getItemCosts). */
export function warehouseCostsFromLedger(ledger: CostLedger, date?: string): Map<StockItemKey, Map<string, number>> {
  const day = date || todayIso()
  const result = new Map<StockItemKey, Map<string, number>>()
  for (const [key, byWarehouse] of ledger.own) {
    for (const [wk, list] of byWarehouse) {
      const average = averageOn(list, day)
      if (average === undefined) continue
      const costs = result.get(key) ?? new Map<string, number>()
      result.set(key, costs)
      costs.set(wk, round6(average))
    }
  }
  return result
}

export type WarehouseItemCosts = {
  /** "Общий" cost per item (getItemCosts). */
  costs: Map<StockItemKey, number>
  /** Own-scope warehouses: item → fin_key(warehouse) → cost. */
  byWarehouse: Map<StockItemKey, Map<string, number>>
  /** The cost of an item in a warehouse (its own scope's when it has one). */
  costOf: (key: StockItemKey, warehouse: string) => number | undefined
}

/** Costs at the end of the day with the own-scope warehouses resolved. */
export function warehouseItemCosts(ledger: CostLedger, date?: string): WarehouseItemCosts {
  const costs = costsFromLedger(ledger, date)
  const byWarehouse = warehouseCostsFromLedger(ledger, date)
  return { costs, byWarehouse, costOf: (key, warehouse) => byWarehouse.get(key)?.get(finKey(warehouse)) ?? costs.get(key) }
}

/** Cost per item in one warehouse (its own cost scope's when it has one). */
export function costsInWarehouse(costs: WarehouseItemCosts, warehouse: string): Map<StockItemKey, number> {
  const wanted = finKey(warehouse)
  const result = new Map(costs.costs)
  for (const [key, byWarehouse] of costs.byWarehouse) {
    const own = byWarehouse.get(wanted)
    if (own !== undefined) result.set(key, own)
  }
  return result
}

/** getItemCosts plus the own-scope warehouses (see warehouseItemCosts). */
export async function getWarehouseItemCosts(query: ItemCostQuery = {}, db: PgDb = getDb()): Promise<WarehouseItemCosts> {
  return warehouseItemCosts(await loadCostLedger(db), query.date)
}

/** The day before a YYYY-MM-DD day (costs "на начало дня" = end of the previous day). */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
