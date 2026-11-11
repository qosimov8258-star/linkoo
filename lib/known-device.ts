import "server-only"

import { SignJWT, jwtVerify } from "jose"

// "Known device" mark of the sign-in form.
//
// Wrong passwords are counted per account over all clients (app/api/auth/login:
// 20 in 10 minutes lock the login for everyone), which stops a guesser who
// rotates addresses. Left alone, that counter is also a weapon: anybody who
// knows a login ("admin") could keep its owner locked out for good with three
// requests a minute. So a browser that has signed in to an account before
// carries this cookie, and its attempts are counted on their own (5 per device
// and 5 per address, as before) instead of against the shared counter: the
// owner still gets in from their own computer while the login is under attack,
// and the attacker, who has no such cookie, gains nothing.
//
// The cookie is a token signed with AUTH_SECRET that names up to MAX_LOGINS
// logins this browser signed in to and one random device id. It is not a
// session: it carries no user id (lib/session.ts verifySession refuses it) and
// only ever moves an attempt from one failure counter to another.

export const DEVICE_COOKIE = "linko_device"
const DEVICE_TTL_SECONDS = 180 * 24 * 60 * 60
const MAX_LOGINS = 8
const KIND = "device"

function getKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and configure it.")
  return new TextEncoder().encode(secret)
}

export type KnownDevice = { id: string; logins: string[] }

/** The device mark of a request, or null (none, expired, forged, or a session token). */
export async function readKnownDevice(token: string | undefined | null): Promise<KnownDevice | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getKey())
    if (payload.kind !== KIND || typeof payload.did !== "string" || !/^[0-9a-f-]{36}$/.test(payload.did)) return null
    const logins = Array.isArray(payload.logins) ? payload.logins.filter((item): item is string => typeof item === "string" && item.length <= 200) : []
    return { id: payload.did, logins: logins.slice(0, MAX_LOGINS) }
  } catch {
    return null
  }
}

/** The cookie value after `login` (normalized) signed in from this browser: the device keeps
 * its id, the login moves to the front of the list (the oldest falls off after MAX_LOGINS). */
export async function signKnownDevice(current: KnownDevice | null, login: string): Promise<string> {
  const logins = [login, ...(current?.logins ?? []).filter((item) => item !== login)].slice(0, MAX_LOGINS)
  return new SignJWT({ kind: KIND, did: current?.id ?? crypto.randomUUID(), logins })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + DEVICE_TTL_SECONDS)
    .sign(getKey())
}

export function knownDeviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    // Only the sign-in route reads it.
    path: "/api/auth",
    maxAge: DEVICE_TTL_SECONDS,
  }
}
