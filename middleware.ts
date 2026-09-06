import { NextRequest, NextResponse } from "next/server"

import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { SESSION_COOKIE, verifySession } from "@/lib/session"

const PUBLIC_PAGE_PATHS = new Set(["/login"])

// Resources sensitive enough to gate by role at the edge (using the signed
// JWT's role claim) in addition to each route's own DB-backed requireRole()
// check. Kept small and explicit rather than guessing at every resource.
// /api/user-sessions is deliberately excluded: it's a self-service endpoint
// scoped to the caller's own sessions (list/revoke your own), not an
// admin-wide resource.
const ADMIN_ONLY_PREFIXES = ["/api/access-rights", "/api/permissions", "/api/capabilities", "/api/users"]

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB — generous for JSON payloads, blocks abusive uploads
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function corsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = process.env.ALLOWED_ORIGIN
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith("/api/")
  const origin = request.headers.get("origin")

  // --- CORS -----------------------------------------------------------
  if (isApi) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN
    const isCrossOrigin = !!origin && origin !== request.nextUrl.origin
    if (isCrossOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: "Origin ruxsat etilmagan" }, { status: 403 })
    }
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
    }
  }

  // --- Payload size limit ----------------------------------------------
  if (isApi && MUTATING_METHODS.has(request.method)) {
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "So'rov hajmi juda katta" }, { status: 413 })
    }
  }

  // --- Rate limiting -----------------------------------------------------
  const ip = clientIp(request)
  if (pathname === "/api/auth/login" && request.method === "POST") {
    const result = checkRateLimit(`login:${ip}`, 5, 60_000)
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring." },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      )
    }
  } else if (isApi) {
    const result = checkRateLimit(`api:${ip}`, 300, 60_000)
    if (!result.allowed) {
      return NextResponse.json(
        { error: "So'rovlar soni chegarasidan oshib ketdi" },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      )
    }
  }

  // Auth API routes manage their own checks (login/logout must be reachable
  // while logged out, and /me returns its own 401).
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)

  if (PUBLIC_PAGE_PATHS.has(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url))
    }
    return NextResponse.next()
  }

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Coarse, edge-level RBAC gate for admin-only resources. Each of these
  // routes also re-checks the role against Postgres via requireRole("admin")
  // so a stale JWT claim can never grant access on its own.
  if (isApi && ADMIN_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && session.role !== "admin") {
    return NextResponse.json({ error: "Bu amal uchun ruxsatingiz yo'q" }, { status: 403 })
  }

  // Viewers can look but not touch: block writes at the edge for every API
  // route as a blanket rule, in addition to any per-route role checks.
  if (isApi && MUTATING_METHODS.has(request.method) && session.role === "viewer") {
    return NextResponse.json({ error: "Bu amal uchun ruxsatingiz yo'q" }, { status: 403 })
  }

  const response = NextResponse.next()
  for (const [key, value] of Object.entries(corsHeaders(origin))) response.headers.set(key, value)
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
