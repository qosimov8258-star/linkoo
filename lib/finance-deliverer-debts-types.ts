// Shared (client + server) types of the "Долги доставщиков" page
// (/analytics/supplier-debts, demo #/planning/?toggleType=prediction).
// Balances come from the shared ledger kinds "deliverer" and "agent"
// (GET /api/balances/deliverer | /api/balances/agent [/statement]); this file
// only describes the page's own endpoints under /api/balances/deliverer-debts.

/** GET /api/balances/deliverer-debts/options — values of the filter popup and the correction dialog. */
export type DelivererDebtsOptions = {
  /** "Филиалы": branches table first, then names used on employees / clients. */
  branches: string[]
  /** "Организация": organizations table first, then names used on money rows. */
  organizations: string[]
  /** "Тип клиента" (agents tab). */
  clientTypes: string[]
  /** "Создал" of the correction dialog: user display names and employee names. */
  users: string[]
  /** The current user may write corrections (role manager or admin). */
  canEdit: boolean
  /** Display name of the current user (default "Создал"). */
  currentUser: string
}

/** One "Корректировка" row (deliverer_balance_transactions). */
export type DelivererCorrection = {
  id: number
  employeeId: number
  employeeName: string
  /** Canonical currency code (SUM, USD, EUR, …). */
  currency: string
  /** Signed: + increases the deliverer's balance, − decreases it. */
  amount: number
  /** "cash" | "bank" | "" */
  paymentType: string
  organization: string
  /** Local business date-time "YYYY-MM-DDTHH:mm". */
  date: string
  comment: string
  createdBy: string
  createdAt: string
}
