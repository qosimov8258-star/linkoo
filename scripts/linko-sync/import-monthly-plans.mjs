// Анализ маршрутов → an agent → «план продаж» → «План на продукты»: Linko's monthly sales plans (sales/monthly_plan/,
// fetch step lists → monthly_plans) into monthly_sales_plans (lib/monthly-plans-repo.ts). A division row (a sales sum and
// an АКБ per organization) or a product row (a quantity per product); Linko's product-type rows have no place here and
// are reported. Employee, organization and product ids are Linko's. A row keeps Linko's record id (linko_id): a re-run
// updates those rows and drops the ones Linko no longer has; a plan set here (no linko_id) is kept and Linko's row for
// the same agent, month and organization / product is skipped.
//
//   node scripts/linko-sync/import-monthly-plans.mjs     (raw: monthly_plans)
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("monthly-plans")
if (!hasRaw("monthly_plans")) {
  console.log("monthly plans: no raw monthly_plans (run fetch.mjs lists first)")
  process.exit(0)
}
const rows = raw("monthly_plans")
const stats = { inserted: 0, updated: 0, removed: 0, keptLocal: 0, productTypes: 0, empty: 0, missingEmployees: new Set(), missingOrganizations: new Set(), missingProducts: new Set() }
const idOf = (value) => Number(value && typeof value === "object" ? value.id : value) || null
const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value))
const kept = (value) => typeof value === "number" && Number.isFinite(value) && value !== 0

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:monthly_sales_plans'))")
  await client.query(`CREATE TABLE IF NOT EXISTS monthly_sales_plans (
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
  )`)
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS monthly_sales_plans_organization ON monthly_sales_plans (employee_id, year, month, organization_id) WHERE organization_id IS NOT NULL",
  )
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS monthly_sales_plans_product ON monthly_sales_plans (employee_id, year, month, product_id) WHERE product_id IS NOT NULL")
  const ids = async (table) => new Set((await client.query(`SELECT id FROM ${table}`)).rows.map((row) => Number(row.id)))
  const [employees, organizations, products] = [await ids("employees"), await ids("organizations"), await ids("products")]
  const existing = (await client.query("SELECT id, employee_id, year, month, organization_id, product_id, linko_id FROM monthly_sales_plans")).rows
  const byLinko = new Map(existing.filter((row) => row.linko_id !== null).map((row) => [Number(row.linko_id), row]))
  const local = new Set(
    existing.filter((row) => row.linko_id === null).map((row) => `${row.employee_id}:${row.year}:${row.month}:${row.organization_id ?? ""}:${row.product_id ?? ""}`),
  )
  const seen = new Set()
  for (const item of rows) {
    const linkoId = Number(item.id)
    const employeeId = idOf(item.user)
    const organizationId = idOf(item.division)
    const productId = idOf(item.product)
    if (!organizationId && !productId) {
      if (idOf(item.product_type)) stats.productTypes++
      continue
    }
    if (!employees.has(employeeId)) {
      stats.missingEmployees.add(employeeId)
      continue
    }
    if (organizationId && !organizations.has(organizationId)) {
      stats.missingOrganizations.add(organizationId)
      continue
    }
    if (!organizationId && !products.has(productId)) {
      stats.missingProducts.add(productId)
      continue
    }
    const year = Number(item.year)
    const month = Number(item.month)
    // A division row is its sales sum and АКБ, a product row its quantity; a row of zeros is no plan.
    const values = organizationId
      ? { organization_id: organizationId, product_id: null, summa: kept(num(item.summa)) ? num(item.summa) : null, akb: kept(num(item.akb)) ? num(item.akb) : null, amount: null }
      : { organization_id: null, product_id: productId, summa: null, akb: null, amount: kept(num(item.amount)) ? num(item.amount) : null }
    if (values.summa === null && values.akb === null && values.amount === null) {
      stats.empty++
      continue
    }
    if (local.has(`${employeeId}:${year}:${month}:${values.organization_id ?? ""}:${values.product_id ?? ""}`)) {
      stats.keptLocal++
      continue
    }
    seen.add(linkoId)
    const row = byLinko.get(linkoId)
    if (row) {
      await client.query(
        `UPDATE monthly_sales_plans SET employee_id = $1, year = $2, month = $3, organization_id = $4, product_id = $5, summa = $6, akb = $7, amount = $8,
                updated_at = datetime('now') WHERE id = $9`,
        [employeeId, year, month, values.organization_id, values.product_id, values.summa, values.akb, values.amount, row.id],
      )
      stats.updated++
    } else {
      const inserted = await client.query(
        `INSERT INTO monthly_sales_plans (employee_id, year, month, organization_id, product_id, summa, akb, amount, linko_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [employeeId, year, month, values.organization_id, values.product_id, values.summa, values.akb, values.amount, linkoId],
      )
      await register(client, run, "monthly_sales_plans", inserted.rows[0].id, "insert")
      stats.inserted++
    }
  }
  // Linko's rows it no longer has (or no longer as a plan).
  for (const [linkoId, row] of byLinko) {
    if (seen.has(linkoId)) continue
    await client.query("DELETE FROM monthly_sales_plans WHERE id = $1", [row.id])
    stats.removed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}

console.log(
  `monthly plans: ${stats.inserted} added, ${stats.updated} updated, ${stats.removed} removed, ${stats.keptLocal} kept (set here), ${stats.empty} empty` +
    (stats.productTypes ? `, ${stats.productTypes} product-type rows skipped` : "") +
    (stats.missingEmployees.size ? `, unknown employees ${[...stats.missingEmployees].slice(0, 10).join(", ")}` : "") +
    (stats.missingOrganizations.size ? `, unknown organizations ${[...stats.missingOrganizations].slice(0, 10).join(", ")}` : "") +
    (stats.missingProducts.size ? `, unknown products ${[...stats.missingProducts].slice(0, 10).join(", ")}` : ""),
)
