// Территория → «Управлять территориями»: the employees Linko binds to each territory (market/border/{id}/ properties
// .agents, fetch step border-agents) as rows of client_zone_agents, the table «Привязать агента / Отвязать агента»
// write (lib/client-zone-agents-repo.ts). Zone ids are Linko's border ids (import-zones.mjs), employee ids Linko's
// staff ids. Only inserts: a binding made here is kept; a zone or an employee that is not here is reported.
//
//   node scripts/linko-sync/import-zone-agents.mjs
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("zone-agents")
if (!hasRaw("border_agents")) {
  console.log("zone agents: no raw border_agents (run fetch.mjs border-agents first)")
  process.exit(0)
}
const data = raw("border_agents")
const stats = { rows: 0, kept: 0, zones: new Set(), missingZones: new Set(), missingEmployees: new Set() }

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:client_zone_agents'))")
  await client.query(`CREATE TABLE IF NOT EXISTS client_zone_agents (
    zone_id INTEGER NOT NULL REFERENCES client_zones(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (zone_id, employee_id)
  )`)
  const zones = new Set((await client.query("SELECT id FROM client_zones")).rows.map((row) => Number(row.id)))
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  for (const [id, agents] of Object.entries(data)) {
    if (!Array.isArray(agents)) continue
    const zoneId = Number(id)
    if (!zones.has(zoneId)) {
      stats.missingZones.add(zoneId)
      continue
    }
    for (const agent of agents) {
      const employeeId = Number(agent?.id)
      if (!employees.has(employeeId)) {
        stats.missingEmployees.add(employeeId)
        continue
      }
      const inserted = await client.query(
        "INSERT INTO client_zone_agents (zone_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING zone_id",
        [zoneId, employeeId],
      )
      if (!inserted.rowCount) {
        stats.kept++
        continue
      }
      await register(client, run, "client_zone_agents", `${zoneId}:${employeeId}`, "insert")
      stats.rows++
      stats.zones.add(zoneId)
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `zone agents: ${stats.rows} bindings for ${stats.zones.size} zones; ${stats.kept} were here; zones not here: ${[...stats.missingZones].join(",") || "none"}; employees not here: ${[...stats.missingEmployees].join(",") || "none"}`,
)
