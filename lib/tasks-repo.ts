import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { ensureUserEmployeeLink } from "@/lib/auth-employee"
import { ensureClientsSchema } from "@/lib/clients-repo"
import { dbErrorResponse } from "@/lib/db-errors"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { parseDocDay } from "@/lib/document-dates"
import { scopeAllows, type FieldScope } from "@/lib/field-activity/actor"
import { keySql, nameKey } from "@/lib/platform-refs"
import type { Role } from "@/lib/session"
import { dbId, strictId, strictNum } from "@/lib/strict-number"
import {
  TASK_COMMENT_MAX,
  TASK_IMPORT_MAX_ROWS,
  TASK_PAGE_SIZES,
  TASK_PLAN_STATUSES,
  TASK_REPEAT_MAX,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  isTaskDate,
  repeatPlanDates,
  type TaskDetail,
  type TaskListItem,
  type TaskListResponse,
  type TaskOptions,
  type TaskPlan,
  type TaskPlanStatus,
  type TaskStatus,
} from "@/components/analytics/tasks-data"

// "Задачи" (/analytics/tasks): tasks of the factory's own clients and employees, and their plans.
//
// tasks (created by lib/db.ts, extended here): description = "Описание", client_id / store =
// "Магазин" (id + name snapshot), employee_id / responsible = "Ответственный пользователь" (id +
// name snapshot; lib/employees-repo.ts and lib/clients-repo.ts read these columns for their usage
// checks and rename cascades), date = "Дата задачи" (YYYY-MM-DD), status new | in_progress | done |
// finished, created_by_user_id / created_by = "Создал".
// task_plans: the days the responsible agent must do the task (plan #1 on the task day, then the
// "Повторять план" repetitions and the plans added later), pending until the agent marks them
// done / undone (agent API), finished when the manager accepts the task.
//
// Status rules (every change locks the task row FOR UPDATE first, then its plans):
//   in_progress → done      the agent resolved the last pending plan and at least one plan is done;
//   done → finished         "Принять" (manager);
//   done → in_progress      a new plan is added;
//   finished                closed: no new plans, no plan marks.
//
// Visibility follows the field scope of lib/field-activity/actor.ts (tasks are the agents' field
// work): a reader with the full scope sees every task; an agent sees only the tasks whose
// responsible employee is in their scope (their own employee, and the agents they supervise).
// Reads and writes of a task outside it answer 404 like a missing one, and an employee outside it is
// refused like an unknown one ("Сотрудник не найден"); the pickers (taskOptions) list only the
// employees of the scope.

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TaskError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
    /** Excel import: the spreadsheet row the refusal is about. */
    readonly row?: number,
  ) {
    super(message)
  }
}

export function taskErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof TaskError) {
    return NextResponse.json(
      { error: error.message, ...(error.field ? { field: error.field } : {}), ...(error.row !== undefined ? { row: error.row } : {}) },
      { status: error.status },
    )
  }
  return dbErrorResponse(error)
}

export const TASK_NOT_FOUND = "Задача не найдена"
export const PLAN_NOT_FOUND = "План не найден"

// ---------------------------------------------------------------------------
// Schema (fresh-install safe, once per process, never inside a request transaction)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 2

declare global {
  var __linkoTasksSchemaV: { version: number; ready: Promise<void> } | undefined
}

const DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    responsible TEXT NOT NULL DEFAULT '',
    store TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS client_id INTEGER,
    ADD COLUMN IF NOT EXISTS employee_id INTEGER,
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS grade INTEGER;
  CREATE TABLE IF NOT EXISTS task_plans (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    plan_date TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    response TEXT NOT NULL DEFAULT '',
    photo TEXT NOT NULL DEFAULT '',
    done_at TEXT NOT NULL DEFAULT '',
    done_by_user_id INTEGER,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS task_plans_task_id_idx ON task_plans (task_id);
  CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks (date);
  CREATE INDEX IF NOT EXISTS tasks_employee_id_idx ON tasks (employee_id);
`

async function migrate(tx: PgDb): Promise<void> {
  // Statuses of the first version: fulfilled → done, closed → finished.
  const legacy = await tx.prepare("SELECT 1 AS x FROM tasks WHERE status NOT IN ('new', 'in_progress', 'done', 'finished') LIMIT 1").get()
  if (legacy) {
    await tx.exec(`UPDATE tasks SET status = CASE status WHEN 'fulfilled' THEN 'done' WHEN 'closed' THEN 'finished' ELSE 'in_progress' END
      WHERE status NOT IN ('new', 'in_progress', 'done', 'finished')`)
  }
  // Tasks saved before plans existed get their plan #1 on the task day.
  const planless = await tx
    .prepare("SELECT 1 AS x FROM tasks t WHERE NOT EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = t.id) LIMIT 1")
    .get()
  if (planless) {
    await tx.exec(`INSERT INTO task_plans (task_id, plan_date, status, done_at)
      SELECT t.id, t.date,
             CASE t.status WHEN 'done' THEN 'done' WHEN 'finished' THEN 'finished' ELSE 'pending' END,
             CASE WHEN t.status IN ('done', 'finished') THEN t.updated_at ELSE '' END
        FROM tasks t
       WHERE t.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND NOT EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = t.id)`)
  }
}

/** Creates / upgrades tasks and task_plans. Exported for modules that read task_plans (call it
 * before opening a transaction that reads them). */
export function ensureTasksSchema(): Promise<void> {
  if (globalThis.__linkoTasksSchemaV?.version !== SCHEMA_VERSION) {
    const ready = (async () => {
      // users.employee_id ("Создал" names) and the client columns read below.
      await Promise.all([ensureUserEmployeeLink(), ensureClientsSchema()])
      await outsideTransaction(() =>
        withTransaction(async (tx) => {
          await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:tasks-schema'))").get()
          await tx.exec(DDL)
          await migrate(tx)
        }),
      )
    })().catch((error) => {
      globalThis.__linkoTasksSchemaV = undefined
      throw error
    })
    globalThis.__linkoTasksSchemaV = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoTasksSchemaV!.ready
}

// ---------------------------------------------------------------------------
// Request bodies (messages are Russian i18n keys)
// ---------------------------------------------------------------------------

const DATE_REQUIRED = "Укажите дату"
const TITLE_TOO_LONG = "Не более 1000 символов"
const COMMENT_TOO_LONG = "Не более 1000 символов"
const COUNT_MESSAGE = "Введите целое число от 1 до 52"

const titleField = z
  .string({ error: "Обязательное поле" })
  .trim()
  .min(1, "Обязательное поле")
  .max(TASK_TITLE_MAX, TITLE_TOO_LONG)

/** "YYYY-MM-DD", a real day of 2000..2100; future days are fine (a task / plan is planned work). */
const dayField = z
  .string({ error: DATE_REQUIRED })
  .trim()
  .min(1, DATE_REQUIRED)
  .refine((value) => isTaskDate(value), "Неверная дата")

const repeatSchema = z.object({
  frequency: strictNum(z.number().refine((value) => value === 7 || value === 14, "Выберите период"), "Выберите период"),
  count: strictNum(z.number().int(COUNT_MESSAGE).min(1, COUNT_MESSAGE).max(TASK_REPEAT_MAX, COUNT_MESSAGE), COUNT_MESSAGE),
})

/** PUT /api/tasks/:id. */
export const taskUpdateSchema = z.object({
  title: titleField,
  clientId: dbId("Выберите магазин"),
  employeeId: dbId("Выберите ответственного"),
  taskDate: dayField,
})

/** POST /api/tasks. */
export const taskCreateSchema = taskUpdateSchema.extend({
  repeat: repeatSchema.nullable().optional(),
})

export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>

/** POST /api/tasks/:id/plans. */
export const taskPlanSchema = z.object({
  date: dayField,
  comment: z.string().trim().max(TASK_COMMENT_MAX, COMMENT_TOO_LONG).optional().default(""),
})

const PHOTO_MAX_LENGTH = 3_000_000
// Linear (no nested quantifiers): one alternation, then one character class.
const PHOTO_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

/** POST /api/tasks/:id/plans/:planId/complete (the agent app). */
export const taskPlanCompleteSchema = z.object({
  status: z.enum(["done", "undone"], { error: "Неверный статус" }),
  response: z.string().trim().max(TASK_COMMENT_MAX, COMMENT_TOO_LONG).optional().default(""),
  photo: z
    .string()
    .trim()
    .max(PHOTO_MAX_LENGTH, "Изображение слишком большое")
    .refine((value) => value === "" || PHOTO_PATTERN.test(value), "Неверный формат изображения")
    .nullable()
    .optional(),
})

const importCell = (max: number) => z.union([z.string().max(max, "Слишком длинное значение"), z.number()]).optional()

/** POST /api/tasks/import: the spreadsheet's rows (names or ids of the client / employee). */
export const taskImportSchema = z.object({
  rows: z
    .array(
      z.object({
        line: strictNum(z.number().int().positive().max(1_000_000)).optional(),
        title: importCell(5000),
        client: importCell(500),
        responsible: importCell(500),
        taskDate: importCell(100),
        status: z.string().max(50, "Слишком длинное значение").optional(),
      }),
    )
    .min(1, "Не удалось найти задачи для импорта в выбранном файле")
    .max(TASK_IMPORT_MAX_ROWS, "Слишком много строк"),
})

export type TaskImportInput = z.infer<typeof taskImportSchema>

/** Who acts (lib/current-user.ts CurrentUser). */
export type TaskActor = { id: number; role: Role; employeeId: number | null; displayName: string }

// ---------------------------------------------------------------------------
// List query (?status ?search ?page ?pageSize ?responsible ?createdBy ?client ?createdFrom
// ?createdTo ?taskFrom ?taskTo ?branch)
// ---------------------------------------------------------------------------

export type TaskListQuery = {
  status: TaskStatus | null
  search: string
  page: number
  pageSize: number
  responsible: number[]
  createdBy: number[]
  client: number[]
  createdFrom: string
  createdTo: string
  taskFrom: string
  taskTo: string
  branch: number | null
}

const MAX_FILTER_IDS = 500
const MAX_SEARCH = 200

function idList(raw: string | null): number[] | null {
  const text = (raw ?? "").trim()
  if (!text) return []
  const parts = text.split(",")
  if (parts.length > MAX_FILTER_IDS) return null
  const ids: number[] = []
  for (const part of parts) {
    const id = strictId(part.trim())
    if (id === null) return null
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function dayParam(raw: string | null): string | null {
  const text = (raw ?? "").trim()
  if (!text) return ""
  return isTaskDate(text) ? text : null
}

/** The validated list query, or the 400 reason (Russian i18n key) and the parameter. */
export function parseTaskListQuery(params: URLSearchParams): { query: TaskListQuery } | { error: string; field: string } {
  const statusText = (params.get("status") ?? "").trim()
  let status: TaskStatus | null = null
  if (statusText && statusText !== "all") {
    if (!(TASK_STATUSES as readonly string[]).includes(statusText)) return { error: "Неверный статус", field: "status" }
    status = statusText as TaskStatus
  }
  const search = (params.get("search") ?? "").trim()
  if (search.length > MAX_SEARCH) return { error: "Слишком длинное значение", field: "search" }
  const pageText = (params.get("page") ?? "").trim()
  const page = pageText ? strictId(pageText) : 1
  if (page === null || page > 1_000_000) return { error: "Неверный параметр", field: "page" }
  const sizeText = (params.get("pageSize") ?? "").trim()
  const pageSize = sizeText ? Number(sizeText) : 25
  if (!(TASK_PAGE_SIZES as readonly number[]).includes(pageSize) || (sizeText && !/^\d+$/.test(sizeText))) {
    return { error: "Неверный параметр", field: "pageSize" }
  }
  const lists: Record<"responsible" | "createdBy" | "client", number[]> = { responsible: [], createdBy: [], client: [] }
  for (const name of ["responsible", "createdBy", "client"] as const) {
    const ids = idList(params.get(name))
    if (ids === null) return { error: "Неверный идентификатор", field: name }
    lists[name] = ids
  }
  const days: Record<"createdFrom" | "createdTo" | "taskFrom" | "taskTo", string> = { createdFrom: "", createdTo: "", taskFrom: "", taskTo: "" }
  for (const name of ["createdFrom", "createdTo", "taskFrom", "taskTo"] as const) {
    const day = dayParam(params.get(name))
    if (day === null) return { error: "Неверная дата", field: name }
    days[name] = day
  }
  // A range typed backwards is read forwards.
  if (days.createdFrom && days.createdTo && days.createdFrom > days.createdTo) [days.createdFrom, days.createdTo] = [days.createdTo, days.createdFrom]
  if (days.taskFrom && days.taskTo && days.taskFrom > days.taskTo) [days.taskFrom, days.taskTo] = [days.taskTo, days.taskFrom]
  const branchText = (params.get("branch") ?? "").trim()
  const branch = branchText ? strictId(branchText) : null
  if (branchText && branch === null) return { error: "Неверный идентификатор", field: "branch" }
  return { query: { status, search, page, pageSize, ...lists, ...days, branch } }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const personName = (alias: string) =>
  `NULLIF(btrim(btrim(coalesce(${alias}.first_name, '')) || ' ' || btrim(coalesce(${alias}.last_name, ''))), '')`

const FROM = `FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN employees e ON e.id = t.employee_id
  LEFT JOIN users u ON u.id = t.created_by_user_id
  LEFT JOIN employees ue ON ue.id = u.employee_id`

/** Current client / employee / author names; the stored snapshot when the record is gone. */
const SELECT = `SELECT t.id, t.description AS title, c.id AS client_id, COALESCE(c.name, NULLIF(t.store, ''), '') AS client,
    e.id AS responsible_id, COALESCE(${personName("e")}, NULLIF(t.responsible, ''), '') AS responsible,
    t.created_by_user_id, COALESCE(${personName("ue")}, NULLIF(u.display_name, ''), NULLIF(t.created_by, ''), '') AS created_by,
    t.status, t.date AS task_date, t.created_at`

/** The Asia/Tashkent day of the UTC created_at text. */
const CREATED_DAY = `(CASE WHEN t.created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}'
  THEN to_char(replace(substr(t.created_at, 1, 19), 'T', ' ')::timestamp + interval '5 hours', 'YYYY-MM-DD')
  ELSE substr(t.created_at, 1, 10) END)`

type ListRow = {
  id: number
  title: string
  client_id: number | null
  client: string
  responsible_id: number | null
  responsible: string
  created_by_user_id: number | null
  created_by: string
  status: string
  task_date: string
  created_at: string
}

type PlanRow = {
  id: number
  plan_date: string
  comment: string
  status: string
  response: string
  has_photo: boolean
  done_at: string
}

const optionalId = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value))

function toListItem(row: ListRow): TaskListItem {
  return {
    id: Number(row.id),
    title: row.title ?? "",
    clientId: optionalId(row.client_id),
    client: row.client ?? "",
    responsibleId: optionalId(row.responsible_id),
    responsible: row.responsible ?? "",
    createdById: optionalId(row.created_by_user_id),
    createdBy: row.created_by ?? "",
    status: (TASK_STATUSES as readonly string[]).includes(row.status) ? (row.status as TaskStatus) : "in_progress",
    taskDate: isTaskDate(row.task_date ?? "") ? row.task_date : "",
    createdAt: row.created_at ?? "",
  }
}

function toPlan(taskId: number, row: PlanRow): TaskPlan {
  const id = Number(row.id)
  return {
    id,
    date: row.plan_date ?? "",
    comment: row.comment ?? "",
    status: (TASK_PLAN_STATUSES as readonly string[]).includes(row.status) ? (row.status as TaskPlanStatus) : "pending",
    response: row.response ?? "",
    photoUrl: row.has_photo ? `/api/tasks/${taskId}/plans/${id}/photo?v=${encodeURIComponent(row.done_at || String(id))}` : null,
    doneAt: row.done_at ?? "",
  }
}

async function branchName(db: PgDb, id: number): Promise<string | null> {
  const exists = (await db.prepare("SELECT to_regclass('branches') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists?.ok) return null
  const row = (await db.prepare("SELECT name FROM branches WHERE id = ?").get(id)) as { name: string } | undefined
  return row?.name ?? null
}

/** Restricts `where` to the tasks of the scope's employees (nothing for the full scope). */
function scopeWhere(scope: FieldScope, where: string[], params: Record<string, unknown>) {
  if (scope.all) return
  where.push("t.employee_id = ANY(@scopeIds::int[])")
  params.scopeIds = scope.employeeIds
}

export async function listTasks(query: TaskListQuery, scope: FieldScope): Promise<TaskListResponse> {
  await ensureTasksSchema()
  const db = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  scopeWhere(scope, where, params)
  if (query.status) {
    where.push("t.status = @status")
    params.status = query.status
  }
  if (query.search) {
    const searchable = [
      "strpos(lower(t.description), lower(@search)) > 0",
      "strpos(lower(COALESCE(c.name, t.store)), lower(@search)) > 0",
      `strpos(lower(COALESCE(${personName("e")}, t.responsible)), lower(@search)) > 0`,
    ]
    if (/^\d{1,9}$/.test(query.search)) {
      searchable.push("t.id = @searchId")
      params.searchId = Number(query.search)
    }
    where.push(`(${searchable.join(" OR ")})`)
    params.search = query.search
  }
  if (query.responsible.length) {
    where.push("t.employee_id = ANY(@responsible::int[])")
    params.responsible = query.responsible
  }
  if (query.createdBy.length) {
    where.push("t.created_by_user_id = ANY(@createdBy::int[])")
    params.createdBy = query.createdBy
  }
  if (query.client.length) {
    where.push("t.client_id = ANY(@client::int[])")
    params.client = query.client
  }
  if (query.createdFrom) {
    where.push(`${CREATED_DAY} >= @createdFrom`)
    params.createdFrom = query.createdFrom
  }
  if (query.createdTo) {
    where.push(`${CREATED_DAY} <= @createdTo`)
    params.createdTo = query.createdTo
  }
  if (query.taskFrom) {
    where.push("t.date >= @taskFrom")
    params.taskFrom = query.taskFrom
  }
  if (query.taskTo) {
    where.push("t.date <= @taskTo")
    params.taskTo = query.taskTo
  }
  if (query.branch !== null) {
    const name = await branchName(db, query.branch)
    if (name === null) throw new TaskError("Филиал не найден", 400, "branch")
    where.push(`(${keySql("c.branch")} = ${keySql("@branchName::text")} OR ${keySql("e.branch")} = ${keySql("@branchName::text")})`)
    params.branchName = name
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const countSql = `SELECT COUNT(*)::int AS n ${FROM} ${whereSql}`
  const counted = (await (Object.keys(params).length ? db.prepare(countSql).get(params) : db.prepare(countSql).get())) as { n: number }
  const count = Number(counted?.n ?? 0)
  const rows = (await db
    .prepare(`${SELECT} ${FROM} ${whereSql} ORDER BY t.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as ListRow[]
  return { count, page: query.page, pageSize: query.pageSize, results: rows.map(toListItem) }
}

