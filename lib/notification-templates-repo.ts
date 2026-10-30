import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { legacyTemplateLinks } from "@/lib/notification-templates-legacy-seed"
import templateSeed from "@/lib/seed/notification-templates.json"

// The templates themselves (names, texts, placeholders) are the platform's own and are seeded into an empty
// table. Who receives them is this company's choice: no subscriber is seeded.
type NotificationTemplateSeed = { id: number; name: string; title: string; text: string; keywords: string; status: string }

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

const SCHEMA_VERSION = 2

declare global {
  var __linkoNotificationTemplatesSchema: { version: number; ready: Promise<void> } | undefined
}

/** Tables, the template seed of an empty table and the removal of the subscribers an older build seeded
 * (lib/notification-templates-legacy-seed.ts): once per process, outside any request transaction. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoNotificationTemplatesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:notification_templates:schema'))")
        await install(tx)
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoNotificationTemplatesSchema = undefined
      throw error
    })
    globalThis.__linkoNotificationTemplatesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoNotificationTemplatesSchema!.ready
}

async function install(db: PgDb) {
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
  // Subscribers seeded by an older build: removed only where id, template and user are exactly the seeded link,
  // and only while at least 10 such links are left (a table that never got the seed cannot match that many by chance).
  await db
    .prepare(
      `WITH seed AS (SELECT * FROM jsonb_to_recordset(@rows::jsonb) AS s(id int, "templateId" int, "userId" int)),
            hit AS (SELECT l.id FROM notification_template_users l JOIN seed s ON l.id = s.id AND l.template_id = s."templateId" AND l.user_id = s."userId")
       DELETE FROM notification_template_users WHERE id IN (SELECT id FROM hit) AND (SELECT COUNT(*) FROM hit) >= 10`,
    )
    .run({ rows: JSON.stringify(legacyTemplateLinks()) })
  const count = Number(((await db.prepare("SELECT COUNT(*) AS count FROM notification_templates").get()) as { count: number | string }).count)
  if (count > 0) return
  const insertTemplate = db.prepare(
    "INSERT INTO notification_templates (id, name, title, text, keywords, status) VALUES (@id, @name, @title, @text, @keywords, @status)",
  )
  for (const seed of templateSeed as NotificationTemplateSeed[]) {
    const { id, name, title, text, keywords, status } = seed
    await insertTemplate.run({ id, name, title, text, keywords, status })
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
  await ensureSchema()
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
  await ensureSchema()
  const result = await db.prepare("UPDATE notification_templates SET status = @status, updated_at = datetime('now') WHERE id = @id").run({ id, status })
  return result.changes ? getTemplate(db, id) : null
}

/** "ok" | "no-template" | "no-user" | "duplicate" */
export async function addNotificationTemplateUser(id: number, userId: number): Promise<"ok" | "no-template" | "no-user" | "duplicate"> {
  const db = getDb()
  await ensureSchema()
  if (!(await db.prepare("SELECT id FROM notification_templates WHERE id = ?").get(id))) return "no-template"
  if (!(await db.prepare("SELECT id FROM employees WHERE id = ?").get(userId))) return "no-user"
  const result = await db.prepare("INSERT INTO notification_template_users (template_id, user_id) VALUES (@id, @userId) ON CONFLICT DO NOTHING").run({ id, userId })
  return result.changes ? "ok" : "duplicate"
}

export async function removeNotificationTemplateUser(id: number, userId: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema()
  return (await db.prepare("DELETE FROM notification_template_users WHERE template_id = ? AND user_id = ?").run(id, userId)).changes > 0
}
