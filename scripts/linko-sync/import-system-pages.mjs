// «Страницы телеграм бота»: Linko's system pages (main/system-pages/<id>/) into ref_records kind 'tg-page' (id = the
// page's key_name). Only the page's detail carries its texts per language — title, description, article link
// (telegraph_link) and body — so the list alone left the pages without their content. Each page keeps the shape
// lib/telegram-bot-pages-repo.ts reads: the Russian title / description / link, the bodies per language (`content`),
// every language in `translations`, and the created / modified moments the way the reference prints them.
//
//   node scripts/linko-sync/import-system-pages.mjs            (raw files: system_pages, system_pages_detail)
//   node scripts/linko-sync/import-system-pages.mjs --dry-run  (prints what would change, writes nothing)
import { connect, ensureRegistry, raw, register, ruShortDateTime, runId } from "./lib.mjs"

const DRY_RUN = process.argv.includes("--dry-run")
const LANGS = ["ru", "uz", "en"]
const text = (value) => (value == null ? "" : String(value))

const list = raw("system_pages")
const details = raw("system_pages_detail")
const run = runId("system-pages")

function pageData(row, detail) {
  const translations = {}
  for (const lang of LANGS) {
    const own = detail?.translations?.[lang] ?? {}
    translations[lang] = {
      title: text(own.title ?? row.title),
      description: text(own.description ?? row.description),
      telegraphLink: text(own.telegraph_link ?? row.telegraph_link),
      body: text(own.body ?? (lang === "ru" ? detail?.body : "")),
    }
  }
  return {
    id: row.key_name,
    key: row.key_name,
    // Linko's own id: its links open a page by it (#/system-pages/2), and so do the app's.
    linkoId: row.id,
    title: translations.ru.title,
    description: translations.ru.description,
    telegraphLink: translations.ru.telegraphLink,
    createdAt: ruShortDateTime(row.created_date),
    updatedAt: ruShortDateTime(row.modified_date),
    content: { ru: translations.ru.body, uz: translations.uz.body, en: translations.en.body },
    translations,
  }
}

const client = await connect()
const stats = { inserted: 0, updated: 0, same: 0, noDetail: 0 }
try {
  if (!DRY_RUN) {
    await client.query("BEGIN")
    await ensureRegistry(client)
  }
  for (const row of list) {
    const detail = details[row.id]
    if (!detail || detail.__status) stats.noDetail++
    const data = pageData(row, detail && !detail.__status ? detail : null)
    const key = data.key
    const current = (await client.query("SELECT data, deleted FROM ref_records WHERE kind = 'tg-page' AND id = $1", [key])).rows[0]
    const json = JSON.stringify(data)
    if (!current) {
      if (DRY_RUN) console.log("insert", key, json)
      else {
        await client.query("INSERT INTO ref_records (kind, id, data) VALUES ('tg-page', $1, $2)", [key, json])
        await register(client, run, "ref_records", `tg-page:${key}`, "insert")
      }
      stats.inserted++
    } else if (current.data !== json || current.deleted !== 0) {
      if (DRY_RUN) console.log("update", key, "\n  before", current.data, "\n  after ", json)
      else {
        await client.query("UPDATE ref_records SET data = $2, deleted = 0, updated_at = datetime('now') WHERE kind = 'tg-page' AND id = $1", [key, json])
        await register(client, run, "ref_records", `tg-page:${key}`, "update", current)
      }
      stats.updated++
    } else stats.same++
  }
  if (!DRY_RUN) await client.query("COMMIT")
} catch (error) {
  if (!DRY_RUN) await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `system pages: ${list.length} in Linko; ${DRY_RUN ? "would insert" : "inserted"} ${stats.inserted}, ${DRY_RUN ? "would update" : "updated"} ${stats.updated}, unchanged ${stats.same}` +
    (stats.noDetail ? `, ${stats.noDetail} without a detail (texts from the list only)` : ""),
)
