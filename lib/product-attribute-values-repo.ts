import "server-only"

import { getDb } from "@/lib/db"

export type ProductAttributeValue = {
  id: number
  attribute: string
  values: string[]
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_attribute_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseValues(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToAttributeValue(row: { id: number; attribute: string; values_json: string }): ProductAttributeValue {
  return { id: row.id, attribute: row.attribute, values: parseValues(row.values_json) }
}

export type ProductAttributeValueInput = { attribute: string; values: string[] }

export function parseProductAttributeValueInput(body: unknown): ProductAttributeValueInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const attribute = typeof value.attribute === "string" ? value.attribute.trim() : ""
  if (!attribute) return null
  const values = Array.isArray(value.values)
    ? value.values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : []
  return { attribute, values }
}

export async function listProductAttributeValues(): Promise<ProductAttributeValue[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db.prepare("SELECT id, attribute, values_json FROM product_attribute_values ORDER BY id ASC").all()) as {
      id: number
      attribute: string
      values_json: string
    }[]
  ).map(rowToAttributeValue)
}

export async function getProductAttributeValue(id: number): Promise<ProductAttributeValue | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db
      .prepare("SELECT id, attribute, values_json FROM product_attribute_values WHERE id = ?")
      .get(id)) as { id: number; attribute: string; values_json: string } | undefined
  return row ? rowToAttributeValue(row) : null
}

export async function createProductAttributeValue(input: ProductAttributeValueInput): Promise<ProductAttributeValue> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO product_attribute_values (attribute, values_json) VALUES (@attribute, @values)")
      .run({ attribute: input.attribute, values: JSON.stringify(input.values) }))
  return (await getProductAttributeValue(Number(result.lastInsertRowid)))!
}

export async function updateProductAttributeValue(id: number, input: ProductAttributeValueInput): Promise<ProductAttributeValue | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getProductAttributeValue(id))) return null
  await db.prepare(
        "UPDATE product_attribute_values SET attribute = @attribute, values_json = @values, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, attribute: input.attribute, values: JSON.stringify(input.values) })
  return (await getProductAttributeValue(id))
}

export async function deleteProductAttributeValue(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM product_attribute_values WHERE id = ?").run(id)).changes > 0
}
