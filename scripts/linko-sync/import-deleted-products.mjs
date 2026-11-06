// Products Linko has deleted but its documents (supplies, orders, transfers, write-offs, returns, inventories, production)
// still name: added as deleted products (products.deleted = 1), so those documents keep their product names and units,
// and — like in Linko — they are left out of the catalog and of Остаток. Also marks as deleted the local products
// Linko does not have that only demo seeds created (demo_seed_rows).
//
//   node scripts/linko-sync/import-deleted-products.mjs
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("deleted-products")
const live = new Set(raw("products").map((p) => p.id))
const found = new Map()
const note = (p) => {
  if (!p || !p.id || live.has(p.id) || found.has(p.id)) return
  found.set(p.id, { id: p.id, name: p.name ?? `#${p.id}`, unit: p.measurement?.name ?? "", code: p.vendor_code ?? p.code ?? "" })
}
const each = (name, pick) => {
  if (!hasRaw(name)) return
  const data = raw(name)
  for (const doc of Array.isArray(data) ? data : Object.values(data)) if (doc && !doc.__status) for (const p of pick(doc)) note(p)
}
each("supplies_detail", (d) => (d.products ?? []).map((l) => l.product))
each("orders_detail", (d) => (d.products ?? []).map((l) => l.product))
each("order_returns_detail", (d) => (d.returned_products ?? []).map((l) => l.product))
each("stock_transfers_detail", (d) => (d.products ?? []).map((l) => l.product))
each("writeoffs_detail", (d) => (d.products ?? []).map((l) => l.product))
each("supply_returns_detail", (d) => (d.return_products ?? []).map((l) => l.product))
each("inventories_detail", (d) => (d.inventory_products ?? []).map((l) => l.product))
each("parties_detail", (d) => [...(d.made_products ?? []), ...(d.made_defects ?? []), ...(d.raw_products ?? []), ...(d.raw_defects ?? [])].map((l) => l.product))
each("promotions_detail", (d) => (d.products ?? []).map((l) => l.product))
each("order_products", (d) => [{ id: d.product_id, name: d.product_name, measurement: d.measurement }])

const client = await connect()
await ensureRegistry(client)
let added = 0
let marked = 0
try {
  await client.query("BEGIN")
  for (const p of found.values()) {
    const exists = (await client.query("SELECT id, deleted FROM products WHERE id = $1", [p.id])).rows[0]
    if (exists) {
      if (!exists.deleted) {
        await client.query("UPDATE products SET deleted = 1, updated_at = datetime('now') WHERE id = $1", [p.id])
        await register(client, run, "products", p.id, "update", { deleted: 0 })
        marked++
      }
      continue
    }
    await client.query("INSERT INTO products (id, name, unit, article, deleted, can_sell) VALUES ($1, $2, $3, $4, 1, 0)", [p.id, p.name, p.unit, p.code])
    await register(client, run, "products", p.id, "insert")
    added++
  }
  // Local products Linko does not have, created by demo seeds only: deleted (kept as rows, like Linko's deleted ones).
  const demo = (await client.query("SELECT p.id FROM products p JOIN demo_seed_rows d ON d.table_name = 'products' AND d.row_id = p.id::text WHERE COALESCE(p.deleted, 0) = 0")).rows
  for (const row of demo) {
    if (live.has(row.id)) continue
    await client.query("UPDATE products SET deleted = 1, updated_at = datetime('now') WHERE id = $1", [row.id])
    await register(client, run, "products", row.id, "update", { deleted: 0 })
    marked++
  }
  await client.query("SELECT setval(pg_get_serial_sequence('products', 'id'), GREATEST((SELECT MAX(id) FROM products), 1))")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`deleted products: ${found.size} named by documents; added ${added}; marked deleted ${marked}`)