async function readDetail(db: PgDb, taskId: number): Promise<TaskDetail | null> {
  const row = (await db.prepare(`${SELECT} ${FROM} WHERE t.id = @id`).get({ id: taskId })) as ListRow | undefined
  if (!row) return null
  const plans = (await db
    .prepare(
      `SELECT id, plan_date, comment, status, response, (photo <> '') AS has_photo, done_at
         FROM task_plans WHERE task_id = @id ORDER BY plan_date, id`,
    )
    .all({ id: taskId })) as PlanRow[]
  return { ...toListItem(row), plans: plans.map((plan) => toPlan(taskId, plan)) }
}

/** True when the task exists and its responsible employee is in `scope`. */
async function taskInScope(db: PgDb, taskId: number, scope: FieldScope): Promise<boolean> {
  const row = (await db.prepare("SELECT employee_id FROM tasks WHERE id = ?").get(taskId)) as { employee_id: number | null } | undefined
  return Boolean(row) && scopeAllows(scope, optionalId(row!.employee_id))
}

/** The task with its plans; null when missing or outside the reader's scope. */
export async function getTaskDetail(taskId: number, scope: FieldScope): Promise<TaskDetail | null> {
  await ensureTasksSchema()
  const db = getDb()
  if (!scope.all && !(await taskInScope(db, taskId, scope))) return null
  return readDetail(db, taskId)
}

