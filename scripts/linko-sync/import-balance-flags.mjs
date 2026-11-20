// Products' «Учитывать срок годности» / series flags (products.track_expiry / track_series) from Linko's stock/all_balances/
// list (all_balances.json of the full download: every product with its use_expiration / use_series). import-series.mjs
// takes the flags from the product objects nested in documents, which carry the product's `name`; the all_balances rows
// carry `title` instead, so the products that appear in no such document kept no flag (the inventory form's «Серия»
// stayed disabled for them). Only products present in the list are touched, with the rule of import-series.mjs: a product
// keeps series only when it also keeps expiry dates.
//
//   node scripts/linko-sync/import-balance-flags.mjs
//
// Run after import-series.mjs. Every changed product is registered in linko_sync_rows with its previous flags.
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("balance-flags")
const client = await connect()
await ensureRegistry(client)
const stats = { listed: 0, same: 0, changed: 0, missing: 0 }
try {
  await client.query("BEGIN")
  const rows = raw("all_balances")
  if (!Array.isArray(rows)) throw new Error("all_balances.json: a list was expected")
  const products = new Map((await client.query("SELECT id, track_expiry, track_series FROM products")).rows.map((row) => [Number(row.id), row]))
  for (const row of rows) {
    if (!row || !Number.isInteger(row.id) || !("use_expiration" in row)) continue
    stats.listed++
    const current = products.get(row.id)
    if (!current) {
      stats.missing++
      continue
    }
    const expiry = row.use_expiration ? 1 : 0
    const series = expiry && row.use_series ? 1 : 0
    if (Number(current.track_expiry) === expiry && Number(current.track_series) === series) {
      stats.same++
      continue
    }
    await client.query("UPDATE products SET track_expiry = $2, track_series = $3 WHERE id = $1", [row.id, expiry, series])
    await register(client, run, "products", row.id, "update", { track_expiry: current.track_expiry, track_series: current.track_series })
    stats.changed++
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
