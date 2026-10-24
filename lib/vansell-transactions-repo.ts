import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { ledgerCurrency, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { ensureLedgerExtensions } from "@/lib/finance/schema"
import type { VansellLimitsBody, VansellTransactionCreateBody, VansellTransactionUpdateBody } from "@/lib/finance-vansell-balance-api"

// Storage of the "Баланс вансел" page: the manual van-sell ledger
// (vansell_transactions — "Добавить" / "Добавить расход" = type 'none_type',
// signed amount) and the per-agent debt limits ("Изменить лимит"). Balances
// themselves are computed by the shared finance ledger (lib/finance), which
// reads vansell_transactions together with stock transfers and cash entries.

export type VansellTransaction = {
  id: number
  employeeId: number
  employeeName: string
  /** 'none_type' for manual movements (the only type this page writes). */
  type: string
  /** Canonical currency code (SUM, USD, EUR, …). */
  currency: string
  /** Signed: + = Прочие приходы, − = Прочие расходы. */
  amount: number
  comment: string
  /** Local business date-time "YYYY-MM-DDTHH:mm". */
  createdDate: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type VansellLimit = { employeeId: number; limit: number; updatedBy: string; updatedAt: string }

type TxRow = {
  id: number
  employee_id: number
  first_name: string | null
  last_name: string | null
  type: string
  currency: string
  amount: number
  comment: string
  created_date: string
  created_by: string
  created_at: string
  updated_at: string
}

declare global {
  var __linkoVansellSchema2: Promise<void> | undefined
}

async function createSchema(db: PgDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vansell_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'sum',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vansell_debt_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL UNIQUE,
      debt_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  // type / comment / created_date / created_by / updated_at (finance ledger extensions).
  await ensureLedgerExtensions(db)
  // The first version stored amounts as REAL (float4, ~7 significant digits),
  // which silently rounds sums above ~16.7 million.
  await db.exec(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'vansell_transactions'
                   AND column_name = 'amount' AND data_type = 'real') THEN
        ALTER TABLE vansell_transactions ALTER COLUMN amount TYPE double precision;
      END IF;
    END $$;
  `)
}

function ensureSchema(db: PgDb = getDb()): Promise<void> {
  if (!globalThis.__linkoVansellSchema2) {
    globalThis.__linkoVansellSchema2 = createSchema(db).catch((error) => {
      globalThis.__linkoVansellSchema2 = undefined
      throw error
    })
  }
  return globalThis.__linkoVansellSchema2
}

const SELECT_TX = `
  SELECT v.id, v.employee_id, e.first_name, e.last_name, v.type, v.currency, v.amount, v.comment,
         v.created_date, v.created_by, v.created_at, v.updated_at
  FROM vansell_transactions v LEFT JOIN employees e ON e.id = v.employee_id`

function toTransaction(row: TxRow): VansellTransaction {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
    type: row.type,
    currency: normCurrency(row.currency),
    amount: Number(row.amount),
    comment: row.comment,
    // Rows without a business date fall back to created_at (UTC text).
    createdDate: (row.created_date ? parseAnyDate(row.created_date) : parseAnyDate(row.created_at, true))?.slice(0, 16) ?? "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** "YYYY-MM-DDTHH:mm" local time; missing / unparseable → now. */
function businessDate(value: string | undefined): string {
  return (value ? parseAnyDate(value) : null)?.slice(0, 16) ?? nowLocalIso().slice(0, 16)
}

async function employeeExists(db: PgDb, id: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM employees WHERE id = ?").get(id))
}

/** Canonical code when the currency is known (currencies table, or SUM/USD/EUR when it is empty). */
async function knownCurrency(db: PgDb, value: string): Promise<string | null> {
  const code = normCurrency(value)
  const context = await loadCurrencyContext(db)
  return context.currencies.some((currency) => currency.code === code) ? code : null
}

export async function listVansellTransactions(filter: { employeeId?: number } = {}): Promise<VansellTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (
    filter.employeeId
      ? await db.prepare(`${SELECT_TX} WHERE v.employee_id = ? AND COALESCE(v.is_deleted, 0) = 0 ORDER BY v.id DESC`).all(filter.employeeId)
      : await db.prepare(`${SELECT_TX} WHERE COALESCE(v.is_deleted, 0) = 0 ORDER BY v.id DESC`).all()
  ) as TxRow[]
  return rows.map(toTransaction)
}

export async function getVansellTransaction(id: number, db: PgDb = getDb()): Promise<VansellTransaction | null> {
  await ensureSchema(db)
  const row = (await db.prepare(`${SELECT_TX} WHERE v.id = ? AND COALESCE(v.is_deleted, 0) = 0`).get(id)) as TxRow | undefined
  return row ? toTransaction(row) : null
}

/** Soft delete of a manual ('none_type') movement: it stays in the table but no longer counts anywhere. */
export async function deleteVansellTransaction(id: number): Promise<"ok" | "not_found" | "not_editable"> {
  const db = getDb()
  await ensureSchema(db)
  const current = await getVansellTransaction(id, db)
  if (!current) return "not_found"
  if (current.type !== "none_type") return "not_editable"
  await db.prepare("UPDATE vansell_transactions SET is_deleted = 1, updated_at = datetime('now') WHERE id = ? AND type = 'none_type'").run(id)
  return "ok"
}

export type VansellWriteError = "employee_not_found" | "currency_not_found" | "not_found" | "not_editable"

/** "Добавить" / "Добавить расход": one manual ('none_type') movement, + for add, − for expense. */
export async function createVansellTransaction(input: VansellTransactionCreateBody, createdBy: string): Promise<VansellTransaction | VansellWriteError> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await employeeExists(db, input.employeeId))) return "employee_not_found"
  const code = await knownCurrency(db, input.currency)
  if (!code) return "currency_not_found"
  const amount = input.kind === "expense" ? -Math.abs(input.amount) : Math.abs(input.amount)
  const result = await db
    .prepare(
      `INSERT INTO vansell_transactions (employee_id, currency, amount, type, comment, created_date, created_by, updated_at)
       VALUES (@employeeId, @currency, @amount, 'none_type', @comment, @createdDate, @createdBy, datetime('now'))`,
    )
    .run({
      employeeId: input.employeeId,
      currency: ledgerCurrency(code),
      amount,
      comment: input.comment ?? "",
      createdDate: businessDate(input.date),
      createdBy,
    })
  return (await getVansellTransaction(result.lastInsertRowid, db))!
}

/** Edit of a manual movement (demo pencil, only 'none_type' rows): signed amount, currency, date, optional comment/agent. */
export async function updateVansellTransaction(id: number, input: VansellTransactionUpdateBody): Promise<VansellTransaction | VansellWriteError> {
  const db = getDb()
  await ensureSchema(db)
  const current = await getVansellTransaction(id, db)
  if (!current) return "not_found"
  if (current.type !== "none_type") return "not_editable"
  const employeeId = input.employeeId ?? current.employeeId
  if (employeeId !== current.employeeId && !(await employeeExists(db, employeeId))) return "employee_not_found"
  const code = await knownCurrency(db, input.currency)
  if (!code) return "currency_not_found"
  await db
    .prepare(
      `UPDATE vansell_transactions
       SET employee_id = @employeeId, currency = @currency, amount = @amount, created_date = @createdDate, comment = @comment, updated_at = datetime('now')
       WHERE id = @id AND type = 'none_type'`,
    )
    .run({
      id,
      employeeId,
      currency: ledgerCurrency(code),
      amount: input.amount,
      createdDate: input.date ? businessDate(input.date) : current.createdDate || businessDate(undefined),
      comment: input.comment ?? current.comment,
    })
  return (await getVansellTransaction(id, db))!
}

export async function listVansellLimits(): Promise<VansellLimit[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT employee_id, debt_limit, updated_by, updated_at FROM vansell_debt_limits ORDER BY employee_id").all()) as Array<{
    employee_id: number
    debt_limit: number
    updated_by: string
    updated_at: string
  }>
  return rows.map((row) => ({ employeeId: row.employee_id, limit: Number(row.debt_limit), updatedBy: row.updated_by, updatedAt: row.updated_at }))
}

/** "Изменить лимит" (bulk): upserts one limit per agent; all or nothing. */
export async function saveVansellLimits(items: VansellLimitsBody, updatedBy: string): Promise<VansellLimit[] | "employee_not_found"> {
  await ensureSchema()
  const ids = [...new Set(items.map((item) => item.employeeId))]
  const saved = await withTransaction(async (db) => {
    const found = (await db.prepare("SELECT id FROM employees WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number }>
    if (found.length !== ids.length) return false
    for (const item of items) {
      await db
        .prepare(
          `INSERT INTO vansell_debt_limits (employee_id, debt_limit, updated_by, updated_at)
           VALUES (@employeeId, @limit, @updatedBy, datetime('now'))
           ON CONFLICT (employee_id) DO UPDATE SET debt_limit = EXCLUDED.debt_limit, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        )
        .run({ employeeId: item.employeeId, limit: item.limit, updatedBy })
    }
    return true
  })
  if (!saved) return "employee_not_found"
  const wanted = new Set(ids)
  return (await listVansellLimits()).filter((limit) => wanted.has(limit.employeeId))
}
