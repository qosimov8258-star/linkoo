// Injection probes for every GET route of the LOCAL factory instance: each query parameter the
// route (or the lib files it imports) reads is sent SQL / template / path payloads, one at a time.
//
//   node scripts/factory/audit/sec-inject.mjs [routeRegex]
//
// A finding is a 5xx answer (a query broke: the value reached SQL text), an answer that took as
// long as the pg_sleep in the payload (the value was executed), or a payload echoed back inside
// an HTML answer. Read-only. Writes <AUDIT_OUT>/inject.json.
import fs from "fs"
import path from "path"
import { apiRoutes, auditOut } from "./api-routes.mjs"

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname)) throw new Error(`local servers only, not ${BASE}`)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
const only = process.argv[2] ? new RegExp(process.argv[2]) : null
const SLEEP_SECONDS = 4

const PAYLOADS = [
  "'",
  "\\",
  "x') OR ('1'='1",
  `1; SELECT pg_sleep(${SLEEP_SECONDS})--`,
  `x'||pg_sleep(${SLEEP_SECONDS})||'`,
  `name, (SELECT pg_sleep(${SLEEP_SECONDS}))`,
  "1 UNION SELECT NULL,NULL--",
  "%' AND 1=CAST((SELECT version()) AS int)--",
  "<svg/onload=alert(1)>{{7*7}}",
]

// Query parameter names a source file reads: params.get("x"), searchParams.getAll("x"),
// idList(search, "x"), texts("x"), list(params, "x") …
const NAME = /(?:\.get|\.getAll|\.has)\(\s*["'`]([A-Za-z_][\w.-]{0,40})["'`]\s*\)|\b(?:idList|textList|list|texts|ids|intParam|param|text|bool|flag|day|date|num|numberParam|csv|multi|single|optional|str|int)\(\s*(?:\w+\s*,\s*)?["'`]([A-Za-z_][\w.-]{0,40})["'`]/g
const fileCache = new Map()
function namesIn(file) {
  if (!fileCache.has(file)) {
    const found = new Set()
    let text = ""
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {}
    for (const match of text.matchAll(NAME)) found.add(match[1] ?? match[2])
    const imports = [...text.matchAll(/from\s+["']@\/((?:lib|app)\/[^"']+)["']/g)].map((match) => path.join(ROOT, match[1]))
    fileCache.set(file, { names: found, imports })
  }
  return fileCache.get(file)
}
function resolveSource(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(candidate)) return candidate
  return null
}
/** Parameter names of a route: its own file and what it imports, two levels deep. */
function paramsOf(routeFile) {
  const names = new Set(["page", "pageSize", "search", "ordering", "from", "to"])
  const seen = new Set()
  let level = [routeFile]
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next = []
    for (const file of level) {
      if (seen.has(file)) continue
      seen.add(file)
      const info = namesIn(file)
      for (const name of info.names) names.add(name)
      for (const base of info.imports) {
        const source = resolveSource(base)
        if (source && /\/(lib|app)\//.test(source)) next.push(source)
      }
    }
    level = next
  }
  return [...names].filter((name) => !/^(content-type|content-length|origin|cookie|user-agent|x-|accept)/i.test(name))
}

const WORKERS = Number(process.env.WORKERS ?? 4)
/** One session per worker: the request budget of the proxy is per session. */
async function signIn() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }),
  })
  if (!login.ok) throw new Error(`sign-in ${login.status}`)
  return login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
}
const cookies = []
for (let index = 0; index < WORKERS; index++) cookies.push(await signIn())

async function get(url, cookie = cookies[0]) {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now()
    let response
    try {
      response = await fetch(BASE + url, { headers: { cookie }, redirect: "manual" })
    } catch (error) {
      return { status: -1, text: String(error), ms: performance.now() - started, type: "" }
    }
    const text = await response.text()
    if (response.status === 429 && attempt < 40) {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      continue
    }
    return { status: response.status, text, ms: performance.now() - started, type: response.headers.get("content-type") ?? "" }
  }
}

const listIds = new Map()
async function sampleId(listUrl) {
  if (!listIds.has(listUrl)) {
    const response = await get(listUrl)
    let first
    try {
      const data = JSON.parse(response.text)
      first = (Array.isArray(data) ? data : (data.results ?? data.rows ?? data.items ?? []))[0]
    } catch {}
    listIds.set(listUrl, first ? String(first.key ?? first.id ?? "1") : "1")
  }
  return listIds.get(listUrl)
}

const findings = []
let requests = 0
const routes = apiRoutes().filter(({ route, methods }) => methods.includes("GET") && !/^auth\//.test(route) && (!only || only.test(route)))

async function probeRoute(route, cookie) {
  const segments = []
  for (const segment of route.split("/")) {
    const match = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segment)
    if (!match) segments.push(segment)
    else segments.push({ entity: "client", kind: "promo", action: "recheck" }[match[1]] ?? (await sampleId(`/api/${segments.join("/")}`)))
  }
  const url = `/api/${segments.join("/")}`
  const names = paramsOf(path.join(ROOT, "app/api", route, "route.ts"))
  const baseline = await get(url, cookie)
  requests++
  // Every parameter and, for a dynamic route, the path segment itself: one payload at a time.
  const targets = [...names.map((name) => ({ kind: "param", name }))]
  if (route.includes("[")) targets.push({ kind: "path" })
  for (const target of targets) {
    for (const payload of PAYLOADS) {
      const encoded = encodeURIComponent(payload)
      const probe = target.kind === "param" ? `${url}?${encodeURIComponent(target.name)}=${encoded}` : `${url.replace(/\/[^/]+$/, "")}/${encoded}`
      let response = await get(probe, cookie)
      requests++
      let slow = /pg_sleep/.test(payload) && response.ms > SLEEP_SECONDS * 1000 - 300 && response.ms > baseline.ms + 2500
      if (slow) {
        // Once more: a slow answer must repeat to count (a busy dev server is slow by itself).
        response = await get(probe, cookie)
        slow = response.ms > SLEEP_SECONDS * 1000 - 300
      }
      const echoed = /html/i.test(response.type) && response.status < 400 && response.text.includes(payload) && /[<{]/.test(payload)
      if (response.status >= 500 || response.status === -1 || slow || echoed) {
        const row = { url: probe, where: target.kind === "param" ? target.name : "path", payload, status: response.status, ms: Math.round(response.ms), why: slow ? "slow (sleep ran?)" : echoed ? "echoed in HTML" : "server error", text: response.text.slice(0, 200) }
        findings.push(row)
        console.log(JSON.stringify(row))
      }
    }
  }
}

let cursor = 0
await Promise.all(
  cookies.map(async (cookie) => {
    while (cursor < routes.length) await probeRoute(routes[cursor++].route, cookie)
  }),
)
fs.writeFileSync(`${auditOut()}/inject.json`, JSON.stringify(findings, null, 1))
console.log(`routes: ${routes.length}; requests: ${requests}; findings: ${findings.length}`)
