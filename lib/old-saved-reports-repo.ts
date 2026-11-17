import "server-only"

import { getDb } from "@/lib/db"
import type { CurrentUser } from "@/lib/current-user"

// Старый конструктор отчетов → «Отчеты» / «Виджеты»: the saved reports as Linko keeps them (main/report_config):
//   who sees a report: view_type "user" = the employees in `users`, "position" = the access rights in `positions`
//     (Linko's «Пользователи» dialog: «Выбранным сотрудникам» / «Выбранным доступам»);
//   «Мои отчеты» = the reports the current user sees that way, «Отчеты сотрудников» = the others, «Все» = every one
//     (checked against Linko's three lists for its admin); a report saved before this was kept (nobody in it)
//     counts as everyone's own;
//   «Шаблоны отчетов» = Linko's ready templates (main/billing/report_config, copied by
//     scripts/linko-sync/import-report-details.mjs), «Статические виджеты» = its static widgets (main/static_widget):
//     a name, the device and who sees it.

export type SavedReportShow = "own" | "other" | "all" | "pattern" | "static_widget"
export const SAVED_REPORT_SHOWS: SavedReportShow[] = ["own", "other", "all", "pattern", "static_widget"]

export type SavedReportType = "table" | "widget"

export type OldSavedReport = {
  id: number
  name: string
  config: unknown
  reportType: SavedReportType
}

export type OldStaticWidget = {
  id: number
  name: string
  /** «Устройство»: Linko's show_in_display — «Мобильный» for the mobile app's widgets, «Десктоп» otherwise. */
  device: string
}

export type ReportSharing = {
  type: "user" | "position"
  users: number[]
  positions: number[]
}

export type SharingKind = "report" | "static"

type ReportRow = {
  id: number
  name: string
  config: string
  report_type: string | null
  view_type: string | null
  users: string | null
  positions: string | null
}

type StaticRow = {
  id: number
  name: string | null
  show_in: string | null
}

type Db = ReturnType<typeof getDb>

let schemaReady: Promise<void> | null = null

function ensureSchema(db: Db): Promise<void> {
  schemaReady ??= db
    .exec(`
      CREATE TABLE IF NOT EXISTS old_saved_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE old_saved_reports ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'table';
      ALTER TABLE old_saved_reports ADD COLUMN IF NOT EXISTS view_type TEXT NOT NULL DEFAULT 'user';
      ALTER TABLE old_saved_reports ADD COLUMN IF NOT EXISTS users TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE old_saved_reports ADD COLUMN IF NOT EXISTS positions TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE IF NOT EXISTS old_report_patterns (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        description TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS old_static_widgets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        key_name TEXT NOT NULL DEFAULT '',
        show_in TEXT NOT NULL DEFAULT '',
        view_type TEXT NOT NULL DEFAULT 'user',
        users TEXT NOT NULL DEFAULT '[]',
        positions TEXT NOT NULL DEFAULT '[]',
        sort INTEGER NOT NULL DEFAULT 0
      );
    `)
    .catch((error: unknown) => {
      schemaReady = null
      throw error
    })
  return schemaReady
}

function parseConfig(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

function parseIds(raw: string | null): number[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown
    return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : []
  } catch {
    return []
  }
}

const reportType = (value: string | null): SavedReportType => (value === "widget" ? "widget" : "table")

function rowToReport(row: ReportRow): OldSavedReport {
  return { id: row.id, name: row.name, config: parseConfig(row.config), reportType: reportType(row.report_type) }
}

/** Whether the user is among the ones a report (or a static widget) is given to. */
function isOwn(row: { view_type: string | null; users: string | null; positions: string | null }, user: CurrentUser): boolean {
  const users = parseIds(row.users)
  const positions = parseIds(row.positions)
  if (!users.length && !positions.length) return true
  return row.view_type === "position"
    ? user.accessRightId !== null && positions.includes(user.accessRightId)
    : user.employeeId !== null && users.includes(user.employeeId)
}

