// One-off correction for the first qa-sklad import (see seed-qa-sklad.mjs "refimport:v1"): the repricing and stock-inventory rows were
// written with the reference's Tashkent wall-clock time as if it were UTC (+5 h on screen). This script removes ONLY the rows of those two
// tables that the seed registered in demo_seed_rows (domain 'qa-sklad'), widens repricings.amount from REAL to DOUBLE PRECISION (the table
// only holds these demo rows) and clears the 'refimport:v1' marker so `node scripts/demo/seed-qa-sklad.mjs` re-inserts them with the
// fixed times. Write-offs and the compensating supplies are left alone (existing ids are skipped by the seed).
// Usage: node scripts/demo/fix-qa-sklad-times.mjs && node scripts/demo/seed-qa-sklad.mjs
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
  for (const table of ["repricings", "stock_inventories"]) {
    const ids = (await client.query("SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = $1", [table])).rows.map((row) => Number(row.row_id))
    if (ids.length) await client.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids])
    await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = $1", [table])
    removed[table] = ids.length
  }
  await client.query("ALTER TABLE repricings ALTER COLUMN amount TYPE double precision")
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-sklad' AND table_name = '_marker' AND row_id = 'refimport:v1'")
  await client.query("COMMIT")
  console.log("removed own rows:", JSON.stringify(removed))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
