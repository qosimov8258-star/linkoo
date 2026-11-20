// «База знания»: Linko publishes an article to ACCESS RIGHTS (its knowledge form's «Права доступа» lists
// main/position/, the ids of the local access_rights rows), while the first local copy linked the articles to job
// positions (Должности) matched by name. This step makes every Linko article equal to Linko: name, text, «Активный»
// and exactly Linko's access-right links (knowledge_base_article_access_rights, the table lib/knowledge-base-schema.ts
// creates). A missing article is inserted under Linko's id. Linko's attached files (time3 media URLs) are not copied:
// they would have to be downloaded from Linko's file server; the local article keeps the file it has.
//
// Source: main/knowledge/ — backups/linko-raw/2026-11-20/knowledge-base/knowledge.json (a read-only capture of the
// #/knowledge-base screen's own GET), else the `knowledge` file of the newest full download.
//
//   node scripts/linko-sync/import-knowledge-base.mjs [--dry-run]      (KB_FILE=<file> reads another capture)
import fs from "node:fs"
import path from "node:path"

import { ROOT, bumpSequence, connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const dryRun = process.argv.includes("--dry-run")
const captured = process.env.KB_FILE ?? path.join(ROOT, "backups", "linko-raw", "2026-11-20", "knowledge-base", "knowledge.json")

function articles() {
  if (fs.existsSync(captured)) {
    const body = JSON.parse(fs.readFileSync(captured, "utf8"))
    return Array.isArray(body) ? body : body.data ?? body.results ?? []
  }
  if (hasRaw("knowledge")) return raw("knowledge")
  throw new Error(`No knowledge base data: ${captured} or the knowledge file of a full download`)
}

const list = articles()
const run = runId("knowledge-base")
const stats = { inserted: 0, updated: 0, same: 0, linksAdded: 0, linksRemoved: 0, missingRights: [], filesNotCopied: 0 }
const client = await connect()
await ensureRegistry(client)

try {
  await client.query("BEGIN")
  // The same DDL as the app's bootstrap (lib/knowledge-base-schema.ts), for a database the app has not opened yet.
  await client.query(`CREATE TABLE IF NOT EXISTS knowledge_base_article_access_rights (
    article_id INTEGER NOT NULL REFERENCES knowledge_base_articles (id) ON DELETE CASCADE,
    access_right_id INTEGER NOT NULL REFERENCES access_rights (id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, access_right_id)
  )`)
  await client.query("CREATE INDEX IF NOT EXISTS knowledge_base_article_access_rights_right ON knowledge_base_article_access_rights (access_right_id)")
  await client.query("ALTER TABLE knowledge_base_articles ADD COLUMN IF NOT EXISTS access_rights_migrated INTEGER NOT NULL DEFAULT 0")

  const rights = new Set((await client.query("SELECT id FROM access_rights")).rows.map((row) => Number(row.id)))

  for (const item of list) {
    const id = Number(item.id)
    const name = String(item.name ?? "").trim()
    const text = String(item.text ?? "")
    const active = item.is_active ? 1 : 0
    if (item.file) stats.filesNotCopied += 1
    const current = (await client.query("SELECT id, name, text, active, access_rights_migrated FROM knowledge_base_articles WHERE id = $1", [id])).rows[0]
    if (!current) {
      await client.query(
        `INSERT INTO knowledge_base_articles (id, name, text, active, roles, roles_migrated, access_rights_migrated)
         VALUES ($1, $2, $3, $4, '[]', 1, 1)`,
        [id, name, text, active],
      )
      await register(client, run, "knowledge_base_articles", id, "insert")
      stats.inserted += 1
    } else if (current.name !== name || current.text !== text || Number(current.active) !== active) {
      await client.query(
        "UPDATE knowledge_base_articles SET name = $2, text = $3, active = $4, access_rights_migrated = 1, updated_at = datetime('now') WHERE id = $1",
        [id, name, text, active],
      )
      await register(client, run, "knowledge_base_articles", id, "update", { name: current.name, text: current.text, active: current.active })
      stats.updated += 1
    } else {
      // Linko's links below replace whatever the name matching of the bootstrap found.
      if (Number(current.access_rights_migrated) !== 1) await client.query("UPDATE knowledge_base_articles SET access_rights_migrated = 1 WHERE id = $1", [id])
      stats.same += 1
    }

    const wanted = new Set()
    for (const position of item.positions ?? []) {
      const rightId = Number(position.id)
      if (rights.has(rightId)) wanted.add(rightId)
      else stats.missingRights.push(`${id}:${rightId} ${position.name}`)
    }
    const have = new Set(
      (await client.query("SELECT access_right_id FROM knowledge_base_article_access_rights WHERE article_id = $1", [id])).rows.map((row) => Number(row.access_right_id)),
    )
    for (const rightId of wanted) {
      if (have.has(rightId)) continue
      await client.query("INSERT INTO knowledge_base_article_access_rights (article_id, access_right_id) VALUES ($1, $2) RETURNING article_id", [id, rightId])
      await register(client, run, "knowledge_base_article_access_rights", `${id}:${rightId}`, "insert")
      stats.linksAdded += 1
    }
    for (const rightId of have) {
      if (wanted.has(rightId)) continue
      await client.query("DELETE FROM knowledge_base_article_access_rights WHERE article_id = $1 AND access_right_id = $2", [id, rightId])
      await register(client, run, "knowledge_base_article_access_rights", `${id}:${rightId}`, "delete", { article_id: id, access_right_id: rightId })
      stats.linksRemoved += 1
    }
  }
  if (stats.inserted) await bumpSequence(client, "knowledge_base_articles")

  if (dryRun) {
    await client.query("ROLLBACK")
    console.log("(dry run, nothing written)")
  } else {
    await client.query("COMMIT")
  }
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}

console.log(`knowledge base: ${list.length} Linko articles`, stats)
