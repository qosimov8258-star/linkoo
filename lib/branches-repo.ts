import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { cascadeNameRename, discoverReferences, keySql, nameKey, usageOf, type Usage } from "@/lib/platform-refs"

let schemaReady: Promise<void> | null = null

async function ensureSchema(db: ReturnType<typeof getDb>) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS branches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price_list TEXT NOT NULL DEFAULT '',
          currency TEXT NOT NULL DEFAULT 'SUM',
          debt_tracking INTEGER NOT NULL DEFAULT 1,
          is_main INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
        CREATE TABLE IF NOT EXISTS branch_plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          branch_id INTEGER NOT NULL,
          weight TEXT NOT NULL DEFAULT '',
          amount TEXT NOT NULL DEFAULT '',
          price TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      // One branch name per company (case- and space-insensitive) and at most
      // one main branch. Older databases with several mains keep the oldest;
      // an index is skipped (and the API still refuses new twins) while
      // duplicate names exist.
      await db.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'branches_one_main') THEN
            UPDATE branches SET is_main = 0
             WHERE is_main = 1 AND id <> (SELECT min(id) FROM branches WHERE is_main = 1);
            CREATE UNIQUE INDEX branches_one_main ON branches ((is_main)) WHERE is_main = 1;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'branches_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX branches_name_key ON branches (lower(btrim(name)));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'branches_name_key skipped: duplicate branch names exist';
            END;
          END IF;
        END $$;
      `)
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

/** Currency code from "Валюты" ("" = not set). */
export type BranchCurrency = string

export type BranchRecord = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: BranchCurrency
  locationLat: number | null
  locationLng: number | null
}

type Row = {
  id: number
  name: string
  price_list: string
  currency: string
  debt_tracking: number
  is_main: number
  created_at: string
  location_lat: number | null
  location_lng: number | null
}

export type BranchUsage = Usage

export class BranchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: BranchUsage[],
  ) {
    super(message)
  }
}

function formatDate(raw: string): string {
  const date = new Date(`${raw.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return raw
  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

// Names sort ignoring case and punctuation/spaces (the demo's DB collation); exact ties fall back to shorter, then id.
const nameCollator = new Intl.Collator("en", { ignorePunctuation: true, caseFirst: "lower" })

function toCurrency(value: string | null): BranchCurrency {
  return (value ?? "").trim()
}

function rowToBranch(row: Row): BranchRecord {
  return {
    id: row.id,
    name: row.name,
    date: formatDate(row.created_at),
    debtTracking: row.debt_tracking === 1,
    isMain: row.is_main === 1,
    priceList: row.price_list,
    currency: toCurrency(row.currency),
    locationLat: row.location_lat ?? null,
    locationLng: row.location_lng ?? null,
  }
}

export type BranchInput = {
  name: string
  priceList: string
  currency: BranchCurrency
  debtTracking: boolean
  isMain: boolean
  locationLat: number | null
  locationLng: number | null
}

/** Partial input of an update: omitted fields keep their current value. */
export type BranchPatch = Partial<BranchInput> & { name: string }

/** Columns that store a branch: text `branch`, `*_branch`, `branch_name`,
 * `*_branch_name` (by name) and integer `branch_id`, `*_branch_id` (by id). */
function branchReferences(db: PgDb) {
  return discoverReferences(
    db,
    `c.column_name IN ('branch', 'branch_name', 'branch_id')
       OR c.column_name LIKE '%\\_branch' OR c.column_name LIKE '%\\_branch\\_name' OR c.column_name LIKE '%\\_branch\\_id'`,
    "name",
    "branches",
  )
}

/** `byCreation` keeps the reference app's creation order (used by the client form/filter selects). */
export async function listBranches(options: { byCreation?: boolean } = {}): Promise<BranchRecord[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT * FROM branches").all()) as Row[]
  if (options.byCreation) rows.sort((a, b) => a.id - b.id)
  else rows.sort((a, b) => nameCollator.compare(a.name, b.name) || a.name.length - b.name.length || a.id - b.id)
  return rows.map(rowToBranch)
}

export async function getBranch(id: number): Promise<BranchRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToBranch(row) : null
}

/** Where the branch is used (warehouses, cashboxes, employees, suppliers, clients, balance entries …). */
export async function branchUsage(db: PgDb, branch: { id: number; name: string }): Promise<BranchUsage[]> {
  return usageOf(db, await branchReferences(db), { id: branch.id, name: branch.name })
}

