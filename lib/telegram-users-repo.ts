import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

// "Пользователи Телеграм бота" (demo telegram/users/): the people who wrote to the company bot. A user is linked to a
// client (market) once the bot flow confirms the phone number; until then the client column reads "В ожидании".

export type TelegramUser = {
  /** telegram_id */
  id: string
  /** first_name + last_name, concatenated like the reference list does. */
  name: string
  /** @username */
  handle: string
  /** Linked client (market) name, "" while waiting. */
  client: string
  phone: string
  /** "uz" | "ru" | "en" | "" — empty is shown as Узбекча (bot default). */
  language: string
  first: string
  last: string
}

type Row = {
  id: string | number
  first_name: string
  last_name: string
  username: string
  phone: string
  language: string
  market_id: number | null
  market_name: string
  created_date: string
  last_active: string
  client_name: string | null
}

// The bot users are this company's own: a fresh database lists nobody. An older build's demo scripts wrote the
// reference account's six bot users (and one QA test row) into this table. Those rows are removed only while they
// are exactly that seed. Each seeded user is matched by the SHA-256 fingerprint of all its fields (id, names,
// @username, phone, language, market id and name, first and last activity, joined by U+001F), so the other
// company's names and phone numbers are not kept in the code. The QA row was stamped at run time, so it is matched
// by its fixed fields and first activity = last activity. Nothing is inserted.
const LEGACY_SEED_FINGERPRINTS = [
  "eeb5ee473785940b96c9b7c3f1a4e02a61d19458df5b7e22b00698f143ba4224",
  "4816f745d5f663d823673966333921b3cb429abaf3e85f09289e7271e3de0b88",
  "b27580c5876436434bc29b7c001a5f6deb5c169c3e8b7633e02db302d0b64977",
  "2a0007636b372ca2de4dabc8940357f6c8bddc31e7a3a0244d52486309e90cf4",
  "66090e17725fc22c166662a75c52efd7ea62c8b542b2b84d83fa39f7172d456a",
  "f88b56cf2e2fdb23ba2f626a547154a3690a8dd895986d1ff60d40b763416ef6",
]
const FINGERPRINT_SQL = `encode(sha256(convert_to(concat_ws(chr(31), u.id::text, u.first_name, u.last_name, u.username, u.phone, u.language,
  COALESCE(u.market_id::text, ''), u.market_name, u.created_date, u.last_active), 'UTF8')), 'hex')`

const SCHEMA_VERSION = 1

declare global {
  var __linkoTelegramUsersSchema: { version: number; ready: Promise<void> } | undefined
}

/** telegram_users, once per process and outside any request transaction. */
function ensureTelegramUsers(): Promise<void> {
  if (globalThis.__linkoTelegramUsersSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:telegram_users:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS telegram_users (
            id BIGINT PRIMARY KEY,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            language TEXT NOT NULL DEFAULT '',
            market_id INTEGER,
            market_name TEXT NOT NULL DEFAULT '',
            created_date TEXT NOT NULL DEFAULT '',
            last_active TEXT NOT NULL DEFAULT ''
          );
        `)
        await tx
          .prepare(
            `DELETE FROM telegram_users u
              WHERE ${FINGERPRINT_SQL} = ANY(@seed::text[])
                 OR (u.id = 9999000001 AND u.first_name = 'QA' AND u.last_name = 'Test' AND u.username = 'qa_cli_test'
                     AND u.phone = '' AND u.language = '' AND u.market_id IS NULL AND u.market_name = ''
                     AND u.created_date = u.last_active)`,
          )
          .run({ seed: LEGACY_SEED_FINGERPRINTS })
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoTelegramUsersSchema = undefined
      throw error
    })
    globalThis.__linkoTelegramUsersSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoTelegramUsersSchema!.ready
}

/** The reference lists the users in the order they were stored (not by date), so the physical insertion order is kept. */
export async function listTelegramUsers(): Promise<TelegramUser[]> {
  await ensureTelegramUsers()
  const rows = (await getDb()
    .prepare(
      `SELECT u.*, c.name AS client_name FROM telegram_users u LEFT JOIN clients c ON c.id = u.market_id ORDER BY u.ctid ASC`,
    )
    .all()) as Row[]
  return rows.map((row) => ({
    id: String(row.id),
    name: `${row.first_name}${row.last_name}`.trim(),
    handle: row.username ? `@${row.username}` : "",
    client: (row.market_name || row.client_name || "").trim(),
    phone: row.phone,
    language: row.language,
    first: row.created_date,
    last: row.last_active,
  }))
}

/** `id` is a checked telegram id (digits, at most 18, so it fits BIGINT). */
export async function deleteTelegramUser(id: string): Promise<boolean> {
  await ensureTelegramUsers()
  const result = await getDb().prepare("DELETE FROM telegram_users WHERE id = ?::bigint").run(id)
  return result.changes > 0
}
