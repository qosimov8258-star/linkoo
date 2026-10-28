import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"
import { randomBytes } from "node:crypto"

import { Pool, type PoolClient, type QueryResult } from "pg"

import { hashPassword, verifyPassword } from "@/lib/auth"
import { PERMISSION_CATALOG } from "@/lib/capabilities-catalog"
import { DbBusyError } from "@/lib/db-errors"
import { withoutCurrentDdl } from "@/lib/ddl-skip"

// ---------------------------------------------------------------------------
// Postgres connection
//
// Concurrency rules (C1). The pool is shared by every request, and a request
// transaction keeps its connection — and every lock it took — until it ends.
// Once every connection was held by transactions that waited either for one more
// pool connection (a helper inside the transaction querying through the pool, a
// cached cost-ledger build running on the pool) or for a lock held by such a
// transaction, nothing could move: the whole server hung for good. Therefore:
//  1. withTransaction runs its callback in an AsyncLocalStorage context. getDb()
//     inside it — every nested helper that defaults `db = getDb()` — returns the
//     transaction's own db, and a nested withTransaction is a SAVEPOINT on the same
//     connection (savepoints started side by side run one after another: SavepointScope).
//     Code inside a transaction never needs a second connection.
//  2. Process-wide schema work — the bootstrap below and every module's cached lazy
//     DDL / backfill, which runs in outsideTransaction(fn) — uses a small pool of its
//     own (MAINTENANCE_MAX). It must not roll back with the request that happened to
//     start it, and a request transaction that waits for it must never wait for a
//     request-pool connection: the request pool can be full of transactions waiting
//     for that very request's locks.
//  3. Every wait is bounded: a free connection (POOL_WAIT_MS, then DbBusyError →
//     503), a lock — advisory locks included — (lock_timeout → 409), a transaction
//     left idle while holding its locks (idle_in_transaction_session_timeout: the
//     server ends it). lib/db-errors.ts maps them to clean JSON answers.
// ---------------------------------------------------------------------------

/** Pool size. The embedded Postgres allows 100 connections, shared by the app and its
 * test server; DATABASE_POOL_MAX overrides it. */
const POOL_MAX = Math.min(50, Math.max(4, Number(process.env.DATABASE_POOL_MAX) || 20))
/** Longest wait for a free connection before the request is refused (503). */
const POOL_WAIT_MS = 30_000
/** Longest wait for any lock (advisory locks included) before the statement fails (409). */
const LOCK_TIMEOUT_MS = 30_000
/** A transaction idle this long while holding its locks is ended by the server. */
const IDLE_IN_TRANSACTION_MS = 120_000
/** Connections of the schema-work pool (see the header, rule 2). */
const MAINTENANCE_MAX = 4
/** Bumped when the pool options change: a running dev server (globalThis survives hot
 * reloads) then opens a new pool; the old one's idle connections close by themselves. */
const POOL_VERSION = 2

type PoolKind = "request" | "maintenance"
type VersionedPool = Pool & { linkoVersion?: number }

type TxContext = {
  client: PoolClient
  pool: PoolKind
  db: PgDb
  /** Set when COMMIT / ROLLBACK starts: the connection is no longer this transaction's. */
  done: boolean
  /** Statements of the transaction run one after another (see txQuery). */
  tail: Promise<unknown>
  savepoints: number
  /** Savepoints opened by the transaction's own code (not inside a savepoint), see withSavepoint. */
  rootScope?: SavepointScope
  /** The connection broke (e.g. the server ended an idle transaction). */
  broken?: Error
}

/**
 * Where savepoints are opened: the transaction's own code, or the code inside one savepoint.
 * Postgres savepoints form a stack on the connection — RELEASE / ROLLBACK TO of one also ends
 * every savepoint opened after it — so two savepoints of one scope (Promise.all over two
 * isolated() calls, two nested withTransaction) must not be open at the same time: the second
 * would land inside the first, the first's RELEASE would end it, and a ROLLBACK TO of either
 * would undo the other's work. The savepoints of one scope therefore run one after another
 * (`tail`); a savepoint opened by code inside another one belongs to that one's own scope and
 * runs inside it (nesting is what the stack is for).
 */
