// Sign-in, session and edge (proxy.ts) checks against the LOCAL factory instance.
//
//   node scripts/factory/audit/sec-session.mjs
//
// Creates its own accounts (sec.s1 … sec.s6 and sec.v<time>, removed at the end) through the administrator and
// prints PASS / FAIL per check; exits 1 when one failed. Reads AUTH_SECRET from .env to forge
// tokens the way an attacker who knows the secret could (only against localhost).
import fs from "fs"
import path from "path"
import { SignJWT } from "jose"

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname)) throw new Error(`local servers only, not ${BASE}`)
const ADMIN = { username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }
const COOKIE = "linko_session"
const SECRET = (fs.readFileSync(path.resolve(".env"), "utf8").match(/^AUTH_SECRET=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "")

let ipCounter = 0
const freshIp = () => `10.77.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`

async function call(method, url, { cookie, body, headers = {}, ip, raw } = {}) {
  const all = { origin: BASE, "x-forwarded-for": ip ?? freshIp(), ...headers }
  if (cookie) all.cookie = cookie
  if (body !== undefined && !raw) all["content-type"] ??= "application/json"
  for (const key of Object.keys(all)) if (all[key] === null) delete all[key]
  const response = await fetch(BASE + url, { method, headers: all, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: "manual" })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: response.status, text, data, headers: response.headers, setCookie: response.headers.getSetCookie?.() ?? [] }
}

const cookieOf = (response) => response.setCookie.map((value) => value.split(";")[0]).join("; ")
const tokenOf = (cookie) => cookie.split("; ").find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? ""

let failed = 0
function check(name, ok, detail = "") {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
}

async function login(username, password, options = {}) {
  return call("POST", "/api/auth/login", { body: { username, password, remember: options.remember ?? false }, ip: options.ip })
}

const adminLogin = await login(ADMIN.username, ADMIN.password)
if (adminLogin.status !== 200) throw new Error(`admin sign-in: ${adminLogin.status} ${adminLogin.text}`)
const admin = cookieOf(adminLogin)

/** A role-only account whose password is already changed (signed in, cookie returned). */
async function account(name, role = "manager") {
  const first = `Sec-${name}-first-2026`
  const password = `Sec-${name}-final-2026`
  const users = (await call("GET", "/api/users", { cookie: admin })).data
  const old = users.find((row) => row.username === name)
  if (old) await call("DELETE", `/api/users/${old.id}`, { cookie: admin })
  const created = await call("POST", "/api/users", { cookie: admin, body: { username: name, password: first, displayName: `Sec ${name}`, role } })
  if (created.status !== 201) throw new Error(`create ${name}: ${created.status} ${created.text}`)
  const firstLogin = await login(name, first)
  const firstCookie = cookieOf(firstLogin)
  return { id: created.data.id, name, first, password, firstLogin, firstCookie }
}
async function finishPassword(user) {
  const changed = await call("PUT", "/api/auth/password", { cookie: user.firstCookie, body: { currentPassword: user.first, newPassword: user.password } })
  const cookie = cookieOf(changed) || user.firstCookie
  return { changed, cookie }
}

