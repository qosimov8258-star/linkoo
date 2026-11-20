import "server-only"

import { getDb } from "@/lib/db"
import type { ActivityColumn } from "@/lib/activity-types"

// Linko's Активность (market/today_plan_stat, market/agent/done_plan) is built from the done tasks of its agents'
// day plans, not from the documents themselves:
// - a card of Сделки / Отчеты / Сбор денег / Доставки is a done task of type order / march_report / payment /
//   delivery, taken by the day of its plan (plan_day), dated at the moment it was done and listed newest task first
//   (task id descending: a delivery done before an earlier task of the same day keeps Linko's place);
// - the agent strip counts the done visit and no-plan-visit tasks;
// - Linko's «Возвраты» list (market/plan_tasks?type=order_return) is empty for every period of its history;
// - both the lists and the header sums leave out employees that are neither active nor «Показывать в отслеживании»
//   (Linko time3, 2025: orders 580 of 637, photo reports 74 of 79, refusals 52 of 121 in the header).
// The local copy keeps those tasks in linko_day_tasks up to linko_history 'day_tasks' (scripts/linko-sync
// import-day-tasks.mjs); days after it are read from the app's own documents. Without that table nothing changes.

/** Task type of a column in linko_day_tasks (null: the column has no task list). */
const TASK_TYPE: Partial<Record<ActivityColumn, string>> = {
  order: "order",
  photo_report: "march_report",
  payment: "payment",
  delivery: "delivery",
}

/** The columns whose history cards are Linko's day-plan tasks. Refusals are listed from field_refusals in every period. */
export const HISTORY_TASK_COLUMNS: ActivityColumn[] = ["order", "photo_report", "payment", "delivery", "return"]

export type HistoryFilter = {
  /** Local days, inclusive, already cut to the history. */
  from: string
  to: string
  /** Narrow to these employees (undefined = everyone). */
  employeeIds?: number[]
  clientTypeIds: number[]
  withEquipment: boolean | undefined
  branchId: number | undefined
}

export type HistoryTask = {
  id: number
  column: ActivityColumn
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  at: string
  employeeId: number
  clientId: number | null
  orderId: number | null
  paymentId: number | null
  reportId: number | null
}

/** Last day ("YYYY-MM-DD") of the Linko day-plan history, or null when the local copy has none. */
export async function dayTaskHistoryEnd(): Promise<string | null> {
  const db = getDb()
  const tables = (await db
    .prepare("SELECT to_regclass('public.linko_day_tasks') IS NOT NULL AS tasks, to_regclass('public.linko_history') IS NOT NULL AS history")
    .get()) as { tasks: boolean; history: boolean } | undefined
  if (!tables?.tasks || !tables.history) return null
  const row = (await db.prepare("SELECT to_char(until::timestamp, 'YYYY-MM-DD') AS day FROM linko_history WHERE ledger = 'day_tasks'").get()) as
    | { day: string | null }
    | undefined
  return row?.day ?? null
}

