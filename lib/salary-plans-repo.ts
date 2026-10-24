import "server-only"

import { getDb } from "@/lib/db"

export type SalaryPlan = {
  id: number
  employee: string
  salary: number
  bonus: number
  kpi: number
  credited: boolean
  /** Month the plan belongs to, "YYYY-MM" (the month it was created). */
  period: string
}

type Row = {
  id: number
  employee: string
  salary: number
  bonus: number
  kpi: number
  credited: number
  created_at?: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS salary_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee TEXT NOT NULL,
      salary REAL NOT NULL DEFAULT 0,
      bonus REAL NOT NULL DEFAULT 0,
      kpi REAL NOT NULL DEFAULT 0,
      credited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToPlan(row: Row): SalaryPlan {
  return {
    id: row.id,
    employee: row.employee,
    salary: row.salary,
    bonus: row.bonus,
    kpi: row.kpi,
    credited: Boolean(row.credited),
    period: String(row.created_at ?? "").slice(0, 7),
  }
}

export type SalaryPlanInput = {
  employee: string
  salary: number
  bonus: number
  kpi: number
  credited: boolean
  /** "YYYY-MM": the month the plan is added for (stored as the created_at month). */
  period?: string
}

export function parseSalaryPlanInput(body: unknown): SalaryPlanInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const employee = typeof value.employee === "string" ? value.employee.trim() : ""
  if (!employee) return null
  const salary = Number(value.salary)
  if (!Number.isFinite(salary) || salary < 0) return null
  const bonus = Number.isFinite(Number(value.bonus)) ? Number(value.bonus) : 0
  const kpi = Number.isFinite(Number(value.kpi)) ? Number(value.kpi) : 0
  const credited = Boolean(value.credited)
  const period = typeof value.period === "string" && /^\d{4}-\d{2}$/.test(value.period) ? value.period : undefined
  return { employee, salary, bonus, kpi, credited, period }
}

export async function listSalaryPlans(): Promise<SalaryPlan[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM salary_plans ORDER BY id ASC").all()) as Row[]).map(rowToPlan)
}

export async function getSalaryPlan(id: number): Promise<SalaryPlan | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM salary_plans WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPlan(row) : null
}

export async function createSalaryPlan(input: SalaryPlanInput): Promise<SalaryPlan> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO salary_plans (employee, salary, bonus, kpi, credited, created_at)
       VALUES (@employee, @salary, @bonus, @kpi, @credited, COALESCE(@createdAt, datetime('now')))`,
      )
      .run({
        employee: input.employee,
        salary: input.salary,
        bonus: input.bonus,
        kpi: input.kpi,
        credited: input.credited ? 1 : 0,
        createdAt: input.period ? `${input.period}-01 09:00:00` : null,
      }))
  return (await getSalaryPlan(Number(result.lastInsertRowid)))!
}

export async function updateSalaryPlan(id: number, input: SalaryPlanInput): Promise<SalaryPlan | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getSalaryPlan(id))) return null
  await db.prepare(
        `UPDATE salary_plans SET
       employee = @employee, salary = @salary, bonus = @bonus, kpi = @kpi,
       credited = @credited, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        employee: input.employee,
        salary: input.salary,
        bonus: input.bonus,
        kpi: input.kpi,
        credited: input.credited ? 1 : 0,
      })
  return (await getSalaryPlan(id))
}

export async function deleteSalaryPlan(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM salary_plans WHERE id = ?").run(id)).changes > 0
}
