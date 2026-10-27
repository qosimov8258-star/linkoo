import "server-only"

import { NextResponse } from "next/server"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { dbErrorResponse } from "@/lib/db-errors"
import { keySql } from "@/lib/platform-refs"
import {
  employeeRestrictedSql,
  productAllowedSql,
  productOfTypeSql,
  resolveRestrictionEmployee,
} from "@/lib/product-restrictions-check"
import type { AllowedQuery, RestrictionApplyInput, RestrictionListQuery, RestrictionOptionsQuery } from "@/lib/product-restrictions-schema"
import type {
  AllowedProducts,
  RestrictionApplyResult,
  RestrictionDetail,
  RestrictionFilters,
  RestrictionItem,
  RestrictionListResponse,
  RestrictionOptionsResponse,
} from "@/lib/product-restrictions-types"

// "Ограничение продуктов" (demo #/user_product): a whitelist of products and one of product
// types per employee, linked by id (demo main/user_product). Tables:
//   product_restrictions (employee_id → employees, product_id → products)
//   product_type_restrictions (employee_id → employees, product_type_id → product_types)
// Both cascade when the employee / product / type row is deleted, so no id ever dangles (the
// product delete check of lib/catalog-refs.ts finds product_restrictions.product_id on its own
// and refuses a hard delete with 409 while the product is in a list).
//
// Writes (ADD / REMOVE / SET for many employees at once) run in one transaction under the
// module's advisory lock, so parallel requests apply one after the other (a SET is never mixed
// with another one); the employees and items are locked FOR KEY SHARE in id order and checked
// inside it (unknown → 400). No catalog lock is taken: product / type deletes hold their row
// FOR UPDATE while they wait for linko-catalog, and waiting for that lock here would deadlock.

export const EMPLOYEE_NOT_FOUND = "Сотрудник не найден"
export const PRODUCT_NOT_FOUND = "Товар не найден"
export const PRODUCT_DELETED = "Товар удален"
export const PRODUCT_TYPE_NOT_FOUND = "Тип продукта не найден"
export const EMPLOYEE_NOT_GIVEN = "Сотрудник не указан"
const BRAND_NOT_FOUND = "Бренд не найден"
const ORGANIZATION_NOT_FOUND = "Организация не найдена"
const DATA_CHANGED = "Данные изменились, обновите страницу"

export class ProductRestrictionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string,
    /** The refused ids / names (data, shown after the translated message). */
    readonly items?: Array<{ id: number; name?: string }>,
  ) {
    super(message)
  }
}

/** JSON answer of a ProductRestrictionError / busy database / foreign-key race, else null. */
export function productRestrictionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ProductRestrictionError) {
    return NextResponse.json(
      { error: error.message, ...(error.field ? { field: error.field } : {}), ...(error.items ? { items: error.items } : {}) },
      { status: error.status },
    )
  }
  // A referenced row vanished between the check and the write (should not happen under the locks).
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503") {
    return NextResponse.json({ error: DATA_CHANGED }, { status: 409 })
  }
  return dbErrorResponse(error)
}

// ---------------------------------------------------------------------------
// Schema (fresh-install safe, once per process, never inside a request transaction)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

declare global {
  var __linkoProductRestrictionsSchema: { version: number; ready: Promise<void> } | undefined
}

type LegacyRow = { scope: string; employee: string; items: string }

function legacyItems(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
  } catch {
    return []
  }
}

/** Moves the older name-based rows (scope, employee name, JSON array of names) to the id tables:
 * a name that matches no employee / live product / type is left behind in product_restrictions_legacy. */
