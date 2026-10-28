import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureStockSchema } from "@/lib/stock/schema"
import { cascadeWarehouseRename, lockWarehouseNames, warehouseUsage, type WarehouseRenameChange } from "@/lib/warehouses-refs"
import type { WarehouseActiveFilter, WarehouseInput, WarehouseListQuery } from "@/lib/warehouses-schema"
import type {
  Warehouse,
  WarehouseDetail,
  WarehouseDetailWithUsage,
  WarehouseListResult,
  WarehouseStockType,
  WarehouseUsage,
} from "@/components/analytics/warehouses-data"

// "Склады" (demo #/stock, API stock/stock/). The demo links documents to a stock
// by id; this app stores the warehouse NAME on every document (and the stock core
// groups by fin_key(name)). To behave like the demo on that schema:
//   * names are unique by fin_key (case, surrounding and repeated spaces ignored);
//   * a rename is carried over in ONE transaction to every column that stores
//     warehouse names (lib/warehouses-refs.ts), so stock and history follow it;
//   * a delete is refused (409) while anything references the warehouse
//     ("Удаление невозможно из-за связи с другими данными" + where it is used);
//   * an inactive warehouse keeps its documents and stock but is left out of the
//     plain GET /api/warehouses list that the pickers use (?active=all opts in).
// The demo fields missing from the original table are added lazily below; branch and
// "Зав. склад" stay names (other modules read warehouses.branch / .manager as text),
// with manager_id remembering which employee was picked.

type WarehouseRow = {
  id: number
  name: string
  address: string | null
  branch: string | null
  manager: string | null
  created_date: string | null
  online: number | null
  active: number | null
  full_name: string | null
  stock_type: string | null
  manager_id: number | null
  lat: number | null
  lon: number | null
  for_return: number | null
  track_min_amount: number | null
  comment: string | null
  created_iso: string | null
}

export class WarehouseError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
    readonly usage?: WarehouseUsage[],
  ) {
    super(message)
  }
}

/** JSON response of a WarehouseError ({error, fields?, usage?}); null for other errors. */
export function warehouseErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof WarehouseError)) return dbErrorResponse(error)
  return NextResponse.json(
    { error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.usage ? { usage: error.usage } : {}) },
    { status: error.status },
  )
}

// ---------------------------------------------------------------------------
// Schema (lazy, idempotent, warehouses table only)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

declare global {
  var __linkoWarehousesSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  // fin_key() / fin_ts() come from the stock core (installed once per process).
  await ensureStockSchema()
  await getDb().exec(`ALTER TABLE warehouses
    ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS stock_type TEXT NOT NULL DEFAULT 'basic',
    ADD COLUMN IF NOT EXISTS manager_id INTEGER,
    ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS for_return INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS track_min_amount INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT ''`)
}

export function ensureWarehousesSchema(): Promise<void> {
  if (globalThis.__linkoWarehousesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoWarehousesSchema = undefined
      throw error
    })
    globalThis.__linkoWarehousesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoWarehousesSchema!.ready
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const SELECT = `SELECT id, name, address, branch, manager, created_date, online, active, full_name, stock_type, manager_id,
  lat, lon, for_return, track_min_amount, comment,
  to_char(COALESCE(fin_ts(NULLIF(created_at, ''), true), fin_ts(NULLIF(created_date, ''))), 'YYYY-MM-DD"T"HH24:MI:SS') AS created_iso
  FROM warehouses`

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "08 окт. 2026" (the created_date text the original table keeps) of an ISO day. */
function createdDateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return ""
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
}

function stockTypeOf(value: string | null): WarehouseStockType {
  return value === "manufacturing" ? "manufacturing" : "basic"
}

function rowToWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: Number(row.id),
    name: row.name,
    address: row.address ?? "",
    branch: row.branch ?? "",
    manager: row.manager ?? "",
    createdDate: row.created_date || createdDateLabel(row.created_iso ?? ""),
    online: Number(row.online) === 1,
    active: Number(row.active) === 1,
  }
}

function rowToDetail(row: WarehouseRow): WarehouseDetail {
  const lat = row.lat === null ? null : Number(row.lat)
  const lon = row.lon === null ? null : Number(row.lon)
  return {
    ...rowToWarehouse(row),
    fullName: row.full_name ?? "",
    stockType: stockTypeOf(row.stock_type),
    managerId: row.manager_id === null ? null : Number(row.manager_id),
    lat: lat !== null && lon !== null ? lat : null,
    lon: lat !== null && lon !== null ? lon : null,
    forReturn: Number(row.for_return) === 1,
    trackMinAmount: Number(row.track_min_amount) === 1,
    comment: row.comment ?? "",
    createdAt: row.created_iso ?? "",
  }
}

