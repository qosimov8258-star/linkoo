import "server-only"

import { getDb } from "@/lib/db"

// The employees table (lib/db.ts) plus the columns the Сотрудники pages need: access right and job ids,
// branch / organization ids and a JSON blob with the rest of the reference user (supervisor, stocks, price lists, ...).
const DDL = `
  ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS access_right_id INTEGER,
    ADD COLUMN IF NOT EXISTS job_id INTEGER,
    ADD COLUMN IF NOT EXISTS branch_ids TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS organization_ids TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS details TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
`

let ready: Promise<void> | null = null

export function ensureEmployeesSchema(): Promise<void> {
  ready ??= getDb().exec(DDL).catch((error) => {
    ready = null
    throw error
  })
  return ready
}
