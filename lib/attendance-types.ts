// Посещаемость (/analytics/work-attendance): types and pure helpers shared by the
// server (lib/attendance-repo.ts) and the page (components/analytics/attendance-*.tsx).
// No server-only imports. Labels are Russian i18n keys.

/** Day types of the demo (staff/attendance). */
export const ATTENDANCE_TYPES = ["on_time", "late", "not_come", "holiday", "sick_leave", "vacation"] as const
export type AttendanceType = (typeof ATTENDANCE_TYPES)[number]

/** Types a manager may set (Изменить / Excel import), in the demo's order. */
export const EDITABLE_TYPES = ["on_time", "late", "sick_leave", "vacation", "not_come"] as const
export type EditableType = (typeof EDITABLE_TYPES)[number]

export const TYPE_LABELS: Record<AttendanceType, string> = {
  on_time: "Пришел вовремя",
  late: "Опоздал",
  not_come: "Не пришел",
  holiday: "Выходной",
  sick_leave: "Больничный",
  vacation: "Отпуск",
}

export type AttendanceSource = "auto" | "manual" | "import"

export type AttendanceDay = {
  date: string
  type: AttendanceType
  /** Arrival "HH:MM" (first check-in / activity, or the time set by a manager). */
  time: string | null
  /** Leave "HH:MM" (last check-out). */
  leaveTime: string | null
  lateMinutes: number
  comment: string | null
  source: AttendanceSource
}

export type AttendanceCounts = Record<AttendanceType, number>

export type AttendanceUser = {
  id: number
  name: string
  position: string
  branch: string
  totalLateMinutes: number
  counts: AttendanceCounts
  dates: AttendanceDay[]
}

export type AttendanceMonth = {
  year: number
  /** 1..12 */
  month: number
  /** Today in Asia/Tashkent, "YYYY-MM-DD". */
  today: string
  /** "Считать опозданием после", "HH:MM". */
  lateAfter: string
  holidays: string[]
  /** Days of the month minus its holidays ("Всего"). */
  workingDays: number
  users: AttendanceUser[]
}

export type CheckInKind = "in" | "out"

export type CheckIn = {
  id: number
  employeeId: number
  kind: CheckInKind
  /** The instant, ISO UTC. */
  at: string
  date: string
  /** "HH:MM:SS" Asia/Tashkent. */
  time: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  place: string
  comment: string
  source: "mobile" | "web"
  deviceId: string
  createdBy: string
  createdAt: string
}

export type AttendanceDayDetail = {
  employee: { id: number; name: string; position: string; branch: string; active: boolean }
  date: string
  holiday: boolean
  lateAfter: string
  day: (AttendanceDay & { updatedBy: string | null; updatedAt: string | null }) | null
  checkIns: CheckIn[]
  orders: { count: number; totals: { currency: string; amount: number }[] }
}

const pad = (value: number) => String(value).padStart(2, "0")

/** Days in a month (month 1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** "YYYY-MM-DD" of day `day` of month 1..12. */
export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Every day of a month as "YYYY-MM-DD". */
export function monthDays(year: number, month: number): string[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => isoDay(year, month, index + 1))
}

/** Sundays of a month as "YYYY-MM-DD" (the default weekend of a month never saved). */
export function sundaysOf(year: number, month: number): string[] {
  return monthDays(year, month).filter((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0)
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** "HH:MM" / "HH:MM:SS" → minutes after midnight, or null. */
export function timeMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? ""))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59 || (match[3] !== undefined && Number(match[3]) > 59)) return null
  return hours * 60 + minutes
}

/** A strict "HH:MM" (00:00..23:59). */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) && timeMinutes(value) !== null
}

/** 90 → "1:30". */
export function formatLate(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** The type of a day from its arrival under the rules of the page:
 * holiday → holiday; no arrival → not_come; arrival minute ≤ late_after → on_time;
 * else late by the whole minutes past late_after. */
export function deriveDay(holiday: boolean, arrival: string | null, lateAfter: string): { type: AttendanceType; lateMinutes: number } {
  if (holiday) return { type: "holiday", lateMinutes: 0 }
  const arrived = timeMinutes(arrival)
  if (arrived === null) return { type: "not_come", lateMinutes: 0 }
  const limit = timeMinutes(lateAfter) ?? 9 * 60
  return arrived <= limit ? { type: "on_time", lateMinutes: 0 } : { type: "late", lateMinutes: arrived - limit }
}

export function emptyCounts(): AttendanceCounts {
  return { on_time: 0, late: 0, not_come: 0, holiday: 0, sick_leave: 0, vacation: 0 }
}

/** "Пришел вовремя" column: came (on time + sick leave + vacation) / late / not come. */
export function cameCount(counts: AttendanceCounts): number {
  return counts.on_time + counts.sick_leave + counts.vacation
}

/** The value of a day in the Excel export: 1 = came (on time or late), else 0. */
export function cameFlag(type: AttendanceType | undefined): 0 | 1 {
  return type === "on_time" || type === "late" ? 1 : 0
}
