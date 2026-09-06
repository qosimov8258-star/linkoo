import "server-only"

import { getDb } from "@/lib/db"

export type PriceListEntry = {
  id: number
  priceList: string
  product: string
  cash: number
  nonCash: number
}

type Row = {
  id: number
  price_list: string
  product: string
  cash: number
  non_cash: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS price_list_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_list TEXT NOT NULL,
      product TEXT NOT NULL,
      cash REAL NOT NULL DEFAULT 0,
      non_cash REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToEntry(row: Row): PriceListEntry {
  return { id: row.id, priceList: row.price_list, product: row.product, cash: row.cash, nonCash: row.non_cash }
}

export type PriceListEntryInput = {
  priceList: string
  product: string
  cash: number
  nonCash: number
}

export async function listPriceListEntries(): Promise<PriceListEntry[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT id, price_list, product, cash, non_cash FROM price_list_entries ORDER BY id DESC").all()) as Row[]).map(rowToEntry)
}

export async function createPriceListEntry(input: PriceListEntryInput): Promise<PriceListEntry> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO price_list_entries (price_list, product, cash, non_cash) VALUES (@priceList, @product, @cash, @nonCash)")
      .run(input))
  const row = (await db.prepare("SELECT id, price_list, product, cash, non_cash FROM price_list_entries WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToEntry(row)
}
