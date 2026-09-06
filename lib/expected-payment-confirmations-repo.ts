import "server-only"

import { getDb } from "@/lib/db"

export type ExpectedPaymentConfirmation = {
  id: number
  orderId: number
  client: string
  amount: number
  currency: string
  date: string
}

type Row = {
  id: number
  order_id: number
  client: string
  amount: number
  currency: string
  payment_date: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS expected_payment_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      payment_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToConfirmation(row: Row): ExpectedPaymentConfirmation {
  return {
    id: row.id,
    orderId: row.order_id,
    client: row.client,
    amount: row.amount,
    currency: row.currency,
    date: row.payment_date,
  }
}

export type ExpectedPaymentConfirmationInput = {
  orderId: number
  client: string
  amount: number
  currency: string
  date: string
}

export async function listExpectedPaymentConfirmations(): Promise<ExpectedPaymentConfirmation[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM expected_payment_confirmations ORDER BY id DESC").all()) as Row[]).map(rowToConfirmation)
}

export async function createExpectedPaymentConfirmation(input: ExpectedPaymentConfirmationInput): Promise<ExpectedPaymentConfirmation> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO expected_payment_confirmations (order_id, client, amount, currency, payment_date)
       VALUES (@orderId, @client, @amount, @currency, @date)`,
      )
      .run(input))
  const row = (await db.prepare("SELECT * FROM expected_payment_confirmations WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToConfirmation(row)
}
