// Marks which order lines are bonus goods, taken from the reference's GET sales/order/<id>/ responses
// (products[].is_bonus) — the local data only knows the price 0, which also covers plain free lines. Usage:
//   node scripts/backfill-order-item-bonus-from-reference.mjs <bonus-flags.json>
// <bonus-flags.json> is { "<orderId>": [{ pid, amount, price, is_bonus }] }. INSERT-only into order_item_bonus;
// every inserted row is registered in demo_seed_rows (domain 'orders-extra2').
import fs from "node:fs"
import pg from "pg"

const [file] = process.argv.slice(2)
if (!file) throw new Error("Usage: node scripts/backfill-order-item-bonus-from-reference.mjs <bonus-flags.json>")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const flags = JSON.parse(fs.readFileSync(file, "utf8"))
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")
await client.query(`
  CREATE TABLE IF NOT EXISTS order_item_bonus (order_item_id integer PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)

let marked = 0
let unmatched = 0
for (const [orderId, products] of Object.entries(flags)) {
  for (const product of products.filter((row) => row.is_bonus)) {
    const found = await client.query(
      `SELECT i.id FROM order_items i
       WHERE i.order_id = $1 AND i.product_id = $2 AND i.quantity = $3 AND i.unit_price = 0
         AND NOT EXISTS (SELECT 1 FROM order_item_bonus b WHERE b.order_item_id = i.id)
       ORDER BY i.id LIMIT 1`,
      [Number(orderId), product.pid, Number(product.amount)],
    )
    if (!found.rowCount) {
      unmatched += 1
      continue
    }
    await client.query("INSERT INTO order_item_bonus (order_item_id) VALUES ($1) ON CONFLICT DO NOTHING", [found.rows[0].id])
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('order_item_bonus', $1, 'orders-extra2')", [String(found.rows[0].id)])
    marked += 1
  }
}
await client.query("COMMIT")
await client.end()
console.log(JSON.stringify({ marked, unmatched }))
