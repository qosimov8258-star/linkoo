import "server-only"

import { getDb } from "@/lib/db"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { fieldEventTotals, listFieldEvents } from "@/lib/field-activity/events"
import { lastLocations } from "@/lib/field-activity/gps-repo"
import { dayStartMs } from "@/lib/field-activity/input"
import { dayTaskHistoryEnd, historyDayCounts, historyPlannedClientIds } from "@/lib/activity-history"
import { dayStatus } from "@/lib/field-activity/routes-repo"
import { MAX_PAGE_SIZE, type FieldEvent } from "@/lib/field-activity/types"
import { todayIso } from "@/lib/finance/dates"
import { lockedClientIds } from "@/lib/tracking-location-locks"
import { MAX_DAY_EVENTS, type TrackingClient, type TrackingDay, type TrackingEvent } from "@/lib/tracking-types"

// The day of one field employee for Отслеживание → agent detail ("Показать путь"): the
// planned route of the day (field_route_plans) merged with every event of the unified field
// stream (visits, refusals, photo reports, orders, deliveries, payments, returns), grouped per
// client, plus the stats row and the three counters. Everything comes from
// lib/field-activity, so the numbers agree with Активность.

const DAY_MS = 24 * 60 * 60_000

/** Until when the "last location" of a day is read: the day's end for a past day, else now. */
export function locationUntil(day: string): number {
  return day < todayIso() ? dayStartMs(day) + DAY_MS : Date.now()
}

function toTrackingEvent(event: FieldEvent): TrackingEvent {
  return {
    id: event.id,
    kind: event.kind,
    sourceId: event.sourceId,
    at: event.at,
    status: event.status,
    cancelled: event.cancelled,
    counted: event.counted,
    orderId: event.orderId,
    amount: event.amount,
    currency: event.currency,
    reason: event.reason,
    comment: event.comment,
    visit: event.visit,
    photos: event.photos,
  }
}

const nameKey = (name: string) => name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase()

/** Every event of the employee's day, oldest first (at most MAX_DAY_EVENTS). */
async function dayEvents(employeeId: number, day: string): Promise<{ events: FieldEvent[]; truncated: boolean }> {
  const events: FieldEvent[] = []
  let count = 0
  for (let offset = 0; offset < MAX_DAY_EVENTS; offset += MAX_PAGE_SIZE) {
    const page = await listFieldEvents({ from: day, to: day, employeeIds: [employeeId] }, { limit: MAX_PAGE_SIZE, offset })
    count = page.count
    events.push(...page.rows)
    if (page.rows.length < MAX_PAGE_SIZE || events.length >= count) break
  }
  // The stream is newest first; the timeline reads the day forwards.
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { events, truncated: count > events.length }
}

type ClientInfo = { name: string; address: string; landmark: string; lat: number | null; lng: number | null }

async function clientInfo(clientIds: number[]): Promise<Map<number, ClientInfo>> {
  const map = new Map<number, ClientInfo>()
  if (!clientIds.length) return map
  const rows = (await getDb()
    .prepare("SELECT id, name, COALESCE(address, '') AS address, COALESCE(landmark, '') AS landmark, location_lat, location_lng FROM clients WHERE id = ANY(@ids::int[])")
    .all({ ids: clientIds })) as Array<{ id: number; name: string | null; address: string; landmark: string; location_lat: number | null; location_lng: number | null }>
  for (const row of rows) {
    map.set(Number(row.id), {
      name: row.name ?? "",
      address: row.address ?? "",
      landmark: row.landmark ?? "",
      lat: row.location_lat === null ? null : Number(row.location_lat),
      lng: row.location_lng === null ? null : Number(row.location_lng),
    })
  }
  return map
}

