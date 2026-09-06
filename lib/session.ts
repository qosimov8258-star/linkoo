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

export type SessionClaims = { userId: number; role: Role; sessionId?: string }

export async function signSession(claims: SessionClaims, ttlMs: number = SESSION_TTL_MS): Promise<string> {
  return new SignJWT({ uid: claims.userId, role: claims.role, sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ttlMs) / 1000))
    .sign(getSecretKey())
}

export type VerifiedSession = { userId: number; role: Role; sessionId?: string }

export async function verifySession(token: string | undefined | null): Promise<VerifiedSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (typeof payload.uid !== "number") return null
    const role = payload.role === "admin" || payload.role === "manager" || payload.role === "viewer" ? payload.role : "viewer"
    return { userId: payload.uid, role, sessionId: typeof payload.sid === "string" ? payload.sid : undefined }
  } catch {
    return null
  }
}
