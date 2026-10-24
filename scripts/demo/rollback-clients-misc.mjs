// Removes exactly the rows scripts/demo/seed-clients-misc.mjs inserted (those listed in demo_seed_rows
// for domain "clients-misc"). The tables created by the seed are left in place.
//
//   node scripts/demo/rollback-clients-misc.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "clients-misc"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

// table -> primary key column
const KEYS = {
  client_restrictions: "id",
  financial_account_markets: "client_id",
  client_object_status: "client_id",
}

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  for (const [table, column] of Object.entries(KEYS)) {
    const deleted = await client.query(
      `DELETE FROM ${table} WHERE ${column}::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name = $1 AND domain = $2)`,
      [table, DOMAIN],
    )
    await client.query("DELETE FROM demo_seed_rows WHERE table_name = $1 AND domain = $2", [table, DOMAIN])
    console.log(table, "removed", deleted.rowCount)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
