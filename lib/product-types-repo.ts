import "server-only"

import { getDb } from "@/lib/db"
import type { ProductType } from "@/components/analytics/product-types-data"

type Row = {
  id: number
  name: string
  organization: string
  parent_id: number | null
  show_in_bot: number
  created_at: string
}

function rowToProductType(row: Row): ProductType {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    parentId: row.parent_id,
    showInBot: row.show_in_bot === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type ProductTypeInput = { name: string; organization: string; parentId: number | null; showInBot: boolean }

export function parseProductTypeInput(body: unknown): ProductTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const organization = typeof value.organization === "string" ? value.organization.trim() : ""
  if (!name || !organization) return null
  const parentIdRaw = value.parentId
  const parentId = typeof parentIdRaw === "number" && Number.isFinite(parentIdRaw) ? parentIdRaw : null
  return { name, organization, parentId, showInBot: value.showInBot === true }
}

export function listProductTypes(): ProductType[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM product_types ORDER BY id DESC").all() as Row[]
  return rows.map(rowToProductType)
}

export function getProductType(id: number): ProductType | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM product_types WHERE id = ?").get(id) as Row | undefined
  return row ? rowToProductType(row) : null
}

export function createProductType(input: ProductTypeInput): ProductType {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO product_types (name, organization, parent_id, show_in_bot) VALUES (@name, @organization, @parentId, @showInBot)")
    .run({ name: input.name, organization: input.organization, parentId: input.parentId, showInBot: input.showInBot ? 1 : 0 })
  return getProductType(Number(result.lastInsertRowid))!
}

export function updateProductType(id: number, input: ProductTypeInput): ProductType | null {
  if (!getProductType(id)) return null
  const db = getDb()
  db.prepare(
    `UPDATE product_types SET name = @name, organization = @organization, parent_id = @parentId,
       show_in_bot = @showInBot, updated_at = datetime('now') WHERE id = @id`,
  ).run({ id, name: input.name, organization: input.organization, parentId: input.parentId, showInBot: input.showInBot ? 1 : 0 })
  return getProductType(id)
}

// Matches the original UI behaviour: deleting a product type also removes any
// direct children pointing at it as their parent (one level, not recursive).
export function deleteProductType(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM product_types WHERE id = ? OR parent_id = ?").run(id, id)
  return result.changes > 0
}
