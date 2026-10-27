import { NextRequest, NextResponse } from "next/server"

import { checkRateLimit, clientIp } from "@/lib/rate-limit"
import { SESSION_COOKIE, verifySession } from "@/lib/session"

// Resources sensitive enough to gate by role at the edge (using the signed
// JWT's role claim) in addition to each route's own DB-backed requireRole()
// check. Kept small and explicit rather than guessing at every resource.
// /api/user-sessions and /api/auth are deliberately excluded: they are
// self-service endpoints scoped to the caller's own account.
const ADMIN_ONLY_PREFIXES = ["/api/access-rights", "/api/permissions", "/api/capabilities", "/api/users"]

const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB — generous for JSON payloads, blocks abusive uploads
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// Budgets. Signed-in traffic is counted per session (an office behind one NAT
// address is many people), anonymous traffic per client address. Login has its
// own small per-address bucket plus a per-account failure limit in the route.
const API_LIMIT_PER_SESSION = 900
const API_LIMIT_PER_IP = 120
const LOGIN_LIMIT_PER_IP = 20
const WINDOW_MS = 60_000
// Never throttled: signing out must always work, and /me is the cheap probe
// every page uses to learn who is signed in.
const RATE_LIMIT_EXEMPT = new Set(["/api/auth/logout", "/api/auth/me"])
// While the password must be changed (session claim, lib/session.ts) only these
// stay open besides /api/auth/** (sign-in/out, /me, the password change): the
// account's own sessions. Pages still render, so the change dialog can show.
const PASSWORD_CHANGE_OPEN_PREFIXES = ["/api/user-sessions"]

// Headers the route handlers read (lib/rbac.ts, app/layout.tsx). Always
// overwritten here, so a client cannot supply them.
const PATH_HEADER = "x-linko-path"
const METHOD_HEADER = "x-linko-method"
const URL_HEADER = "x-linko-url"

type MessageKey =
  | "origin"
  | "tooLarge"
  | "lengthRequired"
  | "tooManyLogins"
  | "tooMany"
  | "notSignedIn"
  | "forbidden"
  | "badText"
  | "passwordChangeRequired"
type Lang = "ru" | "uz" | "en" | "tk"

// The edge cannot load the full dictionaries, so its few messages are kept here
// in every UI language and picked by the app_lang cookie (lib/i18n/types.ts).
const MESSAGES: Record<MessageKey, Record<Lang, string>> = {
  origin: {
    ru: "Запрос с другого сайта запрещен",
    uz: "Boshqa saytdan yuborilgan so'rov taqiqlangan",
    en: "Requests from another site are not allowed",
    tk: "Başga saýtdan iberilen haýyş gadagan",
  },
  tooLarge: {
    ru: "Слишком большой запрос",
    uz: "So'rov hajmi juda katta",
    en: "The request is too large",
    tk: "Haýyş gaty uly",
  },
  lengthRequired: {
    ru: "Не указан размер запроса (Content-Length)",
    uz: "So'rov hajmi (Content-Length) ko'rsatilmagan",
    en: "The request size (Content-Length) is missing",
    tk: "Haýyşyň ölçegi (Content-Length) görkezilmedi",
  },
  tooManyLogins: {
    ru: "Слишком много попыток входа. Попробуйте позже.",
    uz: "Juda ko'p kirish urinishlari. Birozdan so'ng qayta urinib ko'ring.",
    en: "Too many sign-in attempts. Please try again later.",
    tk: "Girmek synanyşyklary gaty köp. Soňrak gaýtadan synanyşyň.",
  },
  tooMany: {
    ru: "Слишком много запросов. Подождите немного и повторите.",
    uz: "So'rovlar juda ko'p. Biroz kuting va qayta urinib ko'ring.",
    en: "Too many requests. Please wait a moment and try again.",
    tk: "Haýyşlar gaty köp. Biraz garaşyň we gaýtadan synanyşyň.",
  },
  notSignedIn: {
    ru: "Вы не вошли в систему",
    uz: "Siz tizimga kirmagansiz",
    en: "You are not signed in",
    tk: "Siz ulgama girmediňiz",
  },
  forbidden: {
    ru: "У вас нет прав на это действие",
    uz: "Bu amal uchun huquqingiz yo'q",
    en: "You do not have permission for this action",
    tk: "Bu hereket üçin hukugyňyz ýok",
  },
  badText: {
    ru: "Текст содержит недопустимые символы",
    uz: "Matnda ruxsat etilmagan belgilar bor",
    en: "The text contains invalid characters",
    tk: "Tekstde rugsat berilmeýän nyşanlar bar",
  },
  // Same Russian key as lib/rbac.ts PASSWORD_CHANGE_REQUIRED.
  passwordChangeRequired: {
    ru: "Для продолжения работы задайте новый пароль.",
    uz: "Ishni davom ettirish uchun yangi parol o'rnating.",
    en: "Set a new password to continue.",
    tk: "Işi dowam etmek üçin täze parol belläň.",
  },
}

