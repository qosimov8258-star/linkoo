// Helpers of the Отслеживание (agents) page: URL state, colours, day / time / money texts.
// No "use client" and no browser APIs: app/tracking/page.tsx parses the URL with these on the
// server, so the first render matches the client.

import { formatDayMonth, isIsoDay } from "@/lib/finance/dates"
import { formatMoney } from "@/lib/finance/currency"
import type { KindTotal } from "@/lib/field-activity/types"
import type { LanguageCode } from "@/lib/i18n/types"

export const TRACKING_GROUPS = ["all", "agent", "merch", "delivery", "collector"] as const
export type TrackingGroup = (typeof TRACKING_GROUPS)[number]

/** Sidebar role tabs (demo order) with their tooltip keys. */
export const GROUP_TABS: Array<{ id: TrackingGroup; label: string }> = [
  { id: "all", label: "Все" },
  { id: "agent", label: "Агенты" },
  { id: "merch", label: "Мерчендайзеры" },
  { id: "delivery", label: "Доставщики" },
  { id: "collector", label: "Инкассаторы" },
]

export const DETAIL_STATUSES = ["all", "visited", "refusal", "order", "no_plan_visit", "todo"] as const
export type DetailStatus = (typeof DETAIL_STATUSES)[number]

/** Status filter of the agent detail ("Показать фильтр"). */
export const STATUS_OPTIONS: Array<{ id: DetailStatus; label: string }> = [
  { id: "all", label: "Все" },
  { id: "visited", label: "Посещенные точки" },
  { id: "refusal", label: "Отказы" },
  { id: "order", label: "Заказы" },
  { id: "no_plan_visit", label: "Внеплановые визиты" },
  { id: "todo", label: "Надо посетить" },
]

export type TrackingUrlState = {
  date: string
  group: TrackingGroup
  search: string
  /** Agent detail (employees.id), null = the list. */
  agent: number | null
  /** "Фактический маршрут (трекер)": the GPS track. */
  showPolylineTrack: boolean
  /** "Факт. маршрут(визит)": planned clients and the visit closing points. */
  showVisitTrack: boolean
  /** "Факт. визит": the actual check-in positions. */
  showActualVisitTrack: boolean
  /** "Клиенты" */
  showMarkets: boolean
  /** "Зоны" */
  showZones: boolean
  /** "Показать маршрут": the planned route. */
  showPlanTrack: boolean
  staticStatus: DetailStatus
  hour: number | null
  minute: number | null
  endHour: number | null
  endMinute: number | null
}

type RawParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""

function flag(value: string, fallback: boolean): boolean {
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

function bounded(value: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(value)) return null
  const number = Number(value)
  return number <= max ? number : null
}

function validDay(value: string, today: string): string {
  if (!isIsoDay(value)) return today
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100 ? value : today
}

/** The page state of a query string (bad values fall back to the defaults). The menu opens the
 * page like the demo: visit track, actual visits and clients on; tracker and zones off. */
export function parseTrackingParams(params: RawParams, today: string): TrackingUrlState {
  const group = first(params.group)
  const status = first(params.staticStatus)
  const agentText = first(params.agent)
  const agent = /^\d{1,10}$/.test(agentText) && Number(agentText) > 0 && Number(agentText) <= 2_147_483_647 ? Number(agentText) : null
  const minuteOf = (value: string) => {
    const minute = bounded(value, 59)
    return minute !== null && minute % 5 === 0 ? minute : null
  }
  return {
    date: validDay(first(params.date), today),
    group: (TRACKING_GROUPS as readonly string[]).includes(group) ? (group as TrackingGroup) : "all",
    search: first(params.search).slice(0, 100),
    agent,
    showPolylineTrack: flag(first(params.showPolylineTrack), false),
    showVisitTrack: flag(first(params.showVisitTrack), true),
    showActualVisitTrack: flag(first(params.showActualVisitTrack), true),
    showMarkets: flag(first(params.showMarkets), true),
    showZones: flag(first(params.showZones), false),
    showPlanTrack: flag(first(params.showPlanTrack), false),
    staticStatus: (DETAIL_STATUSES as readonly string[]).includes(status) ? (status as DetailStatus) : "all",
    hour: bounded(first(params.hour), 23),
    minute: minuteOf(first(params.minute)),
    endHour: bounded(first(params.endHour), 23),
    endMinute: minuteOf(first(params.endMinute)),
  }
}

