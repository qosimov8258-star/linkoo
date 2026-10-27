import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { hashPassword } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import { detachSubscriptions } from "@/lib/subscriptions-repo"
import type { Employee, EmployeeInput } from "@/components/analytics/employees-data"

type Row = {
  id: number
  first_name: string
  last_name: string
  login: string
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
  SELECT e.*, ar.name AS access_right_name, jp.name AS job_name
  FROM employees e
  LEFT JOIN access_rights ar ON ar.id = e.access_right_id
  LEFT JOIN job_positions jp ON jp.id = e.job_id`

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function rowToEmployee(row: Row): Employee {
  const details = parse<Details>(row.details, {})
  const accessRight = row.access_right_name ?? ""
  const job = row.job_name ?? ""
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(),
    login: row.login,
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

export async function listEmployees(): Promise<Employee[]> {
  await ensureEmployeesSchema()
  const branch = await selectedBranchName()
  const rows = (await getDb().prepare(`${SELECT} WHERE (?::text = '' OR e.branch = ?) ORDER BY e.id ASC`).all(branch, branch)) as Row[]
  return rows.map(rowToEmployee)
}

export async function getEmployee(id: number): Promise<Employee | null> {
  await ensureEmployeesSchema()
  const row = (await getDb().prepare(`${SELECT} WHERE e.id = ?`).get(id)) as Row | undefined
  return row ? rowToEmployee(row) : null
}

export type EmployeeError = "login_taken" | "bad_branch" | "bad_job" | "bad_access_right" | "bad_supervisor" | "no_license"

async function branchNames(ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = (await getDb().prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(rows.map((row) => [row.id, row.name]))
  return ids.map((id) => byId.get(id) ?? "")
}

async function organizationNames(ids: number[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = (await getDb().prepare("SELECT id, name FROM organizations WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(rows.map((row) => [row.id, row.name]))
  return ids.map((id) => byId.get(id) ?? "")
}

/** Validates the references of an input; returns the matching error or null. */
async function checkReferences(input: EmployeeInput, selfId: number | null): Promise<EmployeeError | null> {
  const db = getDb()
  const branches = (await db.prepare("SELECT count(*)::int AS n FROM branches WHERE id = ANY(@ids::int[])").get({ ids: input.branchIds })) as { n: number }
  if (branches.n !== new Set(input.branchIds).size) return "bad_branch"
  if (!(await db.prepare("SELECT 1 FROM job_positions WHERE id = ?").get(input.jobId))) return "bad_job"
  if (input.accessRightId && !(await db.prepare("SELECT 1 FROM access_rights WHERE id = ?").get(input.accessRightId))) return "bad_access_right"
  for (const id of [input.supervisorId, input.deliveryManId]) {
    if (id && !(await db.prepare("SELECT 1 FROM employees WHERE id = ?").get(id))) return "bad_supervisor"
  }
  const login = input.login.trim()
  if (login) {
    const taken = await db.prepare("SELECT id FROM employees WHERE lower(login) = lower(@login) AND id <> @id").get({ login, id: selfId ?? 0 })
    if (taken) return "login_taken"
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

async function composedFields(input: EmployeeInput) {
  const db = getDb()
  const [branches, organizations] = await Promise.all([branchNames(input.branchIds), organizationNames(input.organizationIds)])
  const access = input.accessRightId ? ((await db.prepare("SELECT name FROM access_rights WHERE id = ?").get(input.accessRightId)) as { name: string } | undefined) : undefined
  const job = (await db.prepare("SELECT name FROM job_positions WHERE id = ?").get(input.jobId)) as { name: string } | undefined
  return { branch: branches[0] ?? "", organizations, position: `${access?.name ?? ""}|${job?.name ?? ""}` }
}

export async function createEmployee(input: EmployeeInput): Promise<{ employee: Employee } | { error: EmployeeError }> {
  await ensureEmployeesSchema()
  const error = await checkReferences(input, null)
  if (error) return { error }
  const db = getDb()
  const composed = await composedFields(input)
  const passwordHash = input.password ? await hashPassword(input.password) : null
  const result = await db
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
    .run({
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
      details: JSON.stringify(toDetails(input, {})),
      passwordHash,
    })
  return { employee: (await getEmployee(Number(result.lastInsertRowid)))! }
}

export async function updateEmployee(id: number, input: EmployeeInput): Promise<{ employee: Employee } | { error: EmployeeError } | null> {
  await ensureEmployeesSchema()
  const existing = (await getDb().prepare("SELECT details FROM employees WHERE id = ?").get(id)) as { details: string } | undefined
  if (!existing) return null
  const error = await checkReferences(input, id)
  if (error) return { error }
  const composed = await composedFields(input)
  await getDb()
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
    .run({
      id,
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
      details: JSON.stringify(toDetails(input, parse<Details>(existing.details, {}))),
      passwordHash: input.password ? await hashPassword(input.password) : null,
    })
  await syncCashierName(id)
  return { employee: (await getEmployee(id))! }
}

/** Trash icon in the "Удаленные" tab: removes the record for good (only employees that are already deleted). */
export async function purgeEmployee(id: number): Promise<boolean> {
  await ensureEmployeesSchema()
  const gone = (await getDb().prepare("SELECT 1 FROM employees WHERE id = @id AND active = 0").get({ id })) !== undefined
  if (!gone) return false
  await detachSubscriptions([id])
  const result = await getDb().prepare("DELETE FROM employees WHERE id = @id AND active = 0").run({ id })
  return result.changes > 0
}

/** Trash icon: the employee moves to the "Удаленные" tab (active = 0). */
export async function setEmployeeActive(id: number, active: boolean): Promise<Employee | null> {
  await ensureEmployeesSchema()
  const result = await getDb().prepare("UPDATE employees SET active = @active, updated_at = datetime('now') WHERE id = @id").run({ id, active: active ? 1 : 0 })
  return result.changes > 0 ? getEmployee(id) : null
}

// cashboxes.cashier keeps the cashier's "First Last" name (the ledger matches it by
// name); cashier_id is added lazily by lib/cashboxes-repo.ts, so check it exists.
async function syncCashierName(id: number) {
  const db = getDb()
  const linked = await db
    .prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'cashboxes' AND column_name = 'cashier_id'")
    .get()
  if (!linked) return
  await db
    .prepare(
      `UPDATE cashboxes c SET cashier = btrim(btrim(coalesce(e.first_name, '')) || ' ' || btrim(coalesce(e.last_name, ''))), updated_at = datetime('now')
       FROM employees e WHERE e.id = @id AND c.cashier_id = e.id
         AND c.cashier IS DISTINCT FROM btrim(btrim(coalesce(e.first_name, '')) || ' ' || btrim(coalesce(e.last_name, '')))`,
    )
    .run({ id })
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

/** "Изменить" bulk dialog of the Сотрудники list: overwrites the chosen groups of fields for every selected employee. */
export async function bulkUpdateEmployees(ids: number[], change: BulkChange): Promise<number> {
  await ensureEmployeesSchema()
  const db = getDb()
  const rows = (await db.prepare("SELECT id, details FROM employees WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; details: string }>
  const branches = change.branchIds ? await branchNames(change.branchIds) : null
  const organizations = change.organizationIds ? await organizationNames(change.organizationIds) : null
  for (const row of rows) {
    const details = parse<Details>(row.details, {})
    if (change.cashboxIds) details.cashboxIds = change.cashboxIds
    if (change.supervisorId !== undefined) details.supervisorId = change.supervisorId
    if (change.stockIds) details.stockIds = change.stockIds
    if (change.priceListIds) details.priceListIds = change.priceListIds
    if (change.currencyIds) details.currencyIds = change.currencyIds
    if (change.restrictions) {
      const names = change.restrictions.names.map((name) => ({ name }))
      details.accesses = change.restrictions.replace ? names : [...(details.accesses ?? []), ...names.filter((item) => !(details.accesses ?? []).some((old) => old.name === item.name))]
    }
    await db
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
}

/** Sets "Доступ к системе" for every active employee except the one behind the current login (id of the admin stays usable). */
export async function blockAllEmployees(block: boolean): Promise<number> {
  await ensureEmployeesSchema()
  const result = await getDb()
    .prepare("UPDATE employees SET system_access = @access, updated_at = datetime('now') WHERE active = 1 AND login <> 'admin' AND system_access <> @access")
    .run({ access: block ? 0 : 1 })
  return result.changes
}
