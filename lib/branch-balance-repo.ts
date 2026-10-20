import "server-only"

import { z } from "zod"

import { getBranch } from "@/lib/branches-repo"
import { getDb } from "@/lib/db"
import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { loadCurrencyContext } from "@/lib/finance/context"
import { ledgerCurrency, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { ensureLedgerExtensions } from "@/lib/finance/schema"

// Manual ledger of the "Баланс филиалов" page (demo main/branch/add_transaction/):
// "Добавить" (green +) stores kind 'add' → Прочие приходы, "Добавить расход"
// (red −) stores kind 'expense' → Прочие расходы; 'payments' feeds the Оплата
// column. Amounts are stored positive, the sign comes from `kind`. Balances
// themselves are computed by lib/finance (GET /api/balances/branch).

declare global {
  var __linkoBranchBalanceSchema: Promise<void> | undefined
}

function ensureSchema(db: ReturnType<typeof getDb>): Promise<void> {
  globalThis.__linkoBranchBalanceSchema ??= createSchema(db).catch((error: unknown) => {
    globalThis.__linkoBranchBalanceSchema = undefined
    throw error
  })
  return globalThis.__linkoBranchBalanceSchema
}

async function createSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS branch_balance_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL,
      branch_name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'add',
      currency TEXT NOT NULL DEFAULT 'sum',
      amount DOUBLE PRECISION NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  // The first version stored amounts as REAL (float4, ~7 significant digits).
  await db.exec(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'branch_balance_transactions'
                   AND column_name = 'amount' AND data_type = 'real') THEN
        ALTER TABLE branch_balance_transactions ALTER COLUMN amount TYPE double precision;
      END IF;
    END $$;
  `)
  await ensureLedgerExtensions(db)
}

export const BRANCH_BALANCE_KINDS = ["add", "expense", "payments"] as const

export type BranchBalanceKind = (typeof BRANCH_BALANCE_KINDS)[number]

export type BranchBalanceTransaction = {
  id: number
  branchId: number
  branchName: string
  kind: BranchBalanceKind
  /** Canonical currency code (SUM / USD / EUR / …). */
  currency: string
  /** Always positive; the sign is given by `kind`. */
  amount: number
  /** Business date-time as entered ("YYYY-MM-DDTHH:mm" or legacy "YYYY-MM-DD"). */
  date: string
  comment: string
  createdBy: string
  createdAt: string
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
  created_by?: string
  created_at: string
}

function toKind(value: string): BranchBalanceKind {
  return (BRANCH_BALANCE_KINDS as readonly string[]).includes(value) ? (value as BranchBalanceKind) : "add"
}

function rowToTransaction(row: Row): BranchBalanceTransaction {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    kind: toKind(row.kind),
    currency: normCurrency(row.currency),
    amount: Math.abs(Number(row.amount) || 0),
    date: row.date,
    comment: row.comment,
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
  }
}

/** Body of POST /api/branch-balance-transactions. Accepts the demo payload
 * shape too: a negative `amount` without `kind` is an expense ("Добавить
 * расход" posts amount × −1 to the same endpoint). */
export const branchBalanceTransactionSchema = z
  .object({
    branchId: z.coerce.number({ error: "Выберите филиал" }).int("Выберите филиал").positive("Выберите филиал").max(MAX_ID, "Выберите филиал"),
    /** Ignored when the branch exists (the stored name is taken from branches). */
    branchName: z.string().trim().optional(),
    kind: z.enum(BRANCH_BALANCE_KINDS).optional(),
    /** Any currency code (sum / usd / EUR / Euro …); normalised on write. */
    currency: z
      .string()
      .trim()
      .max(16, "Выберите валюту")
      .regex(/^[\p{L}$€']+$/u, "Выберите валюту")
      .optional(),
    amount: z.coerce
      .number({ error: "Введите сумму" })
      .finite("Введите сумму")
      .refine((value) => value !== 0, "Введите сумму")
      .refine((value) => Math.abs(value) <= MAX_MONEY, "Слишком большая сумма"),
    /** "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm" or "YYYY-MM-DD"; default now. */
    date: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || parseAnyDate(value) !== null, "Неверная дата"),
    comment: z.string().trim().max(2000).optional(),
  })
  // Only an expense may carry the demo's negative amount; "add" / "payments"
  // with a negative amount would silently flip the sign.
  .refine((value) => !(value.amount < 0 && value.kind && value.kind !== "expense"), { message: "Введите сумму", path: ["amount"] })
  .transform((value) => ({
    branchId: value.branchId,
    kind: value.kind ?? (value.amount < 0 ? "expense" : "add"),
    currency: value.currency || "SUM",
    amount: Math.abs(value.amount),
    date: value.date || "",
    comment: value.comment ?? "",
  }))

export type BranchBalanceTransactionInput = z.output<typeof branchBalanceTransactionSchema>

/** Stored date text: local business date-time "YYYY-MM-DDTHH:mm" (fin_ts reads it as Asia/Tashkent). */
function storedDate(value: string): string {
  const local = value ? parseAnyDate(value) : nowLocalIso()
  if (!local) return nowLocalIso().slice(0, 16)
  // Keep a plain ISO day as a day (legacy rows), otherwise minutes precision.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : local.slice(0, 16)
}

export async function listBranchBalanceTransactions(branchId?: number): Promise<BranchBalanceTransaction[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = branchId
    ? ((await db.prepare("SELECT * FROM branch_balance_transactions WHERE branch_id = ? ORDER BY id ASC").all(branchId)) as Row[])
    : ((await db.prepare("SELECT * FROM branch_balance_transactions ORDER BY id ASC").all()) as Row[])
  return rows.map(rowToTransaction)
}

export async function getBranchBalanceTransaction(id: number): Promise<BranchBalanceTransaction | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM branch_balance_transactions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToTransaction(row) : null
}

export type BranchBalanceWriteError = "branch_not_found" | "currency_not_found"

/** Inserts one manual entry; an error code when the branch or the currency does not exist. */
export async function createBranchBalanceTransaction(input: BranchBalanceTransactionInput, createdBy: string): Promise<BranchBalanceTransaction | BranchBalanceWriteError> {
  const branch = await getBranch(input.branchId)
  if (!branch) return "branch_not_found"
  const db = getDb()
  await ensureSchema(db)
  const code = normCurrency(input.currency)
  if (!(await loadCurrencyContext(db)).currencies.some((currency) => currency.code === code)) return "currency_not_found"
  const result = await db
    .prepare(
      `INSERT INTO branch_balance_transactions (branch_id, branch_name, kind, currency, amount, date, comment, created_by)
       VALUES (@branchId, @branchName, @kind, @currency, @amount, @date, @comment, @createdBy)`,
    )
    .run({
      branchId: branch.id,
      branchName: branch.name,
      kind: input.kind,
      currency: ledgerCurrency(code),
      amount: input.amount,
      date: storedDate(input.date),
      comment: input.comment,
      createdBy,
    })
  const row = (await db.prepare("SELECT * FROM branch_balance_transactions WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToTransaction(row)
}

export async function deleteBranchBalanceTransaction(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("DELETE FROM branch_balance_transactions WHERE id = ?").run(id)
  return result.changes > 0
}
