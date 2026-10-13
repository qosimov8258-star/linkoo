import "server-only"

import { getDb } from "@/lib/db"

export type StoreCategory = {
  id: number
  name: string
  createdDate: string
}

type Row = {
  id: number
  name: string
  created_at: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS store_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function toItem(row: Row): StoreCategory {
  return { id: row.id, name: row.name, createdDate: row.created_at }
}

export type StoreCategoryInput = {
  name: string
}

export async function listStoreCategories(): Promise<StoreCategory[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, name, created_at FROM store_categories ORDER BY id ASC").all()) as Row[]).map(toItem)
}

export async function getStoreCategory(id: number): Promise<StoreCategory | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, created_at FROM store_categories WHERE id = ?").get(id)) as Row | undefined
  return row ? toItem(row) : null
}

export async function createStoreCategory(input: StoreCategoryInput): Promise<StoreCategory> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("INSERT INTO store_categories (name) VALUES (@name)").run({ name: input.name })
  return (await getStoreCategory(Number(result.lastInsertRowid)))!
}

export async function updateStoreCategory(id: number, input: StoreCategoryInput): Promise<StoreCategory | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getStoreCategory(id))) return null
  await db.prepare("UPDATE store_categories SET name = @name, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name })
  return getStoreCategory(id)
}

export async function deleteStoreCategory(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM store_categories WHERE id = ?").run(id)).changes > 0
}
