import "server-only"

import { getDb } from "@/lib/db"

// "Отправить продукты" of the product list posts the selected ids to the reference's
// `product_sync_linko/` (a sync of the catalog with the Linko marketplace). Locally every send is
// recorded here, one row per product and send, so the list of what was sent and when survives.

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_linko_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      sent_by TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

/** Records the send of the given (not deleted) products; returns how many were recorded. */
export async function sendProductsToLinko(ids: number[], sentBy: string): Promise<number> {
  const db = getDb()
  await ensureSchema(db)
  let count = 0
  for (const id of [...new Set(ids)]) {
    const row = (await db.prepare("SELECT name FROM products WHERE id = ? AND deleted = 0").get(id)) as { name: string } | undefined
    if (!row) continue
    await db.prepare("INSERT INTO product_linko_sync (product_id, product_name, sent_by) VALUES (?, ?, ?)").run(id, row.name, sentBy)
    count += 1
  }
  return count
}
