import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import type { StatementResult } from "@/lib/finance/types"

// Linko's client / account act (sales/client_transaction/act, «Информация по балансу клиента») shows on every row
// the delivery man written on that transaction — the order's (the one it was booked with first), the payment's, the
// return's, the correction's; «Не указано» without one — names a payment made for an order «Оплата № <order>», and
// an order row only «Заказ № <n>» (the organization has its own column). The shared statement does not carry these,
// so the client / account statement route adds them here.

type Named = { id: number; name: string | null }

export async function withActDetails(statement: StatementResult, db: PgDb = getDb()): Promise<StatementResult> {
  const s = await ensureFinanceSchema(db)
  const idsOf = (source: string) => [...new Set(statement.rows.filter((row) => row.source === source && row.sourceId !== null).map((row) => Number(row.sourceId)))]
  const employee = (id: string) => `(SELECT NULLIF(btrim(e.first_name || ' ' || e.last_name), '') FROM employees e WHERE e.id = ${id})`
  const lookup = async (ids: number[], sql: string): Promise<Map<number, Named & { order_id?: number | null }>> => {
    if (!ids.length) return new Map()
    const rows = (await db.prepare(sql).all({ ids })) as Array<Named & { order_id?: number | null }>
    return new Map(rows.map((row) => [Number(row.id), row]))
  }
  const orderBooked = s.col("orders", "debt_delivery_man_id") ? `${employee("o.debt_delivery_man_id")}, ` : ""
  const payById = s.col("customer_payments", "delivery_man_id") ? `${employee("p.delivery_man_id")}, ` : ""
  const payOrder = s.col("customer_payments", "order_id") ? "p.order_id" : "NULL::int"
  const [orders, payments, returns, corrections] = await Promise.all([
    s.col("orders", "delivery_man")
      ? lookup(idsOf("order"), `SELECT o.id, COALESCE(${orderBooked}NULLIF(btrim(o.delivery_man), '')) AS name FROM orders o WHERE o.id = ANY(@ids::int[])`)
      : Promise.resolve(new Map()),
    s.col("customer_payments", "delivery_man")
      ? lookup(idsOf("customer_payment"), `SELECT p.id, COALESCE(${payById}NULLIF(btrim(p.delivery_man), '')) AS name, ${payOrder} AS order_id FROM customer_payments p WHERE p.id = ANY(@ids::int[])`)
      : Promise.resolve(new Map()),
    s.col("client_returns", "deliverer")
      ? lookup(idsOf("client_return"), "SELECT r.id, NULLIF(btrim(r.deliverer), '') AS name FROM client_returns r WHERE r.id = ANY(@ids::int[])")
      : Promise.resolve(new Map()),
    s.col("client_balance_corrections", "delivery_man")
      ? lookup(idsOf("client_correction"), "SELECT k.id, NULLIF(btrim(k.delivery_man), '') AS name FROM client_balance_corrections k WHERE k.id = ANY(@ids::int[])")
      : Promise.resolve(new Map()),
  ])
  const bySource: Record<string, Map<number, Named & { order_id?: number | null }>> = { order: orders, customer_payment: payments, client_return: returns, client_correction: corrections }
  return {
    ...statement,
    rows: statement.rows.map((row) => {
      const found = row.sourceId === null ? undefined : bySource[row.source]?.get(Number(row.sourceId))
      const next = { ...row, deliverer: found?.name ?? "" }
      if (row.source === "customer_payment" && !row.docNumber && found?.order_id) next.docNumber = String(found.order_id)
      if (row.source === "order" && row.description === row.organization) next.description = ""
      return next
    }),
  }
}
