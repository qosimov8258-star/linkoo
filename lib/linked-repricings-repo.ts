import "server-only"

import { getDb } from "@/lib/db"

export type LinkedRepricing = {
  id: number
  priceListId: number
  priceListName: string
  createdBy: string
  createdAt: string
}

type Row = {
  id: number
  price_list_id: number
  price_list_name: string
  created_by: string
  created_at: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS linked_repricings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_list_id INTEGER NOT NULL,
      price_list_name TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToLinkedRepricing(row: Row): LinkedRepricing {
  return {
    id: row.id,
    priceListId: row.price_list_id,
    priceListName: row.price_list_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export type LinkedRepricingInput = {
  priceListId: number
  priceListName: string
}

export async function listLinkedRepricings(): Promise<LinkedRepricing[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM linked_repricings ORDER BY id DESC").all()) as Row[]).map(rowToLinkedRepricing)
}

export async function createLinkedRepricing(input: LinkedRepricingInput, createdBy: string): Promise<LinkedRepricing> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO linked_repricings (price_list_id, price_list_name, created_by)
       VALUES (@priceListId, @priceListName, @createdBy)`,
      )
      .run({ priceListId: input.priceListId, priceListName: input.priceListName, createdBy }))
  const row = (await db.prepare("SELECT * FROM linked_repricings WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToLinkedRepricing(row)
}
