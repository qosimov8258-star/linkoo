// Продажи → Возвраты: the «Прайс лист» of every client return copied from Linko (its price_list, by name), into
// client_returns.price_list — the «Изменение возврата» form shows it for a return without an order («Возврат по старой
// базе»). Only that column of rows that exist already (import-returns.mjs) is written; a return Linko has no price
// list for keeps ''. Each change is registered in linko_sync_rows with the previous value.
//
//   node scripts/linko-sync/import-return-price-lists.mjs     (raw file: order_returns_detail; RAW=<dir> picks the folder)
import fs from "node:fs"

import { capturedOrSkip, connect, ensureRegistry, register, runId } from "./lib.mjs"

/** <RAW>/<name>.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> folder that holds the file
 * (a later partial download may lack it). */
function rawFile(name) {
  const file = capturedOrSkip(`${name}.json`)
  if (file) return file
  throw new Error(`No raw ${name}.json under backups/linko-raw: run scripts/linko-sync/fetch.mjs first`)
}

const details = JSON.parse(fs.readFileSync(rawFile("order_returns_detail"), "utf8")).data
const run = runId("return-price-lists")
const client = await connect()
await ensureRegistry(client)
const stats = { update: 0, same: 0, missing: 0 }
try {
  await client.query("BEGIN")
  // Same column as lib/client-returns-repo.ts adds (RETURN_COLUMNS).
  await client.query("ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS price_list TEXT NOT NULL DEFAULT ''")
  for (const detail of Object.values(details)) {
    if (!detail || detail.__status || !detail.id) continue
    const wanted = String(detail.price_list?.name ?? "").trim()
    const row = (await client.query("SELECT id, price_list FROM client_returns WHERE id = $1", [detail.id])).rows[0]
    if (!row) {
      stats.missing++
      continue
    }
    if ((row.price_list ?? "") === wanted) {
      stats.same++
      continue
    }
    await client.query("UPDATE client_returns SET price_list = $2 WHERE id = $1", [row.id, wanted])
    await register(client, run, "client_returns", row.id, "update", { price_list: row.price_list ?? "" })
    stats.update++
  }
  await client.query("COMMIT")
  console.log("return price lists:", stats)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
