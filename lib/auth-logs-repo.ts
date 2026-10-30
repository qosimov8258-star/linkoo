import "server-only"

import { ensureUserEmployeeLink } from "@/lib/auth-employee"
import type { CurrentUser } from "@/lib/current-user"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { hasPermission } from "@/lib/rbac"

/** Reference `main/auth_log/`: every login of an employee; "active" until it is terminated. */
export type AuthLog = {
  id: number
  ip: string | null
  browser: string
  device: string | null
  createdAt: string
  lastResponseAt: string | null
  isActive: boolean
  user: { id: number; name: string }
  /** The sign-in belongs to the caller's own account. */
  isOwn: boolean
  /** It is the very session the caller uses now. */
  isCurrent: boolean
  /** The caller may end this live sign-in ("Завершить"); the same rule as setAuthLogActive. */
  canEnd: boolean
  /** The caller may bring this ended sign-in back ("Восстановить"); the same rule as setAuthLogActive. */
  canRestore: boolean
}

type Row = {
  id: number
  employee_id: number
  ip: string | null
  browser: string
  device: string | null
  created_at: string
  last_response_at: string | null
  active: boolean
  is_own: boolean
  first_name: string | null
  last_name: string | null
  session_id: string | null
  has_session: boolean
  owner_role: string | null
  restorable: boolean
  session_revoked_at: string | null
  journal_revoked_at: string | null
}

export type AuthLogQuery = {
  tab: "active" | "not_active"
  search: string
  userId: number | null
  createdFrom: string
  createdTo: string
  lastFrom: string
  lastTo: string
  page: number
  pageSize: number
}

/** Permission of the journal's management (lib/capabilities-catalog.ts maps /api/auth-logs to it). */
export const AUTH_LOGS_PERMISSION = "settings.manage"

/** Russian i18n keys of the refusals. */
const NO_RIGHTS = "У вас нет прав на это действие"
const ADMIN_SESSION = "Только администратор может изменить сессию администратора"
const NOT_RESTORABLE = "Эту сессию нельзя восстановить: она завершена самим пользователем, сменой пароля или изменением доступа"
const NO_SESSION = "Сессия не найдена"

/**
 * May see every account's sign-ins (with their addresses and browsers) and end them: an administrator, or a manager whose
 * access right grants settings.manage (the staff settings: Сотрудники, their "Доступ к системе"). Everyone else sees and
 * may end only the sign-ins of their own account. Bringing an ended sign-in back is an administrator's action only.
 */
export function canManageAuthLogs(user: CurrentUser): boolean {
  return user.role === "admin" || (user.role === "manager" && hasPermission(user, AUTH_LOGS_PERMISSION))
}

const DDL = `
  CREATE TABLE IF NOT EXISTS auth_logs (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    ip TEXT,
    browser TEXT NOT NULL DEFAULT '',
    device TEXT,
    created_at TEXT NOT NULL,
    last_response_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    session_id TEXT
  );
  CREATE INDEX IF NOT EXISTS auth_logs_active_idx ON auth_logs (is_active, id);
`

/**
 * How the journal ended a session, so "Восстановить" can bring back only that ending: the session's revoked_at the journal
 * wrote, who ended it, and a fingerprint of the account (password, role, access right, employee link and that employee's
 * state) at that moment.
 */
const JOURNAL_COLUMNS: [string, string][] = [
  ["journal_revoked_at", "TEXT"],
  ["journal_ended_by", "INTEGER"],
  ["journal_account_mark", "TEXT"],
]

declare global {
  // Named after the schema's version: a process that already ran an older install (a dev server's hot reload) still
  // adds the columns of this one.
  var __linkoAuthLogsSchemaV2: Promise<void> | undefined
}

async function createSchema(): Promise<void> {
  const db = getDb()
  await db.exec(DDL)
  // ALTER TABLE locks the table even when the column exists, so it only runs for a missing one.
  const present = (await db
    .prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'auth_logs'")
    .all()) as { column_name: string }[]
  const have = new Set(present.map((row) => row.column_name))
  for (const [name, type] of JOURNAL_COLUMNS) {
    if (!have.has(name)) await db.exec(`ALTER TABLE auth_logs ADD COLUMN IF NOT EXISTS ${name} ${type}`)
  }
}

