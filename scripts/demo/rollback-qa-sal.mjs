// Removes exactly the ref_records rows inserted by scripts/demo/seed-qa-sal.mjs (listed in demo_seed_rows for domain
// 'qa-sal' as "<kind>:<id>"). The ref_records table itself and demo_seed_rows are left in place.
// Usage: node scripts/demo/rollback-qa-sal.mjs
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
  const rows = (await client.query("SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-sal' AND table_name = 'ref_records'")).rows
  let removed = 0
  for (const { row_id } of rows) {
    const [kind, ...rest] = row_id.split(":")
    const result = await client.query("DELETE FROM ref_records WHERE kind = $1 AND id = $2", [kind, rest.join(":")])
    removed += result.rowCount ?? 0
  }
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-sal' AND table_name = 'ref_records'")
  await client.query("COMMIT")
  console.log(`ref_records: removed ${removed}`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
