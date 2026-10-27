import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { hashPassword, verifyPassword } from "@/lib/auth"
import { normalizeUsername, passwordProblem } from "@/lib/auth-policy"
import { parseBody } from "@/lib/auth-request"
import { permissionsOfAccessRight, toRole } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { recordAuthLog } from "@/lib/auth-logs-repo"
import { clearFailures, clientIp, isBlocked, recordFailure } from "@/lib/rate-limit"
import { REMEMBER_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/session"
import { recordSession } from "@/lib/user-sessions-repo"

type UserRow = {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
}

const loginSchema = z.object({
  username: z.string({ error: "Введите логин" }).trim().min(1, { error: "Введите логин" }).max(200, { error: "Неверный логин или пароль" }),
  password: z.string({ error: "Введите пароль" }).min(1, { error: "Введите пароль" }).max(200, { error: "Неверный логин или пароль" }),
  remember: z.boolean().optional(),
})

// Wrong passwords are counted per account and client (5 → that client is
// locked out of that login for 10 minutes) and per account over all clients
// (20 → locked for everyone, which stops guessing from rotating addresses
// while one mistyping colleague cannot lock the account for the whole office).
// Unknown logins are counted the same way, so a lock reveals nothing.
const MAX_FAILURES_PER_CLIENT = 5
const MAX_FAILURES_PER_ACCOUNT = 20
const FAILURE_WINDOW_MS = 10 * 60_000

// Unknown logins are checked against this hash so that both cases cost one
// bcrypt comparison and the response time does not reveal which logins exist.
let dummyHash: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(crypto.randomUUID())
  return dummyHash
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, loginSchema)
  if (parsed.error) return parsed.error
  const { username, password, remember } = parsed.data

  const key = normalizeUsername(username)
  const ip = clientIp(request)
  const clientKey = `login-failures:${key}:${ip}`
  const accountKey = `login-failures:${key}`
  const blockedClient = isBlocked(clientKey, MAX_FAILURES_PER_CLIENT)
  const blocked = blockedClient.allowed ? isBlocked(accountKey, MAX_FAILURES_PER_ACCOUNT) : blockedClient
  if (!blocked.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте позже.", code: "tooManyLogins" },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfterSeconds) } },
    )
  }

  const db = getDb()
  // Logins are unique case-insensitively; an exact match wins for databases
  // that still hold look-alike twins created before that rule.
  const user = (await db
    .prepare("SELECT * FROM users WHERE lower(username) = ? ORDER BY (username = ?) DESC, id ASC LIMIT 1")
    .get(key, username)) as UserRow | undefined
  const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()))
  if (!user || !valid) {
    recordFailure(clientKey, FAILURE_WINDOW_MS)
    recordFailure(accountKey, FAILURE_WINDOW_MS)
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
  }
  clearFailures(clientKey)

  const role = toRole(user.role)
  const accessRightId = role !== "admin" && user.access_right_id ? Number(user.access_right_id) : null
  const permissions = accessRightId ? await permissionsOfAccessRight(accessRightId) : undefined
  const ttlMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS
  const sid = crypto.randomUUID()
  const token = await signSession({ userId: user.id, role, sessionId: sid, permissions }, ttlMs)

  const userAgent = (request.headers.get("user-agent") || "").slice(0, 500)
  await recordSession({ id: sid, userId: user.id, ip, userAgent })
  await recordAuthLog({ sessionId: sid, username: user.username, ip, userAgent }).catch(() => {})

  // A password set by an administrator, the seeded first password and any
  // password weaker than today's policy must be replaced right after sign-in.
  const mustChangePassword = user.must_change_password === 1 || passwordProblem(password, user.username) !== null

  const response = NextResponse.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role,
    mustChangePassword,
  })
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
