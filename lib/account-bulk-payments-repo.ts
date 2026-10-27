import "server-only"

import { z } from "zod"

import { getDb, type PgDb } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"
import { cashDayOrNull, CashError, MAX_DB_ID, MAX_MONEY } from "@/lib/cash/common"
import { createCashGroupPayment, type CashGroupPaymentResult } from "@/lib/cash/group-payment"

// Legacy "Групповая оплата" log of the old Долги по счетам page: one amount
// for a list of client ids. The page posts to /api/balances/group-payment (one
// customer payment per account, cashbox + organization). Rows stored here are
// still read by the finance ledger (lib/finance/sources.ts counts the amount as
// a payment of every listed client) unless cancelled (is_deleted = 1, amount
// moved to cancelled_amount). The legacy POST no longer writes this table: it
// requires a cashbox and creates the cash-core group income (one customer
// payment of `amount` per client, received into the cashbox), so no client is
// credited without money.

const DDL = `
CREATE TABLE IF NOT EXISTS account_bulk_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ids TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  payment_date TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE account_bulk_payments ADD COLUMN IF NOT EXISTS is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_bulk_payments ADD COLUMN IF NOT EXISTS deleted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE account_bulk_payments ADD COLUMN IF NOT EXISTS deleted_by TEXT NOT NULL DEFAULT '';
-- Amount of a cancelled row (its amount is set to 0, so every reader stops counting it).
ALTER TABLE account_bulk_payments ADD COLUMN IF NOT EXISTS cancelled_amount DOUBLE PRECISION;
UPDATE account_bulk_payments SET cancelled_amount = amount, amount = 0 WHERE is_deleted = 1 AND cancelled_amount IS NULL;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'account_bulk_payments' AND column_name = 'amount') = 'real' THEN
    ALTER TABLE account_bulk_payments ALTER COLUMN amount TYPE double precision;
  END IF;
END $$;
`

/** Bump when DDL changes (the installed promise lives on globalThis across reloads). */
const SCHEMA_VERSION = 3

declare global {
  var __linkoAccountBulkPaymentsSchema: { version: number; ready: Promise<void> } | undefined
}

async function ensureSchema(db: PgDb): Promise<void> {
  if (globalThis.__linkoAccountBulkPaymentsSchema?.version !== SCHEMA_VERSION) {
    const ready = db.exec(DDL).catch((error: unknown) => {
      globalThis.__linkoAccountBulkPaymentsSchema = undefined
      throw error
    })
    globalThis.__linkoAccountBulkPaymentsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoAccountBulkPaymentsSchema!.ready
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
    amount: Number(row.amount),
    paymentDate: row.payment_date,
    comment: row.comment,
    createdAt: row.created_at,
  }
}

const id = z.coerce.number().int().positive().max(MAX_DB_ID)

/** Body of POST /api/account-bulk-payments (legacy shape + the cashbox that receives the money):
 * `amount` is paid by EACH listed client, credited in `currency` (default the cashbox's). */
export const accountBulkPaymentSchema = z.object({
  clientIds: z.array(z.number().int().positive().max(MAX_DB_ID)).min(1).max(1000),
  cashboxId: z.coerce.number({ error: "Укажите кассу" }).int().positive({ error: "Укажите кассу" }).max(MAX_DB_ID, { error: "Касса не найдена" }),
  currency: z.string().trim().regex(/^([A-Za-z]{2,5})?$/).optional(),
  amount: z.coerce.number().finite().positive().max(MAX_MONEY, { error: "Слишком большая сумма" }),
  paymentDate: z
    .string()
    .trim()
    .refine((value) => value === "" || cashDayOrNull(value) !== null, { error: "Неверная дата" })
    .optional(),
  categoryId: id.optional(),
  organization: z.string().trim().max(255).optional(),
  isVerified: z.boolean().optional(),
  comment: z.string().trim().max(500).optional(),
})
export type AccountBulkPaymentBody = z.infer<typeof accountBulkPaymentSchema>

/** Client ids of `ids` that do not exist (the payment would count for nobody). */
export async function missingAccountClientIds(ids: number[]): Promise<number[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number }>
  const known = new Set(rows.map((row) => Number(row.id)))
  return ids.filter((value) => !known.has(value))
}

/** Stored legacy rows that still count (not cancelled). */
export async function listAccountBulkPayments(): Promise<AccountBulkPayment[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM account_bulk_payments WHERE is_deleted = 0 ORDER BY id DESC").all()) as Row[]).map(rowToPayment)
}

/** One customer payment per client through the cash core (cashbox receipt included). */
export async function createAccountBulkPayment(body: AccountBulkPaymentBody, user: string): Promise<CashGroupPaymentResult> {
  const clientIds = [...new Set(body.clientIds)]
  return createCashGroupPayment(
    {
      date: body.paymentDate || undefined,
      cashboxId: body.cashboxId,
      categoryId: body.categoryId,
      organization: body.organization,
      comment: body.comment,
      isVerified: body.isVerified,
      debtCurrency: body.currency || undefined,
      rows: clientIds.map((clientId) => ({ clientId, amount: body.amount })),
    },
    user,
  )
}

/** Cancels a stored legacy row: soft delete (is_deleted, deleted_at / deleted_by) with
 * the amount moved to cancelled_amount, so the ledger (which reads `amount` of every
 * row) stops counting it while the original stays on record. */
export async function deleteAccountBulkPayment(paymentId: number, user: string): Promise<{ id: number; deleted: boolean }> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(
      "UPDATE account_bulk_payments SET is_deleted = 1, deleted_at = @at, deleted_by = @user, cancelled_amount = amount, amount = 0 WHERE id = @id AND is_deleted = 0",
    )
    .run({ id: paymentId, at: nowLocalIso(), user })
  if (!result.changes) {
    const exists = await db.prepare("SELECT id FROM account_bulk_payments WHERE id = @id").get({ id: paymentId })
    if (!exists) throw new CashError("Оплата не найдена", 404)
  }
  return { id: paymentId, deleted: result.changes > 0 }
}