/** Creates the journal once per process on the maintenance pool (never inside a request's transaction). */
function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoAuthLogsSchemaV2) {
    globalThis.__linkoAuthLogsSchemaV2 = outsideTransaction(createSchema).catch((error: unknown) => {
      globalThis.__linkoAuthLogsSchemaV2 = undefined
      throw error
    })
  }
  return globalThis.__linkoAuthLogsSchemaV2
}

// A sign-in is live while the journal says so and its session (user_sessions, lib/user-sessions-repo.ts) was neither
// ended (logout, password change, "Завершить") nor lost; journal rows without a session keep their own flag.
const ACTIVE_SQL = "(l.is_active = 1 AND (l.session_id IS NULL OR (s.id IS NOT NULL AND s.revoked_at IS NULL)))"
// The caller's own sign-ins: those of a session of the caller's account, and journal rows without a session of the
// employee the account belongs to.
const OWN_SQL = "(s.user_id = @me OR (l.session_id IS NULL AND l.employee_id = @meEmployee))"
const LAST_SQL = "COALESCE(l.last_response_at, s.last_seen_at)"
// `ou` = the account the sign-in belongs to (the session's account, else the account linked to the row's employee),
// `oe` = that account's employee.
const FROM_SQL = `FROM auth_logs l
  LEFT JOIN user_sessions s ON s.id = l.session_id
  LEFT JOIN employees e ON e.id = l.employee_id
  LEFT JOIN users ou ON ou.id = COALESCE(s.user_id, (SELECT u2.id FROM users u2 WHERE u2.employee_id = l.employee_id ORDER BY u2.id LIMIT 1))
  LEFT JOIN employees oe ON oe.id = ou.employee_id`
/** Fingerprint of everything that ends an account's sessions when it changes (lib/users-repo.ts updateUser / deleteUser,
 * app/api/auth/password, lib/employees-repo.ts): a deleted account gives a value no stored mark has. */
const ACCOUNT_MARK_SQL = `md5(concat_ws('|', ou.id::text, COALESCE(ou.password_hash, ''), COALESCE(ou.password_changed_at, ''),
  COALESCE(ou.role, ''), COALESCE(ou.access_right_id::text, ''), COALESCE(ou.must_change_password::text, ''),
  COALESCE(ou.employee_id::text, ''), COALESCE(oe.active::text, ''), COALESCE(oe.system_access::text, ''), COALESCE(oe.updated_at, '')))`
/**
 * "Восстановить" may bring a sign-in back only when nothing but the journal ended it: a row without a session (only the
 * journal's flag), a session that is still live, or a session whose revocation is the journal's own (logout, a password
 * or access change and an account deletion write their own moment) — ended by someone other than the account's owner
 * (the owner's own "Завершить" is a sign-out), the account unchanged since, and its password not changed after the
 * sign-in (a change racing the ending would otherwise slip through the fingerprint).
 */
const RESTORABLE_SQL = `(l.session_id IS NULL OR (s.id IS NOT NULL AND (s.revoked_at IS NULL OR (
  l.journal_revoked_at IS NOT NULL AND s.revoked_at = l.journal_revoked_at
  AND l.journal_ended_by IS DISTINCT FROM s.user_id
  AND l.journal_account_mark = ${ACCOUNT_MARK_SQL}
  AND (ou.password_changed_at IS NULL OR ou.password_changed_at <= s.created_at)))))`
const SELECT_SQL = `SELECT l.id, l.employee_id, l.ip, l.browser, l.device, l.created_at, ${LAST_SQL} AS last_response_at, l.session_id,
  ${ACTIVE_SQL} AS active, ${OWN_SQL} AS is_own, e.first_name, e.last_name, s.id IS NOT NULL AS has_session,
  ou.role AS owner_role, ${RESTORABLE_SQL} AS restorable, s.revoked_at AS session_revoked_at, l.journal_revoked_at`

/** What `viewer` may do with a sign-in (the rule of setAuthLogActive, also sent to the page for its buttons). */
function rightsOf(row: Row, viewer: CurrentUser): { end: boolean; restore: boolean; adminOnly: boolean } {
  if (viewer.role === "viewer" || viewer.mustChangePassword) return { end: false, restore: false, adminOnly: false }
  const adminOnly = row.owner_role === "admin" && viewer.role !== "admin"
  const own = row.is_own === true
  return {
    end: own || (canManageAuthLogs(viewer) && !adminOnly),
    restore: viewer.role === "admin" && row.restorable === true,
    adminOnly,
  }
}

