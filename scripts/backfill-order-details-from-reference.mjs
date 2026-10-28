// Fills the order-card details the first backfill could not (deal type, payment type name, invoice,
// per-currency debts, product block sizes and per-item returns) from the reference app's
// GET /sales/order/<id>/ responses. Usage:
//   node scripts/backfill-order-details-from-reference.mjs <order-details.json>
// <order-details.json> is an array of { id, deal_type, cpt, invoice_number, invoice_date, invoice_contract,
// invoice_is_active, tbe, mab, products: [{ pid, boxes, ret }] } rows taken from that API.
import fs from "node:fs"
import pg from "pg"

const [file] = process.argv.slice(2)
if (!file) throw new Error("Usage: node scripts/backfill-order-details-from-reference.mjs <order-details.json>")

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)

const details = JSON.parse(fs.readFileSync(file, "utf8")).filter((row) => !row.error)
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? env.DATABASE_URL })
await client.connect()
await client.query("BEGIN")

// Same columns lib/orders-repo.ts and lib/order-items-repo.ts add lazily.
await client.query(`
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_date TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_contract TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS operative_expand TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_expand TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS box_unit TEXT NOT NULL DEFAULT '';
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS return_quantity REAL NOT NULL DEFAULT 0;
`)

// null stays "" (unknown); an empty array is stored as "[]" because the card then shows no debt line at all.
const expand = (rows) => (Array.isArray(rows) ? JSON.stringify(rows.map((row) => ({ currency: row.currency_name, amount: Number(row.amount) }))) : "")

const boxes = new Map()
let orders = 0
let items = 0
for (const detail of details) {
  const result = await client.query(
    `UPDATE orders SET deal_type = $2, pay_type_name = $3, invoice_number = $4, invoice_date = $5, invoice_contract = $6,
       operative_expand = $7, actual_expand = $8
     WHERE id = $1`,
    [
      detail.id,
      String(detail.deal_type ?? ""),
      detail.cpt?.name ?? "",
      detail.invoice_number ?? "",
      detail.invoice_date ?? "",
      detail.invoice_contract ?? "",
      expand(detail.tbe),
      expand(detail.mab),
    ],
  )
  orders += result.rowCount

  const local = (await client.query("SELECT id, product_id FROM order_items WHERE order_id = $1 ORDER BY id", [detail.id])).rows
  detail.products.forEach((product) => {
    if (product.boxes?.length) boxes.set(product.pid, { amount: Number(product.boxes[0].amount), unit: product.boxes[0].measurement?.name ?? "" })
  })
  if (local.length === detail.products.length) {
    for (const [index, product] of detail.products.entries()) {
      if (local[index].product_id !== product.pid) continue
      const returned = Number(product.ret ?? 0)
      const update = await client.query("UPDATE order_items SET return_quantity = $2 WHERE id = $1", [local[index].id, returned])
      items += update.rowCount
    }
  }
}
for (const [productId, box] of boxes) {
  await client.query("UPDATE products SET box_amount = $2, box_unit = $3 WHERE id = $1", [productId, box.amount, box.unit])
}
await client.query("COMMIT")
await client.end()
console.log(`orders ${orders}, items ${items}, products with blocks ${boxes.size}`)
