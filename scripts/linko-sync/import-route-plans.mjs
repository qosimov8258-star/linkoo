// Маршруты / visit plans: the route plans of the Linko account (market/plan: agent, client, weekdays) into
// field_route_plans, which the route pages, the day status of Отслеживание and the visit reports read.
// Linko week_day 1..7 = Monday..Sunday (ISO) → the weekday bit mask; "every N weeks" only when Linko's every_weeks
// is set (else weekly, as Linko plans them). Linko keeps no start date: plans count from the account's first month
// (START env, default 2024-09-01). Reference ids are kept.
//
//   node scripts/linko-sync/import-route-plans.mjs        (raw file: market_plans)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const START = process.env.START || "2024-09-01"
const run = runId("route-plans")
const plans = raw("market_plans")

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, skipped: [] }
try {
  await client.query("BEGIN")
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  const clients = new Set((await client.query("SELECT id FROM clients")).rows.map((row) => Number(row.id)))
  for (const plan of plans) {
    const employeeId = Number(plan.agent?.id)
    const clientId = Number(plan.market?.id)
    const days = [...new Set((plan.recurrences ?? []).map((r) => Number(r.week_day)).filter((d) => d >= 1 && d <= 7))]
    const weekdays = days.reduce((mask, day) => mask | (1 << (day - 1)), 0)
    if (!employees.has(employeeId) || !clients.has(clientId) || !weekdays) {
      stats.skipped.push(plan.id)
      continue
    }
    const values = {
      employee_id: employeeId,
      client_id: clientId,
      weekdays,
      interval_weeks: plan.every_weeks ? Math.min(Math.max(Number(plan.week_period) || 1, 1), 4) : 1,
      start_date: START,
      route_position: Number(plan.priority) > 0 ? Number(plan.priority) : null,
    }
    const current = (await client.query(
      "SELECT employee_id, client_id, weekdays, interval_weeks, to_char(start_date, 'YYYY-MM-DD') AS start_date, route_position FROM field_route_plans WHERE id = $1",
      [plan.id],
    )).rows[0]
    if (!current) {
      // A plan of the same employee and client under another id (made locally) gives way to Linko's.
      await client.query("DELETE FROM field_route_plans WHERE employee_id = $1 AND client_id = $2 AND id <> $3", [employeeId, clientId, plan.id])
      await client.query(
        `INSERT INTO field_route_plans (id, employee_id, client_id, weekdays, interval_weeks, start_date, route_position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [plan.id, values.employee_id, values.client_id, values.weekdays, values.interval_weeks, values.start_date, values.route_position],
      )
      await register(client, run, "field_route_plans", plan.id, "insert")
      stats.insert++
      continue
    }
    const changed = Object.keys(values).filter((key) => String(current[key] ?? "") !== String(values[key] ?? ""))
    if (!changed.length) {
      stats.same++
      continue
    }
    await client.query(
      `UPDATE field_route_plans SET ${changed.map((key, i) => `${key} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [plan.id, ...changed.map((key) => values[key])],
    )
    await register(client, run, "field_route_plans", plan.id, "update", Object.fromEntries(changed.map((key) => [key, current[key]])))
    stats.update++
  }
  await client.query("SELECT setval(pg_get_serial_sequence('field_route_plans', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM field_route_plans), 1))")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`route plans: ${plans.length} in Linko →`, JSON.stringify(stats))
