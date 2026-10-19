// Shared (client + server) types of "Договоры" (demo #/contracts, uz
// "Kelishuvlar"). Spec: scratchpad extra/spec-contracts.md. Storage keeps the
// historical status values (active / completed / cancelled) that the cash core
// and the finance readers already use; the demo's pending / finished / canceled
// are accepted as aliases by the API.

export const CONTRACT_STATUSES = ["active", "completed", "cancelled"] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

/** Demo tabs: "Активные" (pending), "Завершенные" (finished), "Все" (no status). */
export const CONTRACT_TABS = ["active", "completed", "all"] as const
export type ContractTab = (typeof CONTRACT_TABS)[number]

/** Russian labels (dictionary keys) — demo module 4294 CONTRACT_STATUS_MAP. */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  completed: "Завершен",
  active: "Активный",
  cancelled: "Отменен",
}

/** Demo dot colours: canceled #e57373, finished #64b5f6, otherwise #81c784. */
export const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  completed: "#64b5f6",
  active: "#81c784",
  cancelled: "#e57373",
}

/** Status column of the demo Excel export ("Закрытие" / "Актив" / "Отменен"). */
export const CONTRACT_STATUS_EXCEL: Record<ContractStatus, string> = {
  completed: "Закрытие",
  active: "Актив",
  cancelled: "Отменен",
}

export function normalizeContractStatus(value: unknown): ContractStatus | null {
  const text = String(value ?? "").trim().toLowerCase()
  if (text === "active" || text === "pending") return "active"
  if (text === "completed" || text === "finished") return "completed"
  if (text === "cancelled" || text === "canceled") return "cancelled"
  return null
}

export type ContractClientRef = { id: number | null; name: string; zone: string }
export type ContractNamed = { id: number | null; name: string }

export type ContractRow = {
  id: number
  /** null for contracts created before numbering (full number falls back to the id). */
  contractNumber: number | null
  contractPrefix: string
  contractSuffix: string
  /** prefix + number + suffix (demo full_number). */
  fullNumber: string
  /** Business date, local "YYYY-MM-DDTHH:mm:ss" (demo created_date). */
  createdDate: string
  year: number
  officialName: string
  inn: string
  /** Clients (demo markets) in form order; zone = client zone (demo border). */
  clients: ContractClientRef[]
  agent: ContractNamed
  organization: ContractNamed
  comment: string
  status: ContractStatus
  createdBy: string
  /** Live (not deleted) payments made under the contract. */
  transactionsCount: number
  /** Σ of those payments per currency code (amount credited to the client). */
  paid: Record<string, number>
}

export type ContractTransaction = {
  id: number
  docNo: number | null
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  date: string
  createdBy: string
  client: string
  cashbox: string
  amount: number
  currency: string
  comment: string
  /** false = not verified / not accepted yet (still counts for the client). */
  accepted: boolean
  orderId: number | null
}

export type ContractDetail = ContractRow & {
  transactions: ContractTransaction[]
  totals: Array<{ currency: string; amount: number }>
}

export type ContractListResult = {
  count: number
  page: number
  pageSize: number
  results: ContractRow[]
}

export type ContractListQuery = {
  tab: ContractTab
  search: string
  ordering: string
  page: number
  /** 0 = all (Excel). */
  pageSize: number
  fromDate: string
  toDate: string
  clientIds: number[]
  zones: string[]
  agents: string[]
  /** "Договор" filter (single contract). */
  contractId: number | null
}

export type ContractFormOptions = {
  agents: Array<{ id: number; name: string }>
  organizations: Array<{ id: number; name: string }>
  /** Filter values: zones of clients + legacy contract zones. */
  zones: string[]
  /** Filter values: employees + legacy agent names on contracts. */
  agentNames: string[]
}

export type ContractNextNumber = { contractNumber: number; contractPrefix: string; contractSuffix: string; year: number }

/** Row of GET /api/contracts/options (contract select of the payment dialogs). */
export type ContractOption = {
  id: number
  fullNumber: string
  /** "Договор №: 12" style text is built by the UI; label = full number. */
  label: string
  /** official name · organization · year. */
  hint: string
  officialName: string
  organization: string
  year: number
  status: ContractStatus
}

export type ContractInnInfo = { inn: string; name: string; address: string; source: "contract" | "client" | null }

/** Body of POST /api/contracts and PUT /api/contracts/[id] (demo ContractsCreateForm). */
export type ContractInput = {
  contractNumber?: number | null
  contractPrefix?: string
  contractSuffix?: string
  /** "YYYY-MM-DD" or local "YYYY-MM-DDTHH:mm[:ss]". */
  createdDate?: string
  officialName: string
  inn: string
  clientIds: number[]
  agentId: number
  status: ContractStatus
  comment?: string
  organizationId?: number | null
}

/** Row of POST /api/contracts/import (names are resolved on the server). */
export type ContractImportRow = {
  contractNumber?: string
  contractPrefix?: string
  contractSuffix?: string
  createdDate?: string
  officialName?: string
  inn?: string
  clients?: string
  agent?: string
  status?: string
  comment?: string
  organization?: string
}

export type ContractImportResult = { created: number; errors: Array<{ row: number; error: string }> }

/** prefix + number + suffix (demo full_number); legacy rows without a number use the id. */
export function contractFullNumber(row: { id: number; contractNumber: number | null; contractPrefix: string; contractSuffix: string }): string {
  return `${row.contractPrefix}${row.contractNumber ?? row.id}${row.contractSuffix}`
}
