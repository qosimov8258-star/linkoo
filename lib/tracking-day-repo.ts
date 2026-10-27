import "server-only"

import { getDb } from "@/lib/db"

// The day of an agent in "Отслеживание": the reference's `market/location/` (the tracker points of the phone), `market/agent_plans/{id}/`
// (the clients of the day with the tasks done on them) and `market/detail_plan/` (the totals of the day), stored as they came.

declare global {
  var __linkoTrackingDaySchema: Promise<void> | undefined
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tracking_locations (
  id BIGINT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  battery DOUBLE PRECISION,
  registered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tracking_locations_user_time ON tracking_locations (user_id, registered_at);
CREATE TABLE IF NOT EXISTS tracking_agent_plans (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  plans TEXT NOT NULL,
  stats TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
`

function ensureSchema() {
  globalThis.__linkoTrackingDaySchema ??= getDb()
    .exec(SCHEMA_SQL)
    .catch((error) => {
      globalThis.__linkoTrackingDaySchema = undefined
      throw error
    })
  return globalThis.__linkoTrackingDaySchema
}

/** [lat, lon, "HH:MM:SS"] of one tracker point. */
export type TrackPoint = [number, number, string]

export type AgentDay = {
  track: TrackPoint[]
  /** The rows of `market/agent_plans/{id}/` (snake_case, as the reference sends them). */
  plans: unknown[]
  /** `market/detail_plan/` of the day. */
  stats: Record<string, unknown>
}

const EMPTY_STATS = {
  all_tasks: 0,
  all_done_tasks: 0,
  visit_tasks: 0,
  visit_done_tasks: 0,
  no_plan_count: 0,
  deleveriy_tasks: 0,
  delivery_done_tasks: 0,
  report_tasks: 0,
  report_done_tasks: 0,
  order_total_price: 0,
  client_transaction_total_price: 0,
  order_return_total_price: 0,
  order_return_total_count: 0,
  month_order_total_price: 0,
  start_location: null,
  end_location: null,
}

export async function getAgentDay(userId: number, day: string): Promise<AgentDay> {
  await ensureSchema()
  const db = getDb()
  const points = (await db
    .prepare("SELECT lat, lon, registered_at FROM tracking_locations WHERE user_id = ? AND registered_at >= ? AND registered_at <= ? ORDER BY registered_at, id")
    .all(userId, `${day}T00:00:00`, `${day}T23:59:59.999999`)) as { lat: number; lon: number; registered_at: string }[]
  const row = (await db.prepare("SELECT plans, stats FROM tracking_agent_plans WHERE user_id = ? AND day = ?").get(userId, day)) as { plans: string; stats: string } | undefined
  return {
    track: points.map((point) => [point.lat, point.lon, point.registered_at.slice(11, 19)]),
    plans: row ? JSON.parse(row.plans) : [],
    stats: row ? JSON.parse(row.stats) : EMPTY_STATS,
  }
}
