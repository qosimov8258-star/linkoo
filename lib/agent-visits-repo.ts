import "server-only"

import { listAttendance } from "@/lib/attendance-repo"
import { ensureAttendanceSchema } from "@/lib/attendance-schema"
import type { AttendanceType } from "@/lib/attendance-types"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { fieldEventTotals, listFieldEvents } from "@/lib/field-activity/events"
import { lastLocations } from "@/lib/field-activity/gps-repo"
import { addDays, dayStartMs, haversineMeters } from "@/lib/field-activity/input"
import { dayStatus, plannedClients, PLANNED_ON_DAY_SQL } from "@/lib/field-activity/routes-repo"
import { columnsOf, ensureFieldSchema } from "@/lib/field-activity/schema"
import { MAX_PAGE_SIZE, MAX_VISIT_MS } from "@/lib/field-activity/types"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { isIsoDay, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Analytics of the field agents' visits and of the work attendance: "Анализ маршрутов", the
// dashboard attendance tiles and visits widget, the "Отказ" line of the sales tab, the visit
// reports (Визиты агента, Визиты по дням, Системная дистрибуция, Время работы агента) and the
// client's visit history.
//
// There is ONE source of truth and this module only reads it:
// - visits, refusals and planned routes: lib/field-activity/** (field_visits, field_refusals,
//   field_route_plans), the same data as Активность and Отслеживание;
// - sales: the order events of lib/field-activity/events.ts (counted orders, in the base currency);
//   Время работы агента reads the documents themselves (orders, deliveries, customer payments, client
//   returns: the tasks of Linko's day plan, at their own moments and days — see that section);
// - attendance: Посещаемость (lib/attendance-repo.ts, /api/work-attendance).
// Agents are employees, identified by employees.id. This module has no tables of its own; the
// older agent_visits / agent_routes / attendance_recalc_days tables of existing databases are left
// as they are and are no longer read.
//
// Days are local Asia/Tashkent days ("YYYY-MM-DD"). A planned visit counts on the days up to today
// (a plan of a future day is not "not visited" yet), always by the current route plans, like the
// day status of Отслеживание.

const DAY_MS = 24 * 60 * 60_000
/** A problem agent has been idle (no visit in progress) for longer than this today. */
const PROBLEM_IDLE_MINUTES = 30

/** Local (Asia/Tashkent, UTC+5) timestamp of a timestamptz expression. */
const local = (expr: string) => `((${expr}) AT TIME ZONE 'UTC') + interval '5 hours'`
const LOCAL_TEXT = `'YYYY-MM-DD"T"HH24:MI:SS'`

/** Instants of the local period [from, to] (both inclusive). */
function utcBounds(from: string, to: string) {
  return { fromUtc: new Date(dayStartMs(from)).toISOString(), toUtc: new Date(dayStartMs(to) + DAY_MS).toISOString() }
}

/** "YYYY-MM-DDTHH:mm:ss" → "HH:mm". */
const clock = (stamp: string | null | undefined) => (stamp ? stamp.slice(11, 16) : "")

const nameOf = (row: { first_name: string | null; last_name: string | null }) =>
  `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim()

// ---------------------------------------------------------------------------
// Facts: planned / visited clients per employee and day, and the counted orders
// ---------------------------------------------------------------------------

/** One client of one employee on one day: planned by the route, visited, or both. */
export type ClientDay = {
  employeeId: number
  day: string
  clientId: number
  planned: boolean
  /** The route plan (field_route_plans.id) that put the client on the day. */
  planId: number | null
  /** Visits started that day (0 = planned but not visited). */
  visits: number
  /** A visit ended with an order. */
  effective: boolean
  /** A visit ended with a refusal. */
  refused: boolean
  /** A visit is still going on. */
  open: boolean
  /** Local "YYYY-MM-DDTHH:mm:ss" of the first visit start / the last visit end (start while open). */
  firstStart: string | null
  lastEnd: string | null
  /** Seconds spent at the client (an open visit counts until now, at most 24 h). */
  storeSec: number
}

/** A period of local days the reports accept: real days of 2000..2100, from ≤ to, at most 366 days
 * (FieldError 400 otherwise; GET /api/agent-visits checks it first with periodParams). */
function checkPeriod(from: string, to: string) {
  const day = (value: string) => isIsoDay(value) && Number(value.slice(0, 4)) >= DOC_MIN_YEAR && Number(value.slice(0, 4)) <= DOC_MAX_YEAR
  if (!day(from)) throw new FieldError("Неверная дата", 400, { field: "from" })
  if (!day(to)) throw new FieldError("Неверная дата", 400, { field: "to" })
  if (from > to) throw new FieldError(FIELD_MESSAGES.badRange, 400, { field: "from" })
  if (dayStartMs(to) - dayStartMs(from) > 366 * DAY_MS) throw new FieldError(FIELD_MESSAGES.rangeTooLong, 400, { field: "from" })
}

/** The planned and the visited clients of each employee and day of the period. */
export async function clientDays(from: string, to: string, employeeIds?: number[]): Promise<ClientDay[]> {
  checkPeriod(from, to)
  if (employeeIds && !employeeIds.length) return []
  await ensureFieldSchema()
  const today = todayIso()
  const only = (alias: string) => (employeeIds ? `AND ${alias}.employee_id = ANY(@employeeIds::int[])` : "")
  const plannedOn = PLANNED_ON_DAY_SQL.split("@day::date").join("days.day")
  const rows = (await getDb()
    .prepare(
      `WITH days AS (
         SELECT d::date AS day FROM generate_series(@from::date, @planTo::date, interval '1 day') AS d
       ),
       plan AS (
         SELECT rp.employee_id, days.day, rp.client_id, MIN(rp.id) AS plan_id
           FROM field_route_plans rp
           JOIN clients c ON c.id = rp.client_id
           JOIN employees e ON e.id = rp.employee_id AND e.active = 1
           JOIN days ON ${plannedOn}
          WHERE true ${only("rp")}
          GROUP BY 1, 2, 3
       ),
       vis AS (
         SELECT v.employee_id, (${local("v.started_at")})::date AS day, v.client_id,
                COUNT(*)::int AS visits,
                bool_or(v.result = 'order') AS effective,
                bool_or(v.result = 'refusal') AS refused,
                bool_or(v.finished_at IS NULL) AS open,
                MIN(${local("v.started_at")}) AS first_start,
                MAX(${local("COALESCE(v.finished_at, v.started_at)")}) AS last_end,
                SUM(EXTRACT(EPOCH FROM (COALESCE(v.finished_at, LEAST(now(), v.started_at + interval '24 hours')) - v.started_at)))::float8 AS store_sec
           FROM field_visits v
          WHERE v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz ${only("v")}
          GROUP BY 1, 2, 3
       )
       SELECT COALESCE(p.employee_id, v.employee_id) AS employee_id,
              to_char(COALESCE(p.day, v.day), 'YYYY-MM-DD') AS day,
              COALESCE(p.client_id, v.client_id) AS client_id,
              (p.client_id IS NOT NULL) AS planned,
              p.plan_id,
              COALESCE(v.visits, 0) AS visits,
              COALESCE(v.effective, false) AS effective,
              COALESCE(v.refused, false) AS refused,
              COALESCE(v.open, false) AS open,
              to_char(v.first_start, ${LOCAL_TEXT}) AS first_start,
              to_char(v.last_end, ${LOCAL_TEXT}) AS last_end,
              COALESCE(v.store_sec, 0) AS store_sec
         FROM plan p
         FULL OUTER JOIN vis v ON v.employee_id = p.employee_id AND v.day = p.day AND v.client_id = p.client_id`,
    )
    .all({ from, planTo: to < today ? to : today, ...utcBounds(from, to), employeeIds: employeeIds ?? [] })) as Array<{
    employee_id: number
    day: string
    client_id: number
    planned: boolean
    plan_id: number | null
    visits: number
    effective: boolean
    refused: boolean
    open: boolean
    first_start: string | null
    last_end: string | null
    store_sec: number
  }>
  return rows.map((row) => ({
    employeeId: Number(row.employee_id),
    day: row.day,
    clientId: Number(row.client_id),
    planned: Boolean(row.planned),
    planId: row.plan_id === null || row.plan_id === undefined ? null : Number(row.plan_id),
    visits: Number(row.visits) || 0,
    effective: Boolean(row.effective),
    refused: Boolean(row.refused),
    open: Boolean(row.open),
    firstStart: row.first_start ?? null,
    lastEnd: row.last_end ?? null,
    storeSec: Math.max(0, Math.round(Number(row.store_sec) || 0)),
  }))
}

/** A counted (not cancelled / unconfirmed) order of an employee, valued in the base currency. */
type OrderFact = { employeeId: number; day: string; clientId: number | null; clientKey: string; amountBase: number }

/** The counted orders of the period, from the same event stream as Активность (every page of it). */
async function orderFacts(from: string, to: string, employeeIds?: number[]): Promise<{ baseCurrency: string; orders: OrderFact[] }> {
  checkPeriod(from, to)
  const query = { from, to, kinds: ["order" as const], excludeCancelled: true, onlyAttributed: true, employeeIds }
  const orders: OrderFact[] = []
  let baseCurrency = ""
  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const page = await listFieldEvents(query, { limit: MAX_PAGE_SIZE, offset })
    baseCurrency = page.baseCurrency
    for (const event of page.rows) {
      if (event.employeeId === null) continue
      orders.push({
        employeeId: event.employeeId,
        day: event.day,
        clientId: event.clientId,
        clientKey: event.clientId !== null ? `id:${event.clientId}` : `name:${event.clientName.trim().toLowerCase()}`,
        amountBase: event.amountBase ?? 0,
      })
    }
    if (!page.rows.length || offset + page.rows.length >= page.count) break
  }
  return { baseCurrency, orders }
}

const factKey = (employeeId: number, day: string, clientId: number | null) => `${employeeId}|${day}|${clientId ?? ""}`

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

type AgentInfo = { employeeId: number; name: string; position: string; branch: string; supervisorId: number | null; supervisor: string }

/** The supervisor id stored on the employee card (employees.details.supervisorId). */
function supervisorIdOf(details: string | null): number | null {
  try {
    const value = (JSON.parse(details || "{}") as { supervisorId?: unknown }).supervisorId
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

async function agentInfo(ids: number[]): Promise<Map<number, AgentInfo>> {
  const result = new Map<number, AgentInfo>()
  if (!ids.length) return result
  const db = getDb()
  type Row = { id: number; first_name: string | null; last_name: string | null; position: string | null; branch: string | null; details: string | null }
  // employees.details (the card's JSON: supervisor, …) is added by the Сотрудники module; a database without it has no supervisors.
  const withDetails = Boolean((await columnsOf(["employees"])).get("employees")?.has("details"))
  const rows = (await db
    .prepare(`SELECT id, first_name, last_name, position, branch, ${withDetails ? "details" : "NULL AS details"} FROM employees WHERE id = ANY(@ids::int[])`)
    .all({ ids })) as Row[]
  const supervisorIds = [...new Set(rows.map((row) => supervisorIdOf(row.details)).filter((id): id is number => id !== null))]
  const supervisors = supervisorIds.length
    ? ((await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = ANY(@ids::int[])").all({ ids: supervisorIds })) as Row[])
    : []
  const supervisorName = new Map(supervisors.map((row) => [Number(row.id), nameOf(row)]))
  for (const row of rows) {
    const supervisorId = supervisorIdOf(row.details)
    const known = supervisorId !== null && supervisorName.has(supervisorId)
    result.set(Number(row.id), {
      employeeId: Number(row.id),
      name: nameOf(row) || `#${row.id}`,
      position: String(row.position ?? ""),
      branch: String(row.branch ?? ""),
      supervisorId: known ? supervisorId : null,
      supervisor: known ? supervisorName.get(supervisorId!)! : "",
    })
  }
  return result
}

