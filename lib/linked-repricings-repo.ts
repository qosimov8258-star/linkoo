import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"

// Journal of "Переоценку связанных" runs (demo POST main/reprice/connected/): which price list was
// chosen, who ran it and which repricing documents it created (lib/repricings-repo.ts
// createConnectedRepricings writes the documents, then records the run here).

export type LinkedRepricing = {
  id: number
  priceListId: number
  priceListName: string
  createdBy: string
  createdAt: string
  repricingIds: number[]
}

type Row = {
  id: number
  price_list_id: number
  price_list_name: string
  created_by: string
  created_at: string
  repricing_ids: string | null
}

declare global {
  var __linkoLinkedRepricingsSchema: Promise<void> | undefined
}

function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoLinkedRepricingsSchema) {
    globalThis.__linkoLinkedRepricingsSchema = outsideTransaction(async () => {
      const db = getDb()
      await db.exec(`
        CREATE TABLE IF NOT EXISTS linked_repricings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          price_list_id INTEGER NOT NULL,
          price_list_name TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      await db.exec(`ALTER TABLE linked_repricings ADD COLUMN IF NOT EXISTS repricing_ids TEXT NOT NULL DEFAULT '[]'`)
    }).catch((error) => {
      globalThis.__linkoLinkedRepricingsSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoLinkedRepricingsSchema
}

function rowToLinkedRepricing(row: Row): LinkedRepricing {
  let ids: number[] = []
  try {
    const parsed = JSON.parse(row.repricing_ids || "[]") as unknown
    ids = Array.isArray(parsed) ? parsed.map(Number).filter((id) => id > 0) : []
  } catch {
    ids = []
  }
  return {
    id: Number(row.id),
    priceListId: Number(row.price_list_id),
    priceListName: row.price_list_name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    repricingIds: ids,
  }
}

export async function listLinkedRepricings(): Promise<LinkedRepricing[]> {
  await ensureSchema()
  return ((await getDb().prepare("SELECT * FROM linked_repricings ORDER BY id DESC").all()) as Row[]).map(rowToLinkedRepricing)
}

export type LinkedRepricingInput = {
  priceListId: number
  priceListName: string
  repricingIds?: number[]
}

export async function recordLinkedRepricing(input: LinkedRepricingInput, createdBy: string): Promise<LinkedRepricing> {
  await ensureSchema()
  const db = getDb()
  const result = await db
    .prepare(
      `INSERT INTO linked_repricings (price_list_id, price_list_name, created_by, repricing_ids)
       VALUES (@priceListId, @priceListName, @createdBy, @repricingIds)`,
    )
    .run({ priceListId: input.priceListId, priceListName: input.priceListName, createdBy, repricingIds: JSON.stringify(input.repricingIds ?? []) })
  const row = (await db.prepare("SELECT * FROM linked_repricings WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToLinkedRepricing(row)
}
