import "server-only"

import { accountOfEmployee, ensureUserEmployeeLink, lockAccessChanges, otherAdminsWithAccess, revokeEmployeeSessions } from "@/lib/auth-employee"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import {
  accountConflict,
  applyAccount,
  endAccountSessions,
  lockAccountLogins,
  planAccount,
  prepareAccount,
  type AccountError,
  type AccountRequest,
} from "@/lib/employees-account"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import { composePosition, withEmployeeLinks } from "@/lib/employees-usage"
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
// job position, access right, supervisor / delivery man, and the lists kept in `details`: stocks,
// price lists, currencies, cashboxes, location points, audit agents); an unknown id is refused with
// the bad ids. An id stored earlier whose record is gone since is not shown (GET) and is dropped on the
// next save, so the form never gets stuck on a value it cannot show; a required one (job, the last branch
// or organization, the access right of an employee with "Доступ к системе") then asks for a new value.
// The records' own delete checks count these links (lib/employees-usage.ts). A sign-in account (users) is linked
// to an employee through users.employee_id (lib/auth-employee.ts); the form's login and password create or update it
// (lib/employees-account.ts; employees.password_hash of older rows is no longer read or written). The employee
// decides whether the account may sign in, so deactivating the employee or turning "Доступ к системе" off
// is guarded (not oneself, an administrator only by an administrator, never the last one) and
// ends the account's sessions; turning it on or restoring the employee lets the account sign in again.
// A rename is carried into every record that stores the name.

type Row = {
  id: number
  first_name: string
  last_name: string
  /** Login of the employee form: the linked account's login, an older login without an account, or "". */
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
  /** The access right the form shows (selectSql): the employee's, else the one the linked account has. */
  access_right_ref?: number | null
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

/** The employee columns the module reads (never employees.password_hash: a copy of a password that older
 * versions kept; the password of the linked account is the only one). */
const EMPLOYEE_COLUMNS = [
  "id",
  "first_name",
  "last_name",
  "login",
  "phone",
  "integration_code",
  "position",
  "branch",
  "system_access",
  "show_in_tracking",
  "two_step_check",
  "session_limit",
  "gps_check",
  "start_point",
  "active",
  "access_right_id",
  "job_id",
  "branch_ids",
  "organization_ids",
  "details",
]
const COLUMNS = EMPLOYEE_COLUMNS.join(", ")

/** The employee with its access right / job names and the linked account's login. job_positions is
 * created lazily by its own module (lib/job-positions-repo.ts): on a fresh database, until Должности
 * was first used, there is no job name to join (and a join would fail the whole list).
 * The access right shown is the employee's; an employee without one whose account was linked earlier
 * (Права доступа → Пользователи) or whose "Доступ к системе" was turned off (that clears the employee's)
 * shows the right its account signs in with, so the form never offers to replace it unseen. An
 * administrator's account is not restricted by a right, so its own is never shown. */
async function selectSql(db: PgDb): Promise<string> {
  const jobs = await tableExists(db, "job_positions")
  return `
  SELECT ${EMPLOYEE_COLUMNS.map((column) => `e.${column}`).join(", ")}, ar.id AS access_right_ref, ar.name AS access_right_name,
         ${jobs ? "jp.name" : "NULL::text"} AS job_name, acc.username AS user_login
  FROM employees e
  LEFT JOIN LATERAL (SELECT u.username, u.role, u.access_right_id FROM users u WHERE u.employee_id = e.id ORDER BY u.id LIMIT 1) acc ON TRUE
  LEFT JOIN access_rights ar ON ar.id = COALESCE(e.access_right_id, CASE WHEN acc.role <> 'admin' THEN acc.access_right_id END)${jobs ? "\n  LEFT JOIN job_positions jp ON jp.id = e.job_id" : ""}`
}

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (JSON.parse(text || "null") as T | null) ?? fallback
  } catch {
    return fallback
  }
}

/** A stored JSON list of ids (anything else in it is ignored). */
function idList(text: string | null | undefined): number[] {
  const value = parse<unknown>(text, [])
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id) && id > 0) : []
}

