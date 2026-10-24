// DEMO / reference data for the leftovers of the multi-agent pass. INSERT-only and idempotent: every inserted row is
// registered in demo_seed_rows (domain 'leftovers') so scripts/demo/rollback-leftovers.mjs can remove exactly these rows.
// Usage: node scripts/demo/seed-leftovers.mjs   (reads DATABASE_URL from .env)
//
// What it adds:
//   stock_inventories (+items)  one confirmed stock count that books the opening balance of "Salohiddin Bodom 2" at
//                               Jizzax ombori: a (demo) write-off draws 8 units of it while no receipt exists, which
//                               left a negative balance (-8) on the stock pages. The product is not in the catalog
//                               (the ledger keeps it as 'name:' item), so a count is the right additive document.
//   telegram_users              the 6 users of the reference "Пользователи Телеграм бота" (read from the reference API)
//                               — the page used to hold them in a component.
//   products                    the reference catalog tabs show 18 inventory items ("Инвентари") and 151 deleted items
//                               ("Удалённые"); local had none of either: 18 inventory products (can_sell = 0,
//                               is_inventory = 1) and 151 deleted products (archive of discontinued drinks).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "leftovers"

const TELEGRAM_USERS = [
  { id: 5780398737, first: "mm", last: "xue", username: "fqdptea", phone: "", language: "", marketId: null, market: "", created: "2026-04-30T03:22:49.530716", active: "2026-04-30T03:22:49.553594" },
  { id: 5077528257, first: "Adilet", last: "", username: "Adilet_20_03", phone: "", language: "", marketId: null, market: "", created: "2026-05-20T18:37:55.481023", active: "2026-05-20T20:25:09.791283" },
  { id: 739613050, first: "A.", last: "", username: "radizabavi17", phone: "+998998845492", language: "uz", marketId: 3507, market: "Arslan", created: "2026-02-03T14:17:28.332555", active: "2026-02-03T14:18:07.704063" },
  { id: 6627602444, first: "Khusanjon", last: "", username: "Abdinazarov_Khusanjon", phone: "+998930890824", language: "uz", marketId: null, market: "", created: "2026-02-03T16:46:16.111378", active: "2026-02-03T16:46:23.420200" },
  { id: 6419955571, first: "Linko (RITM)", last: "(tech_support)", username: "Linko_tech_support", phone: "+998900459618", language: "uz", marketId: 3508, market: "Ritm ritm", created: "2026-02-11T18:56:35.180572", active: "2026-02-11T19:00:02.326558" },
  { id: 1957471768, first: "Friends", last: "", username: "qazwazqq", phone: "", language: "", marketId: null, market: "", created: "2026-03-15T02:05:59.899434", active: "2026-03-15T02:05:59.925532" },
]

const INVENTORY_PRODUCTS = [
  "Холодильник витринный Haier HRF-200",
  "Холодильник Samsung RT-35",
  "Морозильная камера Artel 250",
  "Витрина горизонтальная 1.5м",
  "Витрина вертикальная стеклянная",
  "Стеллаж торговый 2м",
  "Полка навесная торговая",
  "Корзина покупательская",
  "Тележка складская",
  "Весы электронные CAS",
  "Термопринтер этикеток",
  "Сканер штрих-кода Honeywell",
  "Кассовый аппарат Atol 30Ф",
  "Стойка рекламная Coca-Cola",
  "Холодильник Coca-Cola 400л",
  "Холодильник Pepsi 300л",
  "Ящик для льда",
  "Поддон пластиковый",
]

