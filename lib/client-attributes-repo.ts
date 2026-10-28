import "server-only"

import { getDb } from "@/lib/db"

export type ClientAttribute = {
  id: number
  name: string
  fieldType: string
  required: boolean
  cacheNumber: number | null
}

type Row = {
  id: number
  name: string
  field_type: string
  required: number
  market_cache_number: number | null
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'Выбор вариантов',
      required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE client_attributes ADD COLUMN IF NOT EXISTS market_cache_number INTEGER;
  `)
}

function rowToAttribute(row: Row): ClientAttribute {
  return {
    id: row.id,
    name: row.name,
    fieldType: row.field_type,
    required: !!row.required,
    cacheNumber: row.market_cache_number ?? null,
  }
}

export type ClientAttributeInput = {
  name: string
  fieldType: string
  required: boolean
  cacheNumber: number | null
}

export const CLIENT_ATTRIBUTE_FIELD_TYPES = ["Цифровое поле", "Дата выборки", "Текстовое поле", "Выбор вариантов"]
const FIELD_TYPES = CLIENT_ATTRIBUTE_FIELD_TYPES

export function parseClientAttributeInput(body: unknown): ClientAttributeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const fieldType = typeof value.fieldType === "string" && FIELD_TYPES.includes(value.fieldType) ? value.fieldType : FIELD_TYPES[0]
  const required = value.required === true
  const cacheNumber = typeof value.cacheNumber === "number" && Number.isInteger(value.cacheNumber) ? value.cacheNumber : null
  return { name, fieldType, required, cacheNumber }
}

export async function listClientAttributes(): Promise<ClientAttribute[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, name, field_type, required, market_cache_number FROM client_attributes ORDER BY id ASC").all()) as Row[]).map(rowToAttribute)
}

export async function getClientAttribute(id: number): Promise<ClientAttribute | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, field_type, required, market_cache_number FROM client_attributes WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToAttribute(row) : null
}

export async function createClientAttribute(input: ClientAttributeInput): Promise<ClientAttribute> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO client_attributes (name, field_type, required, market_cache_number) VALUES (@name, @fieldType, @required, @cacheNumber)")
      .run({ name: input.name, fieldType: input.fieldType, required: input.required ? 1 : 0, cacheNumber: input.cacheNumber }))
  return (await getClientAttribute(Number(result.lastInsertRowid)))!
}

export async function updateClientAttribute(id: number, input: ClientAttributeInput): Promise<ClientAttribute | null> {
  const db = getDb()
  await ensureSchema(db)
  const previous = await getClientAttribute(id)
  if (!previous) return null
  if (previous.name !== input.name) await db.prepare("UPDATE client_attribute_values SET attribute = ? WHERE attribute = ?").run(input.name, previous.name).catch(() => undefined)
  await db.prepare("UPDATE client_attributes SET name = @name, field_type = @fieldType, required = @required, market_cache_number = @cacheNumber, updated_at = datetime('now') WHERE id = @id").run({
        id,
        name: input.name,
        fieldType: input.fieldType,
        required: input.required ? 1 : 0,
        cacheNumber: input.cacheNumber,
      })
  return (await getClientAttribute(id))
}

export async function deleteClientAttribute(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const attribute = await getClientAttribute(id)
  if (!attribute) return false
  await db.prepare("DELETE FROM client_attribute_values WHERE attribute = ?").run(attribute.name).catch(() => undefined)
  return (await db.prepare("DELETE FROM client_attributes WHERE id = ?").run(id)).changes > 0
}