/** The lazy columns of employees (lib/employees-schema.ts) and users.employee_id, both prepared once per
 * process outside any request transaction (DDL never runs inside one). Called before a transaction is opened. */
async function ensureSchema(): Promise<void> {
  await ensureUserEmployeeLink()
  await ensureEmployeesSchema()
}

/** Ids of the branches and organizations that exist (a stored id whose record was deleted is not shown). */
type LiveIds = { branches: Set<number>; organizations: Set<number> }

async function liveIds(db: PgDb): Promise<LiveIds> {
  const load = async (table: "branches" | "organizations") =>
    (await tableExists(db, table))
      ? new Set(((await db.prepare(`SELECT id FROM ${table}`).all()) as Array<{ id: number }>).map((row) => Number(row.id)))
      : new Set<number>()
  return { branches: await load("branches"), organizations: await load("organizations") }
}

function rowToEmployee(row: Row, live: LiveIds): Employee {
  const details = parse<Details>(row.details, {})
  const accessRight = row.access_right_name ?? ""
  const job = row.job_name ?? ""
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: fullName(row),
    // The login of the linked account (the one that really signs in); otherwise an older login without one.
    login: row.user_login || row.login || "",
    account: row.user_login || null,
    // The account signs in only while the employee is active and has "Доступ к системе" (lib/auth-employee.ts).
    canSignIn: Boolean(row.user_login) && row.active === 1 && row.system_access === 1,
    phone: row.phone,
    integrationCode: row.integration_code,
    // null once the record is gone (nothing joined): the dialog then asks for a new one.
    accessRightId: row.access_right_ref === null || row.access_right_ref === undefined ? null : Number(row.access_right_ref),
    accessRight,
    jobId: row.job_name === null ? null : row.job_id,
    job,
    active: row.active === 1,
    systemAccess: row.system_access === 1,
    showInTracking: row.show_in_tracking === 1,
    twoStepCheck: row.two_step_check === 1,
    sessionLimit: row.session_limit === 1,
    gpsCheck: row.gps_check === 1,
    startPoint: row.start_point === 1,
    branchIds: idList(row.branch_ids).filter((id) => live.branches.has(id)),
    organizationIds: idList(row.organization_ids).filter((id) => live.organizations.has(id)),
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
    position: composePosition(accessRight, job),
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

/** Turning "Доступ к системе" back on or restoring the employee lets the linked account sign in again:
 * an administrator's account (blocked by an administrator, the only one who may block it) only by an
 * administrator. */
async function assertMayRestoreAccess(tx: PgDb, employeeId: number, actor: EmployeeActor | undefined) {
  if (!actor || actor.role === "admin") return
  const account = await accountOfEmployee(tx, employeeId)
  if (account?.role === "admin") throw new EmployeeAccessError("Только администратор может включить доступ администратора", 403)
}

// --- reads ----------------------------------------------------------------------------
export async function listEmployees(): Promise<Employee[]> {
  await ensureSchema()
  const branch = await selectedBranchName()
  const db = getDb()
  // The branch picked in the account menu: the employee's main branch or any of its branches
  // (branches is created lazily by lib/branches-repo.ts; without it only the main branch name matches).
  const byBranchIds = (await tableExists(db, "branches"))
    ? ` OR EXISTS (
                SELECT 1 FROM branches b
                 WHERE b.name = @branch
                   AND (CASE WHEN e.branch_ids ~ '^\\[[0-9, ]*\\]$' THEN e.branch_ids::jsonb ELSE '[]'::jsonb END) @> jsonb_build_array(b.id))`
    : ""
  const rows = (await db
    .prepare(
      `${await selectSql(db)}
        WHERE (@branch::text = '' OR e.branch = @branch${byBranchIds})
        ORDER BY e.id ASC`,
    )
    .all({ branch })) as Row[]
  const live = await liveIds(db)
  return rows.map((row) => rowToEmployee(row, live))
}

export async function getEmployee(id: number): Promise<Employee | null> {
  await ensureSchema()
  const db = getDb()
  const row = (await db.prepare(`${await selectSql(db)} WHERE e.id = ?`).get(id)) as Row | undefined
  return row ? rowToEmployee(row, await liveIds(db)) : null
}

export type EmployeeError =
  | AccountError
  | "bad_branch"
  | "bad_organization"
  | "bad_job"
  | "bad_access_right"
  | "bad_supervisor"
  | "bad_audit_agent"
  | "bad_stock"
  | "bad_price_list"
  | "bad_currency"
  | "bad_cashbox"
  | "bad_location"
  | "bad_restriction"
  | "unknown_employee"
  | "self_reference"
  | "no_license"
  | "required"

/** A refused input: the error, the form field it belongs to (when it is not the error's usual one), the
 * message (when it is not the error's usual one) and the ids / names that were not found
 * (lib/employees-api.ts answers it). */
export type EmployeeFailure = { error: EmployeeError; field?: string; message?: string; ids?: number[]; names?: string[] }

/** Tables an employee refers to by id. */
type RefTable =
  | "branches"
  | "organizations"
  | "job_positions"
  | "access_rights"
  | "employees"
  | "warehouses"
  | "price_lists"
  | "currencies"
  | "cashboxes"
  | "start_locations"

const INT4_MAX = 2_147_483_647
/** Tables seen to exist (several are created lazily by their own modules, start_locations by none yet). */
const existingTables = new Set<string>()

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  if (existingTables.has(table)) return true
  const row = (await db.prepare("SELECT to_regclass(@name::text) IS NOT NULL AS ok").get({ name: table })) as { ok: boolean } | undefined
  if (row?.ok) existingTables.add(table)
  return Boolean(row?.ok)
}

