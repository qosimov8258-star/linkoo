import "server-only"

import { randomBytes } from "node:crypto"

import { Pool, type PoolClient } from "pg"

import { hashPassword, verifyPassword } from "@/lib/auth"
import { PERMISSION_CATALOG } from "@/lib/capabilities-catalog"

// ---------------------------------------------------------------------------
// Postgres connection
// ---------------------------------------------------------------------------

declare global {
  var __linkoPool: Pool | undefined
  var __linkoSchema: { version: number; ready: Promise<void> } | undefined
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.")
  }
  return new Pool({ connectionString, max: 10 })
}

function getPool(): Pool {
  if (!globalThis.__linkoPool) globalThis.__linkoPool = createPool()
  return globalThis.__linkoPool
}

// ---------------------------------------------------------------------------
// better-sqlite3 compatibility shim
//
// The whole app (79 repo files) was originally written against
// better-sqlite3's synchronous `db.prepare(sql).get/all/run(...params)` /
// `db.exec(ddl)` / `db.transaction(fn)` API, using either `?` positional or
// `@name` named placeholders and `INTEGER PRIMARY KEY AUTOINCREMENT` /
// `datetime('now')` in DDL. Rather than hand-porting every SQL string to
// Postgres dialect (huge, error-prone surface), this shim keeps the exact
// same call shape (each call site just gains `async`/`await`) and does the
// dialect translation transparently: `?`/`@name` -> `$1..$n`, an
// `INSERT OR IGNORE` -> `ON CONFLICT DO NOTHING`, `AUTOINCREMENT` -> IDENTITY,
// and a real `datetime('now')` SQL function so DDL defaults need no rewrite.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

export type PgDb = {
  prepare(sql: string): {
    get(...args: unknown[]): Promise<Row | undefined>
    all(...args: unknown[]): Promise<Row[]>
    run(...args: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>
  }
  exec(sql: string): Promise<void>
}

// Tables whose primary key is not a serial `id` column, so `.run()` must not
// auto-append `RETURNING id` for their INSERT statements.
const NO_ID_RETURNING = new Set(["telegram_bot_pages", "user_sessions", "product_attribute_assignments"])

function translateParams(sql: string, args: unknown[]): { text: string; values: unknown[] } {
  const singleObjectArg = args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])
  if (singleObjectArg && /@[A-Za-z_]\w*/.test(sql)) {
    const obj = args[0] as Record<string, unknown>
    const indexByName = new Map<string, number>()
    const values: unknown[] = []
    const text = sql.replace(/@([A-Za-z_]\w*)/g, (_match, name: string) => {
      let index = indexByName.get(name)
      if (index === undefined) {
        values.push(obj[name])
        index = values.length
        indexByName.set(name, index)
      }
      return `$${index}`
    })
    return { text, values }
  }
  if (sql.includes("?")) {
    let i = 0
    const text = sql.replace(/\?/g, () => `$${++i}`)
    return { text, values: args }
  }
  return { text: sql, values: args }
}

function finalizeRun(sql: string): string {
  let text = sql.trim()
  const ignoreMatch = /^INSERT\s+OR\s+IGNORE\s+INTO/i.exec(text)
  if (ignoreMatch) {
    text = "INSERT INTO" + text.slice(ignoreMatch[0].length)
    if (!/ON CONFLICT/i.test(text)) text += " ON CONFLICT DO NOTHING"
  }
  const insertMatch = /^INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(text)
  if (insertMatch && !/RETURNING/i.test(text) && !NO_ID_RETURNING.has(insertMatch[1].toLowerCase())) {
    text += " RETURNING id"
  }
  return text
}

function translateDdl(sql: string): string {
  // REAL (float4) keeps ~7 significant digits: 120 708 500 comes back as 120 708 496. Money/quantity columns are float8.
  return sql.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "SERIAL PRIMARY KEY").replace(/\bREAL\b/g, "DOUBLE PRECISION")
}

