import "server-only"

import { getDb } from "@/lib/db"
import type { PaymentRow } from "@/components/analytics/customer-payments-data"

type Row = {
  id: number
  client: string
  client_code: string | null
  created_by: string
  paid_at: string
  accepted_at: string
  agent: string
  organization: string
  amount: number
  currency: "SUM" | "USD"
  amount_sum_equivalent: number | null
  cash_amount: number
  kassa: string
  accepted: number
  comment: string
  icon: "cash" | "card"
}

function rowToPayment(row: Row): PaymentRow {
  return {
    id: row.id,
    client: row.client,
    clientCode: row.client_code ?? undefined,
    createdBy: row.created_by,
    paidAt: row.paid_at,
    acceptedAt: row.accepted_at,
    agent: row.agent,
    organization: row.organization,
    amount: row.amount,
    currency: row.currency,
    amountSumEquivalent: row.amount_sum_equivalent ?? undefined,
    cashAmount: row.cash_amount,
    kassa: row.kassa,
    accepted: row.accepted === 1,
    comment: row.comment,
    icon: row.icon,
  }
}

export type PaymentPatch = Partial<{
  accepted: boolean
  acceptedAt: string
  kassa: string
  comment: string
}>

export async function listCustomerPayments(): Promise<PaymentRow[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM customer_payments ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToPayment)
}

export async function getCustomerPayment(id: number): Promise<PaymentRow | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM customer_payments WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPayment(row) : null
}

export async function updateCustomerPayment(id: number, patch: PaymentPatch): Promise<PaymentRow | null> {
  const existing = (await getCustomerPayment(id))
  if (!existing) return null

  const merged = { ...existing, ...patch }
  const db = getDb()
  await db.prepare(
        `UPDATE customer_payments SET accepted = @accepted, accepted_at = @acceptedAt, kassa = @kassa,
       comment = @comment, updated_at = datetime('now') WHERE id = @id`,
      ).run({
        id,
        accepted: merged.accepted ? 1 : 0,
        acceptedAt: merged.acceptedAt,
        kassa: merged.kassa,
        comment: merged.comment,
      })
  return (await getCustomerPayment(id))
}

export async function deleteCustomerPayment(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM customer_payments WHERE id = ?").run(id))
  return result.changes > 0
}
