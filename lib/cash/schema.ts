import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { CASH_DOC_SEQUENCE, ensureFinanceSchema, ensureLedgerExtensions, type FinanceSchema } from "@/lib/finance/schema"

// Lazily created schema of the cash core. The money columns the ledger reads
// live in lib/finance/schema.ts (LEDGER_EXTENSIONS); this file adds the cash
// core's own tables and helpers:
//   cash_transfers       header of a "Перевод" (two cash_management_entries legs share transfer_id)
//   cash_acceptances     header of an agent-cash acceptance (type 8); the money is the accepted
//                        customer_payments rows with accept_id = id (the ledger never reads this table)
//   cash_entry_staff     per-employee allocation of a staff_expense / staff_income cash entry
//                        (ledger: employee "Введено с кассы")
//   cash_entry_children  detalization lines of a transaction_child cash entry
//   income_categories.options / expense_categories.options  JSON array of option keys, kept in sync
//                        with `parameter` by a trigger for writers that only know `parameter`
//   loyalty_card_transactions.transaction_id / supplier_incoming_expenses.transaction_id  links
//   amount columns REAL → double precision (REAL keeps ~7 significant digits)
// Everything is idempotent (IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks)
// and works on an empty database as well as on an existing one. Tables owned by
// other modules (supplier_incoming_expenses) may appear after this ran: writers
// call ensureSupplyExpenseLink() before touching their link column.
// REPAIRS (idempotent data fixes of rows written by older versions):
//   - an agent-cash acceptance left without live payments is soft-deleted;
//   - paid money requests / cashback payouts saved without an expense category
//     get the first category with the matching option (provider / cashback);
//   - an order payment saved without an organization gets the order's one, and
//     with a single organization every cash document without one gets it
//     (newer writers default it themselves: resolveOrganization in common.ts);
//   - ORG_REPAIRS: other live cash documents without an organization get the one
//     the writers would pick today (client's contracts / agent / supplier, else
//     the cashbox cashier's single organization). Best effort: a failure only
//     logs a warning and never blocks the schema.

const CASH_SCHEMA_VERSION = 5

