import "server-only"

import { accountOfEmployee, ensureUserEmployeeLink, lockAccessChanges, otherAdminsWithAccess, revokeEmployeeSessions } from "@/lib/auth-employee"
import { hashPassword } from "@/lib/auth"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import {
  cascadeNameRename,
  existingReferences,
  keySql,
  nameKey,
  quoteIdent,
  usageOf,
  type Usage,
} from "@/lib/platform-refs"
import { selectedBranchName } from "@/lib/selected-branch"
import type { Role } from "@/lib/session"
import { detachSubscriptions } from "@/lib/subscriptions-repo"
import type { Employee, EmployeeInput } from "@/components/analytics/employees-data"

// Сотрудники. References are ids resolved against their own tables (branches, organizations,
// job position, access right, supervisor / delivery man). A sign-in account (users) may be linked
// to an employee through users.employee_id (lib/auth-employee.ts): the employee then decides
// whether the account may sign in, so deactivating the employee or turning "Доступ к системе" off
// is guarded (not oneself, an administrator only by an administrator, never the last one) and
// ends the account's sessions. A rename is carried into every record that stores the name.

type Row = {
  id: number
  first_name: string
  last_name: string
  /** Login typed in the employee form ("" while "Доступ к системе" is off). */
  login: string
  /** Login of the linked sign-in account (users.employee_id), or null. */
  user_login?: string | null
  phone: string
  integration_code: string
  position: string
  system_access: number
  show_in_tracking: number
  two_step_check: number
  session_limit: number
  gps_check: number
  start_point: number
  active: number
  access_right_id: number | null
  job_id: number | null
  branch_ids: string
  organization_ids: string
  details: string
  access_right_name: string | null
  job_name: string | null
}

type Details = Partial<{
  supervisorId: number | null
  deliveryManId: number | null
  auditAgentIds: number[]
  stockIds: number[]
  requestStockIds: number[]
  priceListIds: number[]
  marketPriceListIds: number[]
  currencyIds: number[]
  locationPointIds: number[]
  cashboxIds: number[]
  requestCashboxIds: number[]
  accesses: Array<{ name: string }>
}>

const SELECT = `
  SELECT e.*, ar.name AS access_right_name, jp.name AS job_name,
         (SELECT u.username FROM users u WHERE u.employee_id = e.id ORDER BY u.id LIMIT 1) AS user_login
  FROM employees e
  LEFT JOIN access_rights ar ON ar.id = e.access_right_id
  LEFT JOIN job_positions jp ON jp.id = e.job_id`

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (JSON.parse(text || "null") as T | null) ?? fallback
  } catch {
    return fallback
  }
}

/** The lazy columns of employees (lib/employees-schema.ts) and users.employee_id, prepared outside any
 * request transaction (DDL never runs inside one). Called before a transaction is opened. */
async function ensureSchema(): Promise<void> {
  await ensureUserEmployeeLink()
  await outsideTransaction(() => ensureEmployeesSchema())
}

function rowToEmployee(row: Row): Employee {
  const details = parse<Details>(row.details, {})
  const accessRight = row.access_right_name ?? ""
  const job = row.job_name ?? ""
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: fullName(row),
    // The login of the account linked in Права доступа → Пользователи (the one that really signs in);
    // otherwise the login typed in the employee form.
    login: row.user_login || row.login || "",
    phone: row.phone,
    integrationCode: row.integration_code,
    accessRightId: row.access_right_id,
    accessRight,
    jobId: row.job_id,
    job,
    active: row.active === 1,
    systemAccess: row.system_access === 1,
    showInTracking: row.show_in_tracking === 1,
    twoStepCheck: row.two_step_check === 1,
    sessionLimit: row.session_limit === 1,
    gpsCheck: row.gps_check === 1,
    startPoint: row.start_point === 1,
    branchIds: parse<number[]>(row.branch_ids, []),
    organizationIds: parse<number[]>(row.organization_ids, []),
    supervisorId: details.supervisorId ?? null,
    deliveryManId: details.deliveryManId ?? null,
    auditAgentIds: details.auditAgentIds ?? [],
    stockIds: details.stockIds ?? [],
    requestStockIds: details.requestStockIds ?? [],
    priceListIds: details.priceListIds ?? [],
    marketPriceListIds: details.marketPriceListIds ?? [],
    currencyIds: details.currencyIds ?? [],
    locationPointIds: details.locationPointIds ?? [],
    cashboxIds: details.cashboxIds ?? [],
    requestCashboxIds: details.requestCashboxIds ?? [],
    accesses: (details.accesses ?? []).map((item) => item.name),
    position: accessRight || job ? `${accessRight}|${job}` : "",
  }
}

