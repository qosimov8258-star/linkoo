import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"

// "Настройки → Валюта приложения": the one currency the whole app works in (SOM, USD or ЕВРО,
// any currency of Валюты). Stored as the canonical code in app_settings (key 'currency');
// '' = every currency, as before. With a currency chosen:
// - currency lists (GET /api/currencies, lib/finance/context.ts) offer only that one, so new
//   documents, payments and prices are entered in it and a write in another currency is refused;
// - amounts stored in other currencies are shown converted into it with the current rates of
//   Валюты (the finance ledger SQL, lib/finance/sources.ts, and the reports that read the context).
// The stored documents themselves never change: choosing "Все валюты" again shows them as they are.

const DDL = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoAppSettingsSchema: { version: number; ready: Promise<void> } | undefined
}

export async function ensureAppSettingsSchema(): Promise<void> {
  if (globalThis.__linkoAppSettingsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => getDb().exec(DDL)).catch((error: unknown) => {
      globalThis.__linkoAppSettingsSchema = undefined
      throw error
    })
    globalThis.__linkoAppSettingsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoAppSettingsSchema!.ready
}

/** SQL of the chosen currency's canonical code ('' = all); needs ensureAppSettingsSchema first. */
export const APP_CURRENCY_SQL = "COALESCE((SELECT value FROM app_settings WHERE key = 'currency'), '')"

/** The stored app currency code as it is ('' = none), without checking it against Валюты. */
export async function storedAppCurrency(db: PgDb = getDb()): Promise<string> {
  await ensureAppSettingsSchema()
  const row = (await db.prepare(`SELECT ${APP_CURRENCY_SQL} AS code`).get()) as { code: string } | undefined
  return String(row?.code ?? "").trim()
}

/** Canonical code of the app currency, or '' when every currency is used. A stored code that is
 * no longer in Валюты counts as '' (the app never locks itself to a currency it cannot show). */
export async function getAppCurrency(db: PgDb = getDb()): Promise<string> {
  const code = await storedAppCurrency(db)
  if (!code) return ""
  const currencies = (await db.prepare("SELECT code FROM currencies").all()) as Array<{ code: string }>
  return currencies.some((currency) => normCurrency(currency.code) === code) ? code : ""
}

export class AppCurrencyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Saves the app currency ('' = all currencies). The code must be a currency of Валюты. */
export async function setAppCurrency(value: string, user: string, db: PgDb = getDb()): Promise<string> {
  await ensureAppSettingsSchema()
  const code = value.trim() ? normCurrency(value) : ""
  if (code) {
    const currencies = (await db.prepare("SELECT code FROM currencies").all()) as Array<{ code: string }>
    if (!currencies.some((currency) => normCurrency(currency.code) === code)) throw new AppCurrencyError("Валюта не найдена", 400)
  }
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('currency', @value, @user, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
       RETURNING key`,
    )
    .run({ value: code, user })
  return getAppCurrency(db)
}
