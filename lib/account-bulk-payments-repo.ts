import "server-only"

import { z } from "zod"

import { getDb } from "@/lib/db"
import { isIsoDay } from "@/lib/finance/dates"

// Legacy "Групповая оплата" log of the old Долги по счетам page: one amount
// for a list of client ids. The page now posts to /api/balances/group-payment
// (one customer payment per account, cashbox + organization); rows stored here
// are still read by the finance ledger (lib/finance/sources.ts counts the
// amount as a payment of every listed client), so the table and this API stay
// for existing data and external callers.

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

/** Body of POST /api/account-bulk-payments (legacy; the ledger counts
 * `amount` once per client id, in `currency`, on `paymentDate`). */
export const accountBulkPaymentSchema = z.object({
  clientIds: z.array(z.number().int().positive()).min(1),
  currency: z.string().trim().regex(/^([A-Za-z]{2,5})?$/).optional(),
  amount: z.coerce.number().finite().positive(),
  paymentDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isIsoDay(value), "YYYY-MM-DD")
    .optional(),
  comment: z.string().trim().max(500).optional(),
})

/** Client ids of `ids` that do not exist (the payment would count for nobody). */
export async function missingAccountClientIds(ids: number[]): Promise<number[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number }>
  const known = new Set(rows.map((row) => Number(row.id)))
  return ids.filter((id) => !known.has(id))
}

export type AccountBulkPaymentInput = {
  clientIds: number[]
  currency: string
  amount: number
  paymentDate: string
  comment: string
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
