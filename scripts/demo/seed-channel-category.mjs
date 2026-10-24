// The reference's "Категория канала" select (MarketChannelCategory) holds one value, "wewe" (domain "qa-cli").
// INSERT-only; registered in demo_seed_rows.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL || fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text NOT NULL, row_id text NOT NULL, domain text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (table_name, row_id, domain))")
  await client.query("CREATE TABLE IF NOT EXISTS client_channel_categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL)")
  const exists = await client.query("SELECT id FROM client_channel_categories WHERE name = 'wewe'")
  if (!exists.rowCount) {
    const row = await client.query("INSERT INTO client_channel_categories (name) VALUES ('wewe') RETURNING id")
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('client_channel_categories', $1, 'qa-cli') ON CONFLICT DO NOTHING", [String(row.rows[0].id)])
    console.log({ inserted: 1 })
  } else console.log({ inserted: 0 })
} finally {
  await client.end()
}
