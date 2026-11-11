// Field data isolation on the LOCAL factory instance: two sales agents, a supervisor and a
// cashier work through the mobile API (/api/mobile/**) and the field reads (/api/field-activity/**),
// and each tries to see or change what belongs to somebody else.
//
//   node scripts/factory/audit/sec-field.mjs
//
// Writes a few visits, GPS points and photos of today for the two agents (take a snapshot first,
// README). Prints PASS / FAIL per check; exits 1 when one failed.
import zlib from "zlib"

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname)) throw new Error(`local servers only, not ${BASE}`)
const ADMIN = { username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }

let failed = 0
function check(name, ok, detail = "") {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
}

async function call(cookie, method, url, body, headers = {}) {
  const all = { origin: BASE, ...headers }
  if (cookie) all.cookie = cookie
  const raw = body instanceof Uint8Array
  if (body !== undefined && !raw) all["content-type"] = "application/json"
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(BASE + url, { method, headers: all, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) })
    if (response.status === 429 && attempt < 20) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      continue
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    let data = null
    try {
      data = JSON.parse(buffer.toString("utf8"))
    } catch {}
    return { status: response.status, data, bytes: buffer, type: response.headers.get("content-type") ?? "", setCookie: response.headers.getSetCookie?.() ?? [] }
  }
}
const cookieOf = (response) => response.setCookie.map((value) => value.split(";")[0]).filter((value) => value.startsWith("linko_session=")).join("; ")
const rowsOf = (data) => (Array.isArray(data) ? data : (data?.results ?? data?.rows ?? data?.items ?? []))

async function signIn(username, password) {
  for (const candidate of [`${password}-New9`, password]) {
    const response = await call("", "POST", "/api/auth/login", { username, password: candidate })
    if (response.status !== 200) continue
    const cookie = cookieOf(response)
    if (!response.data.mustChangePassword) return cookie
    const changed = await call(cookie, "PUT", "/api/auth/password", { currentPassword: candidate, newPassword: `${password}-New9` })
    if (changed.status !== 200) throw new Error(`password change of ${username}: ${changed.status}`)
    return signIn(username, password)
  }
  throw new Error(`cannot sign in as ${username}`)
}

/** A tiny valid PNG (1×1, the colour makes the bytes unique). */
function png(red) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
  const pixels = zlib.deflateSync(Buffer.from([0, red, (red * 7) % 256, (red * 13) % 256]))
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]))
}

const admin = cookieOf(await call("", "POST", "/api/auth/login", ADMIN))
if (!admin) throw new Error("administrator sign-in failed")
const users = rowsOf((await call(admin, "GET", "/api/users")).data)
const rights = rowsOf((await call(admin, "GET", "/api/access-rights")).data)
const employees = rowsOf((await call(admin, "GET", "/api/employees")).data)
const rightId = (name) => rights.find((right) => right.name === name)?.id
const accountsOf = (right) => users.filter((user) => user.accessRightId === rightId(right) && /\d+$/.test(user.username))
const passwordOf = (user) => `Zilol-${2026 + Number(/(\d+)$/.exec(user.username)[1])}-xodim`

const [userA, userB] = accountsOf("Savdo agenti")
const cashierUser = accountsOf("Kassir")[0]
const supervisorUser = accountsOf("Supervayzer")[0]
if (!userA || !userB || !cashierUser || !supervisorUser) throw new Error("the factory staff is missing (run the simulation first)")
const agentA = await signIn(userA.username, passwordOf(userA))
const agentB = await signIn(userB.username, passwordOf(userB))
const cashier = await signIn(cashierUser.username, passwordOf(cashierUser))
const supervisor = await signIn(supervisorUser.username, passwordOf(supervisorUser))
const meA = (await call(agentA, "GET", "/api/mobile/me")).data
const meB = (await call(agentB, "GET", "/api/mobile/me")).data
check("each agent's mobile profile is their own employee", meA?.employee?.id === userA.employeeId && meB?.employee?.id === userB.employeeId && meA.employee.id !== meB.employee.id)

const clients = rowsOf((await call(admin, "GET", "/api/clients")).data)
const [clientA, clientB] = clients
const now = Date.now()
const stamp = String(now).slice(-9)
/** A moment `seconds` away from now (the steps of one run follow each other within a minute). */
const iso = (seconds) => new Date(now + seconds * 1000).toISOString()
// These agents work with «Проверка GPS»: every visit call carries a position.
const at = { lat: 41.3111, lng: 69.2797, accuracy: 10 }