/** ОКБ: the clients (not closed) whose responsible agent is the employee (clients.agent by name key). */
async function baseClients(ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map()
  const db = getDb()
  await ensureFinanceSchema(db)
  const rows = (await db
    .prepare(
      `SELECT ek.id AS employee_id, COUNT(*)::int AS n
         FROM clients c
         JOIN (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1) ek
           ON ek.k <> '' AND ek.k = fin_key(c.agent)
        WHERE COALESCE(c.tab, '') <> 'closing' AND ek.id = ANY(@ids::int[])
        GROUP BY 1`,
    )
    .all({ ids })) as Array<{ employee_id: number; n: number }>
  return new Map(rows.map((row) => [Number(row.employee_id), Number(row.n)]))
}

// ---------------------------------------------------------------------------
// Анализ маршрутов: the route board of one day
// ---------------------------------------------------------------------------

export type RouteBoardAgent = {
  employeeId: number
  name: string
  /** Local "YYYY-MM-DD HH:mm:ss" of the first visit start. */
  firstVisit: string
  /** Planned clients visited / planned clients of the day / visited clients outside the plan. */
  visited: number
  plan: number
  outside: number
  /** Counted orders of the day in `currency` (the base currency). */
  salesSum: number
  currency: string
  idleMinutes: number
  lastClient: string
  lastDurationSec: number
}

/** The day's plan of an agent (every agent with one, out or not): Linko's «0/5» and its next client — the nearest
 * planned client not visited yet from the agent's last location (km), else the first of the route. */
export type RouteBoardPlan = { employeeId: number; plan: number; next: { clientId: number; name: string; distanceKm: number | null } | null }

export type RoutesBoard = { date: string; currency: string; problems: RouteBoardAgent[]; active: RouteBoardAgent[]; plans: RouteBoardPlan[] }

/** The day's plan and next client of each agent (see RouteBoardPlan). */
async function boardPlans(date: string, employeeIds: number[] | undefined): Promise<RouteBoardPlan[]> {
  const planned = await plannedClients(employeeIds, date)
  const ids = [...planned.keys()]
  if (!ids.length) return []
  const visited = (await getDb()
    .prepare(
      `SELECT DISTINCT v.employee_id, v.client_id FROM field_visits v
        WHERE v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz AND v.employee_id = ANY(@ids::int[])`,
    )
    .all({ ...utcBounds(date, date), ids })) as Array<{ employee_id: number; client_id: number }>
  const done = new Set(visited.map((row) => `${row.employee_id}|${row.client_id}`))
  const until = date < todayIso() ? dayStartMs(date) + DAY_MS : Date.now()
  const where = new Map((await lastLocations(ids, until)).flatMap((entry) => (entry.point ? [[entry.employeeId, entry.point] as const] : [])))
  return ids.map((employeeId) => {
    const list = planned.get(employeeId) ?? []
    const open = list.filter((client) => !done.has(`${employeeId}|${client.clientId}`))
    const point = where.get(employeeId)
    let next: RouteBoardPlan["next"] = null
    let best = Infinity
    for (const client of open) {
      if (!point || client.lat === null || client.lng === null) continue
      const meters = haversineMeters(point.lat, point.lng, client.lat, client.lng)
      if (meters < best) {
        best = meters
        next = { clientId: client.clientId, name: client.clientName, distanceKm: Math.round(meters) / 1000 }
      }
    }
    if (!next && open.length) next = { clientId: open[0].clientId, name: open[0].clientName, distanceKm: null }
    return { employeeId, plan: list.length, next }
  })
}

