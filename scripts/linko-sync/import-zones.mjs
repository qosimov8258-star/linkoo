// Территория: the territories of the Linko account (market/border: name, branch, parent, outline) into client_zones,
// the directory the Клиенты "Зона", Территория and Охват территорий pages read. Clients name their zone (clients.zone =
// Linko's border title, already imported with the clients). Linko outlines are [lat, lon] rings → [[lat, lng], …]
// without the closing point. Linko allows two territories with one name; the directory does not (unique names), so a
// repeated name gets " (2)" … — its clients keep the name they carry. Reference ids are kept.
//
//   node scripts/linko-sync/import-zones.mjs        (raw file: borders)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("zones")
const borders = [...raw("borders")].sort((a, b) => a.id - b.id)

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, renamed: [] }
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(72120936)")
  await client.query("SELECT pg_advisory_xact_lock(72120938)")
  const used = new Map()
  const ring = (coordinates) => {
    const points = (coordinates?.coordinates?.[0] ?? []).map((p) => [Number(p[0]), Number(p[1])]).filter((p) => p.every(Number.isFinite))
    if (points.length > 3 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop()
    return points.length >= 3 ? JSON.stringify(points) : ""
  }
  const names = new Map()
  for (const border of borders) {
    const base = String(border.title ?? "").trim() || `#${border.id}`
    const key = base.toLowerCase()
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    const name = n === 1 ? base : `${base} (${n})`
    if (n > 1) stats.renamed.push(`${border.id}:${name}`)
    names.set(border.id, name)
  }
  // Zones made locally under a Linko name (another id) give way to the Linko row.
  for (const border of borders) {
    await client.query("DELETE FROM client_zones WHERE lower(btrim(name)) = lower(btrim($1)) AND id <> $2", [names.get(border.id), border.id])
  }
  for (const border of borders) {
    const values = { name: names.get(border.id), branch: String(border.branch?.name ?? ""), polygon: ring(border.coordinates) }
    const current = (await client.query("SELECT name, branch, polygon FROM client_zones WHERE id = $1", [border.id])).rows[0]
    if (!current) {
      await client.query("INSERT INTO client_zones (id, name, branch, polygon, created_by) VALUES ($1, $2, $3, $4, 'Linko')", [border.id, values.name, values.branch, values.polygon])
      await register(client, run, "client_zones", border.id, "insert")
      stats.insert++
    } else if (current.name !== values.name || current.branch !== values.branch || current.polygon !== values.polygon) {
      await client.query("UPDATE client_zones SET name = $2, branch = $3, polygon = $4, updated_at = datetime('now') WHERE id = $1", [border.id, values.name, values.branch, values.polygon])
      await register(client, run, "client_zones", border.id, "update", current)
      stats.update++
    } else stats.same++
  }
  for (const border of borders) {
    const parent = border.parent?.id && borders.some((b) => b.id === border.parent.id) ? border.parent.id : null
    await client.query("UPDATE client_zones SET parent_id = $2 WHERE id = $1 AND parent_id IS DISTINCT FROM $2", [border.id, parent])
  }
  await client.query("SELECT setval(pg_get_serial_sequence('client_zones', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM client_zones), 1))")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`zones: ${borders.length} in Linko →`, JSON.stringify(stats))
