import "server-only"

import { getDb } from "@/lib/db"
import { DOC_TEMPLATE_KEYS, type DocTemplate, type DocTemplateDetail, type DocTemplateListResult, type DocTemplatePayload } from "@/components/analytics/doc-templates-data"

type Row = { id: number; name: string; html: string; key_name: string; is_active: number; created_date: string }

export const REQUIRED_MESSAGE = "Это поле обязательно к заполнению"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS doc_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      key_name TEXT NOT NULL DEFAULT 'order',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_date TEXT NOT NULL DEFAULT '',
      modified_date TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    );
  `)
}

const nowIso = () => new Date().toISOString().slice(0, 19)

const toItem = (row: Row): DocTemplate => ({ id: row.id, name: row.name, keyName: row.key_name, isActive: Boolean(row.is_active), createdDate: row.created_date })

export type DocTemplateQuery = { search: string; ordering: string; page: number; pageSize: number }

const ORDER_COLUMNS: Record<string, string> = { id: "id", name: "lower(name)", date: "created_date", key_name: "key_name", is_active: "is_active" }

export async function listDocTemplates(query: DocTemplateQuery): Promise<DocTemplateListResult> {
  const db = getDb()
  await ensureSchema(db)
  const search = query.search.trim()
  const where = "WHERE (@search = '' OR name ILIKE '%' || @search || '%')"
  const params = { search }
  const desc = query.ordering.startsWith("-")
  const column = ORDER_COLUMNS[query.ordering.replace(/^-/, "")] ?? "id"
  // The demo lists its templates in storage order (not by id) until a header is sorted.
  const order = query.ordering ? `${column} ${desc ? "DESC" : "ASC"}, id ASC` : "position ASC, id ASC"
  const total = (await db.prepare(`SELECT count(*) AS n FROM doc_templates ${where}`).get(params)) as { n: number | string }
  const rows = (await db
    .prepare(`SELECT id, name, key_name, is_active, created_date FROM doc_templates ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: Number(total.n), results: rows.map(toItem) }
}

export async function getDocTemplate(id: number): Promise<DocTemplateDetail | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, html, key_name, is_active, created_date FROM doc_templates WHERE id = ?").get(id)) as Row | undefined
  return row ? { ...toItem(row), html: row.html } : null
}

/** Field errors of the form, keyed like the demo API ("name", "key_name", "html"). */
export function validateDocTemplate(body: Partial<DocTemplatePayload>): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!body.name?.trim()) errors.name = REQUIRED_MESSAGE
  if (!body.html?.trim()) errors.html = REQUIRED_MESSAGE
  if (!body.keyName || !DOC_TEMPLATE_KEYS.some((key) => key.id === body.keyName)) errors.key_name = REQUIRED_MESSAGE
  return errors
}

export async function createDocTemplate(input: DocTemplatePayload): Promise<DocTemplateDetail> {
  const db = getDb()
  await ensureSchema(db)
  const now = nowIso()
  const result = await db
    .prepare("INSERT INTO doc_templates (name, html, key_name, is_active, created_date, modified_date, position) VALUES (@name, @html, @keyName, @isActive, @now, @now, (SELECT COALESCE(MAX(position), 0) + 1 FROM doc_templates))")
    .run({ name: input.name.trim(), html: input.html, keyName: input.keyName, isActive: input.isActive ? 1 : 0, now })
  return (await getDocTemplate(Number(result.lastInsertRowid)))!
}

export async function updateDocTemplate(id: number, input: DocTemplatePayload): Promise<DocTemplateDetail | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("UPDATE doc_templates SET name = @name, html = @html, key_name = @keyName, is_active = @isActive, modified_date = @now WHERE id = @id")
    .run({ id, name: input.name.trim(), html: input.html, keyName: input.keyName, isActive: input.isActive ? 1 : 0, now: nowIso() })
  return result.changes ? getDocTemplate(id) : null
}

export async function deleteDocTemplate(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM doc_templates WHERE id = ?").run(id)).changes > 0
}
