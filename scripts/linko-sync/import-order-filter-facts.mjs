// Продажи → Заказы, «Показать фильтр»: the order and product facts Linko's order filter reads that the earlier imports
// did not copy.
// - orders.with_discount: Linko's order with_discount (a manual discount: with no promotion applied, Linko's «Тип акции»
//   = «Скидочная» lists an order with_discount and a discount percent above 0).
// - orders.is_new: Linko's order is_new («Только новые», is_new=True).
// - orders.collector_id: Linko's order collector («Сборщик», an employee id).
// - orders.service_shipment_status: Linko's EDO shipment status (the list's blue «Заполнено» icon for "filled").
// - products: Linko's use_mark → marked_product («Есть маркированный товар»), and the type / brand of deleted products
//   Linko still names on orders (the order filter's «Тип товара» / «Бренд» match an order by its lines' products).
// Sources: the full download (orders_detail, orders) and, when present, the newer read-only captures of
// backups/linko-raw/2026-11-20/sales-orders-list (ids-linko.json: the whole order list; order-details.json: order
// details; product-details.json: main/product/<id>/; with RAW=<folder> only <RAW>/sales-orders-list, and none when it
// is not there). The newest value wins. Every change is registered in
// linko_sync_rows with the previous value, like the other importers.
//
//   node scripts/linko-sync/import-order-filter-facts.mjs   (raw: orders_detail, orders)
import fs from "node:fs"
import path from "node:path"

import { captured, connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("order-filter-facts")
// LIVE_DIR, else <RAW>/sales-orders-list (with RAW nothing outside it), else the first account's capture of 2026-11-20.
const LIVE = captured("sales-orders-list", { env: "LIVE_DIR", legacy: "2026-11-20/sales-orders-list" })
if (!LIVE) console.log("skipped: sales-orders-list not in RAW (only the full download is read)")
const live = (name) => {
  if (!LIVE) return null
  const file = path.join(LIVE, name)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
}

/** Order facts by id: { withDiscount, isNew, collector } (undefined = not known). */
const orders = new Map()
const fact = (id) => {
  const key = Number(id)
  if (!orders.has(key)) orders.set(key, {})
  return orders.get(key)
}
/** Product facts by id: { useMark, type, brand }. */
const products = new Map()
const product = (id) => {
  const key = Number(id)
  if (!products.has(key)) products.set(key, {})
  return products.get(key)
}
const noteProduct = (p) => {
  if (!p || typeof p !== "object" || !p.id) return
  if (typeof p.use_mark === "boolean") product(p.id).useMark = (product(p.id).useMark ?? false) || p.use_mark
}

const noteDetail = (doc) => {
  if (!doc || !doc.id) return
  const f = fact(doc.id)
  if (typeof doc.with_discount === "boolean") f.withDiscount = doc.with_discount
  if ("collector" in doc) f.collector = doc.collector?.id ?? null
  if (typeof doc.is_new === "boolean") f.isNew = doc.is_new
  for (const line of doc.products ?? []) noteProduct(line.product)
}

for (const doc of Object.values(raw("orders_detail"))) noteDetail(doc)
const noteListRow = (row) => {
  if (!row?.id) return
  if (typeof row.is_new === "boolean") fact(row.id).isNew = row.is_new
  if ("service_shipment_status" in row) fact(row.id).shipment = row.service_shipment_status ?? ""
}
if (hasRaw("orders")) for (const row of raw("orders")) noteListRow(row)
if (hasRaw("supplies_detail")) for (const doc of Object.values(raw("supplies_detail"))) for (const line of doc?.products ?? []) noteProduct(line.product)

const liveList = live("ids-linko.json")?.["status=&exclude=true"]
if (Array.isArray(liveList)) for (const row of liveList) noteListRow(row)
for (const doc of Object.values(live("order-details.json") ?? {})) noteDetail(doc)
for (const p of Object.values(live("product-details.json") ?? {})) {
  if (!p?.id) continue
  const f = product(p.id)
  if (typeof p.use_mark === "boolean") f.useMark = p.use_mark
  if (p.is_delete) {
    f.type = p.type?.name ?? null
    f.brand = p.brand?.name ?? null
  }
}

const client = await connect()
await ensureRegistry(client)
const stats = { withDiscount: 0, isNew: 0, collector: 0, shipment: 0, marked: 0, type: 0, brand: 0, missingOrders: 0 }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS with_discount INTEGER NOT NULL DEFAULT 0")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_new INTEGER NOT NULL DEFAULT 0")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS collector_id INTEGER")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_shipment_status TEXT NOT NULL DEFAULT ''")
  const known = new Map((await client.query("SELECT id, with_discount, is_new, collector_id, service_shipment_status FROM orders")).rows.map((row) => [row.id, row]))
  for (const [id, f] of orders) {
    const row = known.get(id)
    if (!row) {
      stats.missingOrders++
      continue
    }
    const next = {
      with_discount: f.withDiscount === undefined ? row.with_discount : f.withDiscount ? 1 : 0,
      is_new: f.isNew === undefined ? row.is_new : f.isNew ? 1 : 0,
      collector_id: f.collector === undefined ? row.collector_id : f.collector,
      service_shipment_status: f.shipment === undefined ? row.service_shipment_status : f.shipment,
    }
    const changed = Object.keys(next).filter((key) => (next[key] ?? null) !== (row[key] ?? null))
    if (!changed.length) continue
    await client.query("UPDATE orders SET with_discount = $2, is_new = $3, collector_id = $4, service_shipment_status = $5 WHERE id = $1", [id, next.with_discount, next.is_new, next.collector_id, next.service_shipment_status])
    await register(client, run, "orders", id, "update", Object.fromEntries(changed.map((key) => [key, row[key]])))
    if (changed.includes("with_discount")) stats.withDiscount++
    if (changed.includes("is_new")) stats.isNew++
    if (changed.includes("collector_id")) stats.collector++
    if (changed.includes("service_shipment_status")) stats.shipment++
  }

  const productRows = new Map(
    (await client.query("SELECT id, COALESCE(marked_product, 0) AS marked_product, COALESCE(type, '') AS type, COALESCE(brand, '') AS brand, COALESCE(deleted, 0) AS deleted FROM products WHERE id = ANY($1::int[])", [[...products.keys()]])).rows.map((row) => [row.id, row]),
  )
  for (const [id, f] of products) {
    const row = productRows.get(id)
    if (!row) continue
    const previous = {}
    if (f.useMark !== undefined && Number(row.marked_product) !== (f.useMark ? 1 : 0)) {
      await client.query("UPDATE products SET marked_product = $2 WHERE id = $1", [id, f.useMark ? 1 : 0])
      previous.marked_product = row.marked_product
      stats.marked++
    }
    // Deleted products only: Linko's type / brand where the copy has none (an empty type, the default «No brand»).
    if (Number(row.deleted) === 1 && f.type && !row.type) {
      await client.query("UPDATE products SET type = $2 WHERE id = $1", [id, f.type])
      previous.type = row.type
      stats.type++
    }
    if (Number(row.deleted) === 1 && f.brand && (!row.brand || row.brand === "No brand") && row.brand !== f.brand) {
      await client.query("UPDATE products SET brand = $2 WHERE id = $1", [id, f.brand])
      previous.brand = row.brand
      stats.brand++
    }
    if (Object.keys(previous).length) await register(client, run, "products", id, "update", previous)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`order filter facts: ${JSON.stringify(stats)} (run ${run})`)