/** The agents who visited clients on `date`: problem ones (idle > 30 min today) and the others. */
export async function getRoutesBoard(date: string, employeeIds?: number[]): Promise<RoutesBoard> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return { date, currency: "", problems: [], active: [], plans: [] }
  const plans = await boardPlans(date, employeeIds)
  const rows = (await getDb()
    .prepare(
      `SELECT v.employee_id, COALESCE(c.name, '') AS client_name,
              to_char(${local("v.started_at")}, 'YYYY-MM-DD HH24:MI:SS') AS started_text,
              (EXTRACT(EPOCH FROM v.started_at) * 1000)::float8 AS started_ms,
              (EXTRACT(EPOCH FROM v.finished_at) * 1000)::float8 AS finished_ms
         FROM field_visits v
         LEFT JOIN clients c ON c.id = v.client_id
        WHERE v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz
          ${employeeIds ? "AND v.employee_id = ANY(@employeeIds::int[])" : ""}
        ORDER BY v.employee_id, v.started_at, v.id`,
    )
    .all({ ...utcBounds(date, date), employeeIds: employeeIds ?? [] })) as Array<{
    employee_id: number
    client_name: string
    started_text: string
    started_ms: number
    finished_ms: number | null
  }>
  const byEmployee = new Map<number, typeof rows>()
  for (const row of rows) byEmployee.set(Number(row.employee_id), [...(byEmployee.get(Number(row.employee_id)) ?? []), row])
  const ids = [...byEmployee.keys()]
  if (!ids.length) return { date, currency: "", problems: [], active: [], plans }

  const [status, totals, people] = [
    await dayStatus(ids, date),
    await fieldEventTotals({ from: date, to: date, kinds: ["order"], excludeCancelled: true, employeeIds: ids }),
    await agentInfo(ids),
  ]
  const statusOf = new Map(status.map((entry) => [entry.employeeId, entry]))
  const salesOf = new Map(totals.byEmployee.map((entry) => [entry.employeeId, entry.byKind.order?.amountBase ?? 0]))
  const now = Date.now()
  const isToday = date === todayIso()
  const problems: RouteBoardAgent[] = []
  const active: RouteBoardAgent[] = []
  for (const [employeeId, list] of byEmployee) {
    const last = list[list.length - 1]
    const lastEnd = last.finished_ms === null ? null : Number(last.finished_ms)
    const idleMinutes = isToday && lastEnd !== null ? Math.max(0, Math.round((now - lastEnd) / 60_000)) : 0
    const day = statusOf.get(employeeId)
    const agent: RouteBoardAgent = {
      employeeId,
      name: people.get(employeeId)?.name ?? `#${employeeId}`,
      firstVisit: list[0].started_text,
      visited: day?.done ?? 0,
      plan: day?.todo ?? 0,
      outside: day?.unplanned ?? 0,
      salesSum: roundMoney(salesOf.get(employeeId) ?? 0),
      currency: totals.baseCurrency,
      idleMinutes,
      lastClient: last.client_name,
      lastDurationSec: Math.max(0, Math.round((Math.min(lastEnd ?? now, Number(last.started_ms) + MAX_VISIT_MS) - Number(last.started_ms)) / 1000)),
    }
    ;(isToday && idleMinutes > PROBLEM_IDLE_MINUTES ? problems : active).push(agent)
  }
  problems.sort((a, b) => b.idleMinutes - a.idleMinutes)
  active.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  return { date, currency: totals.baseCurrency, problems, active, plans }
}

// ---------------------------------------------------------------------------
// Visit reports of a period (Визиты агента, Визиты по дням, Системная дистрибуция)
// ---------------------------------------------------------------------------

export type AgentRouteTotals = { visited: number; effective: number; refused: number; sales: number }

export type AgentRouteSummaryRow = {
  employeeId: number
  name: string
  position: string
  branch: string
  supervisorId: number | null
  supervisor: string
  /** Clients whose responsible agent is the employee (closed clients excluded). */
  okb: number
  /** Distinct clients of the employee's counted orders in the period. */
  akb: number
  /** Planned client-days (route plans, days up to today). */
  plan: number
  /** Client-days of planned clients ("По маршруту") and of the others ("Вне маршрута"):
   * visited, ended with an order, ended with a refusal; sales = counted orders in the base currency. */
  route: AgentRouteTotals
  outside: AgentRouteTotals
  /** Local days with at least one visit. */
  visitDays: string[]
  /** Visited clients per local day ("YYYY-MM-DD" → count), the cells of Визиты по дням. */
  visitsByDay: Record<string, number>
  /** The other columns of Визиты по дням («Колонка»), per local day of a visit: visited clients whose visit
   * ended with an order (Заказ), photo reports taken (Фотоотчёт колв.) and "HH:mm" of the first visit start /
   * the last visit end (Начало / Конец работы). Strike Rate = Заказ / Визит. */
  ordersByDay: Record<string, number>
  reportsByDay: Record<string, number>
  startByDay: Record<string, string>
  endByDay: Record<string, string>
}

export type AgentRouteSummary = { from: string; to: string; baseCurrency: string; agents: AgentRouteSummaryRow[] }

const emptyTotals = (): AgentRouteTotals => ({ visited: 0, effective: 0, refused: 0, sales: 0 })

const byDayRecord = (map: Map<string, number>) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))

/** Per employee: plan vs. visits on and off the route, refusals and sales of the period. */
export async function getAgentRouteSummary(from: string, to: string, employeeIds?: number[]): Promise<AgentRouteSummary> {
  const days = await clientDays(from, to, employeeIds)
  return summarize(from, to, days, await orderFacts(from, to, employeeIds), await photoReportsByDay(from, to, employeeIds))
}

/** Photo reports (field_photo_reports) per employee and local day of the period: "id|YYYY-MM-DD" → count. */
async function photoReportsByDay(from: string, to: string, employeeIds?: number[]): Promise<Map<string, number>> {
  checkPeriod(from, to)
  if (employeeIds && !employeeIds.length) return new Map()
  await ensureFieldSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT r.employee_id, to_char((${local("r.happened_at")})::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
         FROM field_photo_reports r
        WHERE r.happened_at >= @fromUtc::timestamptz AND r.happened_at < @toUtc::timestamptz
          ${employeeIds ? "AND r.employee_id = ANY(@employeeIds::int[])" : ""}
        GROUP BY 1, 2`,
    )
    .all({ ...utcBounds(from, to), employeeIds: employeeIds ?? [] })) as Array<{ employee_id: number; day: string; n: number }>
  return new Map(rows.map((row) => [`${Number(row.employee_id)}|${row.day}`, Number(row.n) || 0]))
}

async function summarize(
  from: string,
  to: string,
  days: ClientDay[],
  { baseCurrency, orders }: { baseCurrency: string; orders: OrderFact[] },
  reports: Map<string, number> = new Map(),
): Promise<AgentRouteSummary> {
  type Acc = {
    plan: number
    route: AgentRouteTotals
    outside: AgentRouteTotals
    visitDays: Set<string>
    byDay: Map<string, number>
    ordersByDay: Map<string, number>
    startByDay: Map<string, string>
    endByDay: Map<string, string>
    clients: Set<string>
  }
  const acc = new Map<number, Acc>()
  const entry = (id: number) => {
    let value = acc.get(id)
    if (!value) {
      acc.set(id, (value = { plan: 0, route: emptyTotals(), outside: emptyTotals(), visitDays: new Set(), byDay: new Map(), ordersByDay: new Map(), startByDay: new Map(), endByDay: new Map(), clients: new Set() }))
    }
    return value
  }
  const planned = new Set<string>()
  for (const day of days) {
    const target = entry(day.employeeId)
    if (day.planned) {
      target.plan += 1
      planned.add(factKey(day.employeeId, day.day, day.clientId))
    }
    if (!day.visits) continue
    const side = day.planned ? target.route : target.outside
    side.visited += 1
    if (day.effective) side.effective += 1
    if (day.refused) side.refused += 1
    target.visitDays.add(day.day)
    target.byDay.set(day.day, (target.byDay.get(day.day) ?? 0) + 1)
    if (day.effective) target.ordersByDay.set(day.day, (target.ordersByDay.get(day.day) ?? 0) + 1)
    const start = target.startByDay.get(day.day)
    if (day.firstStart && (!start || day.firstStart < start)) target.startByDay.set(day.day, day.firstStart)
    const end = target.endByDay.get(day.day)
    if (day.lastEnd && (!end || day.lastEnd > end)) target.endByDay.set(day.day, day.lastEnd)
  }
  for (const order of orders) {
    const target = entry(order.employeeId)
    const side = order.clientId !== null && planned.has(factKey(order.employeeId, order.day, order.clientId)) ? target.route : target.outside
    side.sales += order.amountBase
    target.clients.add(order.clientKey)
  }
  const ids = [...acc.keys()]
  const [info, okb] = [await agentInfo(ids), await baseClients(ids)]
  const agents = ids
    .map((employeeId): AgentRouteSummaryRow => {
      const value = acc.get(employeeId)!
      const person = info.get(employeeId)
      value.route.sales = roundMoney(value.route.sales)
      value.outside.sales = roundMoney(value.outside.sales)
      return {
        employeeId,
        name: person?.name ?? `#${employeeId}`,
        position: person?.position ?? "",
        branch: person?.branch ?? "",
        supervisorId: person?.supervisorId ?? null,
        supervisor: person?.supervisor ?? "",
        okb: okb.get(employeeId) ?? 0,
        akb: value.clients.size,
        plan: value.plan,
        route: value.route,
        outside: value.outside,
        visitDays: [...value.visitDays].sort(),
        visitsByDay: byDayRecord(value.byDay),
        ordersByDay: byDayRecord(value.ordersByDay),
        reportsByDay: Object.fromEntries(
          [...reports.entries()].filter(([key]) => key.startsWith(`${employeeId}|`)).map(([key, n]) => [key.slice(key.indexOf("|") + 1), n] as const).sort(([a], [b]) => a.localeCompare(b)),
        ),
        startByDay: Object.fromEntries([...value.startByDay.entries()].map(([day, stamp]) => [day, clock(stamp)] as const).sort(([a], [b]) => a.localeCompare(b))),
        endByDay: Object.fromEntries([...value.endByDay.entries()].map(([day, stamp]) => [day, clock(stamp)] as const).sort(([a], [b]) => a.localeCompare(b))),
      }
    })
    // By employee id, as Linko's agent_visit / system_distribution reports list them.
    .sort((a, b) => a.employeeId - b.employeeId)
  return { from, to, baseCurrency, agents }
}

