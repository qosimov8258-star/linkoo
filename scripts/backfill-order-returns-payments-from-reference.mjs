// Loads the order card's "Возврат" tab and "Список оплат по заказу" dialog from the reference app's
// GET sales/order_return/?order=<id> and GET sales/debt_transactions/?page_size=1000 responses ("Сумма" = from_transaction.amount,
// "На заказ" = to_amount, the description is the return number or the cashbox transaction number). Usage:
//   node scripts/backfill-order-returns-payments-from-reference.mjs <returns.json> <payments.json>
// <returns.json> is { "<orderId>": [order_return rows] }, <payments.json> is the debt_transactions response.
// INSERT-only (ON CONFLICT DO NOTHING); every inserted row is registered in demo_seed_rows (domain 'orders-extra2').
import fs from "node:fs"
import pg from "pg"

const [returnsFile, paymentsFile] = process.argv.slice(2)
if (!returnsFile || !paymentsFile) throw new Error("Usage: node scripts/backfill-order-returns-payments-from-reference.mjs <returns.json> <payments.json>")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const returns = JSON.parse(fs.readFileSync(returnsFile, "utf8"))
const payments = JSON.parse(fs.readFileSync(paymentsFile, "utf8")).results ?? []
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")

await client.query(`
  CREATE TABLE IF NOT EXISTS order_return_docs (
    id integer PRIMARY KEY, order_id integer NOT NULL, created_date text, accepted_date text, warehouse text,
    total_price real, currency text, status text, reason text, comment text, created_by text);
  CREATE TABLE IF NOT EXISTS order_payment_rows (
    id integer PRIMARY KEY, order_id integer NOT NULL, created_date text, client text, user_name text, kind integer,
    return_id integer, tx_id integer, payment_type text, comment text, amount real, order_amount real, currency text);
  CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)

const person = (user) => (user ? `${user.first_name ?? ""} ${user.second_name ?? ""}`.trim() : "")
let docs = 0
let links = 0

for (const [orderId, rows] of Object.entries(returns)) {
  for (const row of rows) {
    const result = await client.query(
      `INSERT INTO order_return_docs (id, order_id, created_date, accepted_date, warehouse, total_price, currency, status, reason, comment, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [row.id, Number(orderId), row.created_date, row.accepted_date ?? row.accepted_time ?? null, row.stock?.name ?? "", Number(row.total_price), row.currency?.name ?? "SUM", String(row.status ?? "0"), row.reason ?? "", row.comment ?? "", person(row.created_by)],
    )
    if (result.rowCount) {
      docs += 1
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('order_return_docs', $1, 'orders-extra2')", [String(row.id)])
    }
  }
}

for (const row of payments) {
  const from = row.from_transaction ?? {}
  const to = row.to_transaction ?? {}
  const orderId = to.order ?? from.order
  if (!orderId) continue
  const result = await client.query(
    `INSERT INTO order_payment_rows (id, order_id, created_date, client, user_name, kind, return_id, tx_id, payment_type, comment, amount, order_amount, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
    [row.id, orderId, from.created_date, from.client?.name ?? "", person(from.user), from.type ?? 0, from.order_return ?? 0, from.transaction ?? 0, from.payment_type ?? "", from.comment ?? "", Number(from.amount), Number(row.to_amount ?? row.from_amount), from.currency?.name ?? "SUM"],
  )
  if (result.rowCount) {
    links += 1
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('order_payment_rows', $1, 'orders-extra2')", [String(row.id)])
  }
}

await client.query("COMMIT")
await client.end()
console.log(JSON.stringify({ returnDocs: docs, paymentLinks: links }))
