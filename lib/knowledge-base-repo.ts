import "server-only"

import { getDb, isolated, withTransaction, type PgDb } from "@/lib/db"
import { DictionaryError, fieldError } from "@/lib/dictionaries-schema"
import { ensureKnowledgeBaseSchema } from "@/lib/knowledge-base-schema"
import { keySql, nameKey } from "@/lib/platform-refs"
import {
  KB_MESSAGES,
  knowledgeBaseFileUrl,
  type KnowledgeBaseArticle,
  type KnowledgeBaseFeed,
  type KnowledgeBaseFile,
  type KnowledgeBaseListItem,
  type KnowledgeBaseListResult,
  type KnowledgeBasePosition,
} from "@/lib/knowledge-base-types"

// "База знания" articles (demo main/knowledge/). Names are unique (case- and space-insensitive,
// NFC: the routes clean every text first); creates and renames are serialised by an advisory
// lock and backed by the unique index. "Права доступа" are job positions linked by id (FK, so a
// deleted position can never stay linked); the attached PDF is a knowledge_base_files row that
// the same user uploaded and no other article holds. Lock order of the writes: names lock →
// article row → positions (KEY SHARE) → file row.

/** What a reader may see: every article, or only the active ones published to a position
 * (null = the caller has no position: only the articles meant for every position). */
export type KnowledgeBaseScope = { all: true } | { all: false; positionId: number | null }

export type KnowledgeBaseInput = {
  name: string
  text?: string
  isActive?: boolean
  positionIds?: number[]
  /** number = attach this upload, null = no file, undefined = keep (create: none). */
  fileId?: number | null
}

type ArticleRow = {
  id: number
  name: string
  text: string
  active: number
  file_id: number | null
  created_at: string
  updated_at: string
  file_name: string | null
  file_size: number | null
}

const NAMES_LOCK = "linko:knowledge_base:names"

/** "YYYY-MM-DD HH:MM:SS" (UTC, datetime('now')) → ISO "…Z". */
function isoUtc(value: string | null | undefined): string {
  const text = String(value ?? "").trim()
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text
}

function fileOf(row: { file_id: number | null; file_name: string | null; file_size: number | null }): KnowledgeBaseFile | null {
  if (!row.file_id) return null
  const id = Number(row.file_id)
  return { id, name: row.file_name ?? "", size: Number(row.file_size ?? 0), url: knowledgeBaseFileUrl(id) }
}

/** SQL condition: article `alias` is visible in `scope` (binds @positionId). */
function visibleSql(scope: KnowledgeBaseScope, alias = "a"): string {
  if (scope.all) return "TRUE"
  const own = scope.positionId
    ? `OR EXISTS (SELECT 1 FROM knowledge_base_article_positions l WHERE l.article_id = ${alias}.id AND l.position_id = @positionId)`
    : ""
  return `(${alias}.active = 1 AND (NOT EXISTS (SELECT 1 FROM knowledge_base_article_positions l WHERE l.article_id = ${alias}.id) ${own}))`
}

function scopeParams(scope: KnowledgeBaseScope): Record<string, unknown> {
  return scope.all || !scope.positionId ? {} : { positionId: scope.positionId }
}

/** Statement arguments: the named values, or none (a lone {} would be bound as one value). */
function args(params: Record<string, unknown>): unknown[] {
  return Object.keys(params).length ? [params] : []
}

const ARTICLE_SELECT = `
  SELECT a.id, a.name, a.text, a.active, a.file_id, a.created_at, a.updated_at,
         f.name AS file_name, f.size_bytes AS file_size
    FROM knowledge_base_articles a
    LEFT JOIN knowledge_base_files f ON f.id = a.file_id`

async function positionsOf(db: PgDb, ids: number[]): Promise<Map<number, KnowledgeBasePosition[]>> {
  const map = new Map<number, KnowledgeBasePosition[]>()
  if (!ids.length) return map
  const rows = (await db
    .prepare(
      `SELECT l.article_id, p.id, p.name
         FROM knowledge_base_article_positions l
         JOIN job_positions p ON p.id = l.position_id
        WHERE l.article_id = ANY(@ids::int[])
        ORDER BY p.name, p.id`,
    )
    .all({ ids })) as Array<{ article_id: number; id: number; name: string }>
  for (const row of rows) {
    const list = map.get(Number(row.article_id)) ?? []
    list.push({ id: Number(row.id), name: row.name })
    map.set(Number(row.article_id), list)
  }
  return map
}

