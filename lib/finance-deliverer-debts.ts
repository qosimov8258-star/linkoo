import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { ledgerCurrency, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { nameKey, placeName } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { DELIVERER_CORRECTIONS_TABLE } from "@/lib/finance/sources"
import type { DelivererCorrectionBody } from "@/lib/finance-deliverer-debts-api"
import type { DelivererCorrection, DelivererDebtsOptions } from "@/lib/finance-deliverer-debts-types"

// Storage and lookups of the "Долги доставщиков" page. Balances are computed
// by the shared ledger (lib/finance kinds "deliverer" and "agent"); this
// module owns the deliverers' manual corrections ("Корректировка" = the demo's
// client transaction type 9 that carries only a delivery man), which the
// ledger reads as the deliverer's none_type column, and the filter options.

declare global {
  var __linkoDelivererDebtsSchema: Promise<void> | undefined
}

async function createSchema(db: PgDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${DELIVERER_CORRECTIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'sum',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      payment_type TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ${DELIVERER_CORRECTIONS_TABLE}_employee_idx ON ${DELIVERER_CORRECTIONS_TABLE} (employee_id);
  `)
}

function ensureSchema(db: PgDb = getDb()): Promise<void> {
  if (!globalThis.__linkoDelivererDebtsSchema) {
    globalThis.__linkoDelivererDebtsSchema = createSchema(db).catch((error) => {
      globalThis.__linkoDelivererDebtsSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoDelivererDebtsSchema
}

type CorrectionRow = {
  id: number
  employee_id: number
  first_name: string | null
  last_name: string | null
  currency: string
  amount: number
  payment_type: string
  organization: string
  date: string
  comment: string
  created_by: string
  created_at: string
}

const SELECT_CORRECTION = `
  SELECT t.id, t.employee_id, e.first_name, e.last_name, t.currency, t.amount, t.payment_type, t.organization, t.date, t.comment,
         t.created_by, t.created_at
  FROM ${DELIVERER_CORRECTIONS_TABLE} t LEFT JOIN employees e ON e.id = t.employee_id`

function toCorrection(row: CorrectionRow): DelivererCorrection {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
    currency: normCurrency(row.currency),
    amount: Number(row.amount),
    paymentType: row.payment_type === "cash" || row.payment_type === "bank" ? row.payment_type : "",
    organization: row.organization,
    date: (row.date ? parseAnyDate(row.date) : parseAnyDate(row.created_at, true))?.slice(0, 16) ?? "",
    comment: row.comment,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export async function getDelivererCorrection(id: number, db: PgDb = getDb()): Promise<DelivererCorrection | null> {
  await ensureSchema(db)
  const row = (await db.prepare(`${SELECT_CORRECTION} WHERE t.id = ?`).get(id)) as CorrectionRow | undefined
  return row ? toCorrection(row) : null
}

export type DelivererCorrectionError = "employee_not_found" | "currency_not_found"

/** "КОРРЕКТИРОВКА" → one signed none_type row of the deliverer. */
export async function createDelivererCorrection(input: DelivererCorrectionBody, user: string): Promise<DelivererCorrection | DelivererCorrectionError> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await db.prepare("SELECT id FROM employees WHERE id = ?").get(input.employeeId))) return "employee_not_found"
  const code = normCurrency(input.currency)
  const context = await loadCurrencyContext(db)
  if (!context.currencies.some((currency) => currency.code === code)) return "currency_not_found"
  const date = (input.date ? parseAnyDate(input.date) : null)?.slice(0, 16) ?? nowLocalIso().slice(0, 16)
  const result = await db
    .prepare(
      `INSERT INTO ${DELIVERER_CORRECTIONS_TABLE} (employee_id, currency, amount, payment_type, organization, date, comment, created_by)
       VALUES (@employeeId, @currency, @amount, @paymentType, @organization, @date, @comment, @createdBy)`,
    )
    .run({
      employeeId: input.employeeId,
      currency: ledgerCurrency(code),
      amount: input.amount,
      paymentType: input.paymentType,
      organization: placeName(input.organization),
      date,
      comment: input.comment,
      createdBy: input.createdBy || user,
    })
  return (await getDelivererCorrection(result.lastInsertRowid, db))!
}

/** Removes a manual correction (the page's own ledger row). */
export async function deleteDelivererCorrection(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare(`DELETE FROM ${DELIVERER_CORRECTIONS_TABLE} WHERE id = ?`).run(id)
  return result.changes > 0
}

function uniqueNames(values: unknown[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = placeName(value)
    if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
  }
  return [...seen.values()]
}

function sorted(values: string[]): string[] {
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  return [...values].sort(collator.compare)
}

/** Filter popup / correction dialog values (table order first, then names seen on rows). */
export async function getDelivererDebtsOptions(user: { displayName: string; role: string }): Promise<DelivererDebtsOptions> {
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const column = async (sql: string, ok = true): Promise<unknown[]> => (ok ? ((await db.prepare(sql).all()) as Array<{ v: unknown }>).map((row) => row.v) : [])
  const [branchRows, employeeBranches, clientBranches, organizationRows, orderOrgs, paymentOrgs, entryOrgs, correctionOrgs, typeRows, clientTypes, users, employees] =
    await Promise.all([
      column("SELECT name AS v FROM branches ORDER BY id", s.has("branches")),
      column("SELECT DISTINCT branch AS v FROM employees", s.col("employees", "branch")),
      column("SELECT DISTINCT branch AS v FROM clients", s.col("clients", "branch")),
      column("SELECT name AS v FROM organizations ORDER BY id", s.has("organizations")),
      column("SELECT DISTINCT organization AS v FROM orders", s.col("orders", "organization")),
      column("SELECT DISTINCT organization AS v FROM customer_payments", s.col("customer_payments", "organization")),
      column("SELECT DISTINCT organization AS v FROM cash_management_entries", s.col("cash_management_entries", "organization")),
      column(`SELECT DISTINCT organization AS v FROM ${DELIVERER_CORRECTIONS_TABLE}`, s.has(DELIVERER_CORRECTIONS_TABLE)),
      column("SELECT name AS v FROM client_types ORDER BY id", s.has("client_types")),
      column("SELECT DISTINCT type AS v FROM clients", s.col("clients", "type")),
      column("SELECT display_name AS v FROM users ORDER BY id"),
      column("SELECT btrim(first_name || ' ' || last_name) AS v FROM employees WHERE active = 1 ORDER BY lower(first_name), lower(last_name), id"),
    ])
  return {
    branches: uniqueNames([...branchRows, ...sorted(uniqueNames([...employeeBranches, ...clientBranches]))]),
    organizations: uniqueNames([...organizationRows, ...sorted(uniqueNames([...orderOrgs, ...paymentOrgs, ...entryOrgs, ...correctionOrgs]))]),
    clientTypes: uniqueNames([...typeRows, ...sorted(uniqueNames(clientTypes))]),
    users: uniqueNames([...users, ...employees]),
    canEdit: user.role === "manager" || user.role === "admin",
    currentUser: user.displayName,
  }
}