export async function listOldSavedReports(show: Exclude<SavedReportShow, "static_widget">, user: CurrentUser): Promise<OldSavedReport[]> {
  const db = getDb()
  await ensureSchema(db)
  if (show === "pattern") {
    const rows = (await db.prepare("SELECT id, name, config FROM old_report_patterns ORDER BY id ASC").all()) as Array<{ id: number; name: string; config: string }>
    return rows.map((row) => ({ id: row.id, name: row.name, config: parseConfig(row.config), reportType: "table" }))
  }
  const rows = (await db.prepare("SELECT id, name, config, report_type, view_type, users, positions FROM old_saved_reports ORDER BY id ASC").all()) as ReportRow[]
  const shown = show === "all" ? rows : rows.filter((row) => isOwn(row, user) === (show === "own"))
  return shown.map(rowToReport)
}

export async function listOldStaticWidgets(): Promise<OldStaticWidget[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT id, name, show_in FROM old_static_widgets ORDER BY sort ASC, id ASC").all()) as StaticRow[]
  return rows.map((row) => ({ id: row.id, name: row.name ?? "", device: row.show_in === "mobile" ? "Мобильный" : "Десктоп" }))
}

export type OldSavedReportInput = {
  name: string
  config: unknown
  reportType: SavedReportType
}

/** A new report is given to the employee who saved it (Linko puts its author in «Пользователи»). */
export async function createOldSavedReport(input: OldSavedReportInput, user: CurrentUser): Promise<OldSavedReport> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("INSERT INTO old_saved_reports (name, config, report_type, view_type, users, positions) VALUES (@name, @config, @reportType, 'user', @users, '[]')")
    .run({ name: input.name, config: JSON.stringify(input.config), reportType: input.reportType, users: JSON.stringify(user.employeeId ? [user.employeeId] : []) })
  const row = (await db.prepare("SELECT id, name, config, report_type, view_type, users, positions FROM old_saved_reports WHERE id = ?").get(Number(result.lastInsertRowid))) as ReportRow
  return rowToReport(row)
}

/** «Изменение таблицы»: the report takes the builder's current settings, the new name and the period kind. */
export async function updateOldSavedReport(id: number, input: OldSavedReportInput): Promise<OldSavedReport | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("UPDATE old_saved_reports SET name = @name, config = @config, report_type = @reportType WHERE id = @id")
    .run({ id, name: input.name, config: JSON.stringify(input.config), reportType: input.reportType })
  if (!result.changes) return null
  const row = (await db.prepare("SELECT id, name, config, report_type, view_type, users, positions FROM old_saved_reports WHERE id = ?").get(id)) as ReportRow
  return rowToReport(row)
}

export async function deleteOldSavedReport(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("DELETE FROM old_saved_reports WHERE id = ?").run(id)
  return result.changes > 0
}

const SHARING_TABLE: Record<SharingKind, string> = { report: "old_saved_reports", static: "old_static_widgets" }

export async function getReportSharing(kind: SharingKind, id: number): Promise<ReportSharing | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare(`SELECT view_type, users, positions FROM ${SHARING_TABLE[kind]} WHERE id = ?`).get(id)) as
    | { view_type: string | null; users: string | null; positions: string | null }
    | undefined
  if (!row) return null
  return { type: row.view_type === "position" ? "position" : "user", users: parseIds(row.users), positions: parseIds(row.positions) }
}

export type SharingOption = { id: number; name: string }

/** The choices of the «Пользователи» dialog: the employees («Пользователи») and the access rights («Права доступа»). */
export async function listSharingOptions(): Promise<{ users: SharingOption[]; positions: SharingOption[] }> {
  const db = getDb()
  const employees = (await db.prepare("SELECT id, first_name, last_name FROM employees ORDER BY id ASC").all()) as Array<{ id: number; first_name: string | null; last_name: string | null }>
  const rights = (await db.prepare("SELECT id, name FROM access_rights ORDER BY id ASC").all().catch(() => [])) as Array<{ id: number; name: string | null }>
  return {
    users: employees.map((row) => ({ id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || `№${row.id}` })),
    positions: rights.map((row) => ({ id: row.id, name: row.name ?? `№${row.id}` })),
  }
}

export async function setReportSharing(kind: SharingKind, id: number, sharing: ReportSharing): Promise<ReportSharing | null> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(`UPDATE ${SHARING_TABLE[kind]} SET view_type = @type, users = @users, positions = @positions WHERE id = @id`)
    .run({ id, type: sharing.type, users: JSON.stringify(sharing.users), positions: JSON.stringify(sharing.positions) })
  return result.changes ? getReportSharing(kind, id) : null
}
