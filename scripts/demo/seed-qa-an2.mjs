// DEMO data for the QA pass over "Аналитика" (domain 'qa-an2'). INSERT-only and idempotent; every inserted row is
// registered in demo_seed_rows so scripts/demo/rollback-qa-an2.mjs removes exactly these rows.
// Usage: node scripts/demo/seed-qa-an2.mjs   (reads DATABASE_URL from .env)
//
//   fund-requests:v1       The 17 supplier fund requests of the reference "Ожидаемые расходы" (supplier_balance_transactions, kind fund_request).
//   stock-compensation:v1  The stock ledger now reads the warehouse an order shipped from (orders.stock_name), so every sold
//                          product leaves its warehouse. One accepted supply per warehouse (dated before the first order)
//                          brings the stock back above zero so the stock pages stay consistent.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "qa-an2"
const client = new pg.Client({ connectionString: url })
await client.connect()
const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)

await client.query("BEGIN")
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const seeded = async (marker) => (await q("SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = '_marker' AND row_id = $2", [DOMAIN, marker])).length > 0
  const mark = (marker) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [marker, DOMAIN])
  const counts = {}
  const insert = async (table, row) => {
    const columns = Object.keys(row)
    const result = await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, columns.map((c) => row[c]))
    const id = result.rows[0].id
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
    counts[table] = (counts[table] ?? 0) + 1
    return id
  }

  if (!(await seeded("stock-compensation:v1"))) {
    const sold = await q(
      `SELECT btrim(o.stock_name) AS warehouse, oi.product_name AS product, SUM(COALESCE(oi.quantity, 0)) AS qty,
              AVG(NULLIF(oi.cost_price, 0)) AS cost
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status IN ('В пути', 'Доставлено', 'Есть на складе') AND btrim(COALESCE(o.stock_name, '')) <> '' AND btrim(COALESCE(oi.product_name, '')) <> ''
        GROUP BY 1, 2 ORDER BY 1, 2`,
    )
    const byWarehouse = new Map()
    for (const row of sold) {
      if (!byWarehouse.has(row.warehouse)) byWarehouse.set(row.warehouse, [])
      byWarehouse.get(row.warehouse).push(row)
    }
    for (const [warehouse, lines] of byWarehouse) {
      const items = lines.map((line, index) => {
        const qty = Math.ceil(Number(line.qty) * 1.25) + 10
        const cost = Math.round(Number(line.cost) || 1000)
        return { id: index + 1, product: line.product, expiry: "", qty, block: 0, kg: 0, netWeight: 0, cost, total: qty * cost }
      })
      const amount = items.reduce((sum, item) => sum + item.total, 0)
      await insert("supplier_incomings", {
        supplier: "Поставщик",
        warehouse,
        date: "1 сент. 2024",
        payment_type: "Банковский счет",
        contract_number: "",
        amount,
        status: "принят",
        invoice_number: "",
        organization: "",
        branch: "",
        phone: "Не указан",
        email: "Не указан",
        initiator: "Admin Ritm",
        paid: amount,
        time: "",
        comment: "",
        items: JSON.stringify(items),
        created_at: "2024-09-01 09:00:00",
        updated_at: "2024-09-01 09:00:00",
      })
    }
    await mark("stock-compensation:v1")
  }

  if (!(await seeded("fund-requests:v1"))) {
    // The 17 "Ожидаемые расходы" of the reference (GET finance/money_request/, read-only): supplier requests with their status.
    const requests = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/qa-an2-expected-expenses.json"), "utf8"))
    for (const request of requests.slice().sort((a, b) => a.id - b.id)) {
      const [supplier] = await q("SELECT id FROM suppliers WHERE name = $1 ORDER BY id LIMIT 1", [request.supplier])
      if (!supplier) continue
      const closed = request.status === "approved" || request.status === "given"
      await insert("supplier_balance_transactions", {
        supplier_id: supplier.id,
        kind: "fund_request",
        currency: request.currency,
        amount: request.amount,
        date: request.created.slice(0, 10),
        comment: request.comment,
        created_at: request.created,
        payment_type: "",
        organization: "",
        branch: "",
        created_by: "Admin Ritm",
        status: request.status,
        updated_at: request.created,
        responsible_user: "Admin Ritm",
        approved_at: closed ? request.created : "",
        payment_id: null,
        log: "[]",
      })
    }
    await mark("fund-requests:v1")
  }

  if (!(await seeded("loyalty:v1"))) {
    // Reference "Накопительная карта": ТЕСТОВЫЙ КЛИЕНТ 1 holds 1 000 000 SUM (the client HANGUK with 6 000 000 does not exist locally).
    const [client] = await q("SELECT id FROM clients WHERE name = 'ТЕСТОВЫЙ КЛИЕНТ 1' ORDER BY id LIMIT 1")
    if (client) {
      await insert("loyalty_card_transactions", {
        client_id: client.id,
        currency: "sum",
        amount: 1000000,
        comment: "",
        created_at: "2026-04-01 10:00:00",
        type: "additional",
        created_by: "Admin Ritm",
      })
    }
    await mark("loyalty:v1")
  }

  if (!(await seeded("stock-compensation:v2"))) {
    // Two products stayed slightly negative in "Центральный склад" (documents that predate the order-based stock): top them up.
    const items = [
      { id: 1, product: "baklashka qopqog'i", expiry: "", qty: 100, block: 0, kg: 0, netWeight: 0, cost: 1000, total: 100000 },
      { id: 2, product: "baklashka salafani 2", expiry: "", qty: 100, block: 0, kg: 0, netWeight: 0, cost: 1000, total: 100000 },
    ]
    await insert("supplier_incomings", {
      supplier: "Поставщик", warehouse: "Центральный склад", date: "1 сент. 2024", payment_type: "Банковский счет", contract_number: "",
      amount: 200000, status: "принят", invoice_number: "", organization: "", branch: "", phone: "Не указан", email: "Не указан",
      initiator: "Admin Ritm", paid: 200000, time: "", comment: "", items: JSON.stringify(items),
      created_at: "2024-09-01 09:05:00", updated_at: "2024-09-01 09:05:00",
    })
    await mark("stock-compensation:v2")
  }

  if (!(await seeded("loyalty:v2"))) {
    // All 19 non-zero balances of the reference "Накопительная карта" (GET sales/cash_back/, read-only), matched to local clients by name;
    // reference clients that do not exist locally (the reference lists 4306 clients, locally 4293) are skipped.
    const entries = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/qa-an2-loyalty.json"), "utf8"))
    for (const entry of entries) {
      const [match] = await q("SELECT id FROM clients WHERE name = $1 ORDER BY id LIMIT 1", [entry.name])
      if (!match) continue
      for (const [code, amount] of Object.entries(entry.balances)) {
        const currency = code.toLowerCase()
        const [have] = await q("SELECT 1 FROM loyalty_card_transactions WHERE client_id = $1 AND currency = $2 LIMIT 1", [match.id, currency])
        if (have) continue
        await insert("loyalty_card_transactions", {
          client_id: match.id, currency, amount, comment: "", created_at: String(entry.last).slice(0, 19).replace("T", " "), type: "additional", created_by: "Admin Ritm",
        })
      }
    }
    await mark("loyalty:v2")
  }

  await client.query("COMMIT")
  console.log("inserted", JSON.stringify(counts))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