async function migrateLegacy(tx: PgDb, rows: LegacyRow[]) {
  const fullName = "btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))"
  for (const row of rows) {
    const employee = (await tx
      .prepare(`SELECT id FROM employees WHERE ${keySql(fullName)} = ${keySql("@name::text")} ORDER BY id LIMIT 1`)
      .get({ name: row.employee })) as { id: number } | undefined
    if (!employee) continue
    for (const name of legacyItems(row.items)) {
      if (row.scope === "types") {
        await tx
          .prepare(
            `INSERT INTO product_type_restrictions (employee_id, product_type_id)
             SELECT @employeeId, id FROM product_types WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY parent_id NULLS FIRST, id LIMIT 1
             ON CONFLICT DO NOTHING RETURNING employee_id`,
          )
          .all({ employeeId: employee.id, name })
      } else {
        await tx
          .prepare(
            `INSERT INTO product_restrictions (employee_id, product_id)
             SELECT @employeeId, id FROM products WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY COALESCE(deleted, 0), id LIMIT 1
             ON CONFLICT DO NOTHING RETURNING employee_id`,
          )
          .all({ employeeId: employee.id, name })
      }
    }
  }
}

/** The two id tables, once per process. The older name-based product_restrictions table (scope,
 * employee, items) is migrated: dropped when empty, else renamed to product_restrictions_legacy
 * after its rows were copied. */
export function ensureProductRestrictionsSchema(): Promise<void> {
  if (globalThis.__linkoProductRestrictionsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:product_restrictions:schema'))")
        const legacy = await tx
          .prepare(
            `SELECT 1 AS ok FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'product_restrictions' AND column_name = 'scope'`,
          )
          .get()
        let legacyRows: LegacyRow[] = []
        if (legacy) {
          legacyRows = (await tx.prepare("SELECT scope, employee, items FROM product_restrictions ORDER BY id").all()) as LegacyRow[]
          if (legacyRows.length) {
            // Kept as a backup under a free name (product_restrictions_legacy, else …_legacy_<n>).
            const taken = (await tx
              .prepare("SELECT relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname LIKE 'product\\_restrictions\\_legacy%'")
              .all()) as Array<{ relname: string }>
            const names = new Set(taken.map((row) => row.relname))
            let backup = "product_restrictions_legacy"
            for (let n = 2; names.has(backup); n++) backup = `product_restrictions_legacy_${n}`
            await tx.exec(`ALTER TABLE product_restrictions RENAME TO ${backup}`)
          } else {
            await tx.exec("DROP TABLE product_restrictions")
          }
        }
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS product_restrictions (
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CONSTRAINT product_restrictions_employee_product_pkey PRIMARY KEY (employee_id, product_id)
          );
          CREATE INDEX IF NOT EXISTS product_restrictions_product_idx ON product_restrictions (product_id);
          CREATE TABLE IF NOT EXISTS product_type_restrictions (
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CONSTRAINT product_type_restrictions_employee_type_pkey PRIMARY KEY (employee_id, product_type_id)
          );
          CREATE INDEX IF NOT EXISTS product_type_restrictions_type_idx ON product_type_restrictions (product_type_id);
        `)
        if (legacyRows.length) await migrateLegacy(tx, legacyRows)
      }),
    ).catch((error) => {
      globalThis.__linkoProductRestrictionsSchema = undefined
      throw error
    })
    globalThis.__linkoProductRestrictionsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoProductRestrictionsSchema!.ready
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const FULL_NAME = "btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))"

/** Display name of a product type: "Parent / Child" for a subcategory (child names repeat across parents). */
const TYPE_NAME = "CASE WHEN pt.id IS NULL THEN t.name ELSE pt.name || ' / ' || t.name END"

type EmployeeRow = { id: number; name: string; active: number | null; product_count: number | string; product_type_count: number | string }

const EMPLOYEE_ROWS = `
  SELECT e.id, ${FULL_NAME} AS name, COALESCE(e.active, 1) AS active,
         (SELECT COUNT(*) FROM product_restrictions r WHERE r.employee_id = e.id)::int AS product_count,
         (SELECT COUNT(*) FROM product_type_restrictions r WHERE r.employee_id = e.id)::int AS product_type_count
    FROM employees e`

function toListRow(row: EmployeeRow) {
  return {
    id: Number(row.id),
    name: row.name,
    active: Number(row.active) !== 0,
    productCount: Number(row.product_count) || 0,
    productTypeCount: Number(row.product_type_count) || 0,
  }
}

/**
 * The employees of the page: every active employee (agents, van sellers … — the order form
 * offers them all as the agent) and any inactive one that still has a list, with the size of
 * both lists. Paged on the server like the demo (count + page), by id.
 */
export async function listRestrictionEmployees(query: RestrictionListQuery): Promise<RestrictionListResponse> {
  await ensureProductRestrictionsSchema()
  const db = getDb()
  const where = `WHERE (x.active <> 0 OR x.product_count > 0 OR x.product_type_count > 0)
                   AND (@search = '' OR strpos(${keySql("x.name")}, ${keySql("@search::text")}) > 0)`
  const params = { search: query.search }
  const total = (await db.prepare(`SELECT COUNT(*)::int AS n FROM (${EMPLOYEE_ROWS}) x ${where}`).get(params)) as { n: number | string } | undefined
  const count = Number(total?.n ?? 0)
  const pageCount = Math.max(1, Math.ceil(count / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const rows = (await db
    .prepare(`SELECT * FROM (${EMPLOYEE_ROWS}) x ${where} ORDER BY x.id ${query.ordering === "-id" ? "DESC" : "ASC"} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize })) as EmployeeRow[]
  return { count, page, pageSize: query.pageSize, results: rows.map(toListRow) }
}

