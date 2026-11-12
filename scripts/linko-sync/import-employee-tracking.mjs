// Отслеживание / Активность / Анализ маршрутов: who Linko tracks, and where it last saw them.
//
// 1. «Показывать в отслеживании» — Linko's track_the_plan, read from each employee's own card (raw employees_detail,
//    fetch.mjs step employee-details: the list answers leave the flag out) → employees.show_in_tracking. Linko's
//    Активность strip (market/agent/done_plan) and Анализ маршрутов (market/all_today_tasks) list exactly the active
//    employees with it on; Отслеживание (market/way) the ones with it on — deleted ones too — that have a live location.
//    An empty local login is filled from the card too (Linko lists those pages in login order).
// 2. The live locations (raw agents_location: market/agents_location) → field_live_locations: the position Linko keeps
//    per employee, its time (Tashkent wall clock → UTC) and the battery then. Linko's «last activity» in Отслеживание is
//    this time, not the last GPS point (they differ for a few employees) nor a visit.
//
//   node scripts/linko-sync/import-employee-tracking.mjs
import { connect, ensureRegistry, hasRaw, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("employee-tracking")
const client = await connect()
await ensureRegistry(client)
let flagChanges = 0
let loginFills = 0
let flagsSeen = 0
let liveRows = 0
const missing = []
try {
  await client.query("BEGIN")
  const employees = (await client.query("SELECT id, show_in_tracking, login FROM employees")).rows
  const local = new Map(employees.map((row) => [Number(row.id), Number(row.show_in_tracking)]))
  const localLogin = new Map(employees.map((row) => [Number(row.id), String(row.login ?? "").trim()]))

  if (hasRaw("employees_detail")) {
    for (const [id, card] of Object.entries(raw("employees_detail"))) {
      if (!card || typeof card !== "object" || typeof card.track_the_plan !== "boolean") continue
      flagsSeen++
      const employeeId = Number(id)
      if (!local.has(employeeId)) {
        missing.push(employeeId)
        continue
      }
      // A login left empty locally comes back from the card (Linko lists and orders employees by it).
      if (card.username && !localLogin.get(employeeId)) {
        await client.query("UPDATE employees SET login = $1 WHERE id = $2 AND login = ''", [card.username, employeeId])
        await register(client, run, "employees", employeeId, "update", { login: "" })
        loginFills++
      }
      const value = card.track_the_plan ? 1 : 0
      if (local.get(employeeId) === value) continue
      await client.query("UPDATE employees SET show_in_tracking = $1 WHERE id = $2", [value, employeeId])
      await register(client, run, "employees", employeeId, "update", { show_in_tracking: local.get(employeeId) })
      flagChanges++
    }
  } else console.log("employees_detail missing: run fetch.mjs employee-details first; flags left as they are")

  await client.query(`CREATE TABLE IF NOT EXISTS field_live_locations (
    employee_id INTEGER PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    located_at TIMESTAMPTZ,
    battery DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)
  for (const agent of raw("agents_location")) {
    const lat = Number(agent.location?.lat)
    const lng = Number(agent.location?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !local.has(Number(agent.id))) continue
    const previous = (await client.query("SELECT lat, lng, located_at, battery FROM field_live_locations WHERE employee_id = $1", [agent.id])).rows[0]
    await client.query(
      `INSERT INTO field_live_locations (employee_id, lat, lng, located_at, battery, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (employee_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, located_at = EXCLUDED.located_at,
         battery = EXCLUDED.battery, updated_at = now()`,
      [agent.id, lat, lng, agent.location_date ? utcIso(agent.location_date) : null, agent.battery == null ? null : Number(agent.battery)],
    )
    await register(client, run, "field_live_locations", agent.id, previous ? "update" : "insert", previous ?? null)
    liveRows++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`employee tracking: ${flagsSeen} cards, ${flagChanges} «Показывать в отслеживании» changed, ${loginFills} empty logins filled; ${liveRows} live locations; employees missing locally: ${missing.join(",") || "none"}`)