/** "First Last" — the form documents store the employee under. */
function fullName(row: { first_name: string; last_name: string }): string {
  return `${(row.first_name ?? "").trim()} ${(row.last_name ?? "").trim()}`.trim()
}

export type EmployeeUsage = Usage

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

/** Thrown when a record still refers to the employee (409 with the usage list). */
export class EmployeeInUseError extends Error {
  readonly status = 409
  constructor(readonly usage: EmployeeUsage[]) {
    super("Удаление невозможно из-за связи с другими данными")
  }
}

/** A change refused because it would end a sign-in that must stay (the routes answer `status`). */
export class EmployeeAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Who makes the change (the signed-in user). */
export type EmployeeActor = { id: number; role: Role }

/** Turning "Доступ к системе" off or deactivating the employee ends the linked
 * account's sign-in, so it must not lock out the person making the change, an
 * administrator (unless an administrator does it) or the last administrator. */
async function assertMayEndAccess(tx: PgDb, employeeId: number, actor: EmployeeActor | undefined) {
  const account = await accountOfEmployee(tx, employeeId)
  if (!account) return
  if (actor && account.id === actor.id) throw new EmployeeAccessError("Нельзя отключить доступ к системе самому себе", 400)
  if (account.role === "admin") {
    if (actor && actor.role !== "admin") throw new EmployeeAccessError("Только администратор может отключить доступ администратора", 403)
    if ((await otherAdminsWithAccess(tx, account.id)) === 0) throw new EmployeeAccessError("Нельзя отключить доступ последнему администратору", 409)
  }
}

/** Serialises the logins typed in the employee form, so two parallel saves cannot both take one. */
async function lockLogins(tx: PgDb) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('employees:login'))").get()
}

// --- reads ----------------------------------------------------------------------------
export async function listEmployees(): Promise<Employee[]> {
  await ensureSchema()
  const branch = await selectedBranchName()
  // The branch picked in the account menu: the employee's main branch or any of its branches.
  const rows = (await getDb()
    .prepare(
      `${SELECT}
        WHERE (@branch::text = '' OR e.branch = @branch OR EXISTS (
                SELECT 1 FROM branches b
                 WHERE b.name = @branch
                   AND (CASE WHEN e.branch_ids ~ '^\\[[0-9, ]*\\]$' THEN e.branch_ids::jsonb ELSE '[]'::jsonb END) @> jsonb_build_array(b.id)))
        ORDER BY e.id ASC`,
    )
    .all({ branch })) as Row[]
  return rows.map(rowToEmployee)
}

export async function getEmployee(id: number): Promise<Employee | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`${SELECT} WHERE e.id = ?`).get(id)) as Row | undefined
  return row ? rowToEmployee(row) : null
}

export type EmployeeError =
  | "login_taken"
  | "bad_branch"
  | "bad_organization"
  | "bad_job"
  | "bad_access_right"
  | "bad_supervisor"
  | "no_license"

