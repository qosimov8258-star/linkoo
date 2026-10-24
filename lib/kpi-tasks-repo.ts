import "server-only"

import { getDb } from "@/lib/db"

export type KpiTask = {
  id: number
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  system?: boolean
  /** Validity period read from the reference (kpi_task_dates); a KPI past its till date is shown as inactive. */
  startDate?: string | null
  tillDate?: string | null
  /** The reference's detail of the KPI (reward levels, currency, date types, linked brands/products …; kpi_task_details). */
  detail?: Record<string, unknown> | null
}

type Row = {
  id: number
  name: string
  plan_type: string
  client_type: string
  comment: string
  active: number
  system_flag: number
  start_date?: string | null
  till_date?: string | null
  detail?: string | null
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`CREATE TABLE IF NOT EXISTS kpi_task_dates (task_id INTEGER PRIMARY KEY, start_date TEXT, till_date TEXT)`)
  await db.exec(`CREATE TABLE IF NOT EXISTS kpi_task_details (task_id INTEGER PRIMARY KEY, detail TEXT NOT NULL)`)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plan_type TEXT NOT NULL DEFAULT '',
      client_type TEXT NOT NULL DEFAULT 'Для всех',
      comment TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      system_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToTask(row: Row): KpiTask {
  return {
    id: row.id,
    name: row.name,
    planType: row.plan_type,
    clientType: row.client_type,
    comment: row.comment,
    active: row.active === 1,
    system: row.system_flag === 1,
    startDate: row.start_date ?? null,
    tillDate: row.till_date ?? null,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
  }
}

export type KpiTaskInput = {
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
  /** Reward levels, currency, date types and links (kpi_task_details) and the validity period (kpi_task_dates). */
  detail?: Record<string, unknown> | null
  startDate?: string | null
  tillDate?: string | null
}

async function saveKpiExtras(db: ReturnType<typeof getDb>, id: number, input: KpiTaskInput) {
  if (input.detail !== undefined && input.detail !== null) {
    await db
      .prepare("INSERT INTO kpi_task_details (task_id, detail) VALUES (@id, @detail) ON CONFLICT (task_id) DO UPDATE SET detail = EXCLUDED.detail RETURNING task_id")
      .run({ id, detail: JSON.stringify(input.detail) })
  }
  if (input.startDate !== undefined || input.tillDate !== undefined) {
    await db
      .prepare("INSERT INTO kpi_task_dates (task_id, start_date, till_date) VALUES (@id, @start, @till) ON CONFLICT (task_id) DO UPDATE SET start_date = EXCLUDED.start_date, till_date = EXCLUDED.till_date RETURNING task_id")
      .run({ id, start: input.startDate ?? null, till: input.tillDate ?? null })
  }
}

export async function listKpiTasks(): Promise<KpiTask[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT k.*, d.start_date, d.till_date, x.detail FROM kpi_tasks k LEFT JOIN kpi_task_dates d ON d.task_id = k.id LEFT JOIN kpi_task_details x ON x.task_id = k.id ORDER BY k.id ASC").all()) as Row[]).map(rowToTask)
}

export async function getKpiTask(id: number): Promise<KpiTask | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT k.*, d.start_date, d.till_date, x.detail FROM kpi_tasks k LEFT JOIN kpi_task_dates d ON d.task_id = k.id LEFT JOIN kpi_task_details x ON x.task_id = k.id WHERE k.id = ?").get(id)) as Row | undefined
  return row ? rowToTask(row) : null
}

export async function createKpiTask(input: KpiTaskInput): Promise<KpiTask> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO kpi_tasks (name, plan_type, client_type, comment, active, system_flag)
       VALUES (@name, @planType, @clientType, @comment, @active, 0)`,
      )
      .run({
        name: input.name,
        planType: input.planType,
        clientType: input.clientType,
        comment: input.comment,
        active: input.active ? 1 : 0,
      }))
  await saveKpiExtras(db, Number(result.lastInsertRowid), input)
  return (await getKpiTask(Number(result.lastInsertRowid)))!
}

export async function updateKpiTask(id: number, input: KpiTaskInput): Promise<KpiTask | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getKpiTask(id))) return null
  await db.prepare(
        `UPDATE kpi_tasks SET name = @name, plan_type = @planType, client_type = @clientType, comment = @comment,
       active = @active, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        planType: input.planType,
        clientType: input.clientType,
        comment: input.comment,
        active: input.active ? 1 : 0,
      })
  await saveKpiExtras(db, id, input)
  return (await getKpiTask(id))
}

export async function setKpiTaskActive(id: number, active: boolean): Promise<KpiTask | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getKpiTask(id))) return null
  await db.prepare("UPDATE kpi_tasks SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, id)
  return (await getKpiTask(id))
}

export async function deleteKpiTask(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const removed = (await db.prepare("DELETE FROM kpi_tasks WHERE id = ?").run(id)).changes > 0
  if (removed) {
    await db.prepare("DELETE FROM kpi_task_details WHERE task_id = ?").run(id)
    await db.prepare("DELETE FROM kpi_task_dates WHERE task_id = ?").run(id)
  }
  return removed
}
