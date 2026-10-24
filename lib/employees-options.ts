import "server-only"

import type { EmployeeOptions, NamedId } from "@/components/analytics/employees-data"
import { getDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import { getLicenseGroups } from "@/lib/subscriptions-repo"

const byName = (a: NamedId, b: NamedId) => {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a.id - b.id
}

async function names(sql: string): Promise<NamedId[]> {
  return (await getDb().prepare(sql).all()) as NamedId[]
}

/** Everything the employee form, filter and bulk dialogs pick from. */
export async function getEmployeeOptions(): Promise<EmployeeOptions> {
  await ensureEmployeesSchema()
  const db = getDb()
  const [jobs, accessRows, branches, organizations, warehouses, priceLists, currencies, startLocations, employees, cashboxes, restrictions, zones, licenses] = await Promise.all([
    names("SELECT id, name FROM job_positions ORDER BY id DESC"),
    db.prepare("SELECT id, name, capability_ids FROM access_rights ORDER BY id ASC").all() as Promise<Array<{ id: number; name: string; capability_ids: string }>>,
    names("SELECT id, name FROM branches"),
    names("SELECT id, name FROM organizations"),
    names("SELECT id, name FROM warehouses WHERE active = 1"),
    names("SELECT id, name FROM price_lists ORDER BY position ASC, id ASC"),
    names("SELECT id, name FROM currencies"),
    names("SELECT id, name FROM start_locations ORDER BY id ASC"),
    (db.prepare("SELECT id, btrim(first_name || ' ' || last_name) AS name, access_right_id AS \"accessRightId\" FROM employees WHERE active = 1 ORDER BY id ASC").all()) as Promise<EmployeeOptions["employees"]>,
    names("SELECT id, name FROM cashboxes ORDER BY id ASC"),
    names("SELECT id, name FROM order_time_restrictions ORDER BY id ASC").catch(() => []),
    names("SELECT id, title AS name FROM zone_options ORDER BY id ASC").catch(() => []),
    getLicenseGroups(),
  ])
  const capabilityNames = new Map(
    ((await db.prepare("SELECT id, name FROM capabilities").all()) as Array<{ id: number; name: string }>).map((row) => [row.id, row.name]),
  )
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
    organizations: organizations.sort(byName),
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
