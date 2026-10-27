import "server-only"

import { ensureUserEmployeeLink } from "@/lib/auth-employee"
import { deriveDay } from "@/lib/attendance-types"
import { holidaysOf } from "@/lib/attendance-weekend-days-repo"
import type { PgDb } from "@/lib/db"
import { parseAnyDate } from "@/lib/finance/dates"

// The activity an attendance day is derived from (Посещаемость): check-ins and check-outs
// (attendance_check_ins), the orders the employee created himself (orders.created_by =
// the display name of the account linked to him through users.employee_id), and the mobile
// app's field activity: the first visit (field_visits) and the first GPS point
// (field_gps_points) of the day. The field tables are created lazily, so they may not exist.

export type Activity = { arrival: string | null; leave: string | null }

const pad = (value: number) => String(value).padStart(2, "0")

/** The day after / before `day` ("YYYY-MM-DD"). */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** UTC "YYYY-MM-DD HH:MM:SS" of the local (Asia/Tashkent, UTC+5) midnight starting `day`
 * — the bound of a created_at text column (UTC "YYYY-MM-DD HH:MM:SS"). */
export function utcStartOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCHours(date.getUTCHours() - 5)
  return date.toISOString().slice(0, 19).replace("T", " ")
}

/** Earliest activity ("HH:MM:SS") and last check-out of each employee-day in [from, to].
 * Key "employeeId|day". */
export async function activityOf(db: PgDb, employeeIds: number[], from: string, to: string): Promise<Map<string, Activity>> {
  const out = new Map<string, Activity>()
  if (!employeeIds.length || from > to) return out
  const checkIns = (await db
    .prepare(
      `SELECT employee_id, local_day,
              MIN(local_time) FILTER (WHERE kind = 'in') AS first_in,
              MAX(local_time) FILTER (WHERE kind = 'out') AS last_out
         FROM attendance_check_ins
        WHERE employee_id = ANY(@ids::int[]) AND local_day BETWEEN @from AND @to
        GROUP BY employee_id, local_day`,
    )
    .all({ ids: employeeIds, from, to })) as { employee_id: number; local_day: string; first_in: string | null; last_out: string | null }[]
  for (const row of checkIns) out.set(`${row.employee_id}|${row.local_day}`, { arrival: row.first_in, leave: row.last_out })

  await ensureUserEmployeeLink()
  const orders = (await db
    .prepare(
      `SELECT u.employee_id, o.created_at
         FROM orders o JOIN users u ON u.display_name = o.created_by AND u.employee_id = ANY(@ids::int[])
        WHERE o.created_at >= @fromUtc AND o.created_at < @toUtc`,
    )
    .all({ ids: employeeIds, fromUtc: utcStartOf(from), toUtc: utcStartOf(shiftDay(to, 1)) })) as { employee_id: number; created_at: string }[]
  const earliest = (employeeId: number, day: string, time: string) => {
    if (day < from || day > to) return
    const key = `${employeeId}|${day}`
    const current = out.get(key) ?? { arrival: null, leave: null }
    if (!current.arrival || time < current.arrival) current.arrival = time
    out.set(key, current)
  }
  for (const row of orders) {
    const local = parseAnyDate(row.created_at, true)
    if (!local) continue
    earliest(row.employee_id, local.slice(0, 10), local.slice(11, 19))
  }

  const tables = (await db
    .prepare("SELECT to_regclass('field_visits') IS NOT NULL AS visits, to_regclass('field_gps_points') IS NOT NULL AS gps")
    .get()) as { visits: boolean; gps: boolean }
  const field: Array<{ table: string; column: string }> = []
  if (tables.visits) field.push({ table: "field_visits", column: "started_at" })
  if (tables.gps) field.push({ table: "field_gps_points", column: "recorded_at" })
  for (const source of field) {
    // Local (Asia/Tashkent) day bounds of [from, to]; the first moment of each employee-day.
    const rows = (await db
      .prepare(
        `SELECT employee_id,
                to_char(MIN(${source.column}) AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day,
                to_char(MIN(${source.column}) AT TIME ZONE 'Asia/Tashkent', 'HH24:MI:SS') AS time
           FROM ${source.table}
          WHERE employee_id = ANY(@ids::int[])
            AND ${source.column} >= (@from::date)::timestamp AT TIME ZONE 'Asia/Tashkent'
            AND ${source.column} < ((@to::date) + 1)::timestamp AT TIME ZONE 'Asia/Tashkent'
          GROUP BY employee_id, (${source.column} AT TIME ZONE 'Asia/Tashkent')::date`,
      )
      .all({ ids: employeeIds, from, to })) as { employee_id: number; day: string; time: string }[]
    for (const row of rows) earliest(row.employee_id, row.day, row.time)
  }
  return out
}

/** Re-derives one stored employee-day after a check-in arrived for it late (an offline
 * phone syncing yesterday). The row keeps its late_after snapshot; run under the month lock. */
export async function refreshDerivedDay(tx: PgDb, employeeId: number, day: string): Promise<void> {
  const row = (await tx.prepare("SELECT id, late_after FROM attendance_auto_days WHERE employee_id = ? AND day = ?").get(employeeId, day)) as
    | { id: number; late_after: string }
    | undefined
  if (!row) return
  const holidays = await holidaysOf(tx, Number(day.slice(0, 4)), Number(day.slice(5, 7)))
  const activity = (await activityOf(tx, [employeeId], day, day)).get(`${employeeId}|${day}`)
  const derived = deriveDay(holidays.dates.includes(day), activity?.arrival ?? null, row.late_after)
  await tx
    .prepare("UPDATE attendance_auto_days SET type = ?, arrival_time = ?, leave_time = ?, late_minutes = ?, computed_at = datetime('now') WHERE id = ?")
    .run(derived.type, activity?.arrival ?? null, activity?.leave ?? null, derived.lateMinutes, row.id)
}
