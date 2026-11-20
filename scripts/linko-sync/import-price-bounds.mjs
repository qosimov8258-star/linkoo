// Формирование цен «Цена(мин)» / «Цена(макс)»: Linko keeps them on the product (stock/products_net_costs min_price /
// max_price) and moves them with every price it writes — the lowest and the highest price the product was ever given
// (cash and transfer, a zero included, each converted into the base currency at the rate of that day). A price that
// was changed later does not narrow them, so they cannot be recomputed from the current price lists: this step copies
// Linko's stored values into products.price_min / price_max (a product Linko never priced, null, gets 0, which Linko
// prints as «0»). The app then moves them the same way on every price write (lib/item-prices.ts setItemPrices).
// Run it after import-price-list-items.mjs, which derives them from the current prices. Every change is registered in
// linko_sync_rows with the previous values.
//
//   node scripts/linko-sync/import-price-bounds.mjs   (raw: products_net_costs)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const money = (value) => {
  const number = Number(value)
  return value !== null && value !== undefined && Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : 0
}

const rows = raw("products_net_costs")
const run = runId("price-bounds")
const client = await connect()
await ensureRegistry(client)
const stats = { update: 0, same: 0, missing: [] }
try {
  await client.query("BEGIN")
  for (const item of rows) {
    const id = Number(item.id)
    if (!Number.isInteger(id) || id <= 0) continue
    const row = (await client.query("SELECT id, price_min, price_max FROM products WHERE id = $1 FOR UPDATE", [id])).rows[0]
    if (!row) {
      stats.missing.push(id)
      continue
    }
    const next = { price_min: money(item.min_price), price_max: money(item.max_price) }
    if (Number(row.price_min) === next.price_min && Number(row.price_max) === next.price_max) {
      stats.same++
      continue
    }
    await client.query("UPDATE products SET price_min = $2, price_max = $3 WHERE id = $1", [id, next.price_min, next.price_max])
    await register(client, run, "products", id, "update", { price_min: row.price_min, price_max: row.price_max })
    stats.update++
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
