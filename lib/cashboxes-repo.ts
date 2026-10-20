import "server-only"

import { NextResponse } from "next/server"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import {
  CASHBOX_TYPE_LABELS,
  cashboxNameKey,
  cashboxTypeOf,
  type Cashbox,
  type CashboxDetail,
  type CashboxField,
  type CashboxListResult,
  type CashboxOptions,
  type CashboxUsage,
} from "@/components/analytics/cashboxes-data"
import type { CashboxInputBody, CashboxListQuery } from "@/lib/cashboxes-schema"

// "Кассы" (demo #/cashbox, API finance/cashbox/). Storage = the `cashboxes` table the
// cash core reads (lib/cash/common.ts loadCashbox, lib/finance/entities.ts):
//   * currency     canonical code (SUM, USD, EUR …) from the currencies table (or the
//                  SUM / USD / EUR default set while that table is empty);
//   * cashier      employee display name "First Last" (the ledger matches it to
//                  employees by name) + cashier_id (lazily added) for the dialog;
//   * branch       branch name ("" = none);
//   * payment_type "наличный" / "банковский счет" (fin_pt / paymentKind → cash / bank);
//   * order_number demo `position`; 0 / NULL = "Не указано", sorted last.
// Names are unique by fin_key (checked on create / rename only, so older duplicates
// can still be edited). Payments that predate cashbox_id are linked to a cashbox by
// NAME (`kassa`, resolved to the lowest id with that fin_key), so a rename carries the
// new name over to those rows. Delete is refused (409) while anything references the
// cashbox; the referencing columns are discovered from information_schema because
// most of those tables are created lazily.

type CashboxRow = {
  id: number
  name: string
  currency: string
  cashier: string | null
  cashier_id: number | null
  branch: string | null
  payment_type: string | null
  vansell: number | null
  order_number: number | null
  created_at: string | null
}

export class CashboxError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: CashboxField,
    readonly usage?: CashboxUsage[],
  ) {
    super(message)
  }
}

/** JSON response of a CashboxError ({error, fields?, usage?}); null for other errors. */
export function cashboxErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof CashboxError)) return null
  return NextResponse.json(
    {
      error: error.message,
      ...(error.field ? { fields: { [error.field]: error.message } } : {}),
      ...(error.usage ? { usage: error.usage } : {}),
    },
    { status: error.status },
  )
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let schemaReady: Promise<void> | null = null

/** Adds the nullable cashier_id link next to the `cashier` name (idempotent, once per process). */
export function ensureCashboxesSchema(): Promise<void> {
  schemaReady ??= getDb()
    .exec("ALTER TABLE cashboxes ADD COLUMN IF NOT EXISTS cashier_id INTEGER")
    .catch((error: unknown) => {
      schemaReady = null
      throw error
    })
  return schemaReady
}

/** SQL twin of cashboxNameKey() / fin_key(). */
function keySql(expression: string): string {
  return `lower(btrim(regexp_replace(replace(replace(coalesce(${expression}, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))`
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@table::text) IS NOT NULL AS ok").get({ table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const COLUMNS = "id, name, currency, cashier, cashier_id, branch, payment_type, vansell, order_number, created_at"
/** Demo order: position ascending with "Не указано" last, then newest first. */
const ORDER_BY = "ORDER BY (COALESCE(order_number, 0) = 0), order_number, id DESC"
const SEARCH = `(@needle = '' OR strpos(${keySql("name")}, @needle) > 0)`

function rowToCashbox(row: CashboxRow): Cashbox {
  const type = cashboxTypeOf(row.payment_type) ?? "cash"
  const position = row.order_number === null || row.order_number === undefined ? 0 : Number(row.order_number)
  return {
    id: Number(row.id),
    name: row.name,
    currency: row.currency ?? "",
    cashier: row.cashier ?? "",
    cashierId: row.cashier_id === null || row.cashier_id === undefined ? null : Number(row.cashier_id),
    branch: row.branch ?? "",
    paymentType: CASHBOX_TYPE_LABELS[type],
    type,
    vansell: Number(row.vansell) === 1,
    orderNumber: position || null,
    createdAt: row.created_at ?? "",
  }
}

/** Plain array for every cashbox select (optional name search). */
export async function listCashboxes(search = ""): Promise<Cashbox[]> {
  await ensureCashboxesSchema()
  const rows = (await getDb()
    .prepare(`SELECT ${COLUMNS} FROM cashboxes WHERE ${SEARCH} ${ORDER_BY}`)
    .all({ needle: cashboxNameKey(search) })) as CashboxRow[]
  return rows.map(rowToCashbox)
}