function toAuthLog(row: Row, viewer: CurrentUser): AuthLog {
  const isActive = row.active === true
  const rights = rightsOf(row, viewer)
  return {
    id: row.id,
    ip: row.ip,
    browser: row.browser,
    device: row.device,
    createdAt: row.created_at,
    lastResponseAt: row.last_response_at,
    isActive,
    user: { id: row.employee_id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() },
    isOwn: row.is_own === true,
    isCurrent: Boolean(row.session_id) && row.session_id === viewer.sessionId,
    canEnd: isActive && rights.end,
    canRestore: !isActive && rights.restore,
  }
}

const viewerParams = (viewer: CurrentUser) => ({ me: viewer.id, meEmployee: viewer.employeeId ?? 0 })

/** The journal page; a caller who may not manage the journal (canManageAuthLogs) only gets the own sign-ins. */
export async function listAuthLogs(query: AuthLogQuery, viewer: CurrentUser): Promise<{ count: number; results: AuthLog[]; canManage: boolean }> {
  await ensureSchema()
  await ensureUserEmployeeLink()
  const db = getDb()
  const canManage = canManageAuthLogs(viewer)
  const where = [query.tab === "active" ? ACTIVE_SQL : `NOT ${ACTIVE_SQL}`]
  const params: Record<string, unknown> = viewerParams(viewer)
  if (!canManage) where.push(OWN_SQL)
  if (query.search) {
    where.push("(btrim(concat_ws(' ', e.first_name, e.last_name)) ILIKE @search OR l.ip ILIKE @search)")
    params.search = `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  }
  if (query.userId) {
    where.push("l.employee_id = @userId")
    params.userId = query.userId
  }
  if (query.createdFrom) {
    where.push("substr(l.created_at, 1, 10) >= @createdFrom")
    params.createdFrom = query.createdFrom
  }
  if (query.createdTo) {
    where.push("substr(l.created_at, 1, 10) <= @createdTo")
    params.createdTo = query.createdTo
  }
  if (query.lastFrom) {
    where.push(`substr(${LAST_SQL}, 1, 10) >= @lastFrom`)
    params.lastFrom = query.lastFrom
  }
  if (query.lastTo) {
    where.push(`substr(${LAST_SQL}, 1, 10) <= @lastTo`)
    params.lastTo = query.lastTo
  }
  const from = `${FROM_SQL} WHERE ${where.join(" AND ")}`
  // The db shim binds an object only to SQL that names a parameter (a filterless count names none).
  const countSql = `SELECT count(*)::int AS n ${from}`
  const total = (await db.prepare(countSql).get(...(/@[A-Za-z_]/.test(countSql) ? [params] : []))) as { n: number }
  const rows = (await db
    .prepare(`${SELECT_SQL} ${from} ORDER BY l.id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: total.n, results: rows.map((row) => toAuthLog(row, viewer)), canManage }
}

/** The employee of an app login: the account's own link (users.employee_id, lib/auth-employee.ts), else the employee
 * whose login is the account's username. */
async function employeeIdForLogin(username: string): Promise<number | null> {
  await ensureUserEmployeeLink()
  const row = (await getDb()
    .prepare(
      `SELECT COALESCE(
         (SELECT u.employee_id FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.username = @username LIMIT 1),
         (SELECT e.id FROM employees e WHERE e.login = @username ORDER BY e.id LIMIT 1)
       ) AS id`,
    )
    .get({ username })) as { id: number | null } | undefined
  return row?.id ?? null
}

export async function recordAuthLog(input: { sessionId: string; username: string; ip: string; userAgent: string }): Promise<void> {
  await ensureSchema()
  const employeeId = await employeeIdForLogin(input.username)
  if (!employeeId) return
  await getDb()
    .prepare(
      "INSERT INTO auth_logs (employee_id, ip, browser, created_at, session_id) VALUES (@employeeId, @ip, @browser, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), @sessionId)",
    )
    .run({ employeeId, ip: input.ip || null, browser: input.userAgent, sessionId: input.sessionId })
}

/** A refused change of the journal (403 / 404 / 409 with a Russian i18n key). */
export class AuthLogError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "AuthLogError"
  }
}

/**
 * Locks the journal row, then holds the account it belongs to and that account's employee still (FOR SHARE) until the
 * transaction ends: a password, role or access change either commits first (and is seen in the fingerprint) or waits, and
 * its own "end every session" then also ends a sign-in restored here. Returns false for an unknown id.
 */
