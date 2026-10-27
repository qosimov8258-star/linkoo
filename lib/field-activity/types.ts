// Shared types and limits of the field activity data (visits, refusals, photo reports,
// GPS track, planned routes) and of the events derived from documents. Used by the
// Активность and Отслеживание pages and by the mobile ingestion API. No server-only
// imports: client components may import the types and constants.
//
// Times are local Asia/Tashkent "YYYY-MM-DDTHH:mm:ss" strings, days "YYYY-MM-DD".

/** Main outcome of a finished visit. */
export const VISIT_RESULTS = ["order", "refusal", "photo_report", "no_sale"] as const
export type VisitResult = (typeof VISIT_RESULTS)[number]

/** Kinds of the unified event stream (lib/field-activity/events.ts). */
export const FIELD_EVENT_KINDS = ["order", "delivery", "payment", "return", "visit", "refusal", "photo_report"] as const
export type FieldEventKind = (typeof FIELD_EVENT_KINDS)[number]

/** Tracking role tabs ("Все" = every group). Classified from the job position name. */
export const FIELD_GROUPS = ["agent", "merch", "delivery", "collector", "other"] as const
export type FieldGroup = (typeof FIELD_GROUPS)[number]

/** A GPS point newer than this makes the employee "online". */
export const ONLINE_MINUTES = 10
/** Largest GPS batch of one request. */
export const MAX_GPS_BATCH = 1000
/** Device clock skew tolerated for "not in the future". */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000
/** Device data older than this is refused. */
export const MAX_DATA_AGE_DAYS = 31
/** Longest visit (start → finish). */
export const MAX_VISIT_MS = 24 * 60 * 60_000
/** Largest photo upload (the edge allows 2 MB per request). */
export const MAX_PHOTO_BYTES = 1_500_000
export const MAX_REFUSAL_PHOTOS = 5
export const MAX_REPORT_PHOTOS = 10
export const MAX_COMMENT = 1000
/** Largest page of a list helper. */
export const MAX_PAGE_SIZE = 500
/** Most GPS points one track read returns. */
export const MAX_TRACK_POINTS = 20_000

export type FieldPhoto = { id: number; url: string; slot: "refusal" | "before" | "after"; contentType: string }

export type FieldEmployee = {
  employeeId: number
  name: string
  position: string
  group: FieldGroup
  branch: string
  active: boolean
  showInTracking: boolean
  gpsCheck: boolean
  /** The account linked to the employee (users.employee_id), if any. */
  userId: number | null
  username: string | null
}

export type GpsPoint = {
  id: number
  at: string
  lat: number
  lng: number
  accuracy: number | null
  speed: number | null
  battery: number | null
}

export type LastLocation = {
  employeeId: number
  /** Last GPS point (null when the employee never sent one in range). */
  point: GpsPoint | null
  /** Latest GPS point or visit start / finish. */
  lastActivityAt: string | null
  /** Battery of the last GPS point that had one. */
  battery: number | null
  online: boolean
}

/** One event of the unified stream. `amount` is in `currency`; `amountBase` in the base currency. */
export type FieldEvent = {
  kind: FieldEventKind
  /** Unique within the stream: `${kind}:${sourceId}`. */
  id: string
  sourceId: number
  at: string
  day: string
  employeeId: number | null
  /** Current employee name, else the name the document stored. */
  employeeName: string
  clientId: number | null
  clientName: string
  orderId: number | null
  /** Raw status: order status text, payment accepted|pending, return status, visit open|finished, report status. */
  status: string
  /** Order / delivery of a cancelled order. */
  cancelled: boolean
  /** Order counts as a sale (not cancelled, not unconfirmed). */
  counted: boolean
  amount: number | null
  currency: string | null
  amountBase: number | null
  comment: string
  /** Refusal reason (current refusal type name, else the stored one). */
  reason: string
  refusalTypeId: number | null
  visitId: number | null
  lat: number | null
  lng: number | null
  photos: FieldPhoto[]
  /** Visit only. */
  visit: FieldVisitDetail | null
}

export type FieldVisitDetail = {
  startedAt: string
  finishedAt: string | null
  durationSec: number | null
  result: VisitResult | null
  planned: boolean
  startLat: number | null
  startLng: number | null
  endLat: number | null
  endLng: number | null
  clientLat: number | null
  clientLng: number | null
  distanceM: number | null
  refusalId: number | null
  reportId: number | null
}

export type FieldEventFilter = {
  /** Local days "YYYY-MM-DD", inclusive. */
  from: string
  to: string
  kinds?: FieldEventKind[]
  employeeIds?: number[]
  clientIds?: number[]
  /** Employees of this branch (employees.branch). */
  branchId?: number
  /** Clients of these client types (clients.type ↔ client_types). */
  clientTypeIds?: number[]
  /** Clients that have (true) / have no (false) live equipment (inventory_items). */
  withEquipment?: boolean
  /** Drop events whose employee is unknown. */
  onlyAttributed?: boolean
}

export type MoneyTotal = { currency: string; amount: number }

export type KindTotal = {
  count: number
  /** Σ amountBase (null when no event of the kind has an amount). */
  amountBase: number | null
  /** Σ amount per currency. */
  byCurrency: MoneyTotal[]
}

export type FieldTotals = {
  baseCurrency: string
  byKind: Record<FieldEventKind, KindTotal>
  /** Per employee (null = unattributed): counts and sums per kind, plus distinct visited clients. */
  byEmployee: Array<{ employeeId: number | null; byKind: Partial<Record<FieldEventKind, KindTotal>>; visitedClients: number }>
}

export type RoutePlan = {
  id: number
  employeeId: number
  clientId: number
  clientName: string
  /** ISO weekdays 1 (Monday) .. 7 (Sunday). */
  weekdays: number[]
  intervalWeeks: number
  startDate: string
  routePosition: number | null
}

export type PlannedClient = {
  clientId: number
  clientName: string
  address: string
  lat: number | null
  lng: number | null
  routePosition: number | null
}

export type DayStatus = {
  employeeId: number
  day: string
  planned: PlannedClient[]
  visitedClientIds: number[]
  done: number
  todo: number
  unplanned: number
}

/** ISO weekday (1 = Monday) → bit of field_route_plans.weekdays. */
export function weekdayBit(isoWeekday: number): number {
  return 1 << (isoWeekday - 1)
}

/** Bitmask → ISO weekdays. */
export function weekdaysOfMask(mask: number): number[] {
  const days: number[] = []
  for (let day = 1; day <= 7; day++) if (mask & weekdayBit(day)) days.push(day)
  return days
}

/** URL of a stored photo (served by GET /api/field-activity/photos/[id]). */
export function fieldPhotoUrl(id: number): string {
  return `/api/field-activity/photos/${id}`
}
