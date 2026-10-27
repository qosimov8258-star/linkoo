import "server-only"

import { accountOfEmployee, ensureUserEmployeeLink, lockAccessChanges, otherAdminsWithAccess, revokeEmployeeSessions } from "@/lib/auth-employee"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import {
  cascadeNameRename,
  existingReferences,
  keySql,
  nameKey,
  quoteIdent,
  usageOf,
  type Usage,
} from "@/lib/platform-refs"
import type { Employee } from "@/components/analytics/employees-data"
import type { Role } from "@/lib/session"

type Row = {
  id: number
  first_name: string
  last_name: string
  /** Login of the linked sign-in account (users.employee_id), or null. */
  user_login?: string | null
  phone: string
  integration_code: string
  position: string
  branch: string
  system_access: number
  show_in_tracking: number
  two_step_check: number
  session_limit: number
  gps_check: number
  start_point: number
  organizations: string
  active: number
}

/** Stored organizations (a JSON array of names; anything else reads as none). */
function parseOrganizations(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToEmployee(row: Row): Employee {
  const organizations = parseOrganizations(row.organizations)
  return {
    id: row.id,
    name: fullName(row),
    // The real login of the account linked in Права доступа → Пользователи
    // (empty while none is): employees.login only ever held a generated name
    // no account carried.
    login: row.user_login ?? "",
    role: row.position,
    phone: row.phone,
    position: row.position,
    active: row.active === 1,
    firstName: row.first_name,
    lastName: row.last_name,
    integrationCode: row.integration_code,
    branch: row.branch,
    systemAccess: row.system_access === 1,
    showInTracking: row.show_in_tracking === 1,
    twoStepCheck: row.two_step_check === 1,
    sessionLimit: row.session_limit === 1,
    gpsCheck: row.gps_check === 1,
    startPoint: row.start_point === 1,
    organizations,
  }
}

/** "First Last" — the form documents store the employee under. */
function fullName(row: { first_name: string; last_name: string }): string {
  return `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim()
}

export type EmployeeInput = {
  firstName: string
  lastName: string
  phone: string
  integrationCode: string
  position: string
  branch: string
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  organizations: string[]
  active: boolean
}

export type EmployeeUsage = Usage

/** Validation / conflict errors with the HTTP status the routes answer. */
export class EmployeeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: EmployeeUsage[],
  ) {
    super(message)
  }
}

// --- references -----------------------------------------------------------------
// By id (block a delete; the companion name column, if any, follows a rename):
const ID_REFERENCES: ReadonlyArray<{ table: string; column: string; nameColumn?: string }> = [
  { table: "cashboxes", column: "cashier_id", nameColumn: "cashier" },
  { table: "warehouses", column: "manager_id", nameColumn: "manager" },
  { table: "contracts", column: "agent_id", nameColumn: "agent" },
  { table: "cash_acceptances", column: "agent_id", nameColumn: "agent" },
  { table: "cash_management_entries", column: "employee_id", nameColumn: "employee_name" },
  { table: "production_staff", column: "employee_id", nameColumn: "employee_name" },
  { table: "production_stages", column: "responsible_id", nameColumn: "responsible" },
  { table: "cash_entry_staff", column: "employee_id" },
  { table: "employee_balance_transactions", column: "employee_id" },
  { table: "deliverer_balance_transactions", column: "employee_id" },
  { table: "vansell_transactions", column: "employee_id" },
  { table: "vansell_debt_limits", column: "employee_id" },
  // Tasks link their responsible employee by id; older name-only tasks are in NAME_REFERENCES.
  { table: "tasks", column: "employee_id", nameColumn: "responsible" },
  // Field activity of the mobile app (visits, refusals, photo reports, GPS track, route plans).
  { table: "field_visits", column: "employee_id" },
  { table: "field_refusals", column: "employee_id" },
  { table: "field_photo_reports", column: "employee_id" },
  { table: "field_gps_points", column: "employee_id" },
  { table: "field_route_plans", column: "employee_id" },
  // Check-ins and manual attendance days (attendance_auto_days is derived data, not a reference).
  { table: "attendance_check_ins", column: "employee_id" },
  { table: "attendance_days", column: "employee_id" },
  // Ограничение продуктов: the employee's product / product type lists (the FK would cascade
  // them away silently).
  { table: "product_restrictions", column: "employee_id" },
  { table: "product_type_restrictions", column: "employee_id" },
]

// By "First Last" name only (block a delete while the name is unambiguous; renamed by key):
const NAME_REFERENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "clients", column: "agent" },
  { table: "clients", column: "zone_agent" },
  { table: "clients", column: "deliverer" },
  { table: "clients", column: "collector" },
  { table: "orders", column: "agent" },
  { table: "customer_payments", column: "agent" },
  { table: "salary_plans", column: "employee" },
  { table: "debt_limits", column: "agent" },
  { table: "debt_limits", column: "collector" },
  { table: "debt_limits", column: "courier" },
  { table: "agent_routes", column: "agent" },
  { table: "financial_accounts", column: "agent" },
  { table: "product_limits", column: "agent" },
  { table: "survey_plans", column: "employee" },
  { table: "tasks", column: "responsible" },
  { table: "inventory_items", column: "responsible" },
  { table: "production_stages", column: "responsible" },
  { table: "production_movements", column: "worker" },
  { table: "internal_transfers", column: "driver" },
  { table: "transport_vehicles", column: "driver" },
]

async function employeeReferences(db: PgDb) {
  const idRefs = await existingReferences(
    db,
    ID_REFERENCES.map((ref) => ({ table: ref.table, column: ref.column, kind: "id" as const })),
  )
  const companions = await existingReferences(
    db,
    ID_REFERENCES.filter((ref) => ref.nameColumn).map((ref) => ({ table: ref.table, column: ref.nameColumn!, kind: "name" as const })),
  )
  const nameRefs = await existingReferences(
    db,
    NAME_REFERENCES.map((ref) => ({ ...ref, kind: "name" as const })),
  )
  return { idRefs, companions, nameRefs }
}

/** True when another employee has the same "First Last" name (names then say nothing). */
async function nameIsShared(db: PgDb, id: number, name: string): Promise<boolean> {
  if (!nameKey(name)) return true
  const twin = await db
    .prepare(
      `SELECT 1 FROM employees WHERE id <> @id
          AND ${keySql("btrim(coalesce(first_name, '')) || ' ' || btrim(coalesce(last_name, ''))")} = ${keySql("@name::text")} LIMIT 1`,
    )
    .get({ id, name })
  return Boolean(twin)
}

/** Where the employee is referenced (cashboxes, warehouses, clients, documents …). */
export async function employeeUsage(db: PgDb, row: Row): Promise<EmployeeUsage[]> {
  const { idRefs, nameRefs } = await employeeReferences(db)
  const name = fullName(row)
  const skipNames = await nameIsShared(db, row.id, name)
  return usageOf(db, [...idRefs, ...nameRefs], { id: row.id, name, skipNames })
}

/** Carries a rename into every record that stores the employee's name. */
async function cascadeEmployeeRename(db: PgDb, id: number, oldName: string, newName: string) {
  if (oldName === newName) return
  const { companions, nameRefs } = await employeeReferences(db)
  const shared = await nameIsShared(db, id, oldName)
  for (const ref of companions) {
    const idColumn = ID_REFERENCES.find((known) => known.table === ref.table && known.nameColumn === ref.column)!.column
    const name = quoteIdent(ref.column)
    // Rows linked by id always follow; legacy rows without the id only while the old name is unambiguous.
    const byLegacyName = shared ? "" : ` OR (${quoteIdent(idColumn)} IS NULL AND ${keySql(name)} = ${keySql("@oldName::text")})`
    await db
      .prepare(
        `UPDATE ${quoteIdent(ref.table)} SET ${name} = @newName
          WHERE (${quoteIdent(idColumn)} = @id${byLegacyName}) AND ${name} IS DISTINCT FROM @newName`,
      )
      .run({ id, oldName, newName })
  }
  if (!shared) await cascadeNameRename(db, nameRefs, oldName, newName)
}

// --- branch / position must exist ----------------------------------------------------
async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(?) IS NOT NULL AS ok").get(table)) as { ok: boolean }
  return row.ok
}

/** The canonical spelling of an existing branch / job position, or an error. */
async function resolveName(db: PgDb, table: "branches" | "job_positions", value: string, notFound: string): Promise<string> {
  const name = value.trim()
  if (!name) return ""
  if (await tableExists(db, table)) {
    const row = (await db
      .prepare(`SELECT name FROM ${table} WHERE ${keySql("name")} = ${keySql("?::text")} ORDER BY id LIMIT 1`)
      .get(name)) as { name: string } | undefined
    if (row) return row.name
  }
  throw new EmployeeError(`${notFound}: ${name}`, 400)
}

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

/** Организации must be organizations of the directory (case- and space-insensitive,
 * stored in their own spelling, each once). On an update the organizations the
 * employee already has are kept as they are (renamed or removed since). */
async function resolveOrganizations(db: PgDb, values: string[], current?: Row): Promise<string[]> {
  const stored = new Map(parseOrganizations(current?.organizations).map((name) => [nameKey(name), name]))
  const hasTable = await tableExists(db, "organizations")
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const name = value.trim()
    const key = nameKey(name)
    if (NOT_SET.has(key) || seen.has(key)) continue
    let resolved = stored.get(key)
    if (resolved === undefined) {
      const row = hasTable
        ? ((await db.prepare(`SELECT name FROM organizations WHERE ${keySql("name")} = ${keySql("?::text")} ORDER BY id LIMIT 1`).get(name)) as { name: string } | undefined)
        : undefined
      if (!row) throw new EmployeeError(`Организация не найдена: ${name}`, 400)
      resolved = row.name
    }
    seen.add(key)
    if (out.some((item) => nameKey(item) === nameKey(resolved!))) continue
    out.push(resolved)
  }
  return out
}

/** Branch and position must be an existing Филиал / Должность (case-insensitive,
 * stored in their canonical spelling), organizations existing Организации. On an
 * update an unchanged legacy value is kept, so old records stay editable. */
async function resolveInput(db: PgDb, input: EmployeeInput, current?: Row): Promise<EmployeeInput> {
  const keep = (value: string, old: string | undefined) => old !== undefined && nameKey(value) === nameKey(old)
  const branch = keep(input.branch, current?.branch) ? current!.branch : await resolveName(db, "branches", input.branch, "Филиал не найден")
  const position = keep(input.position, current?.position)
    ? current!.position
    : await resolveName(db, "job_positions", input.position, "Должность не найдена")
  const organizations = await resolveOrganizations(db, input.organizations, current)
  return { ...input, branch, position, organizations }
}

// --- reads ----------------------------------------------------------------------------
const SELECT_EMPLOYEES = `SELECT e.*, (SELECT u.username FROM users u WHERE u.employee_id = e.id ORDER BY u.id LIMIT 1) AS user_login
    FROM employees e`

export async function listEmployees(): Promise<Employee[]> {
  await ensureUserEmployeeLink()
  const db = getDb()
  const rows = (await db.prepare(`${SELECT_EMPLOYEES} ORDER BY e.id DESC`).all()) as Row[]
  return rows.map(rowToEmployee)
}

export async function getEmployee(id: number): Promise<Employee | null> {
  await ensureUserEmployeeLink()
  const db = getDb()
  const row = (await db.prepare(`${SELECT_EMPLOYEES} WHERE e.id = ?`).get(id)) as Row | undefined
  return row ? rowToEmployee(row) : null
}

function toParams(input: EmployeeInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    integrationCode: input.integrationCode,
    position: input.position,
    branch: input.branch,
    systemAccess: input.systemAccess ? 1 : 0,
    showInTracking: input.showInTracking ? 1 : 0,
    twoStepCheck: input.twoStepCheck ? 1 : 0,
    sessionLimit: input.sessionLimit ? 1 : 0,
    gpsCheck: input.gpsCheck ? 1 : 0,
    startPoint: input.startPoint ? 1 : 0,
    organizations: JSON.stringify(input.organizations),
    active: input.active ? 1 : 0,
  }
}

// --- writes ---------------------------------------------------------------------------
export async function createEmployee(raw: EmployeeInput): Promise<Employee> {
  const id = await withTransaction(async (tx) => {
    const input = await resolveInput(tx, raw)
    const result = await tx
      .prepare(
        `INSERT INTO employees (
          first_name, last_name, login, phone, integration_code, position, branch, system_access, show_in_tracking,
          two_step_check, session_limit, gps_check, start_point, organizations, active
        ) VALUES (
          @firstName, @lastName, '', @phone, @integrationCode, @position, @branch, @systemAccess, @showInTracking,
          @twoStepCheck, @sessionLimit, @gpsCheck, @startPoint, @organizations, @active
        )`,
      )
      .run(toParams(input))
    return Number(result.lastInsertRowid)
  })
  return (await getEmployee(id))!
}

/** Who makes the change (the signed-in user). */
export type EmployeeActor = { id: number; role: Role }

/** Turning "Доступ к системе" off or deactivating the employee ends the linked
 * account's sign-in, so it must not lock out the person making the change, an
 * administrator (unless an administrator does it) or the last administrator. */
async function assertMayEndAccess(tx: PgDb, employeeId: number, actor: EmployeeActor | undefined) {
  const account = await accountOfEmployee(tx, employeeId)
  if (!account) return
  if (actor && account.id === actor.id) throw new EmployeeError("Нельзя отключить доступ к системе самому себе", 400)
  if (account.role === "admin") {
    if (actor && actor.role !== "admin") throw new EmployeeError("Только администратор может отключить доступ администратора", 403)
    if ((await otherAdminsWithAccess(tx, account.id)) === 0) throw new EmployeeError("Нельзя отключить доступ последнему администратору", 409)
  }
}

/** Updates the employee; a changed name is carried into every record that
 * stores it (cashboxes, warehouses, clients' agent / deliverer / collector,
 * orders, payments, contracts, production staff …) in the same transaction.
 * Deactivating the employee or turning "Доступ к системе" off blocks the
 * linked account's sign-in and ends its sessions. */
export async function updateEmployee(id: number, raw: EmployeeInput, actor?: EmployeeActor): Promise<Employee | null> {
  await ensureUserEmployeeLink()
  let endsAccess = false
  const found = await withTransaction(async (tx) => {
    // A change that may end the linked account's sign-in is serialised with
    // the other such changes before its guards run (lib/auth-employee.ts).
    if (!(raw.active && raw.systemAccess)) await lockAccessChanges(tx)
    const current = (await tx.prepare("SELECT * FROM employees WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    const hadAccess = Number(current.active) === 1 && Number(current.system_access) === 1
    endsAccess = hadAccess && !(raw.active && raw.systemAccess)
    if (endsAccess) await assertMayEndAccess(tx, id, actor)
    const input = await resolveInput(tx, raw, current)
    await tx
      .prepare(
        `UPDATE employees SET
          first_name = @firstName, last_name = @lastName, phone = @phone, integration_code = @integrationCode,
          position = @position, branch = @branch, system_access = @systemAccess, show_in_tracking = @showInTracking,
          two_step_check = @twoStepCheck, session_limit = @sessionLimit, gps_check = @gpsCheck, start_point = @startPoint,
          organizations = @organizations, active = @active, updated_at = datetime('now')
        WHERE id = @id`,
      )
      .run({ ...toParams(input), id })
    const oldName = fullName(current)
    const newName = fullName({ first_name: input.firstName, last_name: input.lastName })
    await cascadeEmployeeRename(tx, id, oldName, newName)
    return true
  })
  if (!found) return null
  if (endsAccess) await revokeEmployeeSessions(id)
  return getEmployee(id)
}

/** Deletes the employee — refused (409 with the usage list) while a cashbox,
 * warehouse, client, document or production record refers to them; such an
 * employee can be deactivated (active = false) instead. */
export async function deleteEmployee(id: number): Promise<boolean> {
  await ensureUserEmployeeLink()
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT * FROM employees WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    const usage = await employeeUsage(tx, current)
    // A sign-in account linked to the employee (Права доступа → Пользователи).
    const accounts = (await tx.prepare("SELECT COUNT(*)::int AS n FROM users WHERE employee_id = ?").get(id)) as { n: number }
    if (Number(accounts.n) > 0) usage.push({ table: "users", label: "Пользователи", count: Number(accounts.n) })
    if (usage.length) throw new EmployeeError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM employees WHERE id = ?").run(id)).changes > 0
  })
}

