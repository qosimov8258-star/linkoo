import "server-only"

import { getDb } from "@/lib/db"
import type { Organization } from "@/components/analytics/organization-data"

type OrganizationRow = {
  id: number
  name: string
  limit_by_debt: number
}

function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    limitByDebt: row.limit_by_debt === 1,
  }
}

export type OrganizationInput = { name: string; limitByDebt: boolean }

export async function listOrganizations(): Promise<Organization[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM organizations ORDER BY id DESC").all()) as OrganizationRow[]
  return rows.map(rowToOrganization)
}

export async function getOrganization(id: number): Promise<Organization | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM organizations WHERE id = ?").get(id)) as OrganizationRow | undefined
  return row ? rowToOrganization(row) : null
}

export async function createOrganization(input: OrganizationInput): Promise<Organization> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO organizations (name, limit_by_debt) VALUES (@name, @limitByDebt)")
      .run({ name: input.name, limitByDebt: input.limitByDebt ? 1 : 0 }))
  return (await getOrganization(Number(result.lastInsertRowid)))!
}

export async function updateOrganization(id: number, input: OrganizationInput): Promise<Organization | null> {
  if (!(await getOrganization(id))) return null
  const db = getDb()
  await db.prepare("UPDATE organizations SET name = @name, limit_by_debt = @limitByDebt, updated_at = datetime('now') WHERE id = @id").run({
        id,
        name: input.name,
        limitByDebt: input.limitByDebt ? 1 : 0,
      })
  return (await getOrganization(id))
}

export async function deleteOrganization(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM organizations WHERE id = ?").run(id))
  return result.changes > 0
}
