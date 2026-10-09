import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { ensureLedgerExtensions } from "@/lib/finance/schema"

// Manual supplier balance ledger of "Баланс поставщиков" (demo
// provider_transactions type 6 "Нет типа" + money requests):
// - kind 'add'          → "Прочие приходы" (+amount) of the supplier balance;
// - kind 'expense'      → "Прочие расходы" (−amount);
// - kind 'fund_request' → "Запрос средств" (pending money request, never part
//   of the balance; status 'pending' | 'approved' | 'given' | 'cancelled' ('' = legacy
//   pending, legacy 'rejected' ≈ cancelled). The lifecycle (approve / cancel / pay)
//   is owned by the cash core: lib/cash/money-requests.ts.
// amount is always stored positive (sign comes from kind); `date` is the local
// business date-time "YYYY-MM-DDTHH:mm"; currency is a canonical code (SUM,
// USD, EUR, …). The balance itself is computed by lib/finance (ledger).

export type SupplierBalanceKind = "add" | "expense" | "fund_request"
export type FundRequestStatus = "pending" | "approved" | "rejected" | "given" | "cancelled"
export type SupplierPaymentType = "cash" | "bank" | ""

export type SupplierBalanceTransaction = {
  id: number
  supplierId: number
  /** suppliers.name ("" when the supplier was deleted). */
  supplierName: string
  kind: SupplierBalanceKind
  /** Canonical currency code (SUM, USD, EUR, …). */
  currency: string
  /** Always > 0. */
  amount: number
  /** Amount with the balance sign: add +, expense −, fund_request +. */
  signedAmount: number
  /** Local "YYYY-MM-DDTHH:mm" (legacy rows: "YYYY-MM-DD"). */
  date: string
  comment: string
  paymentType: SupplierPaymentType
  organization: string
  branch: string
  /** Fund requests only ('' for add/expense). */
  status: FundRequestStatus | ""
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type SupplierBalanceCreateInput = {
  supplierId: number
  kind: SupplierBalanceKind
  currency: string
  amount: number
  paymentType?: SupplierPaymentType
  organization?: string
  branch?: string
  date?: string
  comment?: string
}

export type SupplierBalanceUpdateInput = {
  /** add/expense: signed (> 0 → add, < 0 → expense); fund_request: > 0. */
  amount: number
  currency: string
  paymentType?: SupplierPaymentType
  organization?: string
  /** undefined = keep the stored branch. */
  branch?: string
  date?: string
  comment?: string
  /** Fund requests only. */
  status?: FundRequestStatus
}

export type SupplierBalanceResult =
  | { transaction: SupplierBalanceTransaction; error?: undefined }
  | {
      transaction?: undefined
      error: "not_found" | "supplier_not_found" | "invalid"
    }

type Row = {
  id: number
  supplier_id: number
  supplier_name: string | null
  kind: string
  currency: string
  amount: number
  date: string
  comment: string
  payment_type: string
  organization: string
  branch: string
  status: string
  created_by: string
  created_at: string
  updated_at: string
}

let schemaReady: Promise<void> | null = null

async function createSchema(db: PgDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // payment_type, organization, branch, created_by, status, updated_at.
  await ensureLedgerExtensions(db)
  // The first version stored amounts as REAL (float4, ~7 significant digits),
  // which silently rounds sums above ~16.7 million (common in SUM).
  await db.exec(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'supplier_balance_transactions'
                   AND column_name = 'amount' AND data_type = 'real') THEN
        ALTER TABLE supplier_balance_transactions ALTER COLUMN amount TYPE double precision;
      END IF;
    END $$;
  `)
}

async function ensureSchema(db: PgDb) {
  schemaReady ??= createSchema(db).catch((error: unknown) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}

const SELECT = `SELECT t.*, s.name AS supplier_name FROM supplier_balance_transactions t LEFT JOIN suppliers s ON s.id = t.supplier_id`

function kindOf(value: string): SupplierBalanceKind {
  return value === "expense" ? "expense" : value === "fund_request" ? "fund_request" : "add"
}

function paymentTypeOf(value: string): SupplierPaymentType {
  return value === "cash" || value === "bank" ? value : ""
}

function statusOf(kind: SupplierBalanceKind, value: string): FundRequestStatus | "" {
  if (kind !== "fund_request") return ""
  return value === "approved" || value === "rejected" || value === "given" || value === "cancelled" ? value : "pending"
}

function rowToTransaction(row: Row): SupplierBalanceTransaction {
  const kind = kindOf(row.kind)
  const amount = Math.abs(Number(row.amount) || 0)
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name ?? "",
    kind,
    currency: normCurrency(row.currency),
    amount,
    signedAmount: kind === "expense" ? -amount : amount,
    date: row.date,
    comment: row.comment ?? "",
    paymentType: paymentTypeOf(row.payment_type ?? ""),
    organization: row.organization ?? "",
    branch: row.branch ?? "",
    status: statusOf(kind, row.status ?? ""),
    createdBy: row.created_by ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  }
}

/** Any accepted date text → local "YYYY-MM-DDTHH:mm" (now when empty). */
function localDateTime(value: string | undefined): string | null {
  if (!value?.trim()) return nowLocalIso().slice(0, 16)
  return parseAnyDate(value)?.slice(0, 16) ?? null
}

export async function listSupplierBalanceTransactions(filter: { supplierId?: number; kind?: SupplierBalanceKind } = {}): Promise<SupplierBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
    .prepare(
      `${SELECT}
       WHERE (@supplierId::int IS NULL OR t.supplier_id = @supplierId::int) AND (@kind::text = '' OR t.kind = @kind::text)
       ORDER BY t.id DESC`,
    )
    .all({
      supplierId: filter.supplierId ?? null,
      kind: filter.kind ?? "",
    })) as Row[]
  return rows.map(rowToTransaction)
}

export async function getSupplierBalanceTransaction(id: number, db: PgDb = getDb(), forUpdate = false): Promise<SupplierBalanceTransaction | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  await ensureSchema(getDb())
  const row = (await db.prepare(`${SELECT} WHERE t.id = ?${forUpdate ? " FOR UPDATE OF t" : ""}`).get(id)) as Row | undefined
  return row ? rowToTransaction(row) : null
}

export async function createSupplierBalanceTransaction(input: SupplierBalanceCreateInput, createdBy: string): Promise<SupplierBalanceResult> {
  await ensureSchema(getDb())
  const date = localDateTime(input.date)
  if (!date || !(input.amount > 0)) return { error: "invalid" }
  return withTransaction(async (db) => {
    // Share-lock the supplier row so it cannot be deleted between the check and the insert.
    if (!(await db.prepare("SELECT id FROM suppliers WHERE id = ? FOR SHARE").get(input.supplierId))) return { error: "supplier_not_found" }
    const result = await db
      .prepare(
        `INSERT INTO supplier_balance_transactions
         (supplier_id, kind, currency, amount, date, comment, payment_type, organization, branch, created_by, status, updated_at)
       VALUES (@supplierId, @kind, @currency, @amount, @date, @comment, @paymentType, @organization, @branch, @createdBy, @status, datetime('now'))`,
      )
      .run({
        supplierId: input.supplierId,
        kind: input.kind,
        currency: normCurrency(input.currency),
        amount: Math.abs(input.amount),
        date,
        comment: input.comment?.trim() ?? "",
        // A money request is not a payment: it has no payment type / organization / branch.
        paymentType: input.kind === "fund_request" ? "" : (input.paymentType ?? ""),
        organization: input.kind === "fund_request" ? "" : (input.organization?.trim() ?? ""),
        branch: input.kind === "fund_request" ? "" : (input.branch?.trim() ?? ""),
        createdBy,
        status: input.kind === "fund_request" ? "pending" : "",
      })
    const transaction = await getSupplierBalanceTransaction(Number(result.lastInsertRowid), db)
    return transaction ? { transaction } : { error: "not_found" }
  })
}

/** Edit of a manual entry ("Изменение баланса поставщика"): the signed amount
 * picks the kind (+ → add, − → expense). Fund requests keep their kind and may
 * change amount, currency, comment and status. */
export async function updateSupplierBalanceTransaction(id: number, input: SupplierBalanceUpdateInput): Promise<SupplierBalanceResult> {
  await ensureSchema(getDb())
  return withTransaction(async (db) => {
    const current = await getSupplierBalanceTransaction(id, db, true)
    if (!current) return { error: "not_found" }
    // An empty / missing date keeps the stored one (never silently becomes "now").
    const date = input.date?.trim() ? localDateTime(input.date) : current.date
    if (!date || !input.amount) return { error: "invalid" }
    const isRequest = current.kind === "fund_request"
    if (isRequest && input.amount < 0) return { error: "invalid" }
    const kind: SupplierBalanceKind = isRequest ? "fund_request" : input.amount > 0 ? "add" : "expense"
    await db
      .prepare(
        `UPDATE supplier_balance_transactions
       SET kind = @kind, currency = @currency, amount = @amount, date = @date, comment = @comment, payment_type = @paymentType,
           organization = @organization, branch = @branch, status = @status, updated_at = datetime('now')
       WHERE id = @id`,
      )
      .run({
        id,
        kind,
        currency: normCurrency(input.currency),
        amount: Math.abs(input.amount),
        date,
        comment: input.comment?.trim() ?? current.comment,
        paymentType: isRequest ? "" : (input.paymentType ?? current.paymentType),
        organization: isRequest ? "" : (input.organization?.trim() ?? current.organization),
        branch: isRequest ? "" : (input.branch?.trim() ?? current.branch),
        status: isRequest ? (input.status ?? current.status ?? "pending") : "",
      })
    const transaction = await getSupplierBalanceTransaction(id, db)
    return transaction ? { transaction } : { error: "not_found" }
  })
}

/** Approve / reject (or reopen) a money request. */
export async function setFundRequestStatus(id: number, status: FundRequestStatus): Promise<SupplierBalanceResult> {
  const current = await getSupplierBalanceTransaction(id)
  if (!current) return { error: "not_found" }
  const { changes } = await getDb()
    .prepare("UPDATE supplier_balance_transactions SET status = @status, updated_at = datetime('now') WHERE id = @id AND kind = 'fund_request'")
    .run({ id, status })
  if (!changes) return { error: "invalid" }
  const transaction = await getSupplierBalanceTransaction(id)
  return transaction ? { transaction } : { error: "not_found" }
}

export async function deleteSupplierBalanceTransaction(id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id <= 0) return false
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM supplier_balance_transactions WHERE id = ?").run(id)).changes > 0
}
