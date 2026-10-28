// Agent-plan membership seed (domain "clients-extra2").
//
// The reference's "Анализ маршрутов" lists the employees of its `agents_plans` (92 rows, 83 of them active:
// "Не Вышли 83" = the active part). Locally every active employee (129) was listed. This adds the reference
// membership in a new table, agent_plan_members(employee_id, active), keyed by the employee id (the ids of
// the reference and of the local employees are the same).
//
// INSERT-only and idempotent: nothing existing is updated or deleted; every inserted row is registered in
// demo_seed_rows so scripts/demo/rollback-clients-extra2.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-agent-plan.mjs
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

const reference = JSON.parse(fs.readFileSync(path.join(here, "data/existing-changes-reference.json"), "utf8"))
const plans = reference.agentPlans // [{ id, active }]
// The tabs of the agents panel are server filters (?group=agent|merch|delivery|collector): who belongs to which.
const groups = JSON.parse(fs.readFileSync(path.join(here, "data/agent-plan-groups.json"), "utf8")).groups
// An employee can be in several groups (12 of them are), so group_key keeps a comma separated list.
const groupsOf = new Map()
for (const [group, ids] of Object.entries(groups)) for (const id of ids) groupsOf.set(id, [...(groupsOf.get(id) ?? []), group])

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
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_plan_members (
      employee_id INTEGER PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 1,
      group_key TEXT NOT NULL DEFAULT ''
    )
  `)
  const known = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  let inserted = 0
  let skipped = 0
  for (const plan of plans) {
    if (!known.has(plan.id)) {
      skipped += 1
      continue
    }
    const result = await client.query(
      "INSERT INTO agent_plan_members (employee_id, active, group_key) VALUES ($1, $2, $3) ON CONFLICT (employee_id) DO NOTHING RETURNING employee_id",
      [plan.id, plan.active ? 1 : 0, (groupsOf.get(plan.id) ?? []).join(",")],
    )
    if (!result.rowCount) continue
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('agent_plan_members', $1, $2) ON CONFLICT DO NOTHING", [String(plan.id), DOMAIN])
    inserted += 1
  }
  await client.query("COMMIT")
  console.log({ inserted, skipped, active: plans.filter((plan) => plan.active).length })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
