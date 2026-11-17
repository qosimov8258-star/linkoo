import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"

// Анализ маршрутов → an agent → «план продаж» → «План на продукты» (Linko's sales/monthly_plan): an agent's plan for a
// month — per organization (Linko's division) a sales sum and an АКБ (active client base), and per product a quantity.
// A value cleared to nothing (or 0) drops its row. Rows copied from Linko keep its record id (linko_id,
// scripts/linko-sync/import-monthly-plans.mjs).

export type PlanOrganization = { id: number; name: string; summa: number | null; akb: number | null }
export type MonthlyPlan = {
  employeeId: number
  year: number
  month: number
  /** Every organization by name, with the agent's plan for the month (null = none). */
  organizations: PlanOrganization[]
  /** Products with a planned quantity this month. */
  plannedProducts: number
}
export type PlanProduct = { id: number; name: string; unit: string; amount: number | null }
export type PlanProductQuery = {
  employeeId: number
  year: number
  month: number
  search?: string
  /** Product type (with its subtypes) / subtype. */
  typeParent?: number
  typeChild?: number
  organizationId?: number
  onlyMml?: boolean
  /** Only the products with a planned quantity. */
  onlyPlanned?: boolean
}
export type PlanProductOptions = {
  types: Array<{ id: number; name: string; parentId: number | null }>
  organizations: Array<{ id: number; name: string }>
}

export class MonthlyPlanError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** The most products one list returns (the dialog searches the rest). */
export const PLAN_PRODUCTS_LIMIT = 500

export const MONTHLY_PLANS_DDL = [
  `CREATE TABLE IF NOT EXISTS monthly_sales_plans (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    organization_id INTEGER,
    product_id INTEGER,
    summa NUMERIC,
    akb NUMERIC,
    amount NUMERIC,
    linko_id INTEGER UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS monthly_sales_plans_organization ON monthly_sales_plans (employee_id, year, month, organization_id) WHERE organization_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS monthly_sales_plans_product ON monthly_sales_plans (employee_id, year, month, product_id) WHERE product_id IS NOT NULL",
]

declare global {
  var __linkoMonthlyPlansSchema: Promise<void> | undefined
}

function ensureSchema(): Promise<void> {
  globalThis.__linkoMonthlyPlansSchema ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:monthly_sales_plans'))")
      for (const statement of MONTHLY_PLANS_DDL) await tx.exec(statement)
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoMonthlyPlansSchema = undefined
    throw error
  })
  return globalThis.__linkoMonthlyPlansSchema
}

const num = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : Number(value))
/** A value worth a row: a number other than 0. */
const kept = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value !== 0

async function requireEmployee(db: PgDb, employeeId: number): Promise<void> {
  if (!(await db.prepare("SELECT id FROM employees WHERE id = ?").get(employeeId))) throw new MonthlyPlanError("Сотрудник не найден", 404)
}

/** The agent's plan for the month: every organization (by name) with its sales sum / АКБ, and the planned products. */
export async function getMonthlyPlan(employeeId: number, year: number, month: number): Promise<MonthlyPlan> {
  await ensureSchema()
  const db = getDb()
  const [rows, products] = await Promise.all([
    db
      .prepare(
        `SELECT o.id, o.name, p.summa, p.akb
           FROM organizations o
           LEFT JOIN monthly_sales_plans p ON p.organization_id = o.id AND p.employee_id = ? AND p.year = ? AND p.month = ?
          ORDER BY lower(o.name), o.id`,
      )
      .all(employeeId, year, month) as Promise<Array<{ id: number; name: string; summa: string | null; akb: string | null }>>,
    db
      .prepare("SELECT COUNT(*)::int AS n FROM monthly_sales_plans WHERE employee_id = ? AND year = ? AND month = ? AND product_id IS NOT NULL AND COALESCE(amount, 0) <> 0")
      .get(employeeId, year, month) as Promise<{ n: number } | undefined>,
  ])
  return {
    employeeId,
    year,
    month,
    organizations: rows.map((row) => ({ id: Number(row.id), name: row.name ?? "", summa: num(row.summa), akb: num(row.akb) })),
    plannedProducts: Number(products?.n ?? 0),
  }
}

/** «Сохранить» of the organizations: each row's sales sum and АКБ (both empty / 0 = no plan for it). */
export async function setOrganizationPlans(
  employeeId: number,
  year: number,
  month: number,
  rows: Array<{ organizationId: number; summa: number | null; akb: number | null }>,
): Promise<MonthlyPlan> {
  await ensureSchema()
  await withTransaction(async (db) => {
    await requireEmployee(db, employeeId)
    if (rows.length) {
      const known = new Set(
        ((await db.prepare("SELECT id FROM organizations WHERE id = ANY(?::int[])").all(rows.map((row) => row.organizationId))) as Array<{ id: number }>).map((row) => Number(row.id)),
      )
      if (rows.some((row) => !known.has(row.organizationId))) throw new MonthlyPlanError("Организация не найдена")
    }
    for (const row of rows) {
      if (!kept(row.summa) && !kept(row.akb)) {
        await db.prepare("DELETE FROM monthly_sales_plans WHERE employee_id = ? AND year = ? AND month = ? AND organization_id = ?").run(employeeId, year, month, row.organizationId)
        continue
      }
      await db
        .prepare(
          `INSERT INTO monthly_sales_plans (employee_id, year, month, organization_id, summa, akb)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (employee_id, year, month, organization_id) WHERE organization_id IS NOT NULL
           DO UPDATE SET summa = EXCLUDED.summa, akb = EXCLUDED.akb, updated_at = datetime('now')`,
        )
        .run(employeeId, year, month, row.organizationId, kept(row.summa) ? row.summa : null, kept(row.akb) ? row.akb : null)
    }
  })
  return getMonthlyPlan(employeeId, year, month)
}

/** The product list of «План на продукты» (by name) with the agent's quantities for the month. */
export async function listPlanProducts(query: PlanProductQuery): Promise<{ products: PlanProduct[]; total: number }> {
  await ensureSchema()
  const where = ["COALESCE(p.deleted, 0) = 0"]
  const args: unknown[] = [query.employeeId, query.year, query.month]
  const search = query.search?.trim()
  if (search) {
    where.push("(p.name ILIKE ? OR COALESCE(p.barcode, '') ILIKE ? OR COALESCE(p.article, '') ILIKE ?)")
    const like = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    args.push(like, like, like)
  }
  if (query.typeChild) {
    where.push("p.type = (SELECT name FROM product_types WHERE id = ?)")
    args.push(query.typeChild)
  } else if (query.typeParent) {
    where.push("p.type IN (SELECT name FROM product_types WHERE id = ? OR parent_id = ?)")
    args.push(query.typeParent, query.typeParent)
  }
  if (query.organizationId) {
    where.push("p.organization = (SELECT name FROM organizations WHERE id = ?)")
    args.push(query.organizationId)
  }
  if (query.onlyMml) where.push("COALESCE(p.only_mml, 0) = 1")
  if (query.onlyPlanned) where.push("COALESCE(mp.amount, 0) <> 0")
  const from = `FROM products p
    LEFT JOIN monthly_sales_plans mp ON mp.product_id = p.id AND mp.employee_id = ? AND mp.year = ? AND mp.month = ?
   WHERE ${where.join(" AND ")}`
  const db = getDb()
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT p.id, p.name, COALESCE(p.unit, '') AS unit, mp.amount ${from} ORDER BY lower(p.name), p.id LIMIT ${PLAN_PRODUCTS_LIMIT}`).all(...args) as Promise<
      Array<{ id: number; name: string; unit: string; amount: string | null }>
    >,
    db.prepare(`SELECT COUNT(*)::int AS n ${from}`).get(...args) as Promise<{ n: number } | undefined>,
  ])
  return {
    products: rows.map((row) => ({ id: Number(row.id), name: row.name ?? "", unit: row.unit ?? "", amount: num(row.amount) })),
    total: Number(count?.n ?? 0),
  }
}

