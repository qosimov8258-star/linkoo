// Attendance user order (domain "qa-per").
//
// The reference's "Посещения на работу" lists its 129 users (staff/attendance/) in its own order, which is neither
// alphabetical nor the employee id order. The order (employee ids) read from the reference lives in a new table
// attendance_user_order(employee_id, position).
//
// INSERT-only and idempotent: no existing row is updated or deleted; inserted rows are registered in
// demo_seed_rows (domain "qa-per") so scripts/demo/rollback-qa-per.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-attendance-order.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "qa-per"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const ids = JSON.parse(fs.readFileSync(path.join(here, "data/attendance-order.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS attendance_user_order (employee_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`,
  )
  let inserted = 0
  for (const [position, id] of ids.entries()) {
    const done = await client.query(`INSERT INTO attendance_user_order (employee_id, position) VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING`, [id, position])
    if (done.rowCount) {
      inserted += 1
      await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_user_order', $1, $2)`, [String(id), DOMAIN])
    }
  }
  await client.query("COMMIT")
  console.log({ inserted })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
