import { NextRequest, NextResponse } from "next/server"

import { SESSION_COOKIE, verifySession } from "@/lib/session"
import { revokeSession } from "@/lib/user-sessions-repo"

// Signing out revokes the session on the server (user_sessions.revoked_at), so
// a copied cookie stops working at once instead of living on for 7–30 days.
// Always answers 200 and clears the cookie, even for an already invalid one.
export async function POST(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (session?.sessionId) await revokeSession(session.sessionId, session.userId)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" })
  return response
}
