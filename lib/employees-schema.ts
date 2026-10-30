import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"

// The employees table (lib/db.ts) plus the columns the Сотрудники pages need: access right and job ids,
// branch / organization ids and a JSON blob with the rest of the reference user (supervisor, stocks, price lists, ...).
// lib/db.ts BOOTSTRAP_COLUMNS creates the same columns up front (other modules, e.g. /api/auth/me, read them);
// keep both in step. The DDL runs once per process on the maintenance pool (outsideTransaction), never inside
// a request transaction; on a current database lib/ddl-skip.ts finds every column and runs nothing.
const DDL = `
  ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS access_right_id INTEGER,
    ADD COLUMN IF NOT EXISTS job_id INTEGER,
    ADD COLUMN IF NOT EXISTS branch_ids TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS organization_ids TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS details TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoEmployeesSchema: { version: number; ready: Promise<void> } | undefined
}

/** Prepares the employees columns once per process (a failed attempt is retried by the next call).
 * Call it before opening a transaction that reads them. */
export function ensureEmployeesSchema(): Promise<void> {
  const current = globalThis.__linkoEmployeesSchema
  if (current?.version === SCHEMA_VERSION) return current.ready
  const ready = outsideTransaction(() => getDb().exec(DDL)).catch((error) => {
    if (globalThis.__linkoEmployeesSchema?.ready === ready) globalThis.__linkoEmployeesSchema = undefined
    throw error
  })
  globalThis.__linkoEmployeesSchema = { version: SCHEMA_VERSION, ready }
  return ready
}
