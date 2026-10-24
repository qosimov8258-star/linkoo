import "server-only"

import { getDb } from "@/lib/db"

// Visit-level facts of the field agents (one row per visited client). They back
// "Анализ маршрутов", the dashboard attendance tiles / visits widget and the
// refusal ("Отказ") line of the sales tab. `agent_routes` keeps the per-day
// summary of the same visits.

declare global {
  var __linkoAgentVisitsSchema: Promise<void> | undefined
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  client_id INTEGER,
  visit_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'visit',
  refusal_type TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  planned INTEGER NOT NULL DEFAULT 1,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS agent_visits_date_idx ON agent_visits (visit_date, agent);
CREATE TABLE IF NOT EXISTS attendance_recalc_days (
  day TEXT PRIMARY KEY,
  day_off INTEGER NOT NULL DEFAULT 0,
  calculated_at TEXT NOT NULL DEFAULT ''
);
`

export function ensureAgentVisitsSchema() {
  globalThis.__linkoAgentVisitsSchema ??= getDb()
    .exec(SCHEMA_SQL)
    .catch((error) => {
      globalThis.__linkoAgentVisitsSchema = undefined
      throw error
    })
  return globalThis.__linkoAgentVisitsSchema
}

const pad = (n: number) => String(n).padStart(2, "0")
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A problem agent has been idle (no visit in progress) for longer than this. */
const PROBLEM_IDLE_MINUTES = 30
/**
 * Minutes after the first shift's start that still count as "on time". `agent_routes.check_in` holds the time of
 * the agent's first visit of the day, so the allowance covers the way to the first client.
 */
const LATE_GRACE_MINUTES = 60

export type RouteBoardAgent = {
  name: string
  firstVisit: string
  visited: number
  plan: number
  outside: number
  salesSum: number
  idleMinutes: number
  lastClient: string
  lastDurationSec: number
}

export type RoutesBoard = { date: string; problems: RouteBoardAgent[]; active: RouteBoardAgent[] }

type VisitRow = { agent: string; client: string; started_at: string; duration_sec: number; result: string; amount: number; planned: number }

export async function getRoutesBoard(date: string): Promise<RoutesBoard> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const visits = (await db
    .prepare("SELECT agent, client, started_at, duration_sec, result, amount, planned FROM agent_visits WHERE visit_date = ? ORDER BY agent, started_at")
    .all(date)) as VisitRow[]
  const plans = (await db.prepare("SELECT agent, plan_visits FROM agent_routes WHERE route_date = ?").all(date)) as { agent: string; plan_visits: number }[]
  const planByAgent = new Map(plans.map((row) => [row.agent, Number(row.plan_visits) || 0]))

  const byAgent = new Map<string, VisitRow[]>()
  for (const visit of visits) byAgent.set(visit.agent, [...(byAgent.get(visit.agent) ?? []), visit])

  const now = Date.now()
  const isToday = date === isoDay(new Date())
  const problems: RouteBoardAgent[] = []
  const active: RouteBoardAgent[] = []
  for (const [name, list] of byAgent) {
    const first = list[0]
    const last = list[list.length - 1]
    const lastEnd = new Date(last.started_at.replace(" ", "T")).getTime() + Number(last.duration_sec) * 1000
    const idleMinutes = isToday ? Math.max(0, Math.round((now - lastEnd) / 60000)) : 0
    const planned = list.filter((v) => v.planned)
    const agent: RouteBoardAgent = {
      name,
      firstVisit: first.started_at,
      visited: planned.length,
      plan: planByAgent.get(name) ?? planned.length,
      outside: list.length - planned.length,
      salesSum: list.reduce((sum, v) => sum + (v.result === "order" ? Number(v.amount) : 0), 0),
      idleMinutes,
      lastClient: last.client,
      lastDurationSec: Number(last.duration_sec),
    }
    ;(isToday && idleMinutes > PROBLEM_IDLE_MINUTES ? problems : active).push(agent)
  }
  problems.sort((a, b) => b.idleMinutes - a.idleMinutes)
  return { date, problems, active }
}

export type AttendanceUser = { name: string; onTime: number; late: number; absent: number; weekend: number }

export type FieldSummary = {
  attendance: { onTime: number; late: number; absent: number; weekend: number }
  users: AttendanceUser[]
  visits: { visited: number; effective: number; successPercent: number }
}

async function shiftThresholdMinutes(): Promise<number> {
  const row = (await getDb().prepare("SELECT begin_time FROM work_shifts ORDER BY begin_time ASC LIMIT 1").get()) as { begin_time?: string } | undefined
  const [h, m] = (row?.begin_time ?? "08:00:00").split(":").map(Number)
  return (h || 0) * 60 + (m || 0) + LATE_GRACE_MINUTES
}

/** Attendance (on time / late / absent / day off per agent-day) and the share of effective visits in a date range. */
export async function getFieldSummary(begin: string, end: string): Promise<FieldSummary> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const threshold = await shiftThresholdMinutes()
  const routes = (await db
    .prepare("SELECT agent, route_date, check_in, route_visited, route_effective, outside_visited, outside_effective FROM agent_routes WHERE route_date BETWEEN ? AND ?")
    .all(begin, end)) as { agent: string; route_date: string; check_in: string; route_visited: number; route_effective: number; outside_visited: number; outside_effective: number }[]

  let visited = 0
  let effective = 0
  for (const row of routes) {
    visited += Number(row.route_visited) + Number(row.outside_visited)
    effective += Number(row.route_effective) + Number(row.outside_effective)
  }

  // Everyone shown on the route board: active employees tracked in the field, plus agents that clocked in.
  // Counted per employee (two employees may share a name, like the reference's user_count), plus agents that
  // clocked in but are not tracked employees.
  const tracked = (await db
    .prepare("SELECT id, TRIM(first_name || ' ' || last_name) AS agent FROM employees WHERE active = 1 AND show_in_tracking = 1 ORDER BY 2, 1")
    .all()) as { id: number; agent: string }[]
  const clockedIn = (await db
    .prepare("SELECT DISTINCT agent FROM agent_routes WHERE check_in <> '' AND route_date BETWEEN ? AND ? ORDER BY 1")
    .all(begin, end)) as { agent: string }[]
  const known = new Set(tracked.map((row) => row.agent))
  const roster = [
    ...tracked.map((row) => ({ key: `e${row.id}`, agent: row.agent || `#${row.id}` })),
    ...clockedIn.filter((row) => !known.has(row.agent)).map((row) => ({ key: `n${row.agent}`, agent: row.agent })),
  ]
  const holidays = (await db.prepare("SELECT year, month, day FROM attendance_weekend_days").all()) as { year: number; month: number; day: number }[]
  const holidaySet = new Set(holidays.map((h) => `${h.year}-${pad(h.month + 1)}-${pad(h.day)}`))
  const byKey = new Map(routes.map((row) => [`${row.agent}|${row.route_date}`, row]))

  const users = new Map<string, AttendanceUser>(roster.map((row) => [row.key, { name: row.agent, onTime: 0, late: 0, absent: 0, weekend: 0 }]))
  const today = isoDay(new Date())
  const start = new Date(`${begin}T00:00:00`)
  const stop = new Date(`${end}T00:00:00`)
  // Like the reference, attendance is a snapshot taken by "Перерасчет": once any day has been recalculated only
  // those days count (each keeps the day-off verdict it was stored with). Without snapshots every finished day counts.
  const snapshot = (await db.prepare("SELECT day, day_off FROM attendance_recalc_days").all()) as { day: string; day_off: number }[]
  const snapshotDays = snapshot.length ? new Map(snapshot.map((row) => [row.day, Number(row.day_off) === 1])) : null
  for (let day = new Date(start), guard = 0; day <= stop && guard < 370; day.setDate(day.getDate() + 1), guard++) {
    const date = isoDay(day)
    if (!snapshotDays && date >= today) break // a day that is not over yet has no verdict
    if (snapshotDays && !snapshotDays.has(date)) continue
    const dayOff = snapshotDays ? Boolean(snapshotDays.get(date)) : day.getDay() === 0 || holidaySet.has(date)
    for (const user of users.values()) {
      if (dayOff) { user.weekend += 1; continue }
      const row = byKey.get(`${user.name}|${date}`)
      if (!row || !row.check_in) { user.absent += 1; continue }
      const [h, m] = row.check_in.split(":").map(Number)
      if (h * 60 + m <= threshold) user.onTime += 1
      else user.late += 1
    }
  }
  const list = [...users.values()].filter((u) => u.onTime + u.late + u.absent + u.weekend > 0)
  const total = (key: "onTime" | "late" | "absent" | "weekend") => list.reduce((sum, u) => sum + u[key], 0)
  return {
    attendance: { onTime: total("onTime"), late: total("late"), absent: total("absent"), weekend: total("weekend") },
    users: list,
    visits: { visited, effective, successPercent: visited > 0 ? Math.round((effective / visited) * 100) : 0 },
  }
}

