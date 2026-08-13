import { NextRequest, NextResponse } from "next/server"

import { verifyPassword } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { REMEMBER_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/session"

type UserRow = {
  id: number
  username: string
  display_name: string
  password_hash: string
  password_salt: string
}

export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string; remember?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const username = body.username?.trim()
  const password = body.password ?? ""
  if (!username || !password) {
    return NextResponse.json({ error: "Login va parolni kiriting" }, { status: 400 })
  }

  const db = getDb()
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return NextResponse.json({ error: "Login yoki parol noto'g'ri" }, { status: 401 })
  }

  const remember = body.remember === true
  const ttlMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS
  const token = await signSession(user.id, ttlMs)
  const response = NextResponse.json({ id: user.id, username: user.username, displayName: user.display_name })
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
