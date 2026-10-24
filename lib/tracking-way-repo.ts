import "server-only"

import { getDb } from "@/lib/db"

// The agents panel of "Отслеживание": the rows of the reference's `market/way/` API. `tracking_way_agents` holds the
// name, colour, last activity, last position, battery and the groups (agent / merch / delivery / collector) the tabs of
// the panel filter on; the per-day counters come from the day's visits.

declare global {
  var __linkoTrackingWaySchema: Promise<void> | undefined
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tracking_way_agents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9e9e9e',
  last_activity TEXT,
  battery DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  groups TEXT NOT NULL DEFAULT ''
);
`

function ensureSchema() {
  globalThis.__linkoTrackingWaySchema ??= getDb()
    .exec(SCHEMA_SQL)
    .catch((error) => {
      globalThis.__linkoTrackingWaySchema = undefined
      throw error
    })
  return globalThis.__linkoTrackingWaySchema
}

export type WayAgent = {
  id: number
  user_fullname: string
  todo_count: number
  done_count: number
  no_plan_count: number
  color: string
  is_online: boolean
  last_activity: string | null
  live_location: { lat: number; lon: number } | null
  battery: number | null
}

export const WAY_GROUPS = ["all", "agent", "merch", "delivery", "collector"] as const

type Row = { id: number; name: string; color: string; last_activity: string | null; battery: number | null; lat: number | null; lon: number | null; groups: string }

export async function listWayAgents(group: string, date: string): Promise<WayAgent[]> {
  await ensureSchema()
  const db = getDb()
  const rows = (await db.prepare("SELECT id, name, color, last_activity, battery, lat, lon, groups FROM tracking_way_agents ORDER BY id").all()) as Row[]
  const picked = group === "all" || !group ? rows : rows.filter((row) => row.groups.split(",").includes(group))
  const visits = (await db
    .prepare("SELECT agent, COUNT(*) AS n FROM agent_visits WHERE visit_date = ? GROUP BY agent")
    .all(date)
    .catch(() => [])) as { agent: string; n: number | string }[]
  const doneByName = new Map(visits.map((visit) => [visit.agent, Number(visit.n)]))
  return picked.map((row) => ({
    id: row.id,
    user_fullname: row.name,
    todo_count: 0,
    done_count: doneByName.get(row.name) ?? 0,
    no_plan_count: 0,
    color: row.color,
    is_online: false,
    last_activity: row.last_activity,
    live_location: row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null,
    battery: row.battery,
  }))
}
