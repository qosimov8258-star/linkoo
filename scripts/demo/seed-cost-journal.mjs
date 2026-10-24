// Reference cost journal (domain "dash-dlg").
//
// The P&L cost of a sale is the product's average cost from the warehouse cost journal (cost_of_goods_rows) on the day
// of the order. The journal that was there is demo data (4 dates per product, invented costs), so P&L costs differed from
// the reference (e.g. "robot moshina" 33 146 vs 80 140 in September 2026). This adds the reference's real journal
// (`stock/net_cost/`, 1187 rows, read-only) marked source = 'reference'; lib/pnl-stats-repo.ts prefers those rows
// for every product that has any.
//
// Additive only: one nullable-default column is added to cost_of_goods_rows and the rows are INSERTed (idempotent: a
// reference row that is already there is skipped). Every inserted row is registered in demo_seed_rows so
// scripts/demo/rollback-dash-dlg.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-cost-journal.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "dash-dlg"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const { rows } = JSON.parse(fs.readFileSync(path.join(here, "data/ref-net-cost.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE cost_of_goods_rows ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''")
  await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (
    table_name TEXT NOT NULL, row_id TEXT NOT NULL, domain TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
  )`)
  const existing = new Set(
    (await client.query("SELECT name || '|' || last_check_time AS k FROM cost_of_goods_rows WHERE source = 'reference'")).rows.map((row) => row.k),
  )
  let inserted = 0
  for (const row of rows) {
    const key = `${row.name}|${row.stamp}`
    if (existing.has(key)) continue
    const res = await client.query(
      `INSERT INTO cost_of_goods_rows (name, warehouse, row_date, avg_cost, cost, passed, supply_number, calculated_balance, actual_balance, total_revaluation, last_check_time, source)
       VALUES ($1, '', $2, $3, $3, 1, '', $4, $4, 0, $5, 'reference') RETURNING id`,
      [row.name, row.date, row.cost, row.balance ?? 0, row.stamp],
    )
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('cost_of_goods_rows', $1, $2)", [String(res.rows[0].id), DOMAIN])
    inserted += 1
  }
  await client.query("COMMIT")
  console.log(JSON.stringify({ inserted }))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
