import "server-only"

import { getDb } from "@/lib/db"
import { getAttendanceMonth } from "@/lib/agent-visits-repo"
import { listWeekendDays } from "@/lib/attendance-weekend-days-repo"

// "Посещения на работу": one cell per employee and day (staff/attendance of the reference).
export type AttendanceType = "on_time" | "late" | "not_come" | "holiday" | "sick_leave" | "vacation"
export const ATTENDANCE_TYPES: AttendanceType[] = ["on_time", "late", "sick_leave", "vacation", "not_come"]

export type AttendanceCell = { date: string; type: AttendanceType; comment: string | null; time: string | null; late_minutes: number }
export type AttendanceUser = { id: number; first_name: string; second_name: string | null; dates: AttendanceCell[]; total_late_minutes: number }

const pad = (n: number) => String(n).padStart(2, "0")

async function ensure() {
  const db = getDb()
  await db.exec("CREATE TABLE IF NOT EXISTS attendance_cells (employee_id INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, comment TEXT, time TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (employee_id, day))")
  await db.exec("CREATE TABLE IF NOT EXISTS attendance_user_order (employee_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)")
  return db
}

/** The saved holiday set of the month, or every Sunday while none was saved (month: 1-12). */
export async function holidaysOf(year: number, month: number): Promise<string[]> {
  const days = new Set<number>(await listWeekendDays(year, month - 1))
  if (!days.size) for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) if (new Date(year, month - 1, d).getDay() === 0) days.add(d)
  return [...days].sort((a, b) => a - b).map((d) => `${year}-${pad(month)}-${pad(d)}`)
}

export async function getAttendance(year: number, month: number, branchIds: number[]) {
  const db = await ensure()
  const emps = (await db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, e.branch_ids FROM employees e LEFT JOIN attendance_user_order o ON o.employee_id = e.id
       WHERE e.active = 1 ORDER BY COALESCE(o.position, 100000 + e.id), e.id`,
    )
    .all()) as Array<{ id: number; first_name: string; last_name: string; branch_ids: string }>
  const first = `${year}-${pad(month)}-01`
  const last = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
  const cells = (await db.prepare("SELECT employee_id, day, type, comment, time, late_minutes FROM attendance_cells WHERE day BETWEEN ? AND ? ORDER BY day").all(first, last)) as Array<{ employee_id: number; day: string; type: AttendanceType; comment: string | null; time: string | null; late_minutes: number }>
  const byUser = new Map<number, AttendanceCell[]>()
  for (const c of cells) {
    const list = byUser.get(Number(c.employee_id)) ?? []
    list.push({ date: c.day, type: c.type, comment: c.comment, time: c.time, late_minutes: Number(c.late_minutes) })
    byUser.set(Number(c.employee_id), list)
  }
  const users: AttendanceUser[] = emps
    .filter((e) => {
      if (!branchIds.length) return true
      let ids: number[] = []
      try { ids = JSON.parse(e.branch_ids || "[]") } catch { ids = [] }
      return ids.some((id) => branchIds.includes(Number(id)))
    })
    .map((e) => {
      const dates = byUser.get(Number(e.id)) ?? []
      return { id: Number(e.id), first_name: e.first_name, second_name: e.last_name || null, dates, total_late_minutes: dates.reduce((s, d) => s + d.late_minutes, 0) }
    })
  return { holidays: await holidaysOf(year, month), users }
}

export async function setAttendance(employeeIds: number[], day: string, type: AttendanceType, comment: string) {
  const db = await ensure()
  for (const id of employeeIds) {
    await db
      .prepare("INSERT INTO attendance_cells (employee_id, day, type, comment, time, late_minutes) VALUES (?, ?, ?, ?, NULL, 0) ON CONFLICT (employee_id, day) DO UPDATE SET type = EXCLUDED.type, comment = EXCLUDED.comment, time = NULL, late_minutes = 0 RETURNING employee_id")
      .run(id, day, type, comment || null)
  }
}

/**
 * "Перерасчет" (reference: GET staff/attendance/recalc/ with the page filter year/month/branch/search, no agent ids):
 * every finished day of the month of the filtered employees is recomputed from the agents' first visit of the day
 * (on_time / late); without a visit it becomes "holiday" on a day off and "not_come" otherwise. Manual sick_leave /
 * vacation marks are kept.
 */
export async function recalcCells(year: number, month: number, branchIds: number[], search: string) {
  const db = await ensure()
  const { users } = await getAttendance(year, month, branchIds)
  const q = search.trim().toLowerCase()
  const holidays = new Set(await holidaysOf(year, month))
  const evidence = await getAttendanceMonth(year, month - 1)
  const today = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`
  let count = 0
  for (const u of users) {
    const name = `${u.first_name} ${u.second_name ?? ""}`.trim()
    if (q && !name.toLowerCase().includes(q)) continue
    const own = new Map(u.dates.map((c) => [c.date, c.type]))
    for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) {
      const day = `${year}-${pad(month)}-${pad(d)}`
      if (day >= today) break
      const old = own.get(day)
      if (old === "sick_leave" || old === "vacation") continue
      const seen = evidence[name]?.[d]
      const type: AttendanceType = seen === "on" ? "on_time" : seen === "late" ? "late" : holidays.has(day) ? "holiday" : "not_come"
      await db
        .prepare("INSERT INTO attendance_cells (employee_id, day, type, comment, time, late_minutes) VALUES (?, ?, ?, NULL, NULL, 0) ON CONFLICT (employee_id, day) DO UPDATE SET type = EXCLUDED.type RETURNING employee_id")
        .run(u.id, day, type)
      count++
    }
  }
  return count
}
