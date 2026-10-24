import "server-only"

import { getDb } from "@/lib/db"

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
}

type Row = {
  id: number
  employee_id: number
  ip: string | null
  browser: string
  device: string | null
  created_at: string
  last_response_at: string | null
  is_active: number
  first_name: string | null
  last_name: string | null
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

let schemaReady: Promise<void> | null = null
function ensureSchema() {
  schemaReady ??= getDb().exec(DDL).catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}

function toAuthLog(row: Row): AuthLog {
  return {
    id: row.id,
    ip: row.ip,
    browser: row.browser,
    device: row.device,
    createdAt: row.created_at,
    lastResponseAt: row.last_response_at,
    isActive: row.is_active === 1,
    user: { id: row.employee_id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() },
  }
}

export async function listAuthLogs(query: AuthLogQuery): Promise<{ count: number; results: AuthLog[] }> {
  await ensureSchema()
  const db = getDb()
  const where = ["l.is_active = @active"]
  const params: Record<string, unknown> = { active: query.tab === "active" ? 1 : 0 }
  if (query.search) {
    where.push("(btrim(concat_ws(' ', e.first_name, e.last_name)) ILIKE @search OR l.ip ILIKE @search)")
    params.search = `%${query.search}%`
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
    where.push("substr(l.last_response_at, 1, 10) >= @lastFrom")
    params.lastFrom = query.lastFrom
  }
  if (query.lastTo) {
    where.push("substr(l.last_response_at, 1, 10) <= @lastTo")
    params.lastTo = query.lastTo
  }
  const from = `FROM auth_logs l LEFT JOIN employees e ON e.id = l.employee_id WHERE ${where.join(" AND ")}`
  const total = (await db.prepare(`SELECT count(*)::int AS n ${from}`).get(params)) as { n: number }
  const rows = (await db
    .prepare(
      `SELECT l.*, e.first_name, e.last_name ${from} ORDER BY l.id ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: total.n, results: rows.map(toAuthLog) }
}

/** The employee that belongs to an app login (users.username = employees.login). */
async function employeeIdForLogin(username: string): Promise<number | null> {
  const row = (await getDb().prepare("SELECT id FROM employees WHERE login = ? ORDER BY id LIMIT 1").get(username)) as { id: number } | undefined
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

/** "Завершить" (active = false) / "Восстановить" (active = true). A log tied to a live login also revokes / restores that login. */
export async function setAuthLogActive(id: number, active: boolean): Promise<AuthLog | null> {
  await ensureSchema()
  const db = getDb()
  const row = (await db.prepare("SELECT id, session_id FROM auth_logs WHERE id = ?").get(id)) as { id: number; session_id: string | null } | undefined
  if (!row) return null
  await db.prepare("UPDATE auth_logs SET is_active = @active WHERE id = @id").run({ id, active: active ? 1 : 0 })
  if (row.session_id) {
    await db.exec("CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT)")
    await db
      .prepare(active ? "UPDATE user_sessions SET revoked_at = NULL WHERE id = ?" : "UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
      .run(row.session_id)
  }
  const result = (await db
    .prepare("SELECT l.*, e.first_name, e.last_name FROM auth_logs l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = ?")
    .get(id)) as Row
  return toAuthLog(result)
}
