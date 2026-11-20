import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"

// «Логи» of a client return (Продажи → Возвраты → card → Логи), like Linko's sales/order_return_logs: one row per
// action on the return with its status, amount, currency and comment right after it, who did it and when.
//
// client_return_logs(id, return_id → client_returns ON DELETE CASCADE, action, status, total_price, currency,
// comment, created_by, created_at, linko_id, linko_position):
// - action: created | updated | accepted_to_stock | cancel_accept | canceled | deleted (Linko's names; the app never
//   deletes a return, so "deleted" only comes from Linko);
// - status: pending | in_progress | accepted | cancelled (Linko's 0 | 1 | 2 | 3);
// - created_at: the moment of the action, ISO UTC with "Z" (as client_returns.accepted_at);
// - linko_id / linko_position: rows copied from Linko (scripts/linko-sync/import-return-logs.mjs) keep Linko's id and
//   their place in Linko's answer, which is not ordered by date (the card shows that order); the app's own rows have
//   neither and follow them, oldest first.
// The app writes a row on every create / edit / accept / undo / cancel of a return (lib/client-returns-repo.ts), in
// the same transaction as the change.

export type ClientReturnLogAction = "created" | "updated" | "accepted_to_stock" | "cancel_accept" | "canceled" | "deleted"

export type ClientReturnLog = {
  id: number
  action: string
  status: string
  totalPrice: number
  currency: string
  comment: string
  createdBy: string
  createdAt: string
}

const COLUMNS: Array<[string, string]> = [
  ["return_id", "INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE"],
  ["action", "TEXT NOT NULL DEFAULT ''"],
  ["status", "TEXT NOT NULL DEFAULT ''"],
  ["total_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["currency", "TEXT NOT NULL DEFAULT ''"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
  ["created_at", "TEXT NOT NULL DEFAULT ''"],
  ["linko_id", "INTEGER"],
  ["linko_position", "INTEGER"],
]

const DDL = `
CREATE TABLE IF NOT EXISTS client_return_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${COLUMNS.filter(([name]) => name !== "return_id")
  .map(([name, type]) => `ALTER TABLE client_return_logs ADD COLUMN IF NOT EXISTS ${name} ${type};`)
  .join("\n")}
CREATE INDEX IF NOT EXISTS client_return_logs_return_idx ON client_return_logs (return_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_return_logs_linko_idx ON client_return_logs (linko_id) WHERE linko_id IS NOT NULL;
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoClientReturnLogsSchema: { version: number; ready: Promise<void> } | undefined
}

/** Creates client_return_logs (once per process; client_returns must exist: ensureClientReturnsSchema runs it after its own DDL). */
export function ensureClientReturnLogsSchema(): Promise<void> {
  if (globalThis.__linkoClientReturnLogsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        // The client returns' own schema lock: no other DDL of these tables runs meanwhile.
        await tx.exec("SELECT pg_advisory_xact_lock(72120933)")
        await tx.exec(DDL)
      }),
    ).catch((error) => {
      globalThis.__linkoClientReturnLogsSchema = undefined
      throw error
    })
    globalThis.__linkoClientReturnLogsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientReturnLogsSchema!.ready
}

/** Appends a log row of `returnId` with its state as it is now in `db` (call it inside the transaction, after the
 * change): status, amount and currency of the return; `createdBy` = who did it. The log's comment is not the return's
 * comment (Linko's entries have none even for returns with one), so the app's rows carry none. */
export async function logClientReturn(db: PgDb, returnId: number, action: ClientReturnLogAction, createdBy: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO client_return_logs (return_id, action, status, total_price, currency, created_by, created_at)
       SELECT r.id, @action, r.status, COALESCE(r.amount, 0), COALESCE(r.currency, ''), @createdBy, @at
         FROM client_returns r WHERE r.id = @returnId`,
    )
    .run({ returnId, action, createdBy: createdBy ?? "", at: new Date().toISOString() })
}

type LogRow = {
  id: number
  action: string
  status: string
  total_price: number | string | null
  currency: string
  comment: string | null
  created_by: string
  created_at: string
}

/** The log of a return in Linko's order (see the header). */
export async function listClientReturnLogs(returnId: number, db: PgDb = getDb()): Promise<ClientReturnLog[]> {
  await ensureClientReturnLogsSchema()
  const rows = (await db
    .prepare(
      `SELECT id, action, status, total_price, currency, comment, created_by, created_at FROM client_return_logs
        WHERE return_id = ? ORDER BY (linko_position IS NULL), linko_position, id`,
    )
    .all(returnId)) as LogRow[]
  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    status: row.status,
    totalPrice: Number(row.total_price) || 0,
    currency: row.currency ?? "",
    comment: row.comment ?? "",
    createdBy: row.created_by ?? "",
    createdAt: row.created_at ?? "",
  }))
}
