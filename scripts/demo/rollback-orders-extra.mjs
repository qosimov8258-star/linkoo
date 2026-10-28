// Removes exactly the rows inserted by scripts/demo/seed-orders-extra.mjs (listed in demo_seed_rows for domain 'orders-extra').
// The product_volumes table itself is left in place.
// Usage: node scripts/demo/rollback-orders-extra.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  const rows = (await client.query("SELECT row_id FROM demo_seed_rows WHERE domain = 'orders-extra' AND table_name = 'product_volumes'")).rows
  const ids = rows.map((row) => Number(row.row_id))
  const result = await client.query("DELETE FROM product_volumes WHERE product_id = ANY($1::int[])", [ids])
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'orders-extra'")
  await client.query("COMMIT")
  console.log(`product_volumes: removed ${result.rowCount}`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
}
await client.end()
