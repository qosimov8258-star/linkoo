// Uses only Web Crypto + base64 globals (no Node-only APIs) so this module
// works both in Node API routes and in Edge middleware.

export const SESSION_COOKIE = "linko_session"
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days (default / "not remembered")
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days ("remember me")

const encoder = new TextEncoder()

function getSecret(): string {
  return process.env.AUTH_SECRET || "linko-dev-secret-change-me"
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(getSecret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

type SessionPayload = { uid: number; exp: number }

export async function signSession(userId: number, ttlMs: number = SESSION_TTL_MS): Promise<string> {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + ttlMs }
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const key = await getKey()
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64))
  const signatureB64 = toBase64Url(new Uint8Array(signature))
  return `${payloadB64}.${signatureB64}`
}

export async function verifySession(token: string | undefined | null): Promise<{ userId: number } | null> {
  if (!token) return null
  const [payloadB64, signatureB64] = token.split(".")
  if (!payloadB64 || !signatureB64) return null

  const key = await getKey()
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(signatureB64),
    encoder.encode(payloadB64),
  )
  if (!valid) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as SessionPayload
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null
    if (typeof payload.uid !== "number") return null
    return { userId: payload.uid }
  } catch {
    return null
  }
}
