import "server-only"

import { getDb } from "@/lib/db"

export type RivalProduct = {
  id: number
  name: string
  competitor: string
  createdDate: string
}

type Row = {
  id: number
  name: string
  competitor: string
  created_at: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rival_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      competitor TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function toItem(row: Row): RivalProduct {
  return { id: row.id, name: row.name, competitor: row.competitor, createdDate: row.created_at }
}

export type RivalProductInput = {
  name: string
  competitor: string
}

export async function listRivalProducts(): Promise<RivalProduct[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, name, competitor, created_at FROM rival_products ORDER BY id ASC").all()) as Row[]).map(toItem)
}

export async function getRivalProduct(id: number): Promise<RivalProduct | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, competitor, created_at FROM rival_products WHERE id = ?").get(id)) as Row | undefined
  return row ? toItem(row) : null
}

export async function createRivalProduct(input: RivalProductInput): Promise<RivalProduct> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("INSERT INTO rival_products (name, competitor) VALUES (@name, @competitor)").run({ name: input.name, competitor: input.competitor })
  return (await getRivalProduct(Number(result.lastInsertRowid)))!
}

export async function updateRivalProduct(id: number, input: RivalProductInput): Promise<RivalProduct | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getRivalProduct(id))) return null
  await db.prepare("UPDATE rival_products SET name = @name, competitor = @competitor, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name, competitor: input.competitor })
  return getRivalProduct(id)
}

export async function deleteRivalProduct(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM rival_products WHERE id = ?").run(id)).changes > 0
}
