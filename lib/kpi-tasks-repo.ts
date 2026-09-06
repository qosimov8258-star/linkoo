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
}

type Row = {
  id: number
  name: string
  plan_type: string
  client_type: string
  comment: string
  active: number
  system_flag: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
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
  }
}

export type KpiTaskInput = {
  name: string
  planType: string
  clientType: string
  comment: string
  active: boolean
}

export async function listKpiTasks(): Promise<KpiTask[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM kpi_tasks ORDER BY id ASC").all()) as Row[]).map(rowToTask)
}

export async function getKpiTask(id: number): Promise<KpiTask | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM kpi_tasks WHERE id = ?").get(id)) as Row | undefined
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
  return (await db.prepare("DELETE FROM kpi_tasks WHERE id = ?").run(id)).changes > 0
}