/** Employees Linko leaves out of Активность: neither active nor tracked. */
export async function activityHiddenEmployeeIds(): Promise<number[]> {
  const rows = (await getDb()
    .prepare("SELECT id FROM employees WHERE COALESCE(active, 0) <> 1 AND COALESCE(show_in_tracking, 0) <> 1")
    .all()) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

/** WHERE of the done tasks of `types` in the filter (employee rule included). */
function taskWhere(filter: HistoryFilter, types: string[]): { sql: string; params: Record<string, unknown> } {
  const where = [
    "t.status = 'done'",
    "t.type = ANY(@types::text[])",
    "t.plan_day BETWEEN @from::date AND @to::date",
    "(COALESCE(e.active, 0) = 1 OR COALESCE(e.show_in_tracking, 0) = 1)",
  ]
  if (filter.employeeIds) where.push("t.employee_id = ANY(@employeeIds::int[])")
  if (filter.branchId) where.push("fin_key(e.branch) = (SELECT fin_key(b.name) FROM branches b WHERE b.id = @branchId)")
  if (filter.clientTypeIds.length) where.push("fin_key(c.type) IN (SELECT fin_key(ct.name) FROM client_types ct WHERE ct.id = ANY(@clientTypeIds::int[]))")
  if (filter.withEquipment !== undefined) {
    const equipment = "EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.client_id = t.client_id AND COALESCE(ii.deleted, 0) = 0)"
    where.push(filter.withEquipment ? equipment : `t.client_id IS NOT NULL AND NOT ${equipment}`)
  }
  return {
    sql: `FROM linko_day_tasks t
          JOIN employees e ON e.id = t.employee_id
          LEFT JOIN clients c ON c.id = t.client_id
         WHERE ${where.join(" AND ")}`,
    params: {
      types,
      from: filter.from,
      to: filter.to,
      employeeIds: filter.employeeIds ?? [],
      branchId: filter.branchId ?? 0,
      clientTypeIds: filter.clientTypeIds,
    },
  }
}

/** Number of history cards per column. */
export async function historyCardCounts(filter: HistoryFilter): Promise<Partial<Record<ActivityColumn, number>>> {
  if (filter.employeeIds && !filter.employeeIds.length) return {}
  const types = Object.values(TASK_TYPE) as string[]
  const built = taskWhere(filter, types)
  const rows = (await getDb().prepare(`SELECT t.type, COUNT(*)::int AS n ${built.sql} GROUP BY t.type`).all(built.params)) as Array<{ type: string; n: number }>
  const counts: Partial<Record<ActivityColumn, number>> = {}
  for (const [column, type] of Object.entries(TASK_TYPE) as Array<[ActivityColumn, string]>) {
    counts[column] = Number(rows.find((row) => row.type === type)?.n ?? 0)
  }
  return counts
}

/** One page of the history cards of a column, newest first, and their count. */
export async function historyTaskPage(
  column: ActivityColumn,
  filter: HistoryFilter,
  page: { limit: number; offset: number },
): Promise<{ count: number; tasks: HistoryTask[] }> {
  const type = TASK_TYPE[column]
  if (!type || (filter.employeeIds && !filter.employeeIds.length)) return { count: 0, tasks: [] }
  const built = taskWhere(filter, [type])
  const rows = (await getDb()
    .prepare(
      `SELECT t.id, t.employee_id, t.client_id, t.order_id, t.payment_id, t.report_id,
              to_char(t.done_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS at_text, COUNT(*) OVER () AS total
         ${built.sql}
        ORDER BY t.id DESC
        LIMIT ${Math.max(1, Math.floor(page.limit))} OFFSET ${Math.max(0, Math.floor(page.offset))}`,
    )
    .all(built.params)) as Array<{
    id: number
    employee_id: number
    client_id: number | null
    order_id: number | null
    payment_id: number | null
    report_id: number | null
    at_text: string | null
    total: number | string
  }>
  let count = rows.length ? Number(rows[0].total) : 0
  if (!rows.length && page.offset > 0) {
    const row = (await getDb().prepare(`SELECT COUNT(*)::int AS n ${built.sql}`).get(built.params)) as { n: number }
    count = Number(row.n)
  }
  const id = (value: number | null) => (value === null || value === undefined ? null : Number(value))
  return {
    count,
    tasks: rows.map((row) => ({
      id: Number(row.id),
      column,
      at: row.at_text ?? "",
      employeeId: Number(row.employee_id),
      clientId: id(row.client_id),
      orderId: id(row.order_id),
      paymentId: id(row.payment_id),
      reportId: id(row.report_id),
    })),
  }
}

/** Done visit / no-plan-visit tasks per employee (the agent strip's number). */
export async function historyVisits(filter: HistoryFilter): Promise<Map<number, number>> {
  if (filter.employeeIds && !filter.employeeIds.length) return new Map()
  const built = taskWhere(filter, ["visit", "no_plan_visit"])
  const rows = (await getDb().prepare(`SELECT t.employee_id, COUNT(*)::int AS n ${built.sql} GROUP BY t.employee_id`).all(built.params)) as Array<{
    employee_id: number
    n: number
  }>
  return new Map(rows.map((row) => [Number(row.employee_id), Number(row.n)]))
}

/**
 * Linko's day counts of the tracking list (market/way done_count / todo_count / no_plan_count) for a day of its
 * history: the planned items of the agent's day plan (visit and delivery tasks, any status), those done, and the
 * no-plan visits — equal to Linko for every agent on 2026-01-21 and 2025-12-24.
 */
export async function historyDayCounts(employeeIds: number[], day: string): Promise<Map<number, { done: number; todo: number; unplanned: number }>> {
  if (!employeeIds.length) return new Map()
  const rows = (await getDb()
    .prepare(
      `SELECT t.employee_id,
              COUNT(*) FILTER (WHERE t.type IN ('visit', 'delivery') AND t.status = 'done')::int AS done,
              COUNT(*) FILTER (WHERE t.type IN ('visit', 'delivery'))::int AS todo,
              COUNT(*) FILTER (WHERE t.type = 'no_plan_visit')::int AS unplanned
         FROM linko_day_tasks t
        WHERE t.plan_day = @day::date AND t.employee_id = ANY(@employeeIds::int[])
        GROUP BY t.employee_id`,
    )
    .all({ day, employeeIds })) as Array<{ employee_id: number; done: number; todo: number; unplanned: number }>
  const counts = new Map(employeeIds.map((id) => [id, { done: 0, todo: 0, unplanned: 0 }]))
  for (const row of rows) counts.set(Number(row.employee_id), { done: Number(row.done), todo: Number(row.todo), unplanned: Number(row.unplanned) })
  return counts
}

/** The clients of an agent's Linko day plan (its visit and delivery tasks), in the plan's order. */
export async function historyPlannedClientIds(employeeId: number, day: string): Promise<number[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.client_id, MIN(t.id) AS first
         FROM linko_day_tasks t
        WHERE t.plan_day = @day::date AND t.employee_id = @employeeId AND t.type IN ('visit', 'delivery') AND t.client_id IS NOT NULL
        GROUP BY t.client_id
        ORDER BY first`,
    )
    .all({ day, employeeId })) as Array<{ client_id: number }>
  return rows.map((row) => Number(row.client_id))
}