/** The filter of «План на продукты»: product types (with their parent) and organizations. */
export async function planProductOptions(): Promise<PlanProductOptions> {
  const db = getDb()
  const [types, organizations] = await Promise.all([
    db.prepare("SELECT id, name, parent_id FROM product_types ORDER BY lower(name), id").all() as Promise<Array<{ id: number; name: string; parent_id: number | null }>>,
    db.prepare("SELECT id, name FROM organizations ORDER BY lower(name), id").all() as Promise<Array<{ id: number; name: string }>>,
  ])
  return {
    types: types.map((row) => ({ id: Number(row.id), name: row.name ?? "", parentId: row.parent_id === null ? null : Number(row.parent_id) })),
    organizations: organizations.map((row) => ({ id: Number(row.id), name: row.name ?? "" })),
  }
}

/** «Сохранить» of the products: each product's quantity (empty / 0 = no plan for it). */
export async function setProductPlans(employeeId: number, year: number, month: number, rows: Array<{ productId: number; amount: number | null }>): Promise<MonthlyPlan> {
  await ensureSchema()
  await withTransaction(async (db) => {
    await requireEmployee(db, employeeId)
    if (rows.length) {
      const known = new Set(((await db.prepare("SELECT id FROM products WHERE id = ANY(?::int[])").all(rows.map((row) => row.productId))) as Array<{ id: number }>).map((row) => Number(row.id)))
      if (rows.some((row) => !known.has(row.productId))) throw new MonthlyPlanError("Продукт не найден")
    }
    for (const row of rows) {
      if (!kept(row.amount)) {
        await db.prepare("DELETE FROM monthly_sales_plans WHERE employee_id = ? AND year = ? AND month = ? AND product_id = ?").run(employeeId, year, month, row.productId)
        continue
      }
      await db
        .prepare(
          `INSERT INTO monthly_sales_plans (employee_id, year, month, product_id, amount)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (employee_id, year, month, product_id) WHERE product_id IS NOT NULL
           DO UPDATE SET amount = EXCLUDED.amount, updated_at = datetime('now')`,
        )
        .run(employeeId, year, month, row.productId, row.amount)
    }
  })
  return getMonthlyPlan(employeeId, year, month)
}