/** Grid of the page (demo GET finance/cashbox/?search&page&page_size). */
export async function listCashboxesPage(query: CashboxListQuery): Promise<CashboxListResult> {
  await ensureCashboxesSchema()
  const db = getDb()
  const needle = cashboxNameKey(query.search)
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const countRow = (await db.prepare(`SELECT COUNT(*) AS n FROM cashboxes WHERE ${SEARCH}`).get({ needle })) as { n: string | number } | undefined
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM cashboxes WHERE ${SEARCH} ${ORDER_BY} LIMIT @limit OFFSET @offset`)
    .all({ needle, limit: pageSize, offset: (page - 1) * pageSize })) as CashboxRow[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(rowToCashbox) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<CashboxRow | undefined> {
  return (await db.prepare(`SELECT ${COLUMNS} FROM cashboxes WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as CashboxRow | undefined
}

export async function getCashbox(id: number): Promise<Cashbox | null> {
  await ensureCashboxesSchema()
  const row = await readRow(getDb(), id)
  return row ? rowToCashbox(row) : null
}

/** Demo GET finance/cashbox/:id/; `withUsage` adds where the cashbox is referenced. */
export async function getCashboxDetail(id: number, withUsage = false): Promise<CashboxDetail | null> {
  await ensureCashboxesSchema()
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  return withUsage ? { ...rowToCashbox(row), usage: await cashboxUsage(db, row) } : rowToCashbox(row)
}

// ---------------------------------------------------------------------------
// Dialog options (currencies, employees, branches)
// ---------------------------------------------------------------------------

type EmployeeRow = { id: number; first_name: string | null; last_name: string | null; position: string | null; active: number | null }

function employeeName(row: EmployeeRow): string {
  return `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim()
}

const EMPLOYEE_NAME_SQL = keySql("btrim(coalesce(first_name, '')) || ' ' || btrim(coalesce(last_name, ''))")

async function findEmployee(db: PgDb, by: { id: number } | { name: string }): Promise<{ id: number; name: string } | null> {
  if (!(await tableExists(db, "employees"))) return null
  const row = (await ("id" in by
    ? db.prepare("SELECT id, first_name, last_name, position, active FROM employees WHERE id = @id").get({ id: by.id })
    : db.prepare(`SELECT id, first_name, last_name, position, active FROM employees WHERE ${EMPLOYEE_NAME_SQL} = @key ORDER BY active DESC, id LIMIT 1`).get({ key: cashboxNameKey(by.name) }))) as
    | EmployeeRow
    | undefined
  return row && employeeName(row) ? { id: Number(row.id), name: employeeName(row) } : null
}

async function findBranch(db: PgDb, by: { id: number } | { name: string }): Promise<{ id: number; name: string } | null> {
  if (!(await tableExists(db, "branches"))) return null
  const row = (await ("id" in by
    ? db.prepare("SELECT id, name FROM branches WHERE id = @id").get({ id: by.id })
    : db.prepare(`SELECT id, name FROM branches WHERE ${keySql("name")} = @key ORDER BY id LIMIT 1`).get({ key: cashboxNameKey(by.name) }))) as
    | { id: number; name: string }
    | undefined
  return row ? { id: Number(row.id), name: row.name } : null
}

export async function getCashboxOptions(): Promise<CashboxOptions> {
  const db = getDb()
  const context = await loadCurrencyContext(db)
  const employees = (await tableExists(db, "employees"))
    ? ((await db.prepare("SELECT id, first_name, last_name, position, active FROM employees ORDER BY lower(first_name), lower(last_name), id").all()) as EmployeeRow[])
    : []
  const branches = (await tableExists(db, "branches"))
    ? ((await db.prepare("SELECT id, name FROM branches ORDER BY lower(name), id").all()) as Array<{ id: number; name: string }>)
    : []
  return {
    currencies: context.currencies.map((currency) => ({ code: currency.code, label: currency.label, name: currency.name })),
    employees: employees
      .map((row) => ({ id: Number(row.id), name: employeeName(row), position: String(row.position ?? ""), active: Number(row.active ?? 1) === 1 }))
      .filter((employee) => employee.name),
    branches: branches.map((row) => ({ id: Number(row.id), name: row.name })).filter((branch) => branch.name.trim()),
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** One table that points at cashboxes: integer *cashbox_id columns and/or the legacy `kassa` name. */
type ReferenceTable = { table: string; idColumns: string[]; kassa: boolean }

/** Section labels (Russian i18n keys) of the referencing tables. */
const TABLE_LABELS: Record<string, string> = {
  cash_management_entries: "Управление кассой",
  customer_payments: "Оплаты от клиентов",
  supplier_payments: "Оплаты поставщикам",
  cash_transfers: "Перевод между кассами",
  cash_acceptances: "Принятие оплаты",
  cashback_withdrawal_requests: "Запросы на снятие кэшбэка",
}

async function referenceTables(db: PgDb): Promise<ReferenceTable[]> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name <> 'cashboxes'
          AND (right(c.column_name, 10) = 'cashbox_id' OR c.column_name = 'kassa')
        ORDER BY c.table_name, c.column_name`,
    )
    .all()) as Array<{ table_name: string; column_name: string; data_type: string }>
  const byTable = new Map<string, ReferenceTable>()
  for (const row of rows) {
    const ref = byTable.get(row.table_name) ?? { table: row.table_name, idColumns: [], kassa: false }
    if (row.column_name === "kassa") {
      if (row.data_type === "text" || row.data_type === "character varying") ref.kassa = true
    } else if (["integer", "bigint", "smallint"].includes(row.data_type)) {
      ref.idColumns.push(row.column_name)
    }
    if (ref.kassa || ref.idColumns.length) byTable.set(row.table_name, ref)
  }
  return [...byTable.values()]
}

