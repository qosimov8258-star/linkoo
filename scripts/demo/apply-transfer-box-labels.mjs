// Adds the box label of each reference transfer line ("100 block") to transfer_reference_items.box_label from
// scripts/demo/data/ref-transfer-details.json. Display data only; only empty labels are written (rollback: clear column).
import fs from "node:fs"
import pg from "pg"

const details = JSON.parse(fs.readFileSync(new URL("./data/ref-transfer-details.json", import.meta.url), "utf8"))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
await c.query("ALTER TABLE transfer_reference_items ADD COLUMN IF NOT EXISTS box_label TEXT NOT NULL DEFAULT ''")
let changed = 0
for (const [id, transfer] of Object.entries(details)) {
  for (const line of transfer.products ?? []) {
    const box = line.product?.boxes?.[0]
    const total = Number(line.box_total_amount) || 0
    if (!box || total <= 0) continue
    const r = await c.query("UPDATE transfer_reference_items SET box_label = $3 WHERE transfer_id = $1 AND product = $2 AND box_label = ''", [Number(id), line.product.name, `${total} ${box.measurement.name}`])
    changed += r.rowCount
  }
}
console.log("box labels set:", changed)
await c.end()
