import "server-only"

import { headers } from "next/headers"
import { NextResponse } from "next/server"

import { requiredPermission } from "@/lib/capabilities-catalog"
import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import { verifyRequestMark, type Role } from "@/lib/session"

const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 }

/** Request headers the proxy sets (and overwrites) on every /api request; the mark is its
 * signature over the other two (lib/session.ts signRequestMark). */
export const REQUEST_PATH_HEADER = "x-linko-path"
export const REQUEST_METHOD_HEADER = "x-linko-method"
export const REQUEST_MARK_HEADER = "x-linko-mark"

export type RoleCheck = { user: CurrentUser } | { error: NextResponse }

const NOT_SIGNED_IN = "Вы не вошли в систему"
const FORBIDDEN = "У вас нет прав на это действие"
/** Same text and code as the edge gate in middleware.ts. */
export const PASSWORD_CHANGE_REQUIRED = "Для продолжения работы задайте новый пароль."
export const PASSWORD_CHANGE_REQUIRED_CODE = "passwordChangeRequired"

/** True when the user may use `code`: admins and users without an access right
 * always may; a user restricted by an access right needs it granted. */
export function hasPermission(user: CurrentUser, code: string): boolean {
  if (user.role === "admin" || user.permissions === null) return true
  return user.permissions.includes(code)
}

/** The path and method of the request being answered, as the proxy saw them. Null when the
 * proxy's signature is missing or wrong: the request did not pass the proxy, or the headers
 * were written by the client — neither value can then be trusted. */
async function currentRequest(): Promise<{ path: string; method: string } | null> {
  try {
    const store = await headers()
    const path = store.get(REQUEST_PATH_HEADER)
    const method = store.get(REQUEST_METHOD_HEADER)
    if (!path || !method) return null
    return (await verifyRequestMark(method, path, store.get(REQUEST_MARK_HEADER))) ? { path, method } : null
  } catch {
    return null
  }
}

/** Re-checks the caller's role against Postgres (via getCurrentUser) on every
 * call — use at the top of any API route handler that mutates data or
 * exposes admin-only configuration (access rights, permissions, employee
 * accounts, sessions). `minRole` is the lowest role allowed through.
 *
 * A user linked to an access right (Права доступа) additionally needs the
 * permission of the resource being changed (lib/capabilities-catalog.ts
 * ROUTE_PERMISSIONS), e.g. 'cash.manage' for /api/cash/**. This is the one
 * place that permission is checked (the edge has no copy of the grants), read
 * from Postgres on every call, so a permission added to or removed from the
 * user's access right or one of its capabilities applies to the next request.
 *
 * An account that must change its password (set by an administrator, the
 * seeded first password, one weaker than the policy) is refused with 403
 * {code: 'passwordChangeRequired'} until it has done so — checked here against
 * Postgres, and at the edge from the session claim (proxy.ts). */
export async function requireRole(minRole: Role): Promise<RoleCheck> {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 }) }
  if (user.mustChangePassword) {
    return {
      error: NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 }),
    }
  }
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    return { error: NextResponse.json({ error: FORBIDDEN }, { status: 403 }) }
  }
  // Only a user restricted by an access right needs the resource's permission; for them the
  // path and method must be known for sure. Without the proxy's signed values the permission
  // cannot be worked out, so such a request is refused instead of being let through unchecked.
  if (user.role !== "admin" && user.permissions !== null) {
    const request = await currentRequest()
    if (!request) return { error: NextResponse.json({ error: FORBIDDEN }, { status: 403 }) }
    const code = requiredPermission(request.path, request.method)
    if (code && !hasPermission(user, code)) {
      return { error: NextResponse.json({ error: FORBIDDEN, permission: code }, { status: 403 }) }
    }
  }
  return { user }
}

/** Explicit permission gate for routes that need one regardless of the path map. */
export async function requirePermission(code: string, minRole: Role = "manager"): Promise<RoleCheck> {
  const check = await requireRole(minRole)
  if ("error" in check) return check
  if (!hasPermission(check.user, code)) {
    return { error: NextResponse.json({ error: FORBIDDEN, permission: code }, { status: 403 }) }
  }
  return check
}
