import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

// Linko's «Закрыто» mark of a shop (market.is_closed): its drawer shows a red «Закрыто» chip in the header on every page.
// The app has no closing of its own, so the mark comes from the Linko copy only: linko_shop_closed holds the copied
// shops' flag (scripts/linko-sync/import-shop-closed.mjs); a shop without a row is open.

export const SHOP_CLOSED_DDL = [
  `CREATE TABLE IF NOT EXISTS linko_shop_closed (
    client_id INTEGER PRIMARY KEY,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    fetched_at TEXT NOT NULL DEFAULT ''
  )`,
]

declare global {
  var __linkoShopClosedSchemaV1: Promise<void> | undefined
}

export function ensureShopClosedSchema(): Promise<void> {
  globalThis.__linkoShopClosedSchemaV1 ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:shop_closed'))")
      for (const statement of SHOP_CLOSED_DDL) await tx.exec(statement)
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoShopClosedSchemaV1 = undefined
    throw error
  })
  return globalThis.__linkoShopClosedSchemaV1
}

/** Whether Linko marks the shop closed (false for a shop it does not mark, or one made here). */
export async function shopIsClosed(clientId: number): Promise<boolean> {
  await ensureShopClosedSchema()
  const row = (await getDb().prepare("SELECT is_closed FROM linko_shop_closed WHERE client_id = ?").get(clientId)) as { is_closed: boolean } | undefined
  return row?.is_closed === true
}
