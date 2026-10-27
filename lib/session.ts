// JWT session tokens signed with jose (Web Crypto based), so this module
// works both in Node API routes and in Edge middleware. The token is always
// carried in an HttpOnly cookie (set by the login route) — never read from
// or written to localStorage/sessionStorage on the client.

import { SignJWT, jwtVerify } from "jose"

export const SESSION_COOKIE = "linko_session"
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days (default / "not remembered")
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days ("remember me")

export type Role = "admin" | "manager" | "viewer"

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and configure it.")
  return new TextEncoder().encode(secret)
}

/**
 * The token carries no permission list: the grants of an access right (Права
 * доступа) are read from Postgres on every request (lib/rbac.ts), so a grant or
 * a removal applies to signed-in users at once. A list frozen at sign-in made
 * the edge refuse what an administrator had just granted until the next
 * sign-in. Older tokens may still hold a "perms" claim; it is ignored.
 */
export type SessionClaims = {
  userId: number
  role: Role
  sessionId?: string
  /** The password must be changed before anything else (set at sign-in from
   * users.must_change_password / a password weaker than the policy): the edge
   * middleware then refuses every API except sign-in/out, /me, the password
   * change and the own sessions (403 passwordChangeRequired). The password
   * change re-signs the token without it. */
  mustChangePassword?: boolean
  /** "Запомнить меня": a persistent cookie (kept when the token is re-signed). */
  remember?: boolean
}

export async function signSession(claims: SessionClaims, ttlMs: number = SESSION_TTL_MS): Promise<string> {
  return new SignJWT({
    uid: claims.userId,
    role: claims.role,
    sid: claims.sessionId,
    ...(claims.mustChangePassword ? { mcp: true } : {}),
    ...(claims.remember ? { rem: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ttlMs) / 1000))
    .sign(getSecretKey())
}

export type VerifiedSession = {
  userId: number
  role: Role
  sessionId?: string
  mustChangePassword: boolean
  remember: boolean
  /** Expiry of the token (ms since epoch). */
  expiresAt: number
}

export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (typeof payload.uid !== "number") return null
    const role = payload.role === "admin" || payload.role === "manager" || payload.role === "viewer" ? payload.role : "viewer"
    const expiresAt = typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + SESSION_TTL_MS
    // Tokens signed before the "rem" claim existed: a lifetime longer than the
    // default session means "remember me".
    const remember =
      payload.rem === true ||
      (payload.rem === undefined && typeof payload.exp === "number" && typeof payload.iat === "number" && (payload.exp - payload.iat) * 1000 > SESSION_TTL_MS)
    return {
      userId: payload.uid,
      role,
      sessionId: typeof payload.sid === "string" ? payload.sid : undefined,
      mustChangePassword: payload.mcp === true,
      remember,
      expiresAt,
    }
  } catch {
    return null
  }
}

/** Options of the session cookie. Without "remember me" it is a browser-session
 * cookie (no maxAge), cleared when the browser closes. */
export function sessionCookieOptions(remember: boolean, ttlMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: Math.max(0, Math.floor(ttlMs / 1000)) } : {}),
  }
}