async function lockBranches(db: PgDb) {
  await db.prepare("LOCK TABLE branches IN SHARE ROW EXCLUSIVE MODE").run()
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM branches WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new BranchError("Филиал с таким названием уже существует", 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new BranchError("Филиал с таким названием уже существует", 409)
  throw error
}

export async function createBranch(input: BranchInput): Promise<BranchRecord> {
  const db = getDb()
  await ensureSchema(db)
  try {
    const id = await withTransaction(async (tx) => {
      await lockBranches(tx)
      await assertNameFree(tx, input.name, 0)
      // The first branch of a company is its main branch; a new main replaces the old one.
      const hasMain = await tx.prepare("SELECT 1 FROM branches WHERE is_main = 1").get()
      const isMain = input.isMain || !hasMain
      if (isMain) await tx.prepare("UPDATE branches SET is_main = 0, updated_at = datetime('now') WHERE is_main = 1").run()
      const result = await tx
        .prepare(
          `INSERT INTO branches (name, price_list, currency, debt_tracking, is_main, location_lat, location_lng)
           VALUES (@name, @priceList, @currency, @debtTracking, @isMain, @locationLat, @locationLng)`,
        )
        .run({
          name: input.name,
          priceList: input.priceList,
          currency: input.currency,
          debtTracking: input.debtTracking ? 1 : 0,
          isMain: isMain ? 1 : 0,
          locationLat: input.locationLat,
          locationLng: input.locationLng,
        })
      return Number(result.lastInsertRowid)
    })
    return (await getBranch(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Updates the branch. A new name is carried into every record that stores the
 * branch by name; making it main unsets the previous main branch; the main
 * branch cannot be "un-mained" directly (make another branch main instead). */
export async function updateBranch(id: number, patch: BranchPatch): Promise<BranchRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  try {
    const found = await withTransaction(async (tx) => {
      await lockBranches(tx)
      const current = (await tx.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(patch.name)) await assertNameFree(tx, patch.name, id)
      const isMain = patch.isMain ?? current.is_main === 1
      if (!isMain && current.is_main === 1) {
        throw new BranchError("Нельзя снять признак основного филиала: сделайте основным другой филиал", 400)
      }
      if (isMain && current.is_main !== 1) {
        await tx.prepare("UPDATE branches SET is_main = 0, updated_at = datetime('now') WHERE is_main = 1 AND id <> ?").run(id)
      }
      await tx
        .prepare(
          `UPDATE branches SET name = @name, price_list = @priceList, currency = @currency,
             debt_tracking = @debtTracking, is_main = @isMain, location_lat = @locationLat, location_lng = @locationLng,
             updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({
          id,
          name: patch.name,
          priceList: patch.priceList ?? current.price_list,
          currency: patch.currency ?? toCurrency(current.currency),
          debtTracking: (patch.debtTracking ?? current.debt_tracking === 1) ? 1 : 0,
          isMain: isMain ? 1 : 0,
          locationLat: patch.locationLat === undefined ? (current.location_lat ?? null) : patch.locationLat,
          locationLng: patch.locationLng === undefined ? (current.location_lng ?? null) : patch.locationLng,
        })
      if (current.name !== patch.name) await cascadeNameRename(tx, await branchReferences(tx), current.name, patch.name)
      return true
    })
    return found ? await getBranch(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused while anything references the branch (409 with the usage list) and
 * always for the main branch. */
export async function deleteBranch(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return withTransaction(async (tx) => {
    await lockBranches(tx)
    const current = (await tx.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
    if (!current) return false
    if (current.is_main === 1) throw new BranchError("Нельзя удалить основной филиал", 409)
    // The branch's own plans and "KPI план филиалов" rows go with it (the KPI tables are created lazily by that module);
    // removed before the usage check so they do not count as usage, and rolled back if the delete is refused.
    await tx.prepare("DELETE FROM branch_plans WHERE branch_id = ?").run(id)
    for (const table of ["branch_kpi_plans", "branch_kpi_balances"]) {
      const exists = (await tx.prepare("SELECT to_regclass(?::text) IS NOT NULL AS ok").get(table)) as { ok: boolean } | undefined
      if (exists?.ok) await tx.prepare(`DELETE FROM ${table} WHERE branch_id = ?`).run(id)
    }
    const usage = await branchUsage(tx, current)
    if (usage.length) throw new BranchError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM branches WHERE id = ?").run(id)).changes > 0
  })
}

export type BranchPlan = { id: number; branchId: number; weight: string; amount: string; price: string }

type PlanRow = { id: number; branch_id: number; weight: string; amount: string; price: string }

const rowToPlan = (row: PlanRow): BranchPlan => ({ id: row.id, branchId: row.branch_id, weight: row.weight, amount: row.amount, price: row.price })

export async function listBranchPlans(branchId: number): Promise<BranchPlan[]> {
  const db = getDb()
  await ensureSchema(db)
  // Plans inserted by the demo seed (registered in demo_seed_rows) are not real data: the reference's branches have none.
  try {
    return ((await db.prepare("SELECT * FROM branch_plans WHERE branch_id = ? AND CAST(id AS TEXT) NOT IN (SELECT row_id FROM demo_seed_rows WHERE table_name = 'branch_plans') ORDER BY id").all(branchId)) as PlanRow[]).map(rowToPlan)
  } catch {
    return ((await db.prepare("SELECT * FROM branch_plans WHERE branch_id = ? ORDER BY id").all(branchId)) as PlanRow[]).map(rowToPlan)
  }
}

export async function createBranchPlan(branchId: number, input: { weight: string; amount: string; price: string }): Promise<BranchPlan | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getBranch(branchId))) return null
  const result = await db.prepare("INSERT INTO branch_plans (branch_id, weight, amount, price) VALUES (?, ?, ?, ?)").run(branchId, input.weight, input.amount, input.price)
  const row = (await db.prepare("SELECT * FROM branch_plans WHERE id = ?").get(Number(result.lastInsertRowid))) as PlanRow
  return rowToPlan(row)
}
