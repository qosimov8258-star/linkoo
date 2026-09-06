import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { revokeOtherSessions } from "@/lib/user-sessions-repo"

export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  if (!user.sessionId) return NextResponse.json({ error: "Joriy sessiya aniqlanmadi" }, { status: 400 })

  const count = (await revokeOtherSessions(user.id, user.sessionId))
  return NextResponse.json({ ok: true, revoked: count })
}
