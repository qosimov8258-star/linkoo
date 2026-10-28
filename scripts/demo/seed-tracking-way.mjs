// Tracking agents seed (domain "dash-dlg").
//
// The reference's "Отслеживание" panel lists the 34 agents of its `market/way/` API (name, colour, last activity,
// last position, battery and the groups agent / merch / delivery / collector that the panel tabs filter on).
// Locally the list was 11 hard-coded agents. This stores the reference rows in tracking_way_agents.
//
// INSERT-only and idempotent: every inserted row is registered in demo_seed_rows (domain "dash-dlg") so
// scripts/demo/rollback-dash-dlg.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-tracking-way.mjs
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

const { agents } = JSON.parse(fs.readFileSync(path.join(here, "data/tracking-way.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS tracking_way_agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#9e9e9e',
    last_activity TEXT,
    battery DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    groups TEXT NOT NULL DEFAULT ''
  )`)
  await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (
    table_name TEXT NOT NULL, row_id TEXT NOT NULL, domain TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
  )`)
  let inserted = 0
  for (const agent of agents) {
    const res = await client.query(
      `INSERT INTO tracking_way_agents (id, name, color, last_activity, battery, lat, lon, groups)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [agent.id, agent.name, agent.color, agent.lastActivity, agent.battery, agent.lat, agent.lon, agent.groups.join(",")],
    )
    if (res.rowCount) {
      inserted += 1
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1,$2,$3)", ["tracking_way_agents", String(agent.id), DOMAIN])
    }
  }
  await client.query("COMMIT")
  console.log(JSON.stringify({ inserted }))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
