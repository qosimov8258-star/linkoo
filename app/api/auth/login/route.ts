import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { hashPassword, isLegacyHash, legacyMatchIsExact, verifyPassword } from "@/lib/auth"
import { EMPLOYEE_ACCESS_SQL, ensureUserEmployeeLink } from "@/lib/auth-employee"
import { normalizeUsername, passwordProblem } from "@/lib/auth-policy"
import { parseBody } from "@/lib/auth-request"
import { toRole } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { recordAuthLog } from "@/lib/auth-logs-repo"
import { clearFailures, clientIp, reserveAttempt } from "@/lib/rate-limit"
import { REMEMBER_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions, signSession } from "@/lib/session"
import { recordSession, revokeSession } from "@/lib/user-sessions-repo"

type UserRow = {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
  has_access: boolean
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
// Unknown logins are counted the same way, so a lock reveals nothing. Each
// attempt is counted before the password is checked (lib/rate-limit.ts
// reserveAttempt), so requests sent in parallel get no more checks than that;
// a correct password gives its attempt back. Wrong current passwords at the
// password change (app/api/auth/password) share the per-account counter.
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

/** The account by login (case-insensitively; an exact match wins for databases
 * that still hold look-alike twins created before that rule) and whether the
 * password matches. Unknown logins cost one bcrypt comparison as well. */
async function findAndVerify(key: string, username: string, password: string): Promise<{ user: UserRow | undefined; valid: boolean }> {
  await ensureUserEmployeeLink()
  const user = (await getDb()
    .prepare(
      `SELECT u.*, ${EMPLOYEE_ACCESS_SQL} AS has_access
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE lower(u.username) = ? ORDER BY (u.username = ?) DESC, u.id ASC LIMIT 1`,
    )
    .get(key, username)) as UserRow | undefined
  const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()))
  return { user, valid }
}

/** A legacy password hash (lib/auth.ts: bcrypt of the raw password, which only
 * counts its first 72 bytes) is replaced at sign-in. A password shorter than 72
 * bytes that matched is the stored one, so it is simply re-hashed in the
 * current scheme. A longer one may differ from the stored password after byte
 * 72, so the account must set its password again (then counted in full).
 * Both writes are a compare-and-set on the old hash, so they never overwrite a
 * password change made at the same moment. Returns whether the password must
 * be changed for that reason, and the hash this sign-in left stored. */
async function replaceLegacyHash(user: UserRow, password: string): Promise<{ mustChange: boolean; hash: string }> {
  if (!isLegacyHash(user.password_hash)) return { mustChange: false, hash: user.password_hash }
  const db = getDb()
  if (legacyMatchIsExact(password)) {
    const next = await hashPassword(password)
    const result = await db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?").run(next, user.id, user.password_hash)
    return { mustChange: false, hash: result.changes > 0 ? next : user.password_hash }
  }
  const result = await db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ? AND password_hash = ?").run(user.id, user.password_hash)
  return { mustChange: result.changes > 0, hash: user.password_hash }
}

/** Whether the password this sign-in checked is still the account's password
 * now that its session is recorded. A password change (app/api/auth/password)
 * or an administrator's reset (PATCH /api/users/[id]) stores the new hash and
 * then ends every session it can see; one that lands while this sign-in is
 * still comparing the old password (one bcrypt) would miss the session
 * recorded after it. Reading the hash only after the session is recorded
 * closes that gap: a change that commits after this read still finds the
 * session and ends it, and one that committed before it is seen here. A hash
 * this sign-in already knows (the one it checked, or the one replaceLegacyHash
 * wrote) is fine; another hash is fine only if the password matches it too
 * (another sign-in re-hashed the same legacy password). */
async function passwordStillCurrent(userId: number, password: string, knownHashes: string[]): Promise<boolean> {
  const row = (await getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId)) as { password_hash: string } | undefined
  if (!row) return false
  if (knownHashes.includes(row.password_hash)) return true
  return verifyPassword(password, row.password_hash)
}

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, loginSchema)
  if (parsed.error) return parsed.error
  const { username, password, remember } = parsed.data

  const key = normalizeUsername(username)
  const ip = clientIp(request)
  const clientKey = `login-failures:${key}:${ip}`
  const accountKey = `login-failures:${key}`
  const attempt = reserveAttempt(
    [
      { key: clientKey, limit: MAX_FAILURES_PER_CLIENT },
      { key: accountKey, limit: MAX_FAILURES_PER_ACCOUNT },
    ],
    FAILURE_WINDOW_MS,
  )
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте позже.", code: "tooManyLogins" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    )
  }

  const { user, valid } = await findAndVerify(key, username, password).catch((error: unknown) => {
    attempt.release()
    throw error
  })
  // A wrong password (or an unknown login) stays counted.
  if (!user || !valid) return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
  attempt.release()
  clearFailures(clientKey)

  // The account's employee (Сотрудники) was deactivated or lost "Доступ к системе".
  if (!user.has_access) {
    return NextResponse.json({ error: "Доступ к системе отключен. Обратитесь к администратору.", code: "accessDisabled" }, { status: 403 })
  }

  // A password set by an administrator, the seeded first password and any
  // password weaker than today's policy must be replaced right after sign-in;
  // until then the API refuses everything else (middleware.ts, lib/rbac.ts).
  // So must a password only partly counted by a legacy hash (replaceLegacyHash).
  const weakPassword = passwordProblem(password, user.username) !== null
  const legacy = await replaceLegacyHash(user, password)
  const mustChangePassword = Number(user.must_change_password) === 1 || weakPassword || legacy.mustChange
  if (weakPassword && Number(user.must_change_password) !== 1) {
    await getDb().prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(user.id)
  }

  const role = toRole(user.role)
  const ttlMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS
  const sid = crypto.randomUUID()
  const token = await signSession({ userId: user.id, role, sessionId: sid, mustChangePassword, remember: remember === true }, ttlMs)

  const userAgent = (request.headers.get("user-agent") || "").slice(0, 500)
  await recordSession({ id: sid, userId: user.id, ip, userAgent })
  // The password was changed or reset while it was being checked: the session
  // is ended and the sign-in fails as with any password that is not current.
  if (!(await passwordStillCurrent(user.id, password, [user.password_hash, legacy.hash]))) {
    await revokeSession(sid, user.id)
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 })
  }
  // The sign-in journal (lib/auth-logs-repo.ts); a failure to write it never blocks the sign-in.
  await recordAuthLog({ sessionId: sid, username: user.username, ip, userAgent }).catch(() => {})

  const response = NextResponse.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role,
    mustChangePassword,
  })
  // Without "remember me" a session cookie that the browser clears on close.
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(remember === true, ttlMs))
  return response
}
