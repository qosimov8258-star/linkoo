import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      amount REAL NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      payment_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

export type ClientPayment = {
  id: number
  clientId: number
  clientName: string
  amount: number
  comment: string
  paymentDate: string
  createdAt: string
}

type Row = {
  id: number
  client_id: number
  client_name: string
  amount: number
  comment: string
  payment_date: string
  created_at: string
}

function rowToPayment(row: Row): ClientPayment {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    amount: row.amount,
    comment: row.comment,
    paymentDate: row.payment_date,
    createdAt: row.created_at,
  }
}

export type ClientPaymentInput = {
  clientId: number
  clientName: string
  amount: number
  comment: string
  paymentDate: string
}

export function parseClientPaymentInput(body: unknown): ClientPaymentInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const clientId = typeof value.clientId === "number" ? value.clientId : Number(value.clientId)
  if (!Number.isFinite(clientId)) return null
  const clientName = typeof value.clientName === "string" ? value.clientName.trim() : ""
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const comment = typeof value.comment === "string" ? value.comment.trim() : ""
  const paymentDate = typeof value.paymentDate === "string" && value.paymentDate.trim() ? value.paymentDate.trim() : new Date().toISOString().slice(0, 10)
  return { clientId, clientName, amount, comment, paymentDate }
}

export async function listClientPayments(clientId?: number): Promise<ClientPayment[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = clientId
    ? ((await db.prepare("SELECT * FROM client_payments WHERE client_id = ? ORDER BY id DESC").all(clientId)) as Row[])
    : ((await db.prepare("SELECT * FROM client_payments ORDER BY id DESC").all()) as Row[])
  return rows.map(rowToPayment)
}

export async function createClientPayment(input: ClientPaymentInput): Promise<ClientPayment> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO client_payments (client_id, client_name, amount, comment, payment_date)
       VALUES (@clientId, @clientName, @amount, @comment, @paymentDate)`,
      )
      .run(input))
  const row = (await db.prepare("SELECT * FROM client_payments WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToPayment(row)
}
