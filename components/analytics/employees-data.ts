import type { PasswordPolicy } from "@/lib/auth-policy"

export type Employee = {
  id: number
  firstName: string
  lastName: string
  name: string
  login: string
  /** Login of the sign-in account linked to the employee, or null: only that account signs in. The form
   * creates it from the login and a password (an older login without a password has none). */
  account: string | null
  /** The password rules of that account (lib/auth-policy.ts): "employee" (short passwords) unless an
   * administrator's account is linked. Optional for rows built without an account. */
  passwordPolicy?: PasswordPolicy
  /** True while the linked account may sign in (the employee is active and has "Доступ к системе"). */
  canSignIn: boolean
  phone: string
  integrationCode: string
  accessRightId: number | null
  /** Access right (reference "position"), e.g. "Агент". */
  accessRight: string
  jobId: number | null
  /** Job (reference "Должность"), e.g. "Супервайзер". */
  job: string
  active: boolean
  /** False while the employee is blocked («Ограничить доступ сотрудника»): the list shows «Заблокирован» and the
   * account cannot sign in. The form's «Доступ к системе» is `active`, as in Linko. */
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  branchIds: number[]
  organizationIds: number[]
  /** Zones (Территория) whose agent the employee is: the list's «Зона» filter. */
  zoneIds: number[]
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
  /** Time restrictions assigned to the employee (shown in red under the access right). */
  accesses: string[]
  /** "access · job" text kept for the other pages that read employees.position. */
  position: string
}

export type EmployeeInput = {
  firstName: string
  lastName: string
  phone: string
  integrationCode: string
  jobId: number
  branchIds: number[]
  organizationIds: number[]
  /** «Доступ к системе» is on in the form: the login, password and access right are read. */
  systemAccess: boolean
  /** «Доступ к системе» of an existing employee: false moves them to «Удаленные», true brings them back; left out,
   * the employee keeps its state (a new employee is always active). */
  active?: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  locationPointIds: number[]
  cashboxIds?: number[]
  requestCashboxIds?: number[]
  login: string
  accessRightId: number | null
  password: string
  /** Subscription license key attached on creation. */
  licenseKey: string
  supervisorId: number | null
  deliveryManId: number | null
  auditAgentIds: number[]
  stockIds: number[]
  requestStockIds: number[]
  priceListIds: number[]
  marketPriceListIds: number[]
  currencyIds: number[]
}

export type NamedId = { id: number; name: string }

export type EmployeeOptions = {
  jobs: NamedId[]
  accessRights: Array<NamedId & { groups: string[] }>
  branches: NamedId[]
  organizations: NamedId[]
  warehouses: NamedId[]
  priceLists: NamedId[]
  currencies: NamedId[]
  startLocations: NamedId[]
  employees: Array<NamedId & { accessRightId: number | null }>
  cashboxes: NamedId[]
  restrictions: NamedId[]
  zones: NamedId[]
  licenses: Array<{ key: string; name: string; available: number }>
}
