import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type {
  Organization,
  OrganizationDetail,
  OrganizationListItem,
  OrganizationListResult,
  OrganizationUsage,
} from "@/components/analytics/organization-data"

// "Организация" (demo #/division, API main/division/: {id, name, created_date,
// use_limit_for_debt}). The demo links documents to a division by id; this app
// stores the organization NAME in most tables (cash entries, customer/supplier
// payments, orders, suppliers, products, … — text columns `organization`,
// `from_organization`, `to_organization`), employees / client_balance_imports keep
// JSON arrays of names (`organizations`) and contracts carry `organization_id`
// (+ a legacy name). To behave like the demo on that schema:
//   * names are unique by the finance name key (lower-case, trimmed, collapsed
//     whitespace — the fin_key()/nameKey() the balance readers group by) and may
//     not be one of the "no organization" placeholders;
//   * renaming cascades in ONE transaction to every referencing column (discovered
//     from information_schema, so lazily created tables are covered too), so the
//     documents keep pointing at the renamed organization like the demo's ids;
//   * deleting is refused (409) while any of those columns references it (demo:
//     "Удаление невозможно из-за связи с другими данными").

type OrganizationRow = {
  id: number
  name: string
  limit_by_debt: number
  created_at: string | null
}

export class OrganizationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: "name",
    readonly usage?: OrganizationUsage[],
  ) {
    super(message)
  }
}

/** JSON response of an OrganizationError ({error, fields?, usage?}); null for other errors. */
export function organizationErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof OrganizationError)) return null
  return NextResponse.json(
    {
      error: error.message,
      ...(error.field ? { fields: { [error.field]: error.message } } : {}),
      ...(error.usage ? { usage: error.usage } : {}),
    },
    { status: error.status },
  )
}

export function parseOrganizationId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const organizationInputSchema = z.object({
  name: z.string().trim().min(1, "Обязательное поле").max(255, "Не более 255 символов"),
  limitByDebt: z.boolean().optional(),
  /** Demo field name (main/division/ body). */
  use_limit_for_debt: z.boolean().optional(),
})
export type OrganizationInputBody = z.infer<typeof organizationInputSchema>
export type OrganizationInput = { name: string; limitByDebt: boolean }

export function organizationInput(body: OrganizationInputBody): OrganizationInput {
  return { name: body.name, limitByDebt: body.limitByDebt ?? body.use_limit_for_debt ?? false }
}

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value)
const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional())

export const organizationListQuerySchema = z.object({
  search: text(200),
  /** name | -name | id | -id | created_date | -created_date (demo snake-cased ordering). */
  ordering: text(40),
  page: int(1, 1_000_000),
  pageSize: int(1, 2000),
})
export type OrganizationListQuery = z.infer<typeof organizationListQuerySchema>

export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  // Demo parameter name.
  if (out.pageSize === undefined && out.page_size !== undefined) out.pageSize = out.page_size
  return out
}

/** The paged {count, results} shape is returned only when explicitly asked for, so the
 * selects of the other pages keep receiving the plain array. */
export function wantsPagedList(params: URLSearchParams): boolean {
  return params.has("page") || params.has("pageSize") || params.has("page_size") || params.get("paged") === "1"
}

// ---------------------------------------------------------------------------
// Name keys
// ---------------------------------------------------------------------------

/** Same normalisation as lib/finance/entities.ts nameKey() / SQL fin_key(). */
export function organizationNameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function keySql(expression: string): string {
  return `lower(btrim(regexp_replace(replace(replace(coalesce(${expression}, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))`
}

/** Values the finance readers treat as "no organization" (placeName / fin_place). */
const PLACEHOLDER_KEYS = new Set(["-", "—", "не указано", "не указан", "все", "все филиалы", "все организации"])

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function rowToOrganization(row: OrganizationRow): Organization {
  return { id: Number(row.id), name: row.name, limitByDebt: Number(row.limit_by_debt) === 1 }
}

function rowToListItem(row: OrganizationRow): OrganizationListItem {
  return { ...rowToOrganization(row), createdDate: row.created_at ?? "" }
}

/** Plain list for the selects of the other pages (unchanged contract: id DESC). */
export async function listOrganizations(search = ""): Promise<Organization[]> {
  const db = getDb()
  const needle = search.trim().toLowerCase()
  const rows = (await (needle
    ? db.prepare("SELECT id, name, limit_by_debt, created_at FROM organizations WHERE strpos(lower(name), ?) > 0 ORDER BY id DESC").all(needle)
    : db.prepare("SELECT id, name, limit_by_debt, created_at FROM organizations ORDER BY id DESC").all())) as OrganizationRow[]
  return rows.map(rowToOrganization)
}

// The demo sorts names ignoring case, spaces and punctuation.
const NAME_KEY = `regexp_replace(lower(name), '[\\s''"\`.,_()/-]+', '', 'g')`

