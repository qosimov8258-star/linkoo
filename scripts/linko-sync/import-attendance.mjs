// Посещаемость: the attendance marks of the Linko account (staff/attendance per month: on time / late / not come /
// holiday per employee and day) into attendance_days (source 'import', which the page shows over its own derived
// days), and the month's days off: a month whose Linko days off are not just its Sundays gets exactly those days
// (attendance_weekend_days + the attendance_weekend_months marker), as Настройки выходных stores an edited month.
//
//   node scripts/linko-sync/import-attendance.mjs        (raw file: attendance_months)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("attendance")
const months = raw("attendance_months")

const sundaysOf = (year, month) => {
  const days = []
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  for (let day = 1; day <= count; day++) if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0) days.push(day)
  return days
}

const client = await connect()
await ensureRegistry(client)
const stats = { marks: { insert: 0, update: 0, same: 0 }, skippedEmployees: new Set(), monthsOff: [] }
try {
  await client.query("BEGIN")
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  for (const [key, month] of Object.entries(months).sort()) {
    if (!month || month.__status) continue
    const [year, mon] = key.split("-").map(Number)
    const off = [...new Set((month.holidays ?? []).filter((d) => d.startsWith(key)).map((d) => Number(d.slice(8, 10))))].sort((a, b) => a - b)
    const sundays = sundaysOf(year, mon)
    const stored = (await client.query("SELECT day FROM attendance_weekend_days WHERE year = $1 AND month = $2", [year, mon - 1])).rows.map((r) => Number(r.day))
    const marked = (await client.query("SELECT 1 FROM attendance_weekend_months WHERE year = $1 AND month = $2", [year, mon - 1])).rowCount > 0
    const plainSundays = off.length === sundays.length && off.every((d, i) => d === sundays[i])
    if (!plainSundays) {
      for (const day of off.filter((d) => !stored.includes(d))) {
        await client.query("INSERT INTO attendance_weekend_days (year, month, day) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [year, mon - 1, day])
      }
      const extra = stored.filter((d) => !off.includes(d))
      if (extra.length) await client.query("DELETE FROM attendance_weekend_days WHERE year = $1 AND month = $2 AND day = ANY($3::int[])", [year, mon - 1, extra])
      if (!marked) await client.query("INSERT INTO attendance_weekend_months (year, month, updated_by) VALUES ($1, $2, 'Linko') ON CONFLICT DO NOTHING", [year, mon - 1])
      await register(client, run, "attendance_weekend_days", key, "set", { stored, marked })
      stats.monthsOff.push(`${key}:${off.join(",")}`)
    } else if (stored.length && !marked) {
      // Sundays only in Linko: a stored extra day would add to them.
      await client.query("DELETE FROM attendance_weekend_days WHERE year = $1 AND month = $2", [year, mon - 1])
      await register(client, run, "attendance_weekend_days", key, "clear", { stored })
    }

    for (const user of month.users ?? []) {
      const employeeId = Number(user.id)
      if (!employees.has(employeeId)) {
        stats.skippedEmployees.add(employeeId)
        continue
      }
      for (const mark of user.dates ?? []) {
        if (!mark?.type || !String(mark.date ?? "").startsWith(key)) continue
        const time = mark.time ? String(mark.time).slice(0, 5) : null
        const values = [employeeId, mark.date, mark.type, time, Number(mark.late_minutes) || 0, String(mark.comment ?? "")]
        const current = (await client.query("SELECT type, arrival_time, late_minutes, comment, source FROM attendance_days WHERE employee_id = $1 AND day = $2", [employeeId, mark.date])).rows[0]
        if (!current) {
          await client.query(
            `INSERT INTO attendance_days (employee_id, day, type, arrival_time, late_minutes, comment, source, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'import', 'Linko')`,
            values,
          )
          stats.marks.insert++
          continue
        }
        if (current.type === mark.type && (current.arrival_time ?? null) === time && Number(current.late_minutes) === values[4] && (current.comment ?? "") === values[5]) {
          stats.marks.same++
          continue
        }
        await client.query(
          `UPDATE attendance_days SET type = $3, arrival_time = $4, late_minutes = $5, comment = $6, source = 'import', updated_by = 'Linko', updated_at = datetime('now')
            WHERE employee_id = $1 AND day = $2`,
          values,
        )
        await register(client, run, "attendance_days", `${employeeId}:${mark.date}`, "update", current)
        stats.marks.update++
      }
    }
  }
  await register(client, run, "attendance_days", "linko:*", "import", { ...stats.marks })
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`attendance: marks ${JSON.stringify(stats.marks)}; months with own days off: ${stats.monthsOff.join(" | ") || "none"}${stats.skippedEmployees.size ? `; employees missing: ${[...stats.skippedEmployees].join(",")}` : ""}`)
