// One-off correction of the first "raw-materials:v1" import (rows were inserted newest-first, so the "Сырье" list came out reversed).
// Removes ONLY the raw_materials / product_kind_overrides rows that seed-qa-sklad.mjs registered in demo_seed_rows (domain 'qa-sklad') and
// clears the marker; then run `node scripts/demo/seed-qa-sklad.mjs` to insert them again in the right order. products rows are untouched.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  const removed = {}
  for (const table of ["product_kind_overrides", "raw_materials"]) {
    const ids = (await client.query("SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = $1", [table])).rows.map((row) => Number(row.row_id))
    if (ids.length) await client.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids])
    await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = $1", [table])
    removed[table] = ids.length
  }
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = '_marker' AND row_id = 'raw-materials:v1'")
  await client.query("COMMIT")
  console.log("removed own rows:", JSON.stringify(removed))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