/**
 * "Перерасчет": takes the attendance snapshot of a month. Every finished day of the month is stored with its
 * day-off verdict (Sunday or a marked weekend day); from then on only snapshot days count (see getFieldSummary).
 * Re-running refreshes the verdicts. Only attendance_recalc_days is written (INSERT … ON CONFLICT UPDATE).
 */
export async function recalcAttendance(year: number, month: number): Promise<{ days: number; from: string; to: string }> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const holidays = (await db.prepare("SELECT day FROM attendance_weekend_days WHERE year = ? AND month = ?").all(year, month)) as { day: number }[]
  const holidaySet = new Set(holidays.map((row) => Number(row.day)))
  const today = isoDay(new Date())
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ")
  let count = 0
  let from = ""
  let to = ""
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`
    if (date >= today) break // a day that is not over yet has no verdict
    const dayOff = new Date(year, month, day).getDay() === 0 || holidaySet.has(day) ? 1 : 0
    await db
      .prepare(
        "INSERT INTO attendance_recalc_days (day, day_off, calculated_at) VALUES (?, ?, ?) ON CONFLICT (day) DO UPDATE SET day_off = EXCLUDED.day_off, calculated_at = EXCLUDED.calculated_at RETURNING day", // explicit RETURNING: this table has no id column
      )
      .run(date, dayOff, stamp)
    from ||= date
    to = date
    count++
  }
  return { days: count, from, to }
}

/** Days of a month that carry an attendance verdict ("Перерасчет" snapshot); only these show absences. */
export async function getRecalcDays(year: number, month: number): Promise<number[]> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const first = `${year}-${pad(month + 1)}-01`
  const last = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`
  const rows = (await db.prepare("SELECT day FROM attendance_recalc_days WHERE day BETWEEN ? AND ? ORDER BY day").all(first, last)) as { day: string }[]
  return rows.map((row) => Number(String(row.day).slice(8, 10)))
}

