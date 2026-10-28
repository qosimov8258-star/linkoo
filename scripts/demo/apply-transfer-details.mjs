// Fills the empty price list / currency / accepted + given moments / accepter of internal_transfers from the
// reference's stock_transfer details (scripts/demo/data/ref-transfer-details.json). Only empty cells are written;
// the touched rows are backed up in demo_seed_backup_transfer_details (rollback-transfer-details.mjs restores them).
import fs from "node:fs"
import pg from "pg"

const details = JSON.parse(fs.readFileSync(new URL("./data/ref-transfer-details.json", import.meta.url), "utf8"))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
await c.query("CREATE TABLE IF NOT EXISTS demo_seed_backup_transfer_details AS SELECT id, price_list, currency, accepted_at, accepted_by, given_at FROM internal_transfers WHERE false")
const moment = (value) => (value ? String(value).replace("T", " ").slice(0, 19) : "")
let changed = 0
for (const { rows } of [await c.query("SELECT id, price_list, currency, accepted_at, accepted_by, given_at FROM internal_transfers ORDER BY id")]) {
  for (const row of rows) {
    const ref = details[row.id]
    if (!ref) continue
    const next = {
      price_list: row.price_list || ref.price_list?.name || "",
      currency: row.currency || ref.currency?.name || "",
      accepted_at: row.accepted_at || moment(ref.accepted_time),
      accepted_by: row.accepted_by || (ref.accepted_by ? `${ref.accepted_by.first_name} ${ref.accepted_by.second_name}`.trim() : ""),
      given_at: row.given_at || moment(ref.given_time),
    }
    if (Object.keys(next).every((key) => next[key] === (row[key] ?? ""))) continue
    await c.query("INSERT INTO demo_seed_backup_transfer_details SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS (SELECT 1 FROM demo_seed_backup_transfer_details WHERE id = $1)", [row.id, row.price_list, row.currency, row.accepted_at, row.accepted_by, row.given_at])
    await c.query("UPDATE internal_transfers SET price_list = $2, currency = $3, accepted_at = $4, accepted_by = $5, given_at = $6 WHERE id = $1", [row.id, next.price_list, next.currency, next.accepted_at, next.accepted_by, next.given_at])
    changed += 1
  }
}
console.log("transfers filled:", changed)
await c.end()