// ---------------------------------------------------------------------------
// Dashboard "Визиты агента по филиалам"
// ---------------------------------------------------------------------------

export type VisitStatRow = {
  employeeId: number
  name: string
  branch: string
  /** "HH:mm" for one day, "DD.MM HH:mm" for a longer period. */
  firstVisit: string
  lastVisit: string
  plan: number
  /** Planned clients visited / other clients visited. */
  visited: number
  outside: number
  /** Visits that ended with an order / with a refusal. */
  orders: number
  refusals: number
  notVisited: number
  akb: number
  routeCompletion: number
  /** Counted orders in `currency` (the base currency). */
  sales: number
  currency: string
}

export async function getVisitStats(begin: string, end: string, employeeIds?: number[]): Promise<{ agents: VisitStatRow[]; problems: number; currency: string }> {
  const days = await clientDays(begin, end, employeeIds)
  const summary = await summarize(begin, end, days, await orderFacts(begin, end, employeeIds))
  const first = new Map<number, string>()
  const last = new Map<number, string>()
  for (const day of days) {
    if (day.firstStart && (!first.has(day.employeeId) || day.firstStart < first.get(day.employeeId)!)) first.set(day.employeeId, day.firstStart)
    if (day.lastEnd && (!last.has(day.employeeId) || day.lastEnd > last.get(day.employeeId)!)) last.set(day.employeeId, day.lastEnd)
  }
  const stamp = (value: string | undefined) => {
    if (!value) return ""
    return begin === end ? clock(value) : `${value.slice(8, 10)}.${value.slice(5, 7)} ${clock(value)}`
  }
  const agents = summary.agents
    .map((row): VisitStatRow => ({
      employeeId: row.employeeId,
      name: row.name,
      branch: row.branch,
      firstVisit: stamp(first.get(row.employeeId)),
      lastVisit: stamp(last.get(row.employeeId)),
      plan: row.plan,
      visited: row.route.visited,
      outside: row.outside.visited,
      orders: row.route.effective + row.outside.effective,
      refusals: row.route.refused + row.outside.refused,
      notVisited: Math.max(row.plan - row.route.visited, 0),
      akb: row.akb,
      routeCompletion: row.plan > 0 ? Math.round((row.route.visited / row.plan) * 100) : 0,
      sales: roundMoney(row.route.sales + row.outside.sales),
      currency: summary.baseCurrency,
    }))
    .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name, "ru"))
  const today = todayIso()
  const problems = begin <= today && today <= end ? (await getRoutesBoard(today, employeeIds)).problems.length : 0
  return { agents, problems, currency: summary.baseCurrency }
}

// ---------------------------------------------------------------------------
// Время работы агента
// ---------------------------------------------------------------------------
//
// Linko's report agent_work_hour, «Показать по» (its data_type):
// - «Время нахождения» (service_time, the default): the days with a measured stay at a client (a visit checked in and
//   out at different moments), by the day of the check-in; first / last activity = the first check-in / the last
//   check-out of those stays; time at the clients = the stays added up.
// - «Задачи» (today_plan): the days on which a task of Linko's day plan was done. A task is done at its moment, on its
//   day: a visit at its check-out (with its stay, if measured), an order made (a cancelled one is not done, an
//   unconfirmed one is), an order delivered — on the order's delivery date, whenever it was delivered —, a payment
//   taken in the field (not one entered into a cashbox and accepted at once), a return made (not cancelled), a refusal,
//   a photo report. First / last activity = the first / last of the day's moments; time at the clients = the stays of
//   the day's visits.
// Both: plan / visited by plan / outside it / not visited = the day's planned and visited clients, АКБ = the clients
// of the orders the employee made that day (not cancelled), Сумма заказов = those orders after their returns
// (fact_price, less the returns made in the app since), each at the rate Linko booked it at, else at its currency's
// rate when it was made (Валюты history), in the base currency or the app currency.
//
// The days of the history copied from Linko (up to linko_history 'day_tasks') read Linko's own day plans
// (linko_day_tasks, scripts/linko-sync/import-day-tasks.mjs): its tasks at their moments (to the microsecond), the
// visits it planned for the day (the routes of that time), its service times. Later days are computed from the app's
// documents, with the plan of the routes as they are now (clientDays). The report shows these facts as Linko does
// (components/analytics/agent-working-time-view.tsx).

/** «Показать по» of Время работы агента: «Задачи» (today_plan) / «Время нахождения» (service_time), Linko's ids. */
export type WorkTimeBasis = "today_plan" | "service_time"
export const WORK_TIME_BASES: readonly WorkTimeBasis[] = ["today_plan", "service_time"]

export type WorkTimeRow = {
  employeeId: number
  agent: string
  date: string
  /** Local "YYYY-MM-DDTHH:mm:ss.ffffff" of the first / the last activity (the last may be on another day; null on a
   * «Время нахождения» day whose only service was never ended). */
  firstAt: string
  lastAt: string | null
  /** "HH:mm" of firstAt / lastAt ("" without one). */
  first: string
  last: string
  /** Seconds (with their fraction) from the first to the last activity. */
  totalSec: number
  /** How many moments of activity the day has (tasks done at different moments; check-ins and check-outs). */
  moments: number
  /** Seconds (with their fraction) at the clients. */
  storeSec: number
  plan: number
  visitedPlan: number
  visitedOutside: number
  notVisited: number
  akb: number
  /** The day's orders in `currency` (the base currency, or the app currency when one is chosen). */
  sales: number
  currency: string
}

const LOCAL_TEXT_US = `'YYYY-MM-DD"T"HH24:MI:SS.US'`

/** One employee-day of activity (see WorkTimeRow). */
type ActiveDay = { employeeId: number; day: string; firstAt: string; lastAt: string | null; totalSec: number; moments: number; storeSec: number }

type ActiveDayRow = { employee_id: number; day: string; first_at: string; last_at: string | null; total_sec: number | null; moments: number; store_sec: number | null }

const toActiveDays = (rows: ActiveDayRow[]): ActiveDay[] =>
  rows.map((row) => ({
    employeeId: Number(row.employee_id),
    day: row.day,
    firstAt: row.first_at,
    lastAt: row.last_at,
    totalSec: Math.max(0, Number(row.total_sec) || 0),
    moments: Number(row.moments) || 0,
    storeSec: Math.max(0, Number(row.store_sec) || 0),
  }))

type Span = { from: string; to: string }

/** The days [from, to] split at the end of the history copied from Linko: the days read from Linko's day plans and the
 * days computed from the app's documents (null = none). */
async function workTimeSpans(from: string, to: string): Promise<{ linko: Span | null; app: Span | null }> {
  const db = getDb()
  const ready = (await db
    .prepare("SELECT to_regclass('linko_day_tasks') IS NOT NULL AND to_regclass('linko_history') IS NOT NULL AS ok")
    .get()) as { ok: boolean } | undefined
  const last = ready?.ok
    ? (((await db.prepare("SELECT left(until, 10) AS day FROM linko_history WHERE ledger = 'day_tasks'").get()) as { day: string } | undefined)?.day ?? null)
    : null
  if (!last || !isIsoDay(last) || last < from) return { linko: null, app: { from, to } }
  if (last >= to) return { linko: { from, to }, app: null }
  return { linko: { from, to: last }, app: { from: addDays(last, 1), to } }
}

const onlyEmployees = (column: string, employeeIds?: number[]) => (employeeIds ? `AND ${column} = ANY(@employeeIds::int[])` : "")

