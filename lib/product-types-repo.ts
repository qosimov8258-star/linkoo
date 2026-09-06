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

export async function listProductTypes(): Promise<ProductType[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM product_types ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToProductType)
}

export async function getProductType(id: number): Promise<ProductType | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM product_types WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToProductType(row) : null
}

export async function createProductType(input: ProductTypeInput): Promise<ProductType> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO product_types (name, organization, parent_id, show_in_bot) VALUES (@name, @organization, @parentId, @showInBot)")
      .run({ name: input.name, organization: input.organization, parentId: input.parentId, showInBot: input.showInBot ? 1 : 0 }))
  return (await getProductType(Number(result.lastInsertRowid)))!
}

export async function updateProductType(id: number, input: ProductTypeInput): Promise<ProductType | null> {
  if (!(await getProductType(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE product_types SET name = @name, organization = @organization, parent_id = @parentId,
       show_in_bot = @showInBot, updated_at = datetime('now') WHERE id = @id`,
      ).run({ id, name: input.name, organization: input.organization, parentId: input.parentId, showInBot: input.showInBot ? 1 : 0 })
  return (await getProductType(id))
}

// Matches the original UI behaviour: deleting a product type also removes any
// direct children pointing at it as their parent (one level, not recursive).
export async function deleteProductType(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM product_types WHERE id = ? OR parent_id = ?").run(id, id))
  return result.changes > 0
}
