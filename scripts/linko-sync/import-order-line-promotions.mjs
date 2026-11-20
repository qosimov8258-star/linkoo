// The promotion of each copied order line (order_items.promotion): Linko's order_product.promotion.name, set on the
// bonus lines a promotion added. The order's «Изменит серии» shows it as «Акция: <name>» under the line in its
// «Наименование» picker (lib/order-series-repo.ts). Lines are matched by order_items.linko_order_product_id (run
// import-return-order-lines.mjs first); a line Linko gives no promotion is set to "". Every change is registered in
// linko_sync_rows with the previous value. --dry-run prints the changes and writes nothing.
//
//   node scripts/linko-sync/import-order-line-promotions.mjs [--dry-run]   (raw: order_products)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const DRY = process.argv.includes("--dry-run")
const run = runId("order-line-promotions")

// Linko's promotion name per order line id.
const wanted = new Map()
for (const line of raw("order_products")) {
  const id = Number(line?.id)
  if (!Number.isSafeInteger(id) || id <= 0) continue
  wanted.set(id, String(line.promotion?.name ?? "").trim())
}

const client = await connect()
const stats = { set: 0, same: 0, unmatched: 0 }
try {
  await client.query("BEGIN")
  await ensureRegistry(client)
  await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS promotion TEXT NOT NULL DEFAULT ''")
  const have = (await client.query("SELECT id, linko_order_product_id, promotion FROM order_items WHERE linko_order_product_id = ANY($1::int[])", [[...wanted.keys()]])).rows
  const byLinko = new Map(have.map((row) => [Number(row.linko_order_product_id), row]))
  for (const [linkoId, promotion] of wanted) {
    const row = byLinko.get(linkoId)
    if (!row) {
      stats.unmatched++
      continue
    }
    if ((row.promotion ?? "") === promotion) {
      stats.same++
      continue
    }
    if (DRY) console.log(`order_items ${row.id} (Linko line ${linkoId}): ${JSON.stringify(row.promotion ?? "")} → ${JSON.stringify(promotion)}`)
    else {
      await client.query("UPDATE order_items SET promotion = $2 WHERE id = $1", [row.id, promotion])
      await register(client, run, "order_items", row.id, "update", { promotion: row.promotion ?? "" })
    }
    stats.set++
  }
  await client.query(DRY ? "ROLLBACK" : "COMMIT")
  console.log(JSON.stringify({ dryRun: DRY, ...stats }))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