function activeCondition(active: WarehouseActiveFilter): string {
  if (active === "true") return "COALESCE(active, 1) = 1"
  if (active === "false") return "COALESCE(active, 1) <> 1"
  return "TRUE"
}

/** Plain list for the pickers of the other pages (unchanged contract: id DESC, the 8 original fields). */
export async function listWarehouses(options: { active?: WarehouseActiveFilter; search?: string } = {}): Promise<Warehouse[]> {
  await ensureWarehousesSchema()
  const needle = (options.search ?? "").trim().toLowerCase()
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE ${activeCondition(options.active ?? "true")} AND (@needle = '' OR strpos(lower(name), @needle) > 0) AND (@branch = '' OR branch = @branch) ORDER BY id DESC`)
    .all({ needle, branch: await selectedBranchName() })) as WarehouseRow[]
  return rows.map(rowToWarehouse)
}

const NAME_ORDER = "lower(name)"
const ORDER_COLUMNS: Record<string, string> = {
  name: NAME_ORDER,
  address: "lower(COALESCE(address, ''))",
  manager: "lower(COALESCE(manager, ''))",
  branch: "lower(COALESCE(branch, ''))",
  stock_type: "COALESCE(stock_type, 'basic')",
  is_van_sell: "COALESCE(online, 0)",
  created_date: "COALESCE(fin_ts(NULLIF(created_at, ''), true), fin_ts(NULLIF(created_date, '')))",
  id: "id",
}

function orderBy(ordering: string | undefined): string {
  if (!ordering) return `${NAME_ORDER} ASC, id ASC`
  const desc = ordering.startsWith("-")
  const expression = ORDER_COLUMNS[desc ? ordering.slice(1) : ordering] ?? NAME_ORDER
  const direction = desc ? "DESC" : "ASC"
  return `${expression} ${direction} NULLS LAST, id ${direction}`
}

/** The grid of the page (demo GET stock/stock/?is_active&search&ordering&page&page_size; default order = name). */
export async function listWarehousesPage(query: WarehouseListQuery): Promise<WarehouseListResult> {
  await ensureWarehousesSchema()
  const db = getDb()
  const needle = (query.search ?? "").trim().toLowerCase()
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const where = `WHERE ${activeCondition(query.active)}
    AND (@stockType = '' OR COALESCE(stock_type, 'basic') = @stockType)
    AND (@needle = '' OR strpos(lower(concat_ws(' ', name, full_name, address, branch, manager)), @needle) > 0)
    AND (@branch = '' OR branch = @branch)`
  const params = { needle, branch: await selectedBranchName(), stockType: query.stockType ?? "" }
  const countRow = (await db.prepare(`SELECT COUNT(*) AS n FROM warehouses ${where}`).get(params)) as { n: string | number } | undefined
  const rows = (await db
    .prepare(`${SELECT} ${where} ORDER BY ${orderBy(query.ordering)} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })) as WarehouseRow[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(rowToDetail) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<WarehouseRow | undefined> {
  return (await db.prepare(`${SELECT} WHERE id = @id${lock ? " FOR UPDATE" : ""}`).get({ id })) as WarehouseRow | undefined
}

/** Demo GET stock/stock/:id/; `withUsage` adds where the warehouse is referenced. */
export async function getWarehouseDetail(id: number, withUsage = false): Promise<WarehouseDetailWithUsage | null> {
  await ensureWarehousesSchema()
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  const detail = rowToDetail(row)
  return withUsage ? { ...detail, usage: await warehouseUsage(db, { id: detail.id, name: detail.name }) } : detail
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Serialises warehouse writes (uniqueness check + insert / rename / delete). */
async function lockWarehouses(db: PgDb) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:warehouses'))").get()
}

async function assertNameAvailable(db: PgDb, name: string, exceptId: number | null) {
  const duplicate = (await db
    .prepare("SELECT id FROM warehouses WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId })) as { id: number } | undefined
  if (duplicate) throw new WarehouseError("Склад с таким наименованием уже существует", 400, { name: "Склад с таким наименованием уже существует" })
}

async function branchName(db: PgDb, branch: NonNullable<WarehouseInput["branch"]>): Promise<string> {
  if ("name" in branch) return branch.name.trim()
  const row = (await db.prepare("SELECT name FROM branches WHERE id = ?").get(branch.id)) as { name: string } | undefined
  if (!row) throw new WarehouseError("Филиал не найден", 400, { branch: "Филиал не найден" })
  return row.name
}

async function managerOf(db: PgDb, manager: NonNullable<WarehouseInput["manager"]>): Promise<{ name: string; id: number | null }> {
  if ("name" in manager) return { name: manager.name.trim(), id: null }
  const row = (await db.prepare("SELECT first_name, last_name FROM employees WHERE id = ?").get(manager.id)) as { first_name: string; last_name: string } | undefined
  if (!row) throw new WarehouseError("Сотрудник не найден", 400, { manager: "Сотрудник не найден" })
  return { name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(), id: manager.id }
}

type StoredFields = {
  name: string
  full_name: string
  address: string
  branch: string
  manager: string
  manager_id: number | null
  stock_type: WarehouseStockType
  online: number
  for_return: number
  track_min_amount: number
  active: number
  comment: string
  lat: number | null
  lon: number | null
}

/** Input merged over the stored row (PUT keeps omitted fields) or over the defaults (POST). */
async function storedFields(db: PgDb, input: WarehouseInput, current: WarehouseRow | null): Promise<StoredFields> {
  const flag = (value: boolean | undefined, stored: number | null | undefined, fallback: number) =>
    value === undefined ? (stored === null || stored === undefined ? fallback : Number(stored) === 1 ? 1 : 0) : value ? 1 : 0
  const manager = input.manager ? await managerOf(db, input.manager) : { name: current?.manager ?? "", id: current?.manager_id ?? null }
  const location = input.location === undefined ? { lat: current?.lat ?? null, lon: current?.lon ?? null } : input.location ?? { lat: null, lon: null }
  return {
    name: input.name,
    full_name: input.fullName ?? current?.full_name ?? "",
    address: input.address ?? current?.address ?? "",
    branch: input.branch ? await branchName(db, input.branch) : current?.branch ?? "",
    manager: manager.name,
    manager_id: manager.id,
    stock_type: input.stockType ?? stockTypeOf(current?.stock_type ?? null),
    online: flag(input.online, current?.online, 0),
    for_return: flag(input.forReturn, current?.for_return, 0),
    track_min_amount: flag(input.trackMinAmount, current?.track_min_amount, 0),
    active: flag(input.active, current?.active, 1),
    comment: input.comment ?? current?.comment ?? "",
    lat: location.lat,
    lon: location.lon,
  }
}

/** Demo required fields that the API enforces (the dialog also asks for branch / manager / type). */
function assertRequired(fields: StoredFields) {
  if (!fields.address.trim()) throw new WarehouseError("Обязательное поле", 400, { address: "Обязательное поле" })
}

/** Demo POST stock/stock/. */
export async function createWarehouse(input: WarehouseInput): Promise<WarehouseDetail> {
  await ensureWarehousesSchema()
  return withTransaction(async (tx) => {
    await lockWarehouses(tx)
    await assertNameAvailable(tx, input.name, null)
    const fields = await storedFields(tx, input, null)
    assertRequired(fields)
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    const result = await tx
      .prepare(
        `INSERT INTO warehouses (name, full_name, address, branch, manager, manager_id, stock_type, online, for_return, track_min_amount,
           active, comment, lat, lon, created_date, created_at, updated_at)
         VALUES (@name, @full_name, @address, @branch, @manager, @manager_id, @stock_type, @online, @for_return, @track_min_amount,
           @active, @comment, @lat, @lon, @created_date, datetime('now'), datetime('now'))`,
      )
      .run({ ...fields, created_date: createdDateLabel(today) })
    return rowToDetail((await readRow(tx, Number(result.lastInsertRowid)))!)
  })
}

export type WarehouseUpdateResult = { warehouse: WarehouseDetail; renamed: WarehouseRenameChange[] }

/** Demo PUT stock/stock/:id. A rename is carried over to every document that stores the name. */
export async function updateWarehouse(id: number, input: WarehouseInput): Promise<WarehouseUpdateResult | null> {
  await ensureWarehousesSchema()
  return withTransaction(async (tx) => {
    await lockWarehouses(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    let renamed: WarehouseRenameChange[] = []
    if (current.name !== input.name) {
      await assertNameAvailable(tx, input.name, id)
      await lockWarehouseNames(tx, [current.name, input.name])
      renamed = await cascadeWarehouseRename(tx, current.name, input.name)
    }
    const fields = await storedFields(tx, input, current)
    assertRequired(fields)
    await tx
      .prepare(
        `UPDATE warehouses SET name = @name, full_name = @full_name, address = @address, branch = @branch, manager = @manager,
           manager_id = @manager_id, stock_type = @stock_type, online = @online, for_return = @for_return,
           track_min_amount = @track_min_amount, active = @active, comment = @comment, lat = @lat, lon = @lon,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...fields, id })
    return { warehouse: rowToDetail((await readRow(tx, id))!), renamed }
  })
}

/** Demo DELETE stock/stock/:id — refused while any document references the warehouse. */
export async function deleteWarehouse(id: number): Promise<boolean> {
  await ensureWarehousesSchema()
  return withTransaction(async (tx) => {
    await lockWarehouses(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    await lockWarehouseNames(tx, [current.name])
    const usage = await warehouseUsage(tx, { id: Number(current.id), name: current.name })
    if (usage.length) throw new WarehouseError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM warehouses WHERE id = ?").run(id)
    return result.changes > 0
  })
}
