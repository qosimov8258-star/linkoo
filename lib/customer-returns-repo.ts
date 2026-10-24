import "server-only"

import { getDb } from "@/lib/db"

export type CustomerReturnLine = {
  productName: string
  quantity: number
  unitPrice: number
  discountPercent?: number
  costPrice?: number
  currency?: string
}

export type CustomerReturn = {
  id: number
  orderId: number
  productName: string
  quantity: number
  unitPrice: number
  discountPercent: number
  currency: string
  returnDate: string
  comment: string
  createdBy: string
  createdAt: string
}

type Row = {
  id: number
  order_id: number
  product_name: string
  quantity: number
  unit_price: number
  discount_percent: number
  currency: string
  return_date: string
  comment: string
  created_by: string
  created_at: string
}

let schemaReady: Promise<void> | undefined

async function ensureSchema() {
  schemaReady ??= getDb().exec(`CREATE TABLE IF NOT EXISTS customer_returns (
    id serial PRIMARY KEY, order_id integer NOT NULL, product_name text, quantity real, unit_price real,
    discount_percent real, cost_price real, currency text, return_date text NOT NULL, comment text,
    created_by text, created_at text)`)
  return schemaReady
}

const toReturn = (row: Row): CustomerReturn => ({
  id: row.id,
  orderId: row.order_id,
  productName: row.product_name,
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  discountPercent: Number(row.discount_percent ?? 0),
  currency: row.currency ?? "SUM",
  returnDate: row.return_date,
  comment: row.comment ?? "",
  createdBy: row.created_by ?? "",
  createdAt: row.created_at ?? "",
})

export async function listCustomerReturns(orderId: number): Promise<CustomerReturn[]> {
  await ensureSchema()
  const rows = (await getDb().prepare("SELECT * FROM customer_returns WHERE order_id = ? ORDER BY id ASC").all(orderId)) as Row[]
  return rows.map(toReturn)
}

/** One return document = the lines the client handed back on one day; P&L reads them back as the order's returns. */
export async function createCustomerReturn(orderId: number, lines: CustomerReturnLine[], meta: { comment: string; createdBy: string }): Promise<CustomerReturn[]> {
  await ensureSchema()
  const db = getDb()
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const returnDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const createdAt = `${returnDate} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const created: CustomerReturn[] = []
  for (const line of lines) {
    const result = await db
      .prepare(
        `INSERT INTO customer_returns (order_id, product_name, quantity, unit_price, discount_percent, cost_price, currency, return_date, comment, created_by, created_at)
         VALUES (@orderId, @productName, @quantity, @unitPrice, @discountPercent, @costPrice, @currency, @returnDate, @comment, @createdBy, @createdAt)`,
      )
      .run({
        orderId,
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent ?? 0,
        costPrice: line.costPrice ?? 0,
        currency: line.currency ?? "SUM",
        returnDate,
        comment: meta.comment,
        createdBy: meta.createdBy,
        createdAt,
      })
    const row = (await db.prepare("SELECT * FROM customer_returns WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
    created.push(toReturn(row))
  }
  // The handed-back goods reduce what the order is worth: the card, the debt pages and the balances read these columns.
  const returned = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice * (1 - (line.discountPercent ?? 0) / 100), 0)
  if (returned > 0) {
    await db
      .prepare(
        `UPDATE orders SET return_price = COALESCE(return_price, 0) + @returned,
         fact_price = COALESCE(fact_price, total_price, 0) - @returned,
         order_balance = COALESCE(order_balance, total_price, 0) - @returned WHERE id = @orderId`,
      )
      .run({ orderId, returned })
  }
  return created
}
