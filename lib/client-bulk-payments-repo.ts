import "server-only"

import { z } from "zod"

import { getDb } from "@/lib/db"

// Legacy "Групповая оплата" rows of Баланс клиентов (one amount for N client
// ids, counted per client by the finance ledger as a payment). The page now
// saves group payments through POST /api/balances/group-payment
// (customer_payments); this table stays readable for the rows already stored.

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

/** Body of the legacy POST /api/client-bulk-payments (the ledger counts
 * `amount` once per client id, in `currency`, on `paymentDate`). */
export const clientBulkPaymentSchema = z.object({
  clientIds: z.array(z.number().int().positive()).min(1),
  currency: z.string().trim().regex(/^([A-Za-z]{2,5})?$/).optional(),
  amount: z.coerce.number().finite().positive(),
  paymentDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .optional(),
  comment: z.string().trim().max(500).optional(),
})

/** Client ids of `ids` that do not exist (the payment would count for nobody). */
export async function missingClientIds(ids: number[]): Promise<number[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number }>
  const known = new Set(rows.map((row) => Number(row.id)))
  return ids.filter((id) => !known.has(id))
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
