// Отказы and Фотоотчеты: the refusals (market/rejection) and photo reports (market/merch_report) of the Linko account
// into the field activity tables the pages read now (field_refusals, field_photo_reports; lib/field-activity/**).
// Reference ids are kept. The Linko photos themselves are gone on its server (every media URL answers 404, its own
// page shows "Изображение не найдено"), so no photo rows are created; the photo groups of a report (Polka, DMP, …)
// are kept in field_photo_reports.photo_types for the card.
//
//   node scripts/linko-sync/import-field-records.mjs        (raw files: rejections, merch_reports, rejection_types)
import { connect, ensureRegistry, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("field-records")
const rejections = raw("rejections")
const reports = raw("merch_reports")

const STATUS = { pending: "pending", approved: "accepted", accepted: "accepted", rejected: "rejected", not_accepted: "rejected" }
const coord = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))

const client = await connect()
await ensureRegistry(client)
const stats = { refusals: { insert: 0, update: 0, same: 0, skipped: [], deletedClient: [] }, reports: { insert: 0, update: 0, same: 0, skipped: [], deletedClient: [] } }
try {
  await client.query("BEGIN")
  // Photo groups of a report as the reference shows them (name + whether it had before / after pictures).
  await client.query("ALTER TABLE field_photo_reports ADD COLUMN IF NOT EXISTS photo_types TEXT NOT NULL DEFAULT '[]'")

  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  const clients = new Set((await client.query("SELECT id FROM clients")).rows.map((row) => Number(row.id)))
  const types = new Map((await client.query("SELECT id, name FROM refusal_types")).rows.map((row) => [String(row.name).trim(), Number(row.id)]))

  for (const item of rejections) {
    const employeeId = Number(item.user?.id)
    const clientId = Number(item.market?.id)
    if (!employees.has(employeeId) || !Number.isInteger(clientId) || clientId <= 0) {
      stats.refusals.skipped.push(item.id)
      continue
    }
    // A client deleted in Linko is still named on its refusals there: the id is kept (no local client row).
    if (!clients.has(clientId)) stats.refusals.deletedClient.push(item.id)
    const reason = String(item.comment ?? "").trim()
    const at = utcIso(item.created_date)
    const values = {
      user_id: 0,
      employee_id: employeeId,
      client_id: clientId,
      refusal_type_id: types.get(reason) ?? null,
      reason,
      comment: "",
      lat: coord(item.location?.lat),
      lng: coord(item.location?.lon ?? item.location?.lng),
      happened_at: at,
      created_at: at,
    }
    stats.refusals[await upsert(client, "field_refusals", item.id, values)]++
  }

  for (const item of reports) {
    const employeeId = Number(item.user?.id)
    const clientId = Number(item.market?.id)
    if (!employees.has(employeeId) || !Number.isInteger(clientId) || clientId <= 0) {
      stats.reports.skipped.push(item.id)
      continue
    }
    if (!clients.has(clientId)) stats.reports.deletedClient.push(item.id)
    const at = utcIso(item.created_date)
    const groups = (item.photos ?? []).map((group) => ({
      name: String(group.name ?? group.key ?? ""),
      before: (group.before_uuid ?? []).length,
      after: (group.after_uuid ?? []).length,
    }))
    const values = {
      user_id: 0,
      employee_id: employeeId,
      client_id: clientId,
      comment: String(item.comment ?? "").trim(),
      lat: coord(item.location?.lat),
      lng: coord(item.location?.lon ?? item.location?.lng),
      status: STATUS[item.status] ?? "pending",
      happened_at: at,
      created_at: at,
      photo_types: JSON.stringify(groups),
    }
    stats.reports[await upsert(client, "field_photo_reports", item.id, values)]++
  }

  for (const table of ["field_refusals", "field_photo_reports"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}

/** Insert or update by id (timestamps compared as instants). */
async function upsert(db, table, id, values) {
  const cols = Object.keys(values)
  const current = (await db.query(`SELECT ${cols.join(", ")} FROM ${table} WHERE id = $1`, [id])).rows[0]
  if (!current) {
    await db.query(`INSERT INTO ${table} (id, ${cols.join(", ")}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})`, [id, ...cols.map((c) => values[c])])
    await register(db, run, table, id, "insert")
    return "insert"
  }
  const changed = cols.filter((c) => {
    const a = current[c]
    const b = values[c]
    if (a instanceof Date) return a.getTime() !== new Date(b).getTime()
    if (a === null || b === null) return !(a === null && b === null)
    if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) > 1e-9
    return String(a) !== String(b)
  })
  if (!changed.length) return "same"
  await db.query(`UPDATE ${table} SET ${changed.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [id, ...changed.map((c) => values[c])])
  await register(db, run, table, id, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
  return "update"
}

console.log(`refusals: ${rejections.length} in Linko →`, JSON.stringify(stats.refusals))
console.log(`photo reports: ${reports.length} in Linko →`, JSON.stringify(stats.reports))
