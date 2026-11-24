// The returned quantity of each order line (order_items.return_quantity: the order card's and the order dialog's
// «10 [-5] Dona», the reports' net quantities) as Linko counts it now. import-orders.mjs copies it from the full
// download (order_products.return_amount); a return Linko cancelled after that download leaves the copy one return
// ahead (order 1561: 2 there, 1 in Linko since its second return was cancelled). This step reads the order cards
// captured later with the read-only harness (Linko's sales/order/{id}/ answers, files sales_order_<id>_.json under
// backups/linko-raw/<date>/…, or only those inside RAW=<folder>, the newest capture of an order wins; skipped when RAW
// holds none) and sets each copied line (matched by
// order_items.linko_order_product_id, else by the only line of that product) to Linko's return_amount.
// Every change is registered in linko_sync_rows with the previous value. --dry-run prints the changes and writes nothing.
//
//   node scripts/linko-sync/import-order-line-returns.mjs [--dry-run]
import fs from "node:fs"
import path from "node:path"

import { ROOT, captureRoots, connect, ensureRegistry, register, runId, skipUnlessInRaw } from "./lib.mjs"

const DRY = process.argv.includes("--dry-run")
const run = runId("order-line-returns")
const FILE = /^sales_order_(\d+)_\.json$/

/** Map(order id → { file, body }) of the newest capture of each order (by date folder, then file time). With RAW set only
 * the captures inside RAW are read, else those of every backups/linko-raw/<date>. */
function readCaptures() {
  const found = new Map()
  const walk = (dir, day) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, day)
      else {
        const match = FILE.exec(entry.name)
        if (!match) continue
        const time = fs.statSync(full).mtimeMs
        const before = found.get(Number(match[1]))
        if (before && (before.day > day || (before.day === day && before.time >= time))) continue
        found.set(Number(match[1]), { day, time, file: full })
      }
    }
  }
  for (const { dir, day } of captureRoots()) walk(dir, day)
  const orders = new Map()
  for (const [id, entry] of found) {
    try {
      const body = JSON.parse(fs.readFileSync(entry.file, "utf8"))
      if (Number(body?.id) === id && Array.isArray(body.products)) orders.set(id, { file: path.relative(ROOT, entry.file), body })
    } catch {
      // A capture that is not an order card (an error page, a cut file) is skipped.
    }
  }
  return orders
}

const captures = readCaptures()
if (!captures.size) skipUnlessInRaw(null, "sales_order_<id>_.json")
const client = await connect()
await ensureRegistry(client)
const stats = { orders: captures.size, missingOrders: [], unmatched: [], same: 0, changed: [] }
try {
  await client.query("BEGIN")
  const hasLinkoLine = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'order_items' AND column_name = 'linko_order_product_id'")).rowCount > 0
  for (const [orderId, { body }] of captures) {
    const lines = (await client.query(`SELECT id, product_id, ${hasLinkoLine ? "linko_order_product_id" : "NULL AS linko_order_product_id"}, COALESCE(return_quantity, 0) AS return_quantity FROM order_items WHERE order_id = $1 ORDER BY id`, [orderId])).rows
    if (!lines.length) {
      stats.missingOrders.push(orderId)
      continue
    }
    for (const product of body.products) {
      const want = Number(product.return_amount) || 0
      const productId = Number(product.product?.id ?? product.product_id)
      const byLinko = lines.find((line) => line.linko_order_product_id !== null && Number(line.linko_order_product_id) === Number(product.id))
      const sameProduct = lines.filter((line) => Number(line.product_id) === productId)
      const line = byLinko ?? (sameProduct.length === 1 ? sameProduct[0] : null)
      if (!line) {
        stats.unmatched.push(`${orderId}:${product.id}`)
        continue
      }
      const have = Number(line.return_quantity)
      if (Math.abs(have - want) <= 1e-9) {
        stats.same++
        continue
      }
      stats.changed.push(`${orderId}:${line.id} ${have} → ${want}`)
      if (DRY) continue
      await client.query("UPDATE order_items SET return_quantity = $2 WHERE id = $1", [line.id, want])
      await register(client, run, "order_items", line.id, "update", { return_quantity: have })
    }
  }
  await client.query(DRY ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `order line returns${DRY ? " (dry run)" : ""}: ${stats.orders} captured orders, lines same ${stats.same}, changed ${stats.changed.length}` +
    `${stats.changed.length ? ` [${stats.changed.join("; ")}]` : ""}, unmatched ${stats.unmatched.length}${stats.unmatched.length ? ` [${stats.unmatched.join(", ")}]` : ""}` +
    `, orders not here ${stats.missingOrders.length}`,
)
