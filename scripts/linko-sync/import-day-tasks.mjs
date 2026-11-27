// Время работы агента (Аналитика): the tasks of Linko's day plans (raw day_plans.json, fetch step day-plans) into
// linko_day_tasks, by Linko task id — the planned visits, and every visit, order, delivery, payment, return, refusal,
// photo report and service time done in the field, each on the day of the plan it belongs to, done at Linko's own
// moment (Tashkent wall clock, microseconds). lib/agent-visits-repo.ts reads them for the days of the copied history
// (up to linko_history 'day_tasks'): «Задачи» and the plan / order columns of both «Показать по» values, the stays of
// «Время нахождения». Later days are computed from the app's own documents.
//
// A service time's stay: Linko keeps it to a fraction of a second, its task text («Обслуживание заняло 4 минут 2 сек.»)
// rounds it to a second, and the timed visit (raw visit_sessions) has its end to the second; from the start the phone
// sent (created_mobile_time, milliseconds) that leaves a range under a second, which Linko's own report rows (raw
// day_plans reports: each day's stays, span and rest cut to a second) narrow further; the stay is fitted into all of
// them. The services Linko's report shows started but never ended (no task, no timed visit) go to
// linko_open_services. With these the report equals Linko's on every day of the account (2024-09 … 2026-11: «Задачи»
// 612 days, «Время нахождения» 140 days, every column and agent row).
//
// The copied history ends at UNTIL ("YYYY-MM-DD HH:MM:SS", Tashkent), else at the latest linko_history moment of the
// database (when it was copied from Linko), else when the day plans were downloaded. A full replace: a re-run puts the
// downloaded tasks in place of the earlier ones.
//
//   node scripts/linko-sync/import-day-tasks.mjs        (raw: day_plans, visit_sessions)
import fs from "node:fs"
import path from "node:path"
import { connect, ensureRegistry, hasRaw, raw, rawDir, register, runId } from "./lib.mjs"

const run = runId("day-tasks")
if (!hasRaw("day_plans")) {
  console.log("day tasks: no raw day_plans (run fetch.mjs day-plans first)")
  process.exit(0)
}
const file = JSON.parse(fs.readFileSync(path.join(rawDir(), "day_plans.json"), "utf8"))
const plans = file.data?.plans ?? {}
const sessions = hasRaw("visit_sessions") ? raw("visit_sessions") : []

const DAY_MS = 24 * 3600_000
/** Milliseconds of a Tashkent wall-clock text ("YYYY-MM-DDTHH:MM:SS[.ffffff]"), for differences only. */
const ms = (local) => {
  const m = String(local).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + Number(`0.${m[7] ?? "0"}`) * 1000 : NaN
}
const textSeconds = (text) => {
  const m = /Обслуживание заняло (?:(\d+) минут )?(\d+) сек\./.exec(String(text ?? ""))
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null
}
const sessionOf = new Map(sessions.map((s) => [`${Number(s.user_id)}|${Number(s.market_id)}|${s.date}T${s.start_time}`, s]))

/** The seconds a service time task's stay can be: [low, high) (see the header); null for another task. */
function stayBounds(task, employeeId, clientId) {
  const text = textSeconds(task.text)
  if (text === null) return null
  const start = task.created_mobile_time
  const session = start ? sessionOf.get(`${employeeId}|${clientId}|${String(start).slice(0, 19)}`) : undefined
  if (!session) return [Math.max(0, text - 0.5), text + 0.5]
  const startMs = ms(`${session.date}T${session.start_time}`)
  let endMs = ms(`${session.date}T${session.end_time}`)
  // The end is a time of day: the visit's total minutes tell on which day it ended.
  while (endMs - startMs < Number(session.total_time) * 60_000 - DAY_MS / 2) endMs += DAY_MS
  const fraction = (ms(start) - startMs) / 1000
  const whole = (endMs - startMs) / 1000
  const low = Math.max(text - 0.5, whole - fraction, 0)
  const high = Math.min(text + 0.5, whole + 1 - fraction)
  return low < high ? [low, high] : [Math.max(0, text - 0.5), text + 0.5]
}

