// Removes exactly the rows inserted by scripts/demo/seed-salary-reference.mjs (demo_seed_rows, domain "qa-salary").
//   node scripts/demo/rollback-salary-reference.mjs
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
  const records = await client.query(`DELETE FROM salary_records WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-salary' AND table_name = 'salary_records')`)
  const dates = await client.query(`DELETE FROM salary_last_dates WHERE (year || '-' || month) IN (SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-salary' AND table_name = 'salary_last_dates')`)
  await client.query(`DELETE FROM demo_seed_rows WHERE domain = 'qa-salary'`)
  await client.query("COMMIT")
  console.log({ records: records.rowCount, dates: dates.rowCount })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
