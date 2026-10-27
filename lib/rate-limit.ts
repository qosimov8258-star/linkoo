// In-memory sliding-window rate limiter. Works in both the Edge middleware
// runtime and Node (plain Map, no Node-only APIs), and is scoped per server
// process — correct for a single-instance deployment (this app's Docker
// Compose setup); a multi-instance/horizontally-scaled deployment would need
// a shared store (e.g. Redis) instead.

type Bucket = { count: number; resetAt: number }

declare global {
  var __linkoRateBuckets: Map<string, Bucket> | undefined
}

// One map per process (not per bundled module copy), so every route handler
// that counts the same key (e.g. wrong passwords) shares the counter. Node runs
// the handlers on one thread: a read and a write with no `await` in between
// cannot interleave with another request.
const buckets: Map<string, Bucket> = (globalThis.__linkoRateBuckets ??= new Map<string, Bucket>())
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

export type AttemptLimit = { key: string; limit: number }

export type Attempt = RateLimitResult & {
  /** The attempt succeeded: it stops counting as a failure (only once). */
  release(): void
}

/**
 * Failure counters (e.g. wrong passwords per account and client). Every
 * attempt is counted BEFORE the slow check runs (a bcrypt comparison): the
 * check and the count happen in one synchronous step, so requests sent in
 * parallel cannot all pass while none of them has been counted yet — at most
 * `limit` attempts per key are ever in flight or failed within the window.
 * A failed attempt simply stays counted; a successful one calls `release()`
 * (and usually `clearFailures` for the per-client key).
 *
 * All `limits` are checked first; when any of them is reached nothing is
 * counted and the attempt is refused with the longest wait.
 */
export function reserveAttempt(limits: AttemptLimit[], windowMs: number): Attempt {
  const now = Date.now()
  let blocked = false
  let retryAfterSeconds = 0
  for (const { key, limit } of limits) {
    const bucket = buckets.get(key)
    if (bucket && bucket.resetAt > now && bucket.count >= limit) {
      blocked = true
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((bucket.resetAt - now) / 1000))
    }
  }
  if (blocked) return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds), release() {} }

  const held: Bucket[] = []
  for (const { key } of limits) {
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    held.push(bucket)
  }
  let released = false
  return {
    allowed: true,
    retryAfterSeconds: 0,
    release() {
      if (released) return
      released = true
      // A bucket that expired or was cleared meanwhile is no longer in the map; decrementing it is harmless.
      for (const bucket of held) if (bucket.count > 0) bucket.count -= 1
    },
  }
}

/** Resets a failure counter after a success (e.g. the right password from this client). */
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