/** The ids of `ids` that `table` does not have (rows matching `condition` only); every id while the
 * table does not exist yet. Never queries a missing table, so a transaction is not aborted. The rows
 * found are locked FOR KEY SHARE until the save commits (as a foreign key would): a delete of one of
 * them (which locks its row FOR UPDATE before counting its usage) waits and then sees this employee.
 * Other employees are not locked (two employees naming each other would deadlock). */
async function missingIds(db: PgDb, table: RefTable, ids: ReadonlyArray<number>, condition = ""): Promise<number[]> {
  const wanted = [...new Set(ids)]
  if (!wanted.length) return []
  const valid = wanted.filter((id) => Number.isInteger(id) && id > 0 && id <= INT4_MAX)
  if (!valid.length || !(await tableExists(db, table))) return wanted
  const lock = table === "employees" ? "" : " FOR KEY SHARE"
  const rows = (await db
    .prepare(`SELECT id FROM ${table} WHERE id = ANY(@ids::int[])${condition ? ` AND (${condition})` : ""} ORDER BY id${lock}`)
    .all({ ids: valid })) as Array<{ id: number }>
  const found = new Set(rows.map((row) => Number(row.id)))
  return wanted.filter((id) => !found.has(id))
}

async function namesById(db: PgDb, table: "branches" | "organizations", ids: number[]): Promise<string[]> {
  if (!ids.length || !(await tableExists(db, table))) return ids.map(() => "")
  const rows = (await db.prepare(`SELECT id, name FROM ${table} WHERE id = ANY(@ids::int[])`).all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(rows.map((row) => [Number(row.id), row.name]))
  return ids.map((id) => byId.get(id) ?? "")
}

const unique = (ids: ReadonlyArray<number>) => [...new Set(ids)]

/** The branch / organization / job / access right ids an input resolves to (stale stored ids dropped). */
type MainRefs = { branchIds: number[]; organizationIds: number[]; jobId: number; accessRightId: number | null }

/** Validates the main references of an input with the rule of resolveIdList: an id new in this save must
 * exist; one stored earlier whose record is gone is dropped (a required field left empty by that is
 * refused as "Обязательное поле" under it). The login is checked with the account (lib/employees-account.ts). */
async function checkReferences(db: PgDb, input: EmployeeInput, current: Row | null): Promise<{ failure: EmployeeFailure } | { refs: MainRefs }> {
  const branches = await resolveIdList(db, { key: "branchIds", table: "branches", error: "bad_branch" }, input.branchIds, idList(current?.branch_ids))
  if ("failure" in branches) return branches
  if (input.branchIds.length && !branches.ids.length) return { failure: { error: "required", field: "branchIds" } }
  const organizations = await resolveIdList(
    db,
    { key: "organizationIds", table: "organizations", error: "bad_organization" },
    input.organizationIds,
    idList(current?.organization_ids),
  )
  if ("failure" in organizations) return organizations
  if (input.organizationIds.length && !organizations.ids.length) return { failure: { error: "required", field: "organizationIds" } }
  const storedJob = current?.job_id ? [Number(current.job_id)] : []
  const job = await resolveIdList(db, { key: "jobId", table: "job_positions", error: "bad_job" }, [input.jobId], storedJob)
  if ("failure" in job) return job
  if (!job.ids.length) return { failure: { error: "required", field: "jobId" } }
  let accessRightId: number | null = null
  if (input.accessRightId) {
    const storedRight = current?.access_right_id ? [Number(current.access_right_id)] : []
    const right = await resolveIdList(db, { key: "accessRightId", table: "access_rights", error: "bad_access_right" }, [input.accessRightId], storedRight)
    if ("failure" in right) return right
    accessRightId = right.ids[0] ?? null
    if (accessRightId === null && input.systemAccess) return { failure: { error: "required", field: "accessRightId" } }
  }
  return { refs: { branchIds: branches.ids, organizationIds: organizations.ids, jobId: job.ids[0], accessRightId } }
}

type DetailListKey =
  | "stockIds"
  | "requestStockIds"
  | "priceListIds"
  | "marketPriceListIds"
  | "currencyIds"
  | "cashboxIds"
  | "requestCashboxIds"
  | "locationPointIds"
  | "auditAgentIds"

/** The id lists kept in `details`, their tables and which rows may be newly chosen (what the form offers). */
const DETAIL_LISTS: ReadonlyArray<{ key: DetailListKey; table: RefTable; error: EmployeeError; selectable?: string }> = [
  { key: "stockIds", table: "warehouses", error: "bad_stock", selectable: "active = 1" },
  { key: "requestStockIds", table: "warehouses", error: "bad_stock", selectable: "active = 1" },
  { key: "priceListIds", table: "price_lists", error: "bad_price_list" },
  { key: "marketPriceListIds", table: "price_lists", error: "bad_price_list" },
  { key: "currencyIds", table: "currencies", error: "bad_currency" },
  { key: "cashboxIds", table: "cashboxes", error: "bad_cashbox" },
  { key: "requestCashboxIds", table: "cashboxes", error: "bad_cashbox" },
  { key: "locationPointIds", table: "start_locations", error: "bad_location" },
  { key: "auditAgentIds", table: "employees", error: "bad_audit_agent", selectable: "active = 1" },
]

/** Checks a list of ids for `details`: an id the employee did not have yet must exist (and be
 * selectable, and not be the employee itself: `selfId`); one stored earlier is kept while its
 * record exists and dropped once it is gone. */
async function resolveIdList(
  db: PgDb,
  ref: (typeof DETAIL_LISTS)[number] | { key: string; table: RefTable; error: EmployeeError; selectable?: string },
  value: ReadonlyArray<number>,
  stored: ReadonlyArray<number>,
  selfId = 0,
): Promise<{ ids: number[] } | { failure: EmployeeFailure }> {
  const ids = unique(value)
  const before = new Set(stored)
  const fresh = ids.filter((id) => !before.has(id))
  if (ref.table === "employees" && selfId > 0 && fresh.includes(selfId)) return { failure: { error: "self_reference", field: ref.key, ids: [selfId] } }
  const bad = await missingIds(db, ref.table, fresh, ref.selectable)
  if (bad.length) return { failure: { error: ref.error, field: ref.key, ids: bad } }
  const gone = new Set(await missingIds(db, ref.table, ids.filter((id) => before.has(id))))
  return { ids: ids.filter((id) => !gone.has(id)) }
}

/** The `details` blob of an input, its references checked (see resolveIdList); other keys of the
 * previous blob (time restriction names …) are kept. */
async function resolveDetails(
  db: PgDb,
  input: EmployeeInput,
  previous: Details,
  selfId = 0,
): Promise<{ details: Details } | { failure: EmployeeFailure }> {
  const details: Details = { ...previous }
  for (const ref of DETAIL_LISTS) {
    const value = input[ref.key] ?? previous[ref.key] ?? []
    const result = await resolveIdList(db, ref, value, previous[ref.key] ?? [], selfId)
    if ("failure" in result) return result
    details[ref.key] = result.ids
  }
  for (const key of ["supervisorId", "deliveryManId"] as const) {
    const id = input[key]
    const stored = previous[key] ?? null
    const ref = { key, table: "employees" as const, error: "bad_supervisor" as const, selectable: "active = 1" }
    const result = await resolveIdList(db, ref, id ? [id] : [], stored ? [stored] : [], selfId)
    if ("failure" in result) return result
    details[key] = result.ids[0] ?? null
  }
  return { details }
}

/** The name columns other pages read: the main (first) branch, the organizations and "access · job" (the
 * access right only while "Доступ к системе" is on, as it is stored; lib/employees-usage.ts
 * refreshEmployeePositions composes the same text after a rename). */
async function composedFields(db: PgDb, input: EmployeeInput, refs: MainRefs) {
  const branches = await namesById(db, "branches", refs.branchIds)
  const organizations = await namesById(db, "organizations", refs.organizationIds)
  const accessRightId = input.systemAccess ? refs.accessRightId : null
  const access = accessRightId
    ? ((await db.prepare("SELECT name FROM access_rights WHERE id = ?").get(accessRightId)) as { name: string } | undefined)
    : undefined
  const job = (await db.prepare("SELECT name FROM job_positions WHERE id = ?").get(refs.jobId)) as { name: string } | undefined
  return { branch: branches[0] ?? "", organizations, position: composePosition(access?.name, job?.name) }
}

function fieldParams(input: EmployeeInput, refs: MainRefs, composed: Awaited<ReturnType<typeof composedFields>>, details: Details, login: string) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    login,
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
    accessRightId: input.systemAccess ? refs.accessRightId : null,
    jobId: refs.jobId,
    branchIds: JSON.stringify(refs.branchIds),
    organizationIds: JSON.stringify(refs.organizationIds),
    details: JSON.stringify(details),
  }
}

