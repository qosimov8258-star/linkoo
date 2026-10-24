import "server-only"

import { getDb } from "@/lib/db"

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

export async function ensureTelegramUsers(db: ReturnType<typeof getDb>) {
  await db.exec(`
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
}

/** The reference lists the users in the order they were stored (not by date), so the physical insertion order is kept. */
export async function listTelegramUsers(): Promise<TelegramUser[]> {
  const db = getDb()
  await ensureTelegramUsers(db)
  const rows = (await db
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

export async function deleteTelegramUser(id: string): Promise<boolean> {
  const db = getDb()
  await ensureTelegramUsers(db)
  const result = await db.prepare("DELETE FROM telegram_users WHERE id = ?").run(id)
  return result.changes > 0
}