/** Query string of a page state ("?view=agents&date=…"). */
export function trackingSearch(state: TrackingUrlState): string {
  const params = new URLSearchParams({ view: "agents", date: state.date })
  if (state.group !== "all") params.set("group", state.group)
  if (state.search) params.set("search", state.search)
  if (state.agent !== null) params.set("agent", String(state.agent))
  params.set("showPolylineTrack", String(state.showPolylineTrack))
  params.set("showVisitTrack", String(state.showVisitTrack))
  params.set("showActualVisitTrack", String(state.showActualVisitTrack))
  params.set("showMarkets", String(state.showMarkets))
  params.set("showZones", String(state.showZones))
  if (state.showPlanTrack) params.set("showPlanTrack", "true")
  if (state.agent !== null) {
    if (state.staticStatus !== "all") params.set("staticStatus", state.staticStatus)
    if (state.hour !== null) params.set("hour", String(state.hour))
    if (state.minute !== null) params.set("minute", String(state.minute))
    if (state.endHour !== null) params.set("endHour", String(state.endHour))
    if (state.endMinute !== null) params.set("endMinute", String(state.endMinute))
  }
  return `?${params.toString()}`
}

const pad = (value: number) => String(value).padStart(2, "0")

/** `day` ("YYYY-MM-DD") moved by `days`. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

const capitalizeMonth = (text: string) => text.replace(/(\d+\s+)(\S)/u, (_, day: string, letter: string) => `${day}${letter.toUpperCase()}`)

/** "26 Октября 2026" / "26 Oktabr 2026" / "26 October 2026" (the sidebar's date). */
export function formatLongDay(day: string, language: LanguageCode): string {
  return `${capitalizeMonth(formatDayMonth(day, language))} ${day.slice(0, 4)}`
}

/** "22 октября 2026" (the detail's date pill). */
export function formatPillDay(day: string, language: LanguageCode): string {
  return `${formatDayMonth(day, language)} ${day.slice(0, 4)}`
}

/** Month title of the calendar: "октябрь - 2026". */
export function monthTitle(year: number, month: number, language: LanguageCode): string {
  const iso = `${year}-${pad(month)}-15`
  const name =
    language === "ru" || language === "en"
      ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15)))
      : formatDayMonth(iso, language).replace(/^\d+\s+/, "")
  return `${name} - ${year}`
}

/** "HH:mm" of a local "YYYY-MM-DDTHH:mm:ss". */
export const timeOf = (iso: string | null | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : "")

/** "HH:mm:ss" of a local "YYYY-MM-DDTHH:mm:ss". */
export const secondsOf = (iso: string | null | undefined) => (iso && iso.length >= 19 ? iso.slice(11, 19) : timeOf(iso))

/** Minutes since midnight of a local timestamp. */
export const minuteOfDay = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))

const AGENT_COLORS = ["#ffc107", "#9c27b0", "#f44336", "#03a9f4", "#4caf50", "#ff5722", "#3f51b5", "#009688", "#e91e63", "#795548", "#607d8b", "#8bc34a"]

/** Stable map colour of an employee. */
export const agentColor = (employeeId: number) => AGENT_COLORS[Math.abs(employeeId) % AGENT_COLORS.length]

/** Battery fill: red when low, orange when half-empty, green otherwise. */
export function batteryColor(level: number): string {
  if (level <= 15) return "#f44336"
  if (level <= 30) return "#f0ad4e"
  return "#81c784"
}

/** Distance colour between the client and the check-in: green near, yellow farther, red far. */
export function distanceColor(meters: number): string {
  if (meters <= 50) return "#3ac977"
  if (meters <= 300) return "#dde007"
  return "#ff5e5e"
}

/** Money of a kind total per currency ("1 200 SUM", "50 USD"), or "0 <base>" when empty. */
export function moneyLines(total: KindTotal | undefined, baseCurrency: string): string[] {
  const lines = (total?.byCurrency ?? []).filter((entry) => entry.amount !== 0).map((entry) => `${formatMoney(entry.amount)} ${entry.currency}`)
  return lines.length ? lines : [`0 ${baseCurrency}`.trim()]
}

/** Map colours of the legend (demo). */
export const MAP_COLORS = {
  tracker: "#b010f0",
  trackerLine: "#b51eff",
  planned: "#50d040",
  visitClose: "#004070",
  unplanned: "#d06000",
  refusal: "#e02020",
  actual: "#707070",
  planRoute: "#022bb1",
} as const
