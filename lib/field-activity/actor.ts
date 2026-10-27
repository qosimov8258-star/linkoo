import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { hasPermission, PASSWORD_CHANGE_REQUIRED, PASSWORD_CHANGE_REQUIRED_CODE, requireRole } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// Who may send and who may read field activity data.
//
// Writes (/api/mobile/**) always act as the caller's own employee: the signed-in account
// must be linked to an employee (users.employee_id, lib/auth-employee.ts), and requireRole
// checks the role and the route permission (lib/capabilities-catalog.ts: /api/mobile →
// clients.manage). No body field can name another employee.
//
// Reads: administrators, users without an access right (role model only) and users whose
// access right grants clients.manage see every employee; any other signed-in user linked to
// an employee sees only their own data; the rest get 403.

export type FieldActor = {
  user: CurrentUser
  employee: { id: number; name: string; gpsCheck: boolean; showInTracking: boolean }
}

export type ActorCheck = { actor: FieldActor; error?: undefined } | { actor?: undefined; error: NextResponse }

const FORBIDDEN = "У вас нет прав на это действие"

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

/** What a reader may see: every employee, or only their own one. */
export type FieldScope = { all: true } | { all: false; employeeId: number }

export type ReaderCheck = { user: CurrentUser; scope: FieldScope; error?: undefined } | { user?: undefined; scope?: undefined; error: NextResponse }

/** Read scope of a user (see the header). Null: may not read field data. */
export function fieldScopeOf(user: CurrentUser): FieldScope | null {
  if (user.role === "admin" || user.permissions === null || hasPermission(user, "clients.manage")) return { all: true }
  return user.employeeId ? { all: false, employeeId: user.employeeId } : null
}

/** The signed-in reader of field data and their scope, or the refusal (401 / 403). */
export async function requireFieldReader(): Promise<ReaderCheck> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  if (user.mustChangePassword) {
    return { error: NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 }) }
  }
  const scope = fieldScopeOf(user)
  if (!scope) return { error: NextResponse.json({ error: FORBIDDEN }, { status: 403 }) }
  return { user, scope }
}

/**
 * The employees a reader may ask for: `requested` as is for a full scope (undefined = all);
 * for an own-data scope only their own employee (requesting anyone else yields an empty list,
 * so the reader sees nothing of theirs).
 */
export function scopedEmployeeIds(scope: FieldScope, requested: number[] | undefined): number[] | undefined {
  if (scope.all) return requested && requested.length ? requested : undefined
  if (!requested || !requested.length) return [scope.employeeId]
  return requested.filter((id) => id === scope.employeeId)
}

/** True when the reader may see data of `employeeId`. */
export function scopeAllows(scope: FieldScope, employeeId: number): boolean {
  return scope.all || scope.employeeId === employeeId
}
