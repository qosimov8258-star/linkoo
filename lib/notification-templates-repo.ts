import "server-only"

import { getDb } from "@/lib/db"
import templateSeed from "@/lib/seed/notification-templates.json"

type NotificationTemplateSeed = { id: number; name: string; title: string; text: string; keywords: string; status: string; userIds: number[] }

export type NotificationTemplateUser = { id: number; name: string }

export type NotificationTemplate = {
  id: number
  name: string
  title: string
  text: string
  keywords: string
  status: "on" | "off"
  users: NotificationTemplateUser[]
}

type TemplateRow = { id: number; name: string; title: string; text: string; keywords: string; status: string }
type LinkRow = { template_id: number; user_id: number; user_name: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'on',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notification_template_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      UNIQUE (template_id, user_id)
    );
  `)
  const count = Number(((await db.prepare("SELECT COUNT(*) AS count FROM notification_templates").get()) as { count: number | string }).count)
  if (count > 0) return
  const insertTemplate = db.prepare(
    "INSERT INTO notification_templates (id, name, title, text, keywords, status) VALUES (@id, @name, @title, @text, @keywords, @status)",
  )
  const insertLink = db.prepare("INSERT INTO notification_template_users (template_id, user_id) VALUES (@templateId, @userId) ON CONFLICT DO NOTHING")
  for (const seed of templateSeed as NotificationTemplateSeed[]) {
    await insertTemplate.run(seed)
    for (const userId of seed.userIds) await insertLink.run({ templateId: seed.id, userId })
  }
  await db.exec("SELECT setval(pg_get_serial_sequence('notification_templates', 'id'), (SELECT MAX(id) FROM notification_templates))")
}

async function attachUsers(db: ReturnType<typeof getDb>, rows: TemplateRow[]): Promise<NotificationTemplate[]> {
  if (!rows.length) return []
  const links = (await db
    .prepare(
      `SELECT l.template_id, l.user_id, TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS user_name
       FROM notification_template_users l JOIN employees e ON e.id = l.user_id ORDER BY l.id`,
    )
    .all()) as LinkRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    text: row.text,
    keywords: row.keywords,
    status: row.status === "off" ? "off" : "on",
    users: links.filter((link) => link.template_id === row.id).map((link) => ({ id: link.user_id, name: link.user_name })),
  }))
}

export async function listNotificationTemplates(search: string, page: number, pageSize: number): Promise<{ count: number; results: NotificationTemplate[] }> {
  const db = getDb()
  await ensureSchema(db)
  const needle = `%${search.trim().toLowerCase()}%`
  const where = "LOWER(title) LIKE @needle OR LOWER(name) LIKE @needle"
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS count FROM notification_templates WHERE ${where}`).get({ needle })) as { count: number | string }).count)
  const rows = (await db
    .prepare(`SELECT * FROM notification_templates WHERE ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ needle, limit: pageSize, offset: (page - 1) * pageSize })) as TemplateRow[]
  return { count, results: await attachUsers(db, rows) }
}

async function getTemplate(db: ReturnType<typeof getDb>, id: number): Promise<NotificationTemplate | null> {
  const row = (await db.prepare("SELECT * FROM notification_templates WHERE id = ?").get(id)) as TemplateRow | undefined
  return row ? (await attachUsers(db, [row]))[0] : null
}

export async function setNotificationTemplateStatus(id: number, status: "on" | "off"): Promise<NotificationTemplate | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("UPDATE notification_templates SET status = @status, updated_at = datetime('now') WHERE id = @id").run({ id, status })
  return result.changes ? getTemplate(db, id) : null
}

/** "ok" | "no-template" | "no-user" | "duplicate" */
export async function addNotificationTemplateUser(id: number, userId: number): Promise<"ok" | "no-template" | "no-user" | "duplicate"> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await db.prepare("SELECT id FROM notification_templates WHERE id = ?").get(id))) return "no-template"
  if (!(await db.prepare("SELECT id FROM employees WHERE id = ?").get(userId))) return "no-user"
  const result = await db.prepare("INSERT INTO notification_template_users (template_id, user_id) VALUES (@id, @userId) ON CONFLICT DO NOTHING").run({ id, userId })
  return result.changes ? "ok" : "duplicate"
}

export async function removeNotificationTemplateUser(id: number, userId: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM notification_template_users WHERE template_id = ? AND user_id = ?").run(id, userId)).changes > 0
}
