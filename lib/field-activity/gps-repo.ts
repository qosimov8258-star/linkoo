import "server-only"

import { getDb } from "@/lib/db"
import type { FieldActor } from "@/lib/field-activity/actor"
import { dayStartMs, localIso, type GpsBatchInput } from "@/lib/field-activity/input"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { MAX_TRACK_POINTS, ONLINE_MINUTES, type GpsPoint, type LastLocation } from "@/lib/field-activity/types"

// GPS track of the employees (the mobile app's tracker). A batch is idempotent: a point of the
// same employee and instant is stored once (unique employee_id + recorded_at), so a retried
// upload inserts nothing twice. The last point is the live location ("Онлайн" when it is less
// than ONLINE_MINUTES old).

const DAY_MS = 24 * 60 * 60_000

/** Stores a batch of the actor's points; returns how many were new and how many were already stored. */
export async function insertGpsPoints(actor: FieldActor, input: GpsBatchInput): Promise<{ accepted: number; duplicates: number }> {
  await ensureFieldSchema()
  // One point per instant (the first wins), so the statement never meets its own key twice.
  const byInstant = new Map<number, GpsBatchInput["points"][number]>()
  for (const point of input.points) if (!byInstant.has(point.recordedAt)) byInstant.set(point.recordedAt, point)
  const points = [...byInstant.values()]
  const result = await getDb()
    .prepare(
      `INSERT INTO field_gps_points (user_id, employee_id, recorded_at, lat, lng, accuracy, speed, battery)
       SELECT @userId, @employeeId, t.at, t.lat, t.lng, t.accuracy, t.speed, t.battery
         FROM unnest(@at::timestamptz[], @lat::float8[], @lng::float8[], @accuracy::float8[], @speed::float8[], @battery::float8[])
              AS t(at, lat, lng, accuracy, speed, battery)
       ON CONFLICT (employee_id, recorded_at) DO NOTHING`,
    )
    .run({
      userId: actor.user.id,
      employeeId: actor.employee.id,
      at: points.map((point) => new Date(point.recordedAt).toISOString()),
      lat: points.map((point) => point.lat ?? null),
      lng: points.map((point) => point.lng ?? null),
      accuracy: points.map((point) => point.accuracy ?? null),
      speed: points.map((point) => point.speed ?? null),
      battery: points.map((point) => point.battery ?? null),
    })
  return { accepted: result.changes, duplicates: input.points.length - result.changes }
}

type PointRow = { id: string | number; recorded_at: Date; lat: number; lng: number; accuracy: number | null; speed: number | null; battery: number | null }

const num = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value))

function rowToPoint(row: PointRow): GpsPoint {
  return {
    id: Number(row.id),
    at: localIso(new Date(row.recorded_at).getTime()),
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: num(row.accuracy),
    speed: num(row.speed),
    battery: num(row.battery),
  }
}

/**
 * The employee's points of a local day in time order, optionally within a time window of that
 * day (`fromMinute` / `toMinute` = minutes since midnight, both inclusive: 18:00 keeps 18:00:59).
 * At most MAX_TRACK_POINTS points.
 */
export async function gpsTrack(employeeId: number, day: string, window: { fromMinute?: number | null; toMinute?: number | null } = {}): Promise<GpsPoint[]> {
  await ensureFieldSchema()
  const start = dayStartMs(day)
  const from = start + (window.fromMinute ?? 0) * 60_000
  const to = window.toMinute === null || window.toMinute === undefined ? start + DAY_MS : start + (window.toMinute + 1) * 60_000
  if (to <= from) return []
  const rows = (await getDb()
    .prepare(
      `SELECT id, recorded_at, lat, lng, accuracy, speed, battery FROM field_gps_points
        WHERE employee_id = @employeeId AND recorded_at >= @from::timestamptz AND recorded_at < @to::timestamptz
        ORDER BY recorded_at LIMIT ${MAX_TRACK_POINTS}`,
    )
    .all({ employeeId, from: new Date(from).toISOString(), to: new Date(to).toISOString() })) as PointRow[]
  return rows.map(rowToPoint)
}

/**
 * Live location of employees: the last GPS point before `until` (default now; pass the end of a
 * past day to see where the employee was at that day's end), the last activity (latest GPS point
 * or visit start / finish) and the last known battery. `employeeIds` undefined = every employee.
 */
export async function lastLocations(employeeIds?: number[], until: number = Date.now()): Promise<LastLocation[]> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return []
  const rows = (await getDb()
    .prepare(
      `WITH ids AS (${employeeIds ? "SELECT DISTINCT unnest(@ids::int[]) AS id" : "SELECT id FROM employees"})
       SELECT ids.id AS employee_id, p.id, p.recorded_at, p.lat, p.lng, p.accuracy, p.speed, p.battery,
              (SELECT b.battery FROM field_gps_points b
                WHERE b.employee_id = ids.id AND b.battery IS NOT NULL AND b.recorded_at < @until::timestamptz
                ORDER BY b.recorded_at DESC LIMIT 1) AS last_battery,
              (SELECT MAX(GREATEST(v.started_at, COALESCE(v.finished_at, v.started_at))) FROM field_visits v
                WHERE v.employee_id = ids.id AND v.started_at < @until::timestamptz) AS last_visit
         FROM ids
         LEFT JOIN LATERAL (
           SELECT g.id, g.recorded_at, g.lat, g.lng, g.accuracy, g.speed, g.battery FROM field_gps_points g
            WHERE g.employee_id = ids.id AND g.recorded_at < @until::timestamptz
            ORDER BY g.recorded_at DESC LIMIT 1) p ON true
        ORDER BY ids.id`,
    )
    .all({ ids: employeeIds ?? [], until: new Date(until).toISOString() })) as Array<PointRow & { employee_id: number; last_battery: number | null; last_visit: Date | null }>
  const now = Date.now()
  return rows.map((row) => {
    const point = row.recorded_at ? rowToPoint(row) : null
    const pointMs = row.recorded_at ? new Date(row.recorded_at).getTime() : null
    const visitMs = row.last_visit ? Math.min(new Date(row.last_visit).getTime(), until) : null
    const last = Math.max(pointMs ?? -Infinity, visitMs ?? -Infinity)
    return {
      employeeId: Number(row.employee_id),
      point,
      lastActivityAt: Number.isFinite(last) ? localIso(last) : null,
      battery: num(row.last_battery),
      online: pointMs !== null && now - pointMs <= ONLINE_MINUTES * 60_000 && pointMs <= now + 5 * 60_000,
    }
  })
}
