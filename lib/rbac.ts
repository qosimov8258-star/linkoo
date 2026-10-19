import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import type { Role } from "@/lib/session"

const ROLE_RANK: Record<Role, number> = { viewer: 0, manager: 1, admin: 2 }

export type RoleCheck = { user: CurrentUser } | { error: NextResponse }

/** Re-checks the caller's role against Postgres (via getCurrentUser) on every
 * call — use at the top of any API route handler that mutates data or
 * exposes admin-only configuration (access rights, permissions, employee
 * accounts, sessions). `minRole` is the lowest role allowed through. */
export async function requireRole(minRole: Role): Promise<RoleCheck> {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 }) }
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    return { error: NextResponse.json({ error: "У вас нет прав на это действие" }, { status: 403 }) }
  }
  return { user }
}
