import "server-only"

import { ensureAttendanceSchema } from "@/lib/attendance-schema"
import { isClockTime } from "@/lib/attendance-types"
import { getDb, withTransaction, type PgDb } from "@/lib/db"

// "Рабочее время" of Посещаемость: one company-wide setting, "Считать опозданием после"
// (HH:MM, 09:00 until someone saves it). Arrivals after it are late. A new value applies to
// days derived from now on and to Перерасчет; days already derived keep the value they were
// derived with (demo behaviour: only Перерасчет re-applies the work time).

export const DEFAULT_LATE_AFTER = "09:00"
const LATE_AFTER_KEY = "late_after"

/** The saved "late after" time ("HH:MM"). */
export async function lateAfterOf(db: PgDb): Promise<string> {
  const row = (await db.prepare("SELECT value FROM attendance_settings WHERE key = ?").get(LATE_AFTER_KEY)) as { value: string } | undefined
  return row && isClockTime(row.value) ? row.value : DEFAULT_LATE_AFTER
}

export async function getLateAfter(): Promise<string> {
  await ensureAttendanceSchema()
  return lateAfterOf(getDb())
}

/** Saves the "late after" time (validated "HH:MM"). */
export async function setLateAfter(value: string, actor: string): Promise<string> {
  await ensureAttendanceSchema()
  return withTransaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO attendance_settings (key, value, updated_by) VALUES (@key, @value, @actor)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = datetime('now')`,
      )
      .all({ key: LATE_AFTER_KEY, value, actor })
    return lateAfterOf(tx)
  })
}
