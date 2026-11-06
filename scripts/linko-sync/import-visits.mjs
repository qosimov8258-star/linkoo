// Visits of the Linko account into field_visits (Активность, Визиты агента / по дням, Системная дистрибуция,
// Время работы агента, Время нахождения в магазинах, the client's visits, the day status of Отслеживание).
//
// Linko offers no list of its visit records over its read API. What it does give:
//  - the timed visits (stats/dynamic market_service_time per agent: start, end, where the agent stood, where the client
//    is, the distance, on / off the route) → one field visit each (raw file visit_sessions);
//  - the orders, refusals and photo reports, each made during a visit: Linko counts a visit for every client and day an
//    agent made one of them (its "Визиты по дням" = these client-days). A client-day of those events without a timed
//    visit becomes one field visit at its first event, without a measured stay (finished = started), so it counts as
//    a visit but adds no time at the client (Время работы агента) and is not a stay (Время нахождения в магазинах).
// The result is the best thing that happened: an order → 'order' (Linko counts a visit with an order as
// "Результативно" even when the order was cancelled later; the linked order is the first one still standing), else a
// refusal, else a photo report, else 'no_sale' (Linko: a visit without an order is "Отказано"). The refusals and photo reports
// are linked to their visit (field_refusals / field_photo_reports .visit_id, one each).
// Imported visits carry client_key 'linko:…'; a re-run replaces them (local app visits are never touched).
//
//   node scripts/linko-sync/import-visits.mjs        (raw: visit_sessions, orders, rejections, merch_reports)
import { connect, ensureRegistry, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("visits")
const sessions = raw("visit_sessions")
const orders = raw("orders")
const rejections = raw("rejections")
const reports = raw("merch_reports")

/** Linko order statuses that are not a sale: 4 = cancelled, 5 = not confirmed. */
const NOT_SOLD = new Set(["4", "5"])
const DAY_MS = 24 * 3600_000

const ms = (local) => new Date(utcIso(local)).getTime()
const groups = new Map()
const groupOf = (employeeId, clientId, day) => {
  const key = `${employeeId}|${clientId}|${day}`
  let group = groups.get(key)
  if (!group) groups.set(key, (group = { employeeId, clientId, day, sessions: [], orders: [], refusals: [], reports: [] }))
  return group
}

for (const s of sessions) {
  const startLocal = `${s.date}T${s.start_time}`
  const startMs = ms(startLocal)
  // Linko gives the end as a time of day; its total minutes tell on which day the visit ended (some ran for days).
  let endMs = ms(`${s.date}T${s.end_time || s.start_time}`)
  const days = Math.round((Number(s.total_time) * 60_000 - (endMs - startMs)) / DAY_MS)
  if (Number.isFinite(days)) endMs += days * DAY_MS
  if (endMs <= startMs) endMs += DAY_MS
  const [factLat, factLng] = String(s.fact_location ?? "").split(",").map((v) => Number(v.trim()))
  const [clientLat, clientLng] = String(s.market_location ?? "").split(",").map((v) => Number(v.trim()))
  groupOf(Number(s.user_id), Number(s.market_id), s.date).sessions.push({
    startMs,
    endMs,
    factLat: Number.isFinite(factLat) ? factLat : null,
    factLng: Number.isFinite(factLng) ? factLng : null,
    clientLat: Number.isFinite(clientLat) ? clientLat : null,
    clientLng: Number.isFinite(clientLng) ? clientLng : null,
    distance: Number.isFinite(Number(s.distance)) ? Number(s.distance) : null,
    planned: s.is_in_plan === "Да",
    label: `${s.date}T${s.start_time}`,
    events: [],
  })
}
for (const o of orders) {
  if (!o.user?.id || !o.market?.id) continue
  groupOf(Number(o.user.id), Number(o.market.id), o.created_date.slice(0, 10)).orders.push({ id: Number(o.id), at: ms(o.created_date), sold: !NOT_SOLD.has(String(o.status)) })
}
for (const r of rejections) {
  if (!r.user?.id || !r.market?.id) continue
  groupOf(Number(r.user.id), Number(r.market.id), r.created_date.slice(0, 10)).refusals.push({ id: Number(r.id), at: ms(r.created_date) })
}
for (const p of reports) {
  if (!p.user?.id || !p.market?.id) continue
  groupOf(Number(p.user.id), Number(p.market.id), p.created_date.slice(0, 10)).reports.push({ id: Number(p.id), at: ms(p.created_date) })
}

const client = await connect()
await ensureRegistry(client)
const stats = { sessions: 0, fromEvents: 0, results: {}, skippedEmployees: new Set() }
try {
  await client.query("BEGIN")
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  const clientPos = new Map(
    (await client.query("SELECT id, location_lat, location_lng FROM clients")).rows.map((row) => [Number(row.id), { lat: row.location_lat == null ? null : Number(row.location_lat), lng: row.location_lng == null ? null : Number(row.location_lng) }]),
  )
  const plans = new Map(
    (await client.query("SELECT employee_id, client_id, weekdays FROM field_route_plans")).rows.map((row) => [`${row.employee_id}|${row.client_id}`, Number(row.weekdays)]),
  )
  const isoDow = (day) => {
    const d = new Date(`${day}T00:00:00Z`).getUTCDay()
    return d === 0 ? 7 : d
  }
  const plannedOn = (employeeId, clientId, day) => ((plans.get(`${employeeId}|${clientId}`) ?? 0) & (1 << (isoDow(day) - 1))) !== 0

  // Replace the visits of an earlier run (and their links).
  await client.query("UPDATE field_refusals SET visit_id = NULL WHERE visit_id IN (SELECT id FROM field_visits WHERE client_key LIKE 'linko:%')")
  await client.query("UPDATE field_photo_reports SET visit_id = NULL WHERE visit_id IN (SELECT id FROM field_visits WHERE client_key LIKE 'linko:%')")
  const removed = (await client.query("DELETE FROM field_visits WHERE client_key LIKE 'linko:%'")).rowCount

  const insertVisit = async (v) => {
    const row = (
      await client.query(
        `INSERT INTO field_visits (client_key, user_id, employee_id, client_id, started_at, start_lat, start_lng, finished_at, end_lat, end_lng,
           result, order_id, comment, planned, client_lat, client_lng, distance_m, created_at, updated_at)
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $5, $6, $8, $9, '', $10, $11, $12, $13, $7, $7) RETURNING id`,
        [v.key, v.employeeId, v.clientId, new Date(v.startMs).toISOString(), v.lat, v.lng, new Date(v.endMs).toISOString(), v.result, v.orderId, v.planned, v.clientLat, v.clientLng, v.distance],
      )
    ).rows[0]
    stats.results[v.result] = (stats.results[v.result] ?? 0) + 1
    return Number(row.id)
  }
  const resultOf = (events) => {
    const made = [...events.orders].sort((a, b) => Number(b.sold) - Number(a.sold) || a.at - b.at)
    if (made.length) return { result: "order", orderId: made[0].id }
    if (events.refusals.length) return { result: "refusal", orderId: null }
    if (events.reports.length) return { result: "photo_report", orderId: null }
    return { result: "no_sale", orderId: null }
  }
  const link = async (visitId, events) => {
    const refusal = [...events.refusals].sort((a, b) => a.at - b.at)[0]
    if (refusal) await client.query("UPDATE field_refusals SET visit_id = $1 WHERE id = $2 AND visit_id IS NULL", [visitId, refusal.id])
    const report = [...events.reports].sort((a, b) => a.at - b.at)[0]
    if (report) await client.query("UPDATE field_photo_reports SET visit_id = $1 WHERE id = $2 AND visit_id IS NULL", [visitId, report.id])
  }

  for (const group of groups.values()) {
    if (!employees.has(group.employeeId)) {
      stats.skippedEmployees.add(group.employeeId)
      continue
    }
    const pos = clientPos.get(group.clientId) ?? { lat: null, lng: null }
    const events = [...group.orders.map((e) => ({ ...e, kind: "orders" })), ...group.refusals.map((e) => ({ ...e, kind: "refusals" })), ...group.reports.map((e) => ({ ...e, kind: "reports" }))]
    if (group.sessions.length) {
      // Every event of the client-day joins the timed visit it happened in, else the nearest one.
      const list = group.sessions.sort((a, b) => a.startMs - b.startMs)
      for (const s of list) s.events = { orders: [], refusals: [], reports: [] }
      for (const event of events) {
        const inside = list.find((s) => event.at >= s.startMs - 60_000 && event.at <= s.endMs + 60_000)
        const nearest = inside ?? list.reduce((best, s) => (Math.min(Math.abs(event.at - s.startMs), Math.abs(event.at - s.endMs)) < Math.min(Math.abs(event.at - best.startMs), Math.abs(event.at - best.endMs)) ? s : best), list[0])
        nearest.events[event.kind].push(event)
      }
      for (const s of list) {
        const { result, orderId } = resultOf(s.events)
        const id = await insertVisit({
          key: `linko:session:${s.label}:${group.clientId}`,
          employeeId: group.employeeId,
          clientId: group.clientId,
          startMs: s.startMs,
          endMs: s.endMs,
          lat: s.factLat,
          lng: s.factLng,
          result,
          orderId,
          planned: s.planned,
          clientLat: s.clientLat ?? pos.lat,
          clientLng: s.clientLng ?? pos.lng,
          distance: s.distance,
        })
        await link(id, s.events)
        stats.sessions++
      }
      continue
    }
    const times = events.map((e) => e.at).sort((a, b) => a - b)
    const { result, orderId } = resultOf(group)
    const id = await insertVisit({
      key: `linko:visit:${group.day}:${group.clientId}`,
      employeeId: group.employeeId,
      clientId: group.clientId,
      startMs: times[0],
      endMs: times[0],
      lat: null,
      lng: null,
      result,
      orderId,
      planned: plannedOn(group.employeeId, group.clientId, group.day),
      clientLat: pos.lat,
      clientLng: pos.lng,
      distance: null,
    })
    await link(id, group)
    stats.fromEvents++
  }
  await register(client, run, "field_visits", "linko:*", "replace", { removed, sessions: stats.sessions, fromEvents: stats.fromEvents })
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `visits: ${sessions.length} timed visits + events of ${groups.size} client-days → ${stats.sessions} timed, ${stats.fromEvents} from orders / refusals / reports;`,
  JSON.stringify(stats.results),
  stats.skippedEmployees.size ? `employees missing: ${[...stats.skippedEmployees].join(",")}` : "",
)