// --- 1. the cookie ---------------------------------------------------------------
{
  const raw = adminLogin.setCookie.find((value) => value.startsWith(`${COOKIE}=`)) ?? ""
  check("session cookie is HttpOnly", /;\s*HttpOnly/i.test(raw), raw.replace(/=[^;]+/, "=…"))
  check("session cookie is SameSite=Lax (or Strict)", /;\s*SameSite=(Lax|Strict)/i.test(raw))
  check("session cookie has Path=/", /;\s*Path=\//i.test(raw))
  check("without «Запомнить меня» the cookie has no Max-Age (ends with the browser)", !/Max-Age|Expires/i.test(raw))
  const remembered = await login(ADMIN.username, ADMIN.password, { remember: true })
  check("with «Запомнить меня» the cookie lasts 30 days", /Max-Age=2592000/i.test(remembered.setCookie.join(";")))
  await call("POST", "/api/auth/logout", { cookie: cookieOf(remembered) })
  check("the token is not in the sign-in answer body", !adminLogin.text.includes(tokenOf(admin)))
}

// --- 2. forged and tampered tokens ----------------------------------------------------
{
  const token = tokenOf(admin)
  const [head, payload, signature] = token.split(".")
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString())
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const me = (value) => call("GET", "/api/auth/me", { cookie: `${COOKIE}=${value}` })

  check("a token with a changed payload is refused", (await me(`${head}.${b64({ ...claims, uid: 2 })}.${signature}`)).status === 401)
  check('a token with alg "none" is refused', (await me(`${b64({ alg: "none", typ: "JWT" })}.${payload}.`)).status === 401)
  const withSecret = (secret, body) =>
    new SignJWT(body).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret))
  check(
    "a token signed with the public example secret is refused",
    (await me(await withSecret("change-me-to-a-long-random-secret", { uid: claims.uid, role: "admin", sid: claims.sid }))).status === 401,
  )
  check("a garbage cookie is refused", (await me("not-a-token")).status === 401)

  if (SECRET) {
    // Somebody who knows the secret still needs a live session of the SAME account.
    const user = await account("sec.s1")
    const { cookie } = await finishPassword(user)
    const userClaims = JSON.parse(Buffer.from(tokenOf(cookie).split(".")[1], "base64url").toString())
    const unknownSid = await me(await withSecret(SECRET, { uid: claims.uid, role: "admin", sid: crypto.randomUUID() }))
    check("a correctly signed token with an unknown session id is refused", unknownSid.status === 401)
    const borrowed = await me(await withSecret(SECRET, { uid: claims.uid, role: "admin", sid: userClaims.sid }))
    check("a correctly signed token cannot name another account on somebody's live session", borrowed.status === 401, `status ${borrowed.status} ${borrowed.data?.username ?? ""}`)
    const roleLie = await call("GET", "/api/users", { cookie: `${COOKIE}=${await withSecret(SECRET, { uid: userClaims.uid, role: "admin", sid: userClaims.sid })}` })
    check("a role claim of admin on a manager's session does not open administrator resources", roleLie.status === 403, `status ${roleLie.status}`)
    await call("DELETE", `/api/users/${user.id}`, { cookie: admin })
  } else console.log("SKIP  forged-token checks (no AUTH_SECRET in .env)")
}

// --- 3. forced password change, sign-out, password change -------------------------------
{
  const user = await account("sec.s2")
  check("an administrator-set password must be changed at the first sign-in", user.firstLogin.data?.mustChangePassword === true)
  const blocked = await call("GET", "/api/clients", { cookie: user.firstCookie })
  check("until then the API answers 403 passwordChangeRequired", blocked.status === 403 && blocked.data?.code === "passwordChangeRequired", `status ${blocked.status}`)
  const weak = await call("PUT", "/api/auth/password", { cookie: user.firstCookie, body: { currentPassword: user.first, newPassword: "12345678" } })
  check("a weak new password is refused", weak.status === 400)
  const same = await call("PUT", "/api/auth/password", { cookie: user.firstCookie, body: { currentPassword: user.first, newPassword: user.first } })
  check("the same password again is refused", same.status === 400)
  const wrong = await call("PUT", "/api/auth/password", { cookie: user.firstCookie, body: { currentPassword: "wrong-current-pass", newPassword: user.password } })
  check("a wrong current password is refused", wrong.status === 400)

  const second = cookieOf(await login(user.name, user.first)) // a second device, same account
  const { changed, cookie } = await finishPassword(user)
  check("the password change succeeds", changed.status === 200)
  check("the changing session stays signed in", (await call("GET", "/api/auth/me", { cookie })).status === 200)
  check("every other session of the account is ended", (await call("GET", "/api/auth/me", { cookie: second })).status === 401)
  check("the old password no longer signs in", (await login(user.name, user.first)).status === 401)
  check("the pre-change token is dead too", (await call("GET", "/api/clients", { cookie: user.firstCookie })).status !== 200)

  const again = cookieOf(await login(user.name, user.password))
  const out = await call("POST", "/api/auth/logout", { cookie: again })
  check("sign-out answers 200 and clears the cookie", out.status === 200 && /Max-Age=0/i.test(out.setCookie.join(";")))
  check("a copied cookie stops working after sign-out", (await call("GET", "/api/auth/me", { cookie: again })).status === 401)

  // An administrator's changes apply to live sessions at once.
  const live = cookieOf(await login(user.name, user.password))
  const write = () => call("POST", "/api/client-types", { cookie: live, body: {} })
  check("a manager reaches a write handler (validation error, not 403)", (await write()).status === 400)
  await call("PATCH", `/api/users/${user.id}`, { cookie: admin, body: { role: "viewer" } })
  // A role change ends the account's sessions (401); 403 would be as good.
  const demoted = (await write()).status
  check("after a demotion to viewer the old session cannot write", demoted === 401 || demoted === 403, `status ${demoted}`)
  await call("DELETE", `/api/users/${user.id}`, { cookie: admin })
  check("after the account is deleted its session is dead", (await call("GET", "/api/auth/me", { cookie: live })).status === 401)
}

