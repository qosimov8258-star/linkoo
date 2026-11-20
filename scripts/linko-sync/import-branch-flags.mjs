// Филиалы: Linko's «Основной филиал» (is_main) of every branch — a flag of its own there (66 branches have it) — and
// its map point (location). Linko keeps "0 0" for a branch saved without a point and nothing (null) for one that never
// had it; the branch form prints the first and leaves the second blank, so both are copied as they are.
//
//   node scripts/linko-sync/import-branch-flags.mjs
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("branch-flags")
let changed = 0
let located = 0
const missing = []
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The older one-main-branch index (lib/branches-repo.ts drops it too).
  await client.query("DROP INDEX IF EXISTS branches_one_main")
  // The same columns lib/branches-repo.ts adds.
  await client.query("ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION")
  await client.query("ALTER TABLE branches ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION")
  const local = new Map((await client.query("SELECT id, is_main, location_lat, location_lng FROM branches")).rows.map((row) => [Number(row.id), row]))
  const coordinate = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
  for (const branch of raw("branches")) {
    const id = Number(branch.id)
    const row = local.get(id)
    if (!row) {
      missing.push(id)
      continue
    }
    const value = branch.is_main ? 1 : 0
    if (Number(row.is_main) !== value) {
      await client.query("UPDATE branches SET is_main = $1 WHERE id = $2", [value, id])
      await register(client, run, "branches", id, "update", { is_main: Number(row.is_main) })
      changed++
    }
    const lat = coordinate(branch.location?.lat)
    const lng = coordinate(branch.location?.lon ?? branch.location?.lng)
    const point = lat === null || lng === null ? [null, null] : [lat, lng]
    if (coordinate(row.location_lat) !== point[0] || coordinate(row.location_lng) !== point[1]) {
      await client.query("UPDATE branches SET location_lat = $1, location_lng = $2 WHERE id = $3", [point[0], point[1], id])
      await register(client, run, "branches", id, "update", { location_lat: row.location_lat, location_lng: row.location_lng })
      located++
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`branch flags: ${changed} «Основной филиал» changed, ${located} map points changed; branches missing here: ${missing.join(",") || "none"}`)
