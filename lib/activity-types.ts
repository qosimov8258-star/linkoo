// Активность (Personal → Контроль → Активность, /analytics/activity): shared types, limits
// and the page's URL state. No server-only imports: the client page imports this file.
//
// The page reads the field event stream of lib/field-activity (orders, refusals, photo
// reports, client returns, client payments, deliveries) through /api/activity/board (agent
// strip + column header totals) and /api/activity/feed (one page of one column). Days are
// local Asia/Tashkent "YYYY-MM-DD"; event times local "YYYY-MM-DDTHH:mm:ss".

import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import type { FieldPhoto, KindTotal, MoneyTotal } from "@/lib/field-activity/types"

/** The board's columns, in the demo's fixed order (ActivityWrapper). */
export const ACTIVITY_COLUMNS = ["order", "refusal", "photo_report", "return", "payment", "delivery"] as const
export type ActivityColumn = (typeof ACTIVITY_COLUMNS)[number]

/** Cards per column page (the demo's ACTIVITY_PAGE_SIZE). */
export const ACTIVITY_PAGE_SIZE = 25
/** Largest page /api/activity/feed serves. */
export const ACTIVITY_MAX_PAGE_SIZE = 100
/** Most client types one filter may name. */
export const ACTIVITY_MAX_CLIENT_TYPES = 100
/** Longest period (days apart), the same bound as the field event API. */
export const ACTIVITY_MAX_RANGE_DAYS = 366

export function isActivityColumn(value: unknown): value is ActivityColumn {
  return typeof value === "string" && (ACTIVITY_COLUMNS as readonly string[]).includes(value)
}

/** One card of the agent strip. */
export type ActivityAgent = {
  employeeId: number
  name: string
  active: boolean
  /** Visits (check-ins at clients) in the period. */
  visits: number
  /** Distinct clients visited in the period. */
  visitedClients: number
  /** Counted orders of the agent in the period, per currency (never mixed). */
  sales: MoneyTotal[]
}

/** GET /api/activity/board */
export type ActivityBoard = {
  from: string
  to: string
  baseCurrency: string
  /** The agent the column totals are narrowed to (null = everyone). */
  employeeId: number | null
  /** "Все" = Σ visits of the strip's agents. */
  totalVisits: number
  /** Column header totals (same filter as the feed, so a count equals the cards it can load). */
  columns: Record<ActivityColumn, KindTotal>
  agents: ActivityAgent[]
}

/** One card of a column. */
export type ActivityCard = {
  id: string
  kind: ActivityColumn
  /** Order / return / payment / refusal / report / delivered order number. */
  sourceId: number
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  at: string
  employeeId: number | null
  employeeName: string
  clientId: number | null
  clientName: string
  orderId: number | null
  status: string
  amount: number | null
  currency: string | null
  comment: string
  /** Refusal reason (refusal type name). */
  reason: string
  photos: FieldPhoto[]
}

/** GET /api/activity/feed */
export type ActivityFeedPage = {
  column: ActivityColumn
  count: number
  page: number
  pageSize: number
  hasMore: boolean
  baseCurrency: string
  rows: ActivityCard[]
}

// ---------------------------------------------------------------------------------------
// Days (pure string math on "YYYY-MM-DD"; no browser time zone involved)

const DAY_MS = 24 * 60 * 60_000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (value: number) => String(value).padStart(2, "0")

/** A real calendar day "YYYY-MM-DD" with a year in DOC_MIN_YEAR..DOC_MAX_YEAR. */
export function isActivityDay(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = DAY.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (y < DOC_MIN_YEAR || y > DOC_MAX_YEAR) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function dayMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

function dayOf(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function shiftDay(day: string, days: number): string {
  return dayOf(dayMs(day) + days * DAY_MS)
}

/** Days between two days (to − from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS)
}

/** First day of the month of `day`, moved by `months`. */
export function monthStart(day: string, months = 0): string {
  const [y, m] = day.split("-").map(Number)
  return dayOf(Date.UTC(y, m - 1 + months, 1))
}

/** Last day of the month of `day`, moved by `months`. */
export function monthEnd(day: string, months = 0): string {
  const [y, m] = day.split("-").map(Number)
  return dayOf(Date.UTC(y, m + months, 0))
}

/** ISO weekday (1 = Monday .. 7 = Sunday). */
export function weekdayOf(day: string): number {
  const weekday = new Date(dayMs(day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

/** A valid period: both days valid, from ≤ to, at most ACTIVITY_MAX_RANGE_DAYS apart. */
export function isActivityPeriod(from: string, to: string): boolean {
  return isActivityDay(from) && isActivityDay(to) && from <= to && daysBetween(from, to) <= ACTIVITY_MAX_RANGE_DAYS
}

// ---------------------------------------------------------------------------------------
// URL state of /analytics/activity (the demo keeps all of it in the query string)

export type ActivityState = {
  from: string
  to: string
  /** Selected agent card (employees.id). */
  agentId: number | null
  /** Client type filter (client_types.id). */
  clientTypes: number[]
  /** "Магазин с оборудованием": true = Да, false = Нет, null = any. */
  withGear: boolean | null
  /** Open order dialog. */
  orderId: number | null
  /** Open client card (clients.id), the demo's openShop. */
  shopId: number | null
}

const MAX_ID = 2_147_483_647

function idOf(text: string | null): number | null {
  const value = (text ?? "").trim()
  if (!/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id > 0 && id <= MAX_ID ? id : null
}

/** The page state of a query string; anything malformed falls back to its default. */
export function parseActivityState(params: URLSearchParams, today: string): ActivityState {
  const fromText = params.get("fromDate") ?? ""
  const toText = params.get("toDate") ?? ""
  const period = isActivityPeriod(fromText, toText) ? { from: fromText, to: toText } : { from: today, to: today }
  const types = new Set<number>()
  for (const part of (params.get("marketType") ?? "").split(",")) {
    const id = idOf(part)
    if (id !== null && types.size < ACTIVITY_MAX_CLIENT_TYPES) types.add(id)
  }
  const gear = (params.get("withGear") ?? "").trim().toLowerCase()
  return {
    ...period,
    agentId: idOf(params.get("agentId")),
    clientTypes: [...types],
    withGear: gear === "yes" ? true : gear === "no" ? false : null,
    orderId: idOf(params.get("orderDetails")),
    shopId: idOf(params.get("openShop")),
  }
}

/** The query string of a page state (defaults are left out). */
export function activitySearch(state: ActivityState, today: string): string {
  const params = new URLSearchParams()
  if (state.from !== today || state.to !== today) {
    params.set("fromDate", state.from)
    params.set("toDate", state.to)
  }
  if (state.agentId !== null) params.set("agentId", String(state.agentId))
  if (state.clientTypes.length) params.set("marketType", state.clientTypes.join(","))
  if (state.withGear !== null) params.set("withGear", state.withGear ? "yes" : "no")
  if (state.orderId !== null) params.set("orderDetails", String(state.orderId))
  if (state.shopId !== null) params.set("openShop", String(state.shopId))
  return params.toString()
}

/** The API filter of a page state (without the agent: the strip ignores it). */
export function activityFilterQuery(state: Pick<ActivityState, "from" | "to" | "clientTypes" | "withGear">): URLSearchParams {
  const params = new URLSearchParams({ from: state.from, to: state.to })
  if (state.clientTypes.length) params.set("clientTypeId", state.clientTypes.join(","))
  if (state.withGear !== null) params.set("withEquipment", state.withGear ? "true" : "false")
  return params
}
