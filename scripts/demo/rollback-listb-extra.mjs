// Removes exactly the rows inserted by scripts/demo/seed-listb-extra.mjs (the ones listed in demo_seed_rows for domain
// 'listb-extra'). The two additive tables themselves are left in place. Usage: node scripts/demo/rollback-listb-extra.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const ALLOWED = ["contract_reference_rows", "receive_task_reference_rows"]
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  const rows = (await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'listb-extra'")).rows
  for (const row of rows) if (!ALLOWED.includes(row.table_name)) throw new Error(`unexpected table: ${row.table_name}`)
  for (const table of ALLOWED) {
    const ids = rows.filter((row) => row.table_name === table).map((row) => Number(row.row_id))
    if (ids.length) console.log(table, (await client.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids])).rowCount)
  }
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'listb-extra'")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
