// Removes exactly the rows registered in demo_seed_rows with domain "qa-cli" (QA helpers of the clients section).
//   node scripts/demo/rollback-qa-cli.mjs   (not run automatically)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const KEYS = { client_channel_categories: "id", telegram_users: "id" }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL || fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  const rows = (await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'qa-cli'")).rows
  for (const row of rows) {
    const key = KEYS[row.table_name]
    if (!key) continue
    await client.query(`DELETE FROM ${row.table_name} WHERE ${key}::text = $1`, [row.row_id])
    await client.query("DELETE FROM demo_seed_rows WHERE table_name = $1 AND row_id = $2 AND domain = 'qa-cli'", [row.table_name, row.row_id])
  }
  await client.query("COMMIT")
  console.log({ removed: rows.length })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