function language(request: NextRequest): Lang {
  const value = request.cookies.get("app_lang")?.value
  return value === "uz" || value === "en" || value === "tk" ? value : "ru"
}

function fail(request: NextRequest, key: MessageKey, status: number, extraHeaders?: HeadersInit, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: MESSAGES[key][language(request)], code: key, ...extra }, { status, headers: extraHeaders })
}

// --- Text guard ------------------------------------------------------------
// Text no route can store safely is refused here for every API route, whatever
// parser it uses (lib/validation.ts parseJsonBody also drops invisible
// characters): NUL (Postgres refuses 0x00 → 500), a lone UTF-16 surrogate
// (stored as "�"), a bidi override (U+202D/U+202E, look-alike names) and a
// value made only of invisible format characters (a blank-looking name).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const BIDI_OVERRIDE = /[\u202D\u202E]/
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g
const BINARY_BODY = /multipart\/|octet-stream|^(image|video|audio)\//i
const SECRET_KEY = /password/i

const brokenText = (text: string) => text.includes("\u0000") || LONE_SURROGATE.test(text)

function badText(text: string): boolean {
  if (brokenText(text) || BIDI_OVERRIDE.test(text)) return true
  const visible = text.replace(INVISIBLE, "")
  return visible.length < text.length && visible.trim() === ""
}

/** NUL in the path or in any query parameter (e.g. ?search=%00). */
function badUrl(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl
  if (pathname.includes("%00") || pathname.includes("\u0000")) return true
  for (const [key, value] of searchParams) if (key.includes("\u0000") || value.includes("\u0000")) return true
  return false
}

/** Path of the first bad text value of a JSON body (null when there is none or
 * the body is not JSON — the route answers that itself). */
