import "server-only"

import { getDb } from "@/lib/db"

export type RestrictionConfig = {
  type?: string
  by?: string
  minQty?: boolean
  clients?: string[]
  items?: { name: string; qty: number }[]
}

export type ClientRestriction = { id: number; name: string; config: RestrictionConfig }

type Row = { id: number; name: string; config?: string | null }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  await db.exec(`ALTER TABLE client_restrictions ADD COLUMN IF NOT EXISTS config TEXT NOT NULL DEFAULT '{}';`)
}

function rowToRestriction(row: Row): ClientRestriction {
  let config: RestrictionConfig = {}
  try {
    config = row.config ? (JSON.parse(row.config) as RestrictionConfig) : {}
  } catch {}
  return { id: row.id, name: row.name, config }
}

export type ClientRestrictionInput = { name: string; config?: RestrictionConfig }

export function parseClientRestrictionInput(body: unknown): ClientRestrictionInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const config = value.config && typeof value.config === "object" ? (value.config as RestrictionConfig) : undefined
  return { name, config }
}

export async function listClientRestrictions(): Promise<ClientRestriction[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, name, config FROM client_restrictions ORDER BY id ASC").all()) as Row[]).map(rowToRestriction)
}

export async function getClientRestriction(id: number): Promise<ClientRestriction | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, config FROM client_restrictions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRestriction(row) : null
}

export async function createClientRestriction(input: ClientRestrictionInput): Promise<ClientRestriction> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("INSERT INTO client_restrictions (name, config) VALUES (@name, @config)").run({ name: input.name, config: JSON.stringify(input.config ?? {}) }))
  return (await getClientRestriction(Number(result.lastInsertRowid)))!
}

export async function updateClientRestriction(id: number, input: ClientRestrictionInput): Promise<ClientRestriction | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getClientRestriction(id))) return null
  await db.prepare("UPDATE client_restrictions SET name = @name, config = @config, updated_at = datetime('now') WHERE id = @id").run({
        name: input.name,
        config: JSON.stringify(input.config ?? {}),
        id,
      })
  return (await getClientRestriction(id))
}

export async function deleteClientRestriction(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_restrictions WHERE id = ?").run(id)).changes > 0
}
