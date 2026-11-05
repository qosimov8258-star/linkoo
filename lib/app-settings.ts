import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"

// Company-wide settings of the app, one text value per key: the app currency (lib/app-currency.ts) and the
// marks of the one-time defaults a new company starts with (lib/default-roles.ts, lib/job-positions-repo.ts).

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

/** The stored value of `key`, or null when it was never written. */
export async function readSetting(db: PgDb, key: string): Promise<string | null> {
  await ensureAppSettingsSchema()
  const row = (await db.prepare("SELECT value FROM app_settings WHERE key = @key").get({ key })) as { value: string } | undefined
  return row ? row.value : null
}

export async function writeSetting(db: PgDb, key: string, value: string, user = ""): Promise<void> {
  await ensureAppSettingsSchema()
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (@key, @value, @user, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
       RETURNING key`,
    )
    .run({ key, value, user })
}
