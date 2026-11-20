// Права доступа → «Создать возможности»: Linko's «Тип» filter lists the permission TAGS (billing permission_tag/:
// Мобильный, Десктоп, Общее, CONFIGURATION) and keeps a permission whose tags include the chosen one. The local
// permission catalogue was copied without them, so the filter had nothing to work on. This step stores the tag list
// (permission_tags, in Linko's order) and every permission's tags (permissions.tags, JSON names) by Linko's id, the
// code checked too.
//
// Source: read-only captures of Linko's billing API (the screen's own GETs) in backups/linko-raw/2026-11-20/permission-tags:
//   permissions.json = client/permission/?tag=general, tags.json = client/permission_tag/?search=&page_size=50.
//
//   node scripts/linko-sync/import-permission-tags.mjs [--dry-run]      (TAGS_DIR=<folder> reads other captures)
import fs from "node:fs"
import path from "node:path"

import { ROOT, connect, ensureRegistry, register, runId } from "./lib.mjs"

const dir = process.env.TAGS_DIR ?? path.join(ROOT, "backups", "linko-raw", "2026-11-20", "permission-tags")
const read = (name) => {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) throw new Error(`Capture missing: ${file}`)
  const body = JSON.parse(fs.readFileSync(file, "utf8"))
  return Array.isArray(body) ? body : body.results ?? body.data ?? []
}
const tags = read("tags.json")
const permissions = read("permissions.json")
const dryRun = process.argv.includes("--dry-run")

const run = runId("permission-tags")
const stats = { tagsAdded: 0, tagsChanged: 0, permissionsChanged: 0, same: 0, missing: [], codeMismatch: [] }
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The same DDL as lib/permissions-repo.ts (the app creates them on its first permission read).
  await client.query("CREATE TABLE IF NOT EXISTS permission_tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)")
  await client.query("ALTER TABLE permissions ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '[]'")

  const localTags = new Map((await client.query("SELECT id, name, sort_order FROM permission_tags")).rows.map((row) => [Number(row.id), row]))
  for (const [index, tag] of tags.entries()) {
    const id = Number(tag.id)
    const name = String(tag.name ?? "").trim()
    if (!Number.isInteger(id) || !name) continue
    const local = localTags.get(id)
    if (local && local.name === name && Number(local.sort_order) === index) continue
    await client.query(
      "INSERT INTO permission_tags (id, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order",
      [id, name, index],
    )
    await register(client, run, "permission_tags", id, local ? "update" : "insert", local ? { name: local.name, sort_order: local.sort_order } : null)
    if (local) stats.tagsChanged++
    else stats.tagsAdded++
  }

  const local = new Map((await client.query("SELECT id, code, tags FROM permissions")).rows.map((row) => [Number(row.id), row]))
  for (const permission of permissions) {
    const id = Number(permission.id)
    const row = local.get(id)
    if (!row) {
      stats.missing.push(id)
      continue
    }
    if (permission.codename && row.code !== permission.codename) {
      stats.codeMismatch.push(id)
      continue
    }
    const names = JSON.stringify((permission.tags ?? []).map((tag) => String(tag?.name ?? "").trim()).filter(Boolean))
    if (row.tags === names) {
      stats.same++
      continue
    }
    await client.query("UPDATE permissions SET tags = $1 WHERE id = $2", [names, id])
    await register(client, run, "permissions", id, "update", { tags: row.tags })
    stats.permissionsChanged++
  }
  await client.query(dryRun ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `permission tags${dryRun ? " (dry run, rolled back)" : ""}: tags +${stats.tagsAdded} changed ${stats.tagsChanged}; permissions changed ${stats.permissionsChanged}, unchanged ${stats.same}; ` +
    `missing here: ${stats.missing.join(",") || "none"}; code differs: ${stats.codeMismatch.join(",") || "none"}`,
)
