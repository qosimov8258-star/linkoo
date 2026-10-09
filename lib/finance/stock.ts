import "server-only"

import type { PgDb } from "@/lib/db"
import { supplyCostLines, type IncomingItem } from "@/components/analytics/supplier-incomings-data"
import type { CurrencyContext } from "@/lib/finance/context"
import { nameKey } from "@/lib/finance/entities"
import type { FinanceSchema } from "@/lib/finance/schema"

// Stock value at net cost per warehouse as of given days — the as-of twin of
// getWarehouseStock() in lib/production-stock.ts (same documents and rules:
// accepted supplies incl. their expenses, completed supplier returns,
// write-offs, non-cancelled internal transfers, production movements of
// non-cancelled parties). Value = Σ quantity × average incoming cost
// (fallback products.cost), in base currency. Sales do not reduce stock
// anywhere in the app, so they do not here either.

type Line = { qty: number; inQty: number; inValue: number }
type JsonLine = Record<string, unknown>

type StockEvent =
  | { day: string; warehouse: string; kind: "in"; product: string; qty: number; cost: number }
  | { day: string; warehouse: string; kind: "out"; product: string; qty: number }

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

async function loadEvents(db: PgDb, s: FinanceSchema, cc: CurrencyContext): Promise<StockEvent[]> {
  const events: StockEvent[] = []
  const day = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`
  const rateOf = (currency: string) => cc.rates[currency] ?? 1

  if (s.has("supplier_incomings")) {
    const accepted = s.col("supplier_incomings", "accepted_at") ? "fin_ts(i.accepted_at)" : "NULL"
    const expenses = s.has("supplier_incoming_expenses") ? "(SELECT SUM(e.amount) FROM supplier_incoming_expenses e WHERE e.incoming_id = i.id)" : "0"
    const currency = s.col("supplier_incomings", "currency") ? "i.currency" : "''"
    const rows = (await db
      .prepare(
        `SELECT i.warehouse, i.items, ${expenses} AS expenses_total, COALESCE(fin_cur(${currency}), @base) AS cur,
                ${day(`COALESCE(${accepted}, fin_ts(i.date), fin_ts(i.created_at, true))`)} AS day
         FROM supplier_incomings i WHERE i.status = 'принят'`,
      )
      .all({ base: cc.base })) as Array<{ warehouse: string; items: string; expenses_total: number | null; cur: string; day: string }>
    for (const row of rows) {
      const items = parseLines(row.items).map((item) => ({ ...item, product: String(item.product ?? ""), qty: num(item.qty), cost: num(item.cost) })) as unknown as IncomingItem[]
      const rate = rateOf(row.cur)
      for (const line of supplyCostLines({ items, expensesTotal: num(row.expenses_total) })) {
        events.push({ day: row.day, warehouse: row.warehouse, kind: "in", product: line.product, qty: line.qty, cost: line.unitCost * rate })
      }
    }
  }
  if (s.has("supplier_returns")) {
    const rows = (await db
      .prepare(
        `SELECT warehouse, items, ${day("COALESCE(fin_ts(transfer_time), fin_ts(date), fin_ts(updated_at, true))")} AS day
         FROM supplier_returns WHERE status = 'завершен'`,
      )
      .all()) as Array<{ warehouse: string; items: string; day: string }>
    for (const row of rows) for (const item of parseLines(row.items)) events.push({ day: row.day, warehouse: row.warehouse, kind: "out", product: String(item.product ?? ""), qty: num(item.qty) })
  }
  if (s.has("write_offs")) {
    const rows = (await db
      .prepare(`SELECT warehouse, items, ${day("COALESCE(fin_ts(date), fin_ts(created_at, true))")} AS day FROM write_offs`)
      .all()) as Array<{ warehouse: string; items: string; day: string }>
    for (const row of rows) for (const item of parseLines(row.items)) events.push({ day: row.day, warehouse: row.warehouse, kind: "out", product: String(item.product ?? ""), qty: num(item.qty) })
  }
  if (s.has("internal_transfers")) {
    const rows = (await db
      .prepare(
        `SELECT from_warehouse, to_warehouse, items, ${day("COALESCE(fin_ts(delivered_at), fin_ts(created_at_label), fin_ts(created_at, true))")} AS day
         FROM internal_transfers WHERE status <> 'отменен'`,
      )
      .all()) as Array<{ from_warehouse: string; to_warehouse: string; items: string; day: string }>
    for (const row of rows) {
      for (const item of parseLines(row.items)) {
        const product = String(item.product ?? "")
        const qty = num(item.quantity)
        events.push({ day: row.day, warehouse: row.from_warehouse, kind: "out", product, qty })
        events.push({ day: row.day, warehouse: row.to_warehouse, kind: "in", product, qty, cost: num(item.price) })
      }
    }
  }
  if (s.has("production_movements")) {
    const parties = s.has("production_parties")
    const rows = (await db
      .prepare(
        `SELECT m.warehouse, m.direction, m.item_name, m.amount, m.cost, m.is_defect,
                ${day("COALESCE(fin_ts(m.date), fin_ts(m.created_at, true))")} AS day
         FROM production_movements m ${parties ? "LEFT JOIN production_parties p ON p.id = m.party_id" : ""}
         WHERE ${parties ? "(p.id IS NULL OR p.status <> 'cancelled')" : "true"}`,
      )
      .all()) as Array<{ warehouse: string; direction: string; item_name: string; amount: number; cost: number; is_defect: number; day: string }>
    for (const row of rows) {
      if (row.direction === "made" && !row.is_defect) events.push({ day: row.day, warehouse: row.warehouse, kind: "in", product: row.item_name, qty: num(row.amount), cost: num(row.cost) })
      else if (row.direction === "raw") events.push({ day: row.day, warehouse: row.warehouse, kind: "out", product: row.item_name, qty: num(row.amount) })
      else if (row.direction === "adjust") events.push({ day: row.day, warehouse: row.warehouse, kind: "in", product: row.item_name, qty: num(row.amount), cost: Number.NaN })
    }
  }
  return events
}

/** Stock value (base currency) per warehouse name (nameKey) for each
 * inclusive cut-off day. Events without a parseable date count as always. */
export async function stockValuesAsOf(db: PgDb, s: FinanceSchema, cc: CurrencyContext, days: string[]): Promise<Map<string, Map<string, number>>> {
  const events = await loadEvents(db, s, cc)
  const fallbackRows = (await db.prepare("SELECT name, cost FROM products WHERE deleted = 0").all()) as Array<{ name: string; cost: number }>
  const fallback = new Map(fallbackRows.map((row) => [nameKey(row.name), num(row.cost)]))
  const result = new Map<string, Map<string, number>>()
  for (const cutoff of days) {
    const stock = new Map<string, Map<string, Line>>()
    const line = (warehouse: string, product: string) => {
      const wh = nameKey(warehouse)
      let lines = stock.get(wh)
      if (!lines) stock.set(wh, (lines = new Map()))
      const key = nameKey(product)
      let entry = lines.get(key)
      if (!entry) lines.set(key, (entry = { qty: 0, inQty: 0, inValue: 0 }))
      return entry
    }
    for (const event of events) {
      if (!event.warehouse || (event.day && event.day > cutoff)) continue
      const entry = line(event.warehouse, event.product)
      if (event.kind === "out") {
        entry.qty -= event.qty
        continue
      }
      entry.qty += event.qty
      // "adjust" movements change quantity without carrying a cost.
      if (event.qty > 0 && Number.isFinite(event.cost)) {
        entry.inQty += event.qty
        entry.inValue += event.qty * event.cost
      }
    }
    const values = new Map<string, number>()
    for (const [warehouse, lines] of stock) {
      let value = 0
      for (const [product, entry] of lines) {
        const cost = entry.inQty > 0 ? entry.inValue / entry.inQty : (fallback.get(product) ?? 0)
        value += entry.qty * cost
      }
      values.set(warehouse, value)
    }
    result.set(cutoff, values)
  }
  return result
}