/** Linko's «Задачи» days: its tasks done in each day plan. */
async function linkoTaskDays(span: Span, employeeIds?: number[]): Promise<ActiveDay[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.employee_id, to_char(t.plan_day, 'YYYY-MM-DD') AS day,
              to_char(MIN(t.done_at), ${LOCAL_TEXT_US}) AS first_at, to_char(MAX(t.done_at), ${LOCAL_TEXT_US}) AS last_at,
              EXTRACT(EPOCH FROM MAX(t.done_at) - MIN(t.done_at))::float8 AS total_sec,
              COUNT(DISTINCT t.done_at)::int AS moments,
              COALESCE(SUM(t.stay_sec) FILTER (WHERE t.type = 'service_time'), 0)::float8 AS store_sec
         FROM linko_day_tasks t
        WHERE t.status = 'done' AND t.done_at IS NOT NULL AND t.plan_day BETWEEN @from::date AND @to::date ${onlyEmployees("t.employee_id", employeeIds)}
        GROUP BY 1, 2`,
    )
    .all({ from: span.from, to: span.to, employeeIds: employeeIds ?? [] })) as ActiveDayRow[]
  return toActiveDays(rows)
}

/** Linko's «Время нахождения» days: its service times, by the day they started — with the services it began and never
 * ended (linko_open_services: a start, no end, no stay). */
async function linkoStayDays(span: Span, employeeIds?: number[]): Promise<ActiveDay[]> {
  const db = getDb()
  const open = ((await db.prepare("SELECT to_regclass('linko_open_services') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined)?.ok
  const rows = (await db
    .prepare(
      `WITH s AS (
         SELECT t.employee_id, t.started_at, t.started_at + t.stay_sec * interval '1 second' AS ended, t.stay_sec
           FROM linko_day_tasks t
          WHERE t.type = 'service_time' AND t.status = 'done' AND t.started_at IS NOT NULL AND t.stay_sec IS NOT NULL
         ${open ? "UNION ALL SELECT o.employee_id, o.started_at, NULL::timestamp, NULL::float8 FROM linko_open_services o" : ""}
       )
       SELECT s.employee_id, to_char(s.started_at::date, 'YYYY-MM-DD') AS day,
              to_char(MIN(s.started_at), ${LOCAL_TEXT_US}) AS first_at, to_char(MAX(s.ended), ${LOCAL_TEXT_US}) AS last_at,
              COALESCE(EXTRACT(EPOCH FROM MAX(s.ended) - MIN(s.started_at)), 0)::float8 AS total_sec,
              (COUNT(*) + COUNT(s.ended))::int AS moments,
              COALESCE(SUM(s.stay_sec), 0)::float8 AS store_sec
         FROM s
        WHERE s.started_at >= @from::timestamp AND s.started_at < @to::timestamp ${onlyEmployees("s.employee_id", employeeIds)}
        GROUP BY 1, 2`,
    )
    .all({ from: `${span.from}T00:00:00`, to: `${addDays(span.to, 1)}T00:00:00`, employeeIds: employeeIds ?? [] })) as ActiveDayRow[]
  return toActiveDays(rows)
}

/** «Время нахождения» of the app's days: the employee-days with a measured stay or a visit not ended yet (check-in
 * day; a visit in progress counts its start, as Linko's unfinished service). */
async function stayDays(span: Span, employeeIds?: number[]): Promise<ActiveDay[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT v.employee_id, to_char((${local("v.started_at")})::date, 'YYYY-MM-DD') AS day,
              to_char(MIN(${local("v.started_at")}), ${LOCAL_TEXT_US}) AS first_at,
              to_char(MAX(${local("v.finished_at")}), ${LOCAL_TEXT_US}) AS last_at,
              COALESCE(EXTRACT(EPOCH FROM MAX(v.finished_at) - MIN(v.started_at)), 0)::float8 AS total_sec,
              (COUNT(*) + COUNT(v.finished_at))::int AS moments,
              COALESCE(SUM(EXTRACT(EPOCH FROM (v.finished_at - v.started_at))), 0)::float8 AS store_sec
         FROM field_visits v
        WHERE (v.finished_at > v.started_at OR v.finished_at IS NULL)
          AND v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz
          ${onlyEmployees("v.employee_id", employeeIds)}
        GROUP BY 1, 2`,
    )
    .all({ ...utcBounds(span.from, span.to), employeeIds: employeeIds ?? [] })) as ActiveDayRow[]
  return toActiveDays(rows)
}

/** Employees by the finance name key of a document's text column (lowest id), as the field event stream matches them. */
const EMPLOYEE_KEYS = "ek AS (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1)"
const byName = (alias: string, column: string) => `LEFT JOIN ek ${alias} ON fin_key(${column}) <> '' AND ${alias}.k = fin_key(${column})`