// Linko's own report figures narrow the stays further: each row of agent_work_hour (raw day_plans reports) shows a
// day's stays added up, its span and the rest, cut to the second (to the minute from a minute on, without whole days).
// The stays are fitted into those figures: «Задачи» rows (the service times of the day plan), «Время нахождения» rows
// (the service times started that day: their sum and, when the first start is Linko's, their span).
/** The seconds a shown duration covers: [low, high), null when nothing is shown. */
function shownSeconds(value) {
  if (value === 0 || value === null || value === undefined) return null
  const text = String(value).trim()
  const seconds = /^(\d+) сек\.$/.exec(text)
  if (seconds) return Number(seconds[1]) === 0 ? [1e-6, 1] : [Number(seconds[1]), Number(seconds[1]) + 1]
  const clock = /^(?:(\d+) ч\.)?\s*(?:(\d+) мин\.)?$/.exec(text)
  if (!clock || (!clock[1] && !clock[2])) return null
  const low = Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60
  return [low, low + 60]
}

/** Stays fitted to the report figures: Map task id → seconds (to the microsecond). */
function fitStays(tasks, reports) {
  const bounds = new Map(tasks.map((task) => [task.id, [...task.bounds]]))
  const byPlanDay = new Map()
  const byStartDay = new Map()
  for (const task of tasks) {
    const plan = `${task.employeeId}|${task.planDay}`
    byPlanDay.set(plan, [...(byPlanDay.get(plan) ?? []), task])
    if (task.startMs !== null) {
      const start = `${task.employeeId}|${task.startDay}`
      byStartDay.set(start, [...(byStartDay.get(start) ?? []), task])
    }
  }
  const middle = (id) => (bounds.get(id)[0] + bounds.get(id)[1]) / 2
  // Constraints: the sum of `ids` (plus `shift`) lies in [low, high) — a shown figure counts within a day.
  const sums = []
  const spans = []
  const addSum = (ids, shown, shift = 0, sign = 1) => {
    if (!ids.length || !shown) return
    // The shown figure leaves out whole days (and a negative rest shows as 23 ч. 59 мин.): the nearest such figure.
    const estimate = sign * ids.reduce((total, id) => total + middle(id), 0) + shift
    const days = Math.round((estimate - (shown[0] + shown[1]) / 2) / 86400)
    const [low, high] = [shown[0] + days * 86400, shown[1] + days * 86400]
    // sign 1: Σ + shift ∈ [low, high); sign -1 (the rest = total − Σ): Σ ∈ (shift − high, shift − low].
    sums.push(sign === 1 ? { ids, low: low - shift, high: high - shift } : { ids, low: shift - high, high: shift - low })
  }
  for (const [key, rows] of Object.entries(reports)) {
    if (!Array.isArray(rows)) continue
    const dataType = key.split("|")[1]
    for (const agent of rows) {
      for (const child of agent.child_data ?? []) {
        const [d, m, y] = String(child.name).split(".")
        const day = `${agent.id}|${y}-${m}-${d}`
        if (dataType === "today_plan") {
          const ids = (byPlanDay.get(day) ?? []).map((task) => task.id)
          if (!ids.length) continue
          addSum(ids, shownSeconds(child.inside_market))
          const total = planTotals.get(day)
          if (total !== undefined) addSum(ids, shownSeconds(child.outside_market), total, -1)
        } else {
          const list = byStartDay.get(day) ?? []
          if (!list.length) continue
          addSum(list.map((task) => task.id), shownSeconds(child.inside_market))
          const first = Math.min(...list.map((task) => task.startMs))
          const firstClock = new Date(first).toISOString().slice(11, 16)
          const span = shownSeconds(child.total_time)
          if (span && firstClock === child.start_time) spans.push({ list, first, low: span[0], high: span[1] })
          // The rest = span − stays: when the last one to start surely ends last, the span is its start + its stay, so the
          // rest is (its start − the first start) − the other stays.
          const last = list.reduce((best, task) => (task.startMs > best.startMs ? task : best), list[0])
          const others = list.filter((task) => task !== last)
          const endsLast = others.every((task) => task.startMs + task.bounds[1] * 1000 <= last.startMs + last.bounds[0] * 1000)
          if (others.length && endsLast && firstClock === child.start_time) {
            addSum(others.map((task) => task.id), shownSeconds(child.outside_market), (last.startMs - first) / 1000, -1)
          }
        }
      }
    }
  }
  // One range per set of stays (a day's sum shown twice, as the stays and as the rest, is one range).
  const merged = new Map()
  for (const sum of sums) {
    const key = [...sum.ids].sort((a, b) => a - b).join(",")
    const known = merged.get(key)
    merged.set(key, known ? { ids: sum.ids, low: Math.max(known.low, sum.low), high: Math.min(known.high, sum.high) } : sum)
  }
  sums.splice(0, sums.length, ...[...merged.values()].filter((sum) => sum.low < sum.high))
  // Bounds propagation: every stay within what each constraint leaves it.
  for (let round = 0; round < 40; round++) {
    let changed = false
    const narrow = (id, low, high) => {
      const [a, b] = bounds.get(id)
      const next = [Math.max(a, low), Math.min(b, high)]
      if (next[0] < next[1] - 1e-9 && (next[0] > a + 1e-9 || next[1] < b - 1e-9)) {
        bounds.set(id, next)
        changed = true
      }
    }
    for (const { ids, low, high } of sums) {
      const lows = ids.reduce((total, id) => total + bounds.get(id)[0], 0)
      const highs = ids.reduce((total, id) => total + bounds.get(id)[1], 0)
      for (const id of ids) narrow(id, low - (highs - bounds.get(id)[1]), high - (lows - bounds.get(id)[0]))
    }
    for (const { list, first, low, high } of spans) {
      for (const task of list) narrow(task.id, -Infinity, high - (task.startMs - first) / 1000)
      const reach = list.filter((task) => (task.startMs - first) / 1000 + bounds.get(task.id)[1] > low)
      if (reach.length === 1) narrow(reach[0].id, low - (reach[0].startMs - first) / 1000, Infinity)
    }
    if (!changed) break
  }
  // Each stay in the middle of what is left, then every sum moved well inside its range (a margin, so the microsecond
  // rounding below keeps it there): to the middle of what the range and the stays' bounds allow.
  const value = new Map(tasks.map((task) => [task.id, middle(task.id)]))
  for (let round = 0; round < 20; round++) {
    let moved = false
    for (const { ids, low, high } of sums) {
      const margin = Math.min(0.001, (high - low) / 4)
      const total = ids.reduce((sum, id) => sum + value.get(id), 0)
      if (total >= low + margin && total < high - margin) continue
      const lows = ids.reduce((sum, id) => sum + bounds.get(id)[0], 0)
      const highs = ids.reduce((sum, id) => sum + bounds.get(id)[1], 0)
      let rest = (Math.max(low, lows) + Math.min(high, highs)) / 2 - total
      for (const id of ids) {
        const [a, b] = bounds.get(id)
        const step = rest > 0 ? Math.max(0, Math.min(rest, b - 1e-6 - value.get(id))) : Math.min(0, Math.max(rest, a - value.get(id)))
        value.set(id, value.get(id) + step)
        rest -= step
      }
      moved = true
    }
    if (!moved) break
  }
  return new Map([...value].map(([id, seconds]) => [id, Math.round(seconds * 1e6) / 1e6]))
}

