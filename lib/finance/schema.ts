import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"

// Database plumbing of the finance ledger:
// 1. SQL helper functions (fin_*) that normalise the inconsistent text dates,
//    currencies, names and amount strings stored by the money tables, so
//    balances aggregate in SQL (GROUP BY) instead of row by row in JS.
// 2. Additive "ledger extension" columns on existing money tables (only ADD
//    COLUMN IF NOT EXISTS, never on a table that does not exist yet).
// 3. Introspection of which (lazily created) tables/columns exist, so a
//    missing table reads as empty instead of failing with a 500.

const FIN_SCHEMA_VERSION = 2

const FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION fin_key(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(replace(replace(coalesce(t, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))
$$;

CREATE OR REPLACE FUNCTION fin_place(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN fin_key(t) IN ('', '-', '—', 'не указано', 'не указан', 'все', 'все филиалы', 'все организации') THEN '' ELSE btrim(t) END
$$;

CREATE OR REPLACE FUNCTION fin_cur(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN t IS NULL OR btrim(t) = '' THEN NULL
    WHEN upper(btrim(t)) IN ('SUM', 'UZS', 'СУМ', 'СЎМ', 'SO''M', 'SOM') THEN 'SUM'
    WHEN upper(btrim(t)) IN ('USD', '$') THEN 'USD'
    WHEN upper(btrim(t)) IN ('EUR', 'EURO', '€', 'ЕВРО') THEN 'EUR'
    WHEN upper(btrim(t)) IN ('RUB', 'RUR', 'РУБ') THEN 'RUB'
    ELSE upper(btrim(t))
  END
$$;

-- Payment type text ('Наличный', 'наличные', 'cash', 'Банковский счет', 'card', 'Перечисление', ...) -> 'cash' | 'bank' | ''
CREATE OR REPLACE FUNCTION fin_pt(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN fin_key(t) ~ '^(нал|cash|naq)' THEN 'cash'
    WHEN fin_key(t) ~ '^(банк|bank|card|карт|переч|o''tkaz|otkaz|transfer)' THEN 'bank'
    ELSE ''
  END
$$;

CREATE OR REPLACE FUNCTION fin_valid(y int, mo int, d int, h int, mi int) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT y BETWEEN 1900 AND 2200 AND mo BETWEEN 1 AND 12 AND h BETWEEN 0 AND 23 AND mi BETWEEN 0 AND 59
    AND d BETWEEN 1 AND extract(day FROM (make_date(y, CASE WHEN mo BETWEEN 1 AND 12 THEN mo ELSE 1 END, 1) + interval '1 month - 1 day'))::int
$$;

-- Any stored date text -> local (Asia/Tashkent, UTC+5, no DST) timestamp.
-- utc = treat a zone-less "YYYY-MM-DD HH:MM:SS" as UTC (created_at columns).
CREATE OR REPLACE FUNCTION fin_ts(t text, utc boolean DEFAULT false) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  s text := btrim(replace(replace(coalesce(t, ''), chr(160), ' '), chr(8239), ' '));
  m text[];
  mo int;
  off int := 0;
  z text;
  ts timestamp;
  shape text := translate(s, '0123456789', '0000000000');
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  -- Fast path (no regex) for the machine-written formats: YYYY-MM-DD,
  -- YYYY-MM-DD[T ]HH:MM[:SS[.fff]][Z] (toISOString, datetime('now'), datetime-local).
  IF shape = '0000-00-00' OR left(shape, 16) IN ('0000-00-00T00:00', '0000-00-00 00:00')
     AND substr(shape, 17) IN ('', 'Z', ':00', ':00Z', ':00.000Z', ':00.000', ':00.000000', ':00.000000Z') THEN
    IF NOT fin_valid(substr(s, 1, 4)::int, substr(s, 6, 2)::int, substr(s, 9, 2)::int, coalesce(nullif(substr(s, 12, 2), '')::int, 0), coalesce(nullif(substr(s, 15, 2), '')::int, 0))
       OR coalesce(nullif(substr(s, 18, 2), '')::int, 0) > 59 THEN
      RETURN NULL;
    END IF;
    ts := make_timestamp(substr(s, 1, 4)::int, substr(s, 6, 2)::int, substr(s, 9, 2)::int, coalesce(nullif(substr(s, 12, 2), '')::int, 0),
                         coalesce(nullif(substr(s, 15, 2), '')::int, 0), coalesce(nullif(substr(s, 18, 2), '')::int, 0));
    IF right(s, 1) = 'Z' OR (utc AND length(s) > 10) THEN RETURN ts + interval '5 hours'; END IF;
    RETURN ts;
  END IF;
  m := regexp_match(s, '^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?)?\\s*([Zz]|[+-]\\d{2}(?::?\\d{2})?)?$');
  IF m IS NOT NULL THEN
    IF NOT fin_valid(m[1]::int, m[2]::int, m[3]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0)) OR coalesce(m[6]::int, 0) > 59 THEN RETURN NULL; END IF;
    ts := make_timestamp(m[1]::int, m[2]::int, m[3]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0), coalesce(m[6]::int, 0));
    IF m[7] IS NOT NULL OR (utc AND m[4] IS NOT NULL) THEN
      IF m[7] IS NOT NULL AND upper(m[7]) <> 'Z' THEN
        z := replace(m[7], ':', '');
        off := (CASE WHEN left(z, 1) = '-' THEN -1 ELSE 1 END) * (substr(z, 2, 2)::int * 60 + coalesce(nullif(substr(z, 4, 2), '')::int, 0));
      END IF;
      RETURN ts - make_interval(mins => off) + interval '5 hours';
    END IF;
    RETURN ts;
  END IF;
  m := regexp_match(s, '^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})(?:[ ,]+(\\d{1,2}):(\\d{2}))?');
  IF m IS NOT NULL THEN
    IF NOT fin_valid(m[3]::int, m[2]::int, m[1]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0)) THEN RETURN NULL; END IF;
    RETURN make_timestamp(m[3]::int, m[2]::int, m[1]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0), 0);
  END IF;
  m := regexp_match(s, '^(\\d{1,2})\\s+([^\\s\\d.,]+)\\.?\\s+(\\d{4})(?:\\s*г\\.?)?(?:\\s*,?\\s*(\\d{1,2}):(\\d{2}))?', 'i');
  IF m IS NOT NULL THEN
    mo := CASE lower(left(m[2], 3))
      WHEN 'янв' THEN 1 WHEN 'фев' THEN 2 WHEN 'мар' THEN 3 WHEN 'апр' THEN 4 WHEN 'мая' THEN 5 WHEN 'май' THEN 5
      WHEN 'июн' THEN 6 WHEN 'июл' THEN 7 WHEN 'авг' THEN 8 WHEN 'сен' THEN 9 WHEN 'окт' THEN 10 WHEN 'ноя' THEN 11 WHEN 'дек' THEN 12
      ELSE NULL END;
    IF mo IS NULL OR NOT fin_valid(m[3]::int, mo, m[1]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0)) THEN RETURN NULL; END IF;
    RETURN make_timestamp(m[3]::int, mo, m[1]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0), 0);
  END IF;
  RETURN NULL;