type SavepointScope = {
  tx: TxContext
  /** The scope this one's savepoint was opened in (none: the transaction's own code). */
  parent?: SavepointScope
  /** False once its savepoint ended: code still running from there opens savepoints in `parent`. */
  open: boolean
  /** Settles once every savepoint queued in this scope so far has ended (never rejects). */
  tail: Promise<void>
}

/** outsideTransaction's context: schema work on the maintenance pool. */
type MaintenanceContext = { maintenance: true }
type DbContext = TxContext | MaintenanceContext

declare global {
  var __linkoPool: VersionedPool | undefined
  var __linkoMaintenancePool: VersionedPool | undefined
  var __linkoSchema: { version: number; ready: Promise<void> } | undefined
  var __linkoTx: AsyncLocalStorage<DbContext> | undefined
  var __linkoSavepointScope: AsyncLocalStorage<SavepointScope> | undefined
}

function createPool(max: number): VersionedPool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.")
  }
  const pool: VersionedPool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: POOL_WAIT_MS,
    idleTimeoutMillis: 30_000,
    // Session defaults of every connection (pool reads and lazy DDL included).
    options: `-c lock_timeout=${LOCK_TIMEOUT_MS} -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_MS}`,
  })
  // An idle connection the server closed must not crash the process (pg emits 'error').
  pool.on("error", (error) => console.warn("[db] idle connection error:", error.message))
  pool.linkoVersion = POOL_VERSION
  return pool
}

function getPool(kind: PoolKind): Pool {
  if (kind === "maintenance") {
    if (globalThis.__linkoMaintenancePool?.linkoVersion !== POOL_VERSION) globalThis.__linkoMaintenancePool = createPool(MAINTENANCE_MAX)
    return globalThis.__linkoMaintenancePool
  }
  if (globalThis.__linkoPool?.linkoVersion !== POOL_VERSION) globalThis.__linkoPool = createPool(POOL_MAX)
  return globalThis.__linkoPool
}

function txStorage(): AsyncLocalStorage<DbContext> {
  return (globalThis.__linkoTx ??= new AsyncLocalStorage<DbContext>())
}

function scopeStorage(): AsyncLocalStorage<SavepointScope> {
  return (globalThis.__linkoSavepointScope ??= new AsyncLocalStorage<SavepointScope>())
}

/** The scope a savepoint opened by the current code belongs to (see SavepointScope). */
function savepointScope(ctx: TxContext): SavepointScope {
  let scope = scopeStorage().getStore()
  // Another transaction's scope (outsideTransaction inside a savepoint) → this one's root.
  if (scope?.tx !== ctx) scope = undefined
  while (scope && !scope.open) scope = scope.parent
  return scope ?? (ctx.rootScope ??= { tx: ctx, open: true, tail: Promise.resolve() })
}

/** The transaction the current code runs in (withTransaction's context), if any. */
function activeTx(): TxContext | undefined {
  const ctx = txStorage().getStore()
  return ctx && "client" in ctx && !ctx.done ? ctx : undefined
}

/** The pool new connections of the current code come from (rule 2 of the header). */
function currentPoolKind(): PoolKind {
  const ctx = txStorage().getStore()
  if (!ctx) return "request"
  return "maintenance" in ctx || ctx.pool === "maintenance" ? "maintenance" : "request"
}

const isPoolTimeout = (error: unknown) => error instanceof Error && /timeout exceeded when trying to connect|due to connection timeout/.test(error.message)

/** A pool connection, or DbBusyError when none became free within POOL_WAIT_MS. */
async function connect(kind: PoolKind): Promise<PoolClient> {
  try {
    return await getPool(kind).connect()
  } catch (error) {
    throw isPoolTimeout(error) ? new DbBusyError(error) : error
  }
}