/** The stored photo (data URL) of a plan of the task, or null (also outside the reader's scope). */
export async function getTaskPlanPhoto(taskId: number, planId: number, scope: FieldScope): Promise<string | null> {
  await ensureTasksSchema()
  const row = (await getDb()
    .prepare("SELECT p.photo, t.employee_id FROM task_plans p JOIN tasks t ON t.id = p.task_id WHERE p.id = ? AND p.task_id = ?")
    .get(planId, taskId)) as { photo: string; employee_id: number | null } | undefined
  if (!row || !scopeAllows(scope, optionalId(row.employee_id))) return null
  return row.photo || null
}

/** GET /api/tasks/options: the pickers of the dialog and the filter, within the reader's scope. */
export async function taskOptions(scope: FieldScope): Promise<TaskOptions> {
  await ensureTasksSchema()
  const db = getDb()
  const employees = (
    (await db.prepare("SELECT id, first_name, last_name, position, active FROM employees ORDER BY id").all()) as {
      id: number
      first_name: string | null
      last_name: string | null
      position: string | null
      active: number | null
    }[]
  ).filter((row) => scopeAllows(scope, Number(row.id)))
  const employeeOptions = employees
    .map((row) => ({
      id: Number(row.id),
      name: `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim(),
      hint: (row.position ?? "").trim() || undefined,
      active: Number(row.active ?? 1) === 1,
    }))
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  // The client's agent (stored by name) → the one active employee of that name.
  const agentByKey = new Map<string, number | null>()
  for (const employee of employeeOptions) {
    if (!employee.active) continue
    const key = nameKey(employee.name)
    agentByKey.set(key, agentByKey.has(key) ? null : employee.id)
  }
  const clients = (await db
    .prepare("SELECT id, name, address, phone, agent FROM clients ORDER BY id DESC")
    .all()) as { id: number; name: string | null; address: string | null; phone: string | null; agent: string | null }[]
  // "Создал": the authors of the tasks the reader may see.
  const creators = (await db
    .prepare(
      `SELECT DISTINCT t.created_by_user_id AS id,
              COALESCE(${personName("ue")}, NULLIF(u.display_name, ''), NULLIF(t.created_by, ''), u.username) AS name
         FROM tasks t
         JOIN users u ON u.id = t.created_by_user_id
         LEFT JOIN employees ue ON ue.id = u.employee_id
        ${scope.all ? "" : "WHERE t.employee_id = ANY(@scopeIds::int[])"}`,
    )
    .all(...(scope.all ? [] : [{ scopeIds: scope.employeeIds }]))) as { id: number; name: string | null }[]
  return {
    clients: clients
      .filter((row) => (row.name ?? "").trim())
      .map((row) => ({
        id: Number(row.id),
        name: row.name ?? "",
        hint: [row.address, row.phone].map((part) => (part ?? "").trim()).filter(Boolean).join(" · ") || undefined,
        agentId: agentByKey.get(nameKey(row.agent ?? "")) ?? null,
      })),
    employees: employeeOptions,
    creators: creators
      .filter((row) => row.id !== null && (row.name ?? "").trim())
      .map((row) => ({ id: Number(row.id), name: row.name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
  }
}

// ---------------------------------------------------------------------------
// References (locked FOR KEY SHARE: a client / employee delete waits for this transaction and
// then sees the task in its usage check)
// ---------------------------------------------------------------------------

type ClientRef = { id: number; name: string }
type EmployeeRef = { id: number; name: string; active: boolean }

const EMPLOYEE_NAME_SQL = "btrim(btrim(coalesce(first_name, '')) || ' ' || btrim(coalesce(last_name, '')))"

async function lockClient(tx: PgDb, id: number, field = "clientId", row?: number): Promise<ClientRef> {
  const found = (await tx.prepare("SELECT id, name FROM clients WHERE id = ? FOR KEY SHARE").get(id)) as ClientRef | undefined
  if (!found) throw new TaskError("Клиент не найден", 400, field, row)
  return { id: Number(found.id), name: found.name ?? "" }
}

/** An inactive employee is refused unless the task already has them (`keep`); one outside the
 * writer's scope like an unknown one. */
async function lockEmployee(tx: PgDb, id: number, keep: number | null, scope: FieldScope, field = "employeeId", row?: number): Promise<EmployeeRef> {
  if (!scopeAllows(scope, id)) throw new TaskError("Сотрудник не найден", 400, field, row)
  const found = (await tx.prepare(`SELECT id, ${EMPLOYEE_NAME_SQL} AS name, active FROM employees WHERE id = ? FOR KEY SHARE`).get(id)) as
    | { id: number; name: string; active: number | null }
    | undefined
  if (!found) throw new TaskError("Сотрудник не найден", 400, field, row)
  const ref = { id: Number(found.id), name: found.name ?? "", active: Number(found.active ?? 1) === 1 }
  if (!ref.active && ref.id !== keep) throw new TaskError("Сотрудник неактивен", 400, field, row)
  return ref
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Status of a plan created together with a task of `status`. */
function firstPlanStatus(status: TaskStatus): TaskPlanStatus {
  return status === "done" ? "done" : status === "finished" ? "finished" : "pending"
}

async function insertTask(
  tx: PgDb,
  input: { title: string; client: ClientRef; employee: EmployeeRef; taskDate: string; status: TaskStatus; planDates: string[] },
  actor: TaskActor,
): Promise<number> {
  const result = await tx
    .prepare(
      `INSERT INTO tasks (responsible, employee_id, store, client_id, description, date, status, created_by_user_id, created_by)
       VALUES (@responsible, @employeeId, @store, @clientId, @title, @date, @status, @userId, @userName)`,
    )
    .run({
      responsible: input.employee.name,
      employeeId: input.employee.id,
      store: input.client.name,
      clientId: input.client.id,
      title: input.title,
      date: input.taskDate,
      status: input.status,
      userId: actor.id,
      userName: actor.displayName ?? "",
    })
  const taskId = Number(result.lastInsertRowid)
  const planStatus = firstPlanStatus(input.status)
  await tx
    .prepare(
      `INSERT INTO task_plans (task_id, plan_date, status, done_at, created_by_user_id)
       SELECT @taskId::int, day, @planStatus::text, CASE WHEN @planStatus::text = 'pending' THEN '' ELSE datetime('now') END, @userId::int
         FROM unnest(@days::text[]) AS day`,
    )
    .run({ taskId, days: input.planDates, planStatus, userId: actor.id })
  return taskId
}

/** POST /api/tasks: the task, its plan #1 on the task day and the "Повторять план" repetitions. */
export async function createTask(input: TaskCreateInput, actor: TaskActor, scope: FieldScope): Promise<TaskDetail> {
  await ensureTasksSchema()
  const planDates = input.repeat ? repeatPlanDates(input.taskDate, input.repeat.frequency, input.repeat.count) : [input.taskDate]
  if (!planDates.length || planDates.some((day) => !isTaskDate(day))) throw new TaskError("Неверная дата", 400, input.repeat ? "repeat.count" : "taskDate")
  return withTransaction(async (tx) => {
    const client = await lockClient(tx, input.clientId)
    const employee = await lockEmployee(tx, input.employeeId, null, scope)
    const taskId = await insertTask(tx, { title: input.title, client, employee, taskDate: input.taskDate, status: "in_progress", planDates }, actor)
    return (await readDetail(tx, taskId))!
  })
}

/** PUT /api/tasks/:id: description, client, responsible and task day (the plans stay). Null when
 * the task is missing or outside the writer's scope. */
export async function updateTask(taskId: number, input: TaskUpdateInput, scope: FieldScope): Promise<TaskDetail | null> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT id, employee_id FROM tasks WHERE id = ? FOR UPDATE").get(taskId)) as
      | { id: number; employee_id: number | null }
      | undefined
    if (!current || !scopeAllows(scope, optionalId(current.employee_id))) return null
    const client = await lockClient(tx, input.clientId)
    const employee = await lockEmployee(tx, input.employeeId, optionalId(current.employee_id), scope)
    await tx
      .prepare(
        `UPDATE tasks SET description = @title, client_id = @clientId, store = @store, employee_id = @employeeId,
                responsible = @responsible, date = @date, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ id: taskId, title: input.title, clientId: client.id, store: client.name, employeeId: employee.id, responsible: employee.name, date: input.taskDate })
    return readDetail(tx, taskId)
  })
}

