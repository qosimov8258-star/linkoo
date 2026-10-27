import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { hashPassword, isLegacyHash, legacyMatchIsExact, verifyPassword } from "@/lib/auth"
import { normalizeUsername, passwordProblem } from "@/lib/auth-policy"
import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { clearFailures, clientIp, reserveAttempt } from "@/lib/rate-limit"
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from "@/lib/session"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

const schema = z.object({
  currentPassword: z.string({ error: "Введите текущий пароль" }).min(1, { error: "Введите текущий пароль" }).max(200),
  newPassword: z.string({ error: "Введите новый пароль" }).min(1, { error: "Введите новый пароль" }).max(200, { error: "Пароль слишком длинный" }),
})

// Wrong current passwords are counted like wrong passwords at sign-in, so a
// live (stolen or unattended) session cannot be used to guess the password:
// 5 per account and client → that client waits 10 minutes; the account-wide
// counter is the sign-in one (app/api/auth/login), so wrong passwords here and
// at sign-in share one budget of 20 → every client waits. Each attempt is
// counted before the password is checked (lib/rate-limit.ts reserveAttempt),
// so parallel requests cannot get more checks than that; a correct current
// password gives its attempt back and clears this client's counter.
const MAX_FAILURES_PER_CLIENT = 5
const MAX_FAILURES_PER_ACCOUNT = 20
const FAILURE_WINDOW_MS = 10 * 60_000
const TOO_MANY = "Слишком много неверных попыток ввода текущего пароля. Попробуйте позже."
const CHANGED_MEANWHILE = "Пароль уже изменен в другом сеансе. Войдите снова с новым паролем."

async function storedHash(userId: number): Promise<string | null> {
  const row = (await getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId)) as { password_hash: string } | undefined
  return row?.password_hash ?? null
}

/** Reads the body and compares the current password with the stored hash
 * (returned too: the change is a compare-and-set on it). */
async function checkCurrentPassword(
  request: NextRequest,
  userId: number,
): Promise<{ error: NextResponse } | { currentPassword: string; newPassword: string; hash: string; valid: boolean }> {
  const parsed = await parseBody(request, schema)
  if (parsed.error) return { error: parsed.error }
  const hash = await storedHash(userId)
  if (hash === null) return { error: NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 }) }
  return { ...parsed.data, hash, valid: await verifyPassword(parsed.data.currentPassword, hash) }
}

/** Stores the new password only if the stored hash is still the one the
 * current password was checked against (compare-and-set), so of two changes
 * sent at the same moment with the same current password exactly one wins.
 * When the hash changed only because a sign-in re-hashed the same password
 * (app/api/auth/login replaceLegacyHash), the current password still matches
 * and the change is retried once against the new hash. */
async function storeNewPassword(userId: number, currentPassword: string, checkedHash: string, newHash: string): Promise<boolean> {
  let expected = checkedHash
  for (let round = 0; round < 2; round++) {
    const result = await getDb()
      .prepare("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ? AND password_hash = ?")
      .run(newHash, userId, expected)
    if (result.changes > 0) return true
    const now = await storedHash(userId)
    if (now === null || now === expected || !(await verifyPassword(currentPassword, now))) return false
    expected = now
  }
  return false
}

// PUT /api/auth/password {currentPassword, newPassword} — the signed-in user
// changes their own password. Every other session of the account is revoked;
// the current one stays signed in (its token is re-signed without the
// "must change the password" mark, so the rest of the API opens again). Of two
// changes racing with the same current password exactly one is stored; the
// other gets 409 {code: 'passwordChangedMeanwhile'} and ends no session.
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const clientKey = `password-failures:${user.id}:${clientIp(request)}`
  const accountKey = `login-failures:${normalizeUsername(user.username)}`
  const attempt = reserveAttempt(
    [
      { key: clientKey, limit: MAX_FAILURES_PER_CLIENT },
      { key: accountKey, limit: MAX_FAILURES_PER_ACCOUNT },
    ],
    FAILURE_WINDOW_MS,
  )
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: TOO_MANY, code: "tooManyPasswordAttempts" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    )
  }

  const check = await checkCurrentPassword(request, user.id).catch((error: unknown) => {
    attempt.release()
    throw error
  })
  if ("error" in check) {
    attempt.release()
    return check.error
  }
  // A wrong current password stays counted.
  if (!check.valid) return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 400 })
  attempt.release()
  clearFailures(clientKey)
  const { currentPassword, newPassword } = check

  const problem = passwordProblem(newPassword, user.username)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  // The same text again is allowed only to re-store a password of 72 bytes or
  // more that a legacy hash counted just in part (lib/auth.ts): the sign-in
  // asked for it to be set again, and it is now counted in full.
  const legacyPartial = isLegacyHash(check.hash) && !legacyMatchIsExact(currentPassword)
  if (newPassword === currentPassword && !legacyPartial) {
    return NextResponse.json({ error: "Новый пароль должен отличаться от текущего" }, { status: 400 })
  }

  // Another change won the race: nothing is stored and no session is ended
  // here, so the winner stays signed in (this session is ended by the winner).
  if (!(await storeNewPassword(user.id, currentPassword, check.hash, await hashPassword(newPassword)))) {
    return NextResponse.json({ error: CHANGED_MEANWHILE, code: "passwordChangedMeanwhile" }, { status: 409 })
  }
  const revoked = await revokeAllSessionsForUser(user.id, user.sessionId)
  const response = NextResponse.json({ ok: true, revokedSessions: revoked })

  // The current token still says "must change the password" (edge gate): the
  // same session gets a fresh token without it, with the same expiry.
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (session?.mustChangePassword && session.sessionId === user.sessionId) {
    const ttlMs = Math.max(0, session.expiresAt - Date.now())
    const token = await signSession(
      {
        userId: user.id,
        role: user.role,
        sessionId: session.sessionId,
        remember: session.remember,
      },
      ttlMs,
    )
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.remember, ttlMs))
  }
  return response
}

export const POST = PUT
