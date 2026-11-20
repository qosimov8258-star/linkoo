// Weights of inventory lines: Linko's inventory_products[].total_weight / total_weight_netto (the line's difference × the
// weight / net weight of one unit, which the inventory edit form shows as «Вес» / «Вес нетто») →
// stock_inventory_items.total_weight / total_weight_netto. import-stock-docs.mjs writes them with the lines; this step
// fills them on lines imported before the columns existed, without touching anything else (amounts, balances, ids, the
// documents themselves). A document whose lines no longer match Linko's (changed in the app) is left alone.
//
//   node scripts/linko-sync/import-inventory-weights.mjs
//
// Run after import-stock-docs.mjs. Every changed line is registered in linko_sync_rows with its previous weights.
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("inventory-weights")
const num = (value) => (value == null || value === "" ? 0 : Number(value))
const round = (value) => Math.round(value * 1e6) / 1e6
const client = await connect()
await ensureRegistry(client)
const stats = { lines: 0, same: 0, set: 0, skippedDocuments: [] }
try {
  await client.query("BEGIN")
  // Also in the app's schema (lib/stock-inventories-schema.ts).
  await client.query("ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS total_weight DOUBLE PRECISION NOT NULL DEFAULT 0")
  await client.query("ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS total_weight_netto DOUBLE PRECISION NOT NULL DEFAULT 0")
  const docs = raw("inventories_detail")
  for (const [id, doc] of Object.entries(docs)) {
    if (!doc || doc.__status || !Array.isArray(doc.inventory_products)) continue
    const lines = (
      await client.query("SELECT id, item_key, amount, total_weight, total_weight_netto FROM stock_inventory_items WHERE inventory_id = $1 ORDER BY position, id", [
        Number(id),
      ])
    ).rows
    const wanted = doc.inventory_products
    const matches =
      lines.length === wanted.length &&
      lines.every((line, index) => {
        const product = wanted[index].product
        const key = product?.id ? `product:${product.id}` : `name:${product?.name ?? ""}`
        return line.item_key === key && Math.abs(Number(line.amount) - num(wanted[index].amount)) < 1e-6
      })
    if (!matches) {
      if (lines.length) stats.skippedDocuments.push(Number(id))
      continue
    }
    for (const [index, line] of lines.entries()) {
      stats.lines++
      const weight = round(num(wanted[index].total_weight))
      const netto = round(num(wanted[index].total_weight_netto))
      if (Math.abs(Number(line.total_weight) - weight) < 1e-9 && Math.abs(Number(line.total_weight_netto) - netto) < 1e-9) {
        stats.same++
        continue
      }
      await client.query("UPDATE stock_inventory_items SET total_weight = $2, total_weight_netto = $3 WHERE id = $1", [line.id, weight, netto])
      await register(client, run, "stock_inventory_items", line.id, "update", { total_weight: line.total_weight, total_weight_netto: line.total_weight_netto })
      stats.set++
    }
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
