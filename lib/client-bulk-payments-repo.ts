import "server-only"

import { z } from "zod"

import { getDb, type PgDb } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"
import { cashDayOrNull, CashError, MAX_DB_ID, MAX_MONEY } from "@/lib/cash/common"
import { createCashGroupPayment, type CashGroupPaymentResult } from "@/lib/cash/group-payment"

// Legacy "Групповая оплата" rows of Баланс клиентов (one amount for N client
// ids, counted per client by the finance ledger as a payment). The page saves
// group payments through POST /api/balances/group-payment (customer_payments
// with a cashbox receipt). The legacy POST no longer writes this table: it
// requires a cashbox and creates the same cash-core group income (one
// customer payment of `amount` per client, received into the cashbox), so a
// client is never credited without money in a cashbox. Rows already stored
// here stay readable and can be cancelled (DELETE /api/client-bulk-payments/[id]:
// soft delete with the amount moved to cancelled_amount, so the ledger stops
// counting it).

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

const DDL = `
CREATE TABLE IF NOT EXISTS client_bulk_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ids TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'sum',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_date TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE client_bulk_payments ADD COLUMN IF NOT EXISTS is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_bulk_payments ADD COLUMN IF NOT EXISTS deleted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE client_bulk_payments ADD COLUMN IF NOT EXISTS deleted_by TEXT NOT NULL DEFAULT '';
-- Amount of a cancelled row (its amount is set to 0, so every reader stops counting it).
ALTER TABLE client_bulk_payments ADD COLUMN IF NOT EXISTS cancelled_amount DOUBLE PRECISION;
UPDATE client_bulk_payments SET cancelled_amount = amount, amount = 0 WHERE is_deleted = 1 AND cancelled_amount IS NULL;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'client_bulk_payments' AND column_name = 'amount') = 'real' THEN
    -- REAL keeps ~7 significant digits (98 765 432.50 was stored as 98 765 430).
    ALTER TABLE client_bulk_payments ALTER COLUMN amount TYPE double precision;
  END IF;
END $$;
`

/** Bump when DDL changes (the installed promise lives on globalThis across reloads). */
const SCHEMA_VERSION = 3

declare global {
  var __linkoClientBulkPaymentsSchema: { version: number; ready: Promise<void> } | undefined
}

async function ensureSchema(db: PgDb): Promise<void> {
  if (globalThis.__linkoClientBulkPaymentsSchema?.version !== SCHEMA_VERSION) {
    const ready = db.exec(DDL).catch((error: unknown) => {
      globalThis.__linkoClientBulkPaymentsSchema = undefined
      throw error
    })
    globalThis.__linkoClientBulkPaymentsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoClientBulkPaymentsSchema!.ready
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
    amount: Number(row.amount),
    paymentDate: row.payment_date,
    comment: row.comment,
  }
}

const id = z.coerce.number().int().positive().max(MAX_DB_ID)

/** Body of the legacy POST /api/client-bulk-payments: `amount` is paid by EACH
 * listed client into `cashboxId` (credited in `currency`, default the cashbox's). */
export const clientBulkPaymentSchema = z.object({
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
export type ClientBulkPaymentBody = z.infer<typeof clientBulkPaymentSchema>

/** Client ids of `ids` that do not exist (the payment would count for nobody). */
export async function missingClientIds(ids: number[]): Promise<number[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number }>
  const known = new Set(rows.map((row) => Number(row.id)))
  return ids.filter((value) => !known.has(value))
}

/** Stored legacy rows that still count (not cancelled). */
export async function listClientBulkPayments(): Promise<ClientBulkPayment[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db.prepare("SELECT id, client_ids, currency, amount, payment_date, comment FROM client_bulk_payments WHERE is_deleted = 0 ORDER BY id DESC").all()) as Row[]
  ).map(rowToPayment)
}

/** One customer payment per client through the cash core (cashbox receipt included). */
export async function createClientBulkPayment(body: ClientBulkPaymentBody, user: string): Promise<CashGroupPaymentResult> {
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
export async function deleteClientBulkPayment(paymentId: number, user: string): Promise<{ id: number; deleted: boolean }> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(
      "UPDATE client_bulk_payments SET is_deleted = 1, deleted_at = @at, deleted_by = @user, cancelled_amount = amount, amount = 0 WHERE id = @id AND is_deleted = 0",
    )
    .run({ id: paymentId, at: nowLocalIso(), user })
  if (!result.changes) {
    const exists = await db.prepare("SELECT id FROM client_bulk_payments WHERE id = @id").get({ id: paymentId })
    if (!exists) throw new CashError("Оплата не найдена", 404)
  }
  return { id: paymentId, deleted: result.changes > 0 }
}