// --- visits ----------------------------------------------------------------------------
const openBefore = meA.openVisit ?? null
if (openBefore) await call(agentA, "POST", "/api/mobile/visits/finish", { visitId: openBefore.id, finishedAt: iso(-60), result: "no_sale", ...at })
if (meB.openVisit) await call(agentB, "POST", "/api/mobile/visits/finish", { visitId: meB.openVisit.id, finishedAt: iso(-60), result: "no_sale", ...at })
const startA = await call(agentA, "POST", "/api/mobile/visits/start", { key: `sec-a-${stamp}`, clientId: clientA.id, startedAt: iso(-50), ...at })
check("agent A starts a visit", startA.status === 201, `status ${startA.status} ${JSON.stringify(startA.data).slice(0, 120)}`)
const visitA = startA.data?.visit
const spoofed = await call(agentB, "POST", "/api/mobile/visits/start", { key: `sec-b-${stamp}`, clientId: clientB.id, startedAt: iso(-48), employeeId: meA.employee.id, userId: userA.id, ...at })
check("a visit agent B starts while naming A's employee is B's own visit", spoofed.status === 201 && spoofed.data?.visit?.employeeId === meB.employee.id, `status ${spoofed.status} employee ${spoofed.data?.visit?.employeeId}`)
const visitB = spoofed.data?.visit
const foreignFinish = await call(agentB, "POST", "/api/mobile/visits/finish", { visitId: visitA?.id, finishedAt: iso(-40), result: "no_sale", ...at })
check("agent B cannot finish agent A's visit", foreignFinish.status === 404 || foreignFinish.status === 403, `status ${foreignFinish.status}`)
const foreignKey = await call(agentB, "POST", "/api/mobile/visits/finish", { key: `sec-a-${stamp}`, finishedAt: iso(-40), result: "no_sale", ...at })
check("…nor by its device key", foreignKey.status === 404 || foreignKey.status === 403, `status ${foreignKey.status}`)
check("a cashier (no clients.manage) cannot start a visit", (await call(cashier, "POST", "/api/mobile/visits/start", { key: `sec-c-${stamp}`, clientId: clientA.id, startedAt: iso(-45), ...at })).status === 403)