/** Visits that ended in a refusal, per day ("Отказ" line of the sales tab). */
export async function countRefusalsByDay(begin: string, end: string, filters: { agents?: string[]; clientIds?: number[] } = {}): Promise<Map<string, number>> {
  await ensureAgentVisitsSchema()
  const params: unknown[] = [begin, end]
  let where = "visit_date BETWEEN ? AND ? AND result = 'refusal'"
  if (filters.agents?.length) {
    where += ` AND agent IN (${filters.agents.map(() => "?").join(",")})`
    params.push(...filters.agents)
  }
  if (filters.clientIds) {
    if (!filters.clientIds.length) return new Map()
    where += ` AND client_id IN (${filters.clientIds.map(() => "?").join(",")})`
    params.push(...filters.clientIds)
  }
  const rows = (await getDb().prepare(`SELECT visit_date, COUNT(*) AS n FROM agent_visits WHERE ${where} GROUP BY visit_date`).all(...params)) as { visit_date: string; n: number | string }[]
  return new Map(rows.map((row) => [row.visit_date, Number(row.n)]))
}

export type VisitStatRow = {
  name: string
  firstVisit: string
  lastVisit: string
  plan: number
  visited: number
  outside: number
  orders: number
  refusals: number
  notVisited: number
  akb: number
  routeCompletion: number
  sales: number
}

