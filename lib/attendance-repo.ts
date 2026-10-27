import "server-only"

import { activityOf, shiftDay, utcStartOf } from "@/lib/attendance-activity"
import { ensureAttendanceSchema, lockAttendanceMonth } from "@/lib/attendance-schema"
import { lateAfterOf } from "@/lib/attendance-settings-repo"
import {
  deriveDay,
  emptyCounts,
  isoDay,
  monthDays,
  timeMinutes,
  type AttendanceDay,
  type AttendanceDayDetail,
  type AttendanceMonth,
  type AttendanceSource,
  type AttendanceType,
  type AttendanceUser,
  type EditableType,
} from "@/lib/attendance-types"
import { holidaysOf } from "@/lib/attendance-weekend-days-repo"
import { listCheckInsOf } from "@/lib/check-ins-repo"
import { AttendanceError, type AttendanceIssue } from "@/lib/attendance-errors"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { parseAnyDay, todayIso } from "@/lib/finance/dates"
import { ORDER_EXCLUDED_STATUSES } from "@/lib/finance/types"
import { keySql, nameKey } from "@/lib/platform-refs"

// Посещаемость (/analytics/work-attendance): the month matrix, Изменить, Перерасчет, the
// Excel import and the agent-day drawer. Rules and tables: lib/attendance-schema.ts and
// design-attendance.md. Effective day = manual/import row > derived row (past days,
// attendance_auto_days) > live derivation (today) > none (future, before the employee's start).

type EmployeeRow = { id: number; first_name: string; last_name: string; position: string; branch: string; created_at: string; active: number }

export type AttendanceEmployee = { id: number; name: string; position: string; branch: string; createdDay: string | null; active: boolean }

