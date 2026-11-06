// Сессия: the sign-in journal of the Linko account (main/auth_log: who, IP, browser, device, when, last response,
// active / ended) into auth_logs by Linko id. created_at / last_response_at are stored the way the app writes them
// (UTC "YYYY-MM-DD HH:MM:SS"; Linko sends Tashkent time). Rows of this app's own sign-ins (ids Linko does not have)
// are left alone.
//
//   node scripts/linko-sync/import-auth-logs.mjs        (raw file: auth_logs)
import { connect, ensureRegistry, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("auth-logs")
const logs = raw("auth_logs")
const utcText = (local) => (local ? utcIso(local).slice(0, 19).replace("T", " ") : null)

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, skipped: [] }
try {
  await client.query("BEGIN")
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  const current = new Map((await client.query("SELECT id, employee_id, ip, browser, device, created_at, last_response_at, is_active FROM auth_logs")).rows.map((row) => [Number(row.id), row]))
  for (const log of logs) {
    const employeeId = Number(log.user?.id)
    if (!employees.has(employeeId)) {
      stats.skipped.push(log.id)
      continue
    }
    const values = {
      employee_id: employeeId,
      ip: log.ip ?? null,
      browser: String(log.browser ?? ""),
      device: log.device ?? null,
      created_at: utcText(log.created_date),
      last_response_at: utcText(log.last_response_date),
      is_active: log.is_active ? 1 : 0,
    }
    const row = current.get(Number(log.id))
    if (!row) {
      await client.query(
        "INSERT INTO auth_logs (id, employee_id, ip, browser, device, created_at, last_response_at, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [log.id, ...Object.values(values)],
      )
      await register(client, run, "auth_logs", log.id, "insert")
      stats.insert++
      continue
    }
    const changed = Object.keys(values).filter((key) => String(row[key] ?? "") !== String(values[key] ?? ""))
    if (!changed.length) {
      stats.same++
      continue
    }
    await client.query(`UPDATE auth_logs SET ${changed.map((key, i) => `${key} = $${i + 2}`).join(", ")} WHERE id = $1`, [log.id, ...changed.map((key) => values[key])])
    await register(client, run, "auth_logs", log.id, "update", Object.fromEntries(changed.map((key) => [key, row[key]])))
    stats.update++
  }
  await client.query("SELECT setval(pg_get_serial_sequence('auth_logs', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM auth_logs), 1))")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`auth logs: ${logs.length} in Linko →`, JSON.stringify({ ...stats, skipped: stats.skipped.length }))