// Every task of every plan; the plan day's exact span (its first to its last task done) and its service times.
const entries = []
const planTotals = new Map()
const serviceTasks = []
for (const [key, markets] of Object.entries(plans)) {
  if (!Array.isArray(markets)) continue
  const [agent, day] = key.split("|")
  const employeeId = Number(agent)
  const done = []
  for (const market of markets) {
    const clientId = market?.market?.id == null ? null : Number(market.market.id)
    for (const task of market?.plans ?? []) {
      entries.push({ task, employeeId, day, clientId })
      if (task.status === "done" && task.done_time) done.push(ms(task.done_time))
      if (task.type === "service_time" && task.status === "done") {
        const bounds = stayBounds(task, employeeId, clientId)
        const start = task.created_mobile_time ? ms(task.created_mobile_time) : NaN
        if (bounds) {
          serviceTasks.push({
            id: Number(task.id),
            employeeId,
            planDay: day,
            startMs: Number.isFinite(start) ? start : null,
            startDay: task.created_mobile_time ? String(task.created_mobile_time).slice(0, 10) : null,
            bounds,
          })
        }
      }
    }
  }
  if (done.length) planTotals.set(key, (Math.max(...done) - Math.min(...done)) / 1000)
}
const stays = fitStays(serviceTasks, file.data?.reports ?? {})