/** Per-agent visit statistics of a date range ("Визиты агента по филиалам"). */
export async function getVisitStats(begin: string, end: string): Promise<{ agents: VisitStatRow[]; problems: number }> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const sums = (await db
    .prepare(
      `SELECT agent, SUM(plan_visits) AS plan, SUM(route_visited) AS visited, SUM(outside_visited) AS outside,
              SUM(route_effective + outside_effective) AS orders, SUM(route_refused + outside_refused) AS refusals,
              SUM(route_sales + outside_sales) AS sales
       FROM agent_routes WHERE route_date BETWEEN ? AND ? GROUP BY agent`,
    )
    .all(begin, end)) as Record<string, string | number>[]
  const times = (await db
    .prepare(
      `SELECT agent, MIN(started_at) AS first, MAX(started_at) AS last,
              COUNT(DISTINCT CASE WHEN result = 'order' THEN client_id END) AS akb
       FROM agent_visits WHERE visit_date BETWEEN ? AND ? GROUP BY agent`,
    )
    .all(begin, end)) as Record<string, string | number>[]
  const timeByAgent = new Map(times.map((row) => [String(row.agent), row]))
  const clock = (stamp: unknown) => {
    const text = String(stamp ?? "")
    if (!text) return ""
    return begin === end ? text.slice(11, 16) : `${text.slice(8, 10)}.${text.slice(5, 7)} ${text.slice(11, 16)}`
  }
  const agents = sums
    .filter((row) => ["plan", "visited", "outside", "orders", "refusals", "sales"].some((key) => Number(row[key]) > 0) || timeByAgent.has(String(row.agent)))
    .map((row): VisitStatRow => {
      const time = timeByAgent.get(String(row.agent))
      const plan = Number(row.plan) || 0
      const visited = Number(row.visited) || 0
      return {
        name: String(row.agent),
        firstVisit: clock(time?.first),
        lastVisit: clock(time?.last),
        plan,
        visited,
        outside: Number(row.outside) || 0,
        orders: Number(row.orders) || 0,
        refusals: Number(row.refusals) || 0,
        notVisited: Math.max(plan - visited, 0),
        akb: Number(time?.akb) || 0,
        routeCompletion: plan > 0 ? Math.round((visited / plan) * 100) : 0,
        sales: Number(row.sales) || 0,
      }
    })
    .sort((a, b) => b.sales - a.sales)
  const today = isoDay(new Date())
  const problems = begin <= today && today <= end ? (await getRoutesBoard(today)).problems.length : 0
  return { agents, problems }
}

export type ClientVisit = { agent: string; startedAt: string; durationSec: number; result: string; refusal: string; planned: boolean }

/** Visits of one client that did not produce an order (order visits are shown as orders), newest first. */
export async function listClientVisits(client: string, limit = 40): Promise<ClientVisit[]> {
  await ensureAgentVisitsSchema()
  const rows = (await getDb()
    .prepare("SELECT agent, started_at, duration_sec, result, refusal_type, planned FROM agent_visits WHERE client = ? AND order_id IS NULL ORDER BY started_at DESC LIMIT ?")
    .all(client, limit)) as { agent: string; started_at: string; duration_sec: number; result: string; refusal_type: string; planned: number }[]
  return rows.map((row) => ({ agent: row.agent, startedAt: row.started_at, durationSec: Number(row.duration_sec), result: row.result, refusal: row.refusal_type, planned: !!row.planned }))
}

