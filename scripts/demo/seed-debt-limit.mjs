// REFERENCE data for the client "Лимит долга" block. INSERT-only and idempotent; every row is registered in demo_seed_rows
// (domain 'debt-limit') so scripts/demo/rollback-debt-limit.mjs can remove exactly these rows.
// Usage: node scripts/demo/seed-debt-limit.mjs   (reads DATABASE_URL from .env)
//
//   client_debt_limits       the 81 (client, organization) limits of the reference `market/debt_limit/` list (11 clients)
//   client_debt_limit_modes  the reference "Тип лимита долга" split into "без/с учетом последнего заказа" per client
//                            (the reference exposes it only through the list filter, not on the limit rows)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const DOMAIN = "debt-limit"
const data = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/debt-limits-reference.json"), "utf8"))

const client = new pg.Client({ connectionString: url })
await client.connect()
const q = async (sql, params = []) => (await client.query(sql, params)).rows
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS client_debt_limits (
    id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL, organization_id INTEGER NOT NULL, organization TEXT NOT NULL DEFAULT '',
    amount DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
  await client.query(`CREATE TABLE IF NOT EXISTS client_debt_limit_modes (
    client_id INTEGER NOT NULL, with_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_id, with_order))`)
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const done = (await q("SELECT 1 FROM demo_seed_rows WHERE domain=$1 AND table_name='_marker' AND row_id='debt-limit:v1'", [DOMAIN])).length
  if (done) {
    console.log("already seeded")
  } else {
    const orgs = new Map((await q("SELECT id, name FROM organizations")).map((o) => [o.id, o.name]))
    const clientIds = new Set((await q("SELECT id FROM clients")).map((c) => c.id))
    let limits = 0
    for (const row of data.limits) {
      if (!clientIds.has(row.market)) continue
      const inserted = await q("INSERT INTO client_debt_limits (client_id, organization_id, organization, amount) VALUES ($1,$2,$3,$4) RETURNING id", [
        row.market, row.division, orgs.get(row.division) ?? row.divisionName, row.amount,
      ])
      await client.query("INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('client_debt_limits',$1,$2)", [String(inserted[0].id), DOMAIN])
      limits++
    }
    let modes = 0
    for (const [flag, ids] of Object.entries(data.modes)) {
      for (const id of ids) {
        if (!clientIds.has(id)) continue
        const r = await client.query("INSERT INTO client_debt_limit_modes (client_id, with_order) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, Number(flag)])
        if (r.rowCount) {
          await client.query("INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('client_debt_limit_modes',$1,$2)", [`${id}:${flag}`, DOMAIN])
          modes++
        }
      }
    }
    await client.query("INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('_marker','debt-limit:v1',$1)", [DOMAIN])
    console.log({ limits, modes })
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
