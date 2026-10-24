// DEMO data for the QA pass over "Склад" (domain 'qa-sklad'). INSERT-only and idempotent; every inserted row is registered in
// demo_seed_rows so scripts/demo/rollback-qa-sklad.mjs removes exactly these rows.
// Usage: node scripts/demo/seed-qa-sklad.mjs   (reads DATABASE_URL from .env)
//
//   refimport:v1       Real rows of the reference that the local tables lack (read-only exports saved in scripts/demo/data/qa-sklad-*.json):
//                      48 write-offs (ids 18-69; ids 1-17 already exist locally with other content), 89 repricings (list level, no lines),
//                      102 stock inventories (list level, no lines; ids 1 and 3 exist locally) — the page counts then equal the reference.
//                      Finished write-offs take stock out of their warehouse, so one accepted supply per warehouse (1 сент. 2024)
//                      covers them (same compensation idea as negative-stock:v1).
//   raw-materials:v1   The 48 raw materials of the reference (scripts/demo/data/qa-sklad-raw-materials.json, read-only export) exist locally as
//                      plain `products` rows (805 - 48 = 757 = the reference product count). Each gets a raw_materials copy and a row in
//                      product_kind_overrides, which the catalog list and the stock ledger use to show the item as a raw material only.
//   negative-stock:v1  After the stock ledger started reading orders.stock_name and production consumption, 13 product/warehouse
//                      balances were still below zero (sales and raw-material use without a matching receipt). One accepted
//                      supply per warehouse (dated 1 сент. 2024, before every movement) brings them back above zero.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "qa-sklad"
// [warehouse, product, shortfall]: read from /api/stock/balances (per-warehouse total < 0).
const SHORTFALLS = [
  ["toshkent", "Банан СУЛТАНА КУК", 591],
  ["toshkent", "КАРОПКА   В 137", 7],
  ["сырия (000)", "Пакнар", 1],
  ["toshkent", "С1", 71],
  ["сырия (000)", "С2", 6],
  ["toshkent", "baklashka qopqog'i", 10],
  ["toshkent", "baklashka salafani 2", 1],
  ["Сырьё Склад", "Kotlet", 10],
  ["toshkent", "sndwch", 7],
  ["toshkent", "temir", 256],
  ["toshkent", "test1", 8.333333],
  ["Сырьё Склад", "toshkent suv", 0.5],
  ["Сырьё Склад", "Un", 11.5],
]

