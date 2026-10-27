import "server-only"

import { getDb } from "@/lib/db"

export type TaskItemStatus = "new" | "in_progress" | "done" | "finished"
export type TaskPerson = { id: number; firstName: string; secondName: string }
export type TaskPlan = { id: number; comment: string; date: string; status: string; response: string; imageUrl: string }
export type TaskItem = {
  id: number
  title: string
  status: TaskItemStatus
  createdDate: string
  endDate: string | null
  responsibleUser: TaskPerson | null
  createdBy: TaskPerson | null
  market: { id: number; name: string } | null
  todayPlans: TaskPlan[]
}

export type TaskItemFilter = {
  status?: string
  search?: string
  responsibleUser?: number[]
  createdBy?: number[]
  market?: number[]
  beginDate?: string
  endDate?: string
  beginTaskDate?: string
  endTaskDate?: string
  page?: number
  pageSize?: number
}

export type TaskItemInput = {
  title: string
  market: number
  responsibleUser: number
  endDate: string
  hasPlanRepetition?: boolean
  planFrequency?: number
  planRepetition?: number
}

type Db = ReturnType<typeof getDb>

async function ensureSchema(db: Db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_items (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      market_id INTEGER,
      responsible_id INTEGER,
      created_by_id INTEGER,
      status TEXT NOT NULL DEFAULT 'new',
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_item_plans (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      plan_date TEXT,
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      response TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

type Row = {
  id: number
  title: string
  status: string
  end_date: string | null
  created_at: string
  market_id: number | null
  market_name: string | null
  resp_id: number | null
  resp_first: string | null
  resp_last: string | null
  by_id: number | null
  by_first: string | null
  by_last: string | null
}

const SELECT = `SELECT t.id, t.title, t.status, t.end_date, t.created_at, t.market_id, c.name AS market_name,
  r.id AS resp_id, r.first_name AS resp_first, r.last_name AS resp_last,
  b.id AS by_id, b.first_name AS by_first, b.last_name AS by_last
  FROM task_items t
  LEFT JOIN clients c ON c.id = t.market_id
  LEFT JOIN employees r ON r.id = t.responsible_id
  LEFT JOIN employees b ON b.id = t.created_by_id`

function person(id: number | null, first: string | null, last: string | null): TaskPerson | null {
  return id == null ? null : { id, firstName: first ?? "", secondName: last ?? "" }
}

function toItem(row: Row, plans: TaskPlan[]): TaskItem {
  return {
    id: row.id,
    title: row.title,
    status: (["new", "in_progress", "done", "finished"].includes(row.status) ? row.status : "new") as TaskItemStatus,
    createdDate: row.created_at,
    endDate: row.end_date || null,
    responsibleUser: person(row.resp_id, row.resp_first, row.resp_last),
    createdBy: person(row.by_id, row.by_first, row.by_last),
    market: row.market_id == null ? null : { id: row.market_id, name: row.market_name ?? "" },
    todayPlans: plans,
  }
}

async function plansOf(db: Db, taskId: number): Promise<TaskPlan[]> {
  const rows = (await db.prepare("SELECT * FROM task_item_plans WHERE task_id = ? ORDER BY plan_date ASC, id ASC").all(taskId)) as Array<{
    id: number; comment: string; plan_date: string | null; status: string; response: string; image_url: string
  }>
  return rows.map((p) => ({ id: p.id, comment: p.comment, date: p.plan_date ?? "", status: p.status, response: p.response, imageUrl: p.image_url }))
}

const ids = (list?: number[]) => (list ?? []).filter((n) => Number.isInteger(n)).join(",")

export async function listTaskItems(filter: TaskItemFilter) {
  const db = getDb()
  await ensureSchema(db)
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.status) { where.push("t.status = @status"); params.status = filter.status }
  if (filter.search?.trim()) {
    where.push("(LOWER(t.title) LIKE @q OR LOWER(c.name) LIKE @q OR LOWER(COALESCE(r.first_name,'') || ' ' || COALESCE(r.last_name,'')) LIKE @q)")
    params.q = `%${filter.search.trim().toLowerCase()}%`
  }
  if (ids(filter.responsibleUser)) where.push(`t.responsible_id IN (${ids(filter.responsibleUser)})`)
  if (ids(filter.createdBy)) where.push(`t.created_by_id IN (${ids(filter.createdBy)})`)
  if (ids(filter.market)) where.push(`t.market_id IN (${ids(filter.market)})`)
  if (filter.beginDate) { where.push("substr(t.created_at,1,10) >= @bd"); params.bd = filter.beginDate }
  if (filter.endDate) { where.push("substr(t.created_at,1,10) <= @ed"); params.ed = filter.endDate }
  if (filter.beginTaskDate) { where.push("t.end_date >= @btd"); params.btd = filter.beginTaskDate }
  if (filter.endTaskDate) { where.push("t.end_date <= @etd"); params.etd = filter.endTaskDate }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : ""
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM task_items t LEFT JOIN clients c ON c.id = t.market_id LEFT JOIN employees r ON r.id = t.responsible_id${w}`).get(params)) as { n: number | string }).n)
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 2000)
  const page = Math.max(filter.page ?? 1, 1)
  const rows = (await db.prepare(`${SELECT}${w} ORDER BY t.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all(params)) as Row[]
  return { count, results: rows.map((r) => toItem(r, [])) }
}

export async function getTaskItem(id: number): Promise<TaskItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare(`${SELECT} WHERE t.id = ?`).get(id)) as Row | undefined
  return row ? toItem(row, await plansOf(db, id)) : null
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function createTaskItem(input: TaskItemInput, createdById: number | null): Promise<TaskItem> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("INSERT INTO task_items (title, market_id, responsible_id, created_by_id, status, end_date) VALUES (@title, @market, @user, @by, 'in_progress', @end)")
    .run({ title: input.title, market: input.market, user: input.responsibleUser, by: createdById, end: input.endDate })
  const id = Number(result.lastInsertRowid)
  // The reference's task from the UI (no status is sent) comes back "in_progress" with one pending plan
  // dated at the task date whose comment is the task title; a repetition adds one such plan per period.
  const repeats = input.hasPlanRepetition && input.planFrequency && input.planRepetition ? input.planRepetition : 1
  for (let i = 0; i < repeats; i += 1) {
    await db.prepare("INSERT INTO task_item_plans (task_id, plan_date, comment, status) VALUES (?, ?, ?, 'pending')").run(id, addDays(input.endDate, i * (input.planFrequency ?? 0)), input.title)
  }
  return (await getTaskItem(id))!
}

