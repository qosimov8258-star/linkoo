export type Employee = {
  id: number
  firstName: string
  lastName: string
  name: string
  login: string
  phone: string
  integrationCode: string
  accessRightId: number | null
  /** Access right (reference "position"), e.g. "Агент". */
  accessRight: string
  jobId: number | null
  /** Job (reference "Должность"), e.g. "Супервайзер". */
  job: string
  active: boolean
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  branchIds: number[]
  organizationIds: number[]
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
  /** "access|job" text kept for the other pages that read employees.position. */
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
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  locationPointIds: number[]
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
