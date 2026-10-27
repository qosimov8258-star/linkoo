"use client"

import { useEffect, useState } from "react"

// The day of the selected agent of the tracking map: the tracker points, the client plans and the totals — one request per agent and day.

export type TrackPoint = [number, number, string]

export type PlanTask = {
  id: number
  text: string
  status: "done" | "undone" | "pending" | string
  type: string
  order_id: number | null
  quiz_id: number | null
  merch_report_id: number | null
  service_time_id: number | null
  done_time: string | null
  lat: string | null
  lon: string | null
  created_mobile_time: string | null
  response: string | null
  image_url: string | null
  rejection_image?: string | null
  merch_images?: string[] | null
  distance_from_market?: number | null
  service_time?: { start_time: string; end_time: string; difference_time: string; start_location?: { lat: number; lon: number } | null; end_location?: { lat: number; lon: number } | null; audio_record_url?: string | null }
}

export type PlanItem = {
  id?: number
  market: { id: number; name: string; address?: string | null; guide?: string | null; location?: { lat: number; lon: number } | null }
  route_position: number | null
  plans: PlanTask[]
  distance: number | null
  location: { lat: number; lon: number } | null
  status?: string
}

export type DayStats = {
  visit_tasks: number
  visit_done_tasks: number
  no_plan_count: number
  report_tasks: number
  report_done_tasks: number
  deleveriy_tasks: number
  delivery_done_tasks: number
  order_total_price: number
  client_transaction_total_price: number
  order_return_total_price: number
  start_location: { lat: number; lon: number } | null
  end_location: { lat: number; lon: number } | null
}

export type AgentDay = { track: TrackPoint[]; plans: PlanItem[]; stats: DayStats }

const EMPTY: AgentDay = {
  track: [],
  plans: [],
  stats: { visit_tasks: 0, visit_done_tasks: 0, no_plan_count: 0, report_tasks: 0, report_done_tasks: 0, deleveriy_tasks: 0, delivery_done_tasks: 0, order_total_price: 0, client_transaction_total_price: 0, order_return_total_price: 0, start_location: null, end_location: null },
}

/** The day of agent `agent` (null: nothing selected). `loading` is true until the first answer for the pair arrives. */
export function useAgentDay(agent: number | null, date: string): { day: AgentDay; loading: boolean } {
  const [state, setState] = useState<{ key: string; day: AgentDay } | null>(null)
  const key = `${agent}|${date}`
  useEffect(() => {
    if (agent === null) return
    let cancelled = false
    fetch(`/api/tracking/way/day?agent=${agent}&date=${date}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : EMPTY))
      .then((day: AgentDay) => {
        if (!cancelled) setState({ key, day })
      })
      .catch(() => {
        if (!cancelled) setState({ key, day: EMPTY })
      })
    return () => {
      cancelled = true
    }
  }, [agent, date, key])
  if (agent === null) return { day: EMPTY, loading: false }
  return state?.key === key ? { day: state.day, loading: false } : { day: EMPTY, loading: true }
}

/** The hour / minute pickers of the map bar ("" = not chosen). */
export type TimeFilter = { hour: string; minute: string; endHour: string; endMinute: string }
export const EMPTY_TIME_FILTER: TimeFilter = { hour: "", minute: "", endHour: "", endMinute: "" }

/** The tracker points inside the chosen time window: the start counts only with its hour, the end only with its hour (a missing minute is 00). */
export function filterTrack(track: TrackPoint[], filter: TimeFilter): TrackPoint[] {
  const start = filter.hour ? `${filter.hour}:${filter.minute || "00"}` : ""
  const end = filter.endHour ? `${filter.endHour}:${filter.endMinute || "00"}` : ""
  if (!start && !end) return track
  return track.filter((point) => {
    const time = point[2].slice(0, 5)
    return (!start || time >= start) && (!end || time <= end)
  })
}

/** What the legend checkboxes switch on the map. */
export type LegendState = { tracker: boolean; visit: boolean; actual: boolean }
export const DEFAULT_LEGEND: LegendState = { tracker: false, visit: true, actual: true }

/** The plans of the day with the rows sorted by the time of the first finished task (the ones still to visit last), as the reference lists them. */
export function sortPlans(plans: PlanItem[]): PlanItem[] {
  const doneTime = (item: PlanItem) => item.plans.find((task) => task.status === "done")?.done_time ?? null
  return [...plans].sort((a, b) => {
    const x = doneTime(a)
    const y = doneTime(b)
    // A client without a finished task ("now" in the reference's comparison) goes after the finished ones.
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return x < y ? -1 : 1
  })
}
