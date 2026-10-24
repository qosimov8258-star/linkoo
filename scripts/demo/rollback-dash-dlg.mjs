// Removes the rows inserted by the "dash-dlg" seeds (scripts/demo/seed-tracking-way.mjs, scripts/demo/seed-cost-journal.mjs): only rows registered in
// demo_seed_rows for that domain are deleted, in the table they were registered for.
//
//   node scripts/demo/rollback-dash-dlg.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "dash-dlg"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const ALLOWED = new Set(["tracking_way_agents", "cost_of_goods_rows"])

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  const registered = (await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = $1", [DOMAIN])).rows
  const removed = {}
  for (const { table_name: table, row_id: id } of registered) {
    if (!ALLOWED.has(table)) continue
    const res = await client.query(`DELETE FROM ${table} WHERE id = $1`, [Number(id)])
    removed[table] = (removed[table] ?? 0) + res.rowCount
  }
  await client.query("DELETE FROM demo_seed_rows WHERE domain = $1", [DOMAIN])
  await client.query("COMMIT")
  console.log(JSON.stringify({ removed }))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
