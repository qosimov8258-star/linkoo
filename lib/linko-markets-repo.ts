import "server-only"

import { getDb } from "@/lib/db"

export type LinkoMarket = { id: number; name: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS linko_markets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

/** The "Linko магазин" options of the client form (the reference list is empty for this account). */
export async function listLinkoMarkets(search = "", limit = 50): Promise<LinkoMarket[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
    .prepare("SELECT id, name FROM linko_markets WHERE LOWER(name) LIKE ? ORDER BY name LIMIT ?")
    .all(`%${search.toLowerCase()}%`, limit)) as LinkoMarket[]
  return rows
}
