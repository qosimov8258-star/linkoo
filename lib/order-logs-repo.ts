import "server-only"

import { getDb } from "@/lib/db"

/** Reference action codes (sales/order_logs): created, updated, given, cancel_given, delivered, undelivered, add_discount, add_bonus, canceled. */
export type OrderLog = {
  id: number
  orderId: number
  action: string
  /** Reference status code "0".."5" the order had when the entry was written. */
  status: string
  comment: string
  totalPrice: number
  currency: string
  payType: string
  createdBy: string
  /** "YYYY-MM-DDTHH:MM:SS" */
  createdAt: string
  market: string
  /** Product lines as they were at that moment (only entries that changed products carry them). */
  products: { productId: number | null; name: string; amount: number; price: number; total: number }[]
}

type Row = {
  id: number
  order_id: number
  action: string
  status: string
  comment: string
  total_price: number
  currency: string
  pay_type_name: string
  created_by: string
  created_at: string
  market_name: string
  snapshot: string
}

let schemaReady: Promise<void> | undefined

function ensureSchema(): Promise<void> {
  schemaReady ??= getDb()
    .exec(
      `CREATE TABLE IF NOT EXISTS order_logs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ref_id INTEGER UNIQUE,
         order_id INTEGER NOT NULL,
         action TEXT NOT NULL DEFAULT 'updated',
         status TEXT NOT NULL DEFAULT '',
         comment TEXT NOT NULL DEFAULT '',
         total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
         currency TEXT NOT NULL DEFAULT 'SUM',
         pay_type_name TEXT NOT NULL DEFAULT '',
         created_by TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL DEFAULT '',
         market_name TEXT NOT NULL DEFAULT '',
         snapshot TEXT NOT NULL DEFAULT '[]'
       );
       CREATE INDEX IF NOT EXISTS order_logs_order_idx ON order_logs (order_id);`,
    )
    .catch((error: unknown) => {
      schemaReady = undefined
      throw error
    })
  return schemaReady
}

function rowToLog(row: Row): OrderLog {
  let products: OrderLog["products"] = []
  try {
    products = JSON.parse(row.snapshot) as OrderLog["products"]
  } catch {}
  return {
    id: row.id,
    orderId: row.order_id,
    action: row.action,
    status: row.status,
    comment: row.comment,
    totalPrice: Number(row.total_price),
    currency: row.currency,
    payType: row.pay_type_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    market: row.market_name,
    products,
  }
}

/** Newest first, like the reference's /sales/order_logs/?order=<id>. */
export async function listOrderLogs(orderId: number): Promise<OrderLog[]> {
  await ensureSchema()
  const rows = (await getDb().prepare("SELECT * FROM order_logs WHERE order_id = ? ORDER BY created_at DESC, id DESC").all(orderId)) as Row[]
  return rows.map(rowToLog)
}

export type OrderLogInput = {
  action: string
  status: string
  comment?: string
  totalPrice?: number
  currency?: string
  payType?: string
  createdBy: string
  market?: string
  products?: OrderLog["products"]
}

export async function addOrderLog(orderId: number, input: OrderLogInput): Promise<OrderLog> {
  await ensureSchema()
  const db = getDb()
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const createdAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const result = await db
    .prepare(
      `INSERT INTO order_logs (order_id, action, status, comment, total_price, currency, pay_type_name, created_by, created_at, market_name, snapshot)
       VALUES (@orderId, @action, @status, @comment, @totalPrice, @currency, @payType, @createdBy, @createdAt, @market, @snapshot)`,
    )
    .run({
      orderId,
      action: input.action,
      status: input.status,
      comment: input.comment ?? "",
      totalPrice: input.totalPrice ?? 0,
      currency: input.currency ?? "SUM",
      payType: input.payType ?? "",
      createdBy: input.createdBy,
      createdAt,
      market: input.market ?? "",
      snapshot: JSON.stringify(input.products ?? []),
    })
  const row = (await db.prepare("SELECT * FROM order_logs WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToLog(row)
}
