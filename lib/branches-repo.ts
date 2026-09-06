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
  `)
}

export type BranchCurrency = "SUM" | "USD" | "Euro"

export type BranchRecord = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: BranchCurrency
}

type Row = {
  id: number
  name: string
  price_list: string
  currency: string
  debt_tracking: number
  is_main: number
  created_at: string
}

function formatDate(raw: string): string {
  const date = new Date(`${raw.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date).replace(".", "")
}

function toCurrency(value: string): BranchCurrency {
  return value === "USD" || value === "Euro" ? value : "SUM"
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
  }
}

export type BranchInput = {
  name: string
  priceList: string
  currency: BranchCurrency
  debtTracking: boolean
  isMain: boolean
}

export function parseBranchInput(body: unknown): BranchInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return {
    name,
    priceList: typeof value.priceList === "string" ? value.priceList : "",
    currency: toCurrency(typeof value.currency === "string" ? value.currency : "SUM"),
    debtTracking: typeof value.debtTracking === "boolean" ? value.debtTracking : true,
    isMain: typeof value.isMain === "boolean" ? value.isMain : false,
  }
}

export async function listBranches(): Promise<BranchRecord[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM branches ORDER BY id DESC").all()) as Row[]).map(rowToBranch)
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
        `INSERT INTO branches (name, price_list, currency, debt_tracking, is_main)
       VALUES (@name, @priceList, @currency, @debtTracking, @isMain)`,
      )
      .run({
        name: input.name,
        priceList: input.priceList,
        currency: input.currency,
        debtTracking: input.debtTracking ? 1 : 0,
        isMain: input.isMain ? 1 : 0,
      }))
  return (await getBranch(Number(result.lastInsertRowid)))!
}

export async function updateBranch(id: number, input: BranchInput): Promise<BranchRecord | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getBranch(id))) return null
  await db.prepare(
        `UPDATE branches SET name = @name, price_list = @priceList, currency = @currency,
      debt_tracking = @debtTracking, is_main = @isMain, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        priceList: input.priceList,
        currency: input.currency,
        debtTracking: input.debtTracking ? 1 : 0,
        isMain: input.isMain ? 1 : 0,
      })
  return (await getBranch(id))
}

export async function deleteBranch(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM branches WHERE id = ?").run(id)).changes > 0
}
