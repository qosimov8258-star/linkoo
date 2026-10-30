import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { columnsOf } from "@/lib/field-activity/schema"
import { hasPermission, PASSWORD_CHANGE_REQUIRED, PASSWORD_CHANGE_REQUIRED_CODE, requireRole } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// Who may send and who may read field activity data.
//
// Writes (/api/mobile/**) always act as the caller's own employee: the signed-in account
// must be linked to an employee (users.employee_id, lib/auth-employee.ts), and requireRole
// checks the role and the route permission (lib/capabilities-catalog.ts: /api/mobile →
// clients.manage). No body field can name another employee.
//
// Reads (visits, routes, GPS, photos, refusals, attendance, tasks, the dashboard field block)
// and the writes that name an employee (route plans, route optimisation, tasks, photo-report
// review) follow one scope:
// - every employee: administrators, users without an access right (role model only) and users
//   whose access right grants the staff permission FULL_FIELD_SCOPE_PERMISSION (settings.manage:
//   "Филиалы, валюты, сотрудники, должности и кассы" — the permission of Сотрудники and
//   Посещаемость). clients.manage does NOT widen the scope: every agent holds it for the
//   mobile writes;
// - any other signed-in user linked to an employee: their own employee plus the agents whose
//   card names that employee as supervisor (employees.details.supervisorId);
// - the rest: 403.

export type FieldActor = {
  user: CurrentUser
  employee: { id: number; name: string; gpsCheck: boolean; showInTracking: boolean }
}

export type ActorCheck = { actor: FieldActor; error?: undefined } | { actor?: undefined; error: NextResponse }

const FORBIDDEN = "У вас нет прав на это действие"

/** The permission whose holders see every employee's field data (the staff settings). */
export const FULL_FIELD_SCOPE_PERMISSION = "settings.manage"

/** The signed-in field employee of a mobile write, or the refusal (401 / 403). */
export async function requireFieldActor(): Promise<ActorCheck> {
  const check = await requireRole("manager")
  if ("error" in check) return { error: check.error }
  const user = check.user
  if (!user.employeeId) {
    return { error: NextResponse.json({ error: FIELD_MESSAGES.noEmployee, code: "noEmployee" }, { status: 403 }) }
  }
  const row = (await getDb()
    .prepare("SELECT id, first_name, last_name, active, gps_check, show_in_tracking FROM employees WHERE id = ?")
    .get(user.employeeId)) as
    | { id: number; first_name: string | null; last_name: string | null; active: number; gps_check: number | null; show_in_tracking: number | null }
    | undefined
  if (!row) return { error: NextResponse.json({ error: FIELD_MESSAGES.noEmployee, code: "noEmployee" }, { status: 403 }) }
  if (Number(row.active) !== 1) return { error: NextResponse.json({ error: FIELD_MESSAGES.employeeInactive, code: "employeeInactive" }, { status: 403 }) }
  return {
    actor: {
      user,
      employee: {
        id: Number(row.id),
        name: `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim(),
        gpsCheck: Number(row.gps_check ?? 0) === 1,
        showInTracking: Number(row.show_in_tracking ?? 1) === 1,
      },
    },
  }
}

/**
 * What a reader may see: every employee, or `employeeIds` = their own employee (`employeeId`)
 * followed by the agents they supervise.
 */
export type FieldScope = { all: true } | { all: false; employeeId: number; employeeIds: number[] }

export type ReaderCheck = { user: CurrentUser; scope: FieldScope; error?: undefined } | { user?: undefined; scope?: undefined; error: NextResponse }

/** True when the user sees every employee's field data (see the header). */
export function hasFullFieldScope(user: CurrentUser): boolean {
  return user.role === "admin" || user.permissions === null || hasPermission(user, FULL_FIELD_SCOPE_PERMISSION)
}

/** A supervisor id stored on an employee card (a positive integer, as a number or digits). */
function supervisorIdOf(details: string | null): number | null {
  if (!details) return null
  try {
    const value = (JSON.parse(details) as { supervisorId?: unknown } | null)?.supervisorId
    const id = typeof value === "number" ? value : typeof value === "string" && /^\d{1,10}$/.test(value.trim()) ? Number(value.trim()) : NaN
    return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null
  } catch {
    return null
  }
}

/** employees.details exists (seen once per process; a column is never dropped, so only `true` is kept). */
let detailsColumnSeen = false

/** The employees (active or not, for their history) whose card names `supervisorId` as supervisor. */
export async function supervisedEmployeeIds(supervisorId: number): Promise<number[]> {
  // employees.details (the card's JSON) is added by the Сотрудники module; without it nobody has a supervisor.
  if (!detailsColumnSeen) {
    if (!(await columnsOf(["employees"])).get("employees")?.has("details")) return []
    detailsColumnSeen = true
  }
  const rows = (await getDb()
    .prepare("SELECT id, details FROM employees WHERE details IS NOT NULL AND strpos(details, 'supervisorId') > 0 AND id <> ? ORDER BY id")
    .all(supervisorId)) as Array<{ id: number; details: string | null }>
  return rows.filter((row) => supervisorIdOf(row.details) === supervisorId).map((row) => Number(row.id))
}

/** Read scope of a user (see the header). Null: may not read field data. */
export async function fieldScopeOf(user: CurrentUser): Promise<FieldScope | null> {
  if (hasFullFieldScope(user)) return { all: true }
  if (!user.employeeId) return null
  const agents = await supervisedEmployeeIds(user.employeeId)
  return { all: false, employeeId: user.employeeId, employeeIds: [user.employeeId, ...agents.filter((id) => id !== user.employeeId)] }
}

/** The signed-in reader of field data and their scope, or the refusal (401 / 403). */
export async function requireFieldReader(): Promise<ReaderCheck> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  if (user.mustChangePassword) {
    return { error: NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 }) }
  }
  const scope = await fieldScopeOf(user)
  if (!scope) return { error: forbiddenResponse() }
  return { user, scope }
}

/** 403 of a user without any field scope. */
export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: FORBIDDEN }, { status: 403 })
}

/**
 * The field scope of a writer that already passed requireRole / requirePermission, for a write
 * that names an employee or acts on one employee's record: `{scope}`, or 403 without any field
 * scope. The caller refuses an employee outside the scope like an unknown one (scopeAllows).
 */
export async function fieldWriteScope(user: CurrentUser): Promise<{ scope: FieldScope; error?: undefined } | { scope?: undefined; error: NextResponse }> {
  const scope = await fieldScopeOf(user)
  return scope ? { scope } : { error: forbiddenResponse() }
}

/**
 * The employees a reader may ask for: `requested` as is for a full scope (undefined = all);
 * for a narrower scope the requested ones inside it (requesting anyone else yields an empty list,
 * so the reader sees nothing of theirs), or the whole scope when nothing is requested.
 */
export function scopedEmployeeIds(scope: FieldScope, requested: number[] | undefined): number[] | undefined {
  if (scope.all) return requested && requested.length ? requested : undefined
  if (!requested || !requested.length) return [...scope.employeeIds]
  return requested.filter((id) => scope.employeeIds.includes(id))
}

/** True when the reader may see data of `employeeId`. */
export function scopeAllows(scope: FieldScope, employeeId: number | null | undefined): boolean {
  if (scope.all) return true
  return typeof employeeId === "number" && scope.employeeIds.includes(employeeId)
}
