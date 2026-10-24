import "server-only"

import { getDb } from "@/lib/db"
import { getOrder } from "@/lib/orders-repo"

export type OrderReturnDoc = {
  id: number
  reason: string
  warehouse: string
  date: string
  amount: number
  currency: string
  /** "0" = waiting for the warehouse, "1" = accepted. */
  status: string
}

export type OrderPayment = {
  id: number
  date: string
  client: string
  user: string
  /** Return document the payment settles ("Возврат № 221"), 0 for a plain payment. */
  returnId: number
  /** Cashbox transaction behind a plain payment ("Транзакция: № 83"), 0 when unknown. */
  txId: number
  kind: number
  comment: string
  amount: number
  orderAmount: number
  currency: string
}

let schemaReady: Promise<void> | undefined

// Reference data (sales/order_return/?order=, sales/debt_transactions/?order=) is loaded by
// scripts/backfill-order-returns-payments-from-reference.mjs; returns made in the app are read from customer_returns.
async function ensureSchema() {
  schemaReady ??= getDb().exec(`
    CREATE TABLE IF NOT EXISTS order_return_docs (
      id integer PRIMARY KEY, order_id integer NOT NULL, created_date text, accepted_date text, warehouse text,
      total_price real, currency text, status text, reason text, comment text, created_by text);
    CREATE TABLE IF NOT EXISTS order_payment_rows (
      id integer PRIMARY KEY, order_id integer NOT NULL, created_date text, client text, user_name text, kind integer,
      return_id integer, tx_id integer, payment_type text, comment text, amount real, order_amount real, currency text)`)
  return schemaReady
}

type DocRow = { id: number; created_date: string; warehouse: string; total_price: number; currency: string; status: string; reason: string }
type PaymentRow = { id: number; created_date: string; client: string; user_name: string; kind: number; return_id: number; tx_id: number; comment: string; amount: number; order_amount: number; currency: string }
type LocalReturnRow = { quantity: number; unit_price: number; discount_percent: number; currency: string; return_date: string; created_at: string; comment: string }

export async function listOrderReturnDocs(orderId: number): Promise<OrderReturnDoc[]> {
  await ensureSchema()
  const db = getDb()
  const docs = ((await db.prepare("SELECT * FROM order_return_docs WHERE order_id = ? ORDER BY id DESC").all(orderId)) as DocRow[]).map((row) => ({
    id: Number(row.id),
    reason: row.reason ?? "",
    warehouse: row.warehouse ?? "",
    date: row.created_date ?? "",
    amount: Number(row.total_price ?? 0),
    currency: row.currency ?? "SUM",
    status: row.status ?? "0",
  }))

  // Returns made in the app: one document per creation moment, waiting for the warehouse.
  const local = (await db.prepare("SELECT * FROM customer_returns WHERE order_id = ? ORDER BY id ASC").all(orderId).catch(() => [])) as LocalReturnRow[]
  if (local.length) {
    const order = await getOrder(orderId)
    const groups = new Map<string, OrderReturnDoc>()
    for (const row of local) {
      const key = row.created_at || row.return_date
      const amount = Number(row.quantity) * Number(row.unit_price) * (1 - Number(row.discount_percent ?? 0) / 100)
      const current = groups.get(key)
      if (current) current.amount += amount
      else groups.set(key, { id: 0, reason: row.comment ?? "", warehouse: order?.stockName ?? "", date: key.replace(" ", "T"), amount, currency: row.currency ?? "SUM", status: "0" })
    }
    docs.unshift(...[...groups.values()].reverse())
  }
  return docs
}

export async function listOrderPayments(orderId: number): Promise<OrderPayment[]> {
  await ensureSchema()
  const rows = (await getDb().prepare("SELECT * FROM order_payment_rows WHERE order_id = ? ORDER BY id ASC").all(orderId)) as PaymentRow[]
  return rows.map((row) => ({
    id: Number(row.id),
    date: row.created_date ?? "",
    client: row.client ?? "",
    user: row.user_name ?? "",
    returnId: Number(row.return_id ?? 0),
    txId: Number(row.tx_id ?? 0),
    kind: Number(row.kind ?? 0),
    comment: row.comment ?? "",
    amount: Number(row.amount ?? 0),
    orderAmount: Number(row.order_amount ?? 0),
    currency: row.currency ?? "SUM",
  }))
}
