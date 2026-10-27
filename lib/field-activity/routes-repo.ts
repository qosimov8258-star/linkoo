import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { FieldError, FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { dayStartMs, type RouteClientsInput, type RoutePlanInput } from "@/lib/field-activity/input"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { weekdayBit, weekdaysOfMask, type DayStatus, type PlannedClient, type RoutePlan } from "@/lib/field-activity/types"

// Planned routes ("visit days"): employee E visits client C on the weekdays of the mask,
// every `interval_weeks` weeks counted from the week of start_date. A day's plan is resolved
// on read (plannedClients). Plans of a client or employee that no longer exists are ignored.

const DAY_MS = 24 * 60 * 60_000

/** SQL: the plan row `rp` puts its client on the local day @day. */
export const PLANNED_ON_DAY_SQL = `(rp.weekdays & (1 << (EXTRACT(ISODOW FROM @day::date)::int - 1))) <> 0
  AND rp.start_date <= @day::date
  AND MOD(((date_trunc('week', @day::date)::date - date_trunc('week', rp.start_date)::date) / 7), rp.interval_weeks) = 0`

type PlanRow = {
  id: number
  employee_id: number
  client_id: number
  client_name: string
  weekdays: number
  interval_weeks: number
  start_date: string
  route_position: number | null
}

const PLAN_SELECT = `SELECT rp.id, rp.employee_id, rp.client_id, c.name AS client_name, rp.weekdays, rp.interval_weeks,
    to_char(rp.start_date, 'YYYY-MM-DD') AS start_date, rp.route_position
  FROM field_route_plans rp
  JOIN clients c ON c.id = rp.client_id
  JOIN employees e ON e.id = rp.employee_id`

function rowToPlan(row: PlanRow): RoutePlan {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    clientId: Number(row.client_id),
    clientName: row.client_name ?? "",
    weekdays: weekdaysOfMask(Number(row.weekdays)),
    intervalWeeks: Number(row.interval_weeks),
    startDate: row.start_date,
    routePosition: row.route_position === null ? null : Number(row.route_position),
  }
}

/** Route plans, optionally of one employee / one client, in route order. */
export async function listRoutePlans(filter: { employeeIds?: number[]; clientId?: number } = {}): Promise<RoutePlan[]> {
  await ensureFieldSchema()
  if (filter.employeeIds && !filter.employeeIds.length) return []
  const where: string[] = []
  if (filter.employeeIds) where.push("rp.employee_id = ANY(@employeeIds::int[])")
  if (filter.clientId) where.push("rp.client_id = @clientId")
  const sql = `${PLAN_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY rp.employee_id, rp.route_position NULLS LAST, c.name, rp.client_id`
  // Named parameters only when the statement has any (an unused one would be sent as a bind value).
  const rows = (await getDb()
    .prepare(sql)
    .all(...(where.length ? [{ employeeIds: filter.employeeIds ?? [], clientId: filter.clientId ?? 0 }] : []))) as PlanRow[]
  return rows.map(rowToPlan)
}

async function lockRoutes(tx: PgDb, employeeId: number) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:field:routes:' || @employeeId::text))").get({ employeeId })
}

/** The employee must exist and be active (400 otherwise); its row is share-locked. */
async function assertEmployee(tx: PgDb, employeeId: number) {
  const row = (await tx.prepare("SELECT active FROM employees WHERE id = ? FOR SHARE").get(employeeId)) as { active: number } | undefined
  if (!row) throw new FieldError(FIELD_MESSAGES.employeeNotFound, 400, { field: "employeeId" })
  if (Number(row.active) !== 1) throw new FieldError(FIELD_MESSAGES.employeeInactive, 400, { field: "employeeId" })
}

/** Every client must exist (400 with the first missing id); rows are share-locked. */
async function assertClients(tx: PgDb, clientIds: number[]) {
  const rows = (await tx.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[]) ORDER BY id FOR SHARE").all({ ids: clientIds })) as Array<{ id: number }>
  const found = new Set(rows.map((row) => Number(row.id)))
  const missing = clientIds.find((id) => !found.has(id))
  if (missing !== undefined) throw new FieldError(FIELD_MESSAGES.clientNotFound, 400, { field: "clientIds", clientId: missing })
}

/** Creates or replaces the plans of the employee for the clients (weekdays, interval, start). */
export async function upsertRoutePlans(input: RoutePlanInput, userId: number): Promise<RoutePlan[]> {
  await ensureFieldSchema()
  const clientIds = [...new Set(input.clientIds)]
  const mask = [...new Set(input.weekdays)].reduce((sum, day) => sum | weekdayBit(day), 0)
  const startDate = input.startDate ?? todayIso()
  await withTransaction(async (tx) => {
    await lockRoutes(tx, input.employeeId)
    await assertEmployee(tx, input.employeeId)
    await assertClients(tx, clientIds)
    await tx
      .prepare(
        `INSERT INTO field_route_plans (employee_id, client_id, weekdays, interval_weeks, start_date, created_by)
         SELECT @employeeId, c, @mask, @interval, @startDate::date, @userId FROM unnest(@clientIds::int[]) AS c
         ON CONFLICT (employee_id, client_id) DO UPDATE
           SET weekdays = EXCLUDED.weekdays, interval_weeks = EXCLUDED.interval_weeks, start_date = EXCLUDED.start_date, updated_at = now()
         RETURNING id`,
      )
      .all({ employeeId: input.employeeId, mask, interval: input.intervalWeeks ?? 1, startDate, userId, clientIds })
  })
  const plans = await listRoutePlans({ employeeIds: [input.employeeId] })
  const wanted = new Set(clientIds)
  return plans.filter((plan) => wanted.has(plan.clientId))
}

