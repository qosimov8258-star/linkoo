"use client"

import { useEffect, useState } from "react"

import type { Agent, AgentCategory } from "./tracking-data"

type WayRow = {
  id: number
  user_fullname: string
  todo_count: number
  done_count: number
  color: string
  is_online: boolean
  last_activity: string | null
  live_location: { lat: number; lon: number } | null
  battery: number | null
}

/** Panel tab → `group` the reference's `market/way/` API filters on. */
export const WAY_GROUP: Record<"agents" | AgentCategory, string> = {
  agents: "all",
  walk: "agent",
  tags: "merch",
  delivery: "delivery",
  finance: "collector",
}

const RU_MONTHS = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const pad = (value: number) => String(value).padStart(2, "0")

/** "22 окт. 2026, 10:33" — the reference's last-activity stamp (other languages use their own month names). */
export function formatLastActivity(iso: string | null, language: string): string {
  if (!iso) return ""
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return ""
  const [, year, month, day, hour, minute] = match
  const time = `${hour}:${minute}`
  if (language === "ru") return `${day} ${RU_MONTHS[Number(month) - 1]} ${year}, ${time}`
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return `${pad(date.getDate())} ${new Intl.DateTimeFormat(language, { month: "short" }).format(date)} ${year}, ${time}`
}

export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function toAgent(row: WayRow, language: string, category: "agents" | AgentCategory): Agent {
  const located = row.live_location && (row.live_location.lat || row.live_location.lon) ? row.live_location : null
  const time = row.last_activity ? row.last_activity.slice(11, 16) : ""
  return {
    id: row.id,
    name: row.user_fullname,
    color: row.color,
    timestamp: formatLastActivity(row.last_activity, language),
    ratio: `${row.done_count} / ${row.todo_count}`,
    battery: row.battery ?? 0,
    online: row.is_online,
    position: located ? [located.lat, located.lon] : undefined,
    chips: time ? [time] : [],
    categories: category === "agents" ? [] : [category],
  }
}

/** The agents of the tracking panel for a tab and a day (offline ones sorted by last activity, newest first). */
export function useWayAgents(tab: "agents" | AgentCategory, date: string, language: string): { agents: Agent[]; loading: boolean } {
  const [state, setState] = useState<{ key: string; rows: WayRow[] } | null>(null)
  const key = `${tab}|${date}`
  useEffect(() => {
    let cancelled = false
    fetch(`/api/tracking/way?group=${WAY_GROUP[tab]}&date=${date}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: WayRow[]) => {
        if (!cancelled) setState({ key, rows })
      })
      .catch(() => {
        if (!cancelled) setState({ key, rows: [] })
      })
    return () => {
      cancelled = true
    }
  }, [key, tab, date])
  const rows = state?.key === key ? state.rows : []
  const agents = [...rows]
    .sort((a, b) => (b.last_activity ?? "").localeCompare(a.last_activity ?? ""))
    .map((row) => toAgent(row, language, tab))
  return { agents, loading: state?.key !== key }
}
