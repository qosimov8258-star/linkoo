// Продукты: Linko's «Объем» of a product (main/product `capacity`), which the first copy left as the «Не указано м³.»
// text. Остаток «Показать: Объем» (stock/all_balances?show_in=capacity) is quantity × capacity, and the product card
// prints it. products.volume gets the number as the product form saves it (a plain decimal); a product Linko has no
// capacity for keeps what it has. Every change is registered in linko_sync_rows with the previous value.
//
//   node scripts/linko-sync/import-product-capacity.mjs     (raw: products)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("product-capacity")
const products = raw("products")
const leading = (value) => {
  const match = /-?\d[\d\s]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  return match ? Number(match[0].replace(/\s/g, "").replace(",", ".")) || 0 : 0
}
const plain = (value) => String(Math.round(value * 1e6) / 1e6)

const client = await connect()
await ensureRegistry(client)
const stats = { updated: 0, same: 0, missing: 0 }
try {
  await client.query("BEGIN")
  const local = new Map((await client.query("SELECT id, volume FROM products")).rows.map((row) => [Number(row.id), row.volume]))
  for (const product of products) {
    const capacity = Number(product.capacity ?? 0)
    if (!(capacity > 0)) continue
    if (!local.has(Number(product.id))) {
      stats.missing++
      continue
    }
    const previous = local.get(Number(product.id))
    if (Math.abs(leading(previous) - capacity) < 1e-9) {
      stats.same++
      continue
    }
    await client.query("UPDATE products SET volume = $1 WHERE id = $2", [plain(capacity), product.id])
    await register(client, run, "products", product.id, "update", { volume: previous })
    stats.updated++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`product capacity: ${stats.updated} products got Linko's «Объем», ${stats.same} already had it, ${stats.missing} not here`)