// `inTransaction`: the statements run on a client that withTransaction checked
// out after the schema was ready, so they must not wait for the bootstrap
// again — a bootstrap started meanwhile (new SCHEMA_VERSION after a hot reload)
// needs pool connections itself, and transactions holding all of them while
// waiting for it would deadlock the pool.
function makeDb(executor: Pool | PoolClient, inTransaction = false): PgDb {
  const ready = () => (inTransaction ? Promise.resolve() : ensureSchema())
  return {
    prepare(sql: string) {
      return {
        async get(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(sql, args)
          const result = await executor.query(text, values)
          return result.rows[0]
        },
        async all(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(sql, args)
          const result = await executor.query(text, values)
          return result.rows
        },
        async run(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(finalizeRun(sql), args)
          const result = await executor.query(text, values)
          const insertedId = (result.rows[0] as { id?: number } | undefined)?.id
          return { changes: result.rowCount ?? 0, lastInsertRowid: insertedId ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      await ready()
      await executor.query(translateDdl(sql))
    },
  }
}

/** Runs `fn` against a single dedicated connection wrapped in a real
 * Postgres transaction (BEGIN/COMMIT/ROLLBACK), mirroring the handful of
 * call sites that used better-sqlite3's `db.transaction(fn)`. */
export async function withTransaction<T>(fn: (db: PgDb) => Promise<T>): Promise<T> {
  await ensureSchema()
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    const result = await fn(makeDb(client, true))
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export function getDb(): PgDb {
  return makeDb(getPool())
}

// ---------------------------------------------------------------------------
// Schema bootstrap (runs once per process, lazily, before the first query)
// ---------------------------------------------------------------------------

export const ADMIN_USERNAME = "admin"
// Databases seeded before ADMIN_INITIAL_PASSWORD existed all got this fixed
// password. It is kept only so the bootstrap can recognise such an account and
// flag it for a forced password change (never used to create an account).
export const LEGACY_ADMIN_PASSWORD = "123"

// Bumped whenever bootstrapSchema gains a step, so a running dev server (whose
// globalThis survives hot reloads) runs the new steps once instead of keeping
// the promise of the old bootstrap.
const SCHEMA_VERSION = 2

function ensureSchema(): Promise<void> {
  const current = globalThis.__linkoSchema
  if (current && current.version === SCHEMA_VERSION) return current.ready
  const ready = bootstrapSchema().catch((error) => {
    // A failed bootstrap (database briefly unreachable, lock timeout) must not
    // poison the process: forget it so the next query retries.
    if (globalThis.__linkoSchema?.ready === ready) globalThis.__linkoSchema = undefined
    throw error
  })
  globalThis.__linkoSchema = { version: SCHEMA_VERSION, ready }
  return ready
}

async function bootstrapSchema(): Promise<void> {
  const pool = getPool()

  // Compatibility function so every existing `datetime('now')` default /
  // expression across all repo files' SQL keeps working unmodified.
  await pool.query(`
    CREATE OR REPLACE FUNCTION datetime(text) RETURNS text AS $$
      SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
    $$ LANGUAGE sql STABLE;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      access_right_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      inn TEXT,
      type TEXT NOT NULL DEFAULT '',
      zone TEXT NOT NULL DEFAULT '',
      zone_agent TEXT NOT NULL DEFAULT 'Не указано',
      agent TEXT NOT NULL DEFAULT 'Не указано',
      deliverer TEXT NOT NULL DEFAULT 'Не указано',
      collector TEXT NOT NULL DEFAULT 'Не указано',
      balance DOUBLE PRECISION,
      tab TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      client TEXT NOT NULL,
      zone TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL DEFAULT '',
      delivery TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT 'Admin Ritm',
      amount TEXT NOT NULL DEFAULT '0 SUM',
      balance TEXT NOT NULL DEFAULT '0 SUM',
      negative INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Есть на складе',
      discount TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Order lines (same DDL as lib/orders-repo.ts), created up front so readers
    -- such as the stock core never meet a database without the table.
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER,
      product_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      cost_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

    CREATE TABLE IF NOT EXISTS currencies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      rate DOUBLE PRECISION NOT NULL DEFAULT 1,
      is_base INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cashboxes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SUM',
      cashier TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT '',
      vansell INTEGER NOT NULL DEFAULT 0,
      order_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS income_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parameter TEXT NOT NULL DEFAULT '',
      other_income INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parameter TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
      direct INTEGER NOT NULL DEFAULT 0,
      exclude_from_pnl INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_payments (
      id SERIAL PRIMARY KEY,
      client TEXT NOT NULL,
      client_code TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      accepted_at TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      amount_sum_equivalent DOUBLE PRECISION,
      cash_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      kassa TEXT NOT NULL DEFAULT '',
      accepted INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT 'Не указано',
      icon TEXT NOT NULL DEFAULT 'cash',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id SERIAL PRIMARY KEY,
      supplier TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      cash_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      kassa TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT 'Не указано',
      icon TEXT NOT NULL DEFAULT 'cash',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      limit_by_debt INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS units_of_measure (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES units_of_measure(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES product_types(id) ON DELETE SET NULL,
      show_in_bot INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      photo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_lists (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'SUM',
      linked_list TEXT NOT NULL DEFAULT 'Не указано',
      calc_method TEXT NOT NULL DEFAULT 'Не указано',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT 'не установлен',
      article TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      sub_unit TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      has_photo INTEGER NOT NULL DEFAULT 0,
      can_sell INTEGER NOT NULL DEFAULT 1,
      is_inventory INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      only_mml INTEGER NOT NULL DEFAULT 0,
      perfect_store INTEGER NOT NULL DEFAULT 0,
      group_only INTEGER NOT NULL DEFAULT 0,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      manual_discount INTEGER NOT NULL DEFAULT 0,
      hide_from_agent INTEGER NOT NULL DEFAULT 0,
      track_series INTEGER NOT NULL DEFAULT 0,
      show_in_bot INTEGER NOT NULL DEFAULT 1,
      marked_product INTEGER NOT NULL DEFAULT 0,
      limit_price INTEGER NOT NULL DEFAULT 0,
      product_group TEXT NOT NULL DEFAULT '',
      ikpu TEXT NOT NULL DEFAULT '',
      invoice_unit_code TEXT NOT NULL DEFAULT '',
      vat TEXT NOT NULL DEFAULT 'Без НДС',
      sale_points TEXT NOT NULL DEFAULT '0',
      subcategory TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT 'No brand',
      min_stock TEXT NOT NULL DEFAULT '0 шт.',
      description TEXT NOT NULL DEFAULT 'Не указано',
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      integration_code TEXT NOT NULL DEFAULT '',
      volume TEXT NOT NULL DEFAULT 'Не указано м³.',
      weight TEXT NOT NULL DEFAULT '0 кг.',
      net_weight TEXT NOT NULL DEFAULT '0',
      color TEXT NOT NULL DEFAULT 'Не указано',
      price_lists TEXT NOT NULL DEFAULT '[]',
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      price_min DOUBLE PRECISION NOT NULL DEFAULT 0,
      price_max DOUBLE PRECISION NOT NULL DEFAULT 0,
      price_updated_date TEXT NOT NULL DEFAULT 'Не установлена',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raw_materials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT 'не установлен',
      article TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      sub_unit TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      order_number TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT 'Не указано',
      supplier_id INTEGER,
      brand TEXT NOT NULL DEFAULT 'No brand',
      min_stock TEXT NOT NULL DEFAULT '0',
      color TEXT NOT NULL DEFAULT 'Не указано',
      integration_code TEXT NOT NULL DEFAULT '',
      mass TEXT NOT NULL DEFAULT '0',
      net_weight TEXT NOT NULL DEFAULT '0',
      volume TEXT NOT NULL DEFAULT 'Не указано',
      description TEXT NOT NULL DEFAULT 'Не указано',
      can_sell INTEGER NOT NULL DEFAULT 1,
      only_mml INTEGER NOT NULL DEFAULT 0,
      show_as_inventory INTEGER NOT NULL DEFAULT 0,
      group_only INTEGER NOT NULL DEFAULT 0,
      show_in_bot INTEGER NOT NULL DEFAULT 1,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      marked_product INTEGER NOT NULL DEFAULT 0,
      price_list TEXT NOT NULL DEFAULT '',
      cash_price TEXT NOT NULL DEFAULT '0',
      non_cash_price TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS repricings (
      id SERIAL PRIMARY KEY,
      created_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at_label TEXT NOT NULL DEFAULT '',
      price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      status TEXT NOT NULL DEFAULT 'проведен',
      "user" TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      online INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS write_offs (
      id SERIAL PRIMARY KEY,
      creator TEXT NOT NULL DEFAULT 'Admin Ritm',
      warehouse TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'закрыт',
      comment TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS internal_transfers (
      id SERIAL PRIMARY KEY,
      from_warehouse TEXT NOT NULL DEFAULT '',
      to_warehouse TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      created_at_label TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      weight DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'потвержден',
      price_list TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      transport_number TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT 'Не указано',
      organization TEXT NOT NULL DEFAULT 'Не указано',
      contacts TEXT NOT NULL DEFAULT '[]',
      products TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_incomings (
      id SERIAL PRIMARY KEY,
      supplier TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      payment_type TEXT NOT NULL DEFAULT 'Банковский счет',
      contract_number TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'принят',
      invoice_number TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT 'Не указан',
      email TEXT NOT NULL DEFAULT 'Не указан',
      initiator TEXT NOT NULL DEFAULT 'Admin Ritm',
      paid DOUBLE PRECISION NOT NULL DEFAULT 0,
      time TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_returns (
      id SERIAL PRIMARY KEY,
      from_whom TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL DEFAULT 'Admin Ritm',
      date TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'завершен',
      organization TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'SUM',
      payment_type TEXT NOT NULL DEFAULT '',
      price_list TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      transfer_time TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      login TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      integration_code TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      system_access INTEGER NOT NULL DEFAULT 1,
      show_in_tracking INTEGER NOT NULL DEFAULT 1,
      two_step_check INTEGER NOT NULL DEFAULT 0,
      session_limit INTEGER NOT NULL DEFAULT 0,
      gps_check INTEGER NOT NULL DEFAULT 1,
      start_point INTEGER NOT NULL DEFAULT 0,
      organizations TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      responsible TEXT NOT NULL DEFAULT '',
      store TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_progress',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY,
      serial_number TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      inventory_type TEXT NOT NULL DEFAULT '',
      inventory_code TEXT NOT NULL DEFAULT '',
      warehouse TEXT NOT NULL DEFAULT '',
      condition TEXT NOT NULL DEFAULT '',
      responsible TEXT NOT NULL DEFAULT '',
      attach_date TEXT NOT NULL DEFAULT '',
      created_date TEXT NOT NULL DEFAULT '',
      check_date TEXT NOT NULL DEFAULT '',
      approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      permission_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      code TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      categories TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS access_rights (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      capability_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      id SERIAL PRIMARY KEY,
      report_slug TEXT NOT NULL,
      report_label TEXT NOT NULL DEFAULT '',
      dashboard TEXT NOT NULL DEFAULT 'Основной дашборд',
      visibility TEXT NOT NULL DEFAULT 'all',
      employee_ids TEXT NOT NULL DEFAULT '[]',
      access_right_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(report_slug, dashboard)
    );
  `)

  // Added separately: raw_materials is created before suppliers above (to
  // mirror the original SQLite file's table order), and Postgres — unlike
  // SQLite — validates a REFERENCES target exists at the moment the
  // constraint is added, so this FK has to be attached after both tables
  // exist rather than inline in raw_materials' own CREATE TABLE.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_supplier_id_fkey'
      ) THEN
        ALTER TABLE raw_materials
          ADD CONSTRAINT raw_materials_supplier_id_fkey
          FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `)

  await upgradeUsersTable(pool)
  await seedPermissions(pool)
  await convertRealColumns(pool)
  await seedAdminIfEmpty(pool)
  await flagLegacyAdminPassword(pool)
}

// --- users: password policy flags + case-insensitive unique logins ----------
async function upgradeUsersTable(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS access_right_id INTEGER;
  `)
  // Look-alike logins ('admin' / 'ADMIN') must not coexist. Older databases may
  // already hold such twins; then the index is skipped (the API still refuses
  // new ones) instead of failing the whole bootstrap.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'users_username_lower_key') THEN
        BEGIN
          CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE 'users_username_lower_key skipped: case-insensitive duplicate usernames exist';
        END;
      END IF;
    END $$;
  `)
}

// --- permission catalogue (Права доступа → Возможности) ---------------------
async function seedPermissions(pool: Pool): Promise<void> {
  // Role names are unique case-insensitively (like capabilities.name); skipped
  // while an older database still holds twins (the API refuses new ones).
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'access_rights_name_key') THEN
        BEGIN
          CREATE UNIQUE INDEX access_rights_name_key ON access_rights (lower(btrim(name)));
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE 'access_rights_name_key skipped: duplicate role names exist';
        END;
      END IF;
    END $$;
  `)
  const codes = PERMISSION_CATALOG.map((item) => item.code)
  await pool.query(
    `INSERT INTO permissions (category, type, label, code, sort_order)
     SELECT category, type, label, code, ord::int
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS t(category, type, label, code, ord)
     ON CONFLICT (code) DO UPDATE
       SET category = EXCLUDED.category, type = EXCLUDED.type, label = EXCLUDED.label, sort_order = EXCLUDED.sort_order`,
    [
      PERMISSION_CATALOG.map((item) => item.category),
      PERMISSION_CATALOG.map((item) => item.type),
      PERMISSION_CATALOG.map((item) => item.label),
      codes,
    ],
  )
}

// --- money precision: REAL (float4) → DOUBLE PRECISION ------------------------
// float4 keeps ~7 significant digits, so 125 306 825 SUM is stored as
// 125 306 824 and anything above 3.4e38 overflows. Every module's DDL now says
// DOUBLE PRECISION; this sweep converts columns that older databases (or a
// lazily created table with an old DDL) still have as `real`. The value goes
// through its shortest exact text form (extra_float_digits = 1), so 158.37
// stays 158.37 instead of becoming 158.3699951171875. Idempotent: only columns
// that are still `real` are touched; a column that cannot be converted (a view
// depends on it, the lock is busy) is logged and retried on the next start.
async function convertRealColumns(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.data_type = 'real'
      ORDER BY c.table_name, c.ordinal_position`,
  )
  if (!rows.length) return
  const byTable = new Map<string, string[]>()
  for (const row of rows) byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name])
  const ident = (name: string) => `"${name.replace(/"/g, '""')}"`
  for (const [table, columns] of byTable) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL extra_float_digits = 1")
      const alters = columns
        .map((column) => `ALTER COLUMN ${ident(column)} TYPE double precision USING (${ident(column)}::text)::double precision`)
        .join(", ")
      await client.query(`ALTER TABLE ${ident(table)} ${alters}`)
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {})
      console.warn(`[db] could not convert real columns of ${table} (${columns.join(", ")}) to double precision:`, (error as Error).message)
    } finally {
      client.release()
    }
  }
}