/** One employee with both lists (sorted by name); null when the employee does not exist. */
export async function getRestrictionDetail(employeeId: number): Promise<RestrictionDetail | null> {
  await ensureProductRestrictionsSchema()
  const db = getDb()
  const employee = (await db.prepare(`SELECT * FROM (${EMPLOYEE_ROWS}) x WHERE x.id = ?`).get(employeeId)) as EmployeeRow | undefined
  if (!employee) return null
  const products = (await db
    .prepare(
      `SELECT p.id, p.name, COALESCE(p.deleted, 0) AS deleted
         FROM product_restrictions r JOIN products p ON p.id = r.product_id
        WHERE r.employee_id = ?
        ORDER BY lower(p.name), p.id`,
    )
    .all(employeeId)) as Array<{ id: number; name: string; deleted: number }>
  const types = (await db
    .prepare(
      `SELECT t.id, ${TYPE_NAME} AS name
         FROM product_type_restrictions r
         JOIN product_types t ON t.id = r.product_type_id
         LEFT JOIN product_types pt ON pt.id = t.parent_id
        WHERE r.employee_id = ?
        ORDER BY lower(${TYPE_NAME}), t.id`,
    )
    .all(employeeId)) as Array<{ id: number; name: string }>
  const row = toListRow(employee)
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    products: products.map((item) => ({ id: Number(item.id), name: item.name, ...(Number(item.deleted) === 1 ? { deleted: true } : {}) })),
    productTypes: types.map((item) => ({ id: Number(item.id), name: item.name })),
  }
}

async function nameOfId(db: PgDb, table: "product_types" | "brands" | "organizations", id: number): Promise<string | null> {
  const row = (await db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id)) as { name: string } | undefined
  return row ? row.name : null
}

