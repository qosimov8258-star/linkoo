// In-memory sliding-window rate limiter. Works in both the Edge middleware
// runtime and Node (plain Map, no Node-only APIs), and is scoped per server
// process — correct for a single-instance deployment (this app's Docker
// Compose setup); a multi-instance/horizontally-scaled deployment would need
// a shared store (e.g. Redis) instead.

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
let sweepCounter = 0

function sweepExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweepCounter += 1
  if (sweepCounter % 200 === 0) sweepExpired(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
  }
  bucket.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Failure counters (e.g. wrong passwords per account): `isBlocked` only reads,
 * `recordFailure` counts one failure, `clearFailures` resets after a success. */
export function isBlocked(key: string, limit: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now || bucket.count < limit) return { allowed: true, retryAfterSeconds: 0 }
  return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
}

export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs })
  else bucket.count += 1
}

export function clearFailures(key: string): void {
  buckets.delete(key)
}

function normalizeIp(value: string): string {
  const ip = value.trim().replace(/^\[|\]$/g, "")
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) and the same address in plain form share one bucket.
  return ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip
}

/**
 * The client address as seen by the closest trusted hop.
 *
 * X-Forwarded-For is a list the CLIENT can pre-fill: the bundled nginx appends
 * the real peer address ($proxy_add_x_forwarded_for), and Next.js itself fills
 * the header with the socket address only when it is missing. So only the
 * right-most entries are trustworthy — never the first one. TRUSTED_PROXY_HOPS
 * (default 1, the bundled nginx) says how many proxies append to the header;
 * the entry they appended for the client is taken.
 */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    if (hops.length) {
      const configured = Number(process.env.TRUSTED_PROXY_HOPS)
      const trusted = Number.isInteger(configured) && configured > 0 ? configured : 1
      return normalizeIp(hops[Math.max(0, hops.length - trusted)]!)
    }
  }
  const realIp = request.headers.get("x-real-ip")
  return realIp ? normalizeIp(realIp) : "unknown"
}
