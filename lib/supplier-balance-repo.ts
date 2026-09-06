import "server-only"

import { getDb } from "@/lib/db"

export type Currency = "sum" | "usd" | "eur"

export type SupplierBalanceTransaction = {
  id: number
  supplierId: number
  kind: "add" | "expense" | "fund_request"
  currency: Currency
  amount: number
  date: string
  comment: string
}

type Row = {
  id: number
  supplier_id: number
  kind: string
  currency: string
  amount: number
  date: string
  comment: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function rowToTransaction(row: Row): SupplierBalanceTransaction {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    kind: row.kind === "expense" ? "expense" : row.kind === "fund_request" ? "fund_request" : "add",
    currency: row.currency === "usd" || row.currency === "eur" ? row.currency : "sum",
    amount: row.amount,
    date: row.date,
    comment: row.comment,
  }
}

export type SupplierBalanceTransactionInput = {
  supplierId: number
  kind: "add" | "expense" | "fund_request"
  currency: Currency
  amount: number
  date: string
  comment: string
}

export function parseSupplierBalanceTransactionInput(body: unknown): SupplierBalanceTransactionInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const supplierId = Number(value.supplierId)
  if (!Number.isFinite(supplierId) || supplierId <= 0) return null
  const kind = value.kind === "expense" ? "expense" : value.kind === "fund_request" ? "fund_request" : value.kind === "add" ? "add" : null
  if (!kind) return null
  const currency = value.currency === "usd" || value.currency === "eur" ? value.currency : value.currency === "sum" ? "sum" : null
  if (!currency) return null
  const amount = Number(value.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const date = typeof value.date === "string" && value.date.trim() ? value.date.trim() : new Date().toISOString().slice(0, 10)
  const comment = typeof value.comment === "string" ? value.comment.trim() : ""
  return { supplierId, kind, currency, amount, date, comment }
}

export async function listSupplierBalanceTransactions(): Promise<SupplierBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM supplier_balance_transactions ORDER BY id DESC").all()) as Row[]).map(rowToTransaction)
}

export async function createSupplierBalanceTransaction(input: SupplierBalanceTransactionInput): Promise<SupplierBalanceTransaction> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO supplier_balance_transactions (supplier_id, kind, currency, amount, date, comment)
       VALUES (@supplierId, @kind, @currency, @amount, @date, @comment)`,
      )
      .run(input))
  const row = (await db.prepare("SELECT * FROM supplier_balance_transactions WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToTransaction(row)
}
