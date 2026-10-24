// Display order of the agent plan ("Анализ маршрутов" lists its agents in the reference's order; the first
// ~28 follow the plan's own ordering, the rest are alphabetical). Domain "clients-extra2".
//
// INSERT-only and idempotent: new table agent_plan_order(employee_id, position); rows are registered in
// demo_seed_rows so scripts/demo/rollback-clients-extra2.mjs removes exactly these.
//
//   node scripts/demo/seed-agent-plan-order.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "clients-extra2"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const order = JSON.parse(fs.readFileSync(path.join(here, "data/agent-plan-order.json"), "utf8")) // names, in the reference's display order

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_seed_rows (
      table_name text NOT NULL,
      row_id text NOT NULL,
      domain text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (table_name, row_id, domain)
    )
  `)
  await client.query("CREATE TABLE IF NOT EXISTS agent_plan_order (employee_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)")
  const members = (
    await client.query(
      `SELECT e.id, TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS name
       FROM agent_plan_members m JOIN employees e ON e.id = m.employee_id WHERE m.active = 1 ORDER BY e.id`,
    )
  ).rows
  const used = new Set()
  let inserted = 0
  const missing = []
  for (const [index, name] of order.entries()) {
    // the same name can belong to several employees: they are taken in id order
    const row = members.find((member) => member.name === name && !used.has(member.id))
    if (!row) {
      missing.push(name)
      continue
    }
    used.add(row.id)
    const result = await client.query("INSERT INTO agent_plan_order (employee_id, position) VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING RETURNING employee_id", [row.id, index])
    if (!result.rowCount) continue
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('agent_plan_order', $1, $2) ON CONFLICT DO NOTHING", [String(row.id), DOMAIN])
    inserted += 1
  }
  await client.query("COMMIT")
  console.log({ inserted, missing })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
