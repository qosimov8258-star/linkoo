import "server-only"

import { getDb } from "@/lib/db"

export type ClientAttributeValue = {
  id: number
  attribute: string
  values: string[]
}

type Row = { id: number; attribute: string; values: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_attribute_values (
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

function rowToAttributeValue(row: { id: number; attribute: string; values_json: string }): ClientAttributeValue {
  return { id: row.id, attribute: row.attribute, values: parseValues(row.values_json) }
}

export type ClientAttributeValueInput = { attribute: string; values: string[] }

export function parseClientAttributeValueInput(body: unknown): ClientAttributeValueInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const attribute = typeof value.attribute === "string" ? value.attribute.trim() : ""
  if (!attribute) return null
  const values = Array.isArray(value.values)
    ? value.values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : []
  return { attribute, values }
}

export async function listClientAttributeValues(): Promise<ClientAttributeValue[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db.prepare("SELECT id, attribute, values_json FROM client_attribute_values ORDER BY id ASC").all()) as {
      id: number
      attribute: string
      values_json: string
    }[]
  ).map(rowToAttributeValue)
}

export async function getClientAttributeValue(id: number): Promise<ClientAttributeValue | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db
      .prepare("SELECT id, attribute, values_json FROM client_attribute_values WHERE id = ?")
      .get(id)) as { id: number; attribute: string; values_json: string } | undefined
  return row ? rowToAttributeValue(row) : null
}

export async function createClientAttributeValue(input: ClientAttributeValueInput): Promise<ClientAttributeValue> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO client_attribute_values (attribute, values_json) VALUES (@attribute, @values)")
      .run({ attribute: input.attribute, values: JSON.stringify(input.values) }))
  return (await getClientAttributeValue(Number(result.lastInsertRowid)))!
}

export async function updateClientAttributeValue(id: number, input: ClientAttributeValueInput): Promise<ClientAttributeValue | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getClientAttributeValue(id))) return null
  await db.prepare(
        "UPDATE client_attribute_values SET attribute = @attribute, values_json = @values, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, attribute: input.attribute, values: JSON.stringify(input.values) })
  return (await getClientAttributeValue(id))
}

export async function deleteClientAttributeValue(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_attribute_values WHERE id = ?").run(id)).changes > 0
}
