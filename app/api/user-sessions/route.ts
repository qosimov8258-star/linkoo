import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSessionsForUser } from "@/lib/user-sessions-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const sessions = (await listSessionsForUser(user.id)).map((session) => ({
    ...session,
    isCurrent: session.id === user.sessionId,
  }))
  return NextResponse.json(sessions)
}
