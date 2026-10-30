// One-time data migration: copies every row out of the legacy SQLite
// database (data/app.db) into the new Postgres database, preserving
// original ids (so foreign keys such as raw_materials.supplier_id keep
// pointing at the right row), then fixes up each table's SERIAL sequence so
// future inserts continue after the highest migrated id.
//
// Standalone by design (talks to Postgres directly via `pg`, not through
// lib/db.ts) so it can run before the app has ever booted — it creates the
// handful of tables it touches itself rather than relying on the app's own
// lazy schema bootstrap. Safe to re-run: every insert is `ON CONFLICT (id)
// DO NOTHING`.
//
// Usage:
//   docker compose up -d postgres        # make sure Postgres is running
//   set -a && source .env && set +a
//   npx tsx scripts/migrate-sqlite-to-postgres.ts
import Database from "better-sqlite3"
import path from "node:path"
import { Pool } from "pg"

const TABLE_DDL: Record<string, string> = {
  organizations: `CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, limit_by_debt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  currencies: `CREATE TABLE IF NOT EXISTS currencies (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, rate REAL NOT NULL DEFAULT 1,
    is_base INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  cashboxes: `CREATE TABLE IF NOT EXISTS cashboxes (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'SUM', cashier TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '', payment_type TEXT NOT NULL DEFAULT '', vansell INTEGER NOT NULL DEFAULT 0,
    order_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  customer_payments: `CREATE TABLE IF NOT EXISTS customer_payments (
    id SERIAL PRIMARY KEY, client TEXT NOT NULL, client_code TEXT, created_by TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL DEFAULT '', accepted_at TEXT NOT NULL DEFAULT '', agent TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'SUM',
    amount_sum_equivalent REAL, cash_amount REAL NOT NULL DEFAULT 0, kassa TEXT NOT NULL DEFAULT '',
    accepted INTEGER NOT NULL DEFAULT 0, comment TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT 'cash',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  brands: `CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, organization TEXT NOT NULL DEFAULT '', photo_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  warehouses: `CREATE TABLE IF NOT EXISTS warehouses (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
    manager TEXT NOT NULL DEFAULT '', created_date TEXT NOT NULL DEFAULT '', online INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  suppliers: `CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', created_date TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT 'Не указано', organization TEXT NOT NULL DEFAULT 'Не указано',
    contacts TEXT NOT NULL DEFAULT '[]', products TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  supplier_incomings: `CREATE TABLE IF NOT EXISTS supplier_incomings (
    id SERIAL PRIMARY KEY, supplier TEXT NOT NULL DEFAULT '', warehouse TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '',
    payment_type TEXT NOT NULL DEFAULT 'Банковский счет', contract_number TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'принят', invoice_number TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT 'Не указан', email TEXT NOT NULL DEFAULT 'Не указан',
    initiator TEXT NOT NULL DEFAULT '', paid REAL NOT NULL DEFAULT 0, time TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '', items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  clients: `CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', inn TEXT, type TEXT NOT NULL DEFAULT '',
    zone TEXT NOT NULL DEFAULT '', zone_agent TEXT NOT NULL DEFAULT 'Не указано', agent TEXT NOT NULL DEFAULT 'Не указано',
    deliverer TEXT NOT NULL DEFAULT 'Не указано', collector TEXT NOT NULL DEFAULT 'Не указано', balance REAL,
    tab TEXT NOT NULL DEFAULT 'all', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  orders: `CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, client TEXT NOT NULL, zone TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
    product TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT '', delivery TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL DEFAULT '', amount TEXT NOT NULL DEFAULT '0 SUM', balance TEXT NOT NULL DEFAULT '0 SUM',
    negative INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Есть на складе', discount TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  products: `CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL DEFAULT '', barcode TEXT NOT NULL DEFAULT 'не установлен',
    article TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
    sub_unit TEXT NOT NULL DEFAULT '', created_date TEXT NOT NULL DEFAULT '', order_number TEXT NOT NULL DEFAULT '',
    has_photo INTEGER NOT NULL DEFAULT 0, can_sell INTEGER NOT NULL DEFAULT 1, is_inventory INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0, only_mml INTEGER NOT NULL DEFAULT 0, perfect_store INTEGER NOT NULL DEFAULT 0,
    group_only INTEGER NOT NULL DEFAULT 0, track_expiry INTEGER NOT NULL DEFAULT 0, manual_discount INTEGER NOT NULL DEFAULT 0,
    hide_from_agent INTEGER NOT NULL DEFAULT 0, track_series INTEGER NOT NULL DEFAULT 0, show_in_bot INTEGER NOT NULL DEFAULT 1,
    marked_product INTEGER NOT NULL DEFAULT 0, limit_price INTEGER NOT NULL DEFAULT 0, product_group TEXT NOT NULL DEFAULT '',
    ikpu TEXT NOT NULL DEFAULT '', invoice_unit_code TEXT NOT NULL DEFAULT '', vat TEXT NOT NULL DEFAULT 'Без НДС',
    sale_points TEXT NOT NULL DEFAULT '0', subcategory TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT 'No brand',
    min_stock TEXT NOT NULL DEFAULT '0 шт.', description TEXT NOT NULL DEFAULT 'Не указано', supplier TEXT NOT NULL DEFAULT 'Не указано',
    integration_code TEXT NOT NULL DEFAULT '', volume TEXT NOT NULL DEFAULT 'Не указано м³.', weight TEXT NOT NULL DEFAULT '0 кг.',
    net_weight TEXT NOT NULL DEFAULT '0', color TEXT NOT NULL DEFAULT 'Не указано', price_lists TEXT NOT NULL DEFAULT '[]',
    cost REAL NOT NULL DEFAULT 0, price_min REAL NOT NULL DEFAULT 0, price_max REAL NOT NULL DEFAULT 0,
    price_updated_date TEXT NOT NULL DEFAULT 'Не установлена', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  employees: `CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', login TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', integration_code TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '', system_access INTEGER NOT NULL DEFAULT 1, show_in_tracking INTEGER NOT NULL DEFAULT 1,
    two_step_check INTEGER NOT NULL DEFAULT 0, session_limit INTEGER NOT NULL DEFAULT 0, gps_check INTEGER NOT NULL DEFAULT 1,
    start_point INTEGER NOT NULL DEFAULT 0, organizations TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  permissions: `CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY, category TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', label TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  capabilities: `CREATE TABLE IF NOT EXISTS capabilities (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, permission_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  access_rights: `CREATE TABLE IF NOT EXISTS access_rights (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, capability_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  dashboard_widgets: `CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id SERIAL PRIMARY KEY, report_slug TEXT NOT NULL, report_label TEXT NOT NULL DEFAULT '',
    dashboard TEXT NOT NULL DEFAULT 'Основной дашборд', visibility TEXT NOT NULL DEFAULT 'all', employee_ids TEXT NOT NULL DEFAULT '[]',
    access_right_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(report_slug, dashboard))`,
  order_time_restrictions: `CREATE TABLE IF NOT EXISTS order_time_restrictions (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, from_time TEXT NOT NULL DEFAULT '00:00', to_time TEXT NOT NULL DEFAULT '23:59',
    full_day INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  new_report_builder_saves: `CREATE TABLE IF NOT EXISTS new_report_builder_saves (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, report_type TEXT NOT NULL, config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
}

// Migration order respects foreign keys: a referenced table is migrated
// before anything that points at it.
const TABLES = Object.keys(TABLE_DDL)

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not set")

  const sqlitePath = path.join(process.cwd(), "data", "app.db")
  const sqlite = new Database(sqlitePath, { readonly: true })
  const pool = new Pool({ connectionString })

  // Same compat function lib/db.ts creates, so the `datetime('now')`
  // defaults above are valid whether this runs before or after the app's
  // own schema bootstrap (CREATE TABLE IF NOT EXISTS makes whichever runs
  // second a no-op either way).
  await pool.query(`
    CREATE OR REPLACE FUNCTION datetime(text) RETURNS text AS $$
      SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
    $$ LANGUAGE sql STABLE;
  `)

  for (const [table, ddl] of Object.entries(TABLE_DDL)) {
    await pool.query(ddl)
  }

  for (const table of TABLES) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    if (rows.length === 0) {
      console.log(`${table}: no rows, skipping`)
      continue
    }

    const columns = Object.keys(rows[0])
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ")
    const insertSql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`

    let inserted = 0
    for (const row of rows) {
      const values = columns.map((col) => row[col])
      const result = await pool.query(insertSql, values)
      inserted += result.rowCount ?? 0
    }
    console.log(`${table}: migrated ${inserted}/${rows.length} row(s)`)
  }

  for (const table of TABLES) {
    await pool.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
      [table],
    )
  }

  sqlite.close()
  await pool.end()
  console.log("\nMigration complete.")
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})
