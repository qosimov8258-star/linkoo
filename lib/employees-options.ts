import "server-only"

import type { EmployeeOptions, NamedId } from "@/components/analytics/employees-data"
import { ensureUserEmployeeLink } from "@/lib/auth-employee"
import { getDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import { getLicenseGroups } from "@/lib/subscriptions-repo"

const byName = (a: NamedId, b: NamedId) => {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a.id - b.id
}

/** The reference lists organizations in the server's collation order: case-insensitive, spaces and punctuation ignored. */
const orgCollator = new Intl.Collator("en", { ignorePunctuation: true })
const byOrgName = (a: NamedId, b: NamedId) => orgCollator.compare(a.name, b.name) || a.id - b.id

const TABLES = [
  "job_positions",
  "access_rights",
  "branches",
  "organizations",
  "warehouses",
  "price_lists",
  "currencies",
  "start_locations",
  "employees",
  "cashboxes",
  "order_time_restrictions",
  "client_zones",
  "capabilities",
] as const

/** The tables of TABLES that exist: job_positions, branches and order_time_restrictions are created
 * lazily by their own modules, start_locations by none yet; a missing one lists nothing. The zones are
 * this company's own (client_zones, the Зоны directory). */
async function existingTables(): Promise<Set<string>> {
  const rows = (await getDb()
    .prepare("SELECT name FROM unnest(@tables::text[]) AS name WHERE to_regclass(name) IS NOT NULL")
    .all({ tables: [...TABLES] })) as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

/** Everything the employee form, filter and bulk dialogs pick from. */
export async function getEmployeeOptions(): Promise<EmployeeOptions> {
  await ensureUserEmployeeLink()
  await ensureEmployeesSchema()
  const tables = await existingTables()
  const rowsOf = async <T,>(table: (typeof TABLES)[number], sql: string): Promise<T[]> =>
    tables.has(table) ? ((await getDb().prepare(sql).all()) as T[]) : []
  const names = (table: (typeof TABLES)[number], sql: string) => rowsOf<NamedId>(table, sql)
  const [jobs, accessRows, branches, organizations, warehouses, priceLists, currencies, startLocations, employees, cashboxes, restrictions, zones, licenses] = await Promise.all([
    names("job_positions", "SELECT id, name FROM job_positions ORDER BY id DESC"),
    rowsOf<{ id: number; name: string; capability_ids: string }>("access_rights", "SELECT id, name, capability_ids FROM access_rights ORDER BY id ASC"),
    names("branches", "SELECT id, name FROM branches"),
    names("organizations", "SELECT id, name FROM organizations"),
    names("warehouses", "SELECT id, name FROM warehouses WHERE active = 1"),
    names("price_lists", "SELECT id, name FROM price_lists ORDER BY position ASC, id ASC"),
    names("currencies", "SELECT id, name FROM currencies"),
    names("start_locations", "SELECT id, name FROM start_locations ORDER BY id ASC"),
    rowsOf<EmployeeOptions["employees"][number]>(
      "employees",
      // The access right is the employee's, else the one its (non-administrator) account signs in with, as
      // the Сотрудники list shows it (lib/employees-repo.ts selectSql).
      `SELECT e.id, btrim(e.first_name || ' ' || e.last_name) AS name,
              COALESCE(e.access_right_id, (SELECT u.access_right_id FROM users u WHERE u.employee_id = e.id AND u.role <> 'admin' ORDER BY u.id LIMIT 1)) AS "accessRightId"
         FROM employees e WHERE e.active = 1 ORDER BY e.id ASC`,
    ),
    names("cashboxes", "SELECT id, name FROM cashboxes ORDER BY id ASC"),
    names("order_time_restrictions", "SELECT id, name FROM order_time_restrictions ORDER BY id ASC"),
    names("client_zones", "SELECT id, name FROM client_zones ORDER BY id ASC"),
    getLicenseGroups(),
  ])
  const capabilityNames = new Map((await names("capabilities", "SELECT id, name FROM capabilities")).map((row) => [row.id, row.name]))
  const accessRights = accessRows.map((row) => {
    let ids: number[] = []
    try {
      ids = JSON.parse(row.capability_ids) as number[]
    } catch {
      ids = []
    }
    return { id: row.id, name: row.name, groups: ids.map((id) => capabilityNames.get(id) ?? "") }
  })
  return {
    jobs,
    accessRights,
    branches: branches.sort(byName),
    organizations: organizations.sort(byOrgName),
    warehouses: warehouses.sort(byName),
    priceLists,
    currencies: currencies.sort(byName),
    startLocations,
    employees,
    cashboxes,
    restrictions,
    zones,
    licenses: licenses.map((group) => ({ key: group.key, name: group.name, available: group.available })),
  }
}
