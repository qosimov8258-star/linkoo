import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { costsInWarehouse, getWarehouseItemCosts, previousDay } from "@/lib/stock/costs"
import { stockOrphanNames } from "@/lib/stock/level"
import { getStockBalances, getStockCatalog } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"
import type { StockInventoryBalanceRow, StockInventoryBalances } from "@/lib/stock-inventories-types"

// System balances for "Инвентаризация", from the stock core
// (getStockBalances + getStockCatalog): the create dialog's list (demo
// stock/all_balances/?stock&date&for_day_end) and the "Баланс (до)" / cost of
// every counted line (live while pending, frozen on confirm). The cost is the
// cost of goods (lib/stock/costs.ts) at the inventory moment: the end of the
// day, or the end of the previous day for "на начало дня" (the warehouse's own
// when it is its own cost scope).

/** JS twin of fin_key(): lower-cased, trimmed, inner whitespace collapsed. */
export function textKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function round6(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** "name:<key>" (a document line no catalog item matches) → its name. */
export function nameFromKey(key: string): string {
  return key.startsWith("name:") ? key.slice(5) : key
}

export type WarehouseBalance = { qty: number; value: number; cost: number; defects: number }

export type BalanceMoment = {
  warehouse: string
  /** YYYY-MM-DD */
  date: string
  forDayEnd: boolean
  excludeInventoryId?: number
}

export async function loadCatalogMap(db: PgDb = getDb()): Promise<Map<string, StockCatalogItem>> {
  return new Map((await getStockCatalog(db)).map((item) => [item.key, item]))
}

/** Balance per item key in one warehouse ("На начало дня" = start of the day). */
export async function warehouseBalances(moment: BalanceMoment, db: PgDb = getDb()): Promise<Map<string, WarehouseBalance>> {
  const balances = await getStockBalances(
    { warehouses: [moment.warehouse], date: moment.date, startOfDay: !moment.forDayEnd, excludeInventoryId: moment.excludeInventoryId },
    db,
  )
  const wanted = textKey(moment.warehouse)
  const byKey = new Map<string, WarehouseBalance>()
  for (const row of balances) {
    // Documents may spell the warehouse differently ("Склад 1" / "склад 1 ").
    if (textKey(row.warehouse) !== wanted) continue
    const current = byKey.get(row.key)
    if (!current) {
      byKey.set(row.key, { qty: row.qty, value: row.value, cost: row.cost, defects: row.defects })
      continue
    }
    current.qty += row.qty
    current.value += row.value
    current.defects += row.defects
    current.cost = current.qty ? current.value / current.qty : current.cost || row.cost
  }
  return byKey
}

/** Unit cost of a line: the cost of goods at the moment, else the catalog cost. */
export function unitCost(balance: WarehouseBalance | undefined, item: StockCatalogItem | undefined, average?: number): number {
  return round6(average ?? (balance?.cost || item?.fallbackCost || 0))
}

/** Cost of goods per item at the inventory moment, in the inventory's warehouse (its own
 * cost scope's when it has one). */
async function averageCosts(moment: BalanceMoment, db: PgDb): Promise<Map<string, number>> {
  return costsInWarehouse(await getWarehouseItemCosts({ date: moment.forDayEnd ? moment.date : previousDay(moment.date) }, db), moment.warehouse)
}

/** Every catalog item with its system balance (0 when nothing moved) plus the
 * non-catalog keys that have a balance there, sorted by name. */
export async function getInventoryBalances(moment: BalanceMoment): Promise<StockInventoryBalances> {
  const db = getDb()
  const [catalog, balances] = await Promise.all([getStockCatalog(db), warehouseBalances(moment, db)])
  const averages = await averageCosts(moment, db)
  const rows: StockInventoryBalanceRow[] = catalog.map((item) => {
    const balance = balances.get(item.key)
    return {
      key: item.key,
      name: item.name,
      article: item.article,
      type: item.type,
      brand: item.brand,
      unit: item.unit,
      qty: round6(balance?.qty ?? 0),
      cost: unitCost(balance, item, averages.get(item.key)),
      defects: round6(balance?.defects ?? 0),
      inCatalog: true,
    }
  })
  const known = new Set(catalog.map((item) => item.key))
  const orphans = await stockOrphanNames([...balances.keys()].filter((key) => !known.has(key)), db)
  for (const [key, balance] of balances) {
    if (known.has(key) || !round6(balance.qty)) continue
    rows.push({ key, name: orphans.get(key)?.name ?? nameFromKey(key), article: "", type: "", brand: "", unit: "", qty: round6(balance.qty), cost: unitCost(balance, undefined, averages.get(key)), defects: round6(balance.defects), inCatalog: false })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key))
  return { warehouse: moment.warehouse, date: moment.date, forDayEnd: moment.forDayEnd, rows }
}

export type LineSnapshot = { balanceAmount: number; diff: number; cost: number; totalPrice: number }

/** "Баланс (до)", Разница, cost and Сумма of counted lines at the inventory moment. */
export async function snapshotLines(
  moment: BalanceMoment,
  lines: Array<{ key: string; amount: number }>,
  db: PgDb = getDb(),
): Promise<LineSnapshot[]> {
  const [catalog, balances, averages] = await Promise.all([loadCatalogMap(db), warehouseBalances(moment, db), averageCosts(moment, db)])
  return lines.map((line) => {
    const balance = balances.get(line.key)
    const balanceAmount = round6(balance?.qty ?? 0)
    const diff = round6(line.amount - balanceAmount)
    const cost = unitCost(balance, catalog.get(line.key), averages.get(line.key))
    return { balanceAmount, diff, cost, totalPrice: round6(diff * cost) }
  })
}
