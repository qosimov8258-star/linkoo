// Shapes of the Отслеживание (agents tracking) API: the day of one field employee (timeline,
// stats, counters), the start / finish points of the route optimisation, and their limits.
// No server-only imports: the page components import these types and constants too.
//
// Times are local Asia/Tashkent "YYYY-MM-DDTHH:mm:ss" strings, days "YYYY-MM-DD"
// (lib/field-activity/types.ts).

import type { FieldEmployee, FieldEventKind, FieldPhoto, FieldVisitDetail, KindTotal, LastLocation } from "@/lib/field-activity/types"

/** Most events of one employee's day the timeline reads (the rest is reported as truncated). */
export const MAX_DAY_EVENTS = 2000

/** "Последняя локация" in the start / finish location choices (warehouses use their id). */
export const LAST_LOCATION_ID = 0

/** One event on a client card of the timeline (an entry of the unified field event stream). */
export type TrackingEvent = {
  /** `${kind}:${sourceId}` */
  id: string
  kind: FieldEventKind
  sourceId: number
  at: string
  /** Raw status of the source (order status text, payment accepted|pending, …). */
  status: string
  cancelled: boolean
  counted: boolean
  orderId: number | null
  amount: number | null
  currency: string | null
  reason: string
  comment: string
  visit: FieldVisitDetail | null
  photos: FieldPhoto[]
}

/** One client of the day: planned on the route and / or touched by an event. */
export type TrackingClient = {
  /** clientId as text, or "name:<client name>" for documents whose client is unknown. */
  key: string
  clientId: number | null
  clientName: string
  address: string
  /** Client location (null when the client has none). */
  lat: number | null
  lng: number | null
  /** On the employee's route for the day. */
  planned: boolean
  routePosition: number | null
  /** Time of the first event (null for a planned client nobody visited yet). */
  firstAt: string | null
  visited: boolean
  /** Visited without being on the day's route. */
  unplanned: boolean
  refused: boolean
  /** Has an order that counts as a sale (not cancelled / unconfirmed). */
  ordered: boolean
  /** Distance (m) between the client location and the first visit's check-in position. */
  distanceM: number | null
  /** Check-in position of the first visit. */
  actualLat: number | null
  actualLng: number | null
  /** "Блокировка локации" of the client. */
  locationLocked: boolean
  /** Oldest first. */
  events: TrackingEvent[]
}

export type TrackingDay = {
  date: string
  employee: FieldEmployee
  /** Last known position until the end of the day (now for today). */
  location: LastLocation | null
  baseCurrency: string
  stats: {
    /** Orders that count as sales (cancelled / unconfirmed excluded), per currency. */
    orders: KindTotal
    payments: KindTotal
    returns: KindTotal
    reports: number
    deliveries: number
    /** Planned clients visited / planned clients / visited clients that were not planned. */
    done: number
    todo: number
    unplanned: number
  }
  counters: {
    /** "Заказ оформлен": orders that count as sales. */
    ordered: number
    /** "Отказы" */
    refusals: number
    /** "Надо посетить": planned clients not visited yet. */
    toVisit: number
  }
  /** Clients with events in time order, then the planned clients nobody visited, in route order. */
  clients: TrackingClient[]
  /** True when the day had more than MAX_DAY_EVENTS events (only the first ones are shown). */
  truncated: boolean
}

/** A start / finish point of the route optimisation ("Последняя локация" or a warehouse). */
export type StartLocation = {
  /** LAST_LOCATION_ID for the agent's last location, else the warehouse id. */
  id: number
  /** Warehouse name; the last location's name is the i18n key "Последняя локация". */
  name: string
  lat: number
  lng: number
}

/** A row of GET /api/field-activity/employees (the sidebar list). */
export type TrackingAgentRow = FieldEmployee & {
  location: LastLocation | null
  done: number
  todo: number
  unplanned: number
}