async function lockTarget(tx: PgDb, id: number): Promise<boolean> {
  const head = (await tx
    .prepare(
      `SELECT l.id, COALESCE(s.user_id, (SELECT u.id FROM users u WHERE u.employee_id = l.employee_id ORDER BY u.id LIMIT 1)) AS owner_id
         FROM auth_logs l LEFT JOIN user_sessions s ON s.id = l.session_id
        WHERE l.id = ?
        FOR UPDATE OF l`,
    )
    .get(id)) as { id: number; owner_id: number | null } | undefined
  if (!head) return false
  if (head.owner_id) {
    const owner = (await tx.prepare("SELECT employee_id FROM users WHERE id = ? FOR SHARE").get(head.owner_id)) as { employee_id: number | null } | undefined
    if (owner?.employee_id) await tx.prepare("SELECT id FROM employees WHERE id = ? FOR SHARE").get(owner.employee_id)
  }
  return true
}

async function readRow(tx: PgDb, id: number, actor: CurrentUser): Promise<Row> {
  return (await tx.prepare(`${SELECT_SQL} ${FROM_SQL} WHERE l.id = @id`).get({ ...viewerParams(actor), id })) as Row
}

/**
 * "Завершить" (active = false) / "Восстановить" (active = true). A log tied to a live login also revokes / restores that
 * login. Anyone may end a sign-in of their own account; ending another account's sign-in needs canManageAuthLogs, and a
 * sign-in of an administrator's account only an administrator may end. Only an administrator restores, and only what the
 * journal itself ended (RESTORABLE_SQL; otherwise 409). Returns null for an unknown id; `endedCurrent` = the caller ended
 * the session they use now.
 */
export async function setAuthLogActive(id: number, active: boolean, actor: CurrentUser): Promise<{ log: AuthLog; endedCurrent: boolean } | null> {
  await ensureSchema()
  await ensureUserEmployeeLink()
  return withTransaction(async (tx) => {
    if (!(await lockTarget(tx, id))) return null
    const row = await readRow(tx, id, actor)
    const rights = rightsOf(row, actor)
    if (!active) {
      if (!rights.end) throw new AuthLogError(rights.adminOnly && canManageAuthLogs(actor) ? ADMIN_SESSION : NO_RIGHTS, 403)
      await tx.prepare("UPDATE auth_logs SET is_active = 0 WHERE id = ?").run(id)
      if (row.session_id) {
        const ended = (await tx
          .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL RETURNING revoked_at")
          .get(row.session_id)) as { revoked_at: string } | undefined
        // Only an ending of the journal's own is remembered: a session already ended elsewhere keeps that reason.
        if (ended) {
          await tx
            .prepare(
              `UPDATE auth_logs SET journal_revoked_at = @at, journal_ended_by = @actor,
                      journal_account_mark = (SELECT ${ACCOUNT_MARK_SQL} ${FROM_SQL} WHERE l.id = @id)
                WHERE id = @id`,
            )
            .run({ id, at: ended.revoked_at, actor: actor.id })
        }
      }
    } else {
      if (!rights.restore) {
        if (actor.role !== "admin" || actor.mustChangePassword) throw new AuthLogError(NO_RIGHTS, 403)
        // A sign-in whose session row is gone cannot be brought back (its token is refused anyway).
        if (row.session_id && !row.has_session) throw new AuthLogError(NO_SESSION, 404)
        throw new AuthLogError(NOT_RESTORABLE, 409)
      }
      // RESTORABLE_SQL: an ended session here carries the journal's own moment, and nothing else can change it meanwhile
      // (every other revocation only touches live sessions).
      if (row.session_id && row.session_revoked_at !== null) {
        const restored = await tx
          .prepare("UPDATE user_sessions SET revoked_at = NULL WHERE id = ? AND revoked_at = ?")
          .run(row.session_id, row.journal_revoked_at)
        if (restored.changes === 0) throw new AuthLogError(NOT_RESTORABLE, 409)
      }
      await tx
        .prepare("UPDATE auth_logs SET is_active = 1, journal_revoked_at = NULL, journal_ended_by = NULL, journal_account_mark = NULL WHERE id = ?")
        .run(id)
    }
    const log = toAuthLog(await readRow(tx, id, actor), actor)
    return { log, endedCurrent: !active && log.isCurrent }
  })
}
