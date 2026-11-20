// Series of inventory lines: Linko's inventory_products[].series.id → stock_inventory_items.series_id (the shared
// series catalog stock_series keeps Linko's ids, import-series.mjs). import-stock-docs.mjs writes it with the lines; this
// step fills it on lines imported before the column existed, without touching anything else (their amounts, balances,
// ids, the documents themselves). A document whose lines no longer match Linko's (changed in the app) is left alone.
//
//   node scripts/linko-sync/import-inventory-series.mjs
//
// Run after import-series.mjs and import-stock-docs.mjs. Every changed line is registered in linko_sync_rows with its
// previous series_id.
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("inventory-series")
const client = await connect()
await ensureRegistry(client)
const stats = { lines: 0, same: 0, set: 0, cleared: 0, skippedDocuments: [], missingSeries: [] }
try {
  await client.query("BEGIN")
  // Also in the app's schema (lib/stock-inventories-schema.ts).
  await client.query("ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS series_id INTEGER")
  const known = new Set((await client.query("SELECT id FROM stock_series")).rows.map((row) => Number(row.id)))
  const docs = raw("inventories_detail")
  for (const [id, doc] of Object.entries(docs)) {
    if (!doc || doc.__status || !Array.isArray(doc.inventory_products)) continue
    const lines = (await client.query("SELECT id, item_key, amount, series_id FROM stock_inventory_items WHERE inventory_id = $1 ORDER BY position, id", [Number(id)])).rows
    const wanted = doc.inventory_products
    const matches =
      lines.length === wanted.length &&
      lines.every((line, index) => {
        const product = wanted[index].product
        const key = product?.id ? `product:${product.id}` : `name:${product?.name ?? ""}`
        return line.item_key === key && Math.abs(Number(line.amount) - Number(wanted[index].amount)) < 1e-6
      })
    if (!matches) {
      if (lines.length) stats.skippedDocuments.push(Number(id))
      continue
    }
    for (const [index, line] of lines.entries()) {
      stats.lines++
      const series = wanted[index].series
      let seriesId = series && typeof series === "object" && series.id ? Number(series.id) : null
      if (seriesId !== null && !known.has(seriesId)) {
        stats.missingSeries.push(seriesId)
        seriesId = null
      }
      const current = line.series_id == null ? null : Number(line.series_id)
      if (current === seriesId) {
        stats.same++
        continue
      }
      await client.query("UPDATE stock_inventory_items SET series_id = $2 WHERE id = $1", [line.id, seriesId])
      await register(client, run, "stock_inventory_items", line.id, "update", { series_id: current })
      if (seriesId === null) stats.cleared++
      else stats.set++
    }
  }
  await client.query("COMMIT")
  stats.missingSeries = [...new Set(stats.missingSeries)]
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
