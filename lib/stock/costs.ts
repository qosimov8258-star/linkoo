import "server-only"

import { getDb, isolated, isTransactionDb, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { REVALUATION_KIND, type LedgerAverage, type LedgerPosting } from "@/lib/net-cost-ledger"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
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

type CostLedgerCache = {
  fingerprint: string
  ledger: Promise<CostLedger>
  /** Set once the build finished: the only form a transaction may reuse. */
  value?: CostLedger
  /** Built on a transaction's connection (never awaited by anybody else). */
  inTransaction: boolean
}

declare global {
  var __linkoCostLedger: CostLedgerCache | undefined
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

/** The traced cost ledger of the current state of the sources (cached per process).
 *
 * The ledger is a function of what the fingerprint hashes, so a cached one of the same
 * fingerprint is reused whoever built it. A caller inside a transaction (stock writes:
 * ensureAvailable → warehouseStock → getWarehouseItemCosts(tx), holding its warehouse
 * locks) only reuses a FINISHED ledger and otherwise builds its own on its own
 * connection: awaiting a build that runs on the pool (or on another transaction) could
 * wait for a connection that only the waiting transactions can free — the whole server
 * hung that way (C1). Pool callers hold no connection while they wait, so they share an
 * in-flight pool build. */
export async function loadCostLedger(db: PgDb = getDb()): Promise<CostLedger> {
  // The schema first, on its own connection: `db` may be a caller's transaction, and the
  // fingerprint below reads net_cost_entries in it (a lock held until its commit). An
  // install started after that read would wait for the transaction while the transaction
  // waits for the install (buildCostLedger → loadLedgerInputs → ensureNetCostSchema).
  await ensureNetCostSchema()
  const fingerprint = await sourcesFingerprint(db)
  const ownConnection = isTransactionDb(db)
  const cached = globalThis.__linkoCostLedger
  if (cached && cached.fingerprint === fingerprint) {
    if (cached.value) return cached.value
    if (!ownConnection && !cached.inTransaction) return cached.ledger
  }
  const ledger = buildCostLedger(db, fingerprint)
  const entry: CostLedgerCache = { fingerprint, ledger, inTransaction: ownConnection }
  // A transaction's build is published once finished only (nobody waits on its connection).
  if (!ownConnection) globalThis.__linkoCostLedger = entry
  ledger.then(
    (value) => {
      entry.value = value
      if (ownConnection && !globalThis.__linkoCostLedger?.value) globalThis.__linkoCostLedger = entry
    },
    () => {
      if (globalThis.__linkoCostLedger === entry) globalThis.__linkoCostLedger = undefined
    },
  )
  return ledger
}

/** A document's line(s) of one item in the ledger: quantity and value as the ledger
 * moved them (issues < 0), revaluations of the stock on hand excluded. */
export type DocumentLineValue = { qty: number; value: number }

const documentIndexes = new WeakMap<CostLedger, Map<string, DocumentLineValue>>()

/** Key of documentLineValues: the document (source table + id) and the item. */
export const documentLineKey = (docType: string, docId: number, item: StockItemKey) => `${docType}:${docId}|${item}`

/** Every document's movement of every item at the value the cost ledger moved it at
 * (summed over its warehouses / days), keyed by documentLineKey. This is the cost of
 * goods of a sale or a client return, and the cost of a production line, exactly as the
 * stock value changed ("Остаток на определенную дату" in cost mode). Built once per ledger. */
export function documentLineValues(ledger: CostLedger): Map<string, DocumentLineValue> {
  let index = documentIndexes.get(ledger)
  if (index) return index
  index = new Map()
  for (const [item, list] of ledger.postings) {
    for (const posting of list) {
      if (posting.kind === REVALUATION_KIND) continue
      const key = documentLineKey(posting.docType, posting.docId, item)
      const entry = index.get(key) ?? { qty: 0, value: 0 }
      entry.qty += posting.qty
      entry.value += posting.value
      index.set(key, entry)
    }
  }
  documentIndexes.set(ledger, index)
  return index
}

/** Unit cost of a document line in the ledger (|value| ÷ |qty|), undefined when the ledger did not move it. */
export function documentLineUnit(index: Map<string, DocumentLineValue>, docType: string, docId: number, item: StockItemKey): number | undefined {
  const entry = index.get(documentLineKey(docType, docId, item))
  if (!entry || Math.abs(entry.qty) <= 1e-9) return undefined
  return Math.abs(entry.value / entry.qty)
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

/** The cost of goods of catalog items (today): `cost` of each item replaced by getItemCosts
 * when the ledger knows the item. products.cost is only a cache of it, so every reader of
 * the catalog (GET /api/products, the item detail, the catalog list) answers this value.
 * A failing ledger leaves the stored values (logged): the catalog stays readable. */
export async function withCostOfGoods<T extends { id: number; cost: number }>(kind: "product" | "raw_material", items: T[], db: PgDb = getDb()): Promise<T[]> {
  if (!items.length) return items
  let costs: Map<StockItemKey, number>
  try {
    // In a transaction a savepoint: a failing ledger read must not abort the caller's work.
    costs = await isolated(() => getItemCosts({}, db))
  } catch (error) {
    console.error("[stock/costs] cost of goods unavailable for the catalog", error)
    return items
  }
  return items.map((item) => {
    const cost = costs.get(`${kind}:${item.id}`)
    return cost === undefined || !Number.isFinite(cost) || cost === item.cost ? item : { ...item, cost }
  })
}

/** Brings the products.cost cache to the cost of goods (base currency, today) inside `tx`,
 * for the given live products: the "Общий" average of the ledger, or — for an item without
 * ledger history up to today — its initial ("по умолчанию") cost, which is frozen first
 * (initial_cost := cost where still NULL). lib/supplier-incomings-repo.ts
 * refreshProductCostsIn delegates here. Raw materials have no stored cost. */
export async function refreshProductCostCache(tx: PgDb, ids: number[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
  if (!wanted.length) return
  const rows = (await tx
    .prepare("SELECT id, cost, initial_cost FROM products WHERE id = ANY(@ids::int[]) AND COALESCE(deleted, 0) = 0 ORDER BY id FOR UPDATE")
    .all({ ids: wanted })) as Array<{ id: number; cost: number | null; initial_cost: number | null }>
  if (!rows.length) return
  const unfrozen = rows.filter((row) => row.initial_cost === null || row.initial_cost === undefined).map((row) => Number(row.id))
  if (unfrozen.length) await tx.prepare("UPDATE products SET initial_cost = cost WHERE id = ANY(@ids::int[]) AND initial_cost IS NULL").run({ ids: unfrozen })
  const ledger = await loadCostLedger(tx)
  const today = todayIso()
  const targets: number[] = []
  const values: number[] = []
  for (const row of rows) {
    const list = ledger.averages.get(`product:${row.id}`)
    const average = list ? averageOn(list, today) : undefined
    const cost = round6(average ?? (Number(row.initial_cost ?? row.cost) || 0))
    if (!Number.isFinite(cost) || cost === Number(row.cost)) continue
    targets.push(Number(row.id))
    values.push(cost)
  }
  if (!targets.length) return
  await tx
    .prepare(
      `UPDATE products p SET cost = v.cost
         FROM unnest(@ids::int[], @costs::double precision[]) AS v(id, cost)
        WHERE p.id = v.id AND p.cost IS DISTINCT FROM v.cost`,
    )
    .run({ ids: targets, costs: values })
}

/** The day before a YYYY-MM-DD day (costs "на начало дня" = end of the previous day). */
export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
