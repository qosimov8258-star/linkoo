// Linko's «Закрыто» mark of each shop (market.is_closed): the shop drawer shows a red «Закрыто» chip for it on every
// page (components/clients/shop-closed-chip.tsx, lib/shop-closed-repo.ts). Source: the newest raw shop_drawer.json
// (fetch-shop-drawer.mjs, market/market/<id>/ of every shop), else markets.json of the full download.
// linko_shop_closed gets one row per copied shop that exists here; a re-run updates a changed mark.
//
//   node scripts/linko-sync/import-shop-closed.mjs
import fs from "node:fs"
import path from "node:path"

import { ROOT, captured, connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("shop-closed")

/** Map(shop id → is_closed) and the moment it was fetched. */
function readMarks() {
  // <RAW>/shop_drawer.json, else the newest backups/linko-raw/<date> that has it; then the raw folder's markets.json
  // (with RAW both inside RAW only).
  const file = captured("shop_drawer.json")
  if (file && fs.existsSync(file)) {
    const body = JSON.parse(fs.readFileSync(file, "utf8"))
    const marks = new Map()
    for (const [id, entry] of Object.entries(body.data ?? {})) {
      const market = entry?.market
      if (market && typeof market.is_closed === "boolean") marks.set(Number(market.id ?? id), market.is_closed)
    }
    return { marks, fetchedAt: String(body.fetched ?? ""), source: path.relative(ROOT, file) }
  }
  if (hasRaw("markets")) {
    const marks = new Map()
    for (const market of raw("markets")) if (typeof market.is_closed === "boolean") marks.set(Number(market.id), market.is_closed)
    return { marks, fetchedAt: "", source: "markets.json" }
  }
  return null
}

const found = readMarks()
if (!found) {
  console.log("shop closed: no raw shop_drawer.json or markets.json (run fetch-shop-drawer.mjs or fetch.mjs first)")
  process.exit(0)
}

const client = await connect()
await ensureRegistry(client)
let inserted = 0
let updated = 0
let missing = 0
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS linko_shop_closed (
    client_id INTEGER PRIMARY KEY,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    fetched_at TEXT NOT NULL DEFAULT ''
  )`)
  const shops = new Set((await client.query("SELECT id FROM clients")).rows.map((row) => Number(row.id)))
  const current = new Map((await client.query("SELECT client_id, is_closed, fetched_at FROM linko_shop_closed")).rows.map((row) => [Number(row.client_id), row]))
  for (const [id, closed] of found.marks) {
    if (!shops.has(id)) {
      missing++
      continue
    }
    const before = current.get(id)
    if (!before) {
      await client.query("INSERT INTO linko_shop_closed (client_id, is_closed, fetched_at) VALUES ($1, $2, $3)", [id, closed, found.fetchedAt])
      await register(client, run, "linko_shop_closed", id, "insert")
      inserted++
    } else if (before.is_closed !== closed) {
      await client.query("UPDATE linko_shop_closed SET is_closed = $2, fetched_at = $3 WHERE client_id = $1", [id, closed, found.fetchedAt])
      await register(client, run, "linko_shop_closed", id, "update", { is_closed: before.is_closed, fetched_at: before.fetched_at })
      updated++
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
const closedCount = [...found.marks.values()].filter(Boolean).length
console.log(`shop closed (${found.source}): ${found.marks.size} shops, ${closedCount} closed; ${inserted} inserted, ${updated} updated; ${missing} not here`)
