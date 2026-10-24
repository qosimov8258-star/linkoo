import "server-only"

import { getDb } from "@/lib/db"
import notificationSeed from "@/lib/seed/notifications.json"

export type UserNotification = {
  id: number
  title: string
  text: string
  template: string
  objectId: number
  viewed: boolean
  createdDate: string
}

type Row = { id: number; title: string; text: string; template: string; object_id: number; viewed: number; created_date: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      template TEXT NOT NULL DEFAULT '',
      object_id INTEGER NOT NULL DEFAULT 0,
      viewed INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS'))
    );
  `)
  const count = Number(((await db.prepare("SELECT COUNT(*) AS count FROM user_notifications").get()) as { count: number | string }).count)
  if (count > 0) return
  const insert = db.prepare(
    "INSERT INTO user_notifications (id, title, text, template, object_id, viewed, created_date) VALUES (@id, @title, @text, @template, @objectId, @viewed, @createdDate)",
  )
  for (const seed of notificationSeed as UserNotification[]) await insert.run({ ...seed, viewed: seed.viewed ? 1 : 0 })
  await db.exec("SELECT setval(pg_get_serial_sequence('user_notifications', 'id'), (SELECT MAX(id) FROM user_notifications))")
}

function rowToNotification(row: Row): UserNotification {
  return { id: row.id, title: row.title, text: row.text, template: row.template, objectId: row.object_id, viewed: Boolean(row.viewed), createdDate: row.created_date }
}

/** Newest first, like the reference (created_date DESC). */
export async function listUserNotifications(page: number, pageSize: number): Promise<{ count: number; unviewed: number; results: UserNotification[] }> {
  const db = getDb()
  await ensureSchema(db)
  const counts = (await db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN viewed = 0 THEN 1 ELSE 0 END), 0) AS unviewed FROM user_notifications").get()) as { count: number | string; unviewed: number | string }
  const rows = (await db
    .prepare("SELECT * FROM user_notifications ORDER BY created_date DESC, id DESC LIMIT @limit OFFSET @offset")
    .all({ limit: pageSize, offset: (page - 1) * pageSize })) as Row[]
  return { count: Number(counts.count), unviewed: Number(counts.unviewed), results: rows.map(rowToNotification) }
}

export async function markUserNotificationViewed(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("UPDATE user_notifications SET viewed = 1 WHERE id = ?").run(id)).changes > 0
}

export async function deleteUserNotification(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM user_notifications WHERE id = ?").run(id)).changes > 0
}
