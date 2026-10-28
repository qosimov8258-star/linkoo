// DEMO data for the orders area: per-product volume (m³) used by "Итоги выбранных заказов" (Объём). The products table only
// holds the text "Не указано м³." for every product, so volumes live in the additive table product_volumes.
// INSERT-only and idempotent; every inserted row is registered in demo_seed_rows (domain 'orders-extra').
// Usage: node scripts/demo/seed-orders-extra.mjs   (reads DATABASE_URL from .env)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "orders-extra"
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
await client.query(`CREATE TABLE IF NOT EXISTS product_volumes (product_id integer PRIMARY KEY, volume_m3 double precision NOT NULL)`)

// Deterministic: roughly every third product that is sold in blocks gets a volume of 0.001–0.09 m³ per unit.
const products = (await client.query("SELECT id, COALESCE(box_amount, 0) AS box_amount FROM products ORDER BY id")).rows
let inserted = 0
await client.query("BEGIN")
try {
  for (const product of products) {
    if (Number(product.id) % 3 !== 0 && !(Number(product.box_amount) > 0 && Number(product.id) % 2 === 0)) continue
    const volume = Math.round((((Number(product.id) * 37) % 90) + 10) / 1000 * 1000) / 1000
    const result = await client.query("INSERT INTO product_volumes (product_id, volume_m3) VALUES ($1, $2) ON CONFLICT (product_id) DO NOTHING", [product.id, volume])
    if (result.rowCount) {
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('product_volumes', $1, $2)", [String(product.id), DOMAIN])
      inserted += 1
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
}
console.log(JSON.stringify({ product_volumes: inserted }))
await client.end()
