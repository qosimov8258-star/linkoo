import "server-only"

import { getDb } from "@/lib/db"

// The agents panel of "Отслеживание": the rows of the reference's `market/way/` API. `tracking_way_agents` holds the
// name, colour, last activity, last position, battery and the groups (agent / merch / delivery / collector) the tabs of
// the panel filter on; the per-day counters (to visit / visited / without a plan) are the reference's own, stored with the day's plans.

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

const LIST_COLORS = ["#f83b7f", "#6770e6", "#fbb432", "#4caf50", "#9c27b0", "#ffc107", "#f44336", "#03a9f4", "#00bcd4", "#ffeb3b", "#009688", "#2196f3", "#cddc39", "#8bc34a", "#ff5722", "#9e9e9e"]
/** Colour of the row at `index` of a reference list: the palette once, then it cycles from its second colour on. */
const listColor = (index: number) => LIST_COLORS[index < 16 ? index : (index - 16 + 1) % 15]

export async function listWayAgents(group: string, date: string): Promise<WayAgent[]> {
  await ensureSchema()
  const db = getDb()
  await db.exec("CREATE TABLE IF NOT EXISTS tracking_way_order (id INTEGER PRIMARY KEY, pos INTEGER NOT NULL)")
  await db.exec("CREATE TABLE IF NOT EXISTS tracking_agent_plans (user_id INTEGER NOT NULL, day TEXT NOT NULL, plans TEXT NOT NULL, stats TEXT NOT NULL, PRIMARY KEY (user_id, day))")
  // The reference lists the agents in the order of the agent plan; a tab other than "Все" paints its rows by position.
  const rows = (await db
    .prepare("SELECT a.id, a.name, a.color, a.last_activity, a.battery, a.lat, a.lon, a.groups FROM tracking_way_agents a LEFT JOIN tracking_way_order o ON o.id = a.id ORDER BY COALESCE(o.pos, 100000 + a.id), a.id")
    .all()) as Row[]
  const isAll = group === "all" || !group
  const picked = isAll ? rows : rows.filter((row) => row.groups.split(",").includes(group))
  // The counters of the panel are those of the reference's `market/way/` for the day (stored with the day's plans).
  const counts = (await db
    .prepare("SELECT user_id, stats FROM tracking_agent_plans WHERE day = ?")
    .all(date)
    .catch(() => [])) as { user_id: number; stats: string }[]
  const wayById = new Map<number, [number, number, number]>()
  for (const row of counts) {
    try {
      const way = (JSON.parse(row.stats) as { way_counts?: [number, number, number] }).way_counts
      if (way) wayById.set(row.user_id, way)
    } catch {
      // a row without counters shows zeros
    }
  }
  return picked.map((row, index) => ({
    id: row.id,
    user_fullname: row.name,
    todo_count: wayById.get(row.id)?.[0] ?? 0,
    done_count: wayById.get(row.id)?.[1] ?? 0,
    no_plan_count: wayById.get(row.id)?.[2] ?? 0,
    color: isAll ? row.color : listColor(index),
    is_online: false,
    last_activity: row.last_activity,
    live_location: row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null,
    battery: row.battery,
  }))
}
