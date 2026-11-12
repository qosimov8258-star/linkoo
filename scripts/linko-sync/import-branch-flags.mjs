// Филиалы: Linko's «Основной филиал» (is_main) of every branch — a flag of its own there (66 branches have it).
//
//   node scripts/linko-sync/import-branch-flags.mjs
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("branch-flags")
let changed = 0
const missing = []
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The older one-main-branch index (lib/branches-repo.ts drops it too).
  await client.query("DROP INDEX IF EXISTS branches_one_main")
  const local = new Map((await client.query("SELECT id, is_main FROM branches")).rows.map((row) => [Number(row.id), Number(row.is_main)]))
  for (const branch of raw("branches")) {
    const id = Number(branch.id)
    if (!local.has(id)) {
      missing.push(id)
      continue
    }
    const value = branch.is_main ? 1 : 0
    if (local.get(id) === value) continue
    await client.query("UPDATE branches SET is_main = $1 WHERE id = $2", [value, id])
    await register(client, run, "branches", id, "update", { is_main: local.get(id) })
    changed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`branch flags: ${changed} «Основной филиал» changed; branches missing here: ${missing.join(",") || "none"}`)
