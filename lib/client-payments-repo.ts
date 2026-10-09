import "server-only"

import { getDb } from "@/lib/db"
import { createClientCardPayment } from "@/lib/cash/customer-payments"

// "Добавить оплату" of the client card. New payments are customer_payments rows
// (the one table of client money, written through lib/finance/customer-payment.ts):
// not accepted, without a cashbox, so they appear on "Оплаты от клиентов"
// (tab "Не принятые") and in "Принять деньги" until accepted into a cashbox.
// The legacy client_payments table is no longer written; its old rows are
// still listed (the ledger keeps reading them) and are never deleted here.

export type ClientPayment = {
  id: number
  clientId: number
  clientName: string
  amount: number
  currency: string
  comment: string
  paymentDate: string
  createdAt: string
  /** customer_payments (current) or client_payments (legacy rows). */
  source: "customer_payments" | "client_payments"
  accepted: boolean
}

export type ClientPaymentInput = {
  clientId: number
  clientName: string
  amount: number
  comment: string
  paymentDate: string
}

type Row = {
  id: number
  client_id: number
  client_name: string
  amount: number
  currency: string
  comment: string
  payment_date: string
  created_at: string
  source: ClientPayment["source"]
  accepted: number
}

/** Live client payments (newest first), optionally of one client. */
export async function listClientPayments(clientId?: number): Promise<ClientPayment[]> {
  const db = getDb()
  const legacy = ((await db.prepare("SELECT to_regclass('client_payments') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  const legacySql = legacy
    ? `UNION ALL
       SELECT id, client_id, client_name, amount::float8 AS amount, 'SUM' AS currency, comment, payment_date, created_at, 'client_payments' AS source, 0 AS accepted
       FROM client_payments WHERE (@clientId::int IS NULL OR client_id = @clientId::int)`
    : ""
  const rows = (await db
    .prepare(
      `SELECT * FROM (
         SELECT id, client_id, client AS client_name, amount::float8 AS amount, currency, CASE WHEN comment = 'Не указано' THEN '' ELSE comment END AS comment,
                COALESCE(NULLIF(payment_date, ''), paid_at) AS payment_date, created_at, 'customer_payments' AS source, accepted
         FROM customer_payments WHERE is_deleted = 0 AND client_id IS NOT NULL AND (@clientId::int IS NULL OR client_id = @clientId::int)
         ${legacySql}
       ) x ORDER BY created_at DESC, id DESC`,
    )
    .all({ clientId: clientId ?? null })) as Row[]
  return rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    amount: Number(row.amount),
    currency: row.currency || "SUM",
    comment: row.comment ?? "",
    paymentDate: row.payment_date ?? "",
    createdAt: row.created_at,
    source: row.source,
    accepted: Number(row.accepted) === 1,
  }))
}

/** Records a client payment (not accepted, no cashbox) as a customer payment. */
export async function createClientPayment(input: ClientPaymentInput, createdBy: string): Promise<ClientPayment> {
  const created = await createClientCardPayment(
    { clientId: input.clientId, amount: input.amount, comment: input.comment, paymentDate: input.paymentDate },
    createdBy,
  )
  const [payment] = (await listClientPayments(input.clientId)).filter((row) => row.source === "customer_payments" && row.id === created.id)
  return payment
}