END
$$;

-- "1 171 800 SUM" / "788,39 USD" / "1 000 SUM, 12 USD" -> (currency, amount) rows.
-- currency is NULL when the text has no currency suffix.
CREATE OR REPLACE FUNCTION fin_amounts(t text) RETURNS TABLE(currency text, amount double precision) LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT fin_cur(substring(p FROM '([^\\s\\d.,-]+)\\s*$')),
         CASE WHEN x.n ~ '^-?\\d+(\\.\\d+)?$' THEN x.n::double precision ELSE 0 END
  FROM regexp_split_to_table(replace(replace(coalesce(t, ''), chr(160), ' '), chr(8239), ' '), ',\\s+') AS p,
       LATERAL (SELECT replace(regexp_replace(coalesce(substring(p FROM '^\\s*(-?[\\d\\s.,]*\\d)'), ''), '\\s', '', 'g'), ',', '.') AS n) AS x
  WHERE p ~ '\\d'
$$;

-- '[1, 2, 3]' (JSON id array stored as text) -> 1, 2, 3
CREATE OR REPLACE FUNCTION fin_ids(t text) RETURNS SETOF integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (m[1])::int FROM regexp_matches(coalesce(t, ''), '(\\d{1,9})', 'g') AS m
$$;

CREATE OR REPLACE FUNCTION fin_schema_version() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT ${FIN_SCHEMA_VERSION} $$;
`

/** Shared "№" of every cash operation (cash entries, customer/supplier
 * payments, acceptances, transfers): one sequence, so numbers never collide
 * across sources. ADD COLUMN with this volatile default numbers existing rows. */
export const CASH_DOC_SEQUENCE = "cash_doc_seq"
const CASH_DOC_NO = `BIGINT DEFAULT nextval('${CASH_DOC_SEQUENCE}')`

/** Columns the finance foundation adds to existing money tables. Page repos
 * that create one of these tables lazily should call
 * ensureLedgerExtensions(db) right after their CREATE TABLE so new rows can
 * carry the fields; readers tolerate their absence. */
export const LEDGER_EXTENSIONS: Record<string, Record<string, string>> = {
  // Group payments ("Групповой приход") write here; client_id/cashbox_id make
  // the link exact instead of by display name. The cash core (lib/cash) adds
  // the rest: shared document number, operation type, debt-currency override
  // (amount/currency = credited to the client, real_* = cash in the cashbox),
  // agent acceptance batch and soft delete. See scratchpad cash/core.md.
  customer_payments: {
    client_id: "INTEGER",
    cashbox_id: "INTEGER",
    branch: "TEXT NOT NULL DEFAULT ''",
    delivery_man: "TEXT NOT NULL DEFAULT ''",
    income_category: "TEXT NOT NULL DEFAULT ''",
    payment_date: "TEXT NOT NULL DEFAULT ''",
    doc_no: CASH_DOC_NO,
    op_type: "INTEGER",
    order_id: "INTEGER",
    contract_id: "INTEGER",
    contract: "TEXT NOT NULL DEFAULT ''",
    income_category_id: "INTEGER",
    delivery_man_id: "INTEGER",
    real_amount: "DOUBLE PRECISION",
    real_currency: "TEXT NOT NULL DEFAULT ''",
    custom_rate: "DOUBLE PRECISION",
    debt_rate: "DOUBLE PRECISION",
    rate_type: "TEXT NOT NULL DEFAULT ''",
    agent_cashbox_id: "INTEGER",
    accepted_by: "TEXT NOT NULL DEFAULT ''",
    accept_id: "INTEGER",
    client_confirmation: "TEXT NOT NULL DEFAULT ''",
    invoice_date: "TEXT NOT NULL DEFAULT ''",
    is_deleted: "INTEGER NOT NULL DEFAULT 0",
    deleted_at: "TEXT NOT NULL DEFAULT ''",
    deleted_by: "TEXT NOT NULL DEFAULT ''",
  },
  cash_management_entries: {
    created_by: "TEXT NOT NULL DEFAULT ''",
    doc_no: CASH_DOC_NO,
    // NULL = legacy row (type derived from category/sign by the readers).
    op_type: "INTEGER",
    income_category_id: "INTEGER",
    expense_category_id: "INTEGER",
    client_id: "INTEGER",
    supply_id: "INTEGER",
    supply_expense_id: "INTEGER",
    employee_id: "INTEGER",
    employee_name: "TEXT NOT NULL DEFAULT ''",
    transfer_id: "INTEGER",
    currency: "TEXT NOT NULL DEFAULT ''",
    payment_type: "TEXT NOT NULL DEFAULT ''",
    internal_amount: "DOUBLE PRECISION",
    custom_rate: "DOUBLE PRECISION",
    rate_type: "TEXT NOT NULL DEFAULT ''",
    is_verified: "INTEGER NOT NULL DEFAULT 1",
    verified_at: "TEXT NOT NULL DEFAULT ''",
    verified_by: "TEXT NOT NULL DEFAULT ''",
    is_deleted: "INTEGER NOT NULL DEFAULT 0",
    deleted_at: "TEXT NOT NULL DEFAULT ''",
    deleted_by: "TEXT NOT NULL DEFAULT ''",
    amortization_from: "TEXT NOT NULL DEFAULT ''",
    amortization_to: "TEXT NOT NULL DEFAULT ''",
  },
  // Supplier money (cash «Расход» with a provider/supply option, paid money
  // requests, provider refunds as amount < 0). amount/currency = credited to
  // the supplier; real_* = cash taken from cashbox_id.
  supplier_payments: {
    doc_no: CASH_DOC_NO,
    op_type: "INTEGER",
    supplier_id: "INTEGER",
    cashbox_id: "INTEGER",
    supply_id: "INTEGER",
    money_request_id: "INTEGER",
    expense_category_id: "INTEGER",
    income_category_id: "INTEGER",
    category: "TEXT NOT NULL DEFAULT ''",
    branch: "TEXT NOT NULL DEFAULT ''",
    payment_date: "TEXT NOT NULL DEFAULT ''",
    real_amount: "DOUBLE PRECISION",
    real_currency: "TEXT NOT NULL DEFAULT ''",
    custom_rate: "DOUBLE PRECISION",
    debt_rate: "DOUBLE PRECISION",
    rate_type: "TEXT NOT NULL DEFAULT ''",
    internal_amount: "DOUBLE PRECISION",
    is_verified: "INTEGER NOT NULL DEFAULT 1",
    verified_at: "TEXT NOT NULL DEFAULT ''",
    verified_by: "TEXT NOT NULL DEFAULT ''",
    is_deleted: "INTEGER NOT NULL DEFAULT 0",
    deleted_at: "TEXT NOT NULL DEFAULT ''",
    deleted_by: "TEXT NOT NULL DEFAULT ''",
  },
  supplier_balance_transactions: {
    payment_type: "TEXT NOT NULL DEFAULT ''",
    organization: "TEXT NOT NULL DEFAULT ''",
    branch: "TEXT NOT NULL DEFAULT ''",
    created_by: "TEXT NOT NULL DEFAULT ''",
    // fund_request: pending | approved | given | cancelled ('' = pending, legacy 'rejected' = cancelled)
    status: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''",
    responsible_user: "TEXT NOT NULL DEFAULT ''",
    approved_at: "TEXT NOT NULL DEFAULT ''",
    payment_id: "INTEGER",
    log: "TEXT NOT NULL DEFAULT '[]'",
  },
  // Manual movements can be soft-deleted ("Удалить" of the movement dialog); a loyalty movement the same way.
  loyalty_card_transactions: {
    is_deleted: "INTEGER NOT NULL DEFAULT 0",
  },
  vansell_transactions: {
    is_deleted: "INTEGER NOT NULL DEFAULT 0",
    type: "TEXT NOT NULL DEFAULT 'none_type'",
    comment: "TEXT NOT NULL DEFAULT ''",
    created_date: "TEXT NOT NULL DEFAULT ''",
    created_by: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''",
  },
  employee_balance_transactions: {
    type: "TEXT NOT NULL DEFAULT 'none_type'",
    created_by: "TEXT NOT NULL DEFAULT ''",
  },
  branch_balance_transactions: {
    created_by: "TEXT NOT NULL DEFAULT ''",
  },
  // Contract 6: orders link their client by id (the orders module writes it;
  // the name stays as a snapshot). Rows without it are filled by name below
  // (backfillOrderClients), so renaming a client keeps its orders.
  orders: {
    client_id: "INTEGER",
  },
}

/** Every table the ledger reads (most are created lazily by their own repo). */
const LEDGER_TABLES = [
  "demo_seed_rows",
  "currencies",
  "cashboxes",
  "cash_management_entries",
  "clients",
  "client_types",
  "contracts",
  "orders",
  "order_items",
  "customer_payments",
  "client_payments",
  "client_bulk_payments",
  "account_bulk_payments",
  "loyalty_card_transactions",
  "suppliers",
  "supplier_incomings",
  "supplier_incoming_expenses",
  "supplier_returns",
  "supplier_payments",
  "supplier_balance_transactions",
  "employees",
  "vansell_transactions",
  "employee_balance_transactions",
  "salary_credits",
  "branches",
  "branch_balance_transactions",
  "warehouses",
  "internal_transfers",
  "write_offs",
  "production_movements",
  "production_parties",
  "products",
  "organizations",
  // cash core (lib/cash): per-employee allocations of staff cash entries
  "cash_entry_staff",
  // "Долги доставщиков" corrections (lib/finance-deliverer-debts.ts)
  "deliverer_balance_transactions",
  // client balance corrections ("Сверка магазина через бот": Списать / Добавить,
  // "Установить долг с Excel"; lib/finance-store-reconciliation.ts)
  "client_balance_corrections",
  // The reference's own cash transactions (scripts/demo/apply-final-cash-list.mjs): the cashbox ledger reads them instead of the
  // demo/legacy rows at or below the cut-off ids of the real tables (lib/finance/sources.ts cashboxSources).
  "cash_reference_rows",
  "cash_list_cutoff",
  // client returns (Продажи → Возвраты, sales module): accepted ones credit the client
  "client_returns",
  "client_return_items",
]

export type FinanceSchema = {
  has(table: string): boolean
  col(table: string, column: string): boolean
}

declare global {
  var __linkoFinanceFunctions: { version: number; ready: Promise<void> } | undefined
}

async function installFunctions(): Promise<void> {
  const db = getDb()
  const current = (await db.prepare("SELECT to_regprocedure('fin_schema_version()') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (current.ok) {
    const version = (await db.prepare("SELECT fin_schema_version() AS v").get()) as { v: number }
    if (Number(version.v) >= FIN_SCHEMA_VERSION) return
  }
  // Several dev-server workers may race here; the advisory lock serialises
  // the CREATE OR REPLACE statements ("tuple concurrently updated").
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(72120901)")
    await tx.exec(FUNCTIONS_SQL)
  })
}

function ensureFunctions(): Promise<void> {
  // Keyed by version so a dev server picks up changed functions after HMR.
  if (globalThis.__linkoFinanceFunctions?.version !== FIN_SCHEMA_VERSION) {
    const ready = installFunctions().catch((error) => {
      globalThis.__linkoFinanceFunctions = undefined
      throw error
    })
    globalThis.__linkoFinanceFunctions = { version: FIN_SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoFinanceFunctions!.ready
}

async function introspect(db: PgDb, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = (await db
    .prepare(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ANY(@tables::text[])`,
    )
    .all({ tables })) as Array<{ table_name: string; column_name: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    let columns = map.get(row.table_name)
    if (!columns) map.set(row.table_name, (columns = new Set()))
    columns.add(row.column_name)
  }
  return map
}

