// Authorization matrix of the LOCAL factory instance: every API route × method, called as
// nobody (no cookie), a viewer, a role-only manager, one employee of every access right
// (Права доступа) and the administrator.
//
//   node scripts/factory/audit/sec-authz.mjs            # writes <AUDIT_OUT>/authz.json and prints the findings
//
// Writes are probed with a body of {} and the id 999999999, so an allowed call fails validation
// (400 / 404) instead of changing data; what is checked is only WHO gets past the gate:
//   - nobody: every route but /api/auth/login must answer 401;
//   - a viewer: every write must answer 403;
//   - an access right without the route's permission (lib/capabilities-catalog.ts): 403;
//   - the administrator-only resources: 403 for everybody else.
// Reads have no such rule in the app (every signed-in user may read most lists), so the script
// lists what each restricted account can read, for a human to judge (authz-reads.tsv).
// Take a snapshot first (README): a hole found here does change data.
import fs from "fs"
import path from "path"
import { apiRoutes, auditOut } from "./api-routes.mjs"

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname)) throw new Error(`local servers only, not ${BASE}`)
const ADMIN = { username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }
const ADMIN_ONLY = ["/api/access-rights", "/api/permissions", "/api/capabilities", "/api/users"]
// Calls that end the probing session itself or are answered before any gate.
const SKIP = new Set(["POST /api/auth/logout", "POST /api/auth/login", "PUT /api/auth/password", "POST /api/auth/password", "POST /api/user-sessions/revoke-others"])
const MISSING_ID = "999999999"
// Resources where the permission only matters for somebody else's row and the route decides per
// row after reading the body (ending a sign-in of one's own account is self-service): a probe
// with {} stops at the body check there. scripts/factory/audit/sec-session.mjs covers them.
const ROW_DECIDED = ["/api/auth-logs/"]

const { requiredPermission, isSelfServiceRoute } = await import(path.resolve("lib/capabilities-catalog.ts"))

let hop = 0
async function call(cookie, method, url, body) {
  const headers = { origin: BASE, "x-forwarded-for": `10.9.${(hop >> 8) & 255}.${hop++ & 255}` }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers["content-type"] = "application/json"
  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
    } catch (error) {
      if (attempt < 3) continue
      return { status: -1, text: String(error) }
    }
    const text = await response.text()
    if (response.status === 429 && attempt < 30) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      continue
    }
    // A route compiled for the first time by `next dev` may answer an HTML 404 once.
    if (response.status === 404 && /<html/i.test(text) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      continue
    }
    return { status: response.status, text, setCookie: response.headers.getSetCookie?.() ?? [] }
  }
}

const cookieOf = (setCookie) => setCookie.map((value) => value.split(";")[0]).join("; ")

/** Signs in; an account that must change its password gets `password + "-New9"` first. */
async function signIn(username, password) {
  for (const candidate of [`${password}-New9`, password]) {
    const response = await call("", "POST", "/api/auth/login", { username, password: candidate, remember: true })
    if (response.status !== 200) continue
    const cookie = cookieOf(response.setCookie)
    if (!JSON.parse(response.text).mustChangePassword) return cookie
    const changed = await call(cookie, "PUT", "/api/auth/password", { currentPassword: candidate, newPassword: `${password}-New9` })
    if (changed.status !== 200) throw new Error(`password change of ${username}: ${changed.status} ${changed.text.slice(0, 200)}`)
    return signIn(username, password)
  }
  throw new Error(`cannot sign in as ${username}`)
}

const json = (response) => {
  try {
    return JSON.parse(response.text)
  } catch {
    return null
  }
}
const rowsOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.items) ? data.items : [])

const admin = await signIn(ADMIN.username, ADMIN.password)

// --- accounts ---------------------------------------------------------------
const permissions = json(await call(admin, "GET", "/api/permissions")).permissions
const capabilities = rowsOf(json(await call(admin, "GET", "/api/capabilities")))
const rights = rowsOf(json(await call(admin, "GET", "/api/access-rights")))
const codeById = new Map(permissions.map((row) => [row.id, row.code]))
const codesOfRight = (right) => [...new Set((right.capabilityIds ?? []).flatMap((id) => capabilities.find((cap) => cap.id === id)?.permissionIds ?? []).map((id) => codeById.get(id)))].filter(Boolean)

