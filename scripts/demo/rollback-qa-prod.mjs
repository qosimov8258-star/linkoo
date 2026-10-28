// Removes only the rows registered by seed-production.mjs (domain 'qa-prod'). Do not run unless you want the production demo data gone.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = fs.readFileSync(path.join(root, ".env"), "utf8").match(/DATABASE_URL=(.*)/)[1].trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
const order = ["stock_inventory_items", "stock_inventories", "production_recipe_items", "production_movements", "production_parties", "production_recipes", "production_staff", "production_operation_meta", "production_operations", "production_equipment", "production_stages"]
await client.query("BEGIN")
for (const table of order) {
  await client.query(`DELETE FROM ${table} WHERE ${table === "production_operation_meta" ? "operation_id" : "id"}::text IN (SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-prod' AND table_name = $1)`, [table])
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'qa-prod' AND table_name = $1", [table])
}
await client.query("COMMIT")
await client.end()
console.log("qa-prod rows removed")
