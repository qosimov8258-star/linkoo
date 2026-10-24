import "server-only"

import { getDb } from "@/lib/db"
import { refDate } from "@/lib/ref-date"

export type ClientType = {
  id: number
  name: string
  supplier: string
  date: string
  parentId: number | null
  innRequired: boolean
}

type Row = { id: number; name: string; supplier: string; created_at: string; parent_id: number | null; inn_required: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE client_types ADD COLUMN IF NOT EXISTS parent_id INTEGER;
    ALTER TABLE client_types ADD COLUMN IF NOT EXISTS inn_required INTEGER NOT NULL DEFAULT 0;
  `)
}

function dateLabel(iso: string): string {
  const parsed = new Date(iso.replace(" ", "T") + "Z")
  if (Number.isNaN(parsed.getTime())) return iso
  return refDate(new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

function rowToClientType(row: Row): ClientType {
  return { id: row.id, name: row.name, supplier: row.supplier, date: dateLabel(row.created_at), parentId: row.parent_id ?? null, innRequired: !!row.inn_required }
}

export type ClientTypeInput = { name: string; supplier: string; parentId: number | null; innRequired: boolean }

export function parseClientTypeInput(body: unknown): ClientTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const supplier = typeof value.supplier === "string" && value.supplier.trim() ? value.supplier.trim() : "Не указано"
  const parentId = typeof value.parentId === "number" && Number.isInteger(value.parentId) ? value.parentId : null
  return { name, supplier, parentId, innRequired: value.innRequired === true }
}

export async function listClientTypes(): Promise<ClientType[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = ((await db.prepare("SELECT * FROM client_types").all()) as Row[]).map(rowToClientType)
  // Like the reference hierarchy: by name (case-insensitive), every child right after its parent.
  const byName = (a: ClientType, b: ClientType) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.id - b.id
  const ids = new Set(rows.map((row) => row.id))
  const roots = rows.filter((row) => row.parentId === null || !ids.has(row.parentId)).sort(byName)
  return roots.flatMap((root) => [root, ...rows.filter((row) => row.parentId === root.id).sort(byName)])
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
  const result = (await db.prepare("INSERT INTO client_types (name, supplier, parent_id, inn_required) VALUES (@name, @supplier, @parentId, @innRequired)").run({ ...input, innRequired: input.innRequired ? 1 : 0 }))
  return (await getClientType(Number(result.lastInsertRowid)))!
}

export async function updateClientType(id: number, input: ClientTypeInput): Promise<ClientType | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getClientType(id))) return null
  await db.prepare("UPDATE client_types SET name = @name, supplier = @supplier, parent_id = @parentId, inn_required = @innRequired, updated_at = datetime('now') WHERE id = @id").run({
        ...input,
        innRequired: input.innRequired ? 1 : 0,
        id,
      })
  return (await getClientType(id))
}

export async function deleteClientType(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_types WHERE id = ?").run(id)).changes > 0
}
