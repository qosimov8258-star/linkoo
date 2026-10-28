// Removes only the rows registered in demo_seed_rows with domain "qa-per" (see seed-kpi-dates.mjs and seed-kpi-details.mjs).
//   node scripts/demo/rollback-qa-per.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? match?.[1].trim() })
await client.connect()
try {
  await client.query("BEGIN")
  const rows = (await client.query(`SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'qa-per'`)).rows
  for (const row of rows) {
    if (row.table_name === "kpi_task_dates") await client.query(`DELETE FROM kpi_task_dates WHERE task_id = $1`, [Number(row.row_id)])
    if (row.table_name === "attendance_user_order") await client.query(`DELETE FROM attendance_user_order WHERE employee_id = $1`, [Number(row.row_id)])
    if (row.table_name === "kpi_task_details") await client.query(`DELETE FROM kpi_task_details WHERE task_id = $1`, [Number(row.row_id)])
  }
  await client.query(`DELETE FROM demo_seed_rows WHERE domain = 'qa-per'`)
  await client.query("COMMIT")
  console.log({ removed: rows.length })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