// --- 4. other accounts' sessions --------------------------------------------------------
{
  const a = await account("sec.s3")
  const b = await account("sec.s4")
  const cookieA = (await finishPassword(a)).cookie
  const cookieB = (await finishPassword(b)).cookie
  const sessionsB = (await call("GET", "/api/user-sessions", { cookie: cookieB })).data
  const list = Array.isArray(sessionsB) ? sessionsB : (sessionsB?.sessions ?? [])
  const sidB = list[0]?.id
  const sessionsA = (await call("GET", "/api/user-sessions", { cookie: cookieA })).text
  check("the session list holds only the caller's own sessions", Boolean(sidB) && !sessionsA.includes(sidB))
  const stolen = await call("DELETE", `/api/user-sessions/${sidB}`, { cookie: cookieA })
  check("ending another account's session is refused", stolen.status === 404 || stolen.status === 403, `status ${stolen.status}`)
  check("…and that session is still alive", (await call("GET", "/api/auth/me", { cookie: cookieB })).status === 200)
  for (const path of ["/api/users", "/api/access-rights", "/api/capabilities", "/api/permissions"]) {
    check(`a manager cannot read ${path}`, (await call("GET", path, { cookie: cookieA })).status === 403)
  }
  for (const path of ["/api//users", "/api/users/", "/api/./users", "/api/Users", "/api/users%2F", "/api/users;x=1", "/api/users/../users"]) {
    const response = await call("GET", path, { cookie: cookieA })
    check(`path trick ${path} does not open the users list`, response.status !== 200 || !Array.isArray(response.data), `status ${response.status}`)
  }
  // Headers the proxy sets for the route handlers cannot be supplied by the client.
  const spoof = await call("GET", "/api/users", { cookie: cookieA, headers: { "x-linko-path": "/api/clients", "x-linko-method": "GET", "x-linko-mark": "0".repeat(64) } })
  check("client-supplied x-linko-* headers change nothing", spoof.status === 403)
  await call("DELETE", `/api/users/${a.id}`, { cookie: admin })
  await call("DELETE", `/api/users/${b.id}`, { cookie: admin })
}

