import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
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

export function parseBranchInput(body: unknown): BranchInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return {
    name,
    priceList: typeof value.priceList === "string" ? value.priceList : "",
    currency: toCurrency(typeof value.currency === "string" ? value.currency : ""),
    debtTracking: typeof value.debtTracking === "boolean" ? value.debtTracking : true,
    isMain: typeof value.isMain === "boolean" ? value.isMain : false,
    locationLat: typeof value.locationLat === "number" ? value.locationLat : null,
    locationLng: typeof value.locationLng === "number" ? value.locationLng : null,
  }
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

export async function createBranch(input: BranchInput): Promise<BranchRecord> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO branches (name, price_list, currency, debt_tracking, is_main, location_lat, location_lng)
       VALUES (@name, @priceList, @currency, @debtTracking, @isMain, @locationLat, @locationLng)`,
      )
      .run({
        name: input.name,
        priceList: input.priceList,
        currency: input.currency,
        debtTracking: input.debtTracking ? 1 : 0,
        isMain: input.isMain ? 1 : 0,
        locationLat: input.locationLat,
        locationLng: input.locationLng,
      }))
  return (await getBranch(Number(result.lastInsertRowid)))!
}

export async function updateBranch(id: number, input: BranchInput): Promise<BranchRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getBranch(id))) return null
  await db.prepare(
        `UPDATE branches SET name = @name, price_list = @priceList, currency = @currency,
      debt_tracking = @debtTracking, is_main = @isMain, location_lat = @locationLat, location_lng = @locationLng,
      updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        priceList: input.priceList,
        currency: input.currency,
        debtTracking: input.debtTracking ? 1 : 0,
        isMain: input.isMain ? 1 : 0,
        locationLat: input.locationLat,
        locationLng: input.locationLng,
      })
  return (await getBranch(id))
}

export async function deleteBranch(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  await db.prepare("DELETE FROM branch_plans WHERE branch_id = ?").run(id)
  const removed = (await db.prepare("DELETE FROM branches WHERE id = ?").run(id)).changes > 0
  if (removed) {
    // "KPI план филиалов" rows of the branch go with it (those tables are created lazily by the KPI plans module).
    for (const table of ["branch_kpi_plans", "branch_kpi_balances"]) {
      try {
        await db.prepare(`DELETE FROM ${table} WHERE branch_id = ?`).run(id)
      } catch {
        // table not created yet — nothing to remove
      }
    }
  }
  return removed
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