/** One statement outside any transaction (its own pool connection for the statement). */
async function poolQuery(kind: PoolKind, text: string, values?: unknown[]): Promise<QueryResult> {
  try {
    return await getPool(kind).query(text, values)
  } catch (error) {
    throw isPoolTimeout(error) ? new DbBusyError(error) : error
  }
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

type Query = (text: string, values?: unknown[]) => Promise<QueryResult>

/** Marks the db handles of transactions (a symbol, so it survives hot-reloaded copies of this module). */
const TX_DB = Symbol.for("linko.db.transaction")

// `ready`: pool statements wait for the schema bootstrap. A transaction's statements do
// not: withTransaction checked its connection out after the schema was ready, and a
// bootstrap started meanwhile (new SCHEMA_VERSION after a hot reload) needs pool
// connections itself — transactions holding all of them while waiting for it would
// deadlock the pool.
function makeDb(query: Query, ready: () => Promise<void>): PgDb {
  return {
    prepare(sql: string) {
      return {
        async get(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(sql, args)
          const result = await query(text, values)
          return result.rows[0]
        },
        async all(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(sql, args)
          const result = await query(text, values)
          return result.rows
        },
        async run(...args: unknown[]) {
          await ready()
          const { text, values } = translateParams(finalizeRun(sql), args)
          const result = await query(text, values)
          const insertedId = (result.rows[0] as { id?: number } | undefined)?.id
          return { changes: result.rowCount ?? 0, lastInsertRowid: insertedId ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      await ready()
      // Lazy-schema DDL that is already current is left out (lib/ddl-skip.ts): it would
      // lock its table anyway, and the first request after a restart could hang on it.
      const text = await withoutCurrentDdl(translateDdl(sql), async (statement, values) => (await query(statement, values)).rows)
      if (text !== null) await query(text)
    },
  }
}

const noWait = () => Promise.resolve()

/** The statements of a transaction, one after another on its connection (a helper's
 * Promise.all must not pile queries onto one pg client), and never after it ended — a
 * stray promise of a finished transaction would otherwise run on a connection that
 * already serves another request. */
function txQuery(ctx: TxContext): Query {
  return (text, values) => {
    const run = ctx.tail.then(() => {
      if (ctx.broken) throw ctx.broken
      if (ctx.done) throw new Error("Statement issued after its transaction ended")
      return ctx.client.query(text, values)
    })
    ctx.tail = run.catch(() => undefined)
    return run
  }
}

/** The turn of a savepoint in its scope: waits until the savepoints queued before it ended —
 * bounded like any other lock wait (rule 3 of the header: lock_timeout's 409, never a hang). */
async function savepointTurn(previous: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("savepoint wait timed out: another savepoint of the transaction did not end"), { code: "55P03" })),
      LOCK_TIMEOUT_MS,
    )
  })
  try {
    await Promise.race([previous, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** A nested withTransaction / isolated(): a savepoint of the running transaction (same
 * connection), opened only after the other savepoints of its scope ended (SavepointScope). */
async function withSavepoint<T>(ctx: TxContext, fn: (db: PgDb) => Promise<T>): Promise<T> {
  const scope = savepointScope(ctx)
  const previous = scope.tail
  let finish!: () => void
  const finished = new Promise<void>((resolve) => (finish = resolve))
  // The next savepoint of the scope waits for this one AND every one before it (also when this
  // one gives up waiting).
  scope.tail = previous.then(() => finished)
  const inner: SavepointScope = { tx: ctx, parent: scope, open: true, tail: Promise.resolve() }
  try {
    await savepointTurn(previous)
    const query = txQuery(ctx)
    const name = `linko_sp_${++ctx.savepoints}`
    await query(`SAVEPOINT ${name}`)
    const close = async () => {
      // Code still running from `fn` opens its savepoints after this one (in `scope`); the ones
      // it opened inside this one and did not wait for end first.
      inner.open = false
      await inner.tail
    }
    try {
      const result = await scopeStorage().run(inner, () => fn(ctx.db))
      await close()
      await query(`RELEASE SAVEPOINT ${name}`)
      return result
    } catch (error) {
      await close()
      // Undone and taken off the stack. A broken connection fails here too; the outer
      // transaction's ROLLBACK ends it.
      await query(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`).catch(() => undefined)
      throw error
    }
  } finally {
    inner.open = false
    finish()
  }
}

/** Runs `fn` against a single dedicated connection wrapped in a real
 * Postgres transaction (BEGIN/COMMIT/ROLLBACK), mirroring the handful of
 * call sites that used better-sqlite3's `db.transaction(fn)`. Inside `fn`,
 * getDb() is this transaction (see the header); called inside another
 * transaction it is a savepoint of that one. */
export async function withTransaction<T>(fn: (db: PgDb) => Promise<T>): Promise<T> {
  const outer = activeTx()
  if (outer) return withSavepoint(outer, fn)
  await ensureSchema()
  const kind = currentPoolKind()
  const client = await connect(kind)
  const ctx = { client, pool: kind, done: false, tail: Promise.resolve(), savepoints: 0 } as TxContext
  ctx.db = makeDb(txQuery(ctx), noWait)
  Object.defineProperty(ctx.db, TX_DB, { value: true })
  // The server may end the session while it is checked out (idle_in_transaction_session_timeout):
  // pg emits 'error' on the client, which must not crash the process.
  const onError = (error: Error) => {
    ctx.broken ??= error
  }
  client.on("error", onError)
  let releaseError: Error | undefined
  try {
    await client.query(
      `BEGIN; SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}; SET LOCAL idle_in_transaction_session_timeout = ${IDLE_IN_TRANSACTION_MS}`,
    )
    const result = await txStorage().run(ctx, () => fn(ctx.db))
    // Savepoints the callback opened and did not wait for, then every statement.
    await ctx.rootScope?.tail
    await ctx.tail
    ctx.done = true
    await client.query("COMMIT")
    return result
  } catch (error) {
    ctx.done = true
    try {
      await client.query("ROLLBACK")
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
    }
    throw error
  } finally {
    client.removeListener("error", onError)
    // A connection that broke is destroyed instead of going back to the pool.
    client.release(releaseError ?? ctx.broken)
  }
}

const poolDbs: Partial<Record<PoolKind, PgDb>> = {}

/** The database: inside withTransaction the running transaction, else the pool
 * (the maintenance pool inside outsideTransaction). */
export function getDb(): PgDb {
  const tx = activeTx()
  if (tx) return tx.db
  const kind = currentPoolKind()
  return (poolDbs[kind] ??= makeDb((text, values) => poolQuery(kind, text, values), ensureSchema))
}

/** Runs `fn` so that a statement failing inside it — an error the caller catches and
 * survives — does not abort the surrounding transaction: a savepoint inside
 * withTransaction (after the other savepoints of its scope ended, see SavepointScope),
 * a plain call outside. */
export function isolated<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = activeTx()
  return ctx ? withSavepoint(ctx, () => fn()) : fn()
}

/** True when `db` is a transaction's handle (withTransaction), not the pool. */
export function isTransactionDb(db: PgDb): boolean {
  return (db as { [TX_DB]?: boolean })[TX_DB] === true
}

/** True while the calling code runs inside withTransaction. */
export function inTransaction(): boolean {
  return activeTx() !== undefined
}

/**
 * Runs `fn` outside the caller's transaction, on the maintenance pool: getDb() is
 * that pool and withTransaction opens a transaction of its own there. Only for
 * process-wide schema work (lazy DDL / one-off backfills cached for every request):
 * it must not roll back with the caller that started it, and a request transaction
 * waiting for it then never waits for a request-pool connection (header, rule 2).
 */
export function outsideTransaction<T>(fn: () => T): T {
  return txStorage().run({ maintenance: true }, fn)
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
const SCHEMA_VERSION = 3

// ---------------------------------------------------------------------------
// Columns that modules add to the tables created here
//
// Each module adds its own columns lazily (ADD COLUMN IF NOT EXISTS in its
// ensure…Schema), but other modules read them without running that ensure
// first: on a fresh database "Оплаты от клиентов", "Запросы на снятие
// кэшбэка", the orders list and the equipment branch filter all failed with
// "column c.branch / c.code does not exist" until someone had opened Клиенты.
// The bootstrap therefore creates every such column up front, so pages work
// in any order of first use. The DDL is the owner module's, word for word
// (the owner's own ADD COLUMN IF NOT EXISTS then finds the column and does
// nothing); keep both in step when a column changes.
// ---------------------------------------------------------------------------

/** Client card fields (owner: lib/clients-repo.ts). */
export const CLIENT_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["branch", "TEXT NOT NULL DEFAULT ''"],
  ["sales_channel", "TEXT NOT NULL DEFAULT ''"],
  ["realization_by", "TEXT NOT NULL DEFAULT ''"],
  ["address", "TEXT NOT NULL DEFAULT ''"],
  ["landmark", "TEXT NOT NULL DEFAULT ''"],
  ["location_lat", "DOUBLE PRECISION"],
  ["location_lng", "DOUBLE PRECISION"],
  ["telegram_location_link", "TEXT NOT NULL DEFAULT ''"],
  ["code", "TEXT NOT NULL DEFAULT ''"],
  ["contact_person", "TEXT NOT NULL DEFAULT ''"],
  ["note", "TEXT NOT NULL DEFAULT ''"],
  ["auto_delivery", "INTEGER NOT NULL DEFAULT 0"],
  ["unlimited_debt", "INTEGER NOT NULL DEFAULT 0"],
  ["attributes", "TEXT NOT NULL DEFAULT '{}'"],
  ["in_route", "INTEGER NOT NULL DEFAULT 0"],
  ["is_problem", "INTEGER NOT NULL DEFAULT 0"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
]

/** Shared "№" of cash documents (lib/finance/schema.ts CASH_DOC_SEQUENCE). */
const CASH_DOC_SEQUENCE = "cash_doc_seq"
const CASH_DOC_NO = `BIGINT DEFAULT nextval('${CASH_DOC_SEQUENCE}')`
const TEXT_EMPTY = "TEXT NOT NULL DEFAULT ''"
const FLAG_OFF = "INTEGER NOT NULL DEFAULT 0"

const BOOTSTRAP_COLUMNS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  clients: CLIENT_COLUMNS,
  // lib/orders-repo.ts ORDER_COLUMNS (+ lib/finance/schema.ts, lib/stock/schema.ts, lib/cash/customer-payments.ts).
  orders: [
    ["payment_date", TEXT_EMPTY],
    ["payment_type", TEXT_EMPTY],
    ["organization", TEXT_EMPTY],
    ["warehouse", TEXT_EMPTY],
    ["delivery_man", TEXT_EMPTY],
    ["client_id", "INTEGER"],
    ["shipped_at", "TEXT"],
    ["currency", TEXT_EMPTY],
    ["price_list", TEXT_EMPTY],
    ["created_by", TEXT_EMPTY],
    ["comment", TEXT_EMPTY],
    ["delivery_type", TEXT_EMPTY],
    ["deal_type", TEXT_EMPTY],
    ["invoice_number", TEXT_EMPTY],
    ["invoice_date", TEXT_EMPTY],
    ["invoice_active", FLAG_OFF],
    ["contract", TEXT_EMPTY],
  ],
  // lib/finance/schema.ts LEDGER_EXTENSIONS.customer_payments.
  customer_payments: [
    ["client_id", "INTEGER"],
    ["cashbox_id", "INTEGER"],
    ["branch", TEXT_EMPTY],
    ["delivery_man", TEXT_EMPTY],
    ["income_category", TEXT_EMPTY],
    ["payment_date", TEXT_EMPTY],
    ["doc_no", CASH_DOC_NO],
    ["op_type", "INTEGER"],
    ["order_id", "INTEGER"],
    ["contract_id", "INTEGER"],
    ["contract", TEXT_EMPTY],
    ["income_category_id", "INTEGER"],
    ["delivery_man_id", "INTEGER"],
    ["real_amount", "DOUBLE PRECISION"],
    ["real_currency", TEXT_EMPTY],
    ["custom_rate", "DOUBLE PRECISION"],
    ["debt_rate", "DOUBLE PRECISION"],
    ["rate_type", TEXT_EMPTY],
    ["agent_cashbox_id", "INTEGER"],
    ["accepted_by", TEXT_EMPTY],
    ["accept_id", "INTEGER"],
    ["client_confirmation", TEXT_EMPTY],
    ["invoice_date", TEXT_EMPTY],
    ["is_deleted", FLAG_OFF],
    ["deleted_at", TEXT_EMPTY],
    ["deleted_by", TEXT_EMPTY],
  ],
  // lib/finance/schema.ts LEDGER_EXTENSIONS.supplier_payments.
  supplier_payments: [
    ["doc_no", CASH_DOC_NO],
    ["op_type", "INTEGER"],
    ["supplier_id", "INTEGER"],
    ["cashbox_id", "INTEGER"],
    ["supply_id", "INTEGER"],
    ["money_request_id", "INTEGER"],
    ["expense_category_id", "INTEGER"],
    ["income_category_id", "INTEGER"],
    ["category", TEXT_EMPTY],
    ["branch", TEXT_EMPTY],
    ["payment_date", TEXT_EMPTY],
    ["real_amount", "DOUBLE PRECISION"],
    ["real_currency", TEXT_EMPTY],
    ["custom_rate", "DOUBLE PRECISION"],
    ["debt_rate", "DOUBLE PRECISION"],
    ["rate_type", TEXT_EMPTY],
    ["internal_amount", "DOUBLE PRECISION"],
    ["is_verified", "INTEGER NOT NULL DEFAULT 1"],
    ["verified_at", TEXT_EMPTY],
    ["verified_by", TEXT_EMPTY],
    ["is_deleted", FLAG_OFF],
    ["deleted_at", TEXT_EMPTY],
    ["deleted_by", TEXT_EMPTY],
  ],
  // lib/cashboxes-repo.ts
  cashboxes: [["cashier_id", "INTEGER"]],
  // lib/cash/schema.ts, lib/categories-common.ts
  income_categories: [["options", "TEXT"]],
  expense_categories: [["options", "TEXT"]],
  // lib/dictionaries-schema.ts
  product_types: [
    ["position", FLAG_OFF],
    ["image", "TEXT"],
  ],
  units_of_measure: [["is_weighted", FLAG_OFF]],
  // lib/products-schema.ts COMMON_COLUMNS (+ initial_cost: lib/supplier-incomings-repo.ts).
  products: [
    ["box_amount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["expiration_days", "INTEGER"],
    ["notify_expire_days", "INTEGER"],
    ["box_sizes", "TEXT NOT NULL DEFAULT '[]'"],
    ["sale_min_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["sale_max_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["sale_price_currency", TEXT_EMPTY],
    ["deleted_at", TEXT_EMPTY],
    ["deleted_by", TEXT_EMPTY],
    ["initial_cost", "DOUBLE PRECISION"],
  ],
  // lib/products-schema.ts COMMON_COLUMNS + RAW_COLUMNS.
  raw_materials: [
    ["box_amount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["expiration_days", "INTEGER"],
    ["notify_expire_days", "INTEGER"],
    ["box_sizes", "TEXT NOT NULL DEFAULT '[]'"],
    ["sale_min_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["sale_max_price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["sale_price_currency", TEXT_EMPTY],
    ["deleted_at", TEXT_EMPTY],
    ["deleted_by", TEXT_EMPTY],
    ["deleted", FLAG_OFF],
    ["subcategory", TEXT_EMPTY],
    ["track_series", FLAG_OFF],
    ["manual_discount", FLAG_OFF],
    ["hide_from_agent", FLAG_OFF],
    ["has_photo", FLAG_OFF],
    ["price_updated_date", "TEXT NOT NULL DEFAULT 'Не установлена'"],
    ["perfect_store", FLAG_OFF],
    ["limit_price", FLAG_OFF],
    ["product_group", TEXT_EMPTY],
    ["ikpu", TEXT_EMPTY],
    ["invoice_unit_code", TEXT_EMPTY],
    ["vat", "TEXT NOT NULL DEFAULT 'Без НДС'"],
    ["sale_points", "TEXT NOT NULL DEFAULT '0'"],
    ["price_lists", "TEXT NOT NULL DEFAULT '[]'"],
    ["price_min", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["price_max", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ],
  // lib/price-lists-repo.ts
  price_lists: [
    ["position", FLAG_OFF],
    ["is_active", "INTEGER NOT NULL DEFAULT 1"],
    ["is_default_for_order", FLAG_OFF],
    ["method_values", "TEXT NOT NULL DEFAULT '[]'"],
  ],
  // lib/repricings-read.ts
  repricings: [
    ["items", "TEXT NOT NULL DEFAULT '[]'"],
    ["comment", TEXT_EMPTY],
    ["total", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["total_old", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["total_new", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
    ["source", TEXT_EMPTY],
    ["parent_id", "INTEGER"],
    ["canceled_at", TEXT_EMPTY],
    ["canceled_by", TEXT_EMPTY],
    ["recalculated_at", TEXT_EMPTY],
  ],
  // lib/warehouses-repo.ts
  warehouses: [
    ["full_name", TEXT_EMPTY],
    ["stock_type", "TEXT NOT NULL DEFAULT 'basic'"],
    ["manager_id", "INTEGER"],
    ["lat", "DOUBLE PRECISION"],
    ["lon", "DOUBLE PRECISION"],
    ["for_return", FLAG_OFF],
    ["track_min_amount", FLAG_OFF],
    ["comment", TEXT_EMPTY],
  ],
  // lib/write-offs-repo.ts
  write_offs: [
    ["finished_at", TEXT_EMPTY],
    ["finished_by", TEXT_EMPTY],
    ["cancelled_at", TEXT_EMPTY],
    ["cancelled_by", TEXT_EMPTY],
  ],
  // lib/internal-transfers-repo.ts
  internal_transfers: [
    ["given_at", TEXT_EMPTY],
    ["given_by", TEXT_EMPTY],
    ["accepted_at", TEXT_EMPTY],
    ["accepted_by", TEXT_EMPTY],
    ["cancelled_at", TEXT_EMPTY],
    ["cancelled_by", TEXT_EMPTY],
    ["currency", TEXT_EMPTY],
  ],
  // lib/supplier-incomings-repo.ts
  supplier_incomings: [
    ["currency", "TEXT NOT NULL DEFAULT 'SUM'"],
    ["invoice_date", TEXT_EMPTY],
    ["accepted_at", TEXT_EMPTY],
    ["accepted_by", TEXT_EMPTY],
    ["invoice_id", "INTEGER"],
    ["rate_to_base", "DOUBLE PRECISION"],
  ],
  // lib/supplier-returns-repo.ts
  supplier_returns: [
    ["transferred_by", TEXT_EMPTY],
    ["cancelled_at", TEXT_EMPTY],
    ["cancelled_by", TEXT_EMPTY],
    ["rate_to_base", "DOUBLE PRECISION"],
  ],
  // lib/tasks-repo.ts
  tasks: [
    ["client_id", "INTEGER"],
    ["employee_id", "INTEGER"],
  ],
  // lib/inventory-items-schema.ts
  inventory_items: [
    ["product_id", "INTEGER"],
    ["client_id", "INTEGER"],
    ["comment", TEXT_EMPTY],
    ["photo", TEXT_EMPTY],
    ["created_by", TEXT_EMPTY],
    ["reviewed_by", TEXT_EMPTY],
    ["deleted", FLAG_OFF],
    ["deleted_at", TEXT_EMPTY],
    ["deleted_by", TEXT_EMPTY],
  ],
}

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

/** Runs bootstrap DDL without the statements the catalog shows are already current
 * (lib/ddl-skip.ts; db.exec does the same for the modules' lazy schemas). */
async function runDdl(pool: Pool, sql: string): Promise<void> {
  const text = await withoutCurrentDdl(sql, async (query, values) => (await pool.query(query, values)).rows)
  if (text !== null) await pool.query(text)
}

async function bootstrapSchema(): Promise<void> {
  // Schema work runs on the maintenance pool (header, rule 2).
  const pool = getPool("maintenance")

  // Compatibility function so every existing `datetime('now')` default /
  // expression across all repo files' SQL keeps working unmodified.
  await pool.query(`
    CREATE OR REPLACE FUNCTION datetime(text) RETURNS text AS $$
      SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
    $$ LANGUAGE sql STABLE;
  `)

  // Through the lazy-schema filter (lib/ddl-skip.ts): a current database takes no
  // table lock here, so a restart never queues behind another process's transaction.
  await runDdl(pool, `
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
  await addModuleColumns(pool)
  await createClientZones(pool)
  await seedPermissions(pool)
  await convertRealColumns(pool)
  await seedAdminIfEmpty(pool)
  await flagLegacyAdminPassword(pool)
}

// --- users: password policy flags + case-insensitive unique logins ----------
async function upgradeUsersTable(pool: Pool): Promise<void> {
  await runDdl(pool, `
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

// --- module columns of the tables above (BOOTSTRAP_COLUMNS) -------------------
// One catalog query; ALTERs only for the columns still missing (none on a
// database whose modules have all run once), serialised by an advisory lock
// so processes starting together do not race on the same table.
async function addModuleColumns(pool: Pool): Promise<void> {
  const tables = Object.keys(BOOTSTRAP_COLUMNS)
  const missing = async (db: Pool | PoolClient) => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [tables],
    )
    const have = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
    return Object.entries(BOOTSTRAP_COLUMNS)
      .map(([table, columns]) => [table, columns.filter(([column]) => !have.has(`${table}.${column}`))] as const)
      .filter(([, columns]) => columns.length > 0)
  }
  if (!(await missing(pool)).length) return
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(72120899)")
    const todo = await missing(client)
    if (todo.some(([, columns]) => columns.some(([, ddl]) => ddl.includes(CASH_DOC_SEQUENCE)))) {
      await client.query(`CREATE SEQUENCE IF NOT EXISTS ${CASH_DOC_SEQUENCE}`)
    }
    for (const [table, columns] of todo) {
      await client.query(`ALTER TABLE ${table} ${columns.map(([column, ddl]) => `ADD COLUMN IF NOT EXISTS ${column} ${ddl}`).join(", ")}`)
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

// --- client zones (Клиенты → Зона, Территория) ---------------------------------
// The directory behind the client's "Зона" (lib/client-zones-repo.ts). Clients
// keep the zone NAME (clients.zone); polygon is the outline drawn on
// Территория as JSON [[lat, lng], …] ('' = none drawn). Names are unique
// case-insensitively (skipped while an older database holds twins).
async function createClientZones(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_zones (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      parent_id INTEGER REFERENCES client_zones(id) ON DELETE SET NULL,
      polygon TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'client_zones_name_key') THEN
        BEGIN
          CREATE UNIQUE INDEX client_zones_name_key ON client_zones (lower(btrim(name)));
        EXCEPTION WHEN unique_violation THEN
          RAISE NOTICE 'client_zones_name_key skipped: duplicate zone names exist';
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
