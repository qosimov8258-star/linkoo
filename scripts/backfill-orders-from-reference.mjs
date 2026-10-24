// Fills the extra order columns (and fixes status labels) from the reference app's
// /sales/order/ API dump. Usage:
//   node scripts/backfill-orders-from-reference.mjs <orders.json> [order-details.json]
// <orders.json> is the concatenated `results` array of GET /api/v1/sales/order/?page_size=100;
// <order-details.json> (optional) holds the branch / warehouse / price list / debts taken from GET /sales/order/<id>/.
import fs from "node:fs"
import pg from "pg"

const [file, detailFile] = process.argv.slice(2)
if (!file) throw new Error("Usage: node scripts/backfill-orders-from-reference.mjs <orders.json>")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

// Reference status codes: 0 В процессе, 1 Есть на складе, 2 Передан доставщику, 3 Доставлен, 4 Отменен, 5 Не подтвержден.
const STATUS = { 0: "В процессе", 1: "Есть на складе", 2: "В пути", 3: "Доставлено", 4: "Отменен", 5: "Не подтвержден" }

const orders = JSON.parse(fs.readFileSync(file, "utf8"))
const details = new Map((detailFile ? JSON.parse(fs.readFileSync(detailFile, "utf8")) : []).filter((row) => !row.error).map((row) => [row.id, row]))
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")
let updated = 0
for (const order of orders) {
  const person = (user) => (user ? `${user.first_name ?? ""} ${user.second_name ?? ""}`.trim() : "")
  const result = await client.query(
    `UPDATE orders SET status = $2, market_name = $3, delivery_man = $4, expeditor = $5, accepted_date = $6,
       total_price = $7, return_price = $8, fact_price = $9, weight = $10, discount_percent = $11,
       pay_method = $12, order_balance = $13, invoice_active = $14, transport_number = $15, due_date = $16
     WHERE id = $1`,
    [
      order.id,
      STATUS[order.status] ?? "Есть на складе",
      order.market?.name ?? order.client?.name ?? "",
      person(order.delivery_man),
      person(order.expeditor),
      order.accepted_time ? order.accepted_time.slice(0, 10) : "",
      Number(order.total_price),
      Number(order.total_return_price),
      Number(order.fact_price),
      Number(order.total_weight ?? 0),
      Number(order.discount_percent ?? 0),
      order.custom_payment_type?.type ?? order.payment_type ?? "",
      Number(order.total_balance),
      order.invoice_is_active ? 1 : 0,
      order.transport?.number ?? "",
      order.payment_date ?? "",
    ],
  )
  const detail = details.get(order.id)
  if (detail) {
    await client.query(
      `UPDATE orders SET branch_name = $2, stock_name = $3, price_list = $4, paid_amount = $5, operative_debt = $6,
         actual_debt = $7, deal_type = $8, delivery_type = $9, pay_type_name = $10, wrong_debt = $11
       WHERE id = $1`,
      [
        order.id,
        detail.branch?.name ?? "",
        detail.stock?.name ?? "",
        detail.price_list?.name ?? "",
        Number(detail.total_paid ?? 0),
        Number(detail.total_balance_client ?? 0),
        Number(detail.market_accepted_balance?.[0]?.amount ?? 0),
        String(detail.deal_type ?? ""),
        detail.delivery_type ?? "",
        ({ cash: "Наличные", bank: "Перечисление" })[detail.custom_payment_type?.name] ?? detail.custom_payment_type?.name ?? "",
        detail.is_wrong_debt ? 1 : 0,
      ],
    )
  }
  updated += result.rowCount
}
await client.query("COMMIT")
await client.end()
console.log(`updated ${updated} of ${orders.length} orders`)