// --- writes ---------------------------------------------------------------------------
/** Runs a save; once more when the employee got an account meanwhile (users.employee_id is unique: the
 * second run updates that account instead). A login taken meanwhile is refused (409). */
async function withAccountRetry<T>(save: () => Promise<T>): Promise<T | EmployeeFailure> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await save()
    } catch (error) {
      const conflict = accountConflict(error)
      if (conflict === "login") return { error: "login_taken", field: "login" }
      if (conflict === "employee" && attempt === 0) continue
      throw error
    }
  }
}

/** The login / password part of a save, decided inside its transaction (lib/employees-account.ts). */
async function accountPlan(tx: PgDb, input: EmployeeInput, refs: MainRefs, current: Row | null, request: AccountRequest, actor: EmployeeActor) {
  return planAccount(tx, {
    current: current
      ? { id: current.id, login: current.login ?? "", accessRightId: current.access_right_id === null ? null : Number(current.access_right_id), name: fullName(current) }
      : null,
    systemAccess: input.systemAccess,
    accessRightId: input.systemAccess ? refs.accessRightId : null,
    name: fullName({ first_name: input.firstName, last_name: input.lastName }),
    request,
    actor,
  })
}

/** Creates the employee and, with "Доступ к системе", a login and a password, its sign-in account
 * (lib/employees-account.ts: only an administrator sets a login or a password). */