/** The employee's day, or null when the employee does not exist. */
export async function trackingDay(employeeId: number, day: string): Promise<TrackingDay | null> {
  const [employee] = await listFieldEmployees({ activeOnly: false, employeeIds: [employeeId] })
  if (!employee) return null
  // Sequential on purpose: each helper may install its lazy schema first.
  const [status] = await dayStatus([employeeId], day)
  const { events, truncated } = await dayEvents(employeeId, day)
  const totals = await fieldEventTotals({ from: day, to: day, employeeIds: [employeeId], excludeCancelled: true })
  // Linko's «сделки» sum counts every order of the day, cancelled ones too («Заказ оформлен» only the counted ones).
  const allOrders = await fieldEventTotals({ from: day, to: day, kinds: ["order"], employeeIds: [employeeId], orders: "all" })
  const [location] = await lastLocations([employeeId], locationUntil(day))

  // A day copied from Linko follows Linko's own day plan (lib/activity-history.ts): its clients and its counts.
  const historyEnd = await dayTaskHistoryEnd()
  const fromHistory = historyEnd !== null && day <= historyEnd
  const historyCounts = fromHistory ? (await historyDayCounts([employeeId], day)).get(employeeId) : undefined
  const planned = fromHistory
    ? (await historyPlannedClientIds(employeeId, day)).map((clientId) => ({ clientId, clientName: "", address: "", lat: null, lng: null, routePosition: null }))
    : (status?.planned ?? [])
  const plannedIds = new Set(planned.map((client) => client.clientId))
  const groups = new Map<string, { clientId: number | null; clientName: string; events: FieldEvent[] }>()
  for (const event of events) {
    const key = event.clientId !== null ? String(event.clientId) : `name:${nameKey(event.clientName)}`
    const group = groups.get(key) ?? { clientId: event.clientId, clientName: event.clientName, events: [] }
    group.events.push(event)
    groups.set(key, group)
  }
  const knownIds = [...new Set([...plannedIds, ...[...groups.values()].flatMap((group) => (group.clientId !== null ? [group.clientId] : []))])]
  const [info, locked] = [await clientInfo(knownIds), await lockedClientIds(knownIds)]
  const plannedOf = new Map(planned.map((client) => [client.clientId, client]))

  const withEvents: TrackingClient[] = [...groups.entries()].map(([key, group]) => {
    const plan = group.clientId !== null ? plannedOf.get(group.clientId) : undefined
    const details = group.clientId !== null ? info.get(group.clientId) : undefined
    const visits = group.events.filter((event) => event.kind === "visit")
    const first = visits[0]?.visit ?? null
    const isPlanned = Boolean(plan)
    return {
      key,
      clientId: group.clientId,
      clientName: details?.name || plan?.clientName || group.clientName,
      address: details?.address ?? plan?.address ?? "",
      landmark: details?.landmark ?? "",
      lat: details?.lat ?? plan?.lat ?? null,
      lng: details?.lng ?? plan?.lng ?? null,
      planned: isPlanned,
      routePosition: plan?.routePosition ?? null,
      firstAt: group.events[0]?.at ?? null,
      visited: visits.length > 0,
      unplanned: visits.length > 0 && !isPlanned,
      refused: group.events.some((event) => event.kind === "refusal"),
      ordered: group.events.some((event) => event.kind === "order" && event.counted),
      distanceM: first?.distanceM ?? null,
      actualLat: first?.startLat ?? null,
      actualLng: first?.startLng ?? null,
      locationLocked: group.clientId !== null && locked.has(group.clientId),
      events: group.events.map(toTrackingEvent),
    }
  })
  withEvents.sort((a, b) => ((a.firstAt ?? "") < (b.firstAt ?? "") ? -1 : (a.firstAt ?? "") > (b.firstAt ?? "") ? 1 : a.key.localeCompare(b.key)))

  const pending: TrackingClient[] = planned
    .filter((client) => !groups.has(String(client.clientId)))
    .map((client) => {
      const details = info.get(client.clientId)
      return {
        key: String(client.clientId),
        clientId: client.clientId,
        clientName: details?.name || client.clientName,
        address: details?.address ?? client.address,
        landmark: details?.landmark ?? "",
        lat: details?.lat ?? client.lat,
        lng: details?.lng ?? client.lng,
        planned: true,
        routePosition: client.routePosition,
        firstAt: null,
        visited: false,
        unplanned: false,
        refused: false,
        ordered: false,
        distanceM: null,
        actualLat: null,
        actualLng: null,
        locationLocked: locked.has(client.clientId),
        events: [],
      }
    })

  const done = historyCounts?.done ?? status?.done ?? 0
  const todo = historyCounts?.todo ?? status?.todo ?? 0
  return {
    date: day,
    employee,
    location: location ?? null,
    baseCurrency: totals.baseCurrency,
    stats: {
      // The base currency first, then by code (the header prints them in this order).
      orders: {
        ...allOrders.byKind.order,
        byCurrency: [...allOrders.byKind.order.byCurrency].sort((a, b) =>
          a.currency === totals.baseCurrency ? -1 : b.currency === totals.baseCurrency ? 1 : a.currency.localeCompare(b.currency),
        ),
      },
      payments: totals.byKind.payment,
      returns: totals.byKind.return,
      reports: totals.byKind.photo_report.count,
      deliveries: totals.byKind.delivery.count,
      done,
      todo,
      unplanned: historyCounts?.unplanned ?? status?.unplanned ?? 0,
    },
    counters: {
      ordered: totals.byKind.order.count,
      refusals: totals.byKind.refusal.count,
      toVisit: Math.max(0, todo - done),
    },
    clients: [...withEvents, ...pending],
    truncated,
  }
}
