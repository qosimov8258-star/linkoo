// Настройки → Округление сумм: Linko's settings ROUND_AMOUNT_FOR_CURRENCY and SUPPLY_ROUND_AMOUNT (the decimals its
// screens print, round and type amounts with) from its GET config response, into app_settings
// (round_amount_for_currency / supply_round_amount, lib/amount-precision-server.ts). A setting Linko does not have is
// written as '' (not set: three decimals).
//
// The raw file is config.json: RAW=<folder>, else the newest backups/linko-raw/<date>/ that holds one (fetch.mjs saves
// it with the lists step, manifest list "config").
//
//   node scripts/linko-sync/import-amount-precision.mjs
import fs from "node:fs"
import path from "node:path"

import { ROOT, capturedOrSkip, connect, ensureRegistry, register, runId } from "./lib.mjs"

/** <RAW>/config.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date>/config.json. */
function configFile() {
  const file = capturedOrSkip("config.json")
  if (!file) throw new Error("No config.json in backups/linko-raw/<date>/: run scripts/linko-sync/fetch.mjs lists first")
  return file
}

/** Linko reads the setting with Number(value) || default: an integer 1..10 is kept, anything else is "not set". */
function digits(value) {
  const number = Math.trunc(Number(String(value ?? "").trim()))
  return Number.isFinite(number) && number > 0 ? String(Math.min(number, 10)) : ""
}

const file = configFile()
const config = JSON.parse(fs.readFileSync(file, "utf8")).data ?? {}
const wanted = {
  round_amount_for_currency: digits(config.ROUND_AMOUNT_FOR_CURRENCY),
  supply_round_amount: digits(config.SUPPLY_ROUND_AMOUNT),
}

const run = runId("amount-precision")
const client = await connect()
await ensureRegistry(client)
const changes = []
try {
  await client.query("BEGIN")
  // The table of lib/app-settings.ts (a fresh database gets it from the app's first settings read).
  await client.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  )`)
  for (const [key, value] of Object.entries(wanted)) {
    const before = (await client.query("SELECT key, value, updated_by, updated_at FROM app_settings WHERE key = $1", [key])).rows[0]
    if (before && before.value === value) continue
    if (!before && value === "") continue
    await client.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, 'Linko', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [key, value],
    )
    await register(client, run, "app_settings", key, before ? "update" : "insert", before ?? null)
    changes.push(`${key}=${value || "(not set)"}`)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`amount precision (${path.relative(ROOT, file)}): ${changes.length ? changes.join(", ") : "unchanged"}`)
