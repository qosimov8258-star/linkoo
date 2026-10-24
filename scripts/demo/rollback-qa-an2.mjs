// Removes exactly the rows registered by scripts/demo/seed-qa-an2.mjs (domain 'qa-an2'). Not run automatically.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  const rows = (await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'qa-an2' AND table_name <> '_marker'")).rows
  for (const { table_name, row_id } of rows) await client.query(`DELETE FROM ${table_name} WHERE id = $1`, [row_id])
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-an2'")
  await client.query("COMMIT")
  console.log("removed", rows.length)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
