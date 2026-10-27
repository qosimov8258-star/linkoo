import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getFieldSummary, type FieldSummary } from "@/lib/agent-visits-repo"
import { customerPaymentTotals } from "@/lib/cash/customer-payments"
import { acceptedReturnTotals } from "@/lib/client-returns-repo"
import { getDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderCountedSql } from "@/lib/finance/sources"
import { ensureOrdersSchema } from "@/lib/orders-repo"

// Home dashboard (/) cards, computed from the same cores as the money and
// order pages, per currency (never one "primary" currency), by LOCAL day
// (Asia/Tashkent):
// - Продажи: orders the client ledger counts (not Отменен / Не подтвержден)
//   created in the period; the total of an order = its lines (qty × price ×
//   (1 − discount)) per line currency, else its amount text (fin_amounts) —
//   exactly the client ledger's "created" mode.
// - Оплаты: live customer payments of the period (payment day), the same
//   query as Оплаты от клиентов (lib/cash/customer-payments.ts).
// - Возвраты: ACCEPTED client returns of the period (lib/client-returns-repo.ts).
// - АКБ: distinct clients of the counted orders.
// - Продажи в Штуках / Блоках / Весе: Σ quantity of the counted orders' lines,
//   Σ quantity / products.box_amount, Σ quantity × products.weight (kg).

export type CurrencyAmount = { value: number; currency: string }

export type DashboardSummary = {
  begin: string
  end: string
  sales: CurrencyAmount[]
  payments: CurrencyAmount[]
  returns: CurrencyAmount[]
  akb: number
  units: { pieces: number; blocks: number; weight: number }
  field: FieldSummary
  orderStatusCounts: {
    shipped: number
    inTransit: number
    delivered: number
    /** Shipped orders with an accepted client return in the period. */
    cancelledShipped: number
  }
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

const ORDER_DAY = "fin_ts(o.created_at, true)::date"

export async function getDashboardSummary(begin: string, end: string): Promise<DashboardSummary> {
  const db = getDb()
  await ensureOrdersSchema()
  await ensureFinanceSchema(db)
  const baseRow = (await db.prepare("SELECT code FROM currencies ORDER BY is_base DESC, id LIMIT 1").get()) as { code: string } | undefined
  const base = baseRow?.code ?? "SUM"
  // The branch picked in the top bar limits the orders ("" = all branches).
  const branch = await selectedBranchName()
  const params = { from: begin, to: end, base, branch }
  const counted = `o.id IN (SELECT o.id FROM orders o WHERE ${orderCountedSql("o")} AND ${ORDER_DAY} BETWEEN @from::date AND @to::date AND (@branch::text = '' OR o.branch_name = @branch::text))`

  const [salesRows, unitRow, akbRow, statusRows, payments, returns] = await Promise.all([
    db
      .prepare(
        `SELECT cur, SUM(amount)::float8 AS amount FROM (
           SELECT COALESCE(fin_cur(oi.currency), @base::text) AS cur,
                  oi.quantity::float8 * oi.unit_price::float8 * (1 - oi.discount_percent::float8 / 100) AS amount
             FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${counted}
           UNION ALL
           SELECT COALESCE(a.currency, @base::text) AS cur, a.amount::float8
             FROM orders o CROSS JOIN LATERAL fin_amounts(o.amount) a
            WHERE ${counted} AND NOT EXISTS (SELECT 1 FROM order_items z WHERE z.order_id = o.id)
         ) x GROUP BY 1 ORDER BY 1`,
      )
      .all(params) as Promise<Array<{ cur: string; amount: number }>>,
    db
      .prepare(
        `SELECT COALESCE(SUM(oi.quantity), 0)::float8 AS pieces,
                COALESCE(SUM(CASE WHEN COALESCE(p.box_amount, 0) > 0 THEN oi.quantity / p.box_amount ELSE 0 END), 0)::float8 AS blocks,
                COALESCE(SUM(oi.quantity * COALESCE(NULLIF(replace(substring(COALESCE(p.weight, '') FROM '^\\s*([0-9]+(?:[.,][0-9]+)?)'), ',', '.'), '')::float8, 0)), 0)::float8 AS weight
           FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
          WHERE ${counted}`,
      )
      .get(params) as Promise<{ pieces: number; blocks: number; weight: number } | undefined>,
    db
      .prepare(
        `SELECT COUNT(DISTINCT COALESCE(o.client_id::text, 'name:' || fin_key(o.client)))::int AS n
           FROM orders o WHERE ${counted}`,
      )
      .get(params) as Promise<{ n: number } | undefined>,
    db
      .prepare(`SELECT o.status, COUNT(*)::int AS n FROM orders o WHERE ${ORDER_DAY} BETWEEN @from::date AND @to::date AND (@branch::text = '' OR o.branch_name = @branch::text) GROUP BY 1`)
      .all(params) as Promise<Array<{ status: string; n: number }>>,
    customerPaymentTotals({ from: begin, to: end, tab: "all" }),
    acceptedReturnTotals(begin, end, db),
  ])

  const count = (status: string) => statusRows.find((row) => row.status === status)?.n ?? 0
  const inTransit = count("В пути")
  const delivered = count("Доставлено")
  return {
    begin,
    end,
    sales: salesRows.map((row) => ({ currency: row.cur, value: round(row.amount) })).filter((row) => row.value !== 0),
    payments: payments.totals.map((row) => ({ currency: row.currency, value: round(row.total) })).filter((row) => row.value !== 0),
    returns: returns.totals.map((row) => ({ currency: row.currency, value: row.amount })),
    akb: akbRow?.n ?? 0,
    field: await getFieldSummary(begin, end),
    units: {
      pieces: round(unitRow?.pieces ?? 0, 3),
      blocks: round(unitRow?.blocks ?? 0, 2),
      weight: round(unitRow?.weight ?? 0, 3),
    },
    orderStatusCounts: { shipped: inTransit + delivered, inTransit, delivered, cancelledShipped: returns.orders },
  }
}
