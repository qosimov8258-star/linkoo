import "server-only"

import { getDb } from "@/lib/db"

export type ClientBulkPayment = {
  id: number
  clientIds: number[]
  currency: string
  amount: number
  paymentDate: string
  comment: string
}

type Row = {
  id: number
  client_ids: string
  currency: string
  amount: number
  payment_date: string
  comment: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_bulk_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ids TEXT NOT NULL DEFAULT '[]',
      currency TEXT NOT NULL DEFAULT 'sum',
      amount REAL NOT NULL DEFAULT 0,
      payment_date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseClientIds(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []
  } catch {
    return []
  }
}

function rowToPayment(row: Row): ClientBulkPayment {
  return {
    id: row.id,
    clientIds: parseClientIds(row.client_ids),
    currency: row.currency,
    amount: row.amount,
    paymentDate: row.payment_date,
    comment: row.comment,
  }
}

export type ClientBulkPaymentInput = {
  clientIds: number[]
  currency: string
  amount: number
  paymentDate: string
  comment: string
}

export function parseClientBulkPaymentInput(body: unknown): ClientBulkPaymentInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const clientIds = Array.isArray(value.clientIds) ? value.clientIds.filter((item): item is number => typeof item === "number") : []
  const currency = typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "sum"
  const paymentDate = typeof value.paymentDate === "string" && value.paymentDate.trim() ? value.paymentDate.trim() : new Date().toISOString().slice(0, 10)
  const comment = typeof value.comment === "string" ? value.comment.trim() : ""
  return { clientIds, currency, amount, paymentDate, comment }
}

export async function listClientBulkPayments(): Promise<ClientBulkPayment[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, client_ids, currency, amount, payment_date, comment FROM client_bulk_payments ORDER BY id DESC").all()) as Row[]).map(rowToPayment)
}

export async function createClientBulkPayment(input: ClientBulkPaymentInput): Promise<ClientBulkPayment> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO client_bulk_payments (client_ids, currency, amount, payment_date, comment)
       VALUES (@clientIds, @currency, @amount, @paymentDate, @comment)`,
      )
      .run({
        clientIds: JSON.stringify(input.clientIds),
        currency: input.currency,
        amount: input.amount,
        paymentDate: input.paymentDate,
        comment: input.comment,
      }))
  const row = (await db.prepare("SELECT id, client_ids, currency, amount, payment_date, comment FROM client_bulk_payments WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToPayment(row)
}
