import "server-only"

import { refreshDerivedDay } from "@/lib/attendance-activity"
import { AttendanceError } from "@/lib/attendance-errors"
import { ensureAttendanceSchema, lockAttendanceEmployee, lockAttendanceMonth } from "@/lib/attendance-schema"
import type { CheckIn, CheckInKind } from "@/lib/attendance-types"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { docYearOk } from "@/lib/document-dates"
import { parseAnyDate, todayIso } from "@/lib/finance/dates"

// Check-in / check-out events of Посещаемость (attendance_check_ins). Two writers share
// recordCheckIn: the mobile app of the signed-in employee (POST /api/mobile/check-ins,
// source "mobile") and a manager registering an event for an employee
// (POST /api/work-attendance/check-ins, source "web").
//
// Rules (Russian i18n keys on refusal):
// - the moment is the device's ISO date-time (its offset respected; zone-less = Asia/Tashkent),
//   absent = now; never more than 5 minutes ahead of the server clock; year 2000..2100;
//   the mobile app may send events at most 7 days old (offline queue);
// - coordinates are required when the employee has "GPS проверка" (mobile only);
// - the events of a day alternate: in, out, in, out … (an out needs an open in; 409 otherwise);
// - an idempotency key makes a retry safe: the same key with the same event answers the stored
//   one (duplicate), with another event 409;
// - one employee's events are serialised (advisory lock), the month lock is shared so
//   Перерасчет / holiday changes never interleave; a late event re-derives its stored day.

const FUTURE_SKEW_MS = 5 * 60_000
export const MOBILE_MAX_AGE_DAYS = 7
const TZ_OFFSET_MS = 5 * 60 * 60_000

type Row = {
  id: number
  employee_id: number
  kind: CheckInKind
  occurred_at: Date | string
  local_day: string
  local_time: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  place: string
  comment: string
  source: string
  device_id: string
  idempotency_key: string | null
  created_by: string
  created_at: string
}

const COLUMNS =
  "id, employee_id, kind, occurred_at, local_day, local_time, lat, lng, accuracy, place, comment, source, device_id, idempotency_key, created_by, created_at"

function toCheckIn(row: Row): CheckIn {
  const at = row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at))
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    kind: row.kind === "out" ? "out" : "in",
    at: Number.isNaN(at.getTime()) ? "" : at.toISOString(),
    date: row.local_day,
    time: row.local_time,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    place: row.place ?? "",
    comment: row.comment ?? "",
    source: row.source === "web" ? "web" : "mobile",
    deviceId: row.device_id ?? "",
    createdBy: row.created_by ?? "",
    createdAt: row.created_at ?? "",
  }
}

/** Events of an employee on a local day, in order. */
export async function listCheckInsOf(db: PgDb, employeeId: number, day: string): Promise<CheckIn[]> {
  const rows = (await db
    .prepare(`SELECT ${COLUMNS} FROM attendance_check_ins WHERE employee_id = ? AND local_day = ? ORDER BY local_time, id`)
    .all(employeeId, day)) as Row[]
  return rows.map(toCheckIn)
}

export async function listCheckIns(employeeId: number, day: string): Promise<CheckIn[]> {
  await ensureAttendanceSchema()
  const db = getDb()
  const employee = await db.prepare("SELECT id FROM employees WHERE id = ?").get(employeeId)
  if (!employee) throw new AttendanceError("Сотрудник не найден", 404, "employeeId")
  return listCheckInsOf(db, employeeId, day)
}

export type CheckInInput = {
  employeeId: number
  userId: number | null
  kind: CheckInKind
  at?: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  place?: string
  comment?: string
  deviceId?: string
  idempotencyKey?: string | null
  source: "mobile" | "web"
  actor: string
}

const pad = (value: number) => String(value).padStart(2, "0")

/** The event moment → { instant (ms UTC), local "YYYY-MM-DD", local "HH:MM:SS" }. */
function eventMoment(raw: string | undefined, source: "mobile" | "web", now = Date.now()): { instant: number; day: string; time: string } {
  let instant = now
  if (raw) {
    const local = parseAnyDate(raw)
    if (!local || !docYearOk(local) || !/T\d{2}:\d{2}/.test(local)) throw new AttendanceError("Неверная дата", 400, "at")
    const [day, time] = local.split("T")
    const [y, m, d] = day.split("-").map(Number)
    const [hh, mm, ss] = time.split(":").map(Number)
    instant = Date.UTC(y, m - 1, d, hh, mm, ss || 0) - TZ_OFFSET_MS
  }
  if (instant > now + FUTURE_SKEW_MS) throw new AttendanceError("Время отметки не может быть в будущем", 400, "at")
  const local = new Date(instant + TZ_OFFSET_MS)
  const day = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  if (!docYearOk(day)) throw new AttendanceError("Неверная дата", 400, "at")
  if (source === "mobile") {
    const oldest = new Date(`${todayIso(new Date(now))}T00:00:00Z`)
    oldest.setUTCDate(oldest.getUTCDate() - MOBILE_MAX_AGE_DAYS)
    if (day < oldest.toISOString().slice(0, 10)) throw new AttendanceError("Отметка старше 7 дней не принимается", 400, "at")
  }
  return { instant, day, time }
}