const DDL = `
CREATE SEQUENCE IF NOT EXISTS ${CASH_DOC_SEQUENCE};

CREATE TABLE IF NOT EXISTS cash_management_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashbox_id INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  entry_date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_card_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'sum',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no BIGINT DEFAULT nextval('${CASH_DOC_SEQUENCE}'),
  from_cashbox_id INTEGER NOT NULL,
  to_cashbox_id INTEGER NOT NULL,
  from_currency TEXT NOT NULL DEFAULT '',
  to_currency TEXT NOT NULL DEFAULT '',
  amount_from DOUBLE PRECISION NOT NULL,
  amount_to DOUBLE PRECISION NOT NULL,
  rate DOUBLE PRECISION,
  percentage DOUBLE PRECISION NOT NULL DEFAULT 0,
  from_organization TEXT NOT NULL DEFAULT '',
  to_organization TEXT NOT NULL DEFAULT '',
  from_branch TEXT NOT NULL DEFAULT '',
  to_branch TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  accumulated_from TEXT NOT NULL DEFAULT '',
  accumulated_to TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cash_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no BIGINT DEFAULT nextval('${CASH_DOC_SEQUENCE}'),
  cashbox_id INTEGER NOT NULL,
  agent TEXT NOT NULL DEFAULT '',
  agent_id INTEGER,
  agent_cashbox_id INTEGER,
  organization TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  delivery_man TEXT NOT NULL DEFAULT '',
  delivery_man_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cash_entry_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES cash_management_entries(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cash_entry_staff_entry_idx ON cash_entry_staff (entry_id);
CREATE INDEX IF NOT EXISTS cash_entry_staff_employee_idx ON cash_entry_staff (employee_id);

CREATE TABLE IF NOT EXISTS cash_entry_children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES cash_management_entries(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cash_entry_children_entry_idx ON cash_entry_children (entry_id);

-- Archived reference operations of the cash management list (read-only; the ledger never reads this table:
-- cashbox balances come from the real tables). cash_list_cutoff = the highest id per source at import time:
-- rows of the real tables above it are new operations and appear in the list next to the reference rows.
CREATE TABLE IF NOT EXISTS cash_reference_rows (
  id INTEGER PRIMARY KEY,
  op INTEGER NOT NULL,
  ts TIMESTAMP,
  cts TIMESTAMP,
  cby TEXT NOT NULL DEFAULT '',
  cashbox_id INTEGER NOT NULL,
  pt TEXT NOT NULL DEFAULT 'cash',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  base_amount DOUBLE PRECISION,
  rate DOUBLE PRECISION,
  client_id INTEGER,
  client_name TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER,
  supplier_name TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  category_kind TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  employee_id INTEGER,
  employee_name TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  supply_id INTEGER,
  supply_expense_id INTEGER,
  money_request_id INTEGER,
  contract TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 1,
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS cash_list_cutoff (
  src TEXT PRIMARY KEY,
  max_id INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE income_categories ADD COLUMN IF NOT EXISTS options TEXT;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS options TEXT;

-- Category "parameter" label (or raw option key) -> JSON array of option keys.
-- Keep in sync with PARAMETER_OPTIONS in lib/cash/types.ts.
CREATE OR REPLACE FUNCTION cash_param_options(p text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE fin_key(p)
    WHEN '' THEN '[]'
    WHEN 'детализация' THEN '["transaction_child"]'
    WHEN 'клиент' THEN '["client"]'
    WHEN 'заказ' THEN '["order"]'
    WHEN 'доп. расход' THEN '["supply_expense"]'
    WHEN 'расход на сотрудников' THEN '["staff_expense"]'
    WHEN 'поставка' THEN '["supply","provider"]'
    WHEN 'поставщик' THEN '["provider"]'
    WHEN 'карта клиента' THEN '["client_card_out"]'
    WHEN 'выдача денег для кэшбек' THEN '["client_contract"]'
    WHEN 'кэшбек' THEN '["client_contract"]'
    WHEN 'амортизация' THEN '["amortization"]'
    WHEN 'возврат от сотрудников' THEN '["staff_income"]'
    WHEN 'supply_expanse' THEN '["supply_expense"]'
    ELSE CASE WHEN fin_key(p) IN ('client', 'client_card_out', 'client_contract', 'provider', 'supply', 'order', 'supply_expense',
                                  'staff_expense', 'staff_income', 'transaction_child', 'amortization')
              THEN '["' || fin_key(p) || '"]' ELSE '[]' END
  END
$$;

-- Writers that only know "parameter" (the categories pages) keep options in
-- sync; a writer that sets options itself (without changing parameter) wins.
CREATE OR REPLACE FUNCTION cash_category_options_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.options IS NULL THEN NEW.options := cash_param_options(NEW.parameter); END IF;
  ELSIF NEW.parameter IS DISTINCT FROM OLD.parameter AND NEW.options IS NOT DISTINCT FROM OLD.options THEN
    NEW.options := cash_param_options(NEW.parameter);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER cash_income_category_options BEFORE INSERT OR UPDATE ON income_categories
  FOR EACH ROW EXECUTE FUNCTION cash_category_options_sync();
CREATE OR REPLACE TRIGGER cash_expense_category_options BEFORE INSERT OR UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION cash_category_options_sync();

UPDATE income_categories SET options = cash_param_options(parameter) WHERE options IS NULL;
UPDATE expense_categories SET options = cash_param_options(parameter) WHERE options IS NULL;

ALTER TABLE loyalty_card_transactions ADD COLUMN IF NOT EXISTS transaction_id INTEGER;

-- The single organization of an employees.organizations value (JSON array or
-- comma list), '' when none or several. Mirrors organizationsOfEmployee() in common.ts.
CREATE OR REPLACE FUNCTION cash_single_org(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE names text[];
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN RETURN ''; END IF;
  BEGIN
    SELECT array_agg(DISTINCT fin_place(v)) INTO names FROM json_array_elements_text(raw::json) AS v WHERE fin_place(v) <> '';
  EXCEPTION WHEN others THEN
    SELECT array_agg(DISTINCT fin_place(v)) INTO names FROM unnest(string_to_array(raw, ',')) AS v WHERE fin_place(v) <> '';
  END;
  RETURN CASE WHEN cardinality(names) = 1 THEN names[1] ELSE '' END;
END
$$;

-- Only while missing: ALTER TABLE locks the table even when the column exists
-- (a caller's open transaction on it would hang this first install).
DO $$ BEGIN
  IF to_regclass('supplier_incoming_expenses') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'supplier_incoming_expenses' AND column_name = 'transaction_id'
  ) THEN
    ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS transaction_id INTEGER;
  END IF;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND data_type = 'real'
      AND (table_name, column_name) IN (('cash_management_entries', 'amount'), ('customer_payments', 'amount'),
        ('customer_payments', 'amount_sum_equivalent'), ('customer_payments', 'cash_amount'),
        ('supplier_payments', 'amount'), ('supplier_payments', 'cash_amount'), ('loyalty_card_transactions', 'amount'))
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE double precision', r.table_name, r.column_name);
  END LOOP;
END $$;
`

