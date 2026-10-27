import "server-only"

import type { PgDb } from "@/lib/db"
import { keySql } from "@/lib/platform-refs"
import type { ProductRestrictionViolation } from "@/lib/product-restrictions-types"

// Enforcement of "Ограничение продуктов" for the order APIs (and the allowed-products API).
//
// Rule: an employee with a product list and / or a product type list may sell only the
// products in the product list or of a type in the type list; with neither list the employee
// is not restricted. A top-level type covers its products (products.type = the type) and so
// every subcategory of it; a child type ("Подкатегория") covers the products whose pair
// (type, subcategory) is (parent, child), the way lib/dictionaries-refs.ts links them.
//
// Everything here only reads, never runs DDL and never opens a connection of its own, so it is
// safe inside the caller's transaction (getDb() / the tx handle). While the tables do not exist
// yet (a fresh database, or the older name-based table not migrated by
// ensureProductRestrictionsSchema() of lib/product-restrictions-repo.ts) nobody is restricted.

/** Russian i18n key of the order refusal; the products and the agent go in `productRestriction`. */
export const PRODUCT_RESTRICTION_DENIED = "Агенту запрещено продавать товар"

/** SQL: the product row `p` belongs to the product type row `t` (with its parent row `pt`). */
export function productOfTypeSql(p = "p", t = "t", pt = "pt"): string {
  return `((${t}.parent_id IS NULL AND ${keySql(`${p}.type`)} = ${keySql(`${t}.name`)})
       OR (${t}.parent_id IS NOT NULL AND ${keySql(`${p}.type`)} = ${keySql(`${pt}.name`)} AND ${keySql(`${p}.subcategory`)} = ${keySql(`${t}.name`)}))`
}

/** SQL: the product row `p` may be sold by the employee `employeeParam` (assumes the employee is restricted). */
export function productAllowedSql(employeeParam: string, p = "p"): string {
  return `(EXISTS (SELECT 1 FROM product_restrictions r WHERE r.employee_id = ${employeeParam} AND r.product_id = ${p}.id)
        OR EXISTS (SELECT 1 FROM product_type_restrictions r
                     JOIN product_types t ON t.id = r.product_type_id
                     LEFT JOIN product_types pt ON pt.id = t.parent_id
                    WHERE r.employee_id = ${employeeParam} AND ${productOfTypeSql(p, "t", "pt")}))`
}

/** SQL: the employee `employeeParam` has a product or a product type list. */
export function employeeRestrictedSql(employeeParam: string): string {
  return `(EXISTS (SELECT 1 FROM product_restrictions WHERE employee_id = ${employeeParam})
        OR EXISTS (SELECT 1 FROM product_type_restrictions WHERE employee_id = ${employeeParam}))`
}

/** True when both id-based tables exist (created by ensureProductRestrictionsSchema). */
export async function restrictionTablesReady(db: PgDb): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'employee_id'
          AND table_name IN ('product_restrictions', 'product_type_restrictions')`,
    )
    .get()) as { n: number | string } | undefined
  return Number(row?.n ?? 0) === 2
}

export type RestrictionEmployee = { id: number; name: string }

/**
 * The employee an order's agent means: by id, else by the "First Last" name the order stores
 * (the same match as resolveEmployee of lib/orders-repo.ts: case- and space-insensitive, the
 * lowest id when several employees share the name). null when there is none.
 */
export async function resolveRestrictionEmployee(db: PgDb, input: { employeeId?: number | null; agent?: string | null }): Promise<RestrictionEmployee | null> {
  const fullName = "btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))"
  if (input.employeeId) {
    const row = (await db.prepare(`SELECT id, ${fullName} AS name FROM employees WHERE id = ?`).get(input.employeeId)) as RestrictionEmployee | undefined
    return row ? { id: Number(row.id), name: row.name } : null
  }
  const agent = String(input.agent ?? "").trim()
  if (!agent) return null
  const row = (await db
    .prepare(`SELECT id, ${fullName} AS name FROM employees WHERE ${keySql(fullName)} = ${keySql("@agent::text")} ORDER BY id LIMIT 1`)
    .get({ agent })) as RestrictionEmployee | undefined
  return row ? { id: Number(row.id), name: row.name } : null
}

/**
 * Products of `productIds` the agent may not sell, or null when every one is allowed (the agent
 * is unknown, not restricted, or the list is empty). Unknown product ids are ignored here: the
 * order code refuses them itself. Call it for the products an order adds or whose quantity
 * grows, and for every line when the order's agent changes; then refuse with
 * PRODUCT_RESTRICTION_DENIED (400) and the returned value as `productRestriction`.
 */
export async function findRestrictedProducts(
  db: PgDb,
  input: { employeeId?: number | null; agent?: string | null; productIds: number[] },
): Promise<ProductRestrictionViolation | null> {
  const ids = [...new Set(input.productIds.filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647))]
  if (!ids.length) return null
  if (!(await restrictionTablesReady(db))) return null
  const employee = await resolveRestrictionEmployee(db, input)
  if (!employee) return null
  const restricted = (await db.prepare(`SELECT ${employeeRestrictedSql("@employeeId::int")} AS restricted`).get({ employeeId: employee.id })) as
    | { restricted: boolean }
    | undefined
  if (!restricted?.restricted) return null
  const denied = (await db
    .prepare(`SELECT p.id, p.name FROM products p WHERE p.id = ANY(@ids::int[]) AND NOT ${productAllowedSql("@employeeId::int")} ORDER BY p.id`)
    .all({ ids, employeeId: employee.id })) as Array<{ id: number; name: string }>
  if (!denied.length) return null
  return { employeeId: employee.id, agent: employee.name, products: denied.map((row) => ({ id: Number(row.id), name: row.name })) }
}