export async function createEmployee(input: EmployeeInput, actor: EmployeeActor): Promise<{ employee: Employee } | EmployeeFailure> {
  await ensureSchema()
  // The password is checked and hashed (bcrypt) before the transaction: no row or lock is held meanwhile.
  const prepared = await prepareAccount(input, actor)
  if ("failure" in prepared) return prepared.failure
  const outcome = await withAccountRetry(() =>
    withTransaction(async (tx) => {
      await lockAccountLogins(tx)
      const checked = await checkReferences(tx, input, null)
      if ("failure" in checked) return checked.failure
      const account = await accountPlan(tx, input, checked.refs, null, prepared.request, actor)
      if ("failure" in account) return account.failure
      const resolved = await resolveDetails(tx, input, {})
      if ("failure" in resolved) return resolved.failure
      const composed = await composedFields(tx, input, checked.refs)
      const result = await tx
        .prepare(
          `INSERT INTO employees (
            first_name, last_name, login, phone, integration_code, position, branch, system_access, show_in_tracking,
            two_step_check, session_limit, gps_check, start_point, organizations, active, access_right_id, job_id,
            branch_ids, organization_ids, details
          ) VALUES (
            @firstName, @lastName, @login, @phone, @integrationCode, @position, @branch, @systemAccess, @showInTracking,
            @twoStepCheck, @sessionLimit, @gpsCheck, @startPoint, @organizations, 1, @accessRightId, @jobId,
            @branchIds, @organizationIds, @details
          )`,
        )
        .run(fieldParams(input, checked.refs, composed, resolved.details, account.plan.login))
      const id = Number(result.lastInsertRowid)
      const written = await applyAccount(tx, id, fullName({ first_name: input.firstName, last_name: input.lastName }), account.plan)
      return { id, written }
    }),
  )
  if ("error" in outcome) return outcome
  await endAccountSessions(outcome.written)
  return { employee: (await getEmployee(outcome.id))! }
}