// --- first administrator --------------------------------------------------------
// The password comes from ADMIN_INITIAL_PASSWORD; without it a random one-time
// password is generated and printed once to the server log. Either way the
// account must change it at the first sign-in (must_change_password).
async function seedAdminIfEmpty(pool: Pool): Promise<void> {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users")
  if (rows[0].count > 0) return
  const fromEnv = process.env.ADMIN_INITIAL_PASSWORD?.trim()
  const password = fromEnv || randomBytes(12).toString("base64url")
  const hash = await hashPassword(password)
  const result = await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'admin', 1) ON CONFLICT DO NOTHING`,
    [ADMIN_USERNAME, "admin", hash],
  )
  if (!result.rowCount) return
  if (fromEnv) {
    console.info(`[auth] Created the first administrator "${ADMIN_USERNAME}" with ADMIN_INITIAL_PASSWORD; change it at the first sign-in.`)
  } else {
    console.warn(
      `[auth] Created the first administrator "${ADMIN_USERNAME}" with the one-time password: ${password}\n` +
        "[auth] Sign in and change it now (set ADMIN_INITIAL_PASSWORD to choose it yourself on a fresh database).",
    )
  }
}

// Existing installations still signing in with the old hard-coded password are
// made to change it at the next sign-in.
async function flagLegacyAdminPassword(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE username = $1 AND must_change_password = 0 AND password_changed_at IS NULL",
    [ADMIN_USERNAME],
  )
  for (const row of rows) {
    if (await verifyPassword(LEGACY_ADMIN_PASSWORD, row.password_hash)) {
      await pool.query("UPDATE users SET must_change_password = 1 WHERE id = $1", [row.id])
    }
  }
}