/** Removes the employee's plans for the clients; the number of removed plans. */
export async function removeRoutePlans(input: RouteClientsInput): Promise<number> {
  await ensureFieldSchema()
  return withTransaction(async (tx) => {
    await lockRoutes(tx, input.employeeId)
    const result = await tx
      .prepare("DELETE FROM field_route_plans WHERE employee_id = @employeeId AND client_id = ANY(@clientIds::int[]) RETURNING id")
      .all({ employeeId: input.employeeId, clientIds: [...new Set(input.clientIds)] })
    return result.length
  })
}

/** Sets the route order of the employee's planned clients: positions 1..n in the given order.
 * Every client must be planned for the employee (400 otherwise). */
export async function reorderRoutePlans(input: RouteClientsInput): Promise<RoutePlan[]> {
  await ensureFieldSchema()
  const clientIds = [...new Set(input.clientIds)]
  await withTransaction(async (tx) => {
    await lockRoutes(tx, input.employeeId)
    const rows = (await tx
      .prepare("SELECT client_id FROM field_route_plans WHERE employee_id = @employeeId AND client_id = ANY(@clientIds::int[]) FOR UPDATE")
      .all({ employeeId: input.employeeId, clientIds })) as Array<{ client_id: number }>
    const planned = new Set(rows.map((row) => Number(row.client_id)))
    const missing = clientIds.find((id) => !planned.has(id))
    if (missing !== undefined) throw new FieldError(FIELD_MESSAGES.notPlanned, 400, { field: "clientIds", clientId: missing })
    await tx
      .prepare(
        `UPDATE field_route_plans rp SET route_position = o.position, updated_at = now()
           FROM unnest(@clientIds::int[]) WITH ORDINALITY AS o(client_id, position)
          WHERE rp.employee_id = @employeeId AND rp.client_id = o.client_id`,
      )
      .run({ employeeId: input.employeeId, clientIds })
  })
  return listRoutePlans({ employeeIds: [input.employeeId] })
}

/** Whether the client is on the employee's route on the local day (inside or outside a transaction). */
export async function isPlanned(db: PgDb, employeeId: number, clientId: number, day: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM field_route_plans rp WHERE rp.employee_id = @employeeId AND rp.client_id = @clientId AND ${PLANNED_ON_DAY_SQL}`)
    .get({ employeeId, clientId, day })
  return Boolean(row)
}

/** The clients each employee must visit on the local day, in route order. */
export async function plannedClients(employeeIds: number[] | undefined, day: string): Promise<Map<number, PlannedClient[]>> {
  await ensureFieldSchema()
  const result = new Map<number, PlannedClient[]>()
  if (employeeIds && !employeeIds.length) return result
  const rows = (await getDb()
    .prepare(
      `SELECT rp.employee_id, rp.client_id, c.name, COALESCE(c.address, '') AS address, c.location_lat, c.location_lng, rp.route_position
         FROM field_route_plans rp
         JOIN clients c ON c.id = rp.client_id
         JOIN employees e ON e.id = rp.employee_id
        WHERE ${employeeIds ? "rp.employee_id = ANY(@employeeIds::int[]) AND " : ""}${PLANNED_ON_DAY_SQL}
        ORDER BY rp.employee_id, rp.route_position NULLS LAST, c.name, rp.client_id`,
    )
    .all({ employeeIds: employeeIds ?? [], day })) as Array<{
    employee_id: number
    client_id: number
    name: string
    address: string
    location_lat: number | null
    location_lng: number | null
    route_position: number | null
  }>
  for (const row of rows) {
    const list = result.get(Number(row.employee_id)) ?? []
    list.push({
      clientId: Number(row.client_id),
      clientName: row.name ?? "",
      address: row.address ?? "",
      lat: row.location_lat === null ? null : Number(row.location_lat),
      lng: row.location_lng === null ? null : Number(row.location_lng),
      routePosition: row.route_position === null ? null : Number(row.route_position),
    })
    result.set(Number(row.employee_id), list)
  }
  return result
}

/** Plan vs. visits of each employee on the local day (see design §5). `employeeIds`
 * undefined = every employee that has a plan or a visit that day. */
export async function dayStatus(employeeIds: number[] | undefined, day: string): Promise<DayStatus[]> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return []
  const planned = await plannedClients(employeeIds, day)
  const start = new Date(dayStartMs(day)).toISOString()
  const end = new Date(dayStartMs(day) + DAY_MS).toISOString()
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT v.employee_id, v.client_id FROM field_visits v
        WHERE v.started_at >= @start::timestamptz AND v.started_at < @end::timestamptz
          ${employeeIds ? "AND v.employee_id = ANY(@employeeIds::int[])" : ""}`,
    )
    .all({ start, end, employeeIds: employeeIds ?? [] })) as Array<{ employee_id: number; client_id: number }>
  const visited = new Map<number, number[]>()
  for (const row of rows) visited.set(Number(row.employee_id), [...(visited.get(Number(row.employee_id)) ?? []), Number(row.client_id)])
  const ids = employeeIds ?? [...new Set([...planned.keys(), ...visited.keys()])].sort((a, b) => a - b)
  return ids.map((employeeId) => {
    const plan = planned.get(employeeId) ?? []
    const seen = visited.get(employeeId) ?? []
    const plannedIds = new Set(plan.map((client) => client.clientId))
    const done = seen.filter((id) => plannedIds.has(id)).length
    return { employeeId, day, planned: plan, visitedClientIds: seen, done, todo: plan.length, unplanned: seen.length - done }
  })
}