async function branchNames(db: PgDb, ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = (await db.prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(rows.map((row) => [row.id, row.name]))
  return ids.map((id) => byId.get(id) ?? "")
}

async function organizationNames(db: PgDb, ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = (await db.prepare("SELECT id, name FROM organizations WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(rows.map((row) => [row.id, row.name]))
  return ids.map((id) => byId.get(id) ?? "")
}

/** Validates the references of an input; returns the matching error or null. A login must be
 * free among the employees and among the sign-in accounts (other than the employee's own linked
 * account); an unchanged stored login is kept as it is. */
async function checkReferences(db: PgDb, input: EmployeeInput, current: Row | null): Promise<EmployeeError | null> {
  const selfId = current?.id ?? 0
  const branches = (await db.prepare("SELECT count(*)::int AS n FROM branches WHERE id = ANY(@ids::int[])").get({ ids: input.branchIds })) as { n: number }
  if (Number(branches.n) !== new Set(input.branchIds).size) return "bad_branch"
  if (input.organizationIds.length) {
    const organizations = (await db
      .prepare("SELECT count(*)::int AS n FROM organizations WHERE id = ANY(@ids::int[])")
      .get({ ids: input.organizationIds })) as { n: number }
    if (Number(organizations.n) !== new Set(input.organizationIds).size) return "bad_organization"
  }
  if (!(await db.prepare("SELECT 1 FROM job_positions WHERE id = ?").get(input.jobId))) return "bad_job"
  if (input.accessRightId && !(await db.prepare("SELECT 1 FROM access_rights WHERE id = ?").get(input.accessRightId))) return "bad_access_right"
  for (const id of [input.supervisorId, input.deliveryManId]) {
    if (id && !(await db.prepare("SELECT 1 FROM employees WHERE id = ?").get(id))) return "bad_supervisor"
  }
  const login = input.systemAccess ? input.login.trim() : ""
  if (login) {
    const taken = await db.prepare("SELECT id FROM employees WHERE lower(login) = lower(@login) AND id <> @id").get({ login, id: selfId })
    if (taken) return "login_taken"
    const unchanged = current !== null && (current.login ?? "").trim().toLowerCase() === login.toLowerCase()
    if (!unchanged) {
      const account = await db
        .prepare("SELECT id FROM users WHERE lower(username) = lower(@login) AND employee_id IS DISTINCT FROM @id")
        .get({ login, id: selfId })
      if (account) return "login_taken"
    }
  }
  return null
}

function toDetails(input: EmployeeInput, previous: Details): Details {
  return {
    ...previous,
    supervisorId: input.supervisorId,
    deliveryManId: input.deliveryManId,
    auditAgentIds: input.auditAgentIds,
    stockIds: input.stockIds,
    requestStockIds: input.requestStockIds,
    priceListIds: input.priceListIds,
    marketPriceListIds: input.marketPriceListIds,
    currencyIds: input.currencyIds,
    locationPointIds: input.locationPointIds,
    cashboxIds: input.cashboxIds ?? previous.cashboxIds ?? [],
    requestCashboxIds: input.requestCashboxIds ?? previous.requestCashboxIds ?? [],
  }
}

/** The name columns other pages read: the main (first) branch, the organizations and "access|job". */
async function composedFields(db: PgDb, input: EmployeeInput) {
  const branches = await branchNames(db, input.branchIds)
  const organizations = await organizationNames(db, input.organizationIds)
  const access = input.accessRightId
    ? ((await db.prepare("SELECT name FROM access_rights WHERE id = ?").get(input.accessRightId)) as { name: string } | undefined)
    : undefined
  const job = (await db.prepare("SELECT name FROM job_positions WHERE id = ?").get(input.jobId)) as { name: string } | undefined
  return { branch: branches[0] ?? "", organizations, position: `${access?.name ?? ""}|${job?.name ?? ""}` }
}

function fieldParams(input: EmployeeInput, composed: Awaited<ReturnType<typeof composedFields>>, previousDetails: Details) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    login: input.systemAccess ? input.login.trim() : "",
    phone: input.phone,
    integrationCode: input.integrationCode,
    position: composed.position,
    branch: composed.branch,
    systemAccess: input.systemAccess ? 1 : 0,
    showInTracking: input.showInTracking ? 1 : 0,
    twoStepCheck: input.twoStepCheck ? 1 : 0,
    sessionLimit: input.sessionLimit ? 1 : 0,
    gpsCheck: input.gpsCheck ? 1 : 0,
    startPoint: input.startPoint ? 1 : 0,
    organizations: JSON.stringify(composed.organizations),
    accessRightId: input.systemAccess ? input.accessRightId : null,
    jobId: input.jobId,
    branchIds: JSON.stringify(input.branchIds),
    organizationIds: JSON.stringify(input.organizationIds),
    details: JSON.stringify(toDetails(input, previousDetails)),
  }
}

// --- writes ---------------------------------------------------------------------------
export async function createEmployee(input: EmployeeInput): Promise<{ employee: Employee } | { error: EmployeeError }> {
  await ensureSchema()
  // bcrypt before the transaction: no row or lock is held while it runs.
  const passwordHash = input.password ? await hashPassword(input.password) : null
  const outcome = await withTransaction(async (tx): Promise<{ id: number } | { error: EmployeeError }> => {
    await lockLogins(tx)
    const error = await checkReferences(tx, input, null)
    if (error) return { error }
    const composed = await composedFields(tx, input)
    const result = await tx
      .prepare(
        `INSERT INTO employees (
          first_name, last_name, login, phone, integration_code, position, branch, system_access, show_in_tracking,
          two_step_check, session_limit, gps_check, start_point, organizations, active, access_right_id, job_id,
          branch_ids, organization_ids, details, password_hash
        ) VALUES (
          @firstName, @lastName, @login, @phone, @integrationCode, @position, @branch, @systemAccess, @showInTracking,
          @twoStepCheck, @sessionLimit, @gpsCheck, @startPoint, @organizations, 1, @accessRightId, @jobId,
          @branchIds, @organizationIds, @details, @passwordHash
        )`,
      )
      .run({ ...fieldParams(input, composed, {}), passwordHash })
    return { id: Number(result.lastInsertRowid) }
  })
  if ("error" in outcome) return outcome
  return { employee: (await getEmployee(outcome.id))! }
}

/** Updates the employee; a changed name is carried into every record that
 * stores it (cashboxes, warehouses, clients' agent / deliverer / collector,
 * orders, payments, contracts, production staff …) in the same transaction.
 * Turning "Доступ к системе" off blocks the linked account's sign-in and ends
 * its sessions; refused (EmployeeAccessError) for one's own account, an
 * administrator's account unless an administrator does it and the last administrator. */
export async function updateEmployee(
  id: number,
  input: EmployeeInput,
  actor?: EmployeeActor,
): Promise<{ employee: Employee } | { error: EmployeeError } | null> {
  await ensureSchema()
  const passwordHash = input.password ? await hashPassword(input.password) : null
  let endsAccess = false
  const outcome = await withTransaction(async (tx): Promise<{ error: EmployeeError } | boolean> => {
    // A change that may end the linked account's sign-in is serialised with
    // the other such changes before its guards run (lib/auth-employee.ts).
    if (!input.systemAccess) await lockAccessChanges(tx)
    await lockLogins(tx)
    const current = (await tx.prepare("SELECT * FROM employees WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    endsAccess = Number(current.active) === 1 && Number(current.system_access) === 1 && !input.systemAccess
    if (endsAccess) await assertMayEndAccess(tx, id, actor)
    const error = await checkReferences(tx, input, current)
    if (error) return { error }
    const composed = await composedFields(tx, input)
    await tx
      .prepare(
        `UPDATE employees SET
          first_name = @firstName, last_name = @lastName, login = @login, phone = @phone, integration_code = @integrationCode,
          position = @position, branch = @branch, system_access = @systemAccess, show_in_tracking = @showInTracking,
          two_step_check = @twoStepCheck, session_limit = @sessionLimit, gps_check = @gpsCheck, start_point = @startPoint,
          organizations = @organizations, access_right_id = @accessRightId, job_id = @jobId, branch_ids = @branchIds,
          organization_ids = @organizationIds, details = @details,
          password_hash = COALESCE(@passwordHash, password_hash), updated_at = datetime('now')
        WHERE id = @id`,
      )
      .run({ ...fieldParams(input, composed, parse<Details>(current.details, {})), passwordHash, id })
    await cascadeEmployeeRename(tx, id, fullName(current), fullName({ first_name: input.firstName, last_name: input.lastName }))
    return true
  })
  if (outcome === false) return null
  if (outcome !== true) return outcome
  if (endsAccess) await revokeEmployeeSessions(id)
  return { employee: (await getEmployee(id))! }
}

/** Trash icon: the employee moves to the "Удаленные" tab (active = 0) or comes back (active = 1).
 * Deactivating blocks the linked account's sign-in and ends its sessions, with the guards of
 * updateEmployee (EmployeeAccessError). */
export async function setEmployeeActive(id: number, active: boolean, actor?: EmployeeActor): Promise<Employee | null> {
  await ensureSchema()
  let endsAccess = false
  const found = await withTransaction(async (tx) => {
    if (!active) await lockAccessChanges(tx)
    const current = (await tx.prepare("SELECT * FROM employees WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    endsAccess = !active && Number(current.active) === 1 && Number(current.system_access) === 1
    if (endsAccess) await assertMayEndAccess(tx, id, actor)
    if (Number(current.active) !== (active ? 1 : 0)) {
      await tx.prepare("UPDATE employees SET active = @active, updated_at = datetime('now') WHERE id = @id").run({ id, active: active ? 1 : 0 })
    }
    return true
  })
  if (!found) return null
  if (endsAccess) await revokeEmployeeSessions(id)
  return getEmployee(id)
}

/** Trash icon in the "Удаленные" tab: removes the record for good (only an employee that is
 * already deleted). Refused (EmployeeInUseError, 409 with the usage list) while a cashbox,
 * warehouse, client, document, production record, field activity, attendance or a sign-in
 * account (Пользователи) refers to the employee; the employee's subscription goes back to its package. */
export async function purgeEmployee(id: number): Promise<boolean> {
  await ensureSchema()
  // Prepares the subscriptions schema outside the transaction below (nothing is detached).
  await detachSubscriptions([])
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT * FROM employees WHERE id = ? AND active = 0 FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    const usage = await employeeUsage(tx, current)
    // A sign-in account linked to the employee (Права доступа → Пользователи).
    const accounts = (await tx.prepare("SELECT COUNT(*)::int AS n FROM users WHERE employee_id = ?").get(id)) as { n: number }
    if (Number(accounts.n) > 0) usage.push({ table: "users", label: "Пользователи", count: Number(accounts.n) })
    if (usage.length) throw new EmployeeInUseError(usage)
    await detachSubscriptions([id])
    return (await tx.prepare("DELETE FROM employees WHERE id = ? AND active = 0").run(id)).changes > 0
  })
}

export type BulkChange = Partial<{
  cashboxIds: number[]
  branchIds: number[]
  supervisorId: number | null
  organizationIds: number[]
  stockIds: number[]
  priceListIds: number[]
  currencyIds: number[]
  restrictions: { names: string[]; replace: boolean }
}>

/** "Изменить" bulk dialog of the Сотрудники list: overwrites the chosen groups of fields for every
 * selected employee. Branches, organizations and the supervisor must exist (null = nothing saved). */
export async function bulkUpdateEmployees(ids: number[], change: BulkChange): Promise<number | null> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    const branches = change.branchIds ? await branchNames(tx, change.branchIds) : null
    const organizations = change.organizationIds ? await organizationNames(tx, change.organizationIds) : null
    if (branches?.includes("") || organizations?.includes("")) return null
    if (change.supervisorId && !(await tx.prepare("SELECT 1 FROM employees WHERE id = ?").get(change.supervisorId))) return null
    const rows = (await tx
      .prepare("SELECT id, details FROM employees WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE")
      .all({ ids })) as Array<{ id: number; details: string }>
    for (const row of rows) {
      const details = parse<Details>(row.details, {})
      if (change.cashboxIds) details.cashboxIds = change.cashboxIds
      if (change.supervisorId !== undefined) details.supervisorId = change.supervisorId === row.id ? (details.supervisorId ?? null) : change.supervisorId
      if (change.stockIds) details.stockIds = change.stockIds
      if (change.priceListIds) details.priceListIds = change.priceListIds
      if (change.currencyIds) details.currencyIds = change.currencyIds
      if (change.restrictions) {
        const names = change.restrictions.names.map((name) => ({ name }))
        details.accesses = change.restrictions.replace
          ? names
          : [...(details.accesses ?? []), ...names.filter((item) => !(details.accesses ?? []).some((old) => old.name === item.name))]
      }
      await tx
        .prepare(
          `UPDATE employees SET details = @details,
             branch_ids = COALESCE(@branchIds, branch_ids), branch = COALESCE(@branch, branch),
             organization_ids = COALESCE(@organizationIds, organization_ids), organizations = COALESCE(@organizations, organizations),
             updated_at = datetime('now') WHERE id = @id`,
        )
        .run({
          id: row.id,
          details: JSON.stringify(details),
          branchIds: change.branchIds ? JSON.stringify(change.branchIds) : null,
          branch: branches ? (branches[0] ?? "") : null,
          organizationIds: change.organizationIds ? JSON.stringify(change.organizationIds) : null,
          organizations: organizations ? JSON.stringify(organizations) : null,
        })
    }
    return rows.length
  })
}

/** Sets "Доступ к системе" for every active employee. Blocking never touches the employee behind
 * the signed-in account nor one linked to an administrator's account (the people who can undo it
 * keep their sign-in), and it ends the sessions of the accounts it blocks. */
export async function blockAllEmployees(block: boolean, actor?: EmployeeActor): Promise<number> {
  await ensureSchema()
  const rows = await withTransaction(async (tx) => {
    if (block) await lockAccessChanges(tx)
    const spared = block
      ? " AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id AND (u.role = 'admin' OR u.id = @actorId))"
      : ""
    return (await tx
      .prepare(
        `UPDATE employees e SET system_access = @access, updated_at = datetime('now')
          WHERE e.active = 1 AND e.login <> 'admin' AND e.system_access <> @access${spared}
          RETURNING e.id`,
      )
      .all({ access: block ? 0 : 1, actorId: actor?.id ?? 0 })) as Array<{ id: number }>
  })
  if (block) for (const row of rows) await revokeEmployeeSessions(Number(row.id))
  return rows.length
}