/** Clock-in verdict per agent and day of a month: "on" = on time, "late" = after the shift start + grace. */
export async function getAttendanceMonth(year: number, month: number): Promise<Record<string, Record<number, "on" | "late">>> {
  await ensureAgentVisitsSchema()
  const threshold = await shiftThresholdMinutes()
  const prefix = `${year}-${pad(month + 1)}-`
  const rows = (await getDb()
    .prepare("SELECT agent, route_date, check_in FROM agent_routes WHERE route_date LIKE ? AND check_in <> ''")
    .all(`${prefix}%`)) as { agent: string; route_date: string; check_in: string }[]
  const result: Record<string, Record<number, "on" | "late">> = {}
  for (const row of rows) {
    const [h, m] = row.check_in.split(":").map(Number)
    const day = Number(row.route_date.slice(8, 10))
    ;(result[row.agent] ??= {})[day] = h * 60 + m <= threshold ? "on" : "late"
  }
  return result
}


export type WorkTimeRow = {
  agent: string
  date: string
  first: string
  last: string
  totalSec: number
  storeSec: number
  plan: number
  visitedPlan: number
  visitedOutside: number
  notVisited: number
  akb: number
  sales: number
}

/** Per agent and day: first/last activity, time spent in stores and visit counts ("Время работы агента"). */
export async function getWorkTime(begin: string, end: string): Promise<WorkTimeRow[]> {
  await ensureAgentVisitsSchema()
  const db = getDb()
  const visits = (await db
    .prepare(
      `SELECT agent, visit_date, started_at, duration_sec, result, planned, client_id, amount
         FROM agent_visits WHERE visit_date BETWEEN ? AND ? ORDER BY agent, visit_date, started_at`,
    )
    .all(begin, end)) as Record<string, string | number>[]
  const plans = (await db
    .prepare(`SELECT agent, route_date, SUM(plan_visits) AS plan FROM agent_routes WHERE route_date BETWEEN ? AND ? GROUP BY agent, route_date`)
    .all(begin, end)) as Record<string, string | number>[]
  const planOf = new Map(plans.map((row) => [`${row.agent}|${row.route_date}`, Number(row.plan) || 0]))
  const stamp = (value: unknown) => new Date(String(value).replace(" ", "T")).getTime()
  const days = new Map<string, Record<string, string | number>[]>()
  for (const visit of visits) {
    const key = `${visit.agent}|${visit.visit_date}`
    days.set(key, [...(days.get(key) ?? []), visit])
  }
  return [...days.entries()].map(([key, list]) => {
    const [agent, date] = key.split("|")
    const starts = list.map((visit) => stamp(visit.started_at))
    const ends = list.map((visit) => stamp(visit.started_at) + (Number(visit.duration_sec) || 0) * 1000)
    const storeSec = list.reduce((sum, visit) => sum + (Number(visit.duration_sec) || 0), 0)
    const totalSec = Math.round((Math.max(...ends) - Math.min(...starts)) / 1000)
    const visitedPlan = list.filter((visit) => Number(visit.planned) === 1).length
    const plan = planOf.get(key) ?? visitedPlan
    return {
      agent,
      date,
      first: String(list[0].started_at).slice(11, 16),
      last: String(list[list.length - 1].started_at).slice(11, 16),
      totalSec: Math.max(totalSec, storeSec),
      storeSec,
      plan,
      visitedPlan,
      visitedOutside: list.length - visitedPlan,
      notVisited: Math.max(plan - visitedPlan, 0),
      akb: new Set(list.filter((visit) => visit.result === "order").map((visit) => visit.client_id)).size,
      sales: list.reduce((sum, visit) => sum + (Number(visit.amount) || 0), 0),
    }
  })
}
