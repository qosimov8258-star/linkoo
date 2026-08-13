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

export function parseOrganizationInput(body: unknown): OrganizationInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return { name, limitByDebt: value.limitByDebt === true }
}

export function listOrganizations(): Organization[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM organizations ORDER BY id DESC").all() as OrganizationRow[]
  return rows.map(rowToOrganization)
}

export function getOrganization(id: number): Organization | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as OrganizationRow | undefined
  return row ? rowToOrganization(row) : null
}

export function createOrganization(input: OrganizationInput): Organization {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO organizations (name, limit_by_debt) VALUES (@name, @limitByDebt)")
    .run({ name: input.name, limitByDebt: input.limitByDebt ? 1 : 0 })
  return getOrganization(Number(result.lastInsertRowid))!
}

export function updateOrganization(id: number, input: OrganizationInput): Organization | null {
  if (!getOrganization(id)) return null
  const db = getDb()
  db.prepare("UPDATE organizations SET name = @name, limit_by_debt = @limitByDebt, updated_at = datetime('now') WHERE id = @id").run({
    id,
    name: input.name,
    limitByDebt: input.limitByDebt ? 1 : 0,
  })
  return getOrganization(id)
}

export function deleteOrganization(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM organizations WHERE id = ?").run(id)
  return result.changes > 0
}
