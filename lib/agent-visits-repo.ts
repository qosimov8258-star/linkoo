import "server-only"

import { listAttendance } from "@/lib/attendance-repo"
import { ensureAttendanceSchema } from "@/lib/attendance-schema"
import type { AttendanceType } from "@/lib/attendance-types"
import { getDb } from "@/lib/db"
import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { fieldEventTotals, listFieldEvents } from "@/lib/field-activity/events"
import { dayStartMs } from "@/lib/field-activity/input"
import { dayStatus, PLANNED_ON_DAY_SQL } from "@/lib/field-activity/routes-repo"
import { columnsOf, ensureFieldSchema } from "@/lib/field-activity/schema"
import { MAX_PAGE_SIZE, MAX_VISIT_MS } from "@/lib/field-activity/types"
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

export type RoutesBoard = { date: string; currency: string; problems: RouteBoardAgent[]; active: RouteBoardAgent[] }

/** The agents who visited clients on `date`: problem ones (idle > 30 min today) and the others. */
export async function getRoutesBoard(date: string, employeeIds?: number[]): Promise<RoutesBoard> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return { date, currency: "", problems: [], active: [] }
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
  if (!ids.length) return { date, currency: "", problems: [], active: [] }

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
  return { date, currency: totals.baseCurrency, problems, active }
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
}

export type AgentRouteSummary = { from: string; to: string; baseCurrency: string; agents: AgentRouteSummaryRow[] }

const emptyTotals = (): AgentRouteTotals => ({ visited: 0, effective: 0, refused: 0, sales: 0 })

/** Per employee: plan vs. visits on and off the route, refusals and sales of the period. */
export async function getAgentRouteSummary(from: string, to: string, employeeIds?: number[]): Promise<AgentRouteSummary> {
  return summarize(from, to, await clientDays(from, to, employeeIds), await orderFacts(from, to, employeeIds))
}

