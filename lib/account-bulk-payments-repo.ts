import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS account_bulk_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ids TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

export type AccountBulkPayment = {
  id: number
  clientIds: number[]
  currency: string
  amount: number
  paymentDate: string
  comment: string
  createdAt: string
}

type Row = {
  id: number
  client_ids: string
  currency: string
  amount: number
  payment_date: string
  comment: string
  created_at: string
}

function rowToPayment(row: Row): AccountBulkPayment {
  let clientIds: number[] = []
  try {
    const parsed = JSON.parse(row.client_ids) as unknown
    clientIds = Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : []
  } catch {
    clientIds = []
  }
  return {
    id: row.id,
    clientIds,
    currency: row.currency,
    amount: row.amount,
    paymentDate: row.payment_date,
    comment: row.comment,
    createdAt: row.created_at,
  }
}

export type AccountBulkPaymentInput = {
  clientIds: number[]
  currency: string
  amount: number
  paymentDate: string
  comment: string
}

export function parseAccountBulkPaymentInput(body: unknown): AccountBulkPaymentInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const clientIds = Array.isArray(value.clientIds) ? value.clientIds.filter((item): item is number => typeof item === "number") : []
  const currency = typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "sum"
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const paymentDate = typeof value.paymentDate === "string" && value.paymentDate.trim() ? value.paymentDate.trim() : new Date().toISOString().slice(0, 10)
  const comment = typeof value.comment === "string" ? value.comment.trim() : ""
  return { clientIds, currency, amount, paymentDate, comment }
}

export async function listAccountBulkPayments(): Promise<AccountBulkPayment[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM account_bulk_payments ORDER BY id DESC").all()) as Row[]).map(rowToPayment)
}

export async function createAccountBulkPayment(input: AccountBulkPaymentInput): Promise<AccountBulkPayment> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO account_bulk_payments (client_ids, currency, amount, payment_date, comment)
       VALUES (@clientIds, @currency, @amount, @paymentDate, @comment)`,
      )
      .run({
        clientIds: JSON.stringify(input.clientIds),
        currency: input.currency,
        amount: input.amount,
        paymentDate: input.paymentDate,
        comment: input.comment,
      }))
  const row = (await db.prepare("SELECT * FROM account_bulk_payments WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToPayment(row)
}
