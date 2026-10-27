// Client-safe types and helpers of "Задачи" (/analytics/tasks, API /api/tasks). Server side:
// lib/tasks-repo.ts.
//
// A task is given to one of the factory's own clients ("Магазин", clients.id) and employees
// ("Ответственный пользователь", employees.id) for a day ("Дата задачи"). Every task has plans
// (task_plans): plan #1 on the task day, more through "Повторять план" (every 7 / 14 days) or
// "Добавить план". The responsible agent marks each plan done / undone through the agent API
// (POST /api/tasks/:id/plans/:planId/complete); once nothing is pending and something was done the
// task is "Выполнено", and a manager's "Принять" makes it "Завершено".

import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"

export type TaskStatus = "new" | "in_progress" | "done" | "finished"
export const TASK_STATUSES: readonly TaskStatus[] = ["new", "in_progress", "done", "finished"]

/** The list tabs (absent = "Все"). */
export type TaskTab = "in_progress" | "done" | "finished" | "all"
export const TASK_TABS: readonly { key: TaskTab; label: string }[] = [
  { key: "in_progress", label: "В процессе" },
  { key: "done", label: "Выполнено" },
  { key: "finished", label: "Завершенный" },
  { key: "all", label: "Все" },
]

export type TaskPlanStatus = "pending" | "in_progress" | "done" | "undone" | "finished" | "new"
export const TASK_PLAN_STATUSES: readonly TaskPlanStatus[] = ["pending", "in_progress", "done", "undone", "finished", "new"]

/** Russian i18n keys of the task statuses (status icon tooltip, "Статус" in the drawer). */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  new: "Новый",
  in_progress: "В процессе",
  done: "Выполнено",
  finished: "Завершено",
}

/** Russian i18n keys of the plan statuses. */
export const TASK_PLAN_STATUS_LABELS: Record<TaskPlanStatus, string> = {
  pending: "В процессе",
  in_progress: "В процессе",
  done: "Выполнено",
  undone: "Не выполнено",
  finished: "Завершено",
  new: "Новый",
}

export type TaskListItem = {
  id: number
  /** "Описание" (the task's text). */
  title: string
  /** null = the client was removed / an older name-only task. */
  clientId: number | null
  client: string
  responsibleId: number | null
  responsible: string
  /** users.id of the author (null for tasks saved before it was kept). */
  createdById: number | null
  createdBy: string
  status: TaskStatus
  /** "YYYY-MM-DD" ("" when an older task has none). */
  taskDate: string
  /** UTC "YYYY-MM-DD HH:MM:SS". */
  createdAt: string
}

export type TaskPlan = {
  id: number
  /** "YYYY-MM-DD". */
  date: string
  comment: string
  status: TaskPlanStatus
  /** The agent's answer. */
  response: string
  /** GET /api/tasks/:id/plans/:planId/photo, or null. */
  photoUrl: string | null
  /** UTC "YYYY-MM-DD HH:MM:SS" when done / undone was set ("" otherwise). */
  doneAt: string
}

export type TaskDetail = TaskListItem & { plans: TaskPlan[] }

export type TaskListResponse = { count: number; page: number; pageSize: number; results: TaskListItem[] }

export type TaskOption = { id: number; name: string; hint?: string }
/** GET /api/tasks/options. */
export type TaskOptions = {
  /** agentId: the active employee named as the client's agent (auto-fills "Ответственный пользователь"). */
  clients: (TaskOption & { agentId: number | null })[]
  employees: (TaskOption & { active: boolean })[]
  /** Accounts that created tasks ("Создал"). */
  creators: TaskOption[]
}

/** Body of POST /api/tasks (PUT /api/tasks/:id takes the same without the repetition). */
export type TaskInputBody = {
  title: string
  clientId: number
  employeeId: number
  taskDate: string
  repeat?: { frequency: TaskPlanFrequency; count: number } | null
}

export type TaskPlanFrequency = 7 | 14
export const TASK_PLAN_FREQUENCIES: readonly { value: TaskPlanFrequency; label: string }[] = [
  { value: 7, label: "Раз в неделю" },
  { value: 14, label: "Раз в 2 недели" },
]

export const TASK_TITLE_MAX = 1000
export const TASK_COMMENT_MAX = 1000
export const TASK_REPEAT_MAX = 52
export const TASK_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000] as const
export const TASK_DEFAULT_PAGE_SIZE = 25
/** Most rows of one Excel import. */
export const TASK_IMPORT_MAX_ROWS = 2000

/** Today's local (Asia/Tashkent, UTC+5, no DST) day as "YYYY-MM-DD". */
export function todayTaskDate(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
}

/** First and last day of the month of `day` ("YYYY-MM-DD"). */
export function monthRange(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const prefix = `${year}-${String(month).padStart(2, "0")}`
  return [`${prefix}-01`, `${prefix}-${String(last).padStart(2, "0")}`]
}

/** True for a real calendar day "YYYY-MM-DD" with a year in 2000..2100 (lib/document-dates.ts). */
export function isTaskDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < DOC_MIN_YEAR || year > DOC_MAX_YEAR) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** `day` + `days` ("YYYY-MM-DD"). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The days of the plans "Повторять план" sets: taskDate + i × frequency, i = 0..count-1. */
export function repeatPlanDates(taskDate: string, frequency: number, count: number): string[] {
  if (!isTaskDate(taskDate) || !Number.isInteger(count) || count < 1 || count > TASK_REPEAT_MAX) return []
  return Array.from({ length: count }, (_, index) => addDays(taskDate, index * frequency))
}

/** Russian i18n key of the "элемент" word after a count (1 элемент, 2 элемента, 5 элементов). */
export function elementWord(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod10 === 1 && mod100 !== 11) return "элемент"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "элемента"
  return "элементов"
}

/** Comparable form of a typed name: NBSP / narrow NBSP as spaces, whitespace collapsed, trimmed, lower case. */
export function textKey(value: string): string {
  return value.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
}
