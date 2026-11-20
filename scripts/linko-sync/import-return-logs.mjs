// Продажи → Возвраты → card → «Логи»: Linko's history of every client return (sales/order_return_logs/?order_return=<id>,
// raw file order_return_logs: {returnId: [entries]}; each entry is created / updated / accepted_to_stock /
// cancel_accept / canceled / deleted with the status, amount, currency and comment after it, who and when) into
// client_return_logs, the table the app appends its own entries to (lib/client-return-logs-repo.ts).
// - Rows keep Linko's id (linko_id: a re-run updates them in place) and their position in Linko's answer
//   (linko_position), which is the order the card shows: Linko does not sort the list by date.
// - A return the app itself accepted, undid or cancelled after it was last imported (scripts/linko-sync/
//   import-returns.mjs) gets that step from the return's own stored moment and author, the entry the app writes
//   now on every such action; it is added once, and never when the app already logged a step of that action since the
//   import (its own row is stamped when it was done, not at the accepted day the card's «Дата» may have picked).
//
//   node scripts/linko-sync/import-return-logs.mjs
//
// The raw file comes from fetch.mjs step return-logs, or from a capture of the cards' «Логи» tabs; it is read from the
// newest backups/linko-raw/<date> folder that has it (RAW=<folder> picks one).
import fs from "node:fs"
import path from "node:path"

import { ROOT, connect, currencyCode, ensureRegistry, fullName, register, runId, utcIso } from "./lib.mjs"

const FILE = "order_return_logs.json"

function rawFile() {
  if (process.env.RAW) return path.join(process.env.RAW, FILE)
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse() : []
  const day = days.find((name) => fs.existsSync(path.join(base, name, FILE)))
  return day ? path.join(base, day, FILE) : null
}

const file = rawFile()
if (!file || !fs.existsSync(file)) {
  console.log(`return logs: no raw ${FILE} (run fetch.mjs return-logs first)`)
  process.exit(0)
}
const logs = JSON.parse(fs.readFileSync(file, "utf8")).data ?? {}

// Linko's statuses of a return (0 pending, 1 in progress, 2 completed, 3 cancelled) → the log table's words.
const STATUS = { 0: "pending", 1: "in_progress", 2: "accepted", 3: "cancelled" }
const ACTIONS = new Set(["created", "updated", "accepted_to_stock", "cancel_accept", "canceled", "deleted"])

// Same table as lib/client-return-logs-repo.ts (the app creates it too; a fresh database gets it from either).
const DDL = `
CREATE TABLE IF NOT EXISTS client_return_logs (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE,
  action TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  linko_id INTEGER,
  linko_position INTEGER
);
ALTER TABLE client_return_logs ADD COLUMN IF NOT EXISTS linko_id INTEGER;
ALTER TABLE client_return_logs ADD COLUMN IF NOT EXISTS linko_position INTEGER;
CREATE INDEX IF NOT EXISTS client_return_logs_return_idx ON client_return_logs (return_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_return_logs_linko_idx ON client_return_logs (linko_id) WHERE linko_id IS NOT NULL;
`

const run = runId("return-logs")
const stats = { returns: 0, insert: 0, update: 0, same: 0, app: 0, missing: [], unknown: new Set() }
const COLUMNS = ["return_id", "action", "status", "total_price", "currency", "comment", "created_by", "created_at", "linko_position"]

