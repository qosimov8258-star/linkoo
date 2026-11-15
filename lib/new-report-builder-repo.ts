import "server-only"

import { listAccessRights } from "@/lib/access-rights-repo"
import { EMPLOYEE_ACCESS_SQL, ensureUserEmployeeLink } from "@/lib/auth-employee"
import type { CurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import type { BuilderDateRange, BuilderShare, BuilderShareOptions, NewReportBuilderSave } from "@/lib/new-report-builder-types"
import { hasPermission } from "@/lib/rbac"
import type { Role } from "@/lib/session"

export type { NewReportBuilderSave } from "@/lib/new-report-builder-types"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS new_report_builder_saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE new_report_builder_saves ADD COLUMN IF NOT EXISTS created_by INTEGER;
    ALTER TABLE new_report_builder_saves ADD COLUMN IF NOT EXISTS share_mode TEXT;
    ALTER TABLE new_report_builder_saves ADD COLUMN IF NOT EXISTS share_ids TEXT NOT NULL DEFAULT '[]';
  `)
}

/** The reader of the saves: what they see and may change. */
export type BuilderViewer = {
  id: number
  role: Role
  accessRightId: number | null
  /** May write saves at all (manager or admin, with "reports.manage" when restricted by an access right). */
  canWrite: boolean
}

export function builderViewer(user: CurrentUser): BuilderViewer {
  return {
    id: user.id,
    role: user.role,
    accessRightId: user.accessRightId,
    canWrite: user.role !== "viewer" && hasPermission(user, "reports.manage"),
  }
}

type Row = {
  id: number
  name: string
  report_type: string
  config: string
  created_at: string
  created_by: number | null
  share_mode: string | null
  share_ids: string | null
}

function parseIds(raw: string | null): number[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown
    return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : []
  } catch {
    return []
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function shareOf(row: Row): BuilderShare | null {
  return row.share_mode === "users" || row.share_mode === "rights" ? { mode: row.share_mode, ids: parseIds(row.share_ids) } : null
}

const authorOf = (row: Row) => (row.created_by === null || row.created_by === undefined ? null : Number(row.created_by))

/** Administrators see every save; anybody else the own ones, the unrestricted ones and the ones shared with
 * their account or their access right. */
function visibleTo(row: Row, viewer: BuilderViewer): boolean {
  if (viewer.role === "admin" || authorOf(row) === viewer.id) return true
  const share = shareOf(row)
  if (!share) return true
  if (share.mode === "users") return share.ids.includes(viewer.id)
  return viewer.accessRightId !== null && share.ids.includes(viewer.accessRightId)
}

/** Its author or an administrator changes a save (anybody who may write, for one saved before authors were kept). */
function editableBy(row: Row, viewer: BuilderViewer): boolean {
  if (!viewer.canWrite) return false
  const author = authorOf(row)
  return viewer.role === "admin" || author === null || author === viewer.id
}

function rowToSave(row: Row, viewer: BuilderViewer): NewReportBuilderSave {
  return {
    id: Number(row.id),
    name: row.name,
    reportType: row.report_type,
    config: parseConfig(row.config),
    createdAt: row.created_at,
    createdBy: authorOf(row),
    share: shareOf(row),
    editable: editableBy(row, viewer),
  }
}

export type NewReportBuilderSaveInput = {
  name: string
  reportType: string
  config: Record<string, unknown>
}

export async function listNewReportBuilderSaves(viewer: BuilderViewer): Promise<NewReportBuilderSave[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT * FROM new_report_builder_saves ORDER BY id DESC").all()) as Row[]
  return rows.filter((row) => visibleTo(row, viewer)).map((row) => rowToSave(row, viewer))
}

async function readRow(db: ReturnType<typeof getDb>, id: number): Promise<Row | undefined> {
  return (await db.prepare("SELECT * FROM new_report_builder_saves WHERE id = ?").get(id)) as Row | undefined
}

/** The save, or null when it does not exist or the viewer may not see it. */
export async function getNewReportBuilderSave(id: number, viewer: BuilderViewer): Promise<NewReportBuilderSave | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = await readRow(db, id)
  return row && visibleTo(row, viewer) ? rowToSave(row, viewer) : null
}

export async function createNewReportBuilderSave(input: NewReportBuilderSaveInput, viewer: BuilderViewer): Promise<NewReportBuilderSave> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("INSERT INTO new_report_builder_saves (name, report_type, config, created_by) VALUES (@name, @reportType, @config, @createdBy)")
    .run({ name: input.name, reportType: input.reportType, config: JSON.stringify(input.config), createdBy: viewer.id })
  const row = (await readRow(db, Number(result.lastInsertRowid))) as Row
  return rowToSave(row, viewer)
}

export type NewReportBuilderSavePatch = {
  name?: string
  dateRange?: BuilderDateRange
  /** null lifts the restriction (every signed-in user sees the save). */
  share?: BuilderShare | null
}

export type SaveChangeError = "not-found" | "forbidden" | "unknown-users" | "unknown-rights"

/** Ids of `share` that name no account / access right. */
async function unknownShareIds(db: ReturnType<typeof getDb>, share: BuilderShare): Promise<boolean> {
  const ids = [...new Set(share.ids)]
  if (!ids.length) return false
  const table = share.mode === "users" ? "users" : "access_rights"
  const rows = (await db.prepare(`SELECT id FROM ${table} WHERE id = ANY(?::int[])`).all(ids)) as { id: number }[]
  return rows.length !== ids.length
}

/** «ИЗМЕНИЕ ТАБЛИЦЫ» (new name, period preset) and «ПОЛЬЗОВАТЕЛИ» (who sees it). */
export async function updateNewReportBuilderSave(
  id: number,
  patch: NewReportBuilderSavePatch,
  viewer: BuilderViewer,
): Promise<{ save: NewReportBuilderSave } | { error: SaveChangeError }> {
  const db = getDb()
  await ensureSchema(db)
  const row = await readRow(db, id)
  if (!row || !visibleTo(row, viewer)) return { error: "not-found" }
  if (!editableBy(row, viewer)) return { error: "forbidden" }
  if (patch.share && (await unknownShareIds(db, patch.share))) return { error: patch.share.mode === "users" ? "unknown-users" : "unknown-rights" }

  const config = parseConfig(row.config)
  if (patch.dateRange) config.dateRange = patch.dateRange
  const share = patch.share === undefined ? shareOf(row) : patch.share
  await db
    .prepare(
      `UPDATE new_report_builder_saves
          SET name = @name, config = @config, share_mode = @shareMode, share_ids = @shareIds, updated_at = datetime('now')
        WHERE id = @id`,
    )
    .run({
      id,
      name: patch.name ?? row.name,
      config: JSON.stringify(config),
      shareMode: share?.mode ?? null,
      shareIds: JSON.stringify(share ? [...new Set(share.ids)] : []),
    })
  return { save: rowToSave((await readRow(db, id)) as Row, viewer) }
}

export async function deleteNewReportBuilderSave(id: number, viewer: BuilderViewer): Promise<{ ok: true } | { error: SaveChangeError }> {
  const db = getDb()
  await ensureSchema(db)
  const row = await readRow(db, id)
  if (!row || !visibleTo(row, viewer)) return { error: "not-found" }
  if (!editableBy(row, viewer)) return { error: "forbidden" }
  const result = await db.prepare("DELETE FROM new_report_builder_saves WHERE id = ?").run(id)
  return result.changes > 0 ? { ok: true } : { error: "not-found" }
}

/** The choices of «ПОЛЬЗОВАТЕЛИ»: the accounts that can sign in (by their employee's name) and the access rights. */
export async function listNewReportBuilderShareOptions(): Promise<BuilderShareOptions> {
  await ensureUserEmployeeLink()
  const db = getDb()
  const users = (await db
    .prepare(
      `SELECT u.id,
              COALESCE(NULLIF(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''), NULLIF(btrim(u.display_name), ''), u.username) AS name
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE ${EMPLOYEE_ACCESS_SQL}
        ORDER BY u.id`,
    )
    .all()) as { id: number; name: string }[]
  const rights = await listAccessRights()
  return {
    users: users.map((user) => ({ id: Number(user.id), name: user.name })).sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id),
    rights: rights.map((right) => ({ id: right.id, name: right.name })),
  }
}