/** «Задачи» of the app's days: the employee-days with a task done (see above), from the app's documents. */
async function taskDays(span: Span, employeeIds?: number[]): Promise<ActiveDay[]> {
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const logs = (await columnsOf(["order_logs"])).get("order_logs")
  const colOr = (table: string, column: string, expr: string, fallback = "NULL") => (s.col(table, column) ? expr : fallback)
  // Every source: (employee_id, at = the local moment, day = the plan day when it is not the moment's day, stay seconds,
  // tasks = how many of Linko's tasks the row is).
  const select = (employee: string, at: string, day = "NULL", stay = "0", tasks = "1") =>
    `SELECT (${employee})::int AS employee_id, (${at})::timestamp AS at, (${day})::date AS day, (${stay})::float8 AS stay, (${tasks})::int AS tasks`
  const sources = [
    // A visit is done when it ends (Linko's visit task: the check-out), with its stay (a second task, «Обслуживание»).
    `${select("v.employee_id", local("v.finished_at"), "NULL", "GREATEST(EXTRACT(EPOCH FROM (v.finished_at - v.started_at)), 0)", "CASE WHEN v.finished_at > v.started_at THEN 2 ELSE 1 END")}
       FROM field_visits v WHERE v.finished_at >= @fromUtc::timestamptz AND v.finished_at < @toUtc::timestamptz`,
    `${select("f.employee_id", local("f.happened_at"))} FROM field_refusals f WHERE f.happened_at >= @fromUtc::timestamptz AND f.happened_at < @toUtc::timestamptz`,
    `${select("r.employee_id", local("r.happened_at"))} FROM field_photo_reports r WHERE r.happened_at >= @fromUtc::timestamptz AND r.happened_at < @toUtc::timestamptz`,
  ]
  if (s.has("orders") && s.col("orders", "status") && s.col("orders", "created_at")) {
    if (s.col("orders", "agent")) {
      // An order made: done when made, unless cancelled.
      sources.push(
        `${select("oe.id", "fin_ts(o.created_at, true)")} FROM orders o ${byName("oe", "o.agent")}
          WHERE fin_ts(o.created_at, true) >= @from::timestamp AND fin_ts(o.created_at, true) < @to::timestamp AND o.status <> 'Отменен'`,
      )
    }
    if (s.col("orders", "delivery_man")) {
      // An order delivered: on its delivery date (Linko plans the delivery there), at the moment it was delivered —
      // the last «Доставлено» entry of its Логи (status code 3; Linko's own task time for 47 of its 48 deliveries of
      // Dec 2025 / Mar 2026), else the order's shipping moment.
      const deliveredAt = [
        logs?.has("status") && logs.has("created_at") ? "(SELECT MAX(fin_ts(l.created_at)) FROM order_logs l WHERE l.order_id = d.id AND l.status IN ('3', 'Доставлено'))" : "",
        colOr("orders", "shipped_at", "fin_ts(d.shipped_at, true)", ""),
        colOr("orders", "updated_at", "fin_ts(d.updated_at, true)", ""),
        "fin_ts(d.created_at, true)",
      ].filter(Boolean)
      sources.push(
        `${select("de.id", "x.at", "COALESCE(x.planned, x.at::date)")}
           FROM (SELECT d.delivery_man, COALESCE(${deliveredAt.join(", ")}) AS at, ${colOr("orders", "delivery", "fin_ts(NULLIF(d.delivery, ''))::date")} AS planned
                   FROM orders d WHERE d.status = 'Доставлено') x
           ${byName("de", "x.delivery_man")}
          WHERE COALESCE(x.planned, x.at::date) BETWEEN @fromDay::date AND @toDay::date`,
      )
    }
  }
  const P = "customer_payments"
  if (s.has(P) && s.col(P, "amount")) {
    // A payment taken in the field (by the agent, else the courier), at the payment's moment (lib/cash/customer-payments.ts).
    // Linko makes a task of a payment the agent takes (it waits in the agent's cash until a cashier accepts it), not of
    // one entered into a cashbox and accepted at once: in Dec 2025 / Mar 2026 its 7 payment tasks are the 7 payments
    // accepted later than made (6 of them through an agent cash), its 76 other payments were accepted when made.
    const paidAt = [colOr(P, "payment_date", "fin_ts(NULLIF(p.payment_date, ''))", ""), colOr(P, "paid_at", "fin_ts(p.paid_at)", ""), colOr(P, "created_at", "fin_ts(p.created_at, true)", "")].filter(Boolean)
    const at = `COALESCE(${paidAt.join(", ")})`
    const who = [colOr(P, "agent", "pa.id", ""), colOr(P, "delivery_man_id", "pde.id", ""), colOr(P, "delivery_man", "pd.id", "")].filter(Boolean)
    const field = [
      colOr(P, "agent_cashbox_id", "p.agent_cashbox_id IS NOT NULL", ""),
      colOr(P, "accepted", "COALESCE(p.accepted, 0) = 0", ""),
      colOr(P, "accepted_at", `fin_ts(NULLIF(p.accepted_at, '')) > ${at} + interval '1 minute'`, ""),
    ].filter(Boolean)
    if (paidAt.length && who.length && field.length) {
      sources.push(
        `${select(`COALESCE(${who.join(", ")})`, at)}
           FROM ${P} p
           ${s.col(P, "agent") ? byName("pa", "p.agent") : ""}
           ${s.col(P, "delivery_man_id") ? "LEFT JOIN employees pde ON pde.id = p.delivery_man_id" : ""}
           ${s.col(P, "delivery_man") ? byName("pd", "p.delivery_man") : ""}
          WHERE ${at} >= @from::timestamp AND ${at} < @to::timestamp AND (${field.join(" OR ")})
            ${s.col(P, "is_deleted") ? "AND COALESCE(p.is_deleted, 0) = 0" : ""}`,
      )
    }
  }
  const R = "client_returns"
  if (s.has(R) && s.col(R, "created_at") && s.col(R, "status")) {
    // A return made (not cancelled), by whoever made it, else its agent / deliverer. A copied Linko return keeps its
    // moment (local) in return_date; an app return has a plain day there and its moment in created_at (UTC).
    const at = s.col(R, "return_date")
      ? "CASE WHEN length(btrim(r.return_date)) > 10 THEN fin_ts(r.return_date) ELSE fin_ts(r.created_at, true) END"
      : "fin_ts(r.created_at, true)"
    const who = [colOr(R, "created_by", "rc.id", ""), colOr(R, "agent", "ra.id", ""), colOr(R, "deliverer", "rd.id", "")].filter(Boolean)
    if (who.length) {
      sources.push(
        `${select(`COALESCE(${who.join(", ")})`, at)}
           FROM ${R} r
           ${s.col(R, "created_by") ? byName("rc", "r.created_by") : ""}
           ${s.col(R, "agent") ? byName("ra", "r.agent") : ""}
           ${s.col(R, "deliverer") ? byName("rd", "r.deliverer") : ""}
          WHERE COALESCE(r.status, '') <> 'cancelled' AND ${at} >= @from::timestamp AND ${at} < @to::timestamp`,
      )
    }
  }
  const rows = (await db
    .prepare(
      `WITH ${EMPLOYEE_KEYS},
       t AS (${sources.join("\nUNION ALL\n")})
       SELECT t.employee_id, to_char(COALESCE(t.day, t.at::date), 'YYYY-MM-DD') AS day,
              to_char(MIN(t.at), ${LOCAL_TEXT_US}) AS first_at, to_char(MAX(t.at), ${LOCAL_TEXT_US}) AS last_at,
              EXTRACT(EPOCH FROM MAX(t.at) - MIN(t.at))::float8 AS total_sec,
              SUM(t.tasks)::int AS moments, SUM(t.stay)::float8 AS store_sec
         FROM t
        WHERE t.employee_id IS NOT NULL AND t.at IS NOT NULL AND COALESCE(t.day, t.at::date) BETWEEN @fromDay::date AND @toDay::date
          ${onlyEmployees("t.employee_id", employeeIds)}
        GROUP BY 1, 2`,
    )
    .all({
      ...utcBounds(span.from, span.to),
      from: `${span.from}T00:00:00`,
      to: `${addDays(span.to, 1)}T00:00:00`,
      fromDay: span.from,
      toDay: span.to,
      employeeIds: employeeIds ?? [],
    })) as ActiveDayRow[]
  return toActiveDays(rows)
}

/** The day plan's visits per "employeeId|day": planned, planned and visited, visited outside the plan. */
type PlanFigures = { plan: number; visitedPlan: number; visitedOutside: number }

/** Linko's days: the visits it planned (its routes of that time) and the ones done. */
async function linkoPlans(span: Span, employeeIds?: number[]): Promise<Map<string, PlanFigures>> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.employee_id, to_char(t.plan_day, 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE t.type = 'visit')::int AS plan,
              COUNT(*) FILTER (WHERE t.type = 'visit' AND t.status = 'done')::int AS visited_plan,
              COUNT(*) FILTER (WHERE t.type = 'no_plan_visit' AND t.status = 'done')::int AS visited_outside
         FROM linko_day_tasks t
        WHERE t.plan_day BETWEEN @from::date AND @to::date ${onlyEmployees("t.employee_id", employeeIds)}
        GROUP BY 1, 2`,
    )
    .all({ from: span.from, to: span.to, employeeIds: employeeIds ?? [] })) as Array<{ employee_id: number; day: string; plan: number; visited_plan: number; visited_outside: number }>
  return new Map(rows.map((row) => [`${Number(row.employee_id)}|${row.day}`, { plan: Number(row.plan), visitedPlan: Number(row.visited_plan), visitedOutside: Number(row.visited_outside) }]))
}

/** The app's days: the clients planned by the routes and the clients visited (clientDays). */
async function appPlans(span: Span, employeeIds?: number[]): Promise<Map<string, PlanFigures>> {
  const out = new Map<string, PlanFigures>()
  for (const day of await clientDays(span.from, span.to, employeeIds)) {
    const key = `${day.employeeId}|${day.day}`
    const value = out.get(key) ?? { plan: 0, visitedPlan: 0, visitedOutside: 0 }
    if (day.planned) value.plan += 1
    if (day.visits) {
      if (day.planned) value.visitedPlan += 1
      else value.visitedOutside += 1
    }
    out.set(key, value)
  }
  return out
}

/** An order of a day's АКБ / Сумма заказов. */
type DayOrder = { employeeId: number; day: string; orderId: number; clientKey: string }

/** Linko's days: the orders whose task was done in the day plan. */
async function linkoOrders(span: Span, employeeIds?: number[]): Promise<DayOrder[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT t.employee_id, to_char(t.plan_day, 'YYYY-MM-DD') AS day, t.order_id, t.client_id
         FROM linko_day_tasks t
        WHERE t.type = 'order' AND t.status = 'done' AND t.order_id IS NOT NULL AND t.plan_day BETWEEN @from::date AND @to::date
          ${onlyEmployees("t.employee_id", employeeIds)}`,
    )
    .all({ from: span.from, to: span.to, employeeIds: employeeIds ?? [] })) as Array<{ employee_id: number; day: string; order_id: number; client_id: number | null }>
  return rows.map((row) => ({
    employeeId: Number(row.employee_id),
    day: row.day,
    orderId: Number(row.order_id),
    clientKey: row.client_id === null || row.client_id === undefined ? `order:${Number(row.order_id)}` : `id:${Number(row.client_id)}`,
  }))
}

