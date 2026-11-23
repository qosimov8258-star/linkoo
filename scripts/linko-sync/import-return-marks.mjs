// Продажи → Возвраты → card → «Список товаров» → green «+»: the marking codes of every client return line
// (Linko's sales/order_return_product/<returned product id>/get_marks/: [{id, type: consumer|group|transport,
// mark|code, created_date}]) into client_return_item_marks, the table the card reads (lib/client-return-marks-repo.ts).
//
// Raw file order_return_marks.json: {data: {<return id>: [{index, returned_product, product_id, amount, status,
// marks}]}}, one entry per line in Linko's line order (fetch.mjs step return-marks, or a capture of the cards with a
// read-only browser). The newest backups/linko-raw/<date> folder that has it is read (RAW=<folder> picks one).
// - A Linko line is the local line at the same place of the same return (import-returns.mjs writes them in Linko's
//   order); a return whose local lines no longer match Linko's (count, product, quantity) is skipped and reported.
// - Codes belong to that local line (item_id → client_return_items, ON DELETE CASCADE): a line removed later takes its
//   codes with it, as in Linko.
// - Rows keep Linko's mark id (linko_id): a re-run updates them in place. Codes added in the app are left alone.
// - Lines whose capture failed (status other than 200) are skipped and counted.
//
//   node scripts/linko-sync/import-return-marks.mjs
import fs from "node:fs"

import { capturedOrSkip, connect, ensureRegistry, register, runId } from "./lib.mjs"

const FILE = "order_return_marks.json"

// <RAW>/order_return_marks.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> that has it.
const file = capturedOrSkip(FILE)
if (!file || !fs.existsSync(file)) {
  console.log(`return marks: no raw ${FILE} (capture the cards' get_marks first)`)
  process.exit(0)
}
const captured = JSON.parse(fs.readFileSync(file, "utf8")).data ?? {}

const TYPES = new Set(["consumer", "group", "transport"])

// Same table as lib/client-return-marks-repo.ts (the app creates it too; a fresh database gets it from either).
const DDL = `
CREATE TABLE IF NOT EXISTS client_return_item_marks (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES client_return_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'consumer',
  code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  linko_id INTEGER
);
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES client_return_items(id) ON DELETE CASCADE;
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'consumer';
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_return_item_marks ADD COLUMN IF NOT EXISTS linko_id INTEGER;
CREATE INDEX IF NOT EXISTS client_return_item_marks_item_idx ON client_return_item_marks (item_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_return_item_marks_linko_idx ON client_return_item_marks (linko_id) WHERE linko_id IS NOT NULL;
`

/** Linko's scan moment as stored ("2026-11-19 10:30[:ss]" local wall time; an offset is kept as it is). */
const momentText = (value) => (typeof value === "string" ? value.trim().replace(/^(\d{4}-\d{2}-\d{2})T/, "$1 ") : "")

const run = runId("return-marks")
const client = await connect()
await ensureRegistry(client)
const stats = { returns: 0, lines: 0, linesWithMarks: 0, insert: 0, update: 0, same: 0, failedLines: 0, skipped: [] }
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(72120933)")
  await client.query(DDL)
  for (const [returnId, lines] of Object.entries(captured)) {
    if (!Array.isArray(lines)) continue
    stats.returns++
    stats.lines += lines.length
    const local = (await client.query("SELECT id, order_item_id, product_id, product_name, quantity FROM client_return_items WHERE return_id = $1 ORDER BY id", [Number(returnId)])).rows
    const withMarks = lines.filter((line) => Array.isArray(line.marks) && line.marks.length)
    stats.failedLines += lines.filter((line) => line.status !== 200).length
    if (!withMarks.length) continue
    const matches =
      local.length === lines.length && lines.every((line, i) => (local[i].product_id ?? null) === (line.product_id ?? null) && Math.abs(Number(local[i].quantity) - Number(line.amount)) < 1e-9)
    if (!matches) {
      stats.skipped.push(`${returnId} (lines differ)`)
      continue
    }
    for (const line of withMarks) {
      stats.linesWithMarks++
      const itemId = local[line.index].id
      for (const [position, mark] of line.marks.entries()) {
        const code = String(mark.mark ?? mark.code ?? "").trim()
        if (!code || !TYPES.has(mark.type) || !Number.isInteger(mark.id)) continue
        const values = { return_id: Number(returnId), item_id: itemId, type: mark.type, code, created_at: momentText(mark.created_date), position }
        const current = (await client.query("SELECT id, return_id, item_id, type, code, created_at, position FROM client_return_item_marks WHERE linko_id = $1", [mark.id])).rows[0]
        if (!current) {
          const inserted = await client.query(
            "INSERT INTO client_return_item_marks (return_id, item_id, type, code, created_at, position, linko_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [values.return_id, values.item_id, values.type, values.code, values.created_at, values.position, mark.id],
          )
          await register(client, run, "client_return_item_marks", inserted.rows[0].id, "insert")
          stats.insert++
          continue
        }
        const same = Object.entries(values).every(([column, value]) => String(current[column]) === String(value))
        if (same) {
          stats.same++
          continue
        }
        await client.query("UPDATE client_return_item_marks SET return_id = $2, item_id = $3, type = $4, code = $5, created_at = $6, position = $7 WHERE id = $1", [
          current.id,
          values.return_id,
          values.item_id,
          values.type,
          values.code,
          values.created_at,
          values.position,
        ])
        await register(client, run, "client_return_item_marks", current.id, "update", current)
        stats.update++
      }
    }
  }
  await client.query("COMMIT")
  console.log(
    `return marks: ${stats.returns} returns, ${stats.lines} lines captured (${stats.failedLines} failed), ${stats.linesWithMarks} lines with codes; ` +
      `inserted ${stats.insert}, updated ${stats.update}, unchanged ${stats.same}${stats.skipped.length ? `; skipped ${stats.skipped.join(", ")}` : ""}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
