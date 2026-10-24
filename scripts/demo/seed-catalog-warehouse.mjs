// DEMO data for the catalog / warehouse area. INSERT-only and idempotent: every inserted row is registered in
// demo_seed_rows (domain 'catalog-warehouse') so scripts/demo/rollback-catalog-warehouse.mjs can remove exactly these rows.
// Usage: node scripts/demo/seed-catalog-warehouse.mjs   (reads DATABASE_URL from .env)
//
// What it adds (everything is generated from the local catalog, deterministic via a seeded PRNG):
//   supplier_incomings  168 accepted supplies with item lines -> the stock ledger (lib/stock/sources.ts) gets receipts,
//                       so "Остаток", the warehouse lines of БАЛАНС / ФИЛИАЛ and product pages show non-zero, consistent
//                       values. 310 accepted + 35 accepted transfers already exist, the reference shows 513 receipt
//                       history rows, so 168 more brings "История приемок" to 513.
//   inventory_items     35 inventory units (the reference "Работа с инвентарем" shows 35).
//   price_list_entries  prices of the stocked products in 12 price lists (price analysis).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "catalog-warehouse"
const SUPPLY_DOCS = 168
const INVENTORY_UNITS = 35
const PRICE_LISTS = 12

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261024)
const between = (min, max) => min + (max - min) * rnd()
const int = (min, max) => Math.floor(between(min, max + 1))
const pick = (list) => list[Math.floor(rnd() * list.length)]
const round = (value, step = 1) => Math.round(value / step) * step
const hash = (text) => {
  let h = 0
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 10000) / 10000
}
const pad = (n) => String(n).padStart(2, "0")
const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const ruDate = (date) => {
  const [y, m, d] = date.split("-").map(Number)
  return `${d} ${RU_MONTHS[m - 1]} ${y}`
}
const stamp = (date) => `${date} ${pad(int(8, 18))}:${pad(int(0, 59))}:${pad(int(0, 59))}`
const key = (text) => String(text ?? "").trim().toLocaleLowerCase("ru")
const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)