/** The picker's page: live products (filtered by type / brand / organization) or product types, by name. */
export async function listRestrictionOptions(query: RestrictionOptionsQuery): Promise<RestrictionOptionsResponse> {
  await ensureProductRestrictionsSchema()
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  let from: string
  let nameSql: string
  if (query.kind === "product") {
    from = "products p"
    nameSql = "p.name"
    conditions.push("COALESCE(p.deleted, 0) = 0")
    if (query.typeId !== null) {
      const type = (await db.prepare("SELECT id FROM product_types WHERE id = ?").get(query.typeId)) as { id: number } | undefined
      if (!type) throw new ProductRestrictionError(PRODUCT_TYPE_NOT_FOUND, 400, "type")
      conditions.push(
        `EXISTS (SELECT 1 FROM product_types t LEFT JOIN product_types pt ON pt.id = t.parent_id WHERE t.id = @typeId AND ${productOfTypeSql("p", "t", "pt")})`,
      )
      params.typeId = query.typeId
    }
    if (query.brandId !== null) {
      const brand = await nameOfId(db, "brands", query.brandId)
      if (brand === null) throw new ProductRestrictionError(BRAND_NOT_FOUND, 400, "brand")
      conditions.push(`${keySql("p.brand")} = ${keySql("@brand::text")}`)
      params.brand = brand
    }
    if (query.organizationId !== null) {
      const organization = await nameOfId(db, "organizations", query.organizationId)
      if (organization === null) throw new ProductRestrictionError(ORGANIZATION_NOT_FOUND, 400, "organization")
      conditions.push(`${keySql("p.organization")} = ${keySql("@organization::text")}`)
      params.organization = organization
    }
  } else {
    from = "product_types t LEFT JOIN product_types pt ON pt.id = t.parent_id"
    nameSql = TYPE_NAME
  }
  if (query.search) {
    conditions.push(`strpos(${keySql(nameSql)}, ${keySql("@search::text")}) > 0`)
    params.search = query.search
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const idSql = query.kind === "product" ? "p.id" : "t.id"
  // A statement without @names must get no parameters (pg refuses unused ones).
  const counted = db.prepare(`SELECT COUNT(*)::int AS n FROM ${from} ${where}`)
  const total = (await (Object.keys(params).length ? counted.get(params) : counted.get())) as { n: number | string } | undefined
  const count = Number(total?.n ?? 0)
  const pageCount = Math.max(1, Math.ceil(count / query.pageSize))
  const page = Math.min(query.page, pageCount)
  const rows = (await db
    .prepare(`SELECT ${idSql} AS id, ${nameSql} AS name FROM ${from} ${where} ORDER BY lower(${nameSql}), ${idSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (page - 1) * query.pageSize })) as Array<{ id: number; name: string }>
  return { count, page, pageSize: query.pageSize, results: rows.map((row) => ({ id: Number(row.id), name: row.name })) }
}

/** The picker's filter lists: product types (with parents), brands and organizations, by name. */
export async function restrictionFilters(): Promise<RestrictionFilters> {
  const db = getDb()
  const types = (await db
    .prepare(`SELECT t.id, ${TYPE_NAME} AS name FROM product_types t LEFT JOIN product_types pt ON pt.id = t.parent_id ORDER BY lower(${TYPE_NAME}), t.id`)
    .all()) as Array<{ id: number; name: string }>
  const brands = (await db.prepare("SELECT id, name FROM brands ORDER BY lower(name), id").all()) as Array<{ id: number; name: string }>
  const organizations = (await db.prepare("SELECT id, name FROM organizations ORDER BY lower(name), id").all()) as Array<{ id: number; name: string }>
  const items = (rows: Array<{ id: number; name: string }>): RestrictionItem[] => rows.map((row) => ({ id: Number(row.id), name: row.name }))
  return { types: items(types), brands: items(brands), organizations: items(organizations) }
}

/** What an employee may sell (for the mobile agent app and the order forms). */
export async function allowedProducts(query: AllowedQuery, ownEmployeeId: number | null): Promise<AllowedProducts> {
  await ensureProductRestrictionsSchema()
  const db = getDb()
  const target = query.employeeId !== null || query.agent ? query : { employeeId: ownEmployeeId, agent: null }
  if (target.employeeId === null && !target.agent) throw new ProductRestrictionError(EMPLOYEE_NOT_GIVEN, 400, "employeeId")
  const employee = await resolveRestrictionEmployee(db, target)
  if (!employee) throw new ProductRestrictionError(EMPLOYEE_NOT_FOUND, 404, target.employeeId !== null ? "employeeId" : "agent")
  const params = { employeeId: employee.id }
  const restricted = (await db.prepare(`SELECT ${employeeRestrictedSql("@employeeId::int")} AS restricted`).get(params)) as { restricted: boolean } | undefined
  const productIds = (await db.prepare("SELECT product_id AS id FROM product_restrictions WHERE employee_id = @employeeId ORDER BY product_id").all(params)) as Array<{ id: number }>
  const typeIds = (await db.prepare("SELECT product_type_id AS id FROM product_type_restrictions WHERE employee_id = @employeeId ORDER BY product_type_id").all(params)) as Array<{
    id: number
  }>
  let allowed: number[] | null = null
  if (restricted?.restricted) {
    const rows = (await db
      .prepare(`SELECT p.id FROM products p WHERE COALESCE(p.deleted, 0) = 0 AND ${productAllowedSql("@employeeId::int")} ORDER BY p.id`)
      .all(params)) as Array<{ id: number }>
    allowed = rows.map((row) => Number(row.id))
  }
  return {
    employeeId: employee.id,
    name: employee.name,
    restricted: Boolean(restricted?.restricted),
    productIds: productIds.map((row) => Number(row.id)),
    productTypeIds: typeIds.map((row) => Number(row.id)),
    allowedProductIds: allowed,
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Ids of `ids` missing from `found`, in the order given. */
function missingIds(ids: number[], found: Array<{ id: number }>): Array<{ id: number }> {
  const present = new Set(found.map((row) => Number(row.id)))
  return ids.filter((id) => !present.has(id)).map((id) => ({ id }))
}

/**
 * ADD / REMOVE / SET of products or product types for every employee of `employeeIds`, in one
 * transaction. ADD and SET take live products only (a deleted one → 400 with its name); REMOVE
 * takes any existing one, so a list can be cleaned of deleted products. SET with no items clears
 * the list (the restriction is lifted).
 */
export async function applyProductRestrictions(input: RestrictionApplyInput): Promise<RestrictionApplyResult> {
  await ensureProductRestrictionsSchema()
  const product = input.tab === "product"
  const table = product ? "product_restrictions" : "product_type_restrictions"
  const column = product ? "product_id" : "product_type_id"
  const employeeIds = [...input.employeeIds].sort((a, b) => a - b)
  const itemIds = [...input.itemIds].sort((a, b) => a - b)
  return withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:product_restrictions')) AS ok").get()

    const employees = (await tx
      .prepare("SELECT id FROM employees WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE")
      .all({ ids: employeeIds })) as Array<{ id: number }>
    const unknownEmployees = missingIds(employeeIds, employees)
    if (unknownEmployees.length) throw new ProductRestrictionError(EMPLOYEE_NOT_FOUND, 400, "employeeIds", unknownEmployees)

    if (itemIds.length) {
      if (product) {
        const rows = (await tx
          .prepare("SELECT id, name, COALESCE(deleted, 0) AS deleted FROM products WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE")
          .all({ ids: itemIds })) as Array<{ id: number; name: string; deleted: number }>
        const unknown = missingIds(itemIds, rows)
        if (unknown.length) throw new ProductRestrictionError(PRODUCT_NOT_FOUND, 400, "itemIds", unknown)
        const deleted = rows.filter((row) => Number(row.deleted) === 1)
        if (input.mode !== "remove" && deleted.length) {
          throw new ProductRestrictionError(PRODUCT_DELETED, 400, "itemIds", deleted.map((row) => ({ id: Number(row.id), name: row.name })))
        }
      } else {
        const rows = (await tx
          .prepare("SELECT id FROM product_types WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE")
          .all({ ids: itemIds })) as Array<{ id: number }>
        const unknown = missingIds(itemIds, rows)
        if (unknown.length) throw new ProductRestrictionError(PRODUCT_TYPE_NOT_FOUND, 400, "itemIds", unknown)
      }
    }

    const params = { employees: employeeIds, items: itemIds }
    let changed = 0
    if (input.mode === "remove" || input.mode === "set") {
      const keep = input.mode === "set" ? `AND NOT (${column} = ANY(@items::int[]))` : `AND ${column} = ANY(@items::int[])`
      changed += (await tx.prepare(`DELETE FROM ${table} WHERE employee_id = ANY(@employees::int[]) ${keep}`).run(params)).changes
    }
    if ((input.mode === "add" || input.mode === "set") && itemIds.length) {
      const inserted = await tx
        .prepare(
          `INSERT INTO ${table} (employee_id, ${column})
           SELECT e.id, i.id FROM unnest(@employees::int[]) AS e(id) CROSS JOIN unnest(@items::int[]) AS i(id)
           ORDER BY e.id, i.id
           ON CONFLICT DO NOTHING RETURNING employee_id`,
        )
        .all(params)
      changed += inserted.length
    }
    return { employees: employeeIds.length, changed }
  })
}