async function summarize(from: string, to: string, days: ClientDay[], { baseCurrency, orders }: { baseCurrency: string; orders: OrderFact[] }): Promise<AgentRouteSummary> {
  type Acc = { plan: number; route: AgentRouteTotals; outside: AgentRouteTotals; visitDays: Set<string>; clients: Set<string> }
  const acc = new Map<number, Acc>()
  const entry = (id: number) => {
    let value = acc.get(id)
    if (!value) acc.set(id, (value = { plan: 0, route: emptyTotals(), outside: emptyTotals(), visitDays: new Set(), clients: new Set() }))
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
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.employeeId - b.employeeId)
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

export type WorkTimeRow = {
  employeeId: number
  agent: string
  date: string
  /** "HH:mm" of the first visit start / the last visit end. */
  first: string
  last: string
  totalSec: number
  storeSec: number
  plan: number
  visitedPlan: number
  visitedOutside: number
  notVisited: number
  akb: number
  /** Counted orders of the day in `currency` (the base currency). */
  sales: number
  currency: string
}

/** Per employee and day with visits: first / last activity, time at the clients and the plan. */
export async function getWorkTime(begin: string, end: string, employeeIds?: number[]): Promise<WorkTimeRow[]> {
  const days = await clientDays(begin, end, employeeIds)
  const { baseCurrency, orders } = await orderFacts(begin, end, employeeIds)
  type Acc = { first: string; last: string; storeSec: number; plan: number; visitedPlan: number; visitedOutside: number; clients: Set<string>; sales: number }
  const acc = new Map<string, Acc>()
  const entry = (employeeId: number, day: string) => {
    const key = `${employeeId}|${day}`
    let value = acc.get(key)
    if (!value) acc.set(key, (value = { first: "", last: "", storeSec: 0, plan: 0, visitedPlan: 0, visitedOutside: 0, clients: new Set(), sales: 0 }))
    return value
  }
  for (const day of days) {
    const target = entry(day.employeeId, day.day)
    if (day.planned) target.plan += 1
    if (!day.visits) continue
    if (day.planned) target.visitedPlan += 1
    else target.visitedOutside += 1
    target.storeSec += day.storeSec
    if (day.firstStart && (!target.first || day.firstStart < target.first)) target.first = day.firstStart
    if (day.lastEnd && day.lastEnd > target.last) target.last = day.lastEnd
  }
  for (const order of orders) {
    const target = acc.get(`${order.employeeId}|${order.day}`)
    if (!target) continue
    target.sales += order.amountBase
    target.clients.add(order.clientKey)
  }
  const worked = [...acc.entries()].filter(([, value]) => value.first)
  const info = await agentInfo([...new Set(worked.map(([key]) => Number(key.split("|")[0])))])
  return worked
    .map(([key, value]): WorkTimeRow => {
      const [id, date] = key.split("|")
      const employeeId = Number(id)
      const span = Math.round((Date.parse(`${value.last}Z`) - Date.parse(`${value.first}Z`)) / 1000)
      return {
        employeeId,
        agent: info.get(employeeId)?.name ?? `#${employeeId}`,
        date,
        first: clock(value.first),
        last: clock(value.last),
        totalSec: Math.max(span, value.storeSec),
        storeSec: value.storeSec,
        plan: value.plan,
        visitedPlan: value.visitedPlan,
        visitedOutside: value.visitedOutside,
        notVisited: Math.max(value.plan - value.visitedPlan, 0),
        akb: value.clients.size,
        sales: roundMoney(value.sales),
        currency: baseCurrency,
      }
    })
    .sort((a, b) => a.agent.localeCompare(b.agent, "ru") || a.employeeId - b.employeeId || a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// The visit history of a client (Клиенты → ЗАДАЧИ)
// ---------------------------------------------------------------------------

export type ClientVisit = {
  visitId: number
  employeeId: number
  agent: string
  /** Local "YYYY-MM-DD HH:mm:ss". */
  startedAt: string
  durationSec: number
  /** order | refusal | photo_report | no_sale, or "open" while the visit goes on. */
  result: string
  /** The refusal type of a refusal visit. */
  refusal: string
  planned: boolean
}

/** Visits of one client that are not linked to an order (orders show in the order feed), newest first. */
export async function listClientVisits(clientId: number, limit = 40, employeeIds?: number[]): Promise<ClientVisit[]> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return []
  const db = getDb()
  const types = (await db.prepare("SELECT to_regclass('refusal_types') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  const rows = (await db
    .prepare(
      `SELECT v.id, v.employee_id, e.first_name, e.last_name,
              to_char(${local("v.started_at")}, 'YYYY-MM-DD HH24:MI:SS') AS started_text,
              CASE WHEN v.finished_at IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM (v.finished_at - v.started_at))::int END AS duration_sec,
              COALESCE(v.result, 'open') AS result,
              ${types?.ok ? "COALESCE(rt.name, fr.reason, '')" : "COALESCE(fr.reason, '')"} AS refusal,
              v.planned
         FROM field_visits v
         LEFT JOIN employees e ON e.id = v.employee_id
         LEFT JOIN field_refusals fr ON fr.visit_id = v.id
         ${types?.ok ? "LEFT JOIN refusal_types rt ON rt.id = fr.refusal_type_id" : ""}
        WHERE v.client_id = @clientId AND v.order_id IS NULL
          ${employeeIds ? "AND v.employee_id = ANY(@employeeIds::int[])" : ""}
        ORDER BY v.started_at DESC, v.id DESC
        LIMIT @limit`,
    )
    .all({ clientId, limit: Math.max(1, Math.min(200, Math.floor(limit))), employeeIds: employeeIds ?? [] })) as Array<{
    id: number
    employee_id: number
    first_name: string | null
    last_name: string | null
    started_text: string
    duration_sec: number
    result: string
    refusal: string
    planned: boolean
  }>
  return rows.map((row) => ({
    visitId: Number(row.id),
    employeeId: Number(row.employee_id),
    agent: nameOf(row) || `#${row.employee_id}`,
    startedAt: row.started_text,
    durationSec: Math.max(0, Number(row.duration_sec) || 0),
    result: row.result,
    refusal: row.refusal ?? "",
    planned: Boolean(row.planned),
  }))
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

/** Effective attendance days (manual > derived > today live, as Посещаемость shows them) counted per employee. */
async function attendanceTotals(begin: string, end: string): Promise<AttendanceUser[]> {
  const today = todayIso()
  const last = end < today ? end : today
  const start = await attendanceStart()
  const first = start && start > begin ? start : begin
  if (!start || first > last) return []
  const users = new Map<number, AttendanceUser>()
  let [year, month] = first.split("-").map(Number)
  const [lastYear, lastMonth] = last.split("-").map(Number)
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const data = await listAttendance({ year, month, search: "", branchIds: [] })
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

async function visitTotals(begin: string, end: string): Promise<FieldSummary["visits"]> {
  await ensureFieldSchema()
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*)::int AS visited, COUNT(*) FILTER (WHERE v.result = 'order')::int AS effective
         FROM field_visits v
        WHERE v.finished_at IS NOT NULL AND v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz`,
    )
    .get(utcBounds(begin, end))) as { visited: number; effective: number } | undefined
  const visited = Number(row?.visited) || 0
  const effective = Number(row?.effective) || 0
  return { visited, effective, successPercent: visited > 0 ? Math.round((effective / visited) * 100) : 0 }
}

/** Attendance tiles (employee-days on time / late / absent / day off) and the share of successful visits. */
export async function getFieldSummary(begin: string, end: string): Promise<FieldSummary> {
  const users = await attendanceTotals(begin, end)
  const total = (key: keyof AttendanceTotals) => users.reduce((sum, user) => sum + user[key], 0)
  return {
    attendance: { onTime: total("onTime"), late: total("late"), absent: total("absent"), weekend: total("weekend") },
    users,
    visits: await visitTotals(begin, end),
  }
}
