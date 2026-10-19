import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { SESSION_COOKIE } from "@/lib/session"
import { revokeSession } from "@/lib/user-sessions-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const { id } = await params
  const ok = (await revokeSession(id, user.id))
  if (!ok) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 })

  const response = NextResponse.json({ ok: true })
  if (id === user.sessionId) {
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 })
  }
  return response
}
