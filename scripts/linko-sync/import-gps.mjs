// Отслеживание: the GPS points of every employee of the Linko account (market/location?user=<id>, raw files
// gps/<employee id>.json) into field_gps_points, which the tracking page and the live locations read.
//
// Linko keeps the device time with minute precision (registered_date) and stores every resend of a fix again
// (342 641 rows, 63 953 distinct fixes): one point per distinct fix (minute + coordinates) is kept. Fixes of one
// minute with different coordinates keep their order (by Linko's receive time) one second apart, so the
// (employee, recorded_at) key stays unique. received_at = Linko's receive time of the first copy.
//
//   node scripts/linko-sync/import-gps.mjs
import fs from "node:fs"
import path from "node:path"

import { connect, ensureRegistry, rawDir, register, runId, utcIso } from "./lib.mjs"

const run = runId("gps")
const dir = path.join(rawDir(), "gps")
const files = fs.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name))

const client = await connect()
await ensureRegistry(client)
const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
let rawTotal = 0
let kept = 0
let inserted = 0
const skipped = []
try {
  for (const file of files) {
    const employeeId = Number(file.replace(".json", ""))
    const points = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).data
    rawTotal += points.length
    if (!employees.has(employeeId)) {
      skipped.push(employeeId)
      continue
    }
    // Distinct fixes in device-time order (receive time breaks ties).
    const byMinute = new Map()
    for (const point of [...points].sort((a, b) => String(a.created).localeCompare(String(b.created)))) {
      const minute = point.registered ?? point.created
      if (!minute || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) continue
      const list = byMinute.get(minute) ?? []
      if (!list.some((fix) => fix.lat === Number(point.lat) && fix.lon === Number(point.lon))) {
        list.push({ lat: Number(point.lat), lon: Number(point.lon), battery: point.battery == null ? null : Number(point.battery), received: point.created })
      }
      byMinute.set(minute, list)
    }
    const rows = []
    for (const [minute, list] of byMinute) {
      const base = new Date(utcIso(minute)).getTime()
      list.slice(0, 60).forEach((fix, index) => rows.push({ ...fix, at: new Date(base + index * 1000).toISOString() }))
    }
    kept += rows.length
    await client.query("BEGIN")
    for (let start = 0; start < rows.length; start += 5000) {
      const chunk = rows.slice(start, start + 5000)
      const result = await client.query(
        `INSERT INTO field_gps_points (user_id, employee_id, recorded_at, lat, lng, accuracy, speed, battery, received_at)
         SELECT 0, $1, x.at, x.lat, x.lng, NULL, NULL, x.battery, x.received
           FROM unnest($2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::timestamptz[]) AS x(at, lat, lng, battery, received)
         ON CONFLICT (employee_id, recorded_at) DO NOTHING`,
        [employeeId, chunk.map((r) => r.at), chunk.map((r) => r.lat), chunk.map((r) => r.lon), chunk.map((r) => r.battery), chunk.map((r) => utcIso(r.received))],
      )
      inserted += result.rowCount
    }
    await register(client, run, "field_gps_points", `employee:${employeeId}`, "insert", { raw: points.length, fixes: rows.length })
    await client.query("COMMIT")
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`gps: ${rawTotal} Linko rows in ${files.length} files → ${kept} distinct fixes, ${inserted} inserted now; employees missing locally: ${skipped.join(",") || "none"}`)