/** Updates the employee; a changed name is carried into every record that
 * stores it (cashboxes, warehouses, clients' agent / deliverer / collector,
 * orders, payments, contracts, production staff …) in the same transaction.
 * The login and password create or update the linked sign-in account
 * (lib/employees-account.ts). Turning "Доступ к системе" off blocks the linked
 * account's sign-in and ends its sessions; refused (EmployeeAccessError) for
 * one's own account, an administrator's account unless an administrator does
 * it and the last administrator. Turning it back on for an administrator's
 * account is refused unless an administrator does it. */
export async function updateEmployee(id: number, input: EmployeeInput, actor: EmployeeActor): Promise<{ employee: Employee } | EmployeeFailure | null> {
  await ensureSchema()
  const prepared = await prepareAccount(input, actor)
  if ("failure" in prepared) return prepared.failure
  let endsAccess = false
  const outcome = await withAccountRetry(() =>
    withTransaction(async (tx) => {
      // A change that may end or restore the linked account's sign-in is serialised with the other
      // such changes (an account's role changed on Пользователи …) before its guards run (lib/auth-employee.ts).
      await lockAccessChanges(tx)
      await lockAccountLogins(tx)
      const current = (await tx.prepare(`SELECT ${COLUMNS} FROM employees WHERE id = ? FOR UPDATE`).get(id)) as Row | undefined
      if (!current) return null
      endsAccess = Number(current.active) === 1 && Number(current.system_access) === 1 && !input.systemAccess
      if (endsAccess) await assertMayEndAccess(tx, id, actor)
      if (Number(current.active) === 1 && Number(current.system_access) !== 1 && input.systemAccess) await assertMayRestoreAccess(tx, id, actor)
      const checked = await checkReferences(tx, input, current)
      if ("failure" in checked) return checked.failure
      const account = await accountPlan(tx, input, checked.refs, current, prepared.request, actor)
      if ("failure" in account) return account.failure
      const resolved = await resolveDetails(tx, input, parse<Details>(current.details, {}), id)
      if ("failure" in resolved) return resolved.failure
      const composed = await composedFields(tx, input, checked.refs)
      await tx
        .prepare(
          `UPDATE employees SET
            first_name = @firstName, last_name = @lastName, login = @login, phone = @phone, integration_code = @integrationCode,
            position = @position, branch = @branch, system_access = @systemAccess, show_in_tracking = @showInTracking,
            two_step_check = @twoStepCheck, session_limit = @sessionLimit, gps_check = @gpsCheck, start_point = @startPoint,
            organizations = @organizations, access_right_id = @accessRightId, job_id = @jobId, branch_ids = @branchIds,
            organization_ids = @organizationIds, details = @details, updated_at = datetime('now')
          WHERE id = @id`,
        )
        .run({ ...fieldParams(input, checked.refs, composed, resolved.details, account.plan.login), id })
      const name = fullName({ first_name: input.firstName, last_name: input.lastName })
      await cascadeEmployeeRename(tx, id, fullName(current), name)
      return { written: await applyAccount(tx, id, name, account.plan) }
    }),
  )
  if (outcome === null) return null
  if ("error" in outcome) return outcome
  if (endsAccess) await revokeEmployeeSessions(id)
  else await endAccountSessions(outcome.written)
  return { employee: (await getEmployee(id))! }
}

