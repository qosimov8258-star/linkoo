// Передачи между складами → «Логи»: Linko's history of every transfer (stock_transfers_logs, fetch step
// transfer-logs: created / given / accepted / cancelled, who and when) as rows of internal_transfer_logs, the table
// the app writes its own log to. A transfer with log rows the app wrote itself is left alone; one whose rows all came
// from an earlier run gets Linko's entries it does not have yet (same action and moment), so a new download adds the
// transfer's later steps. Linko's log has no lines: each row keeps the transfer's lines, as the app's log rows do.
//
//   node scripts/linko-sync/import-transfer-logs.mjs
import { connect, ensureRegistry, fullName, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("transfer-logs")
if (!hasRaw("stock_transfers_logs")) {
  console.log("transfer logs: no raw stock_transfers_logs (run fetch.mjs transfer-logs first)")
  process.exit(0)
}
const logs = raw("stock_transfers_logs")
// Linko's statuses → the app's (lib/internal-transfers-repo.ts statusOf).
const STATUS = { pending: "ожидает", approved: "потвержден", given: "в пути", accepted: "принят", cancelled: "отменен", canceled: "отменен" }
const ACTIONS = new Set(["created", "updated", "approved", "given", "cancel_given", "accepted", "cancel_accepted", "canceled"])
const stats = { transfers: 0, rows: 0, kept: 0, missing: [], unknown: new Set() }

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  for (const [id, entries] of Object.entries(logs)) {
    if (!Array.isArray(entries) || !entries.length) continue
    const transfer = (await client.query("SELECT id, items FROM internal_transfers WHERE id = $1", [Number(id)])).rows[0]
    if (!transfer) {
      stats.missing.push(id)
      continue
    }
    const existing = (
      await client.query(
        `SELECT l.action, left(l.created_at::text, 19) AS at,
                EXISTS (SELECT 1 FROM linko_sync_rows s WHERE s.table_name = 'internal_transfer_logs' AND s.row_id = l.id::text) AS imported
           FROM internal_transfer_logs l WHERE l.transfer_id = $1`,
        [Number(id)],
      )
    ).rows
    if (existing.some((row) => !row.imported)) {
      stats.kept++
      continue
    }
    const have = new Set(existing.map((row) => `${row.action}|${String(row.at).replace("T", " ")}`))
    // Oldest first, as the app appends them.
    for (const entry of [...entries].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)))) {
      const action = ACTIONS.has(entry.action) ? entry.action : entry.action === "cancelled" ? "canceled" : null
      if (!action) {
        stats.unknown.add(String(entry.action))
        continue
      }
      if (have.has(`${action}|${String(entry.created_date ?? "").slice(0, 19).replace("T", " ")}`)) continue
      const inserted = await client.query(
        `INSERT INTO internal_transfer_logs (transfer_id, action, status, from_warehouse, to_warehouse, comment, currency, items, user_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          Number(id),
          action,
          STATUS[entry.status] ?? String(entry.status ?? ""),
          String(entry.from_stock_name ?? ""),
          String(entry.to_stock_name ?? ""),
          String(entry.comment ?? ""),
          String(entry.currency?.name ?? "").toUpperCase() === "EURO" ? "EUR" : String(entry.currency?.name ?? ""),
          transfer.items || "[]",
          fullName(entry.created_by),
          String(entry.created_date ?? "").slice(0, 19),
        ],
      )
      await register(client, run, "internal_transfer_logs", inserted.rows[0].id, "insert")
      stats.rows++
    }
    stats.transfers++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `transfer logs: ${stats.rows} rows for ${stats.transfers} transfers; ${stats.kept} transfers kept their own log; not here: ${stats.missing.join(",") || "none"}; unknown actions: ${[...stats.unknown].join(",") || "none"}`,
)
