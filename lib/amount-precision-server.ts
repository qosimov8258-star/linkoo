import "server-only"

import { amountPrecision, parseAmountDigits, setAmountPrecision, type AmountPrecision } from "@/lib/amount-precision"
import { ensureAppSettingsSchema, writeSetting } from "@/lib/app-settings"
import { getDb, type PgDb } from "@/lib/db"

// Настройки → Округление сумм on the server: app_settings keys named after the reference's settings
// (ROUND_AMOUNT_FOR_CURRENCY, SUPPLY_ROUND_AMOUNT), a number of decimals as text, '' or no row = not set (every
// formatter keeps its own default, three decimals). scripts/linko-sync/import-amount-precision.mjs copies them from
// a Linko account. The values are cached for a few seconds per process (a page asks for them several times).

export const AMOUNT_DIGITS_KEY = "round_amount_for_currency"
export const SUPPLY_AMOUNT_DIGITS_KEY = "supply_round_amount"

const TTL_MS = 3000

declare global {
  var __mezonAmountPrecisionLoad: { at: number; ready: Promise<AmountPrecision> } | undefined
}

async function read(db: PgDb): Promise<AmountPrecision> {
  await ensureAppSettingsSchema()
  const rows = (await db
    .prepare("SELECT key, value FROM app_settings WHERE key IN (@digits, @supply)")
    .all({ digits: AMOUNT_DIGITS_KEY, supply: SUPPLY_AMOUNT_DIGITS_KEY })) as Array<{ key: string; value: string }>
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? ""
  return { digits: parseAmountDigits(value(AMOUNT_DIGITS_KEY)), supplyDigits: parseAmountDigits(value(SUPPLY_AMOUNT_DIGITS_KEY)) }
}

/** Reads the setting (at most every few seconds) and makes every formatter of this process use it. A failed read
 * keeps what was loaded before (the defaults on a fresh process). */
export async function loadAmountPrecision(db: PgDb = getDb(), options: { fresh?: boolean } = {}): Promise<AmountPrecision> {
  const cached = globalThis.__mezonAmountPrecisionLoad
  if (!options.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.ready
  const ready = read(db)
    .then((value) => {
      setAmountPrecision(value)
      return value
    })
    // The entry stays (a retry after TTL_MS), so a failing database is not asked again by every formatter call.
    .catch(() => amountPrecision())
  globalThis.__mezonAmountPrecisionLoad = { at: Date.now(), ready }
  return ready
}

/** Saves the setting (0 / '' = not set) and applies it to this process at once. */
export async function saveAmountPrecision(value: Partial<AmountPrecision>, user: string, db: PgDb = getDb()): Promise<AmountPrecision> {
  const digits = parseAmountDigits(value.digits)
  const supplyDigits = parseAmountDigits(value.supplyDigits)
  await writeSetting(db, AMOUNT_DIGITS_KEY, digits ? String(digits) : "", user)
  await writeSetting(db, SUPPLY_AMOUNT_DIGITS_KEY, supplyDigits ? String(supplyDigits) : "", user)
  return loadAmountPrecision(db, { fresh: true })
}

// A route that formats or rounds amounts before anything loaded the setting in this process starts the load; the
// root layout and loadCurrencyContext (lib/finance/context.ts) await it.
globalThis.__mezonAmountPrecisionKick ??= () => {
  if (!globalThis.__mezonAmountPrecisionLoad) void loadAmountPrecision()
}