/** Trash icon: the employee moves to the "Удаленные" tab (active = 0) or comes back (active = 1).
 * Deactivating blocks the linked account's sign-in and ends its sessions, with the guards of
 * updateEmployee (EmployeeAccessError); bringing back an employee whose account is an
 * administrator's is refused unless an administrator does it. */
export async function setEmployeeActive(id: number, active: boolean, actor?: EmployeeActor): Promise<Employee | null> {
  await ensureSchema()
  let endsAccess = false
  const found = await withTransaction(async (tx) => {
    await lockAccessChanges(tx)
    const current = (await tx.prepare(`SELECT ${COLUMNS} FROM employees WHERE id = ? FOR UPDATE`).get(id)) as Row | undefined
    if (!current) return false
    endsAccess = !active && Number(current.active) === 1 && Number(current.system_access) === 1
    if (endsAccess) await assertMayEndAccess(tx, id, actor)
    if (active && Number(current.active) !== 1 && Number(current.system_access) === 1) await assertMayRestoreAccess(tx, id, actor)
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
 * warehouse, client, document, production record, field activity, attendance, a sign-in
 * account (Пользователи) or another active employee (supervisor, delivery man, audit agent)
 * refers to the employee; the employee's subscription goes back to its package. */
export async function purgeEmployee(id: number): Promise<boolean> {
  await ensureSchema()
  // Prepares the subscriptions schema outside the transaction below (nothing is detached).
  await detachSubscriptions([])
  return withTransaction(async (tx) => {
    const current = (await tx.prepare(`SELECT ${COLUMNS} FROM employees WHERE id = ? AND active = 0 FOR UPDATE`).get(id)) as Row | undefined
    if (!current) return false
    const usage = await withEmployeeLinks(tx, "employees", { id }, await employeeUsage(tx, current))
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

/** Time restriction names (Ограничение времени) that do not exist; all of them while the table does not. */
async function missingRestrictions(db: PgDb, names: ReadonlyArray<string>): Promise<string[]> {
  const wanted = [...new Set(names)]
  if (!wanted.length) return []
  if (!(await tableExists(db, "order_time_restrictions"))) return wanted
  const rows = (await db.prepare("SELECT name FROM order_time_restrictions WHERE name = ANY(@names::text[])").all({ names: wanted })) as Array<{ name: string }>
  const found = new Set(rows.map((row) => row.name))
  return wanted.filter((name) => !found.has(name))
}

/** "Изменить" bulk dialog of the Сотрудники list: overwrites the chosen groups of fields for every
 * selected employee. Every referenced id must exist (EmployeeFailure with the bad ids, nothing saved),
 * and so must every selected employee (unknown_employee). */
export async function bulkUpdateEmployees(ids: number[], change: BulkChange): Promise<{ changed: number } | EmployeeFailure> {
  await ensureSchema()
  return withTransaction(async (tx): Promise<{ changed: number } | EmployeeFailure> => {
    let bad = change.branchIds ? await missingIds(tx, "branches", change.branchIds) : []
    if (bad.length) return { error: "bad_branch", ids: bad }
    bad = change.organizationIds ? await missingIds(tx, "organizations", change.organizationIds) : []
    if (bad.length) return { error: "bad_organization", ids: bad }
    bad = change.supervisorId ? await missingIds(tx, "employees", [change.supervisorId], "active = 1") : []
    if (bad.length) return { error: "bad_supervisor", ids: bad }
    const lists: ReadonlyArray<{ key: "cashboxIds" | "stockIds" | "priceListIds" | "currencyIds"; table: RefTable; error: EmployeeError; selectable?: string }> = [
      { key: "cashboxIds", table: "cashboxes", error: "bad_cashbox" },
      { key: "stockIds", table: "warehouses", error: "bad_stock", selectable: "active = 1" },
      { key: "priceListIds", table: "price_lists", error: "bad_price_list" },
      { key: "currencyIds", table: "currencies", error: "bad_currency" },
    ]
    for (const list of lists) {
      bad = change[list.key] ? await missingIds(tx, list.table, change[list.key]!, list.selectable) : []
      if (bad.length) return { error: list.error, field: list.key, ids: bad }
    }
    const unknownNames = change.restrictions ? await missingRestrictions(tx, change.restrictions.names) : []
    if (unknownNames.length) return { error: "bad_restriction", names: unknownNames }
    const wanted = unique(ids)
    const rows = (await tx
      .prepare("SELECT id, details FROM employees WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE")
      .all({ ids: wanted })) as Array<{ id: number; details: string }>
    if (rows.length !== wanted.length) {
      const found = new Set(rows.map((row) => Number(row.id)))
      return { error: "unknown_employee", ids: wanted.filter((id) => !found.has(id)) }
    }
    const branchIds = change.branchIds ? unique(change.branchIds) : null
    const organizationIds = change.organizationIds ? unique(change.organizationIds) : null
    const branches = branchIds ? await namesById(tx, "branches", branchIds) : null
    const organizations = organizationIds ? await namesById(tx, "organizations", organizationIds) : null
    for (const row of rows) {
      const details = parse<Details>(row.details, {})
      if (change.cashboxIds) details.cashboxIds = unique(change.cashboxIds)
      if (change.supervisorId !== undefined) details.supervisorId = change.supervisorId === row.id ? (details.supervisorId ?? null) : change.supervisorId
      if (change.stockIds) details.stockIds = unique(change.stockIds)
      if (change.priceListIds) details.priceListIds = unique(change.priceListIds)
      if (change.currencyIds) details.currencyIds = unique(change.currencyIds)
      if (change.restrictions) {
        const names = [...new Set(change.restrictions.names)].map((name) => ({ name }))
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
          branchIds: branchIds ? JSON.stringify(branchIds) : null,
          branch: branches ? (branches[0] ?? "") : null,
          organizationIds: organizationIds ? JSON.stringify(organizationIds) : null,
          organizations: organizations ? JSON.stringify(organizations) : null,
        })
    }
    return { changed: rows.length }
  })
}

/** Sets "Доступ к системе" for every active employee. Blocking never touches the employee behind
 * the signed-in account (`actor`) nor one linked to an administrator's account (the people who can
 * undo it keep their sign-in), and it ends the sessions of the accounts it blocks. */
export async function blockAllEmployees(block: boolean, actor: EmployeeActor): Promise<number> {
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
      .all({ access: block ? 0 : 1, actorId: actor.id })) as Array<{ id: number }>
  })
  if (block) for (const row of rows) await revokeEmployeeSessions(Number(row.id))
  return rows.length
}
