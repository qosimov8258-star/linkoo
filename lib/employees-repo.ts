import "server-only"

import { getDb } from "@/lib/db"
import type { Employee } from "@/components/analytics/employees-data"

type Row = {
  id: number
  first_name: string
  last_name: string
  login: string
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

function rowToEmployee(row: Row): Employee {
  let organizations: string[] = []
  try {
    organizations = JSON.parse(row.organizations) as string[]
  } catch {
    organizations = []
  }
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    login: row.login,
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

export async function listEmployees(): Promise<Employee[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM employees ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToEmployee)
}

export async function getEmployee(id: number): Promise<Employee | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM employees WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToEmployee(row) : null
}

function makeLogin(firstName: string, lastName: string, id: number) {
  const base = `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, "")
  return base ? `${base}${id}` : `user${id}`
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

export async function createEmployee(input: EmployeeInput): Promise<Employee> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO employees (
        first_name, last_name, login, phone, integration_code, position, branch, system_access, show_in_tracking,
        two_step_check, session_limit, gps_check, start_point, organizations, active
      ) VALUES (
        @firstName, @lastName, '', @phone, @integrationCode, @position, @branch, @systemAccess, @showInTracking,
        @twoStepCheck, @sessionLimit, @gpsCheck, @startPoint, @organizations, @active
      )`,
      )
      .run(toParams(input)))
  const id = Number(result.lastInsertRowid)
  await db.prepare("UPDATE employees SET login = ? WHERE id = ?").run(makeLogin(input.firstName, input.lastName, id), id)
  return (await getEmployee(id))!
}

export async function updateEmployee(id: number, input: EmployeeInput): Promise<Employee | null> {
  if (!(await getEmployee(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE employees SET
      first_name = @firstName, last_name = @lastName, phone = @phone, integration_code = @integrationCode,
      position = @position, branch = @branch, system_access = @systemAccess, show_in_tracking = @showInTracking,
      two_step_check = @twoStepCheck, session_limit = @sessionLimit, gps_check = @gpsCheck, start_point = @startPoint,
      organizations = @organizations, active = @active, updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(input), id })
  return (await getEmployee(id))
}

export async function deleteEmployee(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM employees WHERE id = ?").run(id))
  return result.changes > 0
}
