import "server-only"

import { getDb } from "@/lib/db"

export type ClientModuleItemStatus = "active" | "attention" | "inactive"

export type ClientModuleItem = {
  id: number
  moduleKey: string
  name: string
  category: string
  detail: string
  value: string
  status: ClientModuleItemStatus
  statusLabel: string
  updatedAt: string
}

type Row = {
  id: number
  module_key: string
  name: string
  category_value: string
  description: string
  value: string
  status: string
  status_label: string
  updated_at: string
}

const VALID_STATUSES: ClientModuleItemStatus[] = ["active", "attention", "inactive"]

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_module_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_key TEXT NOT NULL,
      name TEXT NOT NULL,
      category_value TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      status_label TEXT NOT NULL DEFAULT 'Активно',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_client_module_items_module_key ON client_module_items (module_key);`)
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("ru-RU").format(new Date())
}

function rowToItem(row: Row): ClientModuleItem {
  const status = (VALID_STATUSES as string[]).includes(row.status) ? (row.status as ClientModuleItemStatus) : "active"
  return {
    id: row.id,
    moduleKey: row.module_key,
    name: row.name,
    category: row.category_value,
    detail: row.description,
    value: row.value,
    status,
    statusLabel: row.status_label,
    updatedAt: row.updated_at,
  }
}

export type ClientModuleItemInput = {
  moduleKey: string
  name: string
  category: string
  detail: string
  value: string
  status: ClientModuleItemStatus
  statusLabel: string
}

export function parseClientModuleItemInput(body: unknown): ClientModuleItemInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const moduleKey = typeof value.moduleKey === "string" ? value.moduleKey.trim() : ""
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!moduleKey || !name) return null
  const status = typeof value.status === "string" && (VALID_STATUSES as string[]).includes(value.status)
    ? (value.status as ClientModuleItemStatus)
    : "active"
  const category = typeof value.category === "string" ? value.category.trim() : ""
  const detail = typeof value.detail === "string" ? value.detail.trim() : ""
  const rawValue = typeof value.value === "string" ? value.value.trim() : ""
  const statusLabel = typeof value.statusLabel === "string" && value.statusLabel.trim() ? value.statusLabel.trim() : status
  return { moduleKey, name, category, detail, value: rawValue, status, statusLabel }
}

export async function listClientModuleItems(moduleKey: string): Promise<ClientModuleItem[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db.prepare("SELECT * FROM client_module_items WHERE module_key = ? ORDER BY id DESC").all(moduleKey)) as Row[]
  ).map(rowToItem)
}

export async function getClientModuleItem(id: number): Promise<ClientModuleItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM client_module_items WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToItem(row) : null
}

export async function createClientModuleItem(input: ClientModuleItemInput): Promise<ClientModuleItem> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO client_module_items (module_key, name, category_value, description, value, status, status_label, updated_at)
       VALUES (@moduleKey, @name, @category, @detail, @value, @status, @statusLabel, @updatedAt)`,
      )
      .run({ ...input, updatedAt: todayLabel() }))
  return (await getClientModuleItem(Number(result.lastInsertRowid)))!
}

export async function updateClientModuleItem(id: number, input: ClientModuleItemInput): Promise<ClientModuleItem | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getClientModuleItem(id))) return null
  await db.prepare(
        `UPDATE client_module_items SET
       name = @name,
       category_value = @category,
       description = @detail,
       value = @value,
       status = @status,
       status_label = @statusLabel,
       updated_at = @updatedAt
     WHERE id = @id`,
      ).run({ ...input, id, updatedAt: todayLabel() })
  return (await getClientModuleItem(id))
}

export async function deleteClientModuleItem(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_module_items WHERE id = ?").run(id)).changes > 0
}