// Indexes on extension columns (exist only after ensureFinanceSchema ran).
const INDEXES = `
CREATE INDEX IF NOT EXISTS customer_payments_accept_idx ON customer_payments (accept_id);
CREATE INDEX IF NOT EXISTS customer_payments_order_idx ON customer_payments (order_id);
CREATE INDEX IF NOT EXISTS cash_management_entries_transfer_idx ON cash_management_entries (transfer_id);
CREATE INDEX IF NOT EXISTS cash_management_entries_cashbox_idx ON cash_management_entries (cashbox_id);
CREATE INDEX IF NOT EXISTS supplier_payments_request_idx ON supplier_payments (money_request_id);
`

// Idempotent repairs of rows written by older versions (see REPAIRS above).
const REPAIRS = `
UPDATE cash_acceptances a SET is_deleted = 1, deleted_at = to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD"T"HH24:MI:SS'),
       deleted_by = 'system', amount = 0, updated_at = datetime('now')
WHERE a.is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM customer_payments p WHERE p.accept_id = a.id AND p.is_deleted = 0);

WITH c AS (
  SELECT id, name FROM expense_categories
  WHERE options LIKE '%"provider"%' ORDER BY (options LIKE '%"supply"%'), id LIMIT 1
)
UPDATE supplier_payments sp SET expense_category_id = c.id, category = c.name
FROM c
WHERE sp.money_request_id IS NOT NULL AND sp.expense_category_id IS NULL AND sp.income_category_id IS NULL
  AND btrim(COALESCE(sp.category, '')) = '' AND sp.amount >= 0;

WITH c AS (
  SELECT id, name FROM expense_categories
  WHERE options LIKE '%"client_contract"%' OR options LIKE '%"client_card_out"%'
  ORDER BY (options NOT LIKE '%"client_contract"%'), id LIMIT 1
)
UPDATE cash_management_entries e SET expense_category_id = c.id, category = c.name
FROM c
WHERE e.op_type = 22 AND e.expense_category_id IS NULL AND btrim(COALESCE(e.category, '')) = '';

DO $$ DECLARE org_count int; only_org text; BEGIN
  IF to_regclass('orders') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'organization') THEN
    UPDATE customer_payments p SET organization = btrim(o.organization)
    FROM orders o
    WHERE p.order_id = o.id AND btrim(COALESCE(p.organization, '')) = '' AND btrim(COALESCE(o.organization, '')) <> '';
  END IF;
  IF to_regclass('organizations') IS NOT NULL THEN
    SELECT count(*), min(btrim(name)) INTO org_count, only_org FROM organizations;
    IF org_count = 1 AND COALESCE(only_org, '') <> '' THEN
      UPDATE customer_payments SET organization = only_org WHERE btrim(COALESCE(organization, '')) = '';
      UPDATE cash_management_entries SET organization = only_org WHERE btrim(COALESCE(organization, '')) = '';
      UPDATE supplier_payments SET organization = only_org WHERE btrim(COALESCE(organization, '')) = '';
      UPDATE cash_acceptances SET organization = only_org WHERE btrim(COALESCE(organization, '')) = '';
      UPDATE cash_transfers SET from_organization = only_org WHERE btrim(COALESCE(from_organization, '')) = '';
      UPDATE cash_transfers SET to_organization = only_org WHERE btrim(COALESCE(to_organization, '')) = '';
    END IF;
  END IF;
END $$;
`