/** The app's days: the orders the employees made (not cancelled). */
async function madeOrders(span: Span, employeeIds?: number[]): Promise<DayOrder[]> {
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  if (!s.has("orders") || !s.col("orders", "agent") || !s.col("orders", "status") || !s.col("orders", "created_at")) return []
  const clientId = s.col("orders", "client_id") ? "COALESCE(o.client_id, oc.id)" : "oc.id"
  const rows = (await db
    .prepare(
      `WITH ${EMPLOYEE_KEYS},
       ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)
       SELECT oe.id AS employee_id, to_char(fin_ts(o.created_at, true)::date, 'YYYY-MM-DD') AS day, o.id,
              ${clientId} AS client_id, ${s.col("orders", "client") ? "COALESCE(o.client, '')" : "''"} AS client_name
         FROM orders o
         JOIN ek oe ON fin_key(o.agent) <> '' AND oe.k = fin_key(o.agent)
         ${s.col("orders", "client") ? `LEFT JOIN ck oc ON ${s.col("orders", "client_id") ? "o.client_id IS NULL AND " : ""}oc.k = fin_key(o.client)` : "LEFT JOIN ck oc ON false"}
        WHERE fin_ts(o.created_at, true) >= @from::timestamp AND fin_ts(o.created_at, true) < @to::timestamp AND o.status <> 'Отменен'
          ${onlyEmployees("oe.id", employeeIds)}`,
    )
    .all({ from: `${span.from}T00:00:00`, to: `${addDays(span.to, 1)}T00:00:00`, employeeIds: employeeIds ?? [] })) as Array<{
    employee_id: number
    day: string
    id: number
    client_id: number | null
    client_name: string
  }>
  return rows.map((row) => ({
    employeeId: Number(row.employee_id),
    day: row.day,
    orderId: Number(row.id),
    clientKey: row.client_id !== null && row.client_id !== undefined ? `id:${Number(row.client_id)}` : `name:${String(row.client_name).trim().toLowerCase()}`,
  }))
}

/** Each order's Сумма заказов: after its returns (fact_price, less the returns made in the app since the copy), at the
 * rate Linko booked it at, else at its currency's rate when it was made, in the base currency or the app currency. */
async function orderAmounts(ids: number[]): Promise<{ currency: string; amounts: Map<number, number> }> {
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const shown = baseReportCurrency(await loadCurrencyContext(db))
  if (!ids.length || !s.has("orders") || !s.col("orders", "created_at")) return { currency: shown.code, amounts: new Map() }
  const book = await loadRateBook(db)
  const booked = (await columnsOf(["linko_document_rates"])).has("linko_document_rates")
  const colOr = (table: string, column: string, expr: string, fallback = "NULL") => (s.col(table, column) ? expr : fallback)
  const currency = `COALESCE(${colOr("orders", "currency", "fin_cur(o.currency)")}, ${colOr("orders", "amount", "(SELECT MIN(a.currency) FROM fin_amounts(o.amount) a)")})`
  const textTotal = colOr("orders", "amount", "(SELECT SUM(a.amount) FROM fin_amounts(o.amount) a)")
  // The returns made in the app since the copy (orders-repo withReturned): Linko's own ones are in return_price already.
  const R = "client_returns"
  const viaLines = s.has("client_return_items") && s.col("client_return_items", "order_item_id")
    ? " OR r.order_id IS NULL AND (SELECT oi.order_id FROM client_return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = r.id ORDER BY ri.id LIMIT 1) = o.id"
    : ""
  const appReturns = s.has(R) && s.col(R, "order_id") && s.col(R, "amount")
    ? `(SELECT SUM(r.amount) FROM ${R} r WHERE (r.order_id = o.id${viaLines}) AND COALESCE(r.status, '') <> 'cancelled' ${s.col(R, "client_credit") ? "AND r.client_credit IS NULL" : ""})`
    : "0"
  const rows = (await db
    .prepare(
      `SELECT o.id, o.created_at, ${currency} AS currency,
              COALESCE(${colOr("orders", "fact_price", "o.fact_price")}, COALESCE(${colOr("orders", "total_price", "o.total_price")}, ${textTotal}, 0) - COALESCE(${colOr("orders", "return_price", "o.return_price")}, 0))::float8 AS fact,
              COALESCE(${appReturns}, 0)::float8 AS app_returned,
              ${booked ? `(SELECT b.rate FROM linko_document_rates b WHERE b.src = 'order' AND b.src_id = o.id AND b.cur = ${currency} LIMIT 1)` : "NULL"}::float8 AS booked_rate
         FROM orders o
        WHERE o.id = ANY(@ids::int[])`,
    )
    .all({ ids })) as Array<{ id: number; created_at: string; currency: string | null; fact: number | null; app_returned: number | null; booked_rate: number | null }>
  const amounts = new Map<number, number>()
  for (const row of rows) {
    const rate = (row.booked_rate !== null && Number(row.booked_rate) > 0 ? Number(row.booked_rate) : null) ?? book.rateAt(row.currency, row.created_at)
    const fact = (Number(row.fact) || 0) - (Number(row.app_returned) || 0)
    amounts.set(Number(row.id), rate === null ? 0 : fact * rate * shown.factor)
  }
  return { currency: shown.code, amounts }
}

/** Per employee and day of activity (see «Показать по» above): first / last activity, time at the clients, the plan
 * and the orders. */
