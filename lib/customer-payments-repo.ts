import "server-only"

import { getDb } from "@/lib/db"
import { deleteCustomerPayment as softDeleteCustomerPayment } from "@/lib/cash/customer-payments"
import { ensureCashSchema } from "@/lib/cash/schema"
import { selectedBranchName } from "@/lib/selected-branch"

// Legacy flat API of customer_payments (/api/customer-payments). The page
// "Оплаты от клиентов" now uses /api/cash/customer-payments (server paging,
// filters, totals) and the cash core; this module only keeps the old routes
// consistent with it: soft-deleted rows are hidden, deleting is soft (through
// the cash core) and accepting into a cashbox is no longer possible here
// (it must go through POST /api/cash/accept-cash so cashbox_id / accept_id /
// the acceptance header are written).

/** One payment of the legacy list (currency = the code stored on the row, from Валюты). */
export type PaymentRow = {
  id: number
  client: string
  clientCode?: string
  createdBy: string
  paidAt: string
  acceptedAt: string
  agent: string
  organization: string
  amount: number
  currency: string
  amountSumEquivalent?: number
  cashAmount: number
  kassa: string
  accepted: boolean
  comment: string
  icon: "cash" | "card"
}

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
  currency: string
  amount_sum_equivalent: number | null
  cash_amount: number
  kassa: string
  accepted: number
  comment: string
  icon: string
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
    amount: Number(row.amount),
    currency: row.currency,
    amountSumEquivalent: row.amount_sum_equivalent ?? undefined,
    cashAmount: Number(row.cash_amount),
    kassa: row.kassa,
    accepted: row.accepted === 1,
    comment: row.comment,
    icon: row.icon === "card" ? "card" : "cash",
  }
}

export type PaymentPatch = Partial<{ comment: string }>

export async function listCustomerPayments(): Promise<PaymentRow[]> {
  const db = getDb()
  await ensureCashSchema(db)
  const branch = await selectedBranchName()
  const rows = (await db.prepare("SELECT * FROM customer_payments WHERE is_deleted = 0 AND (?::text = '' OR branch = ?) ORDER BY id DESC").all(branch, branch)) as Row[]
  return rows.map(rowToPayment)
}

export async function getCustomerPayment(id: number): Promise<PaymentRow | null> {
  const db = getDb()
  await ensureCashSchema(db)
  const row = (await db.prepare("SELECT * FROM customer_payments WHERE id = ? AND is_deleted = 0").get(id)) as Row | undefined
  return row ? rowToPayment(row) : null
}

/** Only the comment can be changed here (amounts: PUT /api/cash/customer-payments/[id]). */
export async function updateCustomerPayment(id: number, patch: PaymentPatch): Promise<PaymentRow | null> {
  const existing = await getCustomerPayment(id)
  if (!existing) return null
  if (patch.comment !== undefined) {
    await getDb()
      .prepare("UPDATE customer_payments SET comment = @comment, updated_at = datetime('now') WHERE id = @id AND is_deleted = 0")
      .run({ id, comment: patch.comment.trim() || "Не указано" })
  }
  return getCustomerPayment(id)
}

/** Soft delete (is_deleted = 1) through the cash core; false when missing or already deleted. */
export async function deleteCustomerPayment(id: number, user: string): Promise<boolean> {
  const existing = await getCustomerPayment(id)
  if (!existing) return false
  return (await softDeleteCustomerPayment(id, user)).deleted
}
