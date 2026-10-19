import "server-only"

import { getDb } from "@/lib/db"
import { refDate } from "@/lib/ref-date"

export type ClientType = {
  id: number
  name: string
  supplier: string
  date: string
}

type Row = { id: number; name: string; supplier: string; created_at: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function dateLabel(iso: string): string {
  const parsed = new Date(iso.replace(" ", "T") + "Z")
  if (Number.isNaN(parsed.getTime())) return iso
  return refDate(new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

function rowToClientType(row: Row): ClientType {
  return { id: row.id, name: row.name, supplier: row.supplier, date: dateLabel(row.created_at) }
}

export type ClientTypeInput = { name: string; supplier: string }

export function parseClientTypeInput(body: unknown): ClientTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const supplier = typeof value.supplier === "string" && value.supplier.trim() ? value.supplier.trim() : "Не указано"
  return { name, supplier }
}

export async function listClientTypes(): Promise<ClientType[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM client_types ORDER BY id DESC").all()) as Row[]).map(rowToClientType)
}

export async function getClientType(id: number): Promise<ClientType | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM client_types WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToClientType(row) : null
}

export async function createClientType(input: ClientTypeInput): Promise<ClientType> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("INSERT INTO client_types (name, supplier) VALUES (@name, @supplier)").run(input))
  return (await getClientType(Number(result.lastInsertRowid)))!
}

export async function updateClientType(id: number, input: ClientTypeInput): Promise<ClientType | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getClientType(id))) return null
  await db.prepare("UPDATE client_types SET name = @name, supplier = @supplier, updated_at = datetime('now') WHERE id = @id").run({
        ...input,
        id,
      })
  return (await getClientType(id))
}

export async function deleteClientType(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_types WHERE id = ?").run(id)).changes > 0
}