/** The in/out order of the day stays alternating with the new event at `time`. */
function checkOrder(events: Row[], kind: CheckInKind, time: string) {
  const before = events.filter((event) => event.local_time <= time)
  const after = events.filter((event) => event.local_time > time)
  const previous = before.at(-1)?.kind
  const next = after[0]?.kind
  if (kind === "in") {
    if (previous === "in") throw new AttendanceError("Приход уже отмечен, сначала отметьте уход", 409, "kind")
    if (next === "in") throw new AttendanceError("Отметки прихода и ухода должны чередоваться", 409, "at")
  } else {
    if (previous !== "in") throw new AttendanceError(previous === "out" ? "Уход уже отмечен" : "Сначала отметьте приход", 409, "kind")
    if (next === "out") throw new AttendanceError("Отметки прихода и ухода должны чередоваться", 409, "at")
  }
}

/** Records one check-in / check-out (see the rules above). */
export async function recordCheckIn(input: CheckInInput): Promise<{ checkIn: CheckIn; duplicate: boolean }> {
  await ensureAttendanceSchema()
  const moment = eventMoment(input.at, input.source)
  return withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, moment.day, true)
    await lockAttendanceEmployee(tx, input.employeeId)
    const employee = (await tx.prepare("SELECT id, active, gps_check FROM employees WHERE id = ? FOR SHARE").get(input.employeeId)) as
      | { id: number; active: number; gps_check: number | null }
      | undefined
    if (!employee) throw new AttendanceError("Сотрудник не найден", 404, "employeeId")
    if (Number(employee.active) !== 1) throw new AttendanceError("Сотрудник неактивен", 400, "employeeId")

    if (input.idempotencyKey) {
      const stored = (await tx
        .prepare(`SELECT ${COLUMNS} FROM attendance_check_ins WHERE employee_id = ? AND idempotency_key = ?`)
        .get(input.employeeId, input.idempotencyKey)) as Row | undefined
      if (stored) {
        const storedAt = stored.occurred_at instanceof Date ? stored.occurred_at.getTime() : new Date(String(stored.occurred_at)).getTime()
        const same = stored.kind === input.kind && (!input.at || Math.abs(storedAt - moment.instant) < 1000)
        if (!same) throw new AttendanceError("Ключ повтора уже использован для другой отметки", 409, "idempotencyKey")
        return { checkIn: toCheckIn(stored), duplicate: true }
      }
    }

    if (input.source === "mobile" && Number(employee.gps_check) === 1 && input.lat === null) {
      throw new AttendanceError("Для отметки нужны координаты GPS", 400, "lat")
    }

    const events = (await tx
      .prepare(`SELECT ${COLUMNS} FROM attendance_check_ins WHERE employee_id = ? AND local_day = ? ORDER BY local_time, id`)
      .all(input.employeeId, moment.day)) as Row[]
    checkOrder(events, input.kind, moment.time)

    const inserted = (await tx
      .prepare(
        `INSERT INTO attendance_check_ins
           (employee_id, user_id, kind, occurred_at, local_day, local_time, lat, lng, accuracy, place, comment, source, device_id, idempotency_key, created_by)
         VALUES (@employeeId, @userId, @kind, to_timestamp(@instant::float8 / 1000), @day, @time, @lat, @lng, @accuracy, @place, @comment, @source, @deviceId, @key, @actor)
         RETURNING ${COLUMNS}`,
      )
      .get({
        employeeId: input.employeeId,
        userId: input.userId,
        kind: input.kind,
        instant: moment.instant,
        day: moment.day,
        time: moment.time,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        place: input.place ?? "",
        comment: input.comment ?? "",
        source: input.source,
        deviceId: input.deviceId ?? "",
        key: input.idempotencyKey || null,
        actor: input.actor,
      })) as Row
    if (moment.day < todayIso()) await refreshDerivedDay(tx, input.employeeId, moment.day)
    return { checkIn: toCheckIn(inserted), duplicate: false }
  })
}
