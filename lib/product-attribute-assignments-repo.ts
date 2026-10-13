import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_attribute_assignments (
      product_id INTEGER PRIMARY KEY,
      values_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export async function getProductAttributeAssignments(productId: number): Promise<Record<string, string>> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT values_json FROM product_attribute_assignments WHERE product_id = ?").get(productId)) as { values_json: string } | undefined
  if (!row) return {}
  try {
    const value = JSON.parse(row.values_json) as unknown
    if (!value || typeof value !== "object") return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  } catch {
    return {}
  }
}

export async function setProductAttributeAssignments(productId: number, values: Record<string, string>): Promise<Record<string, string>> {
  const db = getDb()
  await ensureSchema(db)
  await db
    .prepare(
      `INSERT INTO product_attribute_assignments (product_id, values_json) VALUES (@productId, @values)
       ON CONFLICT(product_id) DO UPDATE SET values_json = excluded.values_json, updated_at = datetime('now')`,
    )
    .run({ productId, values: JSON.stringify(values) })
  return values
}
