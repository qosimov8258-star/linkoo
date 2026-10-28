// Removes exactly the rows inserted by scripts/demo/seed-salary-credits.mjs (demo_seed_rows, domain "qa-salary-credits").
//   node scripts/demo/rollback-salary-credits.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  const done = await client.query(`DELETE FROM salary_credits WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-salary-credits' AND table_name = 'salary_credits')`)
  await client.query(`DELETE FROM demo_seed_rows WHERE domain = 'qa-salary-credits'`)
  await client.query("COMMIT")
  console.log({ credits: done.rowCount })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