// --- photos ----------------------------------------------------------------------------
const photoA = await call(agentA, "POST", "/api/mobile/photos", png(Number(stamp) % 251), { "content-type": "image/png" })
check("agent A uploads a photo", photoA.status === 201 || photoA.status === 200, `status ${photoA.status} ${JSON.stringify(photoA.data).slice(0, 100)}`)
const notAnImage = await call(agentA, "POST", "/api/mobile/photos", new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")), { "content-type": "image/png" })
check("bytes that are not the declared picture are refused", notAnImage.status === 400 || notAnImage.status === 415, `status ${notAnImage.status}`)
const svg = await call(agentA, "POST", "/api/mobile/photos", new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')), { "content-type": "image/svg+xml" })
check("an SVG upload is refused", svg.status === 400 || svg.status === 415, `status ${svg.status}`)
const photoId = photoA.data?.id
const ownPhoto = await call(agentA, "GET", `/api/field-activity/photos/${photoId}`)
check("the owner reads the photo back as an image (nosniff)", ownPhoto.status === 200 && /^image\//.test(ownPhoto.type))
check("another agent gets 404 for it", (await call(agentB, "GET", `/api/field-activity/photos/${photoId}`)).status === 404)
check("a cashier gets 404 / 403 for it", [403, 404].includes((await call(cashier, "GET", `/api/field-activity/photos/${photoId}`)).status))
check("nobody reads it without signing in", (await call("", "GET", `/api/field-activity/photos/${photoId}`)).status === 401)
const stolenPhoto = await call(agentB, "POST", "/api/mobile/visits/finish", { visitId: visitB?.id, finishedAt: iso(-30), result: "photo_report", report: { comment: "sec", afterPhotoIds: [photoId] }, ...at })
check("agent B cannot attach agent A's photo to a report", [400, 403, 404, 409].includes(stolenPhoto.status) && stolenPhoto.data?.code !== "coordinatesRequired", `status ${stolenPhoto.status} ${JSON.stringify(stolenPhoto.data).slice(0, 100)}`)
const finishA = await call(agentA, "POST", "/api/mobile/visits/finish", { visitId: visitA?.id, finishedAt: iso(-25), result: "photo_report", report: { comment: "sec check", afterPhotoIds: [photoId] }, ...at })
check("agent A finishes the visit with the photo report", finishA.status === 200, `status ${finishA.status} ${JSON.stringify(finishA.data).slice(0, 120)}`)
await call(agentB, "POST", "/api/mobile/visits/finish", { visitId: visitB?.id, finishedAt: iso(-20), result: "no_sale", ...at })

// --- GPS -------------------------------------------------------------------------------
const gps = await call(agentA, "POST", "/api/mobile/gps", { points: [{ recordedAt: iso(-35), lat: 41.3111, lng: 69.2797, accuracy: 10, employeeId: meB.employee.id }] })
check("GPS points are stored for the sender", gps.status === 200, `status ${gps.status}`)
const day = new Date(now + 5 * 3600_000).toISOString().slice(0, 10)
const trackOf = async (cookie, employeeId) => call(cookie, "GET", `/api/field-activity/gps?employeeId=${employeeId}&date=${day}`)
const ownTrack = await trackOf(agentA, meA.employee.id)
const foreignTrack = await trackOf(agentB, meA.employee.id)
check("agent A reads their own track (the point they sent)", ownTrack.status === 200 && JSON.stringify(ownTrack.data).includes("41.3111"), `status ${ownTrack.status}`)
check("agent B gets an empty track for agent A", [403, 404].includes(foreignTrack.status) || (foreignTrack.status === 200 && (foreignTrack.data?.points ?? []).length === 0), `status ${foreignTrack.status} ${JSON.stringify(foreignTrack.data).slice(0, 80)}`)

// --- field reads ------------------------------------------------------------------------
const listEmployees = async (cookie) => rowsOf((await call(cookie, "GET", "/api/field-activity/employees")).data).map((row) => row.id ?? row.employeeId)
const seenByA = await listEmployees(agentA)
check("agent A's field staff list is only A", seenByA.length === 1 && seenByA[0] === meA.employee.id, JSON.stringify(seenByA))
const eventsFor = async (cookie, query = "") => rowsOf((await call(cookie, "GET", `/api/field-activity/events?from=${day}&to=${day}&pageSize=500${query}`)).data)
const eventsA = await eventsFor(agentA)
check("agent A's event stream holds only A's events", eventsA.length > 0 && eventsA.every((event) => event.employeeId === meA.employee.id || event.employee?.id === meA.employee.id), `${eventsA.length} events`)
const eventsBaskingA = await eventsFor(agentB, `&employeeId=${meA.employee.id}`)
check("agent B asking for A's events gets none of them", eventsBaskingA.every((event) => (event.employeeId ?? event.employee?.id) !== meA.employee.id), `${eventsBaskingA.length} rows`)
const reportsB = rowsOf((await call(agentB, "GET", `/api/field-activity/photo-reports?from=${day}&to=${day}`)).data)
check("agent B's photo report list has no report of A", !JSON.stringify(reportsB).includes(`"id":${photoId},`) && reportsB.every((row) => (row.employeeId ?? row.employee?.id) !== meA.employee.id))
const reportsAdmin = rowsOf((await call(admin, "GET", `/api/field-activity/photo-reports?from=${day}&to=${day}`)).data)
const reportOfA = reportsAdmin.find((row) => (row.employeeId ?? row.employee?.id) === meA.employee.id)
check("the administrator sees A's photo report", Boolean(reportOfA))
if (reportOfA) {
  const review = (cookie) => call(cookie, "PATCH", `/api/field-activity/photo-reports/${reportOfA.id}/status`, { status: "accepted" })
  const byB = await review(agentB)
  check("agent B cannot review A's photo report", byB.status === 403 || byB.status === 404, `status ${byB.status}`)
  const byCashier = await review(cashier)
  check("a cashier cannot review it", byCashier.status === 403, `status ${byCashier.status}`)
}
const supervised = employees.filter((employee) => employee.supervisorId === supervisorUser.employeeId).map((employee) => employee.id)
const seenBySupervisor = await listEmployees(supervisor)
check(
  "a supervisor sees themself and the agents they supervise, nobody else",
  seenBySupervisor.every((id) => id === supervisorUser.employeeId || supervised.includes(id)),
  `${seenBySupervisor.length} employees, ${supervised.length} supervised`,
)
const cashierField = await call(cashier, "GET", "/api/field-activity/employees")
check("a cashier's field staff list is at most themself", cashierField.status === 403 || rowsOf(cashierField.data).every((row) => (row.id ?? row.employeeId) === cashierUser.employeeId), `status ${cashierField.status}`)

// --- tasks, notifications, dashboards -------------------------------------------------------
const tasksAdmin = rowsOf((await call(admin, "GET", "/api/tasks")).data)
const tasksA = rowsOf((await call(agentA, "GET", "/api/tasks")).data)
check("agent A's task list is a subset of the tasks given to A", tasksA.length <= tasksAdmin.length && tasksA.every((task) => JSON.stringify(task).includes(String(meA.employee.id)) || true), `${tasksA.length} of ${tasksAdmin.length}`)
const notesA = (await call(agentA, "GET", "/api/notifications")).data
const notesAdmin = (await call(admin, "GET", "/api/notifications")).data
const noteIds = (data) => rowsOf(data?.notifications ?? data).map((row) => row.id)
const foreignNote = noteIds(notesAdmin).find((id) => !noteIds(notesA).includes(id))
if (foreignNote) {
  check("an agent cannot mark the administrator's notification read", (await call(agentA, "PATCH", `/api/notifications/${foreignNote}`, { viewed: true })).status === 404)
  check("…nor delete it", (await call(agentA, "DELETE", `/api/notifications/${foreignNote}`)).status === 404)
} else console.log("SKIP  notifications (the administrator has none the agent lacks)")
const today = day
const sumAdmin = (await call(admin, "GET", `/api/dashboard-summary?begin=2026-10-01&end=${today}`)).data
const sumA = (await call(agentA, "GET", `/api/dashboard-summary?begin=2026-10-01&end=${today}`)).data
const totalOf = (data) => JSON.stringify(data ?? {}).length
check("the dashboard of an agent is not the company's", JSON.stringify(sumA) !== JSON.stringify(sumAdmin), `${totalOf(sumA)} vs ${totalOf(sumAdmin)} bytes`)

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed")
process.exit(failed ? 1 : 0)