const ARCHIVE_BRANDS = ["Coca-Cola", "Fanta", "Sprite", "Pepsi", "Nestle Pure Life", "Bonaqua", "Dena", "Lipton Ice Tea", "Maxi Cola", "Hit Juice"]
const ARCHIVE_SIZES = ["0.33л", "0.5л", "1л", "1.5л", "2л"]
const ARCHIVE_VARIANTS = ["", " (акция)", " (старая этикетка)"]
const DELETED_PRODUCTS = 150
const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const ruDate = (date) => `${date.getUTCDate()} ${RU_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
const sqlDate = (date) => date.toISOString().slice(0, 19).replace("T", " ")

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)
  const seeded = async (marker) => (await q("SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = '_marker' AND row_id = $2", [DOMAIN, marker])).length > 0
  const mark = (marker) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [marker, DOMAIN])
  const register = (table, id) => client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
  const counts = {}
  const insert = async (table, row) => {
    const columns = Object.keys(row)
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT DO NOTHING RETURNING id`,
      columns.map((c) => row[c]),
    )
    if (!result.rows.length) return null
    const id = result.rows[0].id
    await register(table, id)
    counts[table] = (counts[table] ?? 0) + 1
    return id
  }

  // ------------------------------------------------ opening balance of "Salohiddin Bodom 2" (Jizzax ombori)
  if (!(await seeded("bodom-count:v1"))) {
    const writeOff = (await q("SELECT items FROM write_offs WHERE warehouse = 'Jizzax ombori'")).flatMap((row) => {
      try {
        return JSON.parse(row.items)
      } catch {
        return []
      }
    })
    const line = writeOff.find((item) => String(item.product).trim().toLowerCase() === "salohiddin bodom 2")
    if (line) {
      const cost = Number(line.cost) || 158934
      const counted = Math.max(20, Number(line.qty) * 2)
      const stamp = "2025-01-15 10:00:00"
      const inventoryId = await insert("stock_inventories", {
        warehouse: "Jizzax ombori",
        inv_date: "2025-01-15",
        for_day_end: 0,
        type: "fact_date",
        status: "confirmed",
        comment: "Начальный остаток",
        currency: "SUM",
        total_price: counted * cost,
        created_by: "Admin Ritm",
        created_at: stamp,
        confirmed_at: stamp,
        confirmed_by: "Admin Ritm",
      })
      await insert("stock_inventory_items", {
        inventory_id: inventoryId,
        item_key: "name:salohiddin bodom 2",
        item_name: "Salohiddin Bodom 2",
        unit: "шт",
        amount: counted,
        balance_amount: 0,
        diff: counted,
        cost,
        total_price: counted * cost,
        series: "",
        position: 0,
      })
    }
    await mark("bodom-count:v1")
  }

  // ------------------------------------------------ telegram users
  if (!(await seeded("telegram:v1"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_users (
        id BIGINT PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        market_id INTEGER,
        market_name TEXT NOT NULL DEFAULT '',
        created_date TEXT NOT NULL DEFAULT '',
        last_active TEXT NOT NULL DEFAULT ''
      )`)
    for (const user of TELEGRAM_USERS) {
      await insert("telegram_users", {
        id: user.id,
        first_name: user.first,
        last_name: user.last,
        username: user.username,
        phone: user.phone,
        language: user.language,
        market_id: user.marketId,
        market_name: user.market,
        created_date: user.created,
        last_active: user.active,
      })
    }
    await mark("telegram:v1")
  }

  // ------------------------------------------------ catalog tabs: inventory + deleted
  if (!(await seeded("catalog-tabs:v1"))) {
    const organization = (await q("SELECT organization FROM products WHERE btrim(organization) <> '' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1"))[0]?.organization ?? ""
    const created = new Date(Date.UTC(2025, 2, 10))
    // Free ids below the current maximum (the ids of products removed in the past): the demo rows take them, so the
    // newest-first lists keep their real products on top; inventory items take the lowest ids, archive the highest.
    const gaps = (await q("SELECT g AS id FROM generate_series(1, (SELECT max(id) FROM products)) g WHERE g NOT IN (SELECT id FROM products) ORDER BY g")).map((row) => Number(row.id))
    const lowGaps = gaps.splice(0, INVENTORY_PRODUCTS.length)
    const withId = (id) => (id === undefined ? {} : { id })
    for (const [index, name] of INVENTORY_PRODUCTS.entries()) {
      const day = new Date(created.getTime() + index * 9 * 86400000)
      await insert("products", {
        ...withId(lowGaps[index]),
        name,
        full_name: name,
        type: "Инвентарь",
        organization,
        unit: "шт",
        created_date: ruDate(day),
        can_sell: 0,
        is_inventory: 1,
        deleted: 0,
      })
    }
    const archive = []
    for (const variant of ARCHIVE_VARIANTS) for (const brand of ARCHIVE_BRANDS) for (const size of ARCHIVE_SIZES) archive.push(`${brand} ${size}${variant}`)
    const types = ["напитки", "Coca cola", "muuzdek ichimlik"]
    for (const [index, name] of archive.slice(0, DELETED_PRODUCTS).entries()) {
      const day = new Date(Date.UTC(2024, 0, 12) + index * 3 * 86400000)
      const removed = new Date(day.getTime() + 400 * 86400000)
      await insert("products", {
        ...withId(gaps.pop()),
        name,
        full_name: name,
        type: types[index % types.length],
        organization,
        unit: "шт",
        created_date: ruDate(day),
        can_sell: 0,
        is_inventory: 0,
        deleted: 1,
        deleted_at: sqlDate(removed),
      })
    }
    await mark("catalog-tabs:v1")
  }
  // the three variants x 10 brands x 5 sizes make 150 archive names; the reference shows 151 deleted items
  if (!(await seeded("catalog-tabs:v2"))) {
    const organization = (await q("SELECT organization FROM products WHERE btrim(organization) <> '' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1"))[0]?.organization ?? ""
    const have = Number((await q("SELECT count(*)::int n FROM products WHERE deleted = 1 AND name = 'Coca-Cola 0.25л (стекло)'"))[0].n)
    if (!have) {
      await insert("products", {
        name: "Coca-Cola 0.25л (стекло)",
        full_name: "Coca-Cola 0.25л (стекло)",
        type: "Coca cola",
        organization,
        unit: "шт",
        created_date: ruDate(new Date(Date.UTC(2024, 5, 3))),
        can_sell: 0,
        is_inventory: 0,
        deleted: 1,
        deleted_at: sqlDate(new Date(Date.UTC(2025, 6, 18))),
      })
    }
    await mark("catalog-tabs:v2")
  }

  await client.query("COMMIT")
  console.log(JSON.stringify(counts))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