function same(a, b) {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9
  return String(a) === String(b)
}

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query(DDL)
  for (const [id, entries] of Object.entries(logs)) {
    if (!Array.isArray(entries)) continue
    const returnId = Number(id)
    const ret = (
      await client.query("SELECT id, status, amount, currency, accepted_at, accepted_by, unaccepted_at, unaccepted_by, cancelled_at, cancelled_by FROM client_returns WHERE id = $1", [returnId])
    ).rows[0]
    if (!ret) {
      stats.missing.push(id)
      continue
    }
    stats.returns++
    for (const [position, entry] of entries.entries()) {
      if (!ACTIONS.has(entry.action)) stats.unknown.add(String(entry.action))
      const values = {
        return_id: returnId,
        action: String(entry.action ?? ""),
        status: STATUS[String(entry.status)] ?? String(entry.status ?? ""),
        total_price: Number(entry.total_price) || 0,
        currency: currencyCode(entry.currency),
        comment: String(entry.comment ?? "").trim(),
        created_by: fullName(entry.created_by),
        created_at: utcIso(entry.created_date) ?? "",
        linko_position: position,
      }
      const current = (await client.query(`SELECT id, ${COLUMNS.join(", ")} FROM client_return_logs WHERE linko_id = $1`, [entry.id])).rows[0]
      if (!current) {
        const inserted = await client.query(
          `INSERT INTO client_return_logs (${COLUMNS.join(", ")}, linko_id) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")}, $${COLUMNS.length + 1}) RETURNING id`,
          [...COLUMNS.map((column) => values[column]), entry.id],
        )
        await register(client, run, "client_return_logs", inserted.rows[0].id, "insert")
        stats.insert++
        continue
      }
      const changed = COLUMNS.filter((column) => !same(current[column], values[column]))
      if (!changed.length) {
        stats.same++
        continue
      }
      await client.query(`UPDATE client_return_logs SET ${changed.map((column, i) => `${column} = $${i + 2}`).join(", ")} WHERE id = $1`, [current.id, ...changed.map((column) => values[column])])
      await register(client, run, "client_return_logs", current.id, "update", Object.fromEntries(changed.map((column) => [column, current[column]])))
      stats.update++
    }

    // Steps the app made on this return after its last import: the entry it writes for them today.
    const imported = (
      await client.query("SELECT MAX(created_at) AS at FROM linko_sync_rows WHERE table_name = 'client_returns' AND row_id = $1 AND run LIKE 'returns:%'", [String(returnId)])
    ).rows[0]?.at
    if (!imported) continue
    const steps = [
      [ret.accepted_at, "accepted_to_stock", "accepted", ret.accepted_by],
      [ret.unaccepted_at, "cancel_accept", "pending", ret.unaccepted_by],
      [ret.cancelled_at, "canceled", "cancelled", ret.cancelled_by],
    ]
    for (const [moment, action, status, by] of steps) {
      const at = moment ? new Date(/[zZ]$/.test(moment) ? moment : `${String(moment).replace(" ", "T")}Z`) : null
      if (!at || Number.isNaN(at.getTime()) || at <= new Date(imported)) continue
      const iso = at.toISOString()
      const known = (await client.query("SELECT created_at, linko_id FROM client_return_logs WHERE return_id = $1 AND action = $2", [returnId, action])).rows
      // The app logs every step itself, stamped when it was done, while accepted_at may be another day picked in the
      // card's «Дата»: an app row of this action since the import (or one added here before) means the step is there.
      if (known.some((row) => row.linko_id == null && new Date(row.created_at) > new Date(imported))) continue
      if (known.some((row) => Math.abs(new Date(row.created_at).getTime() - at.getTime()) < 2000)) continue
      const inserted = await client.query(
        `INSERT INTO client_return_logs (return_id, action, status, total_price, currency, comment, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [returnId, action, status, Number(ret.amount) || 0, ret.currency ?? "", "", by ?? "", iso],
      )
      await register(client, run, "client_return_logs", inserted.rows[0].id, "insert")
      stats.app++
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `return logs (${path.relative(ROOT, file)}): ${stats.returns} returns; rows ${stats.insert} new, ${stats.update} updated, ${stats.same} unchanged; ` +
    `${stats.app} steps made in the app added; returns not here: ${stats.missing.join(",") || "none"}; unknown actions: ${[...stats.unknown].join(",") || "none"}`,
)
