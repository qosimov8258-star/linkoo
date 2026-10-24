// Reference data for the "Продажи" list pages (returns, refusals, promotions, mailings, ...). INSERT-only and
// idempotent: rows go to ref_records (kind, id) with ON CONFLICT DO NOTHING and every inserted row is registered in
// demo_seed_rows (domain 'qa-sal') so scripts/demo/rollback-qa-sal.mjs can remove exactly these rows.
// The JSON files in scripts/demo/data/qa-sal-kind-<kind>.json hold the rows in each page's own row shape, in the order the
// reference lists them (returns: client/zone are the reference's market name and zone).
// Usage: node scripts/demo/seed-qa-sal.mjs   (reads DATABASE_URL from .env)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "qa-sal"
const dataDir = path.join(root, "scripts/demo/data")
const files = fs.readdirSync(dataDir).filter((name) => /^qa-sal-kind-.+\.json$/.test(name))

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  await client.query(`CREATE TABLE IF NOT EXISTS ref_records (
    seq BIGINT GENERATED ALWAYS AS IDENTITY, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
    deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), PRIMARY KEY (kind, id))`)
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const summary = {}
  for (const file of files) {
    const kind = file.replace(/^qa-sal-kind-/, "").replace(/\.json$/, "")
    const rows = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"))
    let inserted = 0
    for (const [index, row] of rows.entries()) {
      const id = String(row.id ?? row.key ?? index + 1)
      const result = await client.query("INSERT INTO ref_records (kind, id, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [kind, id, JSON.stringify(row)])
      if (result.rowCount) {
        inserted += 1
        await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('ref_records', $1, $2)", [`${kind}:${id}`, DOMAIN])
      }
    }
    summary[kind] = inserted
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(summary))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