const fullName = (row: { first_name: string; last_name: string }) => `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim()

function toEmployee(row: EmployeeRow): AttendanceEmployee {
  return {
    id: Number(row.id),
    name: fullName(row),
    position: String(row.position ?? ""),
    branch: String(row.branch ?? ""),
    createdDay: parseAnyDay(row.created_at, true),
    active: Number(row.active) === 1,
  }
}

const hhmm = (value: string | null | undefined) => (value ? String(value).slice(0, 5) : null)

async function tableExists(db: PgDb, name: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@name) IS NOT NULL AS ok").get({ name })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

// ---------------------------------------------------------------------------
// Starts
// ---------------------------------------------------------------------------

/** First day attendance counts for each employee: the earliest of his registration day,
 * his first check-in and his first manual day (no "absent" before he was hired). */
async function startsOf(db: PgDb, employees: AttendanceEmployee[]): Promise<Map<number, string | null>> {
  const ids = employees.map((employee) => employee.id)
  const starts = new Map<number, string | null>(employees.map((employee) => [employee.id, employee.createdDay]))
  if (!ids.length) return starts
  const rows = (await db
    .prepare(
      `SELECT employee_id, MIN(day) AS first FROM (
         SELECT employee_id, MIN(local_day) AS day FROM attendance_check_ins WHERE employee_id = ANY(@ids::int[]) GROUP BY 1
         UNION ALL
         SELECT employee_id, MIN(day) AS day FROM attendance_days WHERE employee_id = ANY(@ids::int[]) GROUP BY 1
       ) s GROUP BY employee_id`,
    )
    .all({ ids })) as { employee_id: number; first: string }[]
  for (const row of rows) {
    const id = Number(row.employee_id)
    const current = starts.get(id)
    starts.set(id, current && current < row.first ? current : row.first)
  }
  return starts
}

// ---------------------------------------------------------------------------
// Derived days (attendance_auto_days)
// ---------------------------------------------------------------------------

type MonthContext = { year: number; month: number; first: string; last: string; today: string; yesterday: string; lateAfter: string; holidays: Set<string> }

async function monthContext(db: PgDb, year: number, month: number): Promise<MonthContext> {
  const days = monthDays(year, month)
  const today = todayIso()
  const holidays = await holidaysOf(db, year, month)
  return {
    year,
    month,
    first: days[0],
    last: days[days.length - 1],
    today,
    yesterday: shiftDay(today, -1),
    lateAfter: await lateAfterOf(db),
    holidays: new Set(holidays.dates),
  }
}

/** Window of derived (stored) days of an employee in the month: [max(first, start), min(last, yesterday)]. */
function storedWindow(ctx: MonthContext, start: string | null | undefined): [string, string] | null {
  const from = start && start > ctx.first ? start : ctx.first
  const to = ctx.last < ctx.yesterday ? ctx.last : ctx.yesterday
  return from <= to ? [from, to] : null
}

/** Inserts the missing derived days of the employees (current late_after as their snapshot). */
async function materialize(tx: PgDb, ctx: MonthContext, employees: AttendanceEmployee[], starts: Map<number, string | null>): Promise<number> {
  const windows = employees.map((employee) => ({ id: employee.id, window: storedWindow(ctx, starts.get(employee.id)) })).filter((item) => item.window)
  if (!windows.length) return 0
  const ids = windows.map((item) => item.id)
  const from = windows.reduce((min, item) => (item.window![0] < min ? item.window![0] : min), ctx.last)
  const to = windows.reduce((max, item) => (item.window![1] > max ? item.window![1] : max), ctx.first)
  const existing = (await tx
    .prepare("SELECT employee_id, day FROM attendance_auto_days WHERE employee_id = ANY(@ids::int[]) AND day BETWEEN @from AND @to")
    .all({ ids, from, to })) as { employee_id: number; day: string }[]
  const have = new Set(existing.map((row) => `${row.employee_id}|${row.day}`))
  const activity = await activityOf(tx, ids, from, to)
  const rows = { emp: [] as number[], day: [] as string[], type: [] as string[], arrival: [] as (string | null)[], leave: [] as (string | null)[], late: [] as number[] }
  for (const { id, window } of windows) {
    for (const day of monthDays(ctx.year, ctx.month)) {
      if (day < window![0] || day > window![1] || have.has(`${id}|${day}`)) continue
      const act = activity.get(`${id}|${day}`)
      const derived = deriveDay(ctx.holidays.has(day), act?.arrival ?? null, ctx.lateAfter)
      rows.emp.push(id)
      rows.day.push(day)
      rows.type.push(derived.type)
      rows.arrival.push(act?.arrival ?? null)
      rows.leave.push(act?.leave ?? null)
      rows.late.push(derived.lateMinutes)
    }
  }
  if (!rows.emp.length) return 0
  await tx
    .prepare(
      `INSERT INTO attendance_auto_days (employee_id, day, type, arrival_time, leave_time, late_minutes, late_after)
       SELECT e, d, t, a, l, m, @lateAfter
         FROM unnest(@emp::int[], @day::text[], @type::text[], @arrival::text[], @leave::text[], @late::int[]) AS u(e, d, t, a, l, m)
       ON CONFLICT (employee_id, day) DO NOTHING`,
    )
    .all({ ...rows, lateAfter: ctx.lateAfter })
  return rows.emp.length
}

/** Makes sure every past day of the shown employees is derived (once; under the month lock). */
async function ensureMaterialized(ctx: MonthContext, employees: AttendanceEmployee[], starts: Map<number, string | null>): Promise<void> {
  let expected = 0
  let from = ctx.last
  let to = ctx.first
  for (const employee of employees) {
    const window = storedWindow(ctx, starts.get(employee.id))
    if (!window) continue
    expected += monthDays(ctx.year, ctx.month).filter((day) => day >= window[0] && day <= window[1]).length
    if (window[0] < from) from = window[0]
    if (window[1] > to) to = window[1]
  }
  if (!expected) return
  const ids = employees.map((employee) => employee.id)
  const count = (await getDb()
    .prepare("SELECT COUNT(*)::int AS n FROM attendance_auto_days WHERE employee_id = ANY(@ids::int[]) AND day BETWEEN @from AND @to")
    .get({ ids, from, to })) as { n: number }
  if (Number(count.n) >= expected) return
  await withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, ctx.first)
    await materialize(tx, ctx, employees, starts)
  })
}

// ---------------------------------------------------------------------------
// The month matrix
// ---------------------------------------------------------------------------

type DayRow = { employee_id: number; day: string; type: AttendanceType; arrival_time: string | null; leave_time?: string | null; late_minutes: number; comment?: string; source?: string }

/** Effective day entries of the employees for the month (materializing past days first). */
async function computeMonth(db: PgDb, ctx: MonthContext, employees: AttendanceEmployee[]): Promise<Map<number, Map<string, AttendanceDay>>> {
  const result = new Map<number, Map<string, AttendanceDay>>(employees.map((employee) => [employee.id, new Map()]))
  if (!employees.length) return result
  const ids = employees.map((employee) => employee.id)
  const starts = await startsOf(db, employees)
  await ensureMaterialized(ctx, employees, starts)

  const auto = (await db
    .prepare(
      `SELECT employee_id, day, type, arrival_time, leave_time, late_minutes FROM attendance_auto_days
        WHERE employee_id = ANY(@ids::int[]) AND day BETWEEN @from AND @to`,
    )
    .all({ ids, from: ctx.first, to: ctx.last < ctx.yesterday ? ctx.last : ctx.yesterday })) as DayRow[]
  const leaves = new Map<string, string | null>()
  for (const row of auto) {
    const start = starts.get(Number(row.employee_id))
    if (start && row.day < start) continue
    leaves.set(`${row.employee_id}|${row.day}`, row.leave_time ?? null)
    result.get(Number(row.employee_id))?.set(row.day, {
      date: row.day,
      type: row.type,
      time: hhmm(row.arrival_time),
      leaveTime: hhmm(row.leave_time),
      lateMinutes: Number(row.late_minutes) || 0,
      comment: null,
      source: "auto",
    })
  }

  // Today: derived live from the activity so far (no arrival yet = no mark: the day is not over).
  if (ctx.today >= ctx.first && ctx.today <= ctx.last) {
    const activity = await activityOf(db, ids, ctx.today, ctx.today)
    for (const employee of employees) {
      const start = starts.get(employee.id)
      if (start && ctx.today < start) continue
      const act = activity.get(`${employee.id}|${ctx.today}`)
      const holiday = ctx.holidays.has(ctx.today)
      if (!act?.arrival && !holiday) continue
      const derived = deriveDay(holiday, act?.arrival ?? null, ctx.lateAfter)
      leaves.set(`${employee.id}|${ctx.today}`, act?.leave ?? null)
      result.get(employee.id)?.set(ctx.today, {
        date: ctx.today,
        type: derived.type,
        time: hhmm(act?.arrival),
        leaveTime: hhmm(act?.leave),
        lateMinutes: derived.lateMinutes,
        comment: null,
        source: "auto",
      })
    }
  }

  const manual = (await db
    .prepare(
      `SELECT employee_id, day, type, arrival_time, late_minutes, comment, source FROM attendance_days
        WHERE employee_id = ANY(@ids::int[]) AND day BETWEEN @from AND @to`,
    )
    .all({ ids, from: ctx.first, to: ctx.last })) as DayRow[]
  for (const row of manual) {
    result.get(Number(row.employee_id))?.set(row.day, {
      date: row.day,
      type: row.type,
      time: hhmm(row.arrival_time),
      leaveTime: hhmm(leaves.get(`${row.employee_id}|${row.day}`)),
      lateMinutes: Number(row.late_minutes) || 0,
      comment: row.comment ? String(row.comment) : null,
      source: (row.source === "import" ? "import" : "manual") as AttendanceSource,
    })
  }
  return result
}

const EMPLOYEE_COLUMNS = "id, first_name, last_name, position, branch, created_at, active"

/** Active employees, newest first, by name search and branch ids. */
async function shownEmployees(db: PgDb, search: string, branchIds: number[]): Promise<AttendanceEmployee[]> {
  const where = ["active = 1"]
  const params: Record<string, unknown> = {}
  if (branchIds.length) {
    // branches is created by lib/branches-repo.ts on first use (not in the bootstrap): a fresh
    // database without it has no branch to filter by.
    const branches = (await tableExists(db, "branches"))
      ? ((await db.prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[])").all({ ids: branchIds })) as { id: number; name: string }[])
      : []
    if (branches.length !== new Set(branchIds).size) throw new AttendanceError("Филиал не найден", 400, "branch")
    params.branches = branches.map((branch) => nameKey(String(branch.name ?? "")))
    where.push(`${keySql("branch")} = ANY(@branches::text[])`)
  }
  const needle = nameKey(search)
  if (needle) {
    params.needle = needle
    where.push(
      `(strpos(${keySql("first_name || ' ' || last_name")}, @needle) > 0 OR strpos(${keySql("last_name || ' ' || first_name")}, @needle) > 0)`,
    )
  }
  const rows = (await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE ${where.join(" AND ")} ORDER BY id DESC`).all(...(Object.keys(params).length ? [params] : []))) as EmployeeRow[]
  return rows.map(toEmployee)
}

