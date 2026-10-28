// Demo/reference seed for the clients area (domain "clients-misc").
//
// INSERT-only and idempotent: nothing existing is updated or deleted. Every inserted row is
// registered in demo_seed_rows so rollback-clients-misc.mjs can remove exactly what this script added.
//
//   node scripts/demo/seed-clients-misc.mjs
//
// Seeds:
//   1. client_restrictions     - the 13 restrictions the reference shows ("Ограничения по клиентам").
//   2. financial_account_markets - which shops belong to which financial account (reference links).
//   3. client_object_status    - «Статус объекта» per client (drives the green/red row marker).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "clients-misc"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = fs.readFileSync(path.join(root, ".env"), "utf8")
  const match = env.match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

// Reference restrictions. `refId` is the id shown by the reference; local ids 8–11 are already taken by
// the older sample rows, so those four reference records get the next free ids instead.
const RESTRICTIONS = [
  { refId: 4, localId: 4, name: "папмп ри", minQty: false, clients: [], items: [{ name: "Coca Cola 0.5 литр", qty: 10 }] },
  { refId: 5, localId: 5, name: "zakazga ogranicheniya", minQty: false, clients: ["new client"], items: [{ name: "sprayt", qty: 15 }, { name: "robot moshina", qty: 500 }] },
  { refId: 6, localId: 6, name: "ism", minQty: false, clients: ["Xorazm qirq yettinchi kilent"], items: [] },
  { refId: 7, localId: 7, name: "Yozgi cheklov", minQty: false, clients: ["Дилшод"], items: [{ name: "robot moshina", qty: 20 }] },
  { refId: 8, localId: null, name: "7 kun", minQty: false, clients: ["Salohiddin Market test2"], items: [{ name: "robot moshina", qty: 1 }] },
  { refId: 9, localId: null, name: "Yozgi cheklov 2", minQty: true, clients: ["Android", "new klient onboard"], items: [{ name: "energetik 1 l", qty: 200 }] },
  { refId: 10, localId: null, name: "new", minQty: true, clients: [], items: [{ name: "energetik 1 l", qty: 10 }] },
  { refId: 12, localId: 12, name: "new2", minQty: false, clients: [], items: [{ name: "energetik 1 l", qty: 20 }] },
  { refId: 13, localId: 13, name: "тест", minQty: false, clients: ["ASUS", "elror", "aziz", "Ismoil Samugjonov", "test2 yaratgan klient", "Самсунг"], items: [{ name: "Ноутбук MSI", qty: 50 }] },
  { refId: 14, localId: 14, name: "гшг", minQty: false, clients: ["klent11"], items: [] },
  { refId: 15, localId: 15, name: "asd", minQty: false, clients: [], items: [{ name: "sndwch", qty: 5 }] },
  { refId: 16, localId: 16, name: "1messi", minQty: true, clients: ["Ritm ritm"], items: [{ name: "energetik 1 l", qty: 5 }] },
  { refId: 17, localId: 17, name: "new", minQty: true, clients: [], items: [] },
]

// Small deterministic hash so the seed gives the same result on every run.
function hash(value) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
const counts = {}

async function register(table, rowId) {
  await client.query(
    `INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [table, String(rowId), DOMAIN],
  )
  counts[table] = (counts[table] ?? 0) + 1
}

try {
  await client.query("BEGIN")
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_seed_rows (
      table_name text NOT NULL,
      row_id text NOT NULL,
      domain text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (table_name, row_id, domain)
    )
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS financial_account_markets (
      client_id INTEGER PRIMARY KEY,
      financial_account_id INTEGER NOT NULL
    )
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS client_object_status (
      client_id INTEGER PRIMARY KEY,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `)
  await client.query(`ALTER TABLE client_restrictions ADD COLUMN IF NOT EXISTS config TEXT NOT NULL DEFAULT '{}'`)

  // 1. Restrictions ---------------------------------------------------------------------------
  const existing = new Set((await client.query("SELECT id FROM client_restrictions")).rows.map((row) => Number(row.id)))
  const existingNames = new Set((await client.query("SELECT name || '|' || config AS key FROM client_restrictions")).rows.map((row) => row.key))
  let nextId = Math.max(0, ...existing, ...RESTRICTIONS.map((r) => r.localId ?? 0)) + 1
  for (const restriction of RESTRICTIONS) {
    const config = JSON.stringify({
      type: "Клиент",
      by: "Продукт",
      minQty: restriction.minQty,
      clients: restriction.clients,
      items: restriction.items,
    })
    if (existingNames.has(`${restriction.name}|${config}`)) continue
    const id = restriction.localId ?? nextId++
    const inserted = await client.query(
      `INSERT INTO client_restrictions (id, name, config) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, restriction.name, config],
    )
    if (inserted.rowCount) await register("client_restrictions", id)
  }
  // Explicit ids do not advance the serial; keep the next app-created restriction from colliding.
  await client.query(
    `SELECT setval(pg_get_serial_sequence('client_restrictions', 'id'), GREATEST((SELECT MAX(id) FROM client_restrictions), (SELECT last_value FROM client_restrictions_id_seq)))`,
  )

  // 2. Financial account <-> shop links --------------------------------------------------------
  const links = JSON.parse(fs.readFileSync(path.join(here, "data/financial-account-links.json"), "utf8"))
  const accountIds = new Set((await client.query("SELECT id FROM financial_accounts")).rows.map((row) => Number(row.id)))
  const clientRows = (await client.query("SELECT id, tab FROM clients")).rows
  const clientIds = new Set(clientRows.map((row) => Number(row.id)))
  for (const [shopId, accountId] of links) {
    if (!clientIds.has(shopId) || !accountIds.has(accountId)) continue
    const inserted = await client.query(
      `INSERT INTO financial_account_markets (client_id, financial_account_id) VALUES ($1, $2) ON CONFLICT (client_id) DO NOTHING RETURNING client_id`,
      [shopId, accountId],
    )
    if (inserted.rowCount) await register("financial_account_markets", shopId)
  }

  // 3. «Статус объекта»: confirmed clients are active, roughly one in ten is switched off ----------
  for (const row of clientRows) {
    const id = Number(row.id)
    const active = row.tab === "unconfirmed" ? 1 : hash(`status:${id}`) < 0.1 ? 0 : 1
    const inserted = await client.query(
      `INSERT INTO client_object_status (client_id, is_active) VALUES ($1, $2) ON CONFLICT (client_id) DO NOTHING RETURNING client_id`,
      [id, active],
    )
    if (inserted.rowCount) await register("client_object_status", id)
  }

  await client.query("COMMIT")
  console.log("Seeded domain", DOMAIN, counts)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