type LockedTask = { id: number; status: TaskStatus; employee_id: number | null }

/** The task row locked FOR UPDATE; 404 when missing or outside the writer's scope. */
async function lockTask(tx: PgDb, taskId: number, scope: FieldScope): Promise<LockedTask> {
  const row = (await tx.prepare("SELECT id, status, employee_id FROM tasks WHERE id = ? FOR UPDATE").get(taskId)) as LockedTask | undefined
  if (!row || !scopeAllows(scope, optionalId(row.employee_id))) throw new TaskError(TASK_NOT_FOUND, 404)
  return row
}

/** "Принять": a done task becomes finished, and so do its done plans. */
export async function acceptTask(taskId: number, scope: FieldScope): Promise<TaskDetail> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const task = await lockTask(tx, taskId, scope)
    if (task.status === "finished") throw new TaskError("Задача уже завершена", 409)
    if (task.status !== "done") throw new TaskError("Принять можно только выполненную задачу", 409)
    await tx.prepare("UPDATE tasks SET status = 'finished', updated_at = datetime('now') WHERE id = ?").run(taskId)
    await tx.prepare("UPDATE task_plans SET status = 'finished' WHERE task_id = ? AND status = 'done'").run(taskId)
    return (await readDetail(tx, taskId))!
  })
}