async function badBodyField(request: NextRequest): Promise<string | null> {
  if (BINARY_BODY.test(request.headers.get("content-type") ?? "")) return null
  let json: unknown
  try {
    const text = await request.clone().text()
    if (!/^\s*[[{"]/.test(text)) return null
    json = JSON.parse(text)
  } catch {
    return null
  }
  // [value, path, key]; a password is only hashed, never stored as text, so it is left alone.
  const stack: [unknown, string, string][] = [[json, "", ""]]
  while (stack.length > 0) {
    const [value, path, key] = stack.pop()!
    if (typeof value === "string") {
      if (!SECRET_KEY.test(key) && badText(value)) return path
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) stack.push([value[index], path ? `${path}.${index}` : String(index), key])
    } else if (value !== null && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) {
        const itemPath = path ? `${path}.${name}` : name
        if (brokenText(name)) return itemPath
        stack.push([item, itemPath, name])
      }
    }
  }
  return null
}

/** 400 for a write whose JSON body holds bad text (see badText), else null. */
async function refuseBadBody(request: NextRequest, method: string): Promise<NextResponse | null> {
  if (!MUTATING_METHODS.has(method)) return null
  const field = await badBodyField(request)
  return field === null ? null : fail(request, "badText", 400, undefined, { field: field || null })
}

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
  const { pathname, search } = request.nextUrl
  const isApi = pathname === "/api" || pathname.startsWith("/api/")
  const origin = request.headers.get("origin")
  const method = request.method.toUpperCase()

  const forwarded = new Headers(request.headers)
  forwarded.set(PATH_HEADER, pathname)
  forwarded.set(METHOD_HEADER, method)
  forwarded.set(URL_HEADER, `${pathname}${search}`)
  const next = () => {
    const response = NextResponse.next({ request: { headers: forwarded } })
    for (const [key, value] of Object.entries(corsHeaders(origin))) response.headers.set(key, value)
    return response
  }

  // --- CORS -----------------------------------------------------------
  if (isApi) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN
    const isCrossOrigin = !!origin && origin !== request.nextUrl.origin
    if (isCrossOrigin && origin !== allowedOrigin) return fail(request, "origin", 403)
    if (method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
    }
  }

  if (isApi && badUrl(request)) return fail(request, "badText", 400)

  // --- Payload size limit ----------------------------------------------
  // Content-Length is checked up front; a chunked body (no Content-Length) is
  // refused, because its size is only known after the route has read it all.
  if (isApi && MUTATING_METHODS.has(method)) {
    const contentLength = request.headers.get("content-length")
    if (contentLength !== null) {
      const bytes = Number(contentLength)
      if (!Number.isFinite(bytes) || bytes > MAX_BODY_BYTES) return fail(request, "tooLarge", 413)
    } else if (request.headers.get("transfer-encoding")) {
      return fail(request, "lengthRequired", 411)
    }
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)

  // --- Rate limiting -----------------------------------------------------
  if (isApi && !RATE_LIMIT_EXEMPT.has(pathname)) {
    const isLogin = pathname === "/api/auth/login" && method === "POST"
    const result = isLogin
      ? checkRateLimit(`login:${clientIp(request)}`, LOGIN_LIMIT_PER_IP, WINDOW_MS)
      : session
        ? checkRateLimit(`api:session:${session.sessionId ?? `user-${session.userId}`}`, API_LIMIT_PER_SESSION, WINDOW_MS)
        : checkRateLimit(`api:ip:${clientIp(request)}`, API_LIMIT_PER_IP, WINDOW_MS)
    if (!result.allowed) {
      return fail(request, isLogin ? "tooManyLogins" : "tooMany", 429, { "Retry-After": String(result.retryAfterSeconds) })
    }
  }

  // Auth API routes manage their own checks (login/logout must be reachable
  // while logged out, and /me returns its own 401); their bodies are still checked.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return (await refuseBadBody(request, method)) ?? next()

  // The login page always renders: a session that is still signed but was
  // revoked must be able to sign in again. The page itself sends a live
  // session on to the app (app/login/page.tsx).
  if (pathname === "/login") return next()

  if (!session) {
    if (isApi) return fail(request, "notSignedIn", 401)
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  if (isApi) {
    // A password set by an administrator (or the seeded / a too weak one) must
    // be changed before anything else; lib/rbac.ts re-checks it in Postgres, and
    // lib/current-user.ts ends a session whose token lacks this mark while the
    // account must change its password (a token issued before that was required).
    if (session.mustChangePassword && !PASSWORD_CHANGE_OPEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return fail(request, "passwordChangeRequired", 403)
    }

    // Coarse, edge-level RBAC gate for admin-only resources. Each of these
    // routes also re-checks the role against Postgres via requireRole("admin")
    // so a stale JWT claim can never grant access on its own.
    if (ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) && session.role !== "admin") {
      return fail(request, "forbidden", 403)
    }

    // Viewers can look but not touch: block writes at the edge for every API
    // route as a blanket rule, in addition to any per-route role checks.
    if (MUTATING_METHODS.has(method) && session.role === "viewer") return fail(request, "forbidden", 403)

    // Users restricted by an access right (Права доступа) may only change the
    // resources their permissions cover (lib/capabilities-catalog.ts). That is
    // decided by the route (lib/rbac.ts requireRole / requirePermission, which
    // every write handler calls) from the grants in Postgres, not here: the edge
    // cannot read them, and a list copied into the token at sign-in kept
    // refusing a permission an administrator had just added until the user
    // signed in again. Removals apply at once there too.

    const refused = await refuseBadBody(request, method)
    if (refused) return refused
  }

  return next()
}

export const config = {
  // Every API path (even one ending in .png) goes through the checks above;
  // only static assets and image files outside /api are skipped.
  matcher: ["/api/:path*", "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
