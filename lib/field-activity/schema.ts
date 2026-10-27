import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

// Tables of the field activity data (design: scratchpad personnel/design-field.md).
// Created lazily, once per process, on the maintenance pool (outsideTransaction) under an
// advisory lock, so parallel dev-server workers and a request transaction that waits for it
// never deadlock. Every statement is idempotent (fresh and existing databases alike). No other
// module reads these tables, so they are not part of the lib/db.ts bootstrap.

const SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS field_visits (
  id SERIAL PRIMARY KEY,
  client_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  start_accuracy DOUBLE PRECISION,
  finished_at TIMESTAMPTZ,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  end_accuracy DOUBLE PRECISION,
  result TEXT,
  order_id INTEGER,
  comment TEXT NOT NULL DEFAULT '',
  planned BOOLEAN NOT NULL DEFAULT false,
  client_lat DOUBLE PRECISION,
  client_lng DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_visits_result_check CHECK (result IS NULL OR result IN ('order', 'refusal', 'photo_report', 'no_sale')),
  CONSTRAINT field_visits_finish_check CHECK ((finished_at IS NULL) = (result IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS field_visits_key ON field_visits (employee_id, client_key);
CREATE UNIQUE INDEX IF NOT EXISTS field_visits_one_open ON field_visits (employee_id) WHERE finished_at IS NULL;
CREATE INDEX IF NOT EXISTS field_visits_employee_started ON field_visits (employee_id, started_at);
CREATE INDEX IF NOT EXISTS field_visits_started ON field_visits (started_at);
CREATE INDEX IF NOT EXISTS field_visits_client ON field_visits (client_id, started_at);

CREATE TABLE IF NOT EXISTS field_refusals (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER UNIQUE,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  refusal_type_id INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  happened_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_refusals_employee_at ON field_refusals (employee_id, happened_at);
CREATE INDEX IF NOT EXISTS field_refusals_at ON field_refusals (happened_at);
CREATE INDEX IF NOT EXISTS field_refusals_client ON field_refusals (client_id);

CREATE TABLE IF NOT EXISTS field_photo_reports (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER UNIQUE,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending',
  happened_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_photo_reports_employee_at ON field_photo_reports (employee_id, happened_at);
CREATE INDEX IF NOT EXISTS field_photo_reports_at ON field_photo_reports (happened_at);
CREATE INDEX IF NOT EXISTS field_photo_reports_client ON field_photo_reports (client_id);

CREATE TABLE IF NOT EXISTS field_photos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  data BYTEA NOT NULL,
  owner_kind TEXT,
  owner_id INTEGER,
  slot TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_photos_owner_check CHECK (owner_kind IS NULL OR owner_kind IN ('refusal', 'photo_report')),
  CONSTRAINT field_photos_slot_check CHECK (slot IS NULL OR slot IN ('refusal', 'before', 'after'))
);
CREATE UNIQUE INDEX IF NOT EXISTS field_photos_sha ON field_photos (employee_id, sha256);
CREATE INDEX IF NOT EXISTS field_photos_owner ON field_photos (owner_kind, owner_id);

CREATE TABLE IF NOT EXISTS field_gps_points (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  battery DOUBLE PRECISION,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS field_gps_points_employee_at ON field_gps_points (employee_id, recorded_at);

CREATE TABLE IF NOT EXISTS field_route_plans (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  weekdays INTEGER NOT NULL,
  interval_weeks INTEGER NOT NULL DEFAULT 1,
  start_date DATE NOT NULL,
  route_position INTEGER,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_route_plans_weekdays_check CHECK (weekdays BETWEEN 1 AND 127),
  CONSTRAINT field_route_plans_interval_check CHECK (interval_weeks BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX IF NOT EXISTS field_route_plans_employee_client ON field_route_plans (employee_id, client_id);
CREATE INDEX IF NOT EXISTS field_route_plans_client ON field_route_plans (client_id);
`

declare global {
  var __linkoFieldSchema: { version: number; ready: Promise<void> } | undefined
}

/** Creates the field tables and indexes once per process (idempotent, fresh-install safe).
 * Await it before opening a transaction that touches them. */
export function ensureFieldSchema(): Promise<void> {
  if (globalThis.__linkoFieldSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:field:schema'))")
        await tx.exec(DDL)
      }),
    ).catch((error) => {
      globalThis.__linkoFieldSchema = undefined
      throw error
    })
    globalThis.__linkoFieldSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoFieldSchema!.ready
}

/** Names of the tables above (for usage checks of other modules). */
export const FIELD_TABLES = ["field_visits", "field_refusals", "field_photo_reports", "field_photos", "field_gps_points", "field_route_plans"] as const

/** Columns of those of `tables` that exist (lazily created tables of other modules); a missing
 * table has no entry. */
export async function columnsOf(tables: readonly string[]): Promise<Map<string, Set<string>>> {
  const rows = (await getDb()
    .prepare(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY(@tables::text[])",
    )
    .all({ tables: [...tables] })) as Array<{ table_name: string; column_name: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    const columns = map.get(row.table_name) ?? new Set<string>()
    columns.add(row.column_name)
    map.set(row.table_name, columns)
  }
  return map
}
