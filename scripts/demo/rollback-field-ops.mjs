// Removes exactly the rows registered by seed-field-ops.mjs (demo_seed_rows,
// domain = 'field-ops') and then their registry entries. agent_visits is left
// as an (empty) table. Not run automatically.
//
//   node scripts/demo/rollback-field-ops.mjs
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(path.join(root, "package.json"))
const pg = require("pg")

const DOMAIN = "field-ops"
const TABLES = ["agent_visits", "agent_routes", "tasks", "attendance_weekend_days", "survey_plans", "branch_plans", "branch_kpi_plans", "branch_kpi_indicator_rules"]
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
const db = new pg.Client({ connectionString: url })
await db.connect()

const removed = {}
for (const table of TABLES) {
  if (!TABLES.includes(table)) continue
  const res = await db.query(
    `DELETE FROM "${table}" WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE domain = $1 AND table_name = $2)`,
    [DOMAIN, table],
  )
  removed[table] = res.rowCount
}
await db.query(`DELETE FROM demo_seed_rows WHERE domain = $1`, [DOMAIN])
console.log(JSON.stringify(removed))
await db.end()