async function addMissingColumns(db: PgDb, map: Map<string, Set<string>>): Promise<boolean> {
  let changed = false
  let sequenceReady = false
  for (const [table, columns] of Object.entries(LEDGER_EXTENSIONS)) {
    const existing = map.get(table)
    if (!existing) continue
    for (const [column, ddl] of Object.entries(columns)) {
      if (existing.has(column)) continue
      if (!sequenceReady && ddl.includes(CASH_DOC_SEQUENCE)) {
        await db.exec(`CREATE SEQUENCE IF NOT EXISTS ${CASH_DOC_SEQUENCE}`)
        sequenceReady = true
      }
      await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${ddl}`)
      changed = true
    }
  }
  return changed
}

/** Adds the LEDGER_EXTENSIONS columns to whichever of their tables exist.
 * Idempotent and cheap when nothing is missing (one catalog query). */
export async function ensureLedgerExtensions(db: PgDb = getDb()): Promise<void> {
  const map = await introspect(db, Object.keys(LEDGER_EXTENSIONS))
  await addMissingColumns(db, map)
}

declare global {
  var __linkoOrderClientBackfillAt: number | undefined
}

/** Minimum pause between two order → client backfills of one process. */
const ORDER_CLIENT_BACKFILL_MS = 2000

/** Orders link their client by orders.client_id (contract 6; the orders
 * module writes it). Rows without it — written before the column existed or
 * by a writer that does not set it — get the id the ledger would match by
 * name (lowest client id with that name) as soon as a finance read or write
 * runs, so renaming the client later keeps them. Runs on the caller's
 * connection (it may be a transaction), at most every couple of seconds per
 * process; rows locked by other transactions are skipped until the next run.
 * Only NULLs are filled (orders of a client that does not exist stay NULL and
 * are matched by name); idempotent. */
async function backfillOrderClients(db: PgDb, map: Map<string, Set<string>>): Promise<void> {
  if (!map.get("orders")?.has("client_id") || !map.get("orders")?.has("client") || !map.get("clients")?.has("name")) return
  const now = Date.now()
  if (now - (globalThis.__linkoOrderClientBackfillAt ?? 0) < ORDER_CLIENT_BACKFILL_MS) return
  globalThis.__linkoOrderClientBackfillAt = now
  await db.exec(
    `UPDATE orders o SET client_id = m.client_id
       FROM (SELECT x.id, k.id AS client_id
               FROM orders x
               JOIN (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1) k ON k.k = fin_key(x.client)
              WHERE x.client_id IS NULL
              FOR UPDATE OF x SKIP LOCKED) m
      WHERE o.id = m.id AND o.client_id IS NULL`,
  )
}

/** Installs the fin_* SQL functions (once per process), adds missing
 * extension columns and returns which ledger tables/columns exist. Call at
 * the start of every finance read or write. */
export async function ensureFinanceSchema(db: PgDb = getDb()): Promise<FinanceSchema> {
  await ensureFunctions()
  let map = await introspect(db, LEDGER_TABLES)
  if (await addMissingColumns(db, map)) map = await introspect(db, LEDGER_TABLES)
  await backfillOrderClients(db, map)
  return {
    has: (table) => map.has(table),
    col: (table, column) => map.get(table)?.has(column) ?? false,
  }
}
