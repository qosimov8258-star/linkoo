// "KPI план филиалов": the real plans / bonus totals / recalculation dates that the reference
// (GET staff/branch_performance/?month&year, .../last_date/) holds for the months that have data
// (2025-06, 2025-12, 2026-01, 2026-04). Domain "kpi-ref".
//
// INSERT-only and idempotent: existing (branch, period) rows are never updated or deleted; every inserted row is
// registered in demo_seed_rows so scripts/demo/rollback-branch-kpi-reference.mjs removes exactly these rows.
//   node scripts/demo/seed-branch-kpi-reference.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "kpi-ref"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)

// branch id -> [indicator id -> plan], total bonus (null = none), as read from the reference.
const DATA = {
  "2025-06": { lastDate: "2025-06-27T11:39:59.961781", branches: [{ id: 7, name: "777", total: 1500000, plans: { 9: 5, 16: 55, 19: 3, 13: 3, 25: 100 } }] },
  "2025-12": {
    lastDate: "2025-12-25T16:16:10.729667",
    branches: [
      { id: 7, name: "777", total: 555555.0008, plans: { 53: 20, 65: 2 } },
      { id: 34, name: "878", total: null, plans: { 53: 100 } },
    ],
  },
  "2026-01": { lastDate: null, branches: [{ id: 7, name: "777", total: null, plans: { 82: 200 } }] },
  "2026-04": { lastDate: "2026-04-25T14:47:36.644513", branches: [{ id: 7, name: "777", total: 555555, plans: { 53: 1222 } }] },
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? match?.[1].trim() })
await client.connect()
const counts = { plans: 0, balances: 0, recalcs: 0 }
async function register(table, id) {
  await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)`, [table, String(id), DOMAIN])
}
try {
  await client.query("BEGIN")
  for (const [period, month] of Object.entries(DATA)) {
    for (const b of month.branches) {
      const exists = await client.query(`SELECT 1 FROM branches WHERE id = $1`, [b.id])
      if (!exists.rowCount) continue
      const plan = JSON.stringify({ indicators: Object.fromEntries(Object.entries(b.plans)) })
      const res = await client.query(
        `INSERT INTO branch_kpi_plans (branch_id, branch_name, period, plan) VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, period) DO NOTHING RETURNING id`,
        [b.id, b.name, period, plan],
      )
      if (res.rowCount) { counts.plans++; await register("branch_kpi_plans", res.rows[0].id) }
      if (b.total !== null) {
        const bal = await client.query(
          `INSERT INTO branch_kpi_balances (period, branch_id, branch_name, total_bonus, balances, calculated_at) VALUES ($1,$2,$3,$4,'[]',$5) ON CONFLICT (period, branch_id) DO NOTHING RETURNING id`,
          [period, b.id, b.name, b.total, month.lastDate ?? ""],
        )
        if (bal.rowCount) { counts.balances++; await register("branch_kpi_balances", bal.rows[0].id) }
      }
    }
    if (month.lastDate) {
      const rec = await client.query(
        `INSERT INTO branch_kpi_recalcs (period, last_date, calculated_by) VALUES ($1,$2,'Admin Ritm') ON CONFLICT (period) DO NOTHING RETURNING id`,
        [period, month.lastDate],
      )
      if (rec.rowCount) { counts.recalcs++; await register("branch_kpi_recalcs", rec.rows[0].id) }
    }
  }
  await client.query("COMMIT")
  console.log(counts)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