/** "Добавить план": a pending plan; a done task goes back to work. */
export async function addTaskPlan(taskId: number, input: z.infer<typeof taskPlanSchema>, actor: TaskActor, scope: FieldScope): Promise<TaskDetail> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const task = await lockTask(tx, taskId, scope)
    if (task.status === "finished") throw new TaskError("Нельзя добавить план к завершённой задаче", 409)
    await tx
      .prepare("INSERT INTO task_plans (task_id, plan_date, comment, status, created_by_user_id) VALUES (@taskId, @date, @comment, 'pending', @userId)")
      .run({ taskId, date: input.date, comment: input.comment ?? "", userId: actor.id })
    if (task.status !== "in_progress") {
      await tx.prepare("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(taskId)
    }
    return (await readDetail(tx, taskId))!
  })
}

/** Agent API: the responsible employee's account (or an administrator) marks a pending plan done /
 * undone, with an optional answer and photo. Once no plan is pending and one is done, the task is done. */
export async function completeTaskPlan(
  taskId: number,
  planId: number,
  input: z.infer<typeof taskPlanCompleteSchema>,
  actor: TaskActor,
  scope: FieldScope,
): Promise<TaskDetail> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const task = await lockTask(tx, taskId, scope)
    const responsible = optionalId(task.employee_id)
    if (actor.role !== "admin" && (actor.employeeId === null || actor.employeeId !== responsible)) {
      throw new TaskError("Отметить план может только ответственный сотрудник", 403)
    }
    if (task.status === "finished") throw new TaskError("Задача уже завершена", 409)
    const plan = (await tx.prepare("SELECT id, status FROM task_plans WHERE id = ? AND task_id = ? FOR UPDATE").get(planId, taskId)) as
      | { id: number; status: string }
      | undefined
    if (!plan) throw new TaskError(PLAN_NOT_FOUND, 404)
    if (!["pending", "in_progress", "new"].includes(plan.status)) throw new TaskError("План уже отмечен", 409)
    await tx
      .prepare(
        `UPDATE task_plans SET status = @status, response = @response, photo = @photo, done_at = datetime('now'), done_by_user_id = @userId
          WHERE id = @planId`,
      )
      .run({ planId, status: input.status, response: input.response ?? "", photo: input.photo ?? "", userId: actor.id })
    const counts = (await tx
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress', 'new'))::int AS open,
                COUNT(*) FILTER (WHERE status = 'done')::int AS done
           FROM task_plans WHERE task_id = ?`,
      )
      .get(taskId)) as { open: number; done: number }
    const next: TaskStatus = Number(counts.open) === 0 && Number(counts.done) > 0 ? "done" : "in_progress"
    if (next !== task.status) await tx.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, taskId)
    return (await readDetail(tx, taskId))!
  })
}

/** False when the task is missing or outside the writer's scope. */
export async function deleteTask(taskId: number, scope: FieldScope): Promise<boolean> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const row = (await tx.prepare("SELECT id, employee_id FROM tasks WHERE id = ? FOR UPDATE").get(taskId)) as { id: number; employee_id: number | null } | undefined
    if (!row || !scopeAllows(scope, optionalId(row.employee_id))) return false
    await tx.prepare("DELETE FROM task_plans WHERE task_id = ?").run(taskId)
    return (await tx.prepare("DELETE FROM tasks WHERE id = ?").run(taskId)).changes > 0
  })
}

// ---------------------------------------------------------------------------
// Excel import (all rows or none)
// ---------------------------------------------------------------------------

const cellText = (value: string | number | undefined) => (value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim())

async function clientByText(tx: PgDb, text: string, row: number, cache: Map<string, ClientRef>): Promise<ClientRef> {
  const key = nameKey(text)
  const cached = cache.get(key)
  if (cached) return cached
  if (!key) throw new TaskError("Выберите магазин", 400, "client", row)
  let ref: ClientRef
  if (/^\d{1,10}$/.test(key) && strictId(key) !== null) {
    ref = await lockClient(tx, Number(key), "client", row)
  } else {
    const found = (await tx
      .prepare(`SELECT id, name FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 2 FOR KEY SHARE`)
      .all({ name: text })) as ClientRef[]
    if (!found.length) throw new TaskError("Клиент не найден", 400, "client", row)
    if (found.length > 1) throw new TaskError("Найдено несколько клиентов с таким названием — выберите клиента из списка", 400, "client", row)
    ref = { id: Number(found[0].id), name: found[0].name ?? "" }
  }
  cache.set(key, ref)
  return ref
}

/** The employee of a sheet row, by id or exact name — only among the writer's scope. */
async function employeeByText(tx: PgDb, text: string, row: number, cache: Map<string, EmployeeRef>, scope: FieldScope): Promise<EmployeeRef> {
  const key = nameKey(text)
  const cached = cache.get(key)
  if (cached) return cached
  if (!key) throw new TaskError("Выберите ответственного", 400, "responsible", row)
  let ref: EmployeeRef
  if (/^\d{1,10}$/.test(key) && strictId(key) !== null) {
    ref = await lockEmployee(tx, Number(key), null, scope, "responsible", row)
  } else {
    const found = (await tx
      .prepare(
        `SELECT id, ${EMPLOYEE_NAME_SQL} AS name, active FROM employees
          WHERE ${keySql(EMPLOYEE_NAME_SQL)} = ${keySql("@name::text")} ${scope.all ? "" : "AND id = ANY(@scopeIds::int[])"} ORDER BY id LIMIT 2 FOR KEY SHARE`,
      )
      .all({ name: text, ...(scope.all ? {} : { scopeIds: scope.employeeIds }) })) as { id: number; name: string; active: number | null }[]
    if (!found.length) throw new TaskError("Сотрудник не найден", 400, "responsible", row)
    if (found.length > 1) throw new TaskError("Найдено несколько сотрудников с таким именем — выберите сотрудника из списка", 400, "responsible", row)
    ref = { id: Number(found[0].id), name: found[0].name ?? "", active: Number(found[0].active ?? 1) === 1 }
    if (!ref.active) throw new TaskError("Сотрудник неактивен", 400, "responsible", row)
  }
  cache.set(key, ref)
  return ref
}

/** POST /api/tasks/import: every row becomes a task with its plan #1, or nothing is saved and the
 * answer names the first bad row. Clients / employees are found by id, else by exact name. */
export async function importTasks(input: TaskImportInput, actor: TaskActor, scope: FieldScope): Promise<{ created: number }> {
  await ensureTasksSchema()
  return withTransaction(async (tx) => {
    const clients = new Map<string, ClientRef>()
    const employees = new Map<string, EmployeeRef>()
    let created = 0
    for (const [index, raw] of input.rows.entries()) {
      const row = raw.line ?? index + 1
      const title = cellText(raw.title)
      if (!title) throw new TaskError("Обязательное поле", 400, "title", row)
      if (title.length > TASK_TITLE_MAX) throw new TaskError(TITLE_TOO_LONG, 400, "title", row)
      const client = await clientByText(tx, cellText(raw.client), row, clients)
      const employee = await employeeByText(tx, cellText(raw.responsible), row, employees, scope)
      const dateText = cellText(raw.taskDate)
      if (!dateText) throw new TaskError(DATE_REQUIRED, 400, "taskDate", row)
      const day = parseDocDay(dateText, { allowFuture: true })
      if (!day.ok) throw new TaskError(day.error, 400, "taskDate", row)
      const statusText = (raw.status ?? "").trim()
      if (statusText && !(TASK_STATUSES as readonly string[]).includes(statusText)) throw new TaskError("Неверный статус", 400, "status", row)
      const status = (statusText || "in_progress") as TaskStatus
      await insertTask(tx, { title, client, employee, taskDate: day.date, status, planDates: [day.date] }, actor)
      created += 1
    }
    return { created }
  })
}
