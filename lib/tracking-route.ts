import "server-only"

import { z } from "zod"

import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { getDb } from "@/lib/db"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { lastLocations } from "@/lib/field-activity/gps-repo"
import { haversineMeters } from "@/lib/field-activity/input"
import { plannedClients, reorderRoutePlans } from "@/lib/field-activity/routes-repo"
import type { PlannedClient } from "@/lib/field-activity/types"
import { isIsoDay } from "@/lib/finance/dates"
import { dbId } from "@/lib/strict-number"
import { locationUntil } from "@/lib/tracking-day"
import { LAST_LOCATION_ID, type StartLocation } from "@/lib/tracking-types"
import { ensureWarehousesSchema } from "@/lib/warehouses-repo"

// Route optimisation of Отслеживание ("ОПТИМИЗАЦИЯ МАРШРУТА"): the day's planned clients of an
// employee are put in a short visiting order — a nearest-neighbour tour from the chosen start
// (a start client, the agent's last location or a warehouse), improved by 2-opt, ending at the
// chosen finish client / finish location — and saved as the route order (route_position of
// field_route_plans, through reorderRoutePlans: advisory lock + row locks + re-check).
// No external routing service: distances are great-circle (haversine).

export const ROUTE_MESSAGES = {
  noPlans: "Для выбранного агента в эту дату не найдено планов",
  sameClient: "Стартовый и финишный магазин совпадают",
  warehouseNotFound: "Склад не найден",
  warehouseNoLocation: "У склада нет координат",
  noLastLocation: "Нет последней локации агента",
} as const

export class TrackingRouteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message)
    this.name = "TrackingRouteError"
  }
}

const INVALID_DATE = "Неверная дата"

const optionalId = (message: string, allowZero = false) => dbId(message, { allowZero }).nullable().optional()

/** POST /api/tracking/agents/[id]/optimize */
export const optimizeSchema = z.object({
  date: z
    .string({ error: INVALID_DATE })
    .trim()
    .refine((value) => isIsoDay(value) && Number(value.slice(0, 4)) >= DOC_MIN_YEAR && Number(value.slice(0, 4)) <= DOC_MAX_YEAR, INVALID_DATE),
  startClientId: optionalId(FIELD_MESSAGES.clientNotFound),
  finishClientId: optionalId(FIELD_MESSAGES.clientNotFound),
  startLocationId: optionalId(ROUTE_MESSAGES.warehouseNotFound, true),
  finishLocationId: optionalId(ROUTE_MESSAGES.warehouseNotFound, true),
})

export type OptimizeInput = z.infer<typeof optimizeSchema>

type Point = { lat: number; lng: number }

const located = (lat: number | null | undefined, lng: number | null | undefined): Point | null =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null