// Organization of older cash documents saved without one (see ORG_REPAIRS above).
const ORG_REPAIRS = `
DO $$ BEGIN
  -- Scratch tables of this transaction only (dropped at COMMIT, gone on ROLLBACK).
  CREATE TEMP TABLE IF NOT EXISTS cash_org_cashbox (id int PRIMARY KEY, org text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS cash_org_client (id int PRIMARY KEY, org text NOT NULL) ON COMMIT DROP;
  TRUNCATE pg_temp.cash_org_cashbox, pg_temp.cash_org_client;
  -- The cashbox cashier's single organization.
  INSERT INTO pg_temp.cash_org_cashbox
    SELECT DISTINCT ON (cb.id) cb.id, cash_single_org(e.organizations)
    FROM cashboxes cb
    JOIN employees e ON e.id = NULLIF(to_jsonb(cb) ->> 'cashier_id', '')::int
      OR (NULLIF(to_jsonb(cb) ->> 'cashier_id', '') IS NULL AND fin_key(e.first_name || ' ' || e.last_name) = fin_key(cb.cashier))
    ORDER BY cb.id, e.id;
  DELETE FROM pg_temp.cash_org_cashbox WHERE org = '';
  -- The client's contracts when they all belong to one organization.
  IF to_regclass('contracts') IS NOT NULL THEN
    INSERT INTO pg_temp.cash_org_client
      SELECT c.id, min(fin_place(to_jsonb(k) ->> 'organization'))
      FROM clients c JOIN contracts k ON fin_key(to_jsonb(k) ->> 'client') = fin_key(c.name)
      WHERE COALESCE(to_jsonb(k) ->> 'status', '') <> 'cancelled' AND fin_place(to_jsonb(k) ->> 'organization') <> ''
      GROUP BY c.id HAVING count(DISTINCT fin_place(to_jsonb(k) ->> 'organization')) = 1;
  END IF;

  UPDATE customer_payments p SET organization = x.org
  FROM (
    SELECT p2.id, COALESCE(cl.org, NULLIF(ag.org, ''), cb.org) AS org
    FROM customer_payments p2
    LEFT JOIN pg_temp.cash_org_client cl ON cl.id = COALESCE(p2.client_id, (SELECT min(c.id) FROM clients c WHERE fin_key(c.name) = fin_key(p2.client)))
    LEFT JOIN LATERAL (
      SELECT cash_single_org(e.organizations) AS org FROM employees e
      -- The collecting agent, else the client's agent (collections written without one), else the creator.
      WHERE fin_key(e.first_name || ' ' || e.last_name) = fin_key(regexp_replace(COALESCE(NULLIF(btrim(p2.agent), ''),
        NULLIF((SELECT fin_place(c.agent) FROM clients c WHERE c.id = p2.client_id), ''), p2.created_by), '\\s*\\([^()]*\\)\\s*$', ''))
      ORDER BY e.id LIMIT 1
    ) ag ON true
    LEFT JOIN pg_temp.cash_org_cashbox cb ON cb.id = p2.cashbox_id
    WHERE p2.is_deleted = 0 AND btrim(COALESCE(p2.organization, '')) = ''
  ) x
  WHERE p.id = x.id AND x.org IS NOT NULL;

  UPDATE cash_management_entries e SET organization = x.org
  FROM (
    SELECT e2.id, COALESCE(cl.org, cb.org) AS org
    FROM cash_management_entries e2
    LEFT JOIN pg_temp.cash_org_client cl ON cl.id = e2.client_id
    LEFT JOIN pg_temp.cash_org_cashbox cb ON cb.id = e2.cashbox_id
    WHERE e2.is_deleted = 0 AND btrim(COALESCE(e2.organization, '')) = ''
  ) x
  WHERE e.id = x.id AND x.org IS NOT NULL;

  UPDATE supplier_payments sp SET organization = x.org
  FROM (
    SELECT sp2.id, COALESCE(NULLIF(fin_place(s.organization), ''), cb.org) AS org
    FROM supplier_payments sp2
    LEFT JOIN LATERAL (
      SELECT s1.organization FROM suppliers s1
      WHERE s1.id = sp2.supplier_id OR (sp2.supplier_id IS NULL AND fin_key(s1.name) = fin_key(sp2.supplier))
      ORDER BY s1.id LIMIT 1
    ) s ON true
    LEFT JOIN pg_temp.cash_org_cashbox cb ON cb.id = sp2.cashbox_id
    WHERE sp2.is_deleted = 0 AND btrim(COALESCE(sp2.organization, '')) = ''
  ) x
  WHERE sp.id = x.id AND x.org IS NOT NULL;

  UPDATE cash_transfers t SET from_organization = cb.org FROM pg_temp.cash_org_cashbox cb
  WHERE cb.id = t.from_cashbox_id AND btrim(COALESCE(t.from_organization, '')) = '';
  UPDATE cash_transfers t SET to_organization = cb.org FROM pg_temp.cash_org_cashbox cb
  WHERE cb.id = t.to_cashbox_id AND btrim(COALESCE(t.to_organization, '')) = '';
  UPDATE cash_acceptances a SET organization = cb.org FROM pg_temp.cash_org_cashbox cb
  WHERE cb.id = a.cashbox_id AND a.is_deleted = 0 AND btrim(COALESCE(a.organization, '')) = '';
EXCEPTION WHEN others THEN
  RAISE WARNING 'cash organization repair skipped: %', SQLERRM;
END $$;
`

