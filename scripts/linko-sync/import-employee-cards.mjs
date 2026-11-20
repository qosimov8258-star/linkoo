// Сотрудники: the fields of each employee's Linko card (main/crud/{id}/, raw employees_detail, fetch.mjs step
// employee-details) that the list answers leave out and earlier imports did not carry:
//
// 1. «Права доступа» (position): Linko keeps it on every user, a blocked one too, and lists it → employees.access_right_id
//    (only an access right that exists locally).
// 2. «Заблокирован» (is_blocked, set by «Ограничить доступ сотрудника»): the list prints it under «Активный» and the user
//    cannot sign in → employees.system_access = 0 (1 when not blocked). The form's «Доступ к системе» is is_active
//    (employees.active), which the list import already carries.
// 3. «Указать исходную точку» (on when the card has location_points) and its «Точки локации» → employees.start_point and
//    details.locationPointIds (only points that exist locally in start_locations).
//
// Changes only what differs; every changed row is registered in linko_sync_rows with its previous values.
//
//   node scripts/linko-sync/import-employee-cards.mjs
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("employee-cards")
if (!hasRaw("employees_detail")) {
  console.log("employees_detail missing: run fetch.mjs employee-details first; nothing changed")
  process.exit(0)
}
const cards = raw("employees_detail")
const client = await connect()
await ensureRegistry(client)
const counts = { rights: 0, blocked: 0, startPoints: 0, cards: 0 }
const skipped = []
try {
  await client.query("BEGIN")
  const rights = new Set((await client.query("SELECT id FROM access_rights")).rows.map((row) => Number(row.id)))
  const points = new Set(
    (await client.query("SELECT to_regclass('start_locations') IS NOT NULL AS ok")).rows[0].ok
      ? (await client.query("SELECT id FROM start_locations")).rows.map((row) => Number(row.id))
      : [],
  )
  const rows = (await client.query("SELECT id, access_right_id, system_access, start_point, details FROM employees")).rows
  const local = new Map(rows.map((row) => [Number(row.id), row]))
  for (const [id, card] of Object.entries(cards)) {
    if (!card || typeof card !== "object") continue
    const row = local.get(Number(id))
    if (!row) continue
    counts.cards++
    const change = {}
    const previous = {}

    const right = card.position && Number(card.position.id)
    if (right && (row.access_right_id === null || Number(row.access_right_id) !== right)) {
      if (rights.has(right)) {
        change.access_right_id = right
        previous.access_right_id = row.access_right_id
        counts.rights++
      } else skipped.push(`${id}: access right ${right} missing locally`)
    }

    if (typeof card.is_blocked === "boolean") {
      const access = card.is_blocked ? 0 : 1
      if (Number(row.system_access) !== access) {
        change.system_access = access
        previous.system_access = row.system_access
        counts.blocked++
      }
    }

    if (Array.isArray(card.location_points)) {
      const ids = card.location_points.map((point) => Number(point && point.id)).filter((pointId) => points.has(pointId))
      const startPoint = card.location_points.length > 0 ? 1 : 0
      let details = {}
      try {
        details = JSON.parse(row.details || "{}") || {}
      } catch {
        details = {}
      }
      const stored = Array.isArray(details.locationPointIds) ? details.locationPointIds.map(Number) : []
      if (Number(row.start_point) !== startPoint || stored.join(",") !== ids.join(",")) {
        change.start_point = startPoint
        change.details = JSON.stringify({ ...details, locationPointIds: ids })
        previous.start_point = row.start_point
        previous.details = row.details
        counts.startPoints++
      }
    }

    const columns = Object.keys(change)
    if (!columns.length) continue
    const sets = columns.map((column, index) => `${column} = $${index + 2}`).join(", ")
    await client.query(`UPDATE employees SET ${sets}, updated_at = datetime('now') WHERE id = $1`, [Number(id), ...columns.map((column) => change[column])])
    await register(client, run, "employees", id, "update", previous)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `employee cards: ${counts.cards} cards; ${counts.rights} «Права доступа», ${counts.blocked} «Заблокирован», ${counts.startPoints} «Указать исходную точку» changed` +
    (skipped.length ? `; skipped ${skipped.join("; ")}` : ""),
)