/** Rows that still carry only the cashbox NAME (no cashbox_id) in `kassa`. */
function nameLinkSql(ref: ReferenceTable): string {
  const kassa = `${keySql(quoteIdent("kassa"))} = @key`
  return ref.idColumns.includes("cashbox_id") ? `(${quoteIdent("cashbox_id")} IS NULL AND ${kassa})` : kassa
}

async function cashboxUsage(db: PgDb, row: CashboxRow): Promise<CashboxUsage[]> {
  const key = cashboxNameKey(row.name)
  const usage: CashboxUsage[] = []
  for (const ref of await referenceTables(db)) {
    const conditions = ref.idColumns.map((column) => `${quoteIdent(column)} = @id`)
    if (ref.kassa && key) conditions.push(nameLinkSql(ref))
    if (!conditions.length) continue
    const result = (await db
      .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(ref.table)} WHERE ${conditions.join(" OR ")}`)
      .get({ id: Number(row.id), key })) as { n: string | number } | undefined
    const count = Number(result?.n ?? 0)
    if (count > 0) usage.push({ table: ref.table, label: TABLE_LABELS[ref.table] ?? ref.table, count })
  }
  return usage
}

/** Carries a rename over to the `kassa` copies: rows linked by id, plus the rows linked only
 * by name when the readers resolve that name to this cashbox (lowest id with the key).
 * Must run before the cashboxes row itself is renamed. Returns the updated row count. */
async function cascadeRename(db: PgDb, id: number, oldName: string, newName: string): Promise<number> {
  const oldKey = cashboxNameKey(oldName)
  if (!oldKey) return 0
  const owner = (await db.prepare(`SELECT MIN(id) AS id FROM cashboxes WHERE ${keySql("name")} = @key`).get({ key: oldKey })) as { id: number | null } | undefined
  const ownsNameLinks = Number(owner?.id) === id
  let changed = 0
  for (const ref of await referenceTables(db)) {
    if (!ref.kassa) continue
    const hasId = ref.idColumns.includes("cashbox_id")
    const scope = hasId ? (ownsNameLinks ? `(${quoteIdent("cashbox_id")} = @id OR ${quoteIdent("cashbox_id")} IS NULL)` : `${quoteIdent("cashbox_id")} = @id`) : ownsNameLinks ? "TRUE" : ""
    if (!scope) continue
    const result = await db
      .prepare(`UPDATE ${quoteIdent(ref.table)} SET kassa = @newName WHERE ${scope} AND ${keySql("kassa")} = @oldKey AND kassa <> @newName`)
      .run({ id, newName, oldKey })
    changed += result.changes
  }
  return changed
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type ResolvedInput = {
  name: string
  currency: string
  cashier: string
  cashierId: number | null
  branch: string
  paymentType: string
  vansell: boolean
  orderNumber: number
}

/** Values the finance readers treat as "no branch" (placeName / fin_place). */
const PLACEHOLDER_KEYS = new Set(["-", "—", "не указано", "не указан", "все", "все филиалы", "все организации"])

/** Validates the references of a body against the database. `current` = edited row:
 * its unchanged legacy values (currency / cashier / branch not in the lists) are kept. */
async function resolveInput(db: PgDb, body: CashboxInputBody, current: CashboxRow | null): Promise<ResolvedInput> {
  const context = await loadCurrencyContext(db)
  const code = normCurrency(body.currency)
  let currency: string
  if (current && normCurrency(current.currency) === code) currency = current.currency
  else if (context.currencies.some((item) => item.code === code)) currency = code
  else throw new CashboxError("Неизвестная валюта", 400, "currency")

  let cashier: { id: number | null; name: string } | null
  const cashierText = (body.cashier ?? "").trim()
  if (body.cashierId) cashier = await findEmployee(db, { id: body.cashierId })
  else if (current && cashboxNameKey(cashierText) === cashboxNameKey(current.cashier)) cashier = { id: current.cashier_id, name: current.cashier ?? "" }
  else cashier = await findEmployee(db, { name: cashierText })
  if (!cashier || !cashier.name) throw new CashboxError("Сотрудник не найден", 400, "cashier")

  let branch = ""
  const branchKey = cashboxNameKey(body.branch)
  if (body.branchId) {
    const found = await findBranch(db, { id: body.branchId })
    if (!found) throw new CashboxError("Филиал не найден", 400, "branch")
    branch = found.name
  } else if (branchKey && !PLACEHOLDER_KEYS.has(branchKey)) {
    if (current && branchKey === cashboxNameKey(current.branch)) branch = current.branch ?? ""
    else {
      const found = await findBranch(db, { name: body.branch ?? "" })
      if (!found) throw new CashboxError("Филиал не найден", 400, "branch")
      branch = found.name
    }
  }

  const type = cashboxTypeOf(body.paymentType || body.type)
  if (!type) throw new CashboxError("Неизвестный тип оплаты", 400, "paymentType")

  return {
    name: body.name,
    currency,
    cashier: cashier.name,
    cashierId: cashier.id,
    branch,
    paymentType: CASHBOX_TYPE_LABELS[type],
    vansell: body.vansell ?? body.isVanSell ?? false,
    orderNumber: body.orderNumber,
  }
}

/** Serialises cashbox writes (uniqueness check + insert / rename / delete). */
async function lockCashboxes(db: PgDb) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:cashboxes'))").get()
}

async function assertNameAvailable(db: PgDb, name: string, exceptId: number | null) {
  const duplicate = (await db
    .prepare(`SELECT id FROM cashboxes WHERE ${keySql("name")} = @key AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1`)
    .get({ key: cashboxNameKey(name), exceptId })) as { id: number } | undefined
  if (duplicate) throw new CashboxError("Касса с таким наименованием уже существует", 400, "name")
}

function writeParams(input: ResolvedInput) {
  return {
    name: input.name,
    currency: input.currency,
    cashier: input.cashier,
    cashierId: input.cashierId,
    branch: input.branch,
    paymentType: input.paymentType,
    vansell: input.vansell ? 1 : 0,
    orderNumber: input.orderNumber,
  }
}

/** Demo POST finance/cashbox/. */
export async function createCashbox(body: CashboxInputBody): Promise<Cashbox> {
  await ensureCashboxesSchema()
  return withTransaction(async (tx) => {
    await lockCashboxes(tx)
    const input = await resolveInput(tx, body, null)
    await assertNameAvailable(tx, input.name, null)
    const result = await tx
      .prepare(
        `INSERT INTO cashboxes (name, currency, cashier, cashier_id, branch, payment_type, vansell, order_number)
         VALUES (@name, @currency, @cashier, @cashierId, @branch, @paymentType, @vansell, @orderNumber)`,
      )
      .run(writeParams(input))
    return rowToCashbox((await readRow(tx, Number(result.lastInsertRowid)))!)
  })
}

/** Demo PUT finance/cashbox/:id/. A rename is carried over to the legacy `kassa` copies;
 * the currency cannot change once operations reference the cashbox (amounts are in it). */
export async function updateCashbox(id: number, body: CashboxInputBody): Promise<Cashbox | null> {
  await ensureCashboxesSchema()
  return withTransaction(async (tx) => {
    await lockCashboxes(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    const input = await resolveInput(tx, body, current)
    if (normCurrency(input.currency) !== normCurrency(current.currency) && (await cashboxUsage(tx, current)).length) {
      throw new CashboxError("Нельзя изменить валюту кассы, по которой есть операции", 409, "currency")
    }
    if (input.name !== current.name) {
      if (cashboxNameKey(input.name) !== cashboxNameKey(current.name)) await assertNameAvailable(tx, input.name, id)
      await cascadeRename(tx, id, current.name, input.name)
    }
    await tx
      .prepare(
        `UPDATE cashboxes SET name = @name, currency = @currency, cashier = @cashier, cashier_id = @cashierId, branch = @branch,
                payment_type = @paymentType, vansell = @vansell, order_number = @orderNumber, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ ...writeParams(input), id })
    return rowToCashbox((await readRow(tx, id))!)
  })
}

/** Demo DELETE finance/cashbox/:id/ — refused (409) while anything references the cashbox. */
export async function deleteCashbox(id: number): Promise<boolean> {
  await ensureCashboxesSchema()
  return withTransaction(async (tx) => {
    await lockCashboxes(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await cashboxUsage(tx, current)
    if (usage.length) throw new CashboxError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM cashboxes WHERE id = ?").run(id)
    return result.changes > 0
  })
}
