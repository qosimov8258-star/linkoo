// Fills what the "Долги с заказов" page needs from the reference app's debt endpoints:
//   node scripts/backfill-order-debts-from-reference.mjs <debt-list.json> <debtors-stats.json>
// <debt-list.json>   concatenated `results` of GET /api/v1/sales/order/debt_list/?status=2-3&debt=true
// <debtors-stats.json> the body of GET /api/v1/stats/debtors_stats/ (only wrong_debt_client_ids is used)
// Per order it stores the client's balance per currency (the "Общий долг" columns), the demo's client and market ids
// (clients that share a spelling stay apart; the "Клиенты" tab lists markets) and the remainder (total_balance); the demo's "Требуется перерасчет" clients go to order_debt_settings.
import fs from "node:fs"
import pg from "pg"

const [listFile, statsFile] = process.argv.slice(2)
if (!listFile) throw new Error("Usage: node scripts/backfill-order-debts-from-reference.mjs <debt-list.json> [debtors-stats.json]")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const orders = JSON.parse(fs.readFileSync(listFile, "utf8"))
const stats = statsFile ? JSON.parse(fs.readFileSync(statsFile, "utf8")) : null
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")
await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS debt_client_balances TEXT NOT NULL DEFAULT ''")
await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS debt_client_id INTEGER")
await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS debt_market_id INTEGER")
await client.query("UPDATE orders SET debt_client_balances = '', debt_client_id = NULL, debt_market_id = NULL")
let updated = 0
for (const order of orders) {
  const balances = (order.currencies ?? []).map((item) => ({ currency: item.name, amount: Number(item.balance) }))
  const result = await client.query("UPDATE orders SET debt_client_balances = $2, order_balance = $3, debt_client_id = $4, debt_market_id = $5 WHERE id = $1", [order.id, JSON.stringify(balances), Number(order.total_balance), order.client?.id ?? null, order.market?.id ?? null])
  updated += result.rowCount
}
if (stats?.wrong_debt_client_ids) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS order_debt_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')))`,
  )
  await client.query(
    `INSERT INTO order_debt_settings (key, value, updated_by) VALUES ('wrong_debt_client_ids', $1, 'reference')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(stats.wrong_debt_client_ids)],
  )
}
await client.query("COMMIT")
await client.end()
console.log(`updated ${updated} of ${orders.length} orders`)
