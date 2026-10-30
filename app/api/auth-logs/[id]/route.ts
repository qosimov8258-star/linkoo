import { NextResponse } from "next/server"
import { z } from "zod"

import { AuthLogError, setAuthLogActive } from "@/lib/auth-logs-repo"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { PASSWORD_CHANGE_REQUIRED, PASSWORD_CHANGE_REQUIRED_CODE } from "@/lib/rbac"
import { SESSION_COOKIE } from "@/lib/session"
import { invalidIdResponse, notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const bodySchema = z.strictObject({ active: z.boolean({ error: "Неверное значение" }) })

// "Завершить" / "Восстановить" of the journal. Ending a sign-in of one's own account is self-service (like
// DELETE /api/user-sessions/[id]); ending another account's sign-in needs the journal's permission (settings.manage,
// lib/capabilities-catalog.ts), and an administrator's sign-ins only an administrator may end. Restoring is an
// administrator's action and brings back only what the journal itself ended (never a sign-out, a password or access
// change or a deleted account: 409) — decided in lib/auth-logs-repo.ts setAuthLogActive against the row it locks.
export const PATCH = withDbErrors(async (request: Request, { params }: RouteParams) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  if (user.mustChangePassword) return NextResponse.json({ error: PASSWORD_CHANGE_REQUIRED, code: PASSWORD_CHANGE_REQUIRED_CODE }, { status: 403 })
  // Viewers only look (also refused at the edge, middleware.ts).
  if (user.role === "viewer") return NextResponse.json({ error: "У вас нет прав на это действие" }, { status: 403 })
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, bodySchema)
  if (parsed.error) return parsed.error
  try {
    const result = await setAuthLogActive(id, parsed.data.active, user)
    if (!result) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 })
    const response = NextResponse.json({ ...result.log, signedOut: result.endedCurrent })
    // The caller ended the session they use: sign this browser out too.
    if (result.endedCurrent) response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 })
    return response
  } catch (error) {
    if (error instanceof AuthLogError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
})