export async function updateTaskItem(id: number, input: TaskItemInput): Promise<TaskItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const r = await db
    .prepare("UPDATE task_items SET title=@title, market_id=@market, responsible_id=@user, end_date=@end, updated_at=datetime('now') WHERE id=@id")
    .run({ id, title: input.title, market: input.market, user: input.responsibleUser, end: input.endDate })
  return r.changes ? getTaskItem(id) : null
}

export async function changeTaskItemStatus(id: number, status: TaskItemStatus): Promise<TaskItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const r = await db.prepare("UPDATE task_items SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id)
  return r.changes ? getTaskItem(id) : null
}

export async function addTaskItemPlan(id: number, date: string | null, comment: string): Promise<TaskItem | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getTaskItem(id))) return null
  await db.prepare("INSERT INTO task_item_plans (task_id, plan_date, comment, status) VALUES (?, ?, ?, 'pending')").run(id, date, comment)
  return getTaskItem(id)
}

export async function taskUserOptions(search: string, page: number, pageSize: number) {
  const db = getDb()
  await ensureSchema(db)
  const q = `%${search.trim().toLowerCase()}%`
  const where = "active = 1 AND LOWER(first_name || ' ' || last_name) LIKE @q"
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM employees WHERE ${where}`).get({ q })) as { n: number | string }).n)
  const rows = (await db.prepare(`SELECT id, first_name, last_name FROM employees WHERE ${where} ORDER BY id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all({ q })) as Array<{ id: number; first_name: string; last_name: string }>
  return { count, results: rows.map((r) => ({ id: r.id, firstName: r.first_name, secondName: r.last_name })) }
}

export async function taskMarketOptions(search: string, page: number, pageSize: number) {
  const db = getDb()
  await ensureSchema(db)
  const q = `%${search.trim().toLowerCase()}%`
  const count = Number(((await db.prepare("SELECT COUNT(*) AS n FROM clients WHERE LOWER(name) LIKE @q").get({ q })) as { n: number | string }).n)
  const rows = (await db.prepare(`SELECT id, name FROM clients WHERE LOWER(name) LIKE @q ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all({ q })) as Array<{ id: number; name: string }>
  return { count, results: rows }
}

/** Employees responsible for a client (agent, deliverer, collector), like the reference's get_responsible_users. */
export async function marketResponsibleUsers(marketId: number) {
  const db = getDb()
  await ensureSchema(db)
  const client = (await db.prepare("SELECT agent, deliverer, collector FROM clients WHERE id = ?").get(marketId)) as { agent: string; deliverer: string; collector: string } | undefined
  if (!client) return []
  const out: Array<TaskPerson & { responsibleFor: string }> = []
  for (const [name, label] of [[client.agent, "Агент"], [client.deliverer, "Доставщик"], [client.collector, "Инкассатор"]] as const) {
    if (!name || name === "Не указано") continue
    const e = (await db.prepare("SELECT id, first_name, last_name FROM employees WHERE active = 1 AND TRIM(first_name || ' ' || last_name) = ? ORDER BY id LIMIT 1").get(name.trim())) as { id: number; first_name: string; last_name: string } | undefined
    if (e && !out.some((o) => o.id === e.id)) out.push({ id: e.id, firstName: e.first_name, secondName: e.last_name, responsibleFor: label })
  }
  return out
}

export async function employeeIdForLogin(login: string): Promise<number | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT id FROM employees WHERE login = ? LIMIT 1").get(login)) as { id: number } | undefined
  return row?.id ?? null
}
