// HTTP client of the factory simulation: signs in to the LOCAL factory instance
// (scripts/factory/dev.sh, default http://localhost:3001) and calls its API the way
// the pages do. Refuses any other host, so the simulation can never write to the
// reference (app.linko.uz) or to production.

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
const USER = process.env.FACTORY_USER || "admin"
const PASS = process.env.FACTORY_PASS || "Zavod-Admin-2026"

const host = new URL(BASE).hostname
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error(`Factory simulation only runs against a local server, not ${BASE}`)
}

let cookie = ""

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status}: ${typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 800)}`)
    this.status = status
    this.body = body
  }
}

/** Every failed call is collected here, so one run reports all problems found. */
export const failures = []

export async function api(method, path, body, { quiet = false } = {}) {
  const headers = { cookie, origin: BASE }
  if (body !== undefined) headers["content-type"] = "application/json"
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let data = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {}
    // The first calls after `next dev` starts compile the route (transient 404) and the
    // proxy rate-limits bursts (429): retry those a few times.
    if ((response.status === 429 || (response.status === 404 && attempt === 0 && /<html/i.test(text))) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? 5000 : 1500))
      continue
    }
    if (!response.ok) {
      const error = new ApiError(method, path, response.status, data)
      if (!quiet) failures.push(error.message)
      throw error
    }
    return data
  }
}

export const get = (path) => api("GET", path)
export const post = (path, body) => api("POST", path, body)
export const put = (path, body) => api("PUT", path, body)
export const patch = (path, body) => api("PATCH", path, body)
export const del = (path) => api("DELETE", path)

// The password dev.sh gives the first administrator of a fresh database (ADMIN_INITIAL_PASSWORD).
const INITIAL_PASS = process.env.FACTORY_ADMIN_PASSWORD || "Zavod-2026-admin"

async function signIn(password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ username: USER, password, remember: true }),
  })
  if (!response.ok) return { ok: false, status: response.status, text: await response.text() }
  cookie = (response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""])
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ")
  return { ok: true, me: await response.json() }
}

/** Signs in; on a fresh database replaces the one-time initial password first (forced change). */
export async function login() {
  let result = await signIn(PASS)
  if (!result.ok && result.status === 401) {
    result = await signIn(INITIAL_PASS)
    if (result.ok && result.me.mustChangePassword) {
      await api("PUT", "/api/auth/password", { currentPassword: INITIAL_PASS, newPassword: PASS })
      result = await signIn(PASS)
    }
  }
  if (!result.ok) throw new Error(`login failed: ${result.status} ${result.text}`)
  if (result.me.mustChangePassword) throw new Error("admin must change the password first")
  return result.me
}

/** Rows of a list endpoint, whatever its shape (array or {results}). */
export function rowsOf(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.results)) return data.results
  if (data && Array.isArray(data.rows)) return data.rows
  if (data && Array.isArray(data.items)) return data.items
  return []
}

const key = (value) => String(value ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ")

/** Finds a row by name in `listPath`, or creates it with `body` (idempotent re-runs). */
export async function ensure(listPath, createPath, name, body, nameOf = (row) => row.name) {
  const rows = rowsOf(await get(listPath))
  const found = rows.find((row) => key(nameOf(row)) === key(name))
  if (found) return found
  return post(createPath, body)
}

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}
