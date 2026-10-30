import "server-only"

import type { PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { CashError, num } from "@/lib/cash/common"
import type { MoneyRequestLog, MoneyRequestStatus } from "@/lib/cash/types"
import { notifySafely } from "@/lib/notify-event"
import { notifyTemplate } from "@/lib/user-notifications-repo"

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

/**
 * Настройки → Уведомления for a money request (call inside the transaction that created or
 * approved it, after ensureUserNotificationsSchema()):
 * - "money_request" (a new request): the administrators, who approve it, and the subscribers;
 * - "money_request_approved": the same, plus the account that made the request. The request
 *   keeps its author by name (created_by = display name or login), so the account is the one
 *   user with that name; an ambiguous or unknown name reaches nobody extra.
 * №{id} is the request's number as the lists show it (the n-th money request). A failure is logged
 * and never undoes the request (notifySafely).
 */
export async function notifyMoneyRequest(tx: PgDb, event: "money_request" | "money_request_approved", requestId: number): Promise<void> {
  await notifySafely(event, () => writeMoneyRequestNotice(tx, event, requestId))
}

async function writeMoneyRequestNotice(tx: PgDb, event: "money_request" | "money_request_approved", requestId: number): Promise<void> {
  const row = (await tx
    .prepare(
      `SELECT t.id, t.amount::float8 AS amount, t.currency, t.comment, t.created_by, COALESCE(s.name, '') AS provider,
              (SELECT COUNT(*)::int FROM supplier_balance_transactions z WHERE z.kind = 'fund_request' AND z.id <= t.id) AS num
         FROM supplier_balance_transactions t LEFT JOIN suppliers s ON s.id = t.supplier_id
        WHERE t.id = @id AND t.kind = 'fund_request'`,
    )
    .get({ id: requestId })) as
    | { id: number; amount: number; currency: string; comment: string | null; created_by: string | null; provider: string; num: number }
    | undefined
  if (!row) return
  const params = {
    id: Number(row.num) || Number(row.id),
    provider: row.provider,
    amount: Math.abs(num(row.amount)).toFixed(2),
    currency: normCurrency(row.currency),
    comment: row.comment ?? "",
  }
  const link = "/analytics/supplier-balance"
  if (event === "money_request") {
    await notifyTemplate("money_request", params, { objectId: requestId, link })
    return
  }
  const author = String(row.created_by ?? "").trim()
  const requester = author
    ? ((await tx
        .prepare("SELECT min(id) AS id FROM users WHERE btrim(display_name) = @name OR username = @name HAVING count(*) = 1")
        .get({ name: author })) as { id: number | null } | undefined)
    : undefined
  await notifyTemplate("money_request_approved", params, { objectId: requestId, link, userIds: requester?.id ? [Number(requester.id)] : [] })
}