const ORDER_BY: Record<string, string> = {
  name: `${NAME_KEY} ASC, id ASC`,
  "-name": `${NAME_KEY} DESC, id DESC`,
  id: "id ASC",
  "-id": "id DESC",
  created_date: "created_at ASC, id ASC",
  "-created_date": "created_at DESC, id DESC",
}

/** The grid of the page (demo GET main/division/?search&page&page_size&ordering; default order = name). */
export async function listOrganizationsPage(query: OrganizationListQuery): Promise<OrganizationListResult> {
  const db = getDb()
  const needle = (query.search ?? "").toLowerCase()
  const orderBy = ORDER_BY[query.ordering ?? ""] ?? ORDER_BY.name
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const where = "WHERE (@needle = '' OR strpos(lower(name), @needle) > 0)"
  const countRow = (await db.prepare(`SELECT COUNT(*) AS n FROM organizations ${where}`).get({ needle })) as { n: string | number }
  const rows = (await db
    .prepare(`SELECT id, name, limit_by_debt, created_at FROM organizations ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ needle, limit: pageSize, offset: (page - 1) * pageSize })) as OrganizationRow[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(rowToListItem) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<OrganizationRow | undefined> {
  return (await db
    .prepare(`SELECT id, name, limit_by_debt, created_at FROM organizations WHERE id = ?${lock ? " FOR UPDATE" : ""}`)
    .get(id)) as OrganizationRow | undefined
}

export async function getOrganization(id: number): Promise<Organization | null> {
  const row = await readRow(getDb(), id)
  return row ? rowToOrganization(row) : null
}

/** Demo GET main/division/:id/; `withUsage` adds where the organization is referenced
 * (scans the referencing tables, so the dialogs do not ask for it). */
export async function getOrganizationDetail(id: number, withUsage = false): Promise<OrganizationDetail | null> {
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  return withUsage ? { ...rowToListItem(row), usage: await organizationUsage(db, row) } : rowToListItem(row)
}

// ---------------------------------------------------------------------------
// References (by name, by id, JSON arrays of names)
// ---------------------------------------------------------------------------

type ReferenceColumn = { table: string; column: string; kind: "name" | "names" | "id" }

const NAME_COLUMNS = ["organization", "from_organization", "to_organization"]

/** Section labels (Russian i18n keys) of the referencing tables. */
const TABLE_LABELS: Record<string, string> = {
  orders: "Заказы",
  cash_management_entries: "Касса",
  cash_transfers: "Перевод между кассами",
  cash_acceptances: "Принятие оплаты",
  customer_payments: "Оплаты",
  client_balance_corrections: "Корректировки баланса клиентов",
  client_balance_imports: "Импорт долгов клиентов",
  contracts: "Договоры",
  deliverer_balance_transactions: "Долги доставщиков",
  internal_transfers: "Передачи между складами",
  supplier_balance_transactions: "Баланс поставщиков",
  supplier_incomings: "Приход от поставщика",
  supplier_payments: "Оплаты поставщикам",
  supplier_returns: "Возврат поставщику",
  suppliers: "Поставщики",
  products: "Продукты",
  product_types: "Типы продуктов",
  raw_materials: "Сырье",
  brands: "Бренд",
  employees: "Сотрудники",
  surveys: "Опросник",
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

async function referenceColumns(db: PgDb): Promise<ReferenceColumn[]> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name <> 'organizations'
          AND c.column_name = ANY(@columns::text[])
        ORDER BY c.table_name, c.column_name`,
    )
    .all({ columns: [...NAME_COLUMNS, "organizations", "organization_id"] })) as Array<{ table_name: string; column_name: string; data_type: string }>
  const textual = (type: string) => type === "text" || type === "character varying"
  const out: ReferenceColumn[] = []
  for (const row of rows) {
    if (row.column_name === "organization_id") {
      if (["integer", "bigint", "smallint"].includes(row.data_type)) out.push({ table: row.table_name, column: row.column_name, kind: "id" })
    } else if (row.column_name === "organizations") {
      if (textual(row.data_type)) out.push({ table: row.table_name, column: row.column_name, kind: "names" })
    } else if (textual(row.data_type)) {
      out.push({ table: row.table_name, column: row.column_name, kind: "name" })
    }
  }
  return out
}

function parseNames(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "")) : null
  } catch {
    return null
  }
}

/** Distinct JSON-array values of `table.column` that contain the organization key. */
async function jsonArrayMatches(db: PgDb, ref: ReferenceColumn, key: string): Promise<Array<{ value: string; names: string[]; rows: number }>> {
  const column = quoteIdent(ref.column)
  const rows = (await db
    .prepare(`SELECT ${column} AS v, COUNT(*) AS n FROM ${quoteIdent(ref.table)} WHERE ${column} IS NOT NULL AND ${column} NOT IN ('', '[]') GROUP BY ${column}`)
    .all()) as Array<{ v: string; n: string | number }>
  const out: Array<{ value: string; names: string[]; rows: number }> = []
  for (const row of rows) {
    const names = parseNames(row.v)
    if (names && names.some((name) => organizationNameKey(name) === key)) out.push({ value: row.v, names, rows: Number(row.n) })
  }
  return out
}