const users = json(await call(admin, "GET", "/api/users"))
const accounts = [
  { name: "nobody", cookie: "", role: "none", codes: [] },
]
for (const [username, role] of [["sec.viewer", "viewer"], ["sec.manager", "manager"]]) {
  const password = `Sec-${role}-2026-probe`
  if (!rowsOf(users).some((row) => row.username === username)) {
    const created = await call(admin, "POST", "/api/users", { username, password, displayName: `Security ${role}`, role })
    if (created.status !== 201) throw new Error(`create ${username}: ${created.status} ${created.text}`)
  }
  accounts.push({ name: role === "viewer" ? "viewer (role only)" : "manager (role only)", cookie: await signIn(username, password), role, codes: role === "manager" ? null : [] })
}
for (const right of rights) {
  const row = rowsOf(users).find((user) => user.accessRightId === right.id && user.role !== "admin" && /\d+$/.test(user.username))
  if (!row) continue
  const index = Number(/(\d+)$/.exec(row.username)[1])
  accounts.push({ name: right.name, username: row.username, cookie: await signIn(row.username, `Zilol-${2026 + index}-xodim`), role: "manager", codes: codesOfRight(right) })
}
accounts.push({ name: "admin", cookie: admin, role: "admin", codes: null })
console.log("accounts:", accounts.map((account) => `${account.name}${account.codes ? ` [${account.codes.join(",")}]` : ""}`).join(" | "))

// --- real ids for the dynamic segments ------------------------------------------
const FIXED = { entity: "client", kind: "promo", action: "recheck" }
const listCache = new Map()
async function sampleId(listUrl) {
  if (!listCache.has(listUrl)) {
    const data = json(await call(admin, "GET", listUrl))
    const first = rowsOf(data)[0]
    listCache.set(listUrl, first ? String(first.key ?? first.id ?? "") : "")
  }
  return listCache.get(listUrl)
}
async function concrete(route, missing) {
  const segments = route.split("/")
  const out = []
  for (const [index, segment] of segments.entries()) {
    const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment)
    if (!match) {
      out.push(segment)
      continue
    }
    if (FIXED[match[1]]) out.push(FIXED[match[1]])
    else if (missing) out.push(MISSING_ID)
    else out.push((index === segments.findIndex((s) => s.startsWith("[")) && (await sampleId(`/api/${out.join("/")}`))) || "1")
  }
  return `/api/${out.join("/")}`
}

// --- the matrix ---------------------------------------------------------------
const results = []
const findings = []
const routes = apiRoutes()
for (const { route, methods } of routes) {
  for (const method of methods) {
    const write = method !== "GET"
    const url = await concrete(route, write)
    if (SKIP.has(`${method} /api/${route}`) || SKIP.has(`${method} ${url}`)) continue
    const code = requiredPermission(url, method)
    const adminOnly = ADMIN_ONLY.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))
    const row = { method, route: `/api/${route}`, url, code, adminOnly, status: {}, size: {} }
    for (const account of accounts) {
      const response = await call(account.cookie, method, url, write && method !== "DELETE" ? {} : undefined)
      row.status[account.name] = response.status
      row.size[account.name] = response.text.length
      const got = response.status
      const flag = (why) => findings.push({ why, account: account.name, method, url, status: got, text: response.text.slice(0, 160) })
      if (got >= 500 || got === -1) flag("server error")
      if (account.role === "none") {
        if (got !== 401 && !(route.startsWith("auth/") && got < 500)) flag("reachable without signing in")
        continue
      }
      if (account.role === "admin") continue
      // 405: the resource has no such action for anybody (e.g. a ref-records kind that cannot be edited).
      const denied = got === 401 || got === 403 || got === 405
      if (adminOnly && !denied) flag("administrator-only resource open")
      else if (write && account.role === "viewer" && !denied && !isSelfServiceRoute(url) && url !== "/api/report-builder") flag("viewer can write")
      else if (write && code && account.codes && !account.codes.includes(code) && !denied && !ROW_DECIDED.some((prefix) => url.startsWith(prefix))) flag(`write without ${code}`)
    }
    results.push(row)
  }
}

const out = auditOut()
fs.writeFileSync(`${out}/authz.json`, JSON.stringify({ accounts: accounts.map(({ cookie, ...rest }) => rest), results, findings }, null, 1))
const names = accounts.map((account) => account.name)
fs.writeFileSync(
  `${out}/authz-reads.tsv`,
  [["url", ...names].join("\t"), ...results.filter((row) => row.method === "GET").map((row) => [row.url, ...names.map((name) => `${row.status[name]}:${row.size[name]}`)].join("\t"))].join("\n"),
)
fs.writeFileSync(
  `${out}/authz-writes.tsv`,
  [["method", "url", "permission", ...names].join("\t"), ...results.filter((row) => row.method !== "GET").map((row) => [row.method, row.url, row.adminOnly ? "admin" : (row.code ?? "-"), ...names.map((name) => row.status[name])].join("\t"))].join("\n"),
)
for (const finding of findings) console.log(JSON.stringify(finding))
console.log(`routes × methods: ${results.length}; findings: ${findings.length}; output: ${out}/authz.json`)