// --- 5. guessing passwords ---------------------------------------------------------------
{
  // Its own victim account: the counters live for 10 minutes and must not lock the administrator.
  // A new login for every run: the failure counters of a login live for 10 minutes in the server's memory.
  const victim = await account(`sec.v${Date.now().toString(36)}`)
  const { cookie: victimSession } = await finishPassword(victim)
  const deviceCookie = (await login(victim.name, victim.password)).setCookie.map((value) => value.split(";")[0]).find((value) => value.startsWith("linko_device=")) ?? ""
  check("a sign-in leaves a known-device cookie (HttpOnly, only for /api/auth)", Boolean(deviceCookie))
  check("the device cookie is not a session", (await call("GET", "/api/auth/me", { cookie: deviceCookie.replace("linko_device=", `${COOKIE}=`) })).status === 401)

  const ip = freshIp()
  const statuses = []
  for (let attempt = 0; attempt < 7; attempt++) statuses.push((await login(victim.name, `wrong-password-${attempt}`, { ip })).status)
  check("5 wrong passwords lock that client out of the account", statuses.slice(0, 5).every((status) => status === 401) && statuses[5] === 429, statuses.join(","))
  check("…even with the right password while locked", (await login(victim.name, victim.password, { ip })).status === 429)
  check("another client still signs in to the same account", (await login(victim.name, victim.password)).status === 200)
  const ghost = []
  const ghostName = `no.such.${Date.now().toString(36)}`
  const ghostIp = freshIp()
  for (let attempt = 0; attempt < 7; attempt++) ghost.push((await login(ghostName, `wrong-password-${attempt}`, { ip: ghostIp })).status)
  check("an unknown login is locked the same way (reveals nothing)", ghost.join(",") === statuses.join(","), ghost.join(","))

  // A guesser who changes address for every try: the account-wide counter stops them at 20…
  const rotating = []
  for (let attempt = 0; attempt < 24; attempt++) rotating.push((await login(victim.name, `rotating-guess-${attempt}`)).status)
  check("wrong passwords from ever new addresses lock the account (20 in 10 minutes)", rotating.includes(429) && rotating.filter((status) => status === 401).length <= 20, `first 429 at try ${rotating.indexOf(429) + 1}`)
  check("…for a client that never signed in, even with the right password", (await login(victim.name, victim.password)).status === 429)
  // …but cannot lock the owner out of the browser they use.
  const owner = await call("POST", "/api/auth/login", { body: { username: victim.name, password: victim.password }, cookie: deviceCookie })
  check("the owner's own browser (known device) still signs in while the login is under attack", owner.status === 200, `status ${owner.status}`)
  const forged = await call("POST", "/api/auth/login", { body: { username: victim.name, password: victim.password }, cookie: "linko_device=eyJhbGciOiJIUzI1NiJ9.eyJraW5kIjoiZGV2aWNlIn0.x" })
  check("a made-up device cookie does not lift the lock", forged.status === 429, `status ${forged.status}`)
  const otherDevice = (await login(ADMIN.username, ADMIN.password)).setCookie.map((value) => value.split(";")[0]).find((value) => value.startsWith("linko_device=")) ?? ""
  const borrowed = await call("POST", "/api/auth/login", { body: { username: victim.name, password: victim.password }, cookie: otherDevice })
  check("a device cookie of another account does not lift it either", borrowed.status === 429, `status ${borrowed.status}`)
  const deviceGuess = []
  const deviceIp = freshIp()
  for (let attempt = 0; attempt < 7; attempt++) deviceGuess.push((await call("POST", "/api/auth/login", { body: { username: victim.name, password: `device-guess-${attempt}` }, cookie: deviceCookie, ip: deviceIp })).status)
  check("a known device gets 5 wrong passwords like everyone", deviceGuess.slice(0, 5).every((status) => status === 401) && deviceGuess[5] === 429, deviceGuess.join(","))
  const deviceOtherIp = await call("POST", "/api/auth/login", { body: { username: victim.name, password: "device-guess-again" }, cookie: deviceCookie })
  check("…and changing the address does not give the device more tries", deviceOtherIp.status === 429, `status ${deviceOtherIp.status}`)
  check("the victim's open session keeps working throughout", (await call("GET", "/api/auth/me", { cookie: victimSession })).status === 200)
  await call("DELETE", `/api/users/${victim.id}`, { cookie: admin })

  const time = async (username) => {
    const samples = []
    for (let round = 0; round < 4; round++) {
      const started = performance.now()
      await login(username, "Wrong-password-000")
      samples.push(performance.now() - started)
    }
    return samples.sort((x, y) => x - y)[1]
  }
  const timed = await account("sec.s6")
  await finishPassword(timed)
  const known = await time(timed.name)
  const unknown = await time(`${ghostName}.t`)
  check("known and unknown logins take about the same time", Math.abs(known - unknown) < Math.max(80, known * 0.5), `${known.toFixed(0)} ms vs ${unknown.toFixed(0)} ms`)
  await call("DELETE", `/api/users/${timed.id}`, { cookie: admin })

  const burstIp = freshIp()
  const burst = []
  for (let attempt = 0; attempt < 24; attempt++) burst.push((await login(`burst.user.${attempt}`, "Wrong-password-000", { ip: burstIp })).status)
  check("more than 20 sign-in requests a minute from one address are throttled", burst.includes(429), `first 429 at request ${burst.indexOf(429) + 1}`)
}