// Unfinished services: a «Время нахождения» row that starts before any service time of its day (or a day without one)
// is a service the agent began and never ended — Linko keeps its start (no task, no timed visit; 2 in the whole account).
// Its seconds are those the row's span and the agent row's mean start allow.
const clockOf = (msValue) => new Date(msValue).toISOString().slice(11, 16)
const openServices = []
for (const [key, rows] of Object.entries(file.data?.reports ?? {})) {
  if (!key.endsWith("|service_time") || !Array.isArray(rows)) continue
  for (const agent of rows) {
    const children = (agent.child_data ?? []).map((child) => {
      const [d, m, y] = String(child.name).split(".")
      const day = `${y}-${m}-${d}`
      const list = serviceTasks.filter((task) => task.employeeId === Number(agent.id) && task.startDay === day && task.startMs !== null)
      const first = list.length ? Math.min(...list.map((task) => task.startMs)) : null
      const lastEnd = list.length ? Math.max(...list.map((task) => task.startMs + (stays.get(task.id) ?? 0) * 1000)) : null
      return { child, day, first, lastEnd }
    })
    for (const entry of children) {
      const { child, day, first, lastEnd } = entry
      if (!child.start_time || (first !== null && clockOf(first) <= child.start_time)) continue
      let low = ms(`${day}T${child.start_time}:00`)
      let high = low + 60_000
      const span = lastEnd === null ? null : shownSeconds(child.total_time)
      if (span) {
        low = Math.max(low, lastEnd - span[1] * 1000 + 1)
        high = Math.min(high, lastEnd - span[0] * 1000 + 1)
      }
      // The agent row's start is the mean of its days' starts in whole seconds, cut to the minute.
      const mean = /^(\d{2}):(\d{2})$/.exec(String(agent.start_time ?? ""))
      const others = children.filter((other) => other !== entry && other.child.start_time)
      if (mean && others.every((other) => other.first !== null)) {
        const n = others.length + 1
        const minute = (Number(mean[1]) * 3600 + Number(mean[2]) * 60) * n
        const known = others.reduce((sum, other) => sum + Math.floor((other.first % DAY_MS) / 1000), 0)
        const dayStart = ms(`${day}T00:00:00`)
        low = Math.max(low, dayStart + (minute - known) * 1000)
        high = Math.min(high, dayStart + (minute + 60 * n - known) * 1000)
      }
      const at = low < high ? Math.floor((low + high) / 2 / 1000) * 1000 : ms(`${day}T${child.start_time}:00`)
      openServices.push([Number(agent.id), new Date(Math.max(at, low)).toISOString().slice(0, 19).replace("T", " ")])
    }
  }
}

const rows = entries.map(({ task, employeeId, day, clientId }) => [
  Number(task.id),
  employeeId,
  day,
  clientId,
  String(task.type ?? ""),
  String(task.status ?? ""),
  Boolean(task.unscheduled),
  task.done_time || null,
  task.created_mobile_time || null,
  stays.get(Number(task.id)) ?? null,
  task.order_id ?? null,
  task.client_transaction_id ?? null,
  task.order_return_id ?? null,
  task.rejection_id ?? null,
  task.merch_report_id ?? null,
  task.service_time_id ?? null,
])

