// Shared (client + server) shapes and constants of "Сверка магазина через бот"
// (demo #/sales-market-balance, variant "client": one row per client) and
// "Сверка счетов" (demo #/client-balance, variant "account": one row per
// account of "Долги по счетам" = clients grouped by INN):
// GET /api/store-reconciliation (list + totals), …/options, …/messages,
// …/deadline, …/corrections, …/template, …/import.

import type { BalanceDateMode, FinanceCurrency } from "@/lib/finance/types"
import type { ClientBalanceOptions } from "@/lib/finance-client-balance-types"

/** "client" = shops (Сверка магазина через бот), "account" = accounts (Сверка счетов). */
export type ReconciliationVariant = "client" | "account"

export const RECONCILIATION_VARIANTS = ["client", "account"] as const

/** Bot reconciliation status of a client (demo message_status); null = "Не подключен". */
export type ReconciliationStatus = "pending" | "confirmed" | "rejected" | "not_send"

/** Demo CLIENT_BALANCE_STATUSES (module 229): filter values; "is_null" = no request yet. */
export const RECONCILIATION_STATUS_OPTIONS = [
  { value: "pending", label: "В ожидании" },
  { value: "is_null", label: "Не подключен" },
  { value: "confirmed", label: "Подтвержден" },
  { value: "rejected", label: "Отклонен" },
  { value: "not_send", label: "Не отправлено" },
] as const

export type ReconciliationStatusFilter = (typeof RECONCILIATION_STATUS_OPTIONS)[number]["value"]

export const RECONCILIATION_STATUS_VALUES = ["pending", "confirmed", "rejected", "not_send"] as const

/** Label (i18n key) of a status; null → "Не подключен". */
export function reconciliationStatusLabel(status: string | null): string {
  if (status === null) return "Не подключен"
  return RECONCILIATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Не указано"
}

/** Demo colours (4614): pending yellow, confirmed green, none blue, anything else red. */
export function reconciliationStatusColor(status: string | null): string {
  if (status === "pending") return "#f0ad4e"
  if (status === "confirmed") return "#81c784"
  if (status === null) return "rgb(79, 113, 220)"
  return "#e57373"
}

/** Demo CLIENT_BALANCE_ORDER_STATUSES (module 229) → orders.status values. */
export const ORDER_STATUS_OPTIONS = [
  { value: "1", label: "Есть на складе", status: "Есть на складе" },
  { value: "2", label: "Передан доставщику", status: "В пути" },
  { value: "3", label: "Доставлен", status: "Доставлено" },
] as const

/** Balance of one currency split by payment type (cash + bank = total). */
export type ReconciliationMoney = { cash: number; bank: number; total: number }

export type StoreReconciliationRow = {
  /** Entity key = the act's key: clients.id as text (variant client); "inn:<inn>"
   * or a client id (variant account, same keys as "Долги по счетам"). */
  key: string
  /** clients.id; null for an account grouping clients by INN. */
  id: number | null
  name: string
  info: { inn: string; phone: string; type: string; zone: string; agent: string; branch: string; created: string; clients: number }
  /** Clients summed into the row (one for a shop); names only on the returned page. */
  members: Array<{ id: number; name: string }>
  /** Status of the latest reconciliation request (null = none: "Не подключен"). */
  status: ReconciliationStatus | null
  /** Local date-time of the latest request / its confirmation. */
  statusDate: string | null
  confirmedDate: string | null
  /** "Срок долга" (YYYY-MM-DD) or null. */
  paymentDeadline: string | null
  lastOrder: string | null
  lastPayment: string | null
  /** Days since the last order / payment (today-relative), null = never. */
  orderDays: number | null
  paymentDays: number | null
  /** Balance converted to the base currency (currencies without a rate are left out). */
  total: number
  currencies: Record<string, ReconciliationMoney>
  /** Orders counted in the balance. */
  orders: number
}

/** Demo stats/client/balances: loaners (balance > 0) / borrowers (< 0) per currency. */
export type ClientBalanceSum = {
  currency: string
  label: string
  rate: number | null
  loaners_count: number
  loaners_sum: number
  loaners_sum_primary: number
  borrowers_count: number
  borrowers_sum: number
  borrowers_sum_primary: number
}

export type StoreReconciliationListResult = {
  /** Balance day ("Долг на определенную дату", default today). */
  asOf: string
  mode: BalanceDateMode
  baseCurrency: string
  /** Every currency (grid columns), demo order (by label). */
  currencies: FinanceCurrency[]
  /** Card currencies: non-zero totals, else the first. */
  visibleCurrencies: string[]
  count: number
  page: number
  pageSize: number
  rows: StoreReconciliationRow[]
  /** Per currency over all filtered rows. */
  totals: Record<string, ReconciliationMoney>
  /** Σ row totals in the base currency. */
  total: number
  balances: ClientBalanceSum[]
  /** Currencies with money but no rate (left out of the base totals). */
  missingRates: string[]
}

export type StoreReconciliationOptions = ClientBalanceOptions & {
  /** "Клиента создал" options (users). */
  users: string[]
  currencies: FinanceCurrency[]
  baseCurrency: string
}

export type ReconciliationMessage = {
  id: number
  /** Entity key of the request (client id as text, or the account key). */
  key: string
  status: ReconciliationStatus | null
  text: string
  asOf: string
  /** Telegram account the message went to (none: no bot is connected). */
  telegramUser: { firstName: string; secondName: string; phoneNumber: string } | null
  createdAt: string
  createdBy: string
  confirmedAt: string | null
}

export type ReconciliationMessagesResult = { count: number; page: number; pageSize: number; rows: ReconciliationMessage[]; botConnected: boolean }

// --- "Установить долг с Excel" ------------------------------------------------------

/** One data line of the uploaded template (cells as text). */
export type DebtImportLine = {
  /** 1-based sheet row number (for messages). */
  line: number
  id: string
  name: string
  organization: string
  amount: string
  cash: string
  bank: string
}

export type DebtImportRequest = {
  debtDate: string
  currency: string
  organizations: string[]
  byPaymentType: boolean
  mode: BalanceDateMode
  fileName?: string
  rows: DebtImportLine[]
  /** false = preview only. */
  commit: boolean
}

export type DebtImportRowResult = {
  line: number
  clientId: number | null
  name: string
  organization: string
  current: ReconciliationMoney | null
  target: { cash: number | null; bank: number | null; total: number | null }
  /** Corrections to write (0 = unchanged). */
  delta: ReconciliationMoney
  state: "change" | "same" | "skip" | "error"
  error?: string
}

export type DebtImportResult = {
  rows: DebtImportRowResult[]
  changed: number
  unchanged: number
  skipped: number
  errors: number
  committed: boolean
  corrections: number
  importId: number | null
}

/** Template sheet (GET /api/store-reconciliation/template). */
export type DebtTemplateResult = {
  header: string[]
  rows: Array<Array<string | number>>
  debtDate: string
  currency: string
}

/** Template header keys (Russian = i18n keys). */
export const TEMPLATE_HEADERS = {
  id: "ID",
  name: "Клиент",
  organization: "Организация",
  amount: "Сумма",
  cash: "Наличные",
  bank: "Перечисление",
} as const