function toArticle(row: ArticleRow, positions: KnowledgeBasePosition[]): KnowledgeBaseArticle {
  return {
    id: Number(row.id),
    name: row.name,
    text: row.text ?? "",
    isActive: Number(row.active) === 1,
    positions,
    file: fileOf(row),
    createdAt: isoUtc(row.created_at),
    updatedAt: isoUtc(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Job position of an employee, or null: the Должность picked in the form (employees.job_id); a legacy
 * row without one is matched by its position text. job_id is read through to_jsonb so a database whose
 * employees table predates the column still answers. */
export async function positionOfEmployee(employeeId: number | null): Promise<KnowledgeBasePosition | null> {
  if (!employeeId) return null
  await ensureKnowledgeBaseSchema()
  const row = (await getDb()
    .prepare(
      `SELECT p.id, p.name
         FROM employees e
         JOIN job_positions p
           ON p.id = NULLIF(to_jsonb(e) ->> 'job_id', '')::bigint
           OR (NULLIF(to_jsonb(e) ->> 'job_id', '') IS NULL AND ${keySql("e.position")} <> '' AND ${keySql("p.name")} = ${keySql("e.position")})
        WHERE e.id = ?
        ORDER BY p.id
        LIMIT 1`,
    )
    .get(employeeId)) as { id: number; name: string } | undefined
  return row ? { id: Number(row.id), name: row.name } : null
}

/** The grid: id DESC (demo order), optional name search, one page. */
export async function listKnowledgeBase(
  query: { search: string; page: number; pageSize: number },
  scope: KnowledgeBaseScope,
): Promise<KnowledgeBaseListResult> {
  await ensureKnowledgeBaseSchema()
  const db = getDb()
  const search = query.search.normalize("NFC").trim()
  const where = [visibleSql(scope)]
  const params: Record<string, unknown> = { ...scopeParams(scope) }
  if (search) {
    where.push("strpos(lower(a.name), lower(@search::text)) > 0")
    params.search = search
  }
  const condition = where.join(" AND ")
  const total = (await db.prepare(`SELECT COUNT(*)::int AS n FROM knowledge_base_articles a WHERE ${condition}`).get(...args(params))) as { n: number }
  const rows = (await db
    .prepare(
      `SELECT a.id, a.name, a.active, a.file_id, a.updated_at,
              (SELECT COUNT(*)::int FROM knowledge_base_article_positions l WHERE l.article_id = a.id) AS position_count
         FROM knowledge_base_articles a
        WHERE ${condition}
        ORDER BY a.id DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Array<{
    id: number
    name: string
    active: number
    file_id: number | null
    updated_at: string
    position_count: number
  }>
  const results: KnowledgeBaseListItem[] = rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    isActive: Number(row.active) === 1,
    positionCount: Number(row.position_count ?? 0),
    hasFile: Boolean(row.file_id),
    updatedAt: isoUtc(row.updated_at),
  }))
  return { count: Number(total?.n ?? 0), results }
}

/** One article in `scope` (null when missing or not visible). */
export async function getKnowledgeBaseArticle(id: number, scope: KnowledgeBaseScope = { all: true }): Promise<KnowledgeBaseArticle | null> {
  await ensureKnowledgeBaseSchema()
  const db = getDb()
  const row = (await db.prepare(`${ARTICLE_SELECT} WHERE a.id = @id AND ${visibleSql(scope)}`).get({ id, ...scopeParams(scope) })) as ArticleRow | undefined
  if (!row) return null
  return toArticle(row, (await positionsOf(db, [Number(row.id)])).get(Number(row.id)) ?? [])
}

/** The caller's mobile feed: active articles of `position` (and those for every position). */
export async function knowledgeBaseFeed(position: KnowledgeBasePosition | null, since: string | null): Promise<KnowledgeBaseFeed> {
  await ensureKnowledgeBaseSchema()
  const db = getDb()
  const scope: KnowledgeBaseScope = { all: false, positionId: position?.id ?? null }
  const rows = (await db.prepare(`${ARTICLE_SELECT} WHERE ${visibleSql(scope)} ORDER BY a.id DESC`).all(...args(scopeParams(scope)))) as ArticleRow[]
  const clock = (await db.prepare("SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS now").get()) as { now: string }
  // ">=": updated_at has whole seconds, so a change in the second of `since` is sent again.
  const changed = since ? rows.filter((row) => isoUtc(row.updated_at) >= since) : rows
  return {
    serverTime: clock.now,
    position,
    visibleIds: rows.map((row) => Number(row.id)),
    articles: changed.map((row) => ({ id: Number(row.id), name: row.name, text: row.text ?? "", file: fileOf(row), updatedAt: isoUtc(row.updated_at) })),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function lockNames(tx: PgDb) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@key)) AS ok").get({ key: NAMES_LOCK })
}

async function assertNameFree(tx: PgDb, name: string, exceptId: number) {
  const twin = await tx.prepare(`SELECT id FROM knowledge_base_articles WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name, id: exceptId })
  if (twin) throw new DictionaryError(KB_MESSAGES.nameTaken, 409, { name: KB_MESSAGES.nameTaken })
}

/** The positions by id, KEY SHARE locked (a delete waits for this transaction); 400 for an unknown one. */
async function lockPositions(tx: PgDb, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const rows = (await tx.prepare("SELECT id FROM job_positions WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE").all({ ids: unique })) as Array<{ id: number }>
  if (rows.length !== unique.length) throw fieldError("positions", KB_MESSAGES.positionNotFound)
  return rows.map((row) => Number(row.id))
}

/** An upload the article may hold: its own current file, or a file `actorId` uploaded that no
 * other article holds (row-locked until commit). */
async function claimFile(tx: PgDb, fileId: number, articleId: number, currentFileId: number | null, actorId: number) {
  const file = (await tx.prepare("SELECT id, created_by FROM knowledge_base_files WHERE id = ? FOR UPDATE").get(fileId)) as { id: number; created_by: number | null } | undefined
  if (!file) throw fieldError("file", KB_MESSAGES.fileNotFound)
  if (fileId === currentFileId) return
  if (Number(file.created_by) !== actorId) throw fieldError("file", KB_MESSAGES.fileNotFound)
  const holder = await tx.prepare("SELECT id FROM knowledge_base_articles WHERE file_id = ? AND id <> ?").get(fileId, articleId)
  if (holder) throw fieldError("file", KB_MESSAGES.fileNotFound)
}

async function writePositions(tx: PgDb, articleId: number, positionIds: number[]) {
  await tx.prepare("DELETE FROM knowledge_base_article_positions WHERE article_id = ?").run(articleId)
  if (!positionIds.length) return
  await tx
    .prepare(
      `INSERT INTO knowledge_base_article_positions (article_id, position_id)
       SELECT @articleId::int, unnest(@ids::int[]) ON CONFLICT DO NOTHING RETURNING article_id`,
    )
    .run({ articleId, ids: positionIds })
}

/** A unique index refusal (a parallel write won the race) as the field error. */
function uniqueGuard(error: unknown): never {
  const pg = error as { code?: unknown; constraint?: unknown }
  if (pg && typeof pg === "object" && pg.code === "23505") {
    if (pg.constraint === "knowledge_base_articles_file_key") throw fieldError("file", KB_MESSAGES.fileNotFound)
    throw new DictionaryError(KB_MESSAGES.nameTaken, 409, { name: KB_MESSAGES.nameTaken })
  }
  if (pg && typeof pg === "object" && pg.code === "23503") {
    // A position or the file was deleted by a transaction that finished meanwhile.
    throw new DictionaryError(KB_MESSAGES.positionNotFound, 400, { positions: KB_MESSAGES.positionNotFound })
  }
  throw error
}

/** Creates an article (demo POST main/knowledge/). 409 for a taken name. */
export async function createKnowledgeBaseArticle(input: KnowledgeBaseInput, actorId: number): Promise<KnowledgeBaseArticle> {
  await ensureKnowledgeBaseSchema()
  let id: number
  try {
    id = await withTransaction(async (tx) => {
      await lockNames(tx)
      await assertNameFree(tx, input.name, 0)
      const positionIds = await lockPositions(tx, input.positionIds ?? [])
      const fileId = input.fileId ?? null
      if (fileId) await claimFile(tx, fileId, 0, null, actorId)
      const created = (await tx
        .prepare(
          `INSERT INTO knowledge_base_articles (name, text, active, file_id, created_by, updated_by)
           VALUES (@name, @text, @active, @fileId, @actorId, @actorId) RETURNING id`,
        )
        .get({ name: input.name, text: input.text ?? "", active: input.isActive ? 1 : 0, fileId, actorId })) as { id: number }
      await writePositions(tx, Number(created.id), positionIds)
      return Number(created.id)
    })
  } catch (error) {
    return uniqueGuard(error)
  }
  return (await getKnowledgeBaseArticle(id))!
}

/** Updates an article (demo PUT main/knowledge/<id>/); omitted fields keep their value. A
 * replaced or removed file is deleted with the change. Null when the article does not exist. */
export async function updateKnowledgeBaseArticle(id: number, input: KnowledgeBaseInput, actorId: number): Promise<KnowledgeBaseArticle | null> {
  await ensureKnowledgeBaseSchema()
  let found: boolean
  try {
    found = await withTransaction(async (tx) => {
      await lockNames(tx)
      const current = (await tx.prepare("SELECT id, name, text, active, file_id FROM knowledge_base_articles WHERE id = ? FOR UPDATE").get(id)) as
        | { id: number; name: string; text: string; active: number; file_id: number | null }
        | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      const positionIds = input.positionIds === undefined ? null : await lockPositions(tx, input.positionIds)
      const currentFileId = current.file_id ? Number(current.file_id) : null
      const fileId = input.fileId === undefined ? currentFileId : input.fileId
      if (fileId) await claimFile(tx, fileId, id, currentFileId, actorId)
      await tx
        .prepare(
          `UPDATE knowledge_base_articles
              SET name = @name, text = @text, active = @active, file_id = @fileId, updated_by = @actorId, updated_at = datetime('now')
            WHERE id = @id`,
        )
        .run({
          id,
          name: input.name,
          text: input.text ?? current.text,
          active: (input.isActive ?? Number(current.active) === 1) ? 1 : 0,
          fileId,
          actorId,
        })
      if (positionIds) await writePositions(tx, id, positionIds)
      if (currentFileId && currentFileId !== fileId) await tx.prepare("DELETE FROM knowledge_base_files WHERE id = ?").run(currentFileId)
      return true
    })
  } catch (error) {
    return uniqueGuard(error)
  }
  return found ? await getKnowledgeBaseArticle(id) : null
}

/** Deletes an article with its position links and its file. Nothing references articles. */
export async function deleteKnowledgeBaseArticle(id: number): Promise<boolean> {
  await ensureKnowledgeBaseSchema()
  return withTransaction(async (tx) => {
    const row = (await tx.prepare("SELECT id, file_id FROM knowledge_base_articles WHERE id = ? FOR UPDATE").get(id)) as { id: number; file_id: number | null } | undefined
    if (!row) return false
    await tx.prepare("DELETE FROM knowledge_base_articles WHERE id = ?").run(id)
    if (row.file_id) await tx.prepare("DELETE FROM knowledge_base_files WHERE id = ?").run(Number(row.file_id))
    return true
  })
}

/** Best effort: uploads nobody attached within a day. A file an article took meanwhile makes the
 * statement fail on its foreign key and is kept (the error is swallowed). */
export async function removeStaleKnowledgeBaseUploads(): Promise<void> {
  await ensureKnowledgeBaseSchema()
  try {
    await isolated(() =>
      getDb()
        .prepare(
          `DELETE FROM knowledge_base_files f
            WHERE f.created_at < now() - interval '1 day'
              AND NOT EXISTS (SELECT 1 FROM knowledge_base_articles a WHERE a.file_id = f.id)`,
        )
        .run(),
    )
  } catch (error) {
    console.warn("[knowledge-base] stale upload cleanup skipped:", error instanceof Error ? error.message : error)
  }
}
