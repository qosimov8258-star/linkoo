import "server-only"

import type { PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { num } from "@/lib/cash/common"

// What a client still owes on an order ("Ожидаемые оплаты" / pay-order dialog).
// Order total per currency = Σ order_items (qty × price × (1 − discount%)) by
// item currency, else the amounts parsed from orders.amount (same rule as the
// client ledger). Paid = Σ live customer_payments.amount with order_id (debt
// side, accepted or not — the client balance counts them at creation).
// Remaining = total − paid.

export type OrderDueCurrency = { currency: string; total: number; paid: number; remaining: number }

export type OrderDue = {
  id: number
  client: string
  clientId: number | null
  zone: string
  agent: string
  status: string
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  delivery: string
  currencies: OrderDueCurrency[]
}

type DueRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  agent: string
  status: string
  created: string
  delivery: string
  cur: string | null
  total: number | null
  paid: number | null
}

/** Dues of the given orders (all orders when `ids` is null). */
export async function orderDues(db: PgDb, ids: number[] | null, cc: CurrencyContext): Promise<OrderDue[]> {
  const items = ((await db.prepare("SELECT to_regclass('order_items') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  const itemTotals = items
    ? `SELECT oi.order_id AS oid, COALESCE(fin_cur(oi.currency), @base::text) AS cur,
              SUM(oi.quantity::float8 * oi.unit_price::float8 * (1 - COALESCE(oi.discount_percent, 0)::float8 / 100)) AS total
       FROM order_items oi JOIN sel ON sel.id = oi.order_id GROUP BY 1, 2
       UNION ALL `
    : ""
  const noItems = items ? "AND NOT EXISTS (SELECT 1 FROM order_items z WHERE z.order_id = o.id)" : ""
  const rows = (await db
    .prepare(
      `WITH sel AS (SELECT id FROM orders WHERE @all::boolean OR id = ANY(@ids::int[])),
       tot AS (
         ${itemTotals}
         SELECT o.id AS oid, COALESCE(a.currency, @base::text) AS cur, SUM(a.amount) AS total
         FROM orders o JOIN sel ON sel.id = o.id CROSS JOIN LATERAL fin_amounts(o.amount) a WHERE true ${noItems} GROUP BY 1, 2
       ),
       paid AS (
         SELECT p.order_id AS oid, COALESCE(fin_cur(p.currency), @base::text) AS cur, SUM(p.amount::float8) AS paid
         FROM customer_payments p JOIN sel ON sel.id = p.order_id WHERE p.is_deleted = 0 GROUP BY 1, 2
       ),
       cur AS (SELECT oid, cur FROM tot UNION SELECT oid, cur FROM paid),
       ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)
       SELECT o.id, o.client, ck.id AS client_id, o.zone, o.agent, o.status, COALESCE(to_char(fin_ts(o.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS created,
              o.delivery, c.cur, t.total, p.paid
       FROM orders o JOIN sel ON sel.id = o.id
       LEFT JOIN ck ON ck.k = fin_key(o.client)
       LEFT JOIN cur c ON c.oid = o.id
       LEFT JOIN tot t ON t.oid = o.id AND t.cur = c.cur
       LEFT JOIN paid p ON p.oid = o.id AND p.cur = c.cur
       ORDER BY o.id DESC, c.cur`,
    )
    .all({ base: cc.base, all: ids === null, ids: ids ?? [] })) as DueRow[]
  const byId = new Map<number, OrderDue>()
  for (const row of rows) {
    let due = byId.get(row.id)
    if (!due) {
      due = {
        id: row.id,
        client: row.client,
        clientId: row.client_id,
        zone: row.zone ?? "",
        agent: row.agent ?? "",
        status: row.status ?? "",
        createdAt: row.created,
        delivery: row.delivery ?? "",
        currencies: [],
      }
      byId.set(row.id, due)
    }
    if (row.cur) {
      const total = roundMoney(num(row.total))
      const paid = roundMoney(num(row.paid))
      due.currencies.push({ currency: row.cur, total, paid, remaining: roundMoney(total - paid) })
    }
  }
  return [...byId.values()]
}

/** Due of one order, or null. */
export async function orderDue(db: PgDb, id: number, cc: CurrencyContext): Promise<OrderDue | null> {
  const [due] = await orderDues(db, [id], cc)
  return due ?? null
}
