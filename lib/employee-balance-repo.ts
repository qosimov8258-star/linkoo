import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { ledgerCurrency, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { ensureLedgerExtensions } from "@/lib/finance/schema"
import type { EmployeeBalanceTransactionBody } from "@/lib/finance-employee-balance-api"

// Storage of the "Баланс сотрудников" page: the manual employee ledger
// (employee_balance_transactions). "Зачислить" / "Списать" write type
// 'none_type' (column "Коректировки"); a fine (API type 'penalty', no UI in the
// demo page) is kind 'expense' + type 'penalty' (column "Штрафы"); amounts are stored positive and signed
// by kind. Balances and the act are computed by the shared finance ledger
// (lib/finance), which reads this table together with credited salary plans.

export type EmployeeBalanceTransaction = {
  id: number
  employeeId: number
  employeeName: string
  kind: "add" | "expense"
  /** 'none_type' | 'penalty' (or a salary column written by older code). */
  type: string
  /** Canonical currency code (SUM, USD, EUR, …). */
  currency: string
  /** Always > 0; the sign comes from `kind`. */
  amount: number
  /** Local business date-time "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD" for old rows). */
  date: string
  comment: string
  createdBy: string
  createdAt: string
}

type Row = {
  id: number
  employee_id: number
  first_name: string | null
  last_name: string | null
  kind: string
  type: string
  currency: string
  amount: number
  date: string
  comment: string
  created_by: string
  created_at: string
}

declare global {
  var __linkoEmployeeBalanceSchema: Promise<void> | undefined
}

async function createSchema(db: PgDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS employee_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // type / created_by (finance ledger extensions).
  await ensureLedgerExtensions(db)
  // The first version stored amounts as REAL (float4, ~7 significant digits),
  // which silently rounds sums above ~16.7 million.
  await db.exec(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'employee_balance_transactions'
                   AND column_name = 'amount' AND data_type = 'real') THEN
        ALTER TABLE employee_balance_transactions ALTER COLUMN amount TYPE double precision;
      END IF;
    END $$;
  `)
}

function ensureSchema(db: PgDb = getDb()): Promise<void> {
  if (!globalThis.__linkoEmployeeBalanceSchema) {
    globalThis.__linkoEmployeeBalanceSchema = createSchema(db).catch((error) => {
      globalThis.__linkoEmployeeBalanceSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoEmployeeBalanceSchema
}

const SELECT_TX = `
  SELECT t.id, t.employee_id, e.first_name, e.last_name, t.kind, t.type, t.currency, t.amount, t.date, t.comment, t.created_by, t.created_at
  FROM employee_balance_transactions t LEFT JOIN employees e ON e.id = t.employee_id`

function toTransaction(row: Row): EmployeeBalanceTransaction {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
    kind: row.kind === "expense" ? "expense" : "add",
    type: row.type || "none_type",
    currency: normCurrency(row.currency),
    amount: Math.abs(Number(row.amount)),
    date: row.date,
    comment: row.comment,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/** "YYYY-MM-DDTHH:mm" local time; missing / unparseable → now. */
function businessDate(value: string | undefined): string {
  return (value ? parseAnyDate(value) : null)?.slice(0, 16) ?? nowLocalIso().slice(0, 16)
}

/** Canonical code when the currency is known (currencies table, or SUM/USD/EUR when it is empty). */
async function knownCurrency(db: PgDb, value: string): Promise<string | null> {
  const code = normCurrency(value)
  const context = await loadCurrencyContext(db)
  return context.currencies.some((currency) => currency.code === code) ? code : null
}

/** Raw manual movements, newest first (optionally of one employee). */
export async function listEmployeeBalanceTransactions(filter: { employeeId?: number } = {}): Promise<EmployeeBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (
    filter.employeeId
      ? await db.prepare(`${SELECT_TX} WHERE t.employee_id = ? ORDER BY t.id DESC`).all(filter.employeeId)
      : await db.prepare(`${SELECT_TX} ORDER BY t.id DESC`).all()
  ) as Row[]
  return rows.map(toTransaction)
}

export async function getEmployeeBalanceTransaction(id: number, db: PgDb = getDb()): Promise<EmployeeBalanceTransaction | null> {
  await ensureSchema(db)
  const row = (await db.prepare(`${SELECT_TX} WHERE t.id = ?`).get(id)) as Row | undefined
  return row ? toTransaction(row) : null
}

export type EmployeeBalanceWriteError = "employee_not_found" | "currency_not_found"

/** "Зачислить" (add) / "Списать" (expense) as 'none_type'; a fine = type
 * 'penalty', always an expense. `createdBy` = the user's display name. */
export async function createEmployeeBalanceTransaction(
  input: EmployeeBalanceTransactionBody,
  createdBy: string,
): Promise<EmployeeBalanceTransaction | EmployeeBalanceWriteError> {
  await ensureSchema()
  // One transaction: the employee row is locked (FOR SHARE) between the
  // existence check and the insert, so a concurrent delete cannot leave an
  // orphan movement behind.
  return withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM employees WHERE id = ? FOR SHARE").get(input.employeeId))) return "employee_not_found"
    const code = await knownCurrency(db, input.currency)
    if (!code) return "currency_not_found"
    const result = await db
      .prepare(
        `INSERT INTO employee_balance_transactions (employee_id, kind, type, currency, amount, date, comment, created_by)
         VALUES (@employeeId, @kind, @type, @currency, @amount, @date, @comment, @createdBy)`,
      )
      .run({
        employeeId: input.employeeId,
        kind: input.type === "penalty" ? "expense" : input.kind,
        type: input.type,
        currency: ledgerCurrency(code),
        amount: Math.abs(input.amount),
        date: businessDate(input.date),
        comment: input.comment ?? "",
        createdBy,
      })
    return (await getEmployeeBalanceTransaction(result.lastInsertRowid, db))!
  })
}
