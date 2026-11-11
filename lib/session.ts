// JWT session tokens signed with jose (Web Crypto based), so this module
// works both in Node API routes and in Edge middleware. The token is always
// carried in an HttpOnly cookie (set by the login route) — never read from
// or written to localStorage/sessionStorage on the client.

import { SignJWT, jwtVerify } from "jose"

export const SESSION_COOKIE = "linko_session"
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days (default / "not remembered")
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days ("remember me")

export type Role = "admin" | "manager" | "viewer"

// The value .env.example ships with. This repository is public, so a server that
// still signs with it lets anyone mint a session token: it is refused in
// production (sign-in then fails and the log names the reason) instead of
// running without real authentication.
const EXAMPLE_SECRET = "change-me-to-a-long-random-secret"
const MIN_SECRET_LENGTH = 32
let shortSecretWarned = false

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and configure it.")
  if (process.env.NODE_ENV === "production") {
    if (secret.trim() === EXAMPLE_SECRET) {
      throw new Error("AUTH_SECRET is still the example value from .env.example (publicly known). Set a random one: openssl rand -base64 48")
    }
    if (secret.length < MIN_SECRET_LENGTH && !shortSecretWarned) {
      shortSecretWarned = true
      console.error(`[auth] AUTH_SECRET is only ${secret.length} characters long; use at least ${MIN_SECRET_LENGTH} random ones (openssl rand -base64 48).`)
    }
  }
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

// --- Request mark -----------------------------------------------------------
// The proxy (proxy.ts) tells the route handlers which path and method they are
// answering (lib/rbac.ts reads them to find the permission a write needs). A
// request header alone could be supplied by the client whenever the proxy does
// not run for a request (a framework bug of that kind has happened before), so
// the proxy also signs the pair with the session secret: without a valid mark
// lib/rbac.ts trusts neither value and refuses a user restricted by an access
// right. Web Crypto only, so it works at the edge and in Node.

const MARK_PREFIX = "linko-request-mark:v1"
let markKey: Promise<CryptoKey> | null = null

function getMarkKey(): Promise<CryptoKey> {
  // A JWT signing input never holds a line break, so a mark is never a valid token signature input (and vice versa).
  markKey ??= crypto.subtle.importKey("raw", getSecretKey(), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]).catch((error) => {
    markKey = null
    throw error
  })
  return markKey
}

const markInput = (method: string, path: string) => new TextEncoder().encode(`${MARK_PREFIX}\n${method.toUpperCase()}\n${path}`)

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The proxy's signature over the method and path it forwards (hex HMAC-SHA256). */
export async function signRequestMark(method: string, path: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await getMarkKey(), markInput(method, path)))
}

/** True when `mark` is the proxy's signature of this method and path. */
export async function verifyRequestMark(method: string, path: string, mark: string | null | undefined): Promise<boolean> {
  if (!mark || !/^[0-9a-f]{64}$/.test(mark)) return false
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index++) bytes[index] = Number.parseInt(mark.slice(index * 2, index * 2 + 2), 16)
  try {
    // crypto.subtle.verify compares in constant time.
    return await crypto.subtle.verify("HMAC", await getMarkKey(), bytes, markInput(method, path))
  } catch {
    return false
  }
}
