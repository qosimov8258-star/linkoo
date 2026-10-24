// Loads the reference app's order history (GET /sales/order_logs/ and /sales/order/<id>/products_logs/) into
// the order_logs table the "Логи" tab and "Детали изменений заказа" read. Usage:
//   node scripts/backfill-order-logs-from-reference.mjs <logs.json> <products-logs.json>
// <logs.json> is an array of { id, at, action, status, comment, price, by, order, cur }; <products-logs.json> maps
// an order id to { products: [{ product: { id, name }, logs: [{ order_log, amount, price, total_price }] }],
// order_logs: [{ id, market, cpt }] }. Entries already imported (same reference id) are left alone.
import fs from "node:fs"
import pg from "pg"

const [logsFile, productLogsFile] = process.argv.slice(2)
if (!logsFile || !productLogsFile) throw new Error("Usage: node scripts/backfill-order-logs-from-reference.mjs <logs.json> <products-logs.json>")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const logs = JSON.parse(fs.readFileSync(logsFile, "utf8"))
const productLogs = JSON.parse(fs.readFileSync(productLogsFile, "utf8"))

// market / payment-type name per log, and the product lines each log changed
const meta = new Map()
const snapshots = new Map()
for (const entry of Object.values(productLogs)) {
  for (const log of entry.order_logs ?? []) meta.set(log.id, log)
  for (const product of entry.products ?? []) {
    for (const line of product.logs ?? []) {
      const lines = snapshots.get(line.order_log) ?? []
      lines.push({ productId: product.product?.id ?? null, name: product.product?.name ?? "", amount: Number(line.amount), price: Number(line.price), total: Number(line.total_price) })
      snapshots.set(line.order_log, lines)
    }
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")
await client.query(`
  CREATE TABLE IF NOT EXISTS order_logs (
    id SERIAL PRIMARY KEY,
    ref_id INTEGER UNIQUE,
    order_id INTEGER NOT NULL,
    action TEXT NOT NULL DEFAULT 'updated',
    status TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'SUM',
    pay_type_name TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    market_name TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS order_logs_order_idx ON order_logs (order_id);
`)
const known = new Set((await client.query("SELECT id FROM orders")).rows.map((row) => row.id))
let inserted = 0
for (const log of logs) {
  if (!known.has(log.order)) continue
  const extra = meta.get(log.id)
  const result = await client.query(
    `INSERT INTO order_logs (ref_id, order_id, action, status, comment, total_price, currency, pay_type_name, created_by, created_at, market_name, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (ref_id) DO NOTHING`,
    [
      log.id,
      log.order,
      log.action,
      String(log.status ?? ""),
      log.comment ?? "",
      Number(log.price ?? 0),
      log.cur ?? "SUM",
      extra?.cpt ?? log.pay ?? "",
      log.by ?? "",
      String(log.at).slice(0, 19),
      extra?.market ?? "",
      JSON.stringify(snapshots.get(log.id) ?? []),
    ],
  )
  inserted += result.rowCount
}
await client.query("COMMIT")
await client.end()
console.log(`inserted ${inserted} of ${logs.length} log entries`)
