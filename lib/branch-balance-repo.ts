import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS branch_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL,
      branch_name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'add',
      currency TEXT NOT NULL DEFAULT 'sum',
      amount REAL NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export type BranchBalanceCurrency = "sum" | "usd"
export type BranchBalanceKind = "add" | "expense"

export type BranchBalanceTransaction = {
  id: number
  branchId: number
  branchName: string
  kind: BranchBalanceKind
  currency: BranchBalanceCurrency
  amount: number
  date: string
  comment: string
}

type Row = {
  id: number
  branch_id: number
  branch_name: string
  kind: string
  currency: string
  amount: number
  date: string
  comment: string
}

function rowToTransaction(row: Row): BranchBalanceTransaction {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    kind: row.kind === "expense" ? "expense" : "add",
    currency: row.currency === "usd" ? "usd" : "sum",
    amount: row.amount,
    date: row.date,
    comment: row.comment,
  }
}

export type BranchBalanceTransactionInput = {
  branchId: number
  branchName: string
  kind: BranchBalanceKind
  currency: BranchBalanceCurrency
  amount: number
  date: string
  comment: string
}

export function parseBranchBalanceTransactionInput(body: unknown): BranchBalanceTransactionInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const branchId = Number(value.branchId)
  if (!Number.isFinite(branchId) || branchId <= 0) return null
  const amount = Number(value.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return {
    branchId,
    branchName: typeof value.branchName === "string" ? value.branchName.trim() : "",
    kind: value.kind === "expense" ? "expense" : "add",
    currency: value.currency === "usd" ? "usd" : "sum",
    amount,
    date: typeof value.date === "string" && value.date ? value.date : new Date().toISOString().slice(0, 10),
    comment: typeof value.comment === "string" ? value.comment.trim() : "",
  }
}

export async function listBranchBalanceTransactions(): Promise<BranchBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM branch_balance_transactions ORDER BY id ASC").all()) as Row[]).map(rowToTransaction)
}

export async function createBranchBalanceTransaction(input: BranchBalanceTransactionInput): Promise<BranchBalanceTransaction> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO branch_balance_transactions (branch_id, branch_name, kind, currency, amount, date, comment)
       VALUES (@branchId, @branchName, @kind, @currency, @amount, @date, @comment)`,
      )
      .run(input))
  const row = (await db.prepare("SELECT * FROM branch_balance_transactions WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToTransaction(row)
}