/** GET /api/work-attendance: the month matrix (month 1..12). */
export async function listAttendance(params: { year: number; month: number; search: string; branchIds: number[] }): Promise<AttendanceMonth> {
  await ensureAttendanceSchema()
  const db = getDb()
  const ctx = await monthContext(db, params.year, params.month)
  const employees = await shownEmployees(db, params.search, params.branchIds)
  const days = await computeMonth(db, ctx, employees)
  const users: AttendanceUser[] = employees.map((employee) => {
    const dates = [...(days.get(employee.id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    const counts = emptyCounts()
    let totalLateMinutes = 0
    for (const day of dates) {
      counts[day.type] += 1
      if (day.type === "late") totalLateMinutes += day.lateMinutes
    }
    return { id: employee.id, name: employee.name, position: employee.position, branch: employee.branch, totalLateMinutes, counts, dates }
  })
  const holidays = [...ctx.holidays].sort()
  return {
    year: params.year,
    month: params.month,
    today: ctx.today,
    lateAfter: ctx.lateAfter,
    holidays,
    workingDays: monthDays(params.year, params.month).length - holidays.length,
    users,
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Active employees by id, locked FOR SHARE (no deactivation / delete meanwhile); 400 on any unknown id. */
async function lockActiveEmployees(tx: PgDb, ids: number[]): Promise<AttendanceEmployee[]> {
  const unique = [...new Set(ids)]
  const rows = (await tx
    .prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ANY(@ids::int[]) AND active = 1 ORDER BY id FOR SHARE`)
    .all({ ids: unique })) as EmployeeRow[]
  if (rows.length !== unique.length) throw new AttendanceError("Сотрудник не найден или неактивен", 400, "employeeIds")
  return rows.map(toEmployee)
}

const LATE_TIME_EARLY = "Время прихода должно быть позже начала рабочего дня"
const ON_TIME_TIME_LATE = "Время прихода позже начала рабочего дня — выберите «Опоздал»"

/** Arrival time and late minutes of a manually set type (time "HH:MM" or null). */
function manualTiming(type: EditableType, time: string | null, lateAfter: string): { time: string | null; lateMinutes: number } {
  if (type !== "on_time" && type !== "late") return { time: null, lateMinutes: 0 }
  if (!time) return { time: null, lateMinutes: 0 }
  const arrived = timeMinutes(time)!
  const limit = timeMinutes(lateAfter) ?? 9 * 60
  if (type === "late" && arrived <= limit) throw new AttendanceError(LATE_TIME_EARLY, 400, "time")
  if (type === "on_time" && arrived > limit) throw new AttendanceError(ON_TIME_TIME_LATE, 400, "time")
  return { time, lateMinutes: type === "late" ? arrived - limit : 0 }
}

type ManualRow = { employeeId: number; day: string; type: EditableType; time: string | null; lateMinutes: number; comment: string }

async function upsertManual(tx: PgDb, rows: ManualRow[], source: "manual" | "import", actor: string): Promise<void> {
  if (!rows.length) return
  await tx
    .prepare(
      `INSERT INTO attendance_days (employee_id, day, type, arrival_time, late_minutes, comment, source, updated_by)
       SELECT e, d, t, a, m, c, @source, @actor
         FROM unnest(@emp::int[], @day::text[], @type::text[], @time::text[], @late::int[], @comment::text[]) AS u(e, d, t, a, m, c)
       ON CONFLICT (employee_id, day) DO UPDATE SET
         type = EXCLUDED.type, arrival_time = EXCLUDED.arrival_time, late_minutes = EXCLUDED.late_minutes,
         comment = EXCLUDED.comment, source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = datetime('now')`,
    )
    .all({
      emp: rows.map((row) => row.employeeId),
      day: rows.map((row) => row.day),
      type: rows.map((row) => row.type),
      time: rows.map((row) => row.time),
      late: rows.map((row) => row.lateMinutes),
      comment: rows.map((row) => row.comment),
      source,
      actor,
    })
}

/** Изменить: sets one day (already checked: not in the future) for the ticked employees. */
export async function setDays(input: { employeeIds: number[]; date: string; type: EditableType; time: string | null; comment: string; actor: string }): Promise<{ updated: number }> {
  await ensureAttendanceSchema()
  return withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, input.date)
    const timing = manualTiming(input.type, input.time, await lateAfterOf(tx))
    const employees = await lockActiveEmployees(tx, input.employeeIds)
    await upsertManual(
      tx,
      employees.map((employee) => ({ employeeId: employee.id, day: input.date, type: input.type, time: timing.time, lateMinutes: timing.lateMinutes, comment: input.comment })),
      "manual",
      input.actor,
    )
    return { updated: employees.length }
  })
}

/** Перерасчет: rebuilds the month's derived days with the current work time and holidays
 * (manual and imported days stay as they are). */
export async function recalcMonth(input: { year: number; month: number }): Promise<{ recalculated: number }> {
  await ensureAttendanceSchema()
  return withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, isoDay(input.year, input.month, 1))
    const ctx = await monthContext(tx, input.year, input.month)
    const to = ctx.last < ctx.yesterday ? ctx.last : ctx.yesterday
    if (ctx.first > to) return { recalculated: 0 }
    await tx.prepare("DELETE FROM attendance_auto_days WHERE day BETWEEN ? AND ?").run(ctx.first, to)
    const rows = (await tx.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE active = 1 ORDER BY id`).all()) as EmployeeRow[]
    const employees = rows.map(toEmployee)
    const starts = await startsOf(tx, employees)
    return { recalculated: await materialize(tx, ctx, employees, starts) }
  })
}

// ---------------------------------------------------------------------------
// Excel import ("Обновить с excel")
// ---------------------------------------------------------------------------

const MAX_ISSUES = 100
const TYPE_WORDS: Record<string, EditableType> = {
  on_time: "on_time",
  late: "late",
  not_come: "not_come",
  sick_leave: "sick_leave",
  vacation: "vacation",
  "пришел вовремя": "on_time",
  "вовремя": "on_time",
  "опоздал": "late",
  "не пришел": "not_come",
  "больничный": "sick_leave",
  "отпуск": "vacation",
}

/** A header cell → "YYYY-MM-DD": "01.10.2026", "2026-10-01" or an Excel day serial (a date cell). */
function headerDay(cell: string): string | null {
  const text = cell.trim()
  if (/^\d{5}(?:\.0+)?$/.test(text)) {
    const serial = Number(text)
    // 36526 = 2000-01-01, 73415 = 2100-12-31 (1900 date system; day 0 = 1899-12-30).
    if (serial < 36526 || serial > 73415) return null
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  return parseAnyDay(text)
}

type ImportCell = { day: string; value: "1" | "0" | EditableType; column: number }

/** Обновить с excel: rows of the template (first row = header; first column = employee;
 * one column per date "DD.MM.YYYY"; cells 1 / 0 / a type). All-or-nothing. A cell only
 * changes a day whose current state it contradicts, so an unchanged template changes nothing. */
export async function importMonth(input: { year: number; month: number; rows: string[][]; actor: string }): Promise<{ updated: number; unchanged: number }> {
  await ensureAttendanceSchema()
  const issues: AttendanceIssue[] = []
  const issue = (item: AttendanceIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(item)
  }
  const [header = [], ...body] = input.rows
  const first = isoDay(input.year, input.month, 1)
  const last = monthDays(input.year, input.month).at(-1)!
  const dateColumns: { index: number; day: string }[] = []
  const seenDays = new Set<string>()
  header.forEach((cell, index) => {
    if (index === 0) return
    const day = headerDay(String(cell ?? ""))
    if (!day) return
    if (day < first || day > last) issue({ row: 1, column: index + 1, error: "Дата вне выбранного месяца", value: String(cell) })
    else if (seenDays.has(day)) issue({ row: 1, column: index + 1, error: "Дата повторяется", value: String(cell) })
    else {
      seenDays.add(day)
      dateColumns.push({ index, day })
    }
  })
  if (!dateColumns.length && !issues.length) throw new AttendanceError("В файле нет колонок с датами выбранного месяца", 400, "rows")

  const db = getDb()
  const active = ((await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE active = 1`).all()) as EmployeeRow[]).map(toEmployee)
  const byName = new Map<string, AttendanceEmployee[]>()
  for (const employee of active) {
    const key = nameKey(employee.name)
    byName.set(key, [...(byName.get(key) ?? []), employee])
  }
  const today = todayIso()
  const planned = new Map<number, { employee: AttendanceEmployee; cells: ImportCell[] }>()
  body.forEach((cells, offset) => {
    const rowNumber = offset + 2
    const values = cells.map((cell) => String(cell ?? "").trim())
    if (values.every((value) => !value)) return
    const name = values[0] ?? ""
    if (!name) return issue({ row: rowNumber, column: 1, error: "Не указан сотрудник" })
    const found = byName.get(nameKey(name)) ?? []
    if (!found.length) return issue({ row: rowNumber, column: 1, error: "Сотрудник не найден", value: name })
    if (found.length > 1) return issue({ row: rowNumber, column: 1, error: "Найдено несколько сотрудников с таким именем", value: name })
    const employee = found[0]
    if (planned.has(employee.id)) return issue({ row: rowNumber, column: 1, error: "Сотрудник указан несколько раз", value: name })
    const parsed: ImportCell[] = []
    for (const { index, day } of dateColumns) {
      const raw = (values[index] ?? "").toLowerCase().replace(/\s+/g, " ")
      if (!raw) continue
      const value = raw === "1" || raw === "1.0" ? "1" : raw === "0" || raw === "0.0" ? "0" : TYPE_WORDS[raw]
      if (!value) {
        issue({ row: rowNumber, column: index + 1, error: "Неверное значение", value: values[index] })
        continue
      }
      if (day > today) {
        if (value !== "0") issue({ row: rowNumber, column: index + 1, error: "Дата не может быть позже сегодняшнего дня", value: values[index] })
        continue
      }
      parsed.push({ day, value, column: index + 1 })
    }
    planned.set(employee.id, { employee, cells: parsed })
  })
  if (issues.length) throw new AttendanceError("Ошибки в файле", 400, "rows", issues)

  return withTransaction(async (tx) => {
    await lockAttendanceMonth(tx, first)
    const employees = await lockActiveEmployees(tx, [...planned.keys()])
    const ctx = await monthContext(tx, input.year, input.month)
    const current = await computeMonth(tx, ctx, employees)
    const changes: ManualRow[] = []
    let unchanged = 0
    for (const { employee, cells } of planned.values()) {
      for (const cell of cells) {
        const now = current.get(employee.id)?.get(cell.day)?.type
        const came = now === "on_time" || now === "late"
        let next: EditableType | null = null
        if (cell.value === "1") next = came ? null : "on_time"
        else if (cell.value === "0") next = came ? "not_come" : null
        else next = now === cell.value ? null : cell.value
        if (!next) {
          unchanged += 1
          continue
        }
        changes.push({ employeeId: employee.id, day: cell.day, type: next, time: null, lateMinutes: 0, comment: "" })
      }
    }
    await upsertManual(tx, changes, "import", input.actor)
    return { updated: changes.length, unchanged }
  })
}

// ---------------------------------------------------------------------------
// Agent-day drawer
// ---------------------------------------------------------------------------

/** Orders the employee took as agent on a local day: count and totals per currency (never mixed). */
async function ordersOfDay(db: PgDb, employeeName: string, day: string): Promise<AttendanceDayDetail["orders"]> {
  const params = {
    name: employeeName,
    fromUtc: utcStartOf(day),
    toUtc: utcStartOf(shiftDay(day, 1)),
    excluded: [...ORDER_EXCLUDED_STATUSES],
  }
  const filter = `${keySql("o.agent")} = ${keySql("@name::text")} AND o.created_at >= @fromUtc AND o.created_at < @toUtc AND NOT (o.status = ANY(@excluded::text[]))`
  const count = (await db.prepare(`SELECT COUNT(*)::int AS n FROM orders o WHERE ${filter}`).get(params)) as { n: number }
  const totals = new Map<string, number>()
  if (Number(count.n) > 0 && (await tableExists(db, "order_items"))) {
    const rows = (await db
      .prepare(
        `SELECT COALESCE(NULLIF(btrim(i.currency), ''), NULLIF(btrim(o.currency), ''), '') AS currency,
                SUM(COALESCE(i.quantity, 0)::float8 * COALESCE(i.unit_price, 0)::float8 * (1 - COALESCE(i.discount_percent, 0)::float8 / 100)) AS amount
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE ${filter}
          GROUP BY 1`,
      )
      .all(params)) as { currency: string; amount: number }[]
    for (const row of rows) {
      const code = normCurrency(row.currency)
      totals.set(code, (totals.get(code) ?? 0) + Number(row.amount || 0))
    }
  }
  return { count: Number(count.n) || 0, totals: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })) }
}

/** GET /api/work-attendance/day: one employee-day (any valid date; the future is simply empty). */
export async function dayDetail(employeeId: number, date: string): Promise<AttendanceDayDetail> {
  await ensureAttendanceSchema()
  const db = getDb()
  const row = (await db.prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = ?`).get(employeeId)) as EmployeeRow | undefined
  if (!row) throw new AttendanceError("Сотрудник не найден", 404, "employeeId")
  const employee = toEmployee(row)
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const ctx = await monthContext(db, year, month)
  const days = await computeMonth(db, ctx, [employee])
  const entry = days.get(employee.id)?.get(date) ?? null
  const manual = (await db.prepare("SELECT updated_by, updated_at FROM attendance_days WHERE employee_id = ? AND day = ?").get(employeeId, date)) as
    | { updated_by: string; updated_at: string }
    | undefined
  return {
    employee: { id: employee.id, name: employee.name, position: employee.position, branch: employee.branch, active: employee.active },
    date,
    holiday: ctx.holidays.has(date),
    lateAfter: ctx.lateAfter,
    day: entry
      ? {
          ...entry,
          updatedBy: entry.source !== "auto" && manual ? manual.updated_by || null : null,
          updatedAt: entry.source !== "auto" && manual ? manual.updated_at || null : null,
        }
      : null,
    checkIns: await listCheckInsOf(db, employeeId, date),
    orders: await ordersOfDay(db, employee.name, date),
  }
}
