import "server-only"

import { getDb } from "@/lib/db"
import { INTEGRATION_TYPES } from "@/lib/integrations-types"

export type Integration = {
  id: number
  type: string
  typeDisplay: string
  userId: number | null
  userName: string
  comment: string
  isActive: boolean
  token: string
  validUntil: string | null
  extraFields: Record<string, string>
  extraUserIds: number[]
}

type Row = {
  id: number
  type: string
  user_id: number | null
  comment: string
  is_active: number
  token: string
  valid_until: string
  extra_fields: string
  extra_user_ids: string
  user_name: string | null
}

export type IntegrationInput = {
  type: string
  userId: number | null
  comment: string
  isActive: boolean
  token: string
  validUntil: string | null
  extraFields: Record<string, string>
  extraUserIds: number[]
}

export type IntegrationFilter = {
  isActive: boolean
  search: string
  type: string
  userId: number | null
  extraUserId: number | null
  page: number
  pageSize: number
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      user_id INTEGER,
      comment TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      token TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',
      extra_fields TEXT NOT NULL DEFAULT '{}',
      extra_user_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToIntegration(row: Row): Integration {
  return {
    id: row.id,
    type: row.type,
    typeDisplay: INTEGRATION_TYPES.find((item) => item.name === row.type)?.nameDisplay ?? row.type,
    userId: row.user_id,
    userName: row.user_name ?? "",
    comment: row.comment,
    isActive: Boolean(row.is_active),
    token: row.token,
    validUntil: row.valid_until || null,
    extraFields: parseJson<Record<string, string>>(row.extra_fields, {}),
    extraUserIds: parseJson<number[]>(row.extra_user_ids, []),
  }
}

const SELECT = `SELECT i.*, TRIM(e.first_name || ' ' || e.last_name) AS user_name
  FROM integrations i LEFT JOIN employees e ON e.id = i.user_id`

export async function listIntegrations(filter: IntegrationFilter): Promise<{ count: number; results: Integration[] }> {
  const db = getDb()
  await ensureSchema(db)
  const where = ["i.is_active = @active"]
  const params: Record<string, unknown> = { active: filter.isActive ? 1 : 0 }
  const search = filter.search.trim().toLowerCase()
  if (search) {
    where.push("(LOWER(i.comment) LIKE @search OR LOWER(i.type) LIKE @search OR CAST(i.id AS TEXT) = @plain)")
    params.search = `%${search}%`
    params.plain = search
  }
  if (filter.type) {
    where.push("i.type = @type")
    params.type = filter.type
  }
  if (filter.userId !== null) {
    where.push("i.user_id = @userId")
    params.userId = filter.userId
  }
  if (filter.extraUserId !== null) {
    where.push("i.extra_user_ids::jsonb @> to_jsonb(@extraUserId::int)")
    params.extraUserId = filter.extraUserId
  }
  const clause = where.join(" AND ")
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS count FROM integrations i WHERE ${clause}`).get(params)) as { count: number | string }).count)
  const rows = (await db
    .prepare(`${SELECT} WHERE ${clause} ORDER BY i.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize })) as Row[]
  return { count, results: rows.map(rowToIntegration) }
}

export async function getIntegration(id: number): Promise<Integration | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare(`${SELECT} WHERE i.id = ?`).get(id)) as Row | undefined
  return row ? rowToIntegration(row) : null
}

function bind(input: IntegrationInput) {
  return {
    type: input.type,
    userId: input.userId,
    comment: input.comment,
    isActive: input.isActive ? 1 : 0,
    token: input.token,
    validUntil: input.validUntil ?? "",
    extraFields: JSON.stringify(input.extraFields),
    extraUserIds: JSON.stringify(input.extraUserIds),
  }
}

export async function createIntegration(input: IntegrationInput): Promise<Integration> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(
      `INSERT INTO integrations (type, user_id, comment, is_active, token, valid_until, extra_fields, extra_user_ids)
       VALUES (@type, @userId, @comment, @isActive, @token, @validUntil, @extraFields, @extraUserIds)`,
    )
    .run(bind(input))
  return (await getIntegration(Number(result.lastInsertRowid)))!
}

export async function updateIntegration(id: number, input: IntegrationInput): Promise<Integration | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(
      `UPDATE integrations SET type = @type, user_id = @userId, comment = @comment, is_active = @isActive, token = @token,
       valid_until = @validUntil, extra_fields = @extraFields, extra_user_ids = @extraUserIds, updated_at = datetime('now') WHERE id = @id`,
    )
    .run({ ...bind(input), id })
  return result.changes ? getIntegration(id) : null
}

export async function deleteIntegration(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM integrations WHERE id = ?").run(id)).changes > 0
}