// --- 6. the edge: origin, size, text ----------------------------------------------------
{
  const evil = { origin: "https://evil.example" }
  check("a write from another site is refused (Origin)", (await call("POST", "/api/client-types", { cookie: admin, body: { name: "x" }, headers: evil })).status === 403)
  check("a read from another site is refused too", (await call("GET", "/api/clients", { cookie: admin, headers: evil })).status === 403)
  const preflight = await call("OPTIONS", "/api/clients", { headers: { ...evil, "access-control-request-method": "POST" } })
  check("a preflight from another site gets no CORS permission", !preflight.headers.get("access-control-allow-origin"), `status ${preflight.status}`)
  const crossSite = await call("POST", "/api/client-types", { cookie: admin, body: { name: "x" }, headers: { origin: null, "sec-fetch-site": "cross-site" } })
  check("a cross-site write without an Origin header is refused (Sec-Fetch-Site)", crossSite.status === 403, `status ${crossSite.status}`)
  const sameSite = await call("POST", "/api/client-types", { cookie: admin, body: {}, headers: { "sec-fetch-site": "same-origin" } })
  check("a same-origin write passes the edge", sameSite.status === 400, `status ${sameSite.status}`)
  const big = await call("POST", "/api/client-types", { cookie: admin, body: { name: "x".repeat(2_200_000) } })
  check("a body over 2 MB is refused", big.status === 413, `status ${big.status}`)
  const nul = await call("POST", "/api/client-types", { cookie: admin, body: { name: "a\u0000b" } })
  check("a NUL character in a text is refused", nul.status === 400)
  const page = await call("GET", "/login", {})
  const api = await call("GET", "/api/auth/me", { cookie: admin })
  for (const [name, response] of [["page", page], ["API", api]]) {
    check(`${name} answers carry X-Frame-Options: DENY`, response.headers.get("x-frame-options") === "DENY")
    check(`${name} answers carry nosniff`, response.headers.get("x-content-type-options") === "nosniff")
    check(`${name} answers carry a Content-Security-Policy with frame-ancestors 'none'`, /frame-ancestors 'none'/.test(response.headers.get("content-security-policy") ?? ""))
    check(`${name} answers carry Referrer-Policy`, Boolean(response.headers.get("referrer-policy")))
  }
  const csp = page.headers.get("content-security-policy") ?? ""
  check("pages carry a script policy (nonce, no unsafe-inline scripts)", /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), csp.slice(0, 120))
  check("pages forbid plugins and foreign form targets", /object-src 'none'/.test(csp) && /form-action 'self'/.test(csp) && /base-uri 'self'/.test(csp))
  check("the server does not name its framework (X-Powered-By)", !page.headers.get("x-powered-by"))
  const anonymous = await call("GET", "/analytics/orders", {})
  check("a page without a session redirects to /login", anonymous.status === 307 && /\/login\?from=/.test(anonymous.headers.get("location") ?? ""), `status ${anonymous.status}`)
  check("an API call without a session answers 401", (await call("GET", "/api/clients", {})).status === 401)
  const image = await call("GET", "/_next/image?url=%2Fbrand%2Fmezon-login.png&w=640&q=75", {})
  check("the image optimizer endpoint is off (404)", image.status === 404, `status ${image.status}`)
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed")
process.exit(failed ? 1 : 0)
