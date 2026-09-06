import "server-only"

import { getDb } from "@/lib/db"

export type Currency = "sum" | "usd" | "eur"

export type EmployeeBalanceTransaction = {
  id: number
  employeeId: number
  kind: "add" | "expense"
  currency: Currency
  amount: number
  date: string
  comment: string
}

type Row = {
  id: number
  employee_id: number
  kind: string
  currency: string
  amount: number
  date: string
  comment: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS employee_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function rowToTransaction(row: Row): EmployeeBalanceTransaction {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind === "expense" ? "expense" : "add",
    currency: row.currency === "usd" || row.currency === "eur" ? row.currency : "sum",
    amount: row.amount,
    date: row.date,
    comment: row.comment,
  }
}

export type EmployeeBalanceTransactionInput = {
  employeeId: number
  kind: "add" | "expense"
  currency: Currency
  amount: number
  date: string
  comment: string
}

export async function listEmployeeBalanceTransactions(): Promise<EmployeeBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM employee_balance_transactions ORDER BY id DESC").all()) as Row[]).map(rowToTransaction)
}

export async function createEmployeeBalanceTransaction(input: EmployeeBalanceTransactionInput): Promise<EmployeeBalanceTransaction> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO employee_balance_transactions (employee_id, kind, currency, amount, date, comment)
       VALUES (@employeeId, @kind, @currency, @amount, @date, @comment)`,
      )
      .run(input))
  const row = (await db.prepare("SELECT * FROM employee_balance_transactions WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToTransaction(row)
}
