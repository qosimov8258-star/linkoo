// Reference data for the "listb-extra" pass. INSERT-only and idempotent, additive tables only:
//   contract_reference_rows      the 873 contracts of the reference "Договоры" list (id, number text, status, agent, clients…),
//                                 read from the reference page's own API; the local list takes the "№" and the 151 contracts
//                                 it is missing from here (existing `contracts` rows are never touched).
//   receive_task_reference_rows  the 16 tasks of the reference "План приемок и передач → Приемка" (4 supplies, 11 customer
//                                 returns, 1 transfer); the local tab shows the returns/transfer from here.
// Every inserted row is registered in demo_seed_rows (domain 'listb-extra') for scripts/demo/rollback-listb-extra.mjs.
// Usage: node scripts/demo/seed-listb-extra.mjs   (reads DATABASE_URL from .env)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const DOMAIN = "listb-extra"
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data", name), "utf8"))

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  await client.query(`CREATE TABLE IF NOT EXISTS contract_reference_rows (
    id integer PRIMARY KEY, full_number text NOT NULL DEFAULT '', contract_number integer, contract_prefix text NOT NULL DEFAULT '',
    contract_suffix text NOT NULL DEFAULT '', status text NOT NULL DEFAULT '', created_date text NOT NULL DEFAULT '', year integer,
    inn text NOT NULL DEFAULT '', official_name text NOT NULL DEFAULT '', agent text NOT NULL DEFAULT '', comment text NOT NULL DEFAULT '',
    markets jsonb NOT NULL DEFAULT '[]'::jsonb)`)
  await client.query(`CREATE TABLE IF NOT EXISTS receive_task_reference_rows (
    id integer PRIMARY KEY, type text NOT NULL, by_name text NOT NULL DEFAULT '', stock_name text NOT NULL DEFAULT '',
    task_date text NOT NULL DEFAULT '', order_id integer, status text NOT NULL DEFAULT '0')`)
  let added = 0
  for (const row of read("contracts-reference.json")) {
    const res = await client.query(
      `INSERT INTO contract_reference_rows (id, full_number, contract_number, contract_prefix, contract_suffix, status, created_date, year, inn, official_name, agent, comment, markets)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      [row.id, row.full_number, row.contract_number, row.prefix, row.suffix, row.status, row.created_date, row.year, row.inn, row.official_name, row.agent, row.comment, JSON.stringify(row.markets)],
    )
    if (res.rowCount) {
      added++
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('contract_reference_rows', $1, $2)", [String(row.id), DOMAIN])
    }
  }
  let tasks = 0
  for (const row of read("receive-tasks-reference.json")) {
    const res = await client.query(
      "INSERT INTO receive_task_reference_rows (id, type, by_name, stock_name, task_date, order_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
      [row.id, row.type, row.by, row.stock, row.date, row.order_id, row.status],
    )
    if (res.rowCount) {
      tasks++
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('receive_task_reference_rows', $1, $2)", [String(row.id), DOMAIN])
    }
  }
  console.log({ contract_reference_rows: added, receive_task_reference_rows: tasks })
} finally {
  await client.end()
}
