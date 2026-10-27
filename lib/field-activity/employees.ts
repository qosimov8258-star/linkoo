import "server-only"

import { ensureUserEmployeeLink } from "@/lib/auth-employee"
import { getDb } from "@/lib/db"
import { keySql } from "@/lib/platform-refs"
import type { FieldEmployee, FieldGroup } from "@/lib/field-activity/types"

// Employees as the field pages list them: the tracking role tab (group) comes from the job
// position name (employees.position is free text), the account linked to the employee from
// users.employee_id.

const GROUP_PATTERNS: Array<[FieldGroup, RegExp]> = [
  ["merch", /merch|мерч/],
  ["collector", /inkass|инкасс|collector/],
  ["delivery", /dostav|достав|ekspeditor|экспедит|deliver|courier|kuryer|курьер|haydovchi|водител/],
  ["agent", /agent|агент/],
]

/** Tracking group of a job position name (case-insensitive substring rules, design §1). */
export function fieldGroupOf(position: string | null | undefined): FieldGroup {
  const text = String(position ?? "").toLowerCase()
  for (const [group, pattern] of GROUP_PATTERNS) if (pattern.test(text)) return group
  return "other"
}

export type FieldEmployeeQuery = {
  /** Only active employees (default true). */
  activeOnly?: boolean
  /** Only employees with "Показывать в отслеживании" on (default false). */
  trackedOnly?: boolean
  /** Only employees of this branch (employees.branch matched to branches.name). */
  branchId?: number
  /** Only these groups. */
  groups?: FieldGroup[]
  /** Only these employees. */
  employeeIds?: number[]
}

/** Employees with their tracking group and linked account, sorted by name. */
export async function listFieldEmployees(query: FieldEmployeeQuery = {}): Promise<FieldEmployee[]> {
  if (query.employeeIds && !query.employeeIds.length) return []
  await ensureUserEmployeeLink()
  const where: string[] = []
  if (query.activeOnly !== false) where.push("e.active = 1")
  if (query.trackedOnly) where.push("e.show_in_tracking = 1")
  if (query.employeeIds) where.push("e.id = ANY(@employeeIds::int[])")
  if (query.branchId) {
    where.push(`${keySql("e.branch")} = (SELECT ${keySql("b.name")} FROM branches b WHERE b.id = @branchId)`)
  }
  const sql = `SELECT e.id, e.first_name, e.last_name, e.position, e.branch, e.active, e.show_in_tracking, e.gps_check, u.id AS user_id, u.username
       FROM employees e
       LEFT JOIN LATERAL (SELECT id, username FROM users WHERE employee_id = e.id ORDER BY id LIMIT 1) u ON true
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${keySql("e.first_name || ' ' || e.last_name")}, e.id`
  // Named parameters only when the statement has any (an unused one would be sent as a bind value).
  const rows = (await getDb()
    .prepare(sql)
    .all(...(/@\w/.test(sql) ? [{ employeeIds: query.employeeIds ?? [], branchId: query.branchId ?? 0 }] : []))
    .catch(async (error: unknown) => {
      // A fresh database without the branches table: the branch filter matches nothing.
      if (query.branchId && (error as { code?: string }).code === "42P01") return []
      throw error
    })) as Array<{
    id: number
    first_name: string | null
    last_name: string | null
    position: string | null
    branch: string | null
    active: number
    show_in_tracking: number
    gps_check: number
    user_id: number | null
    username: string | null
  }>
  const employees = rows.map((row) => ({
    employeeId: Number(row.id),
    name: `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim(),
    position: row.position ?? "",
    group: fieldGroupOf(row.position),
    branch: row.branch ?? "",
    active: Number(row.active) === 1,
    showInTracking: Number(row.show_in_tracking) === 1,
    gpsCheck: Number(row.gps_check) === 1,
    userId: row.user_id === null ? null : Number(row.user_id),
    username: row.username ?? null,
  }))
  return query.groups ? employees.filter((employee) => query.groups!.includes(employee.group)) : employees
}
