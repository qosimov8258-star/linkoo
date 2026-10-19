import "server-only"

import { getDb } from "@/lib/db"

// Legacy "Ожидаемые оплаты" confirmations. No balance ever read this table,
// so the page no longer writes it: paying an order is POST
// /api/cash/orders/[id]/pay (a customer payment with order_id that reduces the
// order remainder and reaches the client / cashbox balances). Old rows stay
// readable; nothing here creates or deletes rows.

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

function rowToConfirmation(row: Row): ExpectedPaymentConfirmation {
  return {
    id: row.id,
    orderId: row.order_id,
    client: row.client,
    amount: Number(row.amount),
    currency: row.currency,
    date: row.payment_date,
  }
}

export async function listExpectedPaymentConfirmations(): Promise<ExpectedPaymentConfirmation[]> {
  const db = getDb()
  const exists = (await db.prepare("SELECT to_regclass('expected_payment_confirmations') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return []
  return ((await db.prepare("SELECT * FROM expected_payment_confirmations ORDER BY id DESC").all()) as Row[]).map(rowToConfirmation)
}
