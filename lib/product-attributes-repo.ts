import "server-only"

import { getDb } from "@/lib/db"

export type ProductAttribute = {
  id: number
  name: string
  fieldType: string
  allTypes: boolean
  types: string[]
}

type Row = { id: number; name: string; field_type: string; all_types: number; types_json: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'Выбор вариантов',
      all_types INTEGER NOT NULL DEFAULT 1,
      types_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseTypes(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToAttribute(row: Row): ProductAttribute {
  return { id: row.id, name: row.name, fieldType: row.field_type, allTypes: row.all_types === 1, types: parseTypes(row.types_json) }
}

export type ProductAttributeInput = { name: string; fieldType: string; allTypes: boolean; types: string[] }

export const PRODUCT_ATTRIBUTE_FIELD_TYPES = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]

export async function listProductAttributes(): Promise<ProductAttribute[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, name, field_type, all_types, types_json FROM product_attributes ORDER BY id ASC").all()) as Row[]).map(rowToAttribute)
}

export async function getProductAttribute(id: number): Promise<ProductAttribute | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, field_type, all_types, types_json FROM product_attributes WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToAttribute(row) : null
}

export async function createProductAttribute(input: ProductAttributeInput): Promise<ProductAttribute> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("INSERT INTO product_attributes (name, field_type, all_types, types_json) VALUES (@name, @fieldType, @allTypes, @types)")
    .run({ name: input.name, fieldType: input.fieldType, allTypes: input.allTypes ? 1 : 0, types: JSON.stringify(input.types) })
  return (await getProductAttribute(Number(result.lastInsertRowid)))!
}

export async function updateProductAttribute(id: number, input: ProductAttributeInput): Promise<ProductAttribute | null> {
  const db = getDb()
  await ensureSchema(db)
  const previous = await getProductAttribute(id)
  if (!previous) return null
  if (previous.name !== input.name) await db.prepare("UPDATE product_attribute_values SET attribute = ? WHERE attribute = ?").run(input.name, previous.name).catch(() => undefined)
  await db
    .prepare("UPDATE product_attributes SET name = @name, field_type = @fieldType, all_types = @allTypes, types_json = @types, updated_at = datetime('now') WHERE id = @id")
    .run({ id, name: input.name, fieldType: input.fieldType, allTypes: input.allTypes ? 1 : 0, types: JSON.stringify(input.types) })
  return getProductAttribute(id)
}

export async function deleteProductAttribute(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const attribute = await getProductAttribute(id)
  if (!attribute) return false
  await db.prepare("DELETE FROM product_attribute_values WHERE attribute = ?").run(attribute.name).catch(() => undefined)
  return (await db.prepare("DELETE FROM product_attributes WHERE id = ?").run(id)).changes > 0
}
