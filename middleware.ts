import { NextRequest, NextResponse } from "next/server"

import { SESSION_COOKIE, verifySession } from "@/lib/session"

const PUBLIC_PAGE_PATHS = new Set(["/login"])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("from", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
