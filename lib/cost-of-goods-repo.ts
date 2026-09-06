import "server-only"

import { getDb } from "@/lib/db"

export type CostOfGoodsRow = {
  id: number
  name: string
  warehouse: string
  date: string
  avgCost: number
  cost: number
  passed: boolean
  supplyNumber: string
  calculatedBalance: number
  actualBalance: number
  totalRevaluation: number
  lastCheckTime: string
}

type Row = {
  id: number
  name: string
  warehouse: string
  row_date: string
  avg_cost: number
  cost: number
  passed: number
  supply_number: string
  calculated_balance: number
  actual_balance: number
  total_revaluation: number
  last_check_time: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cost_of_goods_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      warehouse TEXT NOT NULL DEFAULT '',
      row_date TEXT NOT NULL,
      avg_cost REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      supply_number TEXT NOT NULL DEFAULT '',
      calculated_balance REAL NOT NULL DEFAULT 0,
      actual_balance REAL NOT NULL DEFAULT 0,
      total_revaluation REAL NOT NULL DEFAULT 0,
      last_check_time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToCostRow(row: Row): CostOfGoodsRow {
  return {
    id: row.id,
    name: row.name,
    warehouse: row.warehouse,
    date: row.row_date,
    avgCost: row.avg_cost,
    cost: row.cost,
    passed: row.passed === 1,
    supplyNumber: row.supply_number,
    calculatedBalance: row.calculated_balance,
    actualBalance: row.actual_balance,
    totalRevaluation: row.total_revaluation,
    lastCheckTime: row.last_check_time,
  }
}

export type CostOfGoodsRowInput = {
  name: string
  warehouse: string
  date: string
  avgCost: number
  cost: number
  passed: boolean
  supplyNumber: string
  calculatedBalance: number
  actualBalance: number
  totalRevaluation: number
  lastCheckTime: string
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseCostOfGoodsRowInput(body: unknown): CostOfGoodsRowInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const date = typeof value.date === "string" && value.date ? value.date : new Date().toISOString()
  const lastCheckTime = typeof value.lastCheckTime === "string" && value.lastCheckTime ? value.lastCheckTime : date
  return {
    name,
    warehouse: typeof value.warehouse === "string" ? value.warehouse : "",
    date,
    avgCost: num(value.avgCost),
    cost: num(value.cost),
    passed: value.passed === true,
    supplyNumber: typeof value.supplyNumber === "string" ? value.supplyNumber : "",
    calculatedBalance: num(value.calculatedBalance),
    actualBalance: num(value.actualBalance),
    totalRevaluation: num(value.totalRevaluation),
    lastCheckTime,
  }
}

export async function listCostOfGoodsRows(): Promise<CostOfGoodsRow[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM cost_of_goods_rows ORDER BY id ASC").all()) as Row[]).map(rowToCostRow)
}

export async function getCostOfGoodsRow(id: number): Promise<CostOfGoodsRow | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM cost_of_goods_rows WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToCostRow(row) : null
}

export async function createCostOfGoodsRow(input: CostOfGoodsRowInput): Promise<CostOfGoodsRow> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO cost_of_goods_rows
        (name, warehouse, row_date, avg_cost, cost, passed, supply_number, calculated_balance, actual_balance, total_revaluation, last_check_time)
       VALUES (@name, @warehouse, @date, @avgCost, @cost, @passed, @supplyNumber, @calculatedBalance, @actualBalance, @totalRevaluation, @lastCheckTime)`,
      )
      .run({
        name: input.name,
        warehouse: input.warehouse,
        date: input.date,
        avgCost: input.avgCost,
        cost: input.cost,
        passed: input.passed ? 1 : 0,
        supplyNumber: input.supplyNumber,
        calculatedBalance: input.calculatedBalance,
        actualBalance: input.actualBalance,
        totalRevaluation: input.totalRevaluation,
        lastCheckTime: input.lastCheckTime,
      }))
  return (await getCostOfGoodsRow(Number(result.lastInsertRowid)))!
}

export async function updateCostOfGoodsRow(id: number, input: CostOfGoodsRowInput): Promise<CostOfGoodsRow | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getCostOfGoodsRow(id))) return null
  await db.prepare(
        `UPDATE cost_of_goods_rows SET
       name = @name, warehouse = @warehouse, row_date = @date, avg_cost = @avgCost, cost = @cost, passed = @passed,
       supply_number = @supplyNumber, calculated_balance = @calculatedBalance, actual_balance = @actualBalance,
       total_revaluation = @totalRevaluation, last_check_time = @lastCheckTime, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        warehouse: input.warehouse,
        date: input.date,
        avgCost: input.avgCost,
        cost: input.cost,
        passed: input.passed ? 1 : 0,
        supplyNumber: input.supplyNumber,
        calculatedBalance: input.calculatedBalance,
        actualBalance: input.actualBalance,
        totalRevaluation: input.totalRevaluation,
        lastCheckTime: input.lastCheckTime,
      })
  return (await getCostOfGoodsRow(id))
}

export async function deleteCostOfGoodsRow(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM cost_of_goods_rows WHERE id = ?").run(id)).changes > 0
}