async function organizationUsage(db: PgDb, row: OrganizationRow, refs?: ReferenceColumn[]): Promise<OrganizationUsage[]> {
  const columns = refs ?? (await referenceColumns(db))
  const key = organizationNameKey(row.name)
  const byTable = new Map<string, ReferenceColumn[]>()
  for (const ref of columns) byTable.set(ref.table, [...(byTable.get(ref.table) ?? []), ref])

  const usage: OrganizationUsage[] = []
  for (const [table, tableRefs] of byTable) {
    let count = 0
    const scalar = tableRefs.filter((ref) => ref.kind !== "names")
    if (scalar.length) {
      const conditions = scalar.map((ref) => (ref.kind === "id" ? `${quoteIdent(ref.column)} = @id` : `${keySql(quoteIdent(ref.column))} = @key`))
      const result = (await db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE ${conditions.join(" OR ")}`).get({ id: Number(row.id), key })) as { n: string | number } | undefined
      count += Number(result?.n ?? 0)
    }
    for (const ref of tableRefs.filter((item) => item.kind === "names")) {
      for (const match of await jsonArrayMatches(db, ref, key)) count += match.rows
    }
    if (count > 0) usage.push({ table, label: TABLE_LABELS[table] ?? table, count })
  }
  return usage
}

/** Points every reference of `oldName` at `newName` (exact new spelling). Returns the updated row count. */
async function cascadeRename(db: PgDb, oldName: string, newName: string): Promise<number> {
  const refs = await referenceColumns(db)
  const oldKey = organizationNameKey(oldName)
  let changed = 0
  for (const ref of refs) {
    if (ref.kind === "id") continue // contracts.organization_id follows the row by id
    const table = quoteIdent(ref.table)
    const column = quoteIdent(ref.column)
    if (ref.kind === "name") {
      const result = await db.prepare(`UPDATE ${table} SET ${column} = @newName WHERE ${keySql(column)} = @oldKey AND ${column} <> @newName`).run({ newName, oldKey })
      changed += result.changes
      continue
    }
    for (const match of await jsonArrayMatches(db, ref, oldKey)) {
      const next = [...new Set(match.names.map((name) => (organizationNameKey(name) === oldKey ? newName : name)))]
      const result = await db.prepare(`UPDATE ${table} SET ${column} = @next WHERE ${column} = @value`).run({ next: JSON.stringify(next), value: match.value })
      changed += result.changes
    }
  }
  return changed
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Serialises organization writes (uniqueness check + insert/rename/delete). */
async function lockOrganizations(db: PgDb) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:organizations'))").get()
}

async function assertNameAvailable(db: PgDb, name: string, exceptId: number | null) {
  const key = organizationNameKey(name)
  if (!key || PLACEHOLDER_KEYS.has(key)) throw new OrganizationError("Недопустимое наименование организации", 400, "name")
  const duplicate = (await db
    .prepare(`SELECT id FROM organizations WHERE ${keySql("name")} = @key AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1`)
    .get({ key, exceptId })) as { id: number } | undefined
  if (duplicate) throw new OrganizationError("Организация с таким наименованием уже существует", 400, "name")
}

export async function createOrganization(input: OrganizationInput): Promise<Organization> {
  return withTransaction(async (tx) => {
    await lockOrganizations(tx)
    await assertNameAvailable(tx, input.name, null)
    const result = await tx
      .prepare("INSERT INTO organizations (name, limit_by_debt) VALUES (@name, @limitByDebt)")
      .run({ name: input.name, limitByDebt: input.limitByDebt ? 1 : 0 })
    return rowToOrganization((await readRow(tx, Number(result.lastInsertRowid)))!)
  })
}

/** Demo PUT main/division/:id. A rename is carried over to every document that stores the name. */
export async function updateOrganization(id: number, input: OrganizationInput): Promise<Organization | null> {
  return withTransaction(async (tx) => {
    await lockOrganizations(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    if (current.name !== input.name) {
      await assertNameAvailable(tx, input.name, id)
      await cascadeRename(tx, current.name, input.name)
    }
    await tx
      .prepare("UPDATE organizations SET name = @name, limit_by_debt = @limitByDebt, updated_at = datetime('now') WHERE id = @id")
      .run({ id, name: input.name, limitByDebt: input.limitByDebt ? 1 : 0 })
    return rowToOrganization((await readRow(tx, id))!)
  })
}

/** Demo DELETE main/division/:id — refused while any document references the organization. */
export async function deleteOrganization(id: number): Promise<boolean> {
  return withTransaction(async (tx) => {
    await lockOrganizations(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await organizationUsage(tx, current)
    if (usage.length) throw new OrganizationError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM organizations WHERE id = ?").run(id)
    return result.changes > 0
  })
}
