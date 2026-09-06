import "server-only"

import { getDb } from "@/lib/db"

export type BranchKpiPlan = {
  id: number
  branchId: number
  branchName: string
  period: string
  planSales: number
  bonusPercent: number
}

type Row = {
  id: number
  branch_id: number
  branch_name: string
  period: string
  plan: string
}

type PlanConfig = { planSales: number; bonusPercent: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS branch_kpi_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL,
      branch_name TEXT NOT NULL,
      period TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(branch_id, period)
    );
  `)
}

function parsePlanConfig(raw: string): PlanConfig {
  try {
    const value = JSON.parse(raw) as Partial<PlanConfig>
    return {
      planSales: typeof value.planSales === "number" ? value.planSales : 0,
      bonusPercent: typeof value.bonusPercent === "number" ? value.bonusPercent : 0,
    }
  } catch {
    return { planSales: 0, bonusPercent: 0 }
  }
}

function rowToPlan(row: Row): BranchKpiPlan {
  const config = parsePlanConfig(row.plan)
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    period: row.period,
    planSales: config.planSales,
    bonusPercent: config.bonusPercent,
  }
}

export type BranchKpiPlanInput = {
  branchId: number
  branchName: string
  period: string
  planSales: number
  bonusPercent: number
}

export function parseBranchKpiPlanInput(body: unknown): BranchKpiPlanInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const branchId = Number(value.branchId)
  if (!Number.isFinite(branchId)) return null
  const branchName = typeof value.branchName === "string" ? value.branchName.trim() : ""
  if (!branchName) return null
  const period = typeof value.period === "string" ? value.period.trim() : ""
  if (!period) return null
  const planSales = Number.isFinite(Number(value.planSales)) ? Number(value.planSales) : 0
  const bonusPercent = Number.isFinite(Number(value.bonusPercent)) ? Number(value.bonusPercent) : 0
  return { branchId, branchName, period, planSales, bonusPercent }
}

export async function listBranchKpiPlans(period?: string): Promise<BranchKpiPlan[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = period
    ? ((await db.prepare("SELECT * FROM branch_kpi_plans WHERE period = ? ORDER BY id ASC").all(period)) as Row[])
    : ((await db.prepare("SELECT * FROM branch_kpi_plans ORDER BY id ASC").all()) as Row[])
  return rows.map(rowToPlan)
}

/** Creates the branch's plan for a period, or updates it in place if one already exists
 * (re-saving "Изменить планы" for the same branch+period replaces the previous values
 * instead of piling up duplicate rows). */
export async function saveBranchKpiPlan(input: BranchKpiPlanInput): Promise<BranchKpiPlan> {
  const db = getDb()
  await ensureSchema(db)
  await db.prepare(
        `INSERT INTO branch_kpi_plans (branch_id, branch_name, period, plan)
     VALUES (@branchId, @branchName, @period, @plan)
     ON CONFLICT(branch_id, period) DO UPDATE SET
       branch_name = excluded.branch_name,
       plan = excluded.plan,
       updated_at = datetime('now')`,
      ).run({
        branchId: input.branchId,
        branchName: input.branchName,
        period: input.period,
        plan: JSON.stringify({ planSales: input.planSales, bonusPercent: input.bonusPercent }),
      })
  const row = (await db
      .prepare("SELECT * FROM branch_kpi_plans WHERE branch_id = ? AND period = ?")
      .get(input.branchId, input.period)) as Row
  return rowToPlan(row)
}
