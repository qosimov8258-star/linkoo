// Shared (client + server) shapes of "Кассы" (demo #/cashbox, API finance/cashbox/).
// Storage rules live in lib/cashboxes-repo.ts: `cashboxes.cashier` keeps the
// cashier's display name (the ledger matches it to employees by name) next to
// `cashier_id`; `payment_type` keeps the Russian label ("наличный" /
// "банковский счет") that the cash core maps to cash / bank.

/** 'cash' (наличный) | 'bank' (банковский счет) — demo `type`. */
export type CashboxType = "cash" | "bank"

/** Element of the plain GET /api/cashboxes array (every cashbox select of the app). */
export type Cashbox = {
  id: number
  name: string
  /** Currency code as stored (SUM, USD, EUR …). */
  currency: string
  /** Cashier display name (employee "First Last"). */
  cashier: string
  /** employees.id of the cashier; null for rows saved before the link existed. */
  cashierId: number | null
  /** Branch name ("" = not set). */
  branch: string
  /** Russian label: "наличный" | "банковский счет". */
  paymentType: string
  type: CashboxType
  vansell: boolean
  /** Demo `position` ("Порядковый номер"); null = "Не указано". */
  orderNumber: number | null
  createdAt: string
}

/** GET /api/cashboxes?page=&pageSize=&search= (demo {count, results}). */
export type CashboxListResult = { count: number; results: Cashbox[] }

/** Where a cashbox is referenced (label = Russian i18n key of the section). */
export type CashboxUsage = { table: string; label: string; count: number }

/** GET /api/cashboxes/[id] (`usage` only with ?usage=1). */
export type CashboxDetail = Cashbox & { usage?: CashboxUsage[] }

/** GET /api/cashboxes/options — the selects of the create / update dialog. */
export type CashboxOptions = {
  currencies: Array<{ code: string; label: string; name: string }>
  employees: Array<{ id: number; name: string; position: string; active: boolean }>
  branches: Array<{ id: number; name: string }>
}

/** Body of POST /api/cashboxes and PUT /api/cashboxes/[id]. */
export type CashboxPayload = {
  name: string
  currency: string
  cashierId?: number | null
  /** Cashier name (Excel import, old callers); resolved to an employee by the server. */
  cashier?: string
  branchId?: number | null
  /** Branch name (Excel import, old callers). */
  branch?: string
  /** cash | bank | наличный | банковский счет. */
  paymentType: string
  vansell: boolean
  orderNumber: number | string | null
}

export type CashboxField = "name" | "currency" | "cashier" | "branch" | "paymentType" | "orderNumber"

/** Error body of the cashbox endpoints (`fields` = inline errors of the dialog). */
export type CashboxErrorBody = {
  error?: string
  fields?: Partial<Record<CashboxField, string>>
  usage?: CashboxUsage[]
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

export const CASHBOXES_API = "/api/cashboxes"
export const CASH_MANAGEMENT_URL = "/analytics/cash-management"

/** Stored labels (also the i18n keys of the "Тип" column). */
export const CASHBOX_TYPE_LABELS: Record<CashboxType, string> = { cash: "наличный", bank: "банковский счет" }

/** Lower-case, trimmed, collapsed whitespace — same as SQL fin_key(). */
export function cashboxNameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Tolerant payment type reader (old rows: "наличный", "банковский счет", "cash", "bank", …).
 * Same prefixes as fin_pt() / paymentKind() of the cash core; null when unknown. */
export function cashboxTypeOf(value: unknown): CashboxType | null {
  const key = cashboxNameKey(value)
  if (/^(нал|cash|naq|nagt)/.test(key)) return "cash"
  if (/^(банк|bank|card|карт|переч|o'tkaz|otkaz|transfer)/.test(key)) return "bank"
  return null
}
