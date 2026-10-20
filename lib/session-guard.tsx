"use client"

import { useEffect } from "react"

// Sends the browser to the login page as soon as the server says the session
// is gone (401 from any of our /api routes: signed out elsewhere, revoked from
// "Сессия", password changed, expired), instead of leaving the user on screens
// that silently show zeros. Installed once, from the root layout.

let installed = false
let redirecting = false

function isLoginPage(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/login/")
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return new URL(raw, window.location.href)
  } catch {
    return null
  }
}

export function SessionGuard() {
  useEffect(() => {
    if (installed) return
    installed = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init)
      if (response.status === 401 && !redirecting && !isLoginPage(window.location.pathname)) {
        const url = requestUrl(input)
        if (url && url.origin === window.location.origin && url.pathname.startsWith("/api/") && url.pathname !== "/api/auth/login") {
          redirecting = true
          const from = `${window.location.pathname}${window.location.search}`
          window.location.assign(`/login?reason=session&from=${encodeURIComponent(from)}`)
        }
      }
      return response
    }
  }, [])
  return null
}
