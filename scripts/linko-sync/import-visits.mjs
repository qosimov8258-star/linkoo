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
// Imported visits carry client_key 'linko:…'. A re-run keeps each one's id (matched by employee and key), updates what
// changed, removes the ones it no longer makes and leaves links that are already right alone, so a run that changes
// nothing writes nothing (local app visits are never touched).
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

  // The visits of an earlier run, by employee and key: kept under their ids.
  const earlier = new Map((await client.query("SELECT * FROM field_visits WHERE client_key LIKE 'linko:%'")).rows.map((row) => [`${row.employee_id}|${row.client_key}`, row]))
  const kept = new Set()
  const changes = { insert: 0, update: 0, removed: 0, links: 0 }
  const sameValue = (a, b) => {
    if (a == null || b == null) return a == null && b == null
    if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime()
    if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-9
    return String(a) === String(b)
  }

  const insertVisit = async (v) => {
    const at = (time) => new Date(time).toISOString()
    const values = {
      user_id: 0,
      employee_id: v.employeeId,
      client_id: v.clientId,
      started_at: at(v.startMs),
      start_lat: v.lat,
      start_lng: v.lng,
      finished_at: at(v.endMs),
      end_lat: v.lat,
      end_lng: v.lng,
      result: v.result,
      order_id: v.orderId,
      comment: "",
      planned: v.planned,
      client_lat: v.clientLat,
      client_lng: v.clientLng,
      distance_m: v.distance,
      created_at: at(v.endMs),
      updated_at: at(v.endMs),
    }
    stats.results[v.result] = (stats.results[v.result] ?? 0) + 1
    const columns = Object.keys(values)
    const current = earlier.get(`${v.employeeId}|${v.key}`)
    if (current) {
      kept.add(Number(current.id))
      const changed = columns.filter((column) => !sameValue(current[column], values[column]))
      if (changed.length) {
        await client.query(`UPDATE field_visits SET ${changed.map((column, i) => `${column} = $${i + 2}`).join(", ")} WHERE id = $1`, [current.id, ...changed.map((column) => values[column])])
        changes.update++
      }
      return Number(current.id)
    }
    const row = (
      await client.query(`INSERT INTO field_visits (client_key, ${columns.join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`, [
        v.key,
        ...columns.map((column) => values[column]),
      ])
    ).rows[0]
    changes.insert++
    kept.add(Number(row.id))
    return Number(row.id)
  }
  const resultOf = (events) => {
    const made = [...events.orders].sort((a, b) => Number(b.sold) - Number(a.sold) || a.at - b.at)
    if (made.length) return { result: "order", orderId: made[0].id }
    if (events.refusals.length) return { result: "refusal", orderId: null }
    if (events.reports.length) return { result: "photo_report", orderId: null }
    return { result: "no_sale", orderId: null }
  }
  // The refusal / photo report each visit links (the first one of its events; the first visit wins), written once every
  // visit is in place.
  const wantedLinks = { field_refusals: new Map(), field_photo_reports: new Map() }
  const link = async (visitId, events) => {
    const refusal = [...events.refusals].sort((a, b) => a.at - b.at)[0]
    if (refusal && !wantedLinks.field_refusals.has(refusal.id)) wantedLinks.field_refusals.set(refusal.id, visitId)
    const report = [...events.reports].sort((a, b) => a.at - b.at)[0]
    if (report && !wantedLinks.field_photo_reports.has(report.id)) wantedLinks.field_photo_reports.set(report.id, visitId)
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
  // Links: a row linked to an imported visit (or to none) gets the one this run wants; links to the app's own visits stay.
  const imported = "SELECT id FROM field_visits WHERE client_key LIKE 'linko:%'"
  for (const [table, wanted] of Object.entries(wantedLinks)) {
    for (const row of (await client.query(`SELECT id, visit_id FROM ${table} WHERE visit_id IN (${imported})`)).rows) {
      if (wanted.get(Number(row.id)) === Number(row.visit_id)) continue
      await client.query(`UPDATE ${table} SET visit_id = NULL WHERE id = $1`, [row.id])
      if (!wanted.has(Number(row.id))) changes.links++
    }
    for (const [id, visitId] of wanted) {
      changes.links += (await client.query(`UPDATE ${table} SET visit_id = $1 WHERE id = $2 AND visit_id IS NULL`, [visitId, id])).rowCount
    }
  }
  // The imported visits this run no longer makes (nothing links them any more).
  const gone = [...earlier.values()].map((row) => Number(row.id)).filter((id) => !kept.has(id))
  if (gone.length) changes.removed = (await client.query("DELETE FROM field_visits WHERE id = ANY($1::int[])", [gone])).rowCount
  stats.changes = changes
  if (changes.insert || changes.update || changes.removed || changes.links) {
    await register(client, run, "field_visits", "linko:*", "replace", { ...changes, sessions: stats.sessions, fromEvents: stats.fromEvents })
  }
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
  JSON.stringify(stats.changes ?? {}),
  stats.skippedEmployees.size ? `employees missing: ${[...stats.skippedEmployees].join(",")}` : "",
)
