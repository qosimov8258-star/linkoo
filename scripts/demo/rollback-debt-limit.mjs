// Removes exactly the rows scripts/demo/seed-debt-limit.mjs inserted (domain 'debt-limit'). Rows created through the app stay.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
const DOMAIN = "debt-limit"
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  const limits = await client.query(
    "DELETE FROM client_debt_limits WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE domain=$1 AND table_name='client_debt_limits')", [DOMAIN])
  const modes = await client.query(
    "DELETE FROM client_debt_limit_modes WHERE (client_id::text || ':' || with_order::text) IN (SELECT row_id FROM demo_seed_rows WHERE domain=$1 AND table_name='client_debt_limit_modes')", [DOMAIN])
  await client.query("DELETE FROM demo_seed_rows WHERE domain=$1", [DOMAIN])
  await client.query("COMMIT")
  console.log({ limits: limits.rowCount, modes: modes.rowCount })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
