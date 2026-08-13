import "server-only"

import { getDb } from "@/lib/db"
import type { SupplierPaymentRow } from "@/components/analytics/supplier-payments-data"

type Row = {
  id: number
  supplier: string
  created_by: string
  paid_at: string
  organization: string
  amount: number
  currency: "SUM" | "USD"
  cash_amount: number
  kassa: string
  comment: string
  icon: "cash" | "card"
}

function rowToPayment(row: Row): SupplierPaymentRow {
  return {
    id: row.id,
    supplier: row.supplier,
    createdBy: row.created_by,
    paidAt: row.paid_at,
    organization: row.organization,
    amount: row.amount,
    currency: row.currency,
    cashAmount: row.cash_amount,
    kassa: row.kassa,
    comment: row.comment,
    icon: row.icon,
  }
}

export function listSupplierPayments(): SupplierPaymentRow[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM supplier_payments ORDER BY id DESC").all() as Row[]
  return rows.map(rowToPayment)
}
