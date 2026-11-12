// Продукты / Сырье: what the first copy left out of the catalog.
//
// 1. Linko's raw materials (products_raw: main/product/?is_raw=true) are products in Linko and stay stock items of the
//    products table here (their stock is keyed "product:<id>"), but Linko's Продукты page lists only is_raw=false
//    (757 of 805): they get products.is_raw = 1, which that page leaves out; Сырье lists them (raw_materials).
// 2. The box (Linko's boxes[0]: «блок» = 12 шт) — the catalog shows it as Мера «блок / 12 шт»: products.product_group
//    (the catalog's box name), box_unit (the orders' one) and box_amount; raw_materials.product_group and box_amount.
// 3. raw_materials.order_number from Linko's stock_number («Порядковый номер»), when empty here.
//
//   node scripts/linko-sync/import-product-boxes.mjs
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("product-boxes")
const key = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
const products = raw("products")
const rawItems = raw("products_raw")
const rawIds = new Set(rawItems.map((item) => Number(item.id)))
const stats = { isRaw: 0, productBoxes: 0, rawBoxes: 0, rawOrder: 0, rawMissing: [] }

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_raw INTEGER NOT NULL DEFAULT 0")
  const local = new Map(
    (await client.query("SELECT id, is_raw, COALESCE(product_group, '') AS product_group, COALESCE(box_unit, '') AS box_unit, COALESCE(box_amount, 0) AS box_amount FROM products")).rows.map(
      (row) => [Number(row.id), row],
    ),
  )
  for (const product of products) {
    const row = local.get(Number(product.id))
    if (!row) continue
    const isRaw = rawIds.has(Number(product.id)) ? 1 : 0
    if (Number(row.is_raw) !== isRaw) {
      await client.query("UPDATE products SET is_raw = $1 WHERE id = $2", [isRaw, product.id])
      await register(client, run, "products", product.id, "update", { is_raw: Number(row.is_raw) })
      stats.isRaw++
    }
    const box = (product.boxes ?? [])[0]
    const name = String(box?.measurement?.name ?? "").trim()
    const amount = Number(box?.amount ?? 0)
    if (!box || !name || !(amount > 0)) continue
    const next = {
      product_group: row.product_group || name,
      box_unit: row.box_unit || name,
      box_amount: Number(row.box_amount) > 0 ? Number(row.box_amount) : amount,
    }
    if (next.product_group === row.product_group && next.box_unit === row.box_unit && next.box_amount === Number(row.box_amount)) continue
    await client.query("UPDATE products SET product_group = $1, box_unit = $2, box_amount = $3 WHERE id = $4", [next.product_group, next.box_unit, next.box_amount, product.id])
    await register(client, run, "products", product.id, "update", { product_group: row.product_group, box_unit: row.box_unit, box_amount: Number(row.box_amount) })
    stats.productBoxes++
  }

  // raw_materials: the same items under their own ids, matched by name (and unit when two share a name).
  const rawRows = (await client.query("SELECT id, name, unit, COALESCE(product_group, '') AS product_group, COALESCE(box_amount, 0) AS box_amount, COALESCE(order_number, '') AS order_number FROM raw_materials")).rows
  for (const item of rawItems) {
    const candidates = rawRows.filter((row) => key(row.name) === key(item.name))
    const row = candidates.find((candidate) => key(candidate.unit) === key(item.measurement?.name)) ?? candidates[0]
    if (!row) {
      stats.rawMissing.push(item.id)
      continue
    }
    const box = (item.boxes ?? [])[0]
    const name = String(box?.measurement?.name ?? "").trim()
    const amount = Number(box?.amount ?? 0)
    const next = {
      product_group: row.product_group || (box && amount > 0 ? name : ""),
      box_amount: Number(row.box_amount) > 0 ? Number(row.box_amount) : box && amount > 0 ? amount : 0,
      order_number: String(row.order_number).trim() || (item.stock_number === null || item.stock_number === undefined ? "" : String(item.stock_number)),
    }
    if (next.product_group === row.product_group && next.box_amount === Number(row.box_amount) && next.order_number === String(row.order_number)) continue
    await client.query("UPDATE raw_materials SET product_group = $1, box_amount = $2, order_number = $3 WHERE id = $4", [next.product_group, next.box_amount, next.order_number, row.id])
    await register(client, run, "raw_materials", row.id, "update", { product_group: row.product_group, box_amount: Number(row.box_amount), order_number: row.order_number })
    if (next.product_group !== row.product_group || next.box_amount !== Number(row.box_amount)) stats.rawBoxes++
    if (next.order_number !== String(row.order_number)) stats.rawOrder++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `product boxes: ${stats.isRaw} is_raw set, ${stats.productBoxes} products got their box, ${stats.rawBoxes} raw materials their box, ${stats.rawOrder} their «Порядковый номер»; raw materials missing here: ${stats.rawMissing.join(",") || "none"}`,
)