export async function getWorkTime(begin: string, end: string, employeeIds?: number[], basis: WorkTimeBasis = "service_time"): Promise<WorkTimeRow[]> {
  checkPeriod(begin, end)
  if (employeeIds && !employeeIds.length) return []
  await ensureFieldSchema()
  const spans = await workTimeSpans(begin, end)
  const active: ActiveDay[] = []
  if (spans.linko) active.push(...(basis === "today_plan" ? await linkoTaskDays(spans.linko, employeeIds) : await linkoStayDays(spans.linko, employeeIds)))
  if (spans.app) active.push(...(basis === "today_plan" ? await taskDays(spans.app, employeeIds) : await stayDays(spans.app, employeeIds)))
  if (!active.length) return []

  const plans = new Map<string, PlanFigures>([
    ...(spans.linko ? await linkoPlans(spans.linko, employeeIds) : []),
    ...(spans.app ? await appPlans(spans.app, employeeIds) : []),
  ])
  const orders = [...(spans.linko ? await linkoOrders(spans.linko, employeeIds) : []), ...(spans.app ? await madeOrders(spans.app, employeeIds) : [])]
  const { currency, amounts } = await orderAmounts([...new Set(orders.map((order) => order.orderId))])
  const sales = new Map<string, { clients: Set<string>; amount: number }>()
  for (const order of orders) {
    const key = `${order.employeeId}|${order.day}`
    const value = sales.get(key) ?? { clients: new Set<string>(), amount: 0 }
    value.clients.add(order.clientKey)
    value.amount += amounts.get(order.orderId) ?? 0
    sales.set(key, value)
  }

  const info = await agentInfo([...new Set(active.map((day) => day.employeeId))])
  return active
    .map((day): WorkTimeRow => {
      const key = `${day.employeeId}|${day.day}`
      const plan = plans.get(key)
      const sold = sales.get(key)
      return {
        employeeId: day.employeeId,
        agent: info.get(day.employeeId)?.name ?? `#${day.employeeId}`,
        date: day.day,
        firstAt: day.firstAt,
        lastAt: day.lastAt,
        first: clock(day.firstAt),
        last: clock(day.lastAt ?? ""),
        totalSec: day.totalSec,
        moments: day.moments,
        storeSec: day.storeSec,
        plan: plan?.plan ?? 0,
        visitedPlan: plan?.visitedPlan ?? 0,
        visitedOutside: plan?.visitedOutside ?? 0,
        notVisited: Math.max((plan?.plan ?? 0) - (plan?.visitedPlan ?? 0), 0),
        akb: sold?.clients.size ?? 0,
        // Kept to 6 decimals (float noise off): the table rounds to 3 only when it shows a day or an agent's sum.
        sales: roundMoney(sold?.amount ?? 0, 6),
        currency,
      }
    })
    .sort((a, b) => a.agent.localeCompare(b.agent, "ru") || a.employeeId - b.employeeId || a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Sales tab: the "Отказ" line
// ---------------------------------------------------------------------------

/** Refusals (field_refusals) per local day, optionally of some employees / clients. */
export async function countRefusalsByDay(begin: string, end: string, filters: { employeeIds?: number[]; clientIds?: number[] } = {}): Promise<Map<string, number>> {
  if ((filters.employeeIds && !filters.employeeIds.length) || (filters.clientIds && !filters.clientIds.length)) return new Map()
  if (!isIsoDay(begin) || !isIsoDay(end) || begin > end) return new Map()
  await ensureFieldSchema()
  const where = ["f.happened_at >= @fromUtc::timestamptz", "f.happened_at < @toUtc::timestamptz"]
  if (filters.employeeIds) where.push("f.employee_id = ANY(@employeeIds::int[])")
  if (filters.clientIds) where.push("f.client_id = ANY(@clientIds::int[])")
  const rows = (await getDb()
    .prepare(`SELECT to_char((${local("f.happened_at")})::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM field_refusals f WHERE ${where.join(" AND ")} GROUP BY 1`)
    .all({ ...utcBounds(begin, end), employeeIds: filters.employeeIds ?? [], clientIds: filters.clientIds ?? [] })) as Array<{ day: string; n: number }>
  return new Map(rows.map((row) => [row.day, Number(row.n)]))
}

// ---------------------------------------------------------------------------
// Dashboard tiles: attendance (Посещаемость) and successful visits
// ---------------------------------------------------------------------------

export type AttendanceTotals = { onTime: number; late: number; absent: number; weekend: number }
export type AttendanceUser = AttendanceTotals & { id: number; name: string }

export type FieldSummary = {
  attendance: AttendanceTotals
  /** Employees with at least one counted day, by name. */
  users: AttendanceUser[]
  /** Finished visits of the period and those that ended with an order. */
  visits: { visited: number; effective: number; successPercent: number }
}

const TILE_OF: Partial<Record<AttendanceType, keyof AttendanceTotals>> = { on_time: "onTime", late: "late", not_come: "absent", holiday: "weekend" }

/** The first day any attendance can exist: the earliest start of an active employee, check-in or manual day. */
async function attendanceStart(): Promise<string | null> {
  await ensureAttendanceSchema()
  const db = getDb()
  const created = (await db.prepare("SELECT created_at FROM employees WHERE active = 1").all()) as Array<{ created_at: string }>
  const other = (await db
    .prepare("SELECT LEAST((SELECT MIN(day) FROM attendance_days), (SELECT MIN(local_day) FROM attendance_check_ins)) AS first")
    .get()) as { first: string | null } | undefined
  const days = [...created.map((row) => parseAnyDay(row.created_at, true)), other?.first ?? null].filter((day): day is string => Boolean(day))
  return days.length ? days.reduce((min, day) => (day < min ? day : min)) : null
}

/** Effective attendance days (manual > derived > today live, as Посещаемость shows them) counted per
 * employee; `employeeIds` = the reader's field scope (undefined = every employee). */
async function attendanceTotals(begin: string, end: string, employeeIds?: number[]): Promise<AttendanceUser[]> {
  const today = todayIso()
  const last = end < today ? end : today
  const start = await attendanceStart()
  const first = start && start > begin ? start : begin
  if (!start || first > last) return []
  const users = new Map<number, AttendanceUser>()
  let [year, month] = first.split("-").map(Number)
  const [lastYear, lastMonth] = last.split("-").map(Number)
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const data = await listAttendance({ year, month, search: "", branchIds: [], employeeIds })
    for (const user of data.users) {
      for (const day of user.dates) {
        const tile = TILE_OF[day.type]
        if (!tile || day.date < first || day.date > last) continue
        let entry = users.get(user.id)
        if (!entry) users.set(user.id, (entry = { id: user.id, name: user.name, onTime: 0, late: 0, absent: 0, weekend: 0 }))
        entry[tile] += 1
      }
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id)
}

async function visitTotals(begin: string, end: string, employeeIds?: number[]): Promise<FieldSummary["visits"]> {
  await ensureFieldSchema()
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*)::int AS visited, COUNT(*) FILTER (WHERE v.result = 'order')::int AS effective
         FROM field_visits v
        WHERE v.finished_at IS NOT NULL AND v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz
          ${employeeIds ? "AND v.employee_id = ANY(@employeeIds::int[])" : ""}`,
    )
    .get({ ...utcBounds(begin, end), employeeIds: employeeIds ?? [] })) as { visited: number; effective: number } | undefined
  const visited = Number(row?.visited) || 0
  const effective = Number(row?.effective) || 0
  return { visited, effective, successPercent: visited > 0 ? Math.round((effective / visited) * 100) : 0 }
}

/** Attendance tiles (employee-days on time / late / absent / day off) and the share of successful
 * visits, of the employees `employeeIds` (the reader's field scope, lib/field-activity/actor.ts;
 * undefined = every employee, [] = none: all zero). */
export async function getFieldSummary(begin: string, end: string, employeeIds?: number[]): Promise<FieldSummary> {
  if (employeeIds && !employeeIds.length) {
    return { attendance: { onTime: 0, late: 0, absent: 0, weekend: 0 }, users: [], visits: { visited: 0, effective: 0, successPercent: 0 } }
  }
  const users = await attendanceTotals(begin, end, employeeIds)
  const total = (key: keyof AttendanceTotals) => users.reduce((sum, user) => sum + user[key], 0)
  return {
    attendance: { onTime: total("onTime"), late: total("late"), absent: total("absent"), weekend: total("weekend") },
    users,
    visits: await visitTotals(begin, end, employeeIds),
  }
}

// ---------------------------------------------------------------------------
// Время нахождения в магазинах
// ---------------------------------------------------------------------------

export type StoreTimeRow = {
  visitId: number
  /** Local "YYYY-MM-DD" of the check-in. */
  date: string
  /** The client's branch (Филиал of the client card). */
  branch: string
  employeeId: number
  agent: string
  /** Local "HH:mm:ss" of the check-in / check-out. */
  start: string
  end: string
  /** Minutes at the client, one decimal. */
  minutes: number
  clientId: number
  client: string
  /** "lat, lng" (6 decimals) where the agent checked in, and where the client is ("" when unknown). */
  agentGps: string
  clientGps: string
  /** Metres between the two, null when unknown. */
  distance: number | null
  /** The client was on the agent's route that day. */
  planned: boolean
}

const gps = (lat: number | null, lng: number | null) =>
  lat === null || lng === null || lat === undefined || lng === undefined ? "" : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`

/** The visits of the period with a measured stay (checked in and out at different moments), newest first. A visit known
 * only from an order / refusal / report (finished = started) is no stay and is left out. */
export async function getStoreTime(from: string, to: string, employeeIds?: number[]): Promise<StoreTimeRow[]> {
  checkPeriod(from, to)
  if (employeeIds && !employeeIds.length) return []
  await ensureFieldSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT v.id, v.employee_id, v.client_id, v.planned, v.distance_m,
              v.start_lat, v.start_lng, COALESCE(v.client_lat, c.location_lat) AS client_lat, COALESCE(v.client_lng, c.location_lng) AS client_lng,
              to_char(${local("v.started_at")}, 'YYYY-MM-DD') AS day,
              to_char(${local("v.started_at")}, 'HH24:MI:SS') AS start_text,
              to_char(${local("v.finished_at")}, 'HH24:MI:SS') AS end_text,
              EXTRACT(EPOCH FROM (v.finished_at - v.started_at))::float8 AS seconds,
              COALESCE(c.name, '') AS client_name, COALESCE(c.branch, '') AS branch,
              e.first_name, e.last_name
         FROM field_visits v
         LEFT JOIN clients c ON c.id = v.client_id
         LEFT JOIN employees e ON e.id = v.employee_id
        WHERE v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz
          AND v.finished_at IS NOT NULL AND v.finished_at > v.started_at
          ${employeeIds ? "AND v.employee_id = ANY(@employeeIds::int[])" : ""}
        ORDER BY v.started_at DESC, v.id DESC`,
    )
    .all({ ...utcBounds(from, to), employeeIds: employeeIds ?? [] })) as Array<{
    id: number
    employee_id: number
    client_id: number
    planned: boolean
    distance_m: number | null
    start_lat: number | null
    start_lng: number | null
    client_lat: number | null
    client_lng: number | null
    day: string
    start_text: string
    end_text: string
    seconds: number
    client_name: string
    branch: string
    first_name: string | null
    last_name: string | null
  }>
  return rows.map((row) => ({
    visitId: Number(row.id),
    date: row.day,
    branch: row.branch,
    employeeId: Number(row.employee_id),
    agent: nameOf(row) || `#${row.employee_id}`,
    start: row.start_text,
    end: row.end_text,
    // Tenths of a minute, a half rounded down: the moments are kept to the second, so x.x5 is at most that.
    minutes: Math.round((Number(row.seconds) / 6) - 1e-9) / 10,
    clientId: Number(row.client_id),
    client: row.client_name,
    agentGps: gps(row.start_lat, row.start_lng),
    clientGps: gps(row.client_lat, row.client_lng),
    distance: row.distance_m === null || row.distance_m === undefined ? null : Math.round(Number(row.distance_m)),
    planned: Boolean(row.planned),
  }))
}
