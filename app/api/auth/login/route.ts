import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { verifyPassword } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { REMEMBER_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, signSession, type Role } from "@/lib/session"
import { recordAuthLog } from "@/lib/auth-logs-repo"
import { recordSession } from "@/lib/user-sessions-repo"
import { parseJsonBody } from "@/lib/validation"

type UserRow = {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: string
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, loginSchema)
  if (parsed.error) return parsed.error
  const { username, password, remember } = parsed.data

  const db = getDb()
  const user = (await db.prepare("SELECT * FROM users WHERE username = ?").get(username)) as UserRow | undefined
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
  }

  const role: Role = user.role === "admin" || user.role === "manager" ? user.role : "viewer"
  const ttlMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS
  const sid = crypto.randomUUID()
  const token = await signSession({ userId: user.id, role, sessionId: sid }, ttlMs)

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || ""
  const userAgent = request.headers.get("user-agent") || ""
  await recordSession({ id: sid, userId: user.id, ip, userAgent })
  await recordAuthLog({ sessionId: sid, username: user.username, ip, userAgent }).catch(() => {})

  const response = NextResponse.json({ id: user.id, username: user.username, displayName: user.display_name, role })
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Omitting maxAge for a non-"remember me" login makes it a session
    // cookie that the browser clears on close.
    ...(remember ? { maxAge: Math.floor(ttlMs / 1000) } : {}),
  })
  return response
}