declare global {
  var __linkoCashSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  const db = getDb()
  // fin_* functions (fin_key is used below) + ledger extension columns on the existing tables.
  await ensureFinanceSchema(db)
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await tx.exec(DDL)
  })
  // Extension columns of a cash_management_entries table created just now.
  await ensureLedgerExtensions(db)
  await db.exec(INDEXES)
  await syncDocSequence(db)
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await tx.exec(REPAIRS)
    await tx.exec(ORG_REPAIRS)
  })
}

/** Documents imported with explicit numbers (backfills) leave the shared sequence behind; a new payment would then get a
 * number below every existing one and sink to the end of the "№ desc" lists. Moves the sequence up to the highest number. */
async function syncDocSequence(db: PgDb): Promise<void> {
  const row = (await db
    .prepare(
      `SELECT GREATEST(COALESCE((SELECT MAX(doc_no) FROM cash_management_entries), 0), COALESCE((SELECT MAX(doc_no) FROM customer_payments), 0),
              COALESCE((SELECT MAX(doc_no) FROM supplier_payments), 0), COALESCE((SELECT MAX(doc_no) FROM cash_transfers), 0)) AS top_doc,
              (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${CASH_DOC_SEQUENCE}) AS current_doc`,
    )
    .get()) as { top_doc: string | number; current_doc: string | number } | undefined
  const top = Number(row?.top_doc ?? 0)
  if (top > Number(row?.current_doc ?? 0)) await db.exec(`SELECT setval('${CASH_DOC_SEQUENCE}', ${Math.trunc(top)})`)
}

/** supplier_incoming_expenses.transaction_id (cash entry paying the expense).
 * The table belongs to lib/supplier-incomings-repo.ts and may be created after
 * the cash schema was installed, so the column is (re)checked here before every
 * write that touches it. Returns false while the table does not exist. */
export async function ensureSupplyExpenseLink(tx: PgDb): Promise<boolean> {
  const row = (await tx
    .prepare(
      `SELECT to_regclass('supplier_incoming_expenses') IS NOT NULL AS table_ok,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                      AND table_name = 'supplier_incoming_expenses' AND column_name = 'transaction_id') AS column_ok`,
    )
    .get()) as { table_ok: boolean; column_ok: boolean }
  if (!row.table_ok) return false
  if (!row.column_ok) await tx.exec("ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS transaction_id INTEGER")
  return true
}

/** Creates/updates the cash core schema once per process (version-keyed) and
 * returns the ledger's table/column introspection. Call at the start of every
 * lib/cash operation. */
export async function ensureCashSchema(db: PgDb = getDb()): Promise<FinanceSchema> {
  if (globalThis.__linkoCashSchema?.version !== CASH_SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoCashSchema = undefined
      throw error
    })
    globalThis.__linkoCashSchema = { version: CASH_SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoCashSchema!.ready
  return ensureFinanceSchema(db)
}