const tashkent = (iso) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 19).replace("T", " ")
const client = await connect()
await ensureRegistry(client)
const stats = { tasks: rows.length, agentDays: Object.keys(plans).length, removed: 0, missingEmployees: new Set(), until: "" }
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:linko_day_tasks'))")
  await client.query(`CREATE TABLE IF NOT EXISTS linko_day_tasks (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    plan_day DATE NOT NULL,
    client_id INTEGER,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    unscheduled BOOLEAN NOT NULL DEFAULT false,
    done_at TIMESTAMP,
    started_at TIMESTAMP,
    stay_sec DOUBLE PRECISION,
    order_id INTEGER,
    payment_id INTEGER,
    return_id INTEGER,
    refusal_id INTEGER,
    report_id INTEGER,
    service_time_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS linko_day_tasks_day ON linko_day_tasks (plan_day, employee_id)`)
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  for (const row of rows) if (!employees.has(row[1])) stats.missingEmployees.add(row[1])
  stats.removed = (await client.query("DELETE FROM linko_day_tasks")).rowCount
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const values = chunk.map((row, r) => `(${row.map((_, c) => `$${r * row.length + c + 1}`).join(", ")})`).join(", ")
    await client.query(
      `INSERT INTO linko_day_tasks (id, employee_id, plan_day, client_id, type, status, unscheduled, done_at, started_at, stay_sec,
         order_id, payment_id, return_id, refusal_id, report_id, service_time_id)
       VALUES ${values}
       ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, plan_day = EXCLUDED.plan_day, client_id = EXCLUDED.client_id,
         type = EXCLUDED.type, status = EXCLUDED.status, unscheduled = EXCLUDED.unscheduled, done_at = EXCLUDED.done_at,
         started_at = EXCLUDED.started_at, stay_sec = EXCLUDED.stay_sec, order_id = EXCLUDED.order_id, payment_id = EXCLUDED.payment_id,
         return_id = EXCLUDED.return_id, refusal_id = EXCLUDED.refusal_id, report_id = EXCLUDED.report_id, service_time_id = EXCLUDED.service_time_id`,
      chunk.flat(),
    )
  }
  await register(client, run, "linko_day_tasks", "*", "replace", { removed: stats.removed, inserted: rows.length })
  await client.query(`CREATE TABLE IF NOT EXISTS linko_open_services (
    employee_id INTEGER NOT NULL,
    started_at TIMESTAMP NOT NULL,
    PRIMARY KEY (employee_id, started_at)
  )`)
  const removedOpen = (await client.query("DELETE FROM linko_open_services")).rowCount
  for (const [employeeId, startedAt] of openServices) {
    await client.query("INSERT INTO linko_open_services (employee_id, started_at) VALUES ($1, $2) ON CONFLICT DO NOTHING", [employeeId, startedAt])
  }
  await register(client, run, "linko_open_services", "*", "replace", { removed: removedOpen, inserted: openServices.length })

  // Where the copied history ends.
  await client.query("CREATE TABLE IF NOT EXISTS linko_history (ledger TEXT PRIMARY KEY, until TEXT NOT NULL)")
  const copied = (await client.query("SELECT MAX(until) AS until FROM linko_history WHERE ledger <> 'day_tasks'")).rows[0]?.until
  stats.until = process.env.UNTIL || copied || tashkent(file.fetched)
  const previous = (await client.query("SELECT until FROM linko_history WHERE ledger = 'day_tasks'")).rows[0]?.until ?? null
  await client.query(
    "INSERT INTO linko_history (ledger, until) VALUES ('day_tasks', $1) ON CONFLICT (ledger) DO UPDATE SET until = EXCLUDED.until",
    [stats.until],
  )
  await register(client, run, "linko_history", "day_tasks", previous === null ? "insert" : "update", previous === null ? null : { until: previous })
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `day tasks: ${stats.tasks} tasks of ${stats.agentDays} agent-days (replaced ${stats.removed}), ${openServices.length} unfinished services, history until ${stats.until}`,
  stats.missingEmployees.size ? `; employees missing here: ${[...stats.missingEmployees].join(",")}` : "",
)
