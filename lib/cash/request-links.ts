import "server-only"

import type { PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { CashError, num } from "@/lib/cash/common"
import type { MoneyRequestLog, MoneyRequestStatus } from "@/lib/cash/types"

// Money requests ("Запрос средств", demo finance/money_request) live in
// supplier_balance_transactions with kind 'fund_request'. These helpers move a
// request between "approved" and "given" when a supplier payment pays it (or
// stops paying it); the full lifecycle is in lib/cash/money-requests.ts.

export type FundRequestRow = {
  id: number
  supplier_id: number
  currency: string
  amount: number
  comment: string
  status: string
  created_by: string
  created_at: string
  date: string
  responsible_user: string
  approved_at: string
  payment_id: number | null
  log: string
}

/** '' → pending, legacy 'rejected' → cancelled. */
export function requestStatus(value: string | null | undefined): MoneyRequestStatus {
  if (value === "approved" || value === "given" || value === "cancelled") return value
  if (value === "rejected") return "cancelled"
  return "pending"
}

export function parseLog(value: string | null | undefined): MoneyRequestLog[] {
  try {
    const list = JSON.parse(value || "[]")
    return Array.isArray(list) ? (list as MoneyRequestLog[]) : []
  } catch {
    return []
  }
}

export function appendLog(value: string | null | undefined, entry: Omit<MoneyRequestLog, "at">): string {
  return JSON.stringify([...parseLog(value), { ...entry, at: nowLocalIso() }])
}

export async function lockFundRequest(tx: PgDb, id: number): Promise<FundRequestRow> {
  const exists = (await tx.prepare("SELECT to_regclass('supplier_balance_transactions') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = exists.ok
    ? ((await tx.prepare("SELECT * FROM supplier_balance_transactions WHERE id = @id AND kind = 'fund_request' FOR UPDATE").get({ id })) as FundRequestRow | undefined)
    : undefined
  if (!row) throw new CashError("Запрос не найден", 404, "moneyRequest")
  return { ...row, amount: Math.abs(num(row.amount)), currency: normCurrency(row.currency) }
}

/** Marks an approved request as paid by supplier payment `paymentId`. */
export async function claimFundRequest(tx: PgDb, request: FundRequestRow, paymentId: number, docNo: number, user: string): Promise<void> {
  const status = requestStatus(request.status)
  if (status === "given" && request.payment_id === paymentId) return
  if (status !== "approved") throw new CashError("Запрос должен быть подтвержден", 409, "moneyRequest")
  await tx
    .prepare("UPDATE supplier_balance_transactions SET status = 'given', payment_id = @paymentId, log = @log, updated_at = datetime('now') WHERE id = @id")
    .run({ id: request.id, paymentId, log: appendLog(request.log, { status: "given", comment: `№ ${docNo}`, user }) })
}

/** The payment no longer pays the request (payment deleted / unlinked): back to approved. */
export async function releaseFundRequest(tx: PgDb, requestId: number | null | undefined, paymentId: number, user: string): Promise<void> {
  if (!requestId) return
  const row = (await tx.prepare("SELECT * FROM supplier_balance_transactions WHERE id = @id AND kind = 'fund_request' FOR UPDATE").get({ id: requestId })) as
    | FundRequestRow
    | undefined
  if (!row || row.payment_id !== paymentId) return
  await tx
    .prepare("UPDATE supplier_balance_transactions SET status = 'approved', payment_id = NULL, log = @log, updated_at = datetime('now') WHERE id = @id")
    .run({ id: requestId, log: appendLog(row.log, { status: "approved", comment: "Оплата отменена", user }) })
}