await client.query("BEGIN")
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())",
  )
  const seeded = async (marker) =>
    (await q("SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = '_marker' AND row_id = $2", [DOMAIN, marker])).length > 0
  const mark = (marker) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [marker, DOMAIN])
  const register = (table, id) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
  const counts = {}
  const insert = async (table, row) => {
    const columns = Object.keys(row)
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      columns.map((c) => row[c]),
    )
    const id = result.rows[0].id
    await register(table, id)
    counts[table] = (counts[table] ?? 0) + 1
    return id
  }

  const products = await q(
    "SELECT id, name, unit, type FROM products WHERE COALESCE(deleted, 0) = 0 AND btrim(name) <> '' AND COALESCE(can_sell, 1) = 1 ORDER BY id",
  )
  const allProducts = await q("SELECT id, name, unit, type FROM products WHERE COALESCE(deleted, 0) = 0 AND btrim(name) <> '' ORDER BY id")
  const warehouses = await q("SELECT id, name, stock_type FROM warehouses WHERE COALESCE(active, 1) = 1 ORDER BY id")
  const suppliers = await q("SELECT name FROM suppliers ORDER BY id")
  const orgs = await q("SELECT DISTINCT organization, branch FROM supplier_incomings WHERE btrim(organization) <> '' LIMIT 20")

  // ---------------------------------------------------------------- stock receipts
  if (!(await seeded("supply:v1"))) {
    const whByKey = new Map(warehouses.map((w) => [key(w.name), w]))
    const used = await q(
      "SELECT warehouse, count(*)::int n FROM supplier_incomings WHERE btrim(warehouse) <> '' GROUP BY 1 ORDER BY n DESC, warehouse",
    )
    // the warehouses that already carry supplies, plus those the write-offs draw from
    const wanted = []
    const push = (name, force = false) => {
      const w = whByKey.get(key(name))
      if (w && (force || w.stock_type !== "manufacturing") && !wanted.some((x) => key(x.name) === key(w.name))) wanted.push(w)
    }
    // every warehouse a write-off draws from needs receipts (a manufacturing one too), or its stock goes negative
    for (const row of await q("SELECT DISTINCT warehouse FROM write_offs")) push(row.warehouse, true)
    for (const row of used) {
      if (wanted.length >= 16) break
      push(row.warehouse)
    }

    // cost per product: the write-off cost when one exists, otherwise a stable pseudo price
    const costOf = new Map()
    const need = new Map() // warehouse|product -> quantity written off
    for (const row of await q("SELECT warehouse, items FROM write_offs")) {
      let items = []
      try {
        items = JSON.parse(row.items)
      } catch {}
      for (const item of Array.isArray(items) ? items : []) {
        const qty = Number(item.qty) || 0
        const cost = Number(item.cost) || 0
        // write-off costs above this are data noise (one test product carries 56 mln per unit): ignore them
        if (cost > 0 && cost <= 150000) costOf.set(key(item.product), cost)
        if (qty > 0) need.set(`${key(row.warehouse)}|${key(item.product)}`, (need.get(`${key(row.warehouse)}|${key(item.product)}`) ?? 0) + qty)
      }
    }
    const unitCost = (product) => costOf.get(key(product.name)) ?? round(1500 + hash(product.name) ** 1.6 * 58000, 100)
    const kg = (product) => /^(kg|кг|kilo|l|л)/i.test(String(product.unit ?? "").trim())
    const byName = new Map(allProducts.map((p) => [key(p.name), p]))

    // doc plan: spread SUPPLY_DOCS over the warehouses, oldest first
    const weights = wanted.map((_, i) => 1 / (1 + i * 0.35))
    const total = weights.reduce((a, b) => a + b, 0)
    const docsOf = weights.map((w) => Math.max(4, Math.round((w / total) * SUPPLY_DOCS)))
    let planned = docsOf.reduce((a, b) => a + b, 0)
    for (let i = 0; planned !== SUPPLY_DOCS; i = (i + 1) % docsOf.length) {
      if (planned > SUPPLY_DOCS && docsOf[i] > 4) {
        docsOf[i] -= 1
        planned -= 1
      } else if (planned < SUPPLY_DOCS) {
        docsOf[i] += 1
        planned += 1
      }
    }

    const START = "2025-01-08"
    const END = "2026-10-20"
    const spanDays = Math.round((Date.parse(END) - Date.parse(START)) / 86400000)
    const docs = []
    wanted.forEach((w, wi) => {
      const poolSize = Math.min(products.length, int(45, 85) - wi)
      const pool = []
      const seen = new Set()
      for (const [k] of need) {
        const [whKey, productKey] = k.split("|")
        const product = byName.get(productKey)
        if (whKey === key(w.name) && product && !seen.has(product.id)) {
          seen.add(product.id)
          pool.push(product)
        }
      }
      while (pool.length < poolSize) {
        const product = pick(products)
        if (!seen.has(product.id)) {
          seen.add(product.id)
          pool.push(product)
        }
      }
      let cursor = 0
      for (let d = 0; d < docsOf[wi]; d++) {
        const date = d === 0 ? addDays(START, int(0, 6)) : addDays(START, Math.round(((d + rnd() * 0.8) / docsOf[wi]) * spanDays))
        const lineCount = Math.min(pool.length, int(5, 12))
        const lines = []
        for (let l = 0; l < lineCount; l++) {
          const product = pool[cursor % pool.length]
          cursor += 1
          const base = unitCost(product)
          const cost = d === 0 && costOf.has(key(product.name)) ? base : round(base * between(0.96, 1.05), 1)
          const required = need.get(`${key(w.name)}|${key(product.name)}`) ?? 0
          const qty = kg(product) ? int(30, 300) : int(4, 50) * 12
          lines.push({ product, cost, qty: d === 0 ? qty + required * 2 : qty })
        }
        docs.push({ warehouse: w, date: date > END ? END : date, lines })
      }
    })
    docs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    for (const doc of docs) {
      const items = doc.lines.map((line, index) => ({
        id: index + 1,
        product: line.product.name,
        expiry: "",
        qty: line.qty,
        block: 0,
        kg: 0,
        netWeight: 0,
        cost: line.cost,
        total: line.qty * line.cost,
      }))
      const amount = items.reduce((sum, item) => sum + item.total, 0)
      const org = pick(orgs)
      const supplier = suppliers.length ? pick(suppliers).name : "Поставщик"
      const stamped = stamp(doc.date)
      await insert("supplier_incomings", {
        supplier,
        warehouse: doc.warehouse.name,
        date: ruDate(doc.date),
        payment_type: rnd() < 0.7 ? "Банковский счет" : "Наличный",
        contract_number: "",
        amount,
        status: "принят",
        invoice_number: rnd() < 0.5 ? String(int(1000, 9999)) : "",
        organization: org?.organization ?? "",
        branch: org?.branch ?? "",
        phone: "Не указан",
        email: "Не указан",
        initiator: "Admin Ritm",
        paid: rnd() < 0.75 ? amount : 0,
        time: "",
        comment: "",
        items: JSON.stringify(items),
        created_at: stamped,
        updated_at: stamped,
      })
    }
    await mark("supply:v1")
  }

  // ---------------------------------------------------------------- inventory units
  if (!(await seeded("inventory:v1"))) {
    const have = Number((await q("SELECT count(*)::int n FROM inventory_items"))[0].n)
    if (have === 0) {
      const inventoryProducts = await q(
        `SELECT id, name FROM products WHERE COALESCE(deleted, 0) = 0 AND (COALESCE(is_inventory, 0) = 1 OR name ~* '(холодил|muzlat|inventar|polka|vitrin|stelaj)') ORDER BY id`,
      )
      const pool = inventoryProducts.length ? inventoryProducts : products.slice(0, 6)
      const clients = await q("SELECT id, name FROM clients WHERE btrim(name) <> '' ORDER BY id DESC LIMIT 400")
      const stocks = warehouses.filter((w) => w.stock_type !== "manufacturing")
      const conditions = ["Новый", "Новый", "Новый", "Хороший", "Хороший", "Средний", "Плохой"]
      for (let i = 0; i < INVENTORY_UNITS; i++) {
        const product = pool[i % pool.length]
        const stock = pick(stocks)
        const withClient = rnd() < 0.45
        const owner = withClient ? pick(clients) : null
        const date = addDays("2025-06-01", int(0, 480))
        const created = stamp(date)
        const reviewed = rnd() < 0.3
        const id = await insert("inventory_items", {
          serial_number: `SN${String(int(100000, 999999))}${String.fromCharCode(65 + int(0, 25))}${int(10, 99)}`,
          client: owner?.name ?? "",
          inventory_type: product.name,
          inventory_code: String(40 + i),
          warehouse: stock.name,
          condition: pick(conditions),
          responsible: "Admin Ritm",
          attach_date: date,
          created_date: created,
          check_date: reviewed ? stamp(addDays(date, int(5, 60))) : "",
          approved: reviewed ? 1 : 0,
          created_at: created,
          updated_at: created,
          product_id: product.id,
          client_id: owner?.id ?? null,
          comment: "",
          created_by: "Admin Ritm",
        })
        void id
      }
    }
    await mark("inventory:v1")
  }

  // ---------------------------------------------------------------- price list entries
  if (!(await seeded("prices:v1"))) {
    const lists = await q("SELECT id, name, currency FROM price_lists WHERE COALESCE(is_active, 1) = 1 ORDER BY id LIMIT $1", [PRICE_LISTS])
    const stocked = await q(
      "SELECT DISTINCT l.j ->> 'product' AS name, (l.j ->> 'cost')::float AS cost FROM supplier_incomings i CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN pg_input_is_valid(i.items, 'jsonb') THEN i.items::jsonb ELSE '[]'::jsonb END) AS l(j) WHERE i.status = 'принят' AND i.items <> '[]'",
    )
    const costByName = new Map()
    for (const row of stocked) if (!costByName.has(key(row.name))) costByName.set(key(row.name), Number(row.cost) || 0)
    const existing = new Set((await q("SELECT price_list, product FROM price_list_entries")).map((r) => `${key(r.price_list)}|${key(r.product)}`))
    lists.forEach((list, li) => {
      list.markup = 1.12 + li * 0.025
    })
    for (const list of lists) {
      for (const [name, cost] of costByName) {
        if (!(cost > 0) || existing.has(`${key(list.name)}|${name}`)) continue
        const display = products.find((p) => key(p.name) === name)?.name ?? name
        const sum = round(cost * list.markup, 100)
        const usd = String(list.currency).toUpperCase() === "USD"
        const cash = usd ? Math.round((sum / 12500) * 100) / 100 : sum
        const nonCash = usd ? Math.round(cash * 1.07 * 100) / 100 : round(sum * 1.07, 100)
        await insert("price_list_entries", { price_list: list.name, product: display, cash, non_cash: nonCash })
      }
    }
    await mark("prices:v1")
  }

  await client.query("COMMIT")
  console.log("seeded:", counts)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
