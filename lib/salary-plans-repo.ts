import "server-only"

import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { todayIso } from "@/lib/finance/dates"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// "Зарплата и установка планов": one plan per employee per month (year,
// month). Crediting a plan ("Зачислить") accrues its salary and KPI bonus on
// the employee's balance (lib/finance/sources.ts, employee ledger): dated by
// credited_at and kept inside the plan's own month, so later edits never
// move a past accrual. A credited plan cannot be deleted or moved to another
// month — un-credit it first ("Отменить зачисление").

export type SalaryPlan = {
  id: number
  /** Employee full name (snapshot; employeeId is the link). */
  employee: string
  employeeId: number | null
  year: number
  /** 1–12. */
  month: number
  salary: number
  bonus: number
  kpi: number
  credited: boolean
  /** UTC "YYYY-MM-DD HH:MM:SS" of the last "Зачислить", "" when not credited. */
  creditedAt: string
}

type Row = {
  id: number
  employee: string
  employee_id: number | null
  year: number | null
  month: number | null
  salary: number
  bonus: number
  kpi: number
  credited: number
  credited_at: string | null
  created_at: string
}

declare global {
  var __linkoSalaryPlansSchema: Promise<void> | undefined
}

async function createSchema(db: PgDb) {
  // fin_key / fin_ts for the backfill below.
  await ensureFinanceSchema(db)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS salary_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee TEXT NOT NULL,
      employee_id INTEGER,
      year INTEGER,
      month INTEGER,
      salary DOUBLE PRECISION NOT NULL DEFAULT 0,
      bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
      kpi DOUBLE PRECISION NOT NULL DEFAULT 0,
      credited INTEGER NOT NULL DEFAULT 0,
      credited_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE salary_plans ADD COLUMN IF NOT EXISTS employee_id INTEGER;
    ALTER TABLE salary_plans ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE salary_plans ADD COLUMN IF NOT EXISTS month INTEGER;
    ALTER TABLE salary_plans ADD COLUMN IF NOT EXISTS credited_at TEXT NOT NULL DEFAULT '';
  `)
  // The first version stored money as REAL (float4, ~7 significant digits).
  await db.exec(`
    DO $$
    DECLARE c text;
    BEGIN
      FOREACH c IN ARRAY ARRAY['salary', 'bonus', 'kpi'] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'salary_plans'
                     AND column_name = c AND data_type = 'real') THEN
          EXECUTE format('ALTER TABLE salary_plans ALTER COLUMN %I TYPE double precision', c);
        END IF;
      END LOOP;
    END $$;
  `)
  // Legacy rows (no period): the month they were created in; credited ones
  // keep their old accrual moment (updated_at); link the employee by name.
  await db.exec(`
    UPDATE salary_plans
       SET year = extract(year FROM COALESCE(fin_ts(created_at, true), now()))::int,
           month = extract(month FROM COALESCE(fin_ts(created_at, true), now()))::int
     WHERE year IS NULL OR month IS NULL OR month NOT BETWEEN 1 AND 12;
    UPDATE salary_plans SET credited_at = updated_at WHERE credited = 1 AND credited_at = '';
  `)
  const employees = (await db.prepare("SELECT to_regclass('employees') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (employees?.ok) {
    await db.exec(`
      UPDATE salary_plans sp SET employee_id = e.id
        FROM (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1) e
       WHERE sp.employee_id IS NULL AND e.k = fin_key(sp.employee);
    `)
  }
  // One plan per employee and month. Legacy duplicates keep the index from
  // being created; the API refuses new duplicates either way.
  await db.exec(`
    DO $$ BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS salary_plans_employee_period_uq ON salary_plans (employee_id, year, month) WHERE employee_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN NULL;
    END $$;
  `)
}

function ensureSchema(db: PgDb = getDb()): Promise<void> {
  globalThis.__linkoSalaryPlansSchema ??= createSchema(db).catch((error: unknown) => {
    globalThis.__linkoSalaryPlansSchema = undefined
    throw error
  })
  return globalThis.__linkoSalaryPlansSchema
}

function currentPeriod(): { year: number; month: number } {
  const today = todayIso()
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
}

function rowToPlan(row: Row): SalaryPlan {
  const fallback = currentPeriod()
  return {
    id: row.id,
    employee: row.employee,
    employeeId: row.employee_id === null ? null : Number(row.employee_id),
    year: Number(row.year ?? fallback.year),
    month: Number(row.month ?? fallback.month),
    salary: Number(row.salary),
    bonus: Number(row.bonus),
    kpi: Number(row.kpi),
    credited: Boolean(row.credited),
    creditedAt: row.credited ? (row.credited_at ?? "") : "",
  }
}

// --- validation ----------------------------------------------------------------------------------

const money = (message: string) => z.coerce.number({ error: message }).finite(message).min(0, message).max(MAX_MONEY, message)

/** Body of POST /api/salary-plans and PUT /api/salary-plans/[id]. The employee
 * is given by id (preferred) or by full name; it must exist. */
export const salaryPlanSchema = z
  .object({
    employeeId: z.coerce.number().int().positive().max(MAX_ID).optional().nullable(),
    employee: z.string().trim().max(200).optional(),
    year: z.coerce.number({ error: "Неверный период" }).int("Неверный период").min(2000, "Неверный период").max(2100, "Неверный период").optional(),
    month: z.coerce.number({ error: "Неверный период" }).int("Неверный период").min(1, "Неверный период").max(12, "Неверный период").optional(),
    salary: money("Введите сумму"),
    bonus: money("Введите сумму").optional(),
    kpi: z.coerce.number({ error: "Неверный KPI" }).finite("Неверный KPI").min(0, "Неверный KPI").max(1000, "Неверный KPI").optional(),
    credited: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.employeeId) || Boolean(value.employee), { message: "Выберите сотрудника", path: ["employee"] })

export type SalaryPlanInput = z.infer<typeof salaryPlanSchema>

/** GET ?year=&month= (both or none). */
export const salaryPlanListQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

export class SalaryPlanError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

async function resolveEmployee(db: PgDb, input: SalaryPlanInput): Promise<{ id: number; name: string }> {
  const row = (
    input.employeeId
      ? await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = @id").get({ id: input.employeeId })
      : await db
          .prepare("SELECT id, first_name, last_name FROM employees WHERE fin_key(first_name || ' ' || last_name) = fin_key(@name) ORDER BY id LIMIT 1")
          .get({ name: input.employee ?? "" })
  ) as { id: number; first_name: string; last_name: string } | undefined
  if (!row) throw new SalaryPlanError("Сотрудник не найден", 404)
  return { id: Number(row.id), name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() }
}

async function assertNoDuplicate(db: PgDb, employeeId: number, year: number, month: number, exceptId: number | null) {
  const row = await db
    .prepare("SELECT id FROM salary_plans WHERE employee_id = @employeeId AND year = @year AND month = @month AND id <> @exceptId LIMIT 1")
    .get({ employeeId, year, month, exceptId: exceptId ?? 0 })
  if (row) throw new SalaryPlanError("План сотрудника на этот месяц уже есть", 409)
}

// --- reads / writes --------------------------------------------------------------------------------

export async function listSalaryPlans(period: { year?: number; month?: number } = {}): Promise<SalaryPlan[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (
    period.year && period.month
      ? await db.prepare("SELECT * FROM salary_plans WHERE year = @year AND month = @month ORDER BY id ASC").all({ year: period.year, month: period.month })
      : period.year
        ? await db.prepare("SELECT * FROM salary_plans WHERE year = @year ORDER BY month, id").all({ year: period.year })
        : await db.prepare("SELECT * FROM salary_plans ORDER BY year, month, id").all()
  ) as Row[]
  return rows.map(rowToPlan)
}

export async function getSalaryPlan(id: number, db: PgDb = getDb()): Promise<SalaryPlan | null> {
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM salary_plans WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPlan(row) : null
}

export async function createSalaryPlan(input: SalaryPlanInput): Promise<SalaryPlan> {
  const db = getDb()
  await ensureSchema(db)
  return withTransaction(async (tx) => {
    const employee = await resolveEmployee(tx, input)
    const period = { ...currentPeriod(), ...(input.year ? { year: input.year } : {}), ...(input.month ? { month: input.month } : {}) }
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await assertNoDuplicate(tx, employee.id, period.year, period.month, null)
    const row = (await tx
      .prepare(
        `INSERT INTO salary_plans (employee, employee_id, year, month, salary, bonus, kpi, credited, credited_at)
         VALUES (@employee, @employeeId, @year, @month, @salary, @bonus, @kpi, @credited, CASE WHEN @credited = 1 THEN datetime('now') ELSE '' END)
         RETURNING id`,
      )
      .get({
        employee: employee.name,
        employeeId: employee.id,
        year: period.year,
        month: period.month,
        salary: input.salary,
        bonus: input.bonus ?? 0,
        kpi: input.kpi ?? 0,
        credited: input.credited ? 1 : 0,
      })) as { id: number }
    return (await getSalaryPlan(Number(row.id), tx))!
  })
}

export async function updateSalaryPlan(id: number, input: SalaryPlanInput): Promise<SalaryPlan | null> {
  const db = getDb()
  await ensureSchema(db)
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT * FROM salary_plans WHERE id = @id FOR UPDATE").get({ id })) as Row | undefined
    if (!current) return null
    const plan = rowToPlan(current)
    const employee = await resolveEmployee(tx, input)
    const year = input.year ?? plan.year
    const month = input.month ?? plan.month
    const credited = input.credited ?? plan.credited
    // A credited plan's accrual is history: un-credit before moving it to another employee / month.
    if (plan.credited && credited && (year !== plan.year || month !== plan.month || employee.id !== plan.employeeId)) {
      throw new SalaryPlanError("Сначала отмените зачисление", 409)
    }
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await assertNoDuplicate(tx, employee.id, year, month, id)
    await tx
      .prepare(
        `UPDATE salary_plans SET
           employee = @employee, employee_id = @employeeId, year = @year, month = @month,
           salary = @salary, bonus = @bonus, kpi = @kpi, credited = @credited,
           credited_at = CASE WHEN @credited = 0 THEN '' WHEN credited = 1 AND credited_at <> '' THEN credited_at ELSE datetime('now') END,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        employee: employee.name,
        employeeId: employee.id,
        year,
        month,
        salary: input.salary,
        bonus: input.bonus ?? plan.bonus,
        kpi: input.kpi ?? plan.kpi,
        credited: credited ? 1 : 0,
      })
    return getSalaryPlan(id, tx)
  })
}

/** Deletes a plan that is not credited ("not_found" / "credited" otherwise). */
export async function deleteSalaryPlan(id: number): Promise<true | "not_found" | "credited"> {
  const db = getDb()
  await ensureSchema(db)
  const plan = await getSalaryPlan(id, db)
  if (!plan) return "not_found"
  if (plan.credited) return "credited"
  const changes = (await db.prepare("DELETE FROM salary_plans WHERE id = ? AND credited = 0").run(id)).changes
  return changes > 0 ? true : "credited"
}
