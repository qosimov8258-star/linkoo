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

export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") || "unknown"
}