const client = new pg.Client({ connectionString: url })
await client.connect()
const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)
await client.query("BEGIN")
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const seeded = async (marker) => (await q("SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = '_marker' AND row_id = $2", [DOMAIN, marker])).length > 0
  let inserted = 0
  if (!(await seeded("negative-stock:v1"))) {
    const byWarehouse = new Map()
    for (const [warehouse, product, shortfall] of SHORTFALLS) {
      if (!byWarehouse.has(warehouse)) byWarehouse.set(warehouse, [])
      byWarehouse.get(warehouse).push({ product, qty: Math.ceil(shortfall * 1.25) + 10 })
    }
    for (const [warehouse, lines] of byWarehouse) {
      const items = lines.map((line, index) => ({ id: index + 1, product: line.product, expiry: "", qty: line.qty, block: 0, kg: 0, netWeight: 0, cost: 1000, total: line.qty * 1000 }))
      const amount = items.reduce((sum, item) => sum + item.total, 0)
      const row = {
        supplier: "Поставщик", warehouse, date: "1 сент. 2024", payment_type: "Банковский счет", contract_number: "", amount, status: "принят",
        invoice_number: "", organization: "", branch: "", phone: "Не указан", email: "Не указан", initiator: "Admin Ritm", paid: amount, time: "", comment: "",
        items: JSON.stringify(items), created_at: "2024-09-01 09:30:00", updated_at: "2024-09-01 09:30:00",
      }
      const columns = Object.keys(row)
      const result = await client.query(`INSERT INTO supplier_incomings (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, columns.map((c) => row[c]))
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('supplier_incomings', $1, $2)", [String(result.rows[0].id), DOMAIN])
      inserted++
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', 'negative-stock:v1', $1)", [DOMAIN])
  }
  if (!(await seeded("refimport:v1"))) {
    const data = (name) => JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data", name), "utf8"))
    const sqlTime = (iso) => String(iso).replace("T", " ").slice(0, 19)
    // The reference prints Tashkent wall-clock times; the app stores UTC and shows Tashkent (+5 h), so shift back by 5 hours.
    const utcTime = (iso) => new Date(Date.parse(`${String(iso).slice(0, 19)}Z`) - 5 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19)
    const register = (table, id) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
    const counts = { write_offs: 0, repricings: 0, stock_inventories: 0, compensation: 0 }

    // ---- write-offs
    const existing = new Set((await q("SELECT id FROM write_offs")).map((row) => Number(row.id)))
    const needed = new Map() // warehouse -> Map(product -> { qty, price })
    for (const doc of data("qa-sklad-write-offs.json")) {
      if (existing.has(doc.id)) continue
      const finished = doc.status === "finished"
      const items = doc.items.map((item, index) => ({ id: index + 1, key: `name:${item.product}`, product: item.product, code: item.code, unit: "", series: item.series, block: 0, qty: item.qty, cost: item.price, sum: Math.round(item.qty * item.price * 1e6) / 1e6 }))
      const stamp = sqlTime(doc.created)
      await client.query(
        `INSERT INTO write_offs (id, creator, warehouse, date, status, comment, reason, items, created_at, updated_at, finished_at, finished_by, cancelled_at, cancelled_by)
         VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $8, $9, $10, $11, $12)`,
        [doc.id, doc.creator, doc.warehouse, doc.created, finished ? "закрыт" : "отменен", doc.comment, JSON.stringify(items), stamp, finished ? stamp : "", finished ? doc.creator : "", finished ? "" : stamp, finished ? "" : doc.creator],
      )
      await register("write_offs", doc.id)
      counts.write_offs++
      if (finished) {
        if (!needed.has(doc.warehouse)) needed.set(doc.warehouse, new Map())
        const byProduct = needed.get(doc.warehouse)
        for (const item of doc.items) {
          const entry = byProduct.get(item.product) ?? { qty: 0, price: item.price || 1000 }
          entry.qty += item.qty
          byProduct.set(item.product, entry)
        }
      }
    }
    for (const [warehouse, byProduct] of needed) {
      const items = [...byProduct].map(([product, entry], index) => {
        const qty = Math.ceil(entry.qty * 1.25) + 10
        const cost = Math.round(entry.price) || 1000
        return { id: index + 1, product, expiry: "", qty, block: 0, kg: 0, netWeight: 0, cost, total: qty * cost }
      })
      const amount = items.reduce((sum, item) => sum + item.total, 0)
      const row = {
        supplier: "Поставщик", warehouse, date: "1 сент. 2024", payment_type: "Банковский счет", contract_number: "", amount, status: "принят",
        invoice_number: "", organization: "", branch: "", phone: "Не указан", email: "Не указан", initiator: "Admin Ritm", paid: amount, time: "", comment: "",
        items: JSON.stringify(items), created_at: "2024-09-01 09:45:00", updated_at: "2024-09-01 09:45:00",
      }
      const columns = Object.keys(row)
      const result = await client.query(`INSERT INTO supplier_incomings (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, columns.map((c) => row[c]))
      await register("supplier_incomings", result.rows[0].id)
      counts.compensation++
    }

    // ---- repricings (list level)
    const priceLists = new Map((await q("SELECT id, name FROM price_lists")).map((row) => [row.name, row.id]))
    const knownRepricings = new Set((await q("SELECT id FROM repricings")).map((row) => Number(row.id)))
    for (const doc of data("qa-sklad-repricings.json")) {
      if (knownRepricings.has(doc.id)) continue
      const stamp = utcTime(doc.created)
      const canceled = doc.status === "canceled"
      await client.query(
        `INSERT INTO repricings (id, created_by, created_at_label, price_list_id, product_id, amount, currency, status, "user", items, comment, total, total_old, total_new, source, parent_id, created_at, updated_at, canceled_at, canceled_by)
         VALUES ($1, $2, $3, $4, NULL, $5::double precision, $6, $7, $2, '[]', $8, $5::double precision, 0, $5::double precision, 'manual', NULL, $9, $9, $10, $11)`,
        [doc.id, doc.user, sqlTime(doc.created).slice(0, 10), priceLists.get(doc.priceList) ?? null, doc.total, doc.currency, canceled ? "отменен" : "проведен", doc.comment, stamp, canceled ? stamp : "", canceled ? doc.user : ""],
      )
      await register("repricings", doc.id)
      counts.repricings++
    }

    // ---- stock inventories (list level)
    const knownInventories = new Set((await q("SELECT id FROM stock_inventories")).map((row) => Number(row.id)))
    for (const doc of data("qa-sklad-inventories.json")) {
      if (knownInventories.has(doc.id)) continue
      const stamp = utcTime(doc.created)
      const confirmed = doc.status === "confirmed"
      const canceled = doc.status === "canceled"
      await client.query(
        `INSERT INTO stock_inventories (id, warehouse, inv_date, for_day_end, type, status, comment, currency, total_price, created_by, created_at, confirmed_at, confirmed_by, canceled_at, canceled_by)
         VALUES ($1, $2, $3, 0, $4, $5, $6, 'SUM', $7, $8, $9, $10, $11, $12, $13)`,
        [doc.id, doc.warehouse, sqlTime(doc.created).slice(0, 10), doc.type, doc.status, doc.comment, doc.total, doc.by, stamp, confirmed ? stamp : "", confirmed ? doc.by : "", canceled ? stamp : "", canceled ? doc.by : ""],
      )
      await register("stock_inventories", doc.id)
      counts.stock_inventories++
    }

    for (const table of ["write_offs", "repricings", "stock_inventories"]) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${table}), 1))`).catch(() => null)
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', 'refimport:v1', $1)", [DOMAIN])
    console.log("refimport:", JSON.stringify(counts))
  }

  // The orders.stock_name ledger change of "Аналитика-2" deducts more sales than the v1 supply covered: 5 toshkent balances stayed negative.
  if (!(await seeded("negative-stock:v2"))) {
    const SHORTFALLS_V2 = [["Банан СУЛТАНА КУК", 444], ["КАРОПКА   В 137", 10], ["С1", 43], ["sndwch", 8], ["temir", 382]]
    const items = SHORTFALLS_V2.map(([product, shortfall], index) => {
      const qty = Math.ceil(shortfall * 1.25) + 10
      return { id: index + 1, product, expiry: "", qty, block: 0, kg: 0, netWeight: 0, cost: 1000, total: qty * 1000 }
    })
    const amount = items.reduce((sum, item) => sum + item.total, 0)
    const row = {
      supplier: "Поставщик", warehouse: "toshkent", date: "1 сент. 2024", payment_type: "Банковский счет", contract_number: "", amount, status: "принят",
      invoice_number: "", organization: "", branch: "", phone: "Не указан", email: "Не указан", initiator: "Admin Ritm", paid: amount, time: "", comment: "",
      items: JSON.stringify(items), created_at: "2024-09-01 10:00:00", updated_at: "2024-09-01 10:00:00",
    }
    const columns = Object.keys(row)
    const result = await client.query(`INSERT INTO supplier_incomings (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, columns.map((c) => row[c]))
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('supplier_incomings', $1, $2)", [String(result.rows[0].id), DOMAIN])
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', 'negative-stock:v2', $1)", [DOMAIN])
    inserted++
  }
  if (!(await seeded("raw-materials:v1"))) {
    await client.query(`CREATE TABLE IF NOT EXISTS product_kind_overrides (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'raw_material', raw_material_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    const raw = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/qa-sklad-raw-materials.json"), "utf8"))
    const done = new Set((await q("SELECT product_id FROM product_kind_overrides")).map((row) => Number(row.product_id)))
    let rawInserted = 0
    // Inserted oldest-first: the lists sort by id DESC, so the reference's first row (newest) ends up on top.
    for (const item of raw.slice().reverse()) {
      const [product] = await q("SELECT id FROM products WHERE name = $1 AND COALESCE(deleted, 0) = 0 ORDER BY id LIMIT 1", [item.name])
      if (!product || done.has(Number(product.id))) continue
      const created = await client.query(
        `INSERT INTO raw_materials (name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number, supplier, brand, min_stock, color,
           integration_code, mass, net_weight, volume, description, can_sell, only_mml, show_as_inventory, group_only, show_in_bot, track_expiry, marked_product, price_lists,
           box_amount, expiration_days, notify_expire_days, box_sizes, sale_min_price, sale_max_price, sale_price_currency, subcategory, track_series, manual_discount,
           hide_from_agent, has_photo, perfect_store, limit_price, product_group, ikpu, invoice_unit_code, vat, sale_points, price_min, price_max, price_updated_date, created_at, updated_at)
         SELECT name, COALESCE(full_name, ''), COALESCE(barcode, 'не установлен'), COALESCE(article, ''), COALESCE(type, ''), COALESCE(organization, ''), COALESCE(unit, ''), COALESCE(sub_unit, ''),
           COALESCE(created_date, ''), COALESCE(order_number, ''), COALESCE(supplier, 'Не указано'), COALESCE(brand, 'No brand'), COALESCE(min_stock, '0'), COALESCE(color, 'Не указано'),
           COALESCE(integration_code, ''), COALESCE(weight, '0'), COALESCE(net_weight, '0'), COALESCE(volume, 'Не указано'), COALESCE(description, 'Не указано'), COALESCE(can_sell, 1), COALESCE(only_mml, 0),
           COALESCE(is_inventory, 0), COALESCE(group_only, 0), COALESCE(show_in_bot, 1), COALESCE(track_expiry, 0), COALESCE(marked_product, 0), COALESCE(price_lists, '[]'),
           COALESCE(box_amount, 0), expiration_days, notify_expire_days, COALESCE(box_sizes, '[]'), COALESCE(sale_min_price, 0), COALESCE(sale_max_price, 0), COALESCE(sale_price_currency, ''),
           COALESCE(subcategory, ''), COALESCE(track_series, 0), COALESCE(manual_discount, 0), COALESCE(hide_from_agent, 0), COALESCE(has_photo, 0), COALESCE(perfect_store, 0), COALESCE(limit_price, 0),
           COALESCE(product_group, ''), COALESCE(ikpu, ''), COALESCE(invoice_unit_code, ''), COALESCE(vat, 'Без НДС'), COALESCE(sale_points, '0'), COALESCE(price_min, 0), COALESCE(price_max, 0),
           COALESCE(price_updated_date, 'Не установлена'), created_at, updated_at
           FROM products WHERE id = $1 RETURNING id`,
        [product.id],
      )
      const rawId = created.rows[0].id
      const override = await client.query("INSERT INTO product_kind_overrides (product_id, kind, raw_material_id) VALUES ($1, 'raw_material', $2) RETURNING id", [product.id, rawId])
      await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('raw_materials', $1, $2), ('product_kind_overrides', $3, $2)", [String(rawId), DOMAIN, String(override.rows[0].id)])
      rawInserted++
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', 'raw-materials:v1', $1)", [DOMAIN])
    console.log("raw materials:", rawInserted)
  }

  await client.query("COMMIT")
  console.log("inserted supplier_incomings:", inserted)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