/** Active warehouses with coordinates, by name. */
async function warehousePoints(): Promise<StartLocation[]> {
  await ensureWarehousesSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT id, name, lat, lon FROM warehouses
        WHERE COALESCE(active, 1) = 1 AND lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY lower(name), id`,
    )
    .all()) as Array<{ id: number; name: string; lat: number; lon: number }>
  return rows.flatMap((row) => {
    const point = located(Number(row.lat), Number(row.lon))
    return point ? [{ id: Number(row.id), name: row.name ?? "", lat: point.lat, lng: point.lng }] : []
  })
}

/** The start / finish choices: the agent's last location of the day (when known), then the warehouses. */
export async function startLocations(employeeId: number, day: string): Promise<StartLocation[]> {
  const [location] = await lastLocations([employeeId], locationUntil(day))
  const last = located(location?.point?.lat, location?.point?.lng)
  const warehouses = await warehousePoints()
  return [...(last ? [{ id: LAST_LOCATION_ID, name: "Последняя локация", lat: last.lat, lng: last.lng }] : []), ...warehouses]
}

async function locationPoint(employeeId: number, day: string, id: number, field: string): Promise<Point> {
  if (id === LAST_LOCATION_ID) {
    const [location] = await lastLocations([employeeId], locationUntil(day))
    const point = located(location?.point?.lat, location?.point?.lng)
    if (!point) throw new TrackingRouteError(ROUTE_MESSAGES.noLastLocation, 400, field)
    return point
  }
  await ensureWarehousesSchema()
  const row = (await getDb().prepare("SELECT lat, lon, COALESCE(active, 1) AS active FROM warehouses WHERE id = ?").get(id)) as
    | { lat: number | null; lon: number | null; active: number }
    | undefined
  if (!row || Number(row.active) !== 1) throw new TrackingRouteError(ROUTE_MESSAGES.warehouseNotFound, 400, field)
  const point = located(row.lat === null ? null : Number(row.lat), row.lon === null ? null : Number(row.lon))
  if (!point) throw new TrackingRouteError(ROUTE_MESSAGES.warehouseNoLocation, 400, field)
  return point
}

const distance = (a: Point, b: Point) => haversineMeters(a.lat, a.lng, b.lat, b.lng)

/** Total length of origin → tour → end (missing ends are skipped). */
function tourLength(tour: Point[], origin: Point | null, end: Point | null): number {
  const path = [...(origin ? [origin] : []), ...tour, ...(end ? [end] : [])]
  let total = 0
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1], path[i])
  return total
}

/** Nearest-neighbour order of the clients from `origin` (from the first client when null). */
function nearestNeighbour<T extends { point: Point }>(items: T[], origin: Point | null): T[] {
  const rest = [...items]
  const order: T[] = []
  let current = origin
  while (rest.length) {
    let best = 0
    if (current) {
      let bestDistance = Infinity
      rest.forEach((item, index) => {
        const d = distance(current as Point, item.point)
        if (d < bestDistance) {
          bestDistance = d
          best = index
        }
      })
    }
    const [next] = rest.splice(best, 1)
    order.push(next)
    current = next.point
  }
  return order
}

/** 2-opt improvement of an open path with fixed ends (bounded work). */
function twoOpt<T extends { point: Point }>(tour: T[], origin: Point | null, end: Point | null): T[] {
  if (tour.length < 3 || tour.length > 400) return tour
  let best = [...tour]
  let bestLength = tourLength(best.map((item) => item.point), origin, end)
  for (let pass = 0; pass < 30; pass++) {
    let improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        const length = tourLength(candidate.map((item) => item.point), origin, end)
        if (length + 0.5 < bestLength) {
          best = candidate
          bestLength = length
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return best
}

/**
 * Optimises and saves the route order of the employee's planned clients of `input.date`.
 * Returns the client ids in the new order.
 */
export async function optimizeRoute(employeeId: number, input: OptimizeInput): Promise<number[]> {
  const employee = (await getDb().prepare("SELECT active FROM employees WHERE id = ?").get(employeeId)) as { active: number } | undefined
  if (!employee) throw new TrackingRouteError(FIELD_MESSAGES.employeeNotFound, 404)
  if (Number(employee.active) !== 1) throw new TrackingRouteError(FIELD_MESSAGES.employeeInactive, 400)
  const planned: PlannedClient[] = (await plannedClients([employeeId], input.date)).get(employeeId) ?? []
  if (!planned.length) throw new TrackingRouteError(ROUTE_MESSAGES.noPlans, 400)
  const byId = new Map(planned.map((client) => [client.clientId, client]))
  const startClient = input.startClientId ? byId.get(input.startClientId) : undefined
  const finishClient = input.finishClientId ? byId.get(input.finishClientId) : undefined
  if (input.startClientId && !startClient) throw new TrackingRouteError(FIELD_MESSAGES.notPlanned, 400, "startClientId")
  if (input.finishClientId && !finishClient) throw new TrackingRouteError(FIELD_MESSAGES.notPlanned, 400, "finishClientId")
  if (startClient && finishClient && startClient.clientId === finishClient.clientId && planned.length > 1) {
    throw new TrackingRouteError(ROUTE_MESSAGES.sameClient, 400, "finishClientId")
  }

  const hasStart = input.startLocationId !== undefined && input.startLocationId !== null
  const hasFinish = input.finishLocationId !== undefined && input.finishLocationId !== null
  const startPoint = hasStart ? await locationPoint(employeeId, input.date, input.startLocationId as number, "startLocationId") : null
  const finishPoint = hasFinish ? await locationPoint(employeeId, input.date, input.finishLocationId as number, "finishLocationId") : null

  const fixed = new Set([startClient?.clientId, finishClient?.clientId].filter((id): id is number => id !== undefined))
  const middle = planned.filter((client) => !fixed.has(client.clientId))
  const withPoint = middle.flatMap((client) => {
    const point = located(client.lat, client.lng)
    return point ? [{ client, point }] : []
  })
  const withoutPoint = middle.filter((client) => !located(client.lat, client.lng))
  const origin = (startClient && located(startClient.lat, startClient.lng)) || startPoint
  const end = (finishClient && located(finishClient.lat, finishClient.lng)) || finishPoint
  const tour = twoOpt(nearestNeighbour(withPoint, origin), origin, end)

  const order = [
    ...(startClient ? [startClient.clientId] : []),
    ...tour.map((item) => item.client.clientId),
    ...withoutPoint.map((client) => client.clientId),
    ...(finishClient && finishClient.clientId !== startClient?.clientId ? [finishClient.clientId] : []),
  ]
  await reorderRoutePlans({ employeeId, clientIds: order })
  return order
}
