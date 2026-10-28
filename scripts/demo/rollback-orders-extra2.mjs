// Removes the rows scripts/backfill-order-returns-payments-from-reference.mjs registered in demo_seed_rows (domain 'orders-extra2').
import fs from "node:fs"
import pg from "pg"

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")
const listed = await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'orders-extra2'")
for (const { table_name: table, row_id: id } of listed.rows) {
  // order_payment_links was an orphan table that has been dropped (backup: demo_seed_backup_order_payment_links)
  if (table === "order_payment_links") continue
  if (table !== "order_return_docs" && table !== "order_payment_rows" && table !== "order_payment_links" && table !== "order_item_bonus") continue
  await client.query(`DELETE FROM ${table} WHERE ${table === "order_item_bonus" ? "order_item_id" : "id"} = $1`, [Number(id)])
}
await client.query("DELETE FROM demo_seed_rows WHERE domain = 'orders-extra2'")
await client.query("COMMIT")
await client.end()
console.log(`removed ${listed.rowCount} rows`)
