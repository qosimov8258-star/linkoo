import "server-only"

import { ensureAttendanceSchema, lockAttendanceMonth } from "@/lib/attendance-schema"
import { deriveDay, isoDay, monthDays, sundaysOf, type AttendanceType } from "@/lib/attendance-types"
import { getDb, withTransaction, type PgDb } from "@/lib/db"

// Holiday ("выходные") days of a month for Посещаемость. The table keeps its original
// shape (month 0..11, one row per day). A month someone saved with the dialog is marked in
// attendance_weekend_months and is exactly its stored days; an unmarked month is its Sundays
// plus any stored day (the earlier page stored only the days besides Sundays), so nothing
// saved before changes meaning. Saving re-derives the month's derived days
// (attendance_auto_days) under the month lock, so "Всего" and the holiday / not-come
// classification follow at once.

export type MonthHolidays = { year: number; month: number; dates: string[]; configured: boolean }

/** The holiday days of month 1..12 ("YYYY-MM-DD", sorted). */
export async function holidaysOf(db: PgDb, year: number, month: number): Promise<MonthHolidays> {
  const rows = (await db
    .prepare("SELECT day FROM attendance_weekend_days WHERE year = ? AND month = ? ORDER BY day")
    .all(year, month - 1)) as { day: number }[]
  const marker = await db.prepare("SELECT 1 AS ok FROM attendance_weekend_months WHERE year = ? AND month = ?").get(year, month - 1)
  const valid = monthDays(year, month)
  const stored = rows.map((row) => Number(row.day)).filter((day) => day >= 1 && day <= valid.length).map((day) => isoDay(year, month, day))
  const dates = marker ? stored : [...new Set([...sundaysOf(year, month), ...stored])]
  return { year, month, dates: dates.sort(), configured: Boolean(marker) }
}

/** GET /api/work-attendance/holidays. */
export async function getHolidays(year: number, month: number): Promise<MonthHolidays> {
  await ensureAttendanceSchema()
  return holidaysOf(getDb(), year, month)
}

/** Day numbers of the effective holidays of month 0..11 (the older /api/attendance-weekend-days shape). */
export async function listWeekendDays(year: number, month0: number): Promise<number[]> {
  const holidays = await getHolidays(year, month0 + 1)
  return holidays.dates.map((date) => Number(date.slice(8, 10)))
}

/** Re-derives the stored derived days of a month after its holidays changed: each row keeps
 * its arrival and its own late_after (Перерасчет is what applies a new work time). */
async function rederiveMonth(tx: PgDb, year: number, month: number, holidays: Set<string>): Promise<void> {
  const first = isoDay(year, month, 1)
  const last = monthDays(year, month).at(-1)!
  const rows = (await tx
    .prepare("SELECT id, day, type, arrival_time, late_after FROM attendance_auto_days WHERE day BETWEEN ? AND ?")
    .all(first, last)) as { id: number; day: string; type: AttendanceType; arrival_time: string | null; late_after: string }[]
  const ids: number[] = []
  const types: string[] = []
  const lates: number[] = []
  for (const row of rows) {
    const next = deriveDay(holidays.has(row.day), row.arrival_time, row.late_after)
    if (next.type === row.type) continue
    ids.push(Number(row.id))
    types.push(next.type)
    lates.push(next.lateMinutes)
  }
  if (!ids.length) return
  await tx
    .prepare(
      `UPDATE attendance_auto_days a SET type = u.type, late_minutes = u.late, computed_at = datetime('now')
         FROM unnest(@ids::int[], @types::text[], @lates::int[]) AS u(id, type, late)
        WHERE a.id = u.id`,
    )
    .all({ ids, types, lates })
}

/** Replaces the holiday set of month 1..12 (dates already validated to lie inside the month). */
export async function replaceHolidays(input: { year: number; month: number; dates: string[]; actor: string }): Promise<MonthHolidays> {
  await ensureAttendanceSchema()
  const days = [...new Set(input.dates.map((date) => Number(date.slice(8, 10))))].sort((a, b) => a - b)
  return withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, isoDay(input.year, input.month, 1))
    await tx.prepare("DELETE FROM attendance_weekend_days WHERE year = ? AND month = ?").run(input.year, input.month - 1)
    if (days.length) {
      await tx
        .prepare(
          `INSERT INTO attendance_weekend_days (year, month, day)
           SELECT @year, @month, d FROM unnest(@days::int[]) AS d ON CONFLICT (year, month, day) DO NOTHING`,
        )
        .all({ year: input.year, month: input.month - 1, days })
    }
    await tx
      .prepare(
        `INSERT INTO attendance_weekend_months (year, month, updated_by) VALUES (@year, @month, @actor)
         ON CONFLICT (year, month) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = datetime('now')`,
      )
      .all({ year: input.year, month: input.month - 1, actor: input.actor })
    const saved = await holidaysOf(tx, input.year, input.month)
    await rederiveMonth(tx, input.year, input.month, new Set(saved.dates))
    return saved
  })
}

/** The older POST /api/attendance-weekend-days shape: month 0..11 and day numbers 1..31
 * (already validated against the month length). */
export async function replaceWeekendDays(input: { year: number; month: number; days: number[]; actor: string }): Promise<number[]> {
  const saved = await replaceHolidays({
    year: input.year,
    month: input.month + 1,
    dates: input.days.map((day) => isoDay(input.year, input.month + 1, day)),
    actor: input.actor,
  })
  return saved.dates.map((date) => Number(date.slice(8, 10)))
}
