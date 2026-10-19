// Shared (client-safe) types of "Запросы на снятие кэшбэка" (demo #/cashback-requests,
// GET/PUT telegram/cashback_request/). Server code: lib/cashback-withdrawal-requests-repo.ts.

/** Demo statuses (chunk 137, modules 5157 / 5158). */
export type CashbackRequestStatus = "pending" | "confirmed" | "rejected"

export const CASHBACK_REQUEST_STATUSES: readonly CashbackRequestStatus[] = ["pending", "confirmed", "rejected"]

/** Russian label (= i18n key); anything else → "Не указано" like the demo ternary. */
export const CASHBACK_REQUEST_STATUS_LABELS: Record<CashbackRequestStatus, string> = {
  pending: "В ожидании",
  confirmed: "Подтверждено",
  rejected: "Отклонено",
}

export function cashbackRequestStatusLabel(status: string | null | undefined): string {
  return status && status in CASHBACK_REQUEST_STATUS_LABELS ? CASHBACK_REQUEST_STATUS_LABELS[status as CashbackRequestStatus] : "Не указано"
}

export type CashbackRequestCurrency = { code: string; label: string }

/** The cash-core operation that paid the request out (op 22 "Выдача денег для кэшбека"). */
export type CashbackRequestPayout = {
  /** cash_management_entries.id (operation key "cash-<id>"). */
  entryId: number
  /** Shared cash document № (links to /analytics/cash-management?search=<docNo>). */
  docNo: number | null
  cashbox: string
  /** Paid amount (> 0) in the cashbox currency as it is now (it can be edited on the cash page). */
  amount: number
  currency: string
}

export type CashbackRequestRow = {
  id: number
  client: { id: number | null; name: string; exists: boolean }
  amount: number
  /** Canonical currency code (SUM, USD, EUR …). */
  currency: string
  /** Effective status: a confirmed request whose payout was deleted on the cash page reads as "pending" again. */
  status: CashbackRequestStatus
  /** Set when the stored status is "confirmed" but the linked payout no longer exists (it was deleted / re-routed). */
  cancelledPayoutDocNo: number | null
  /** Cashbox chosen at confirmation (demo `cashbox`). */
  cashbox: { id: number; name: string; type: "cash" | "bank" } | null
  payout: CashbackRequestPayout | null
  comment: string
  /** telegram | manager | api … (who created the request). */
  source: string
  createdAt: string | null
  createdBy: string
  decidedAt: string | null
  decidedBy: string
}

export type CashbackRequestListResult = {
  count: number
  page: number
  pageSize: number
  rows: CashbackRequestRow[]
  /** Filter choices: system currencies + codes seen in requests. */
  currencies: CashbackRequestCurrency[]
  baseCurrency: string
}

export type CashbackRequestCashbox = { id: number; name: string; type: "cash" | "bank"; currency: string; balance: number }

export type CashbackRequestDetail = {
  request: CashbackRequestRow
  /** The client's cashback balance in the request currency (loyalty_card_transactions). */
  balance: number
  /** Σ amount of the client's OTHER pending requests in the same currency. */
  reserved: number
  /** Cashboxes in the request currency (demo CashboxSearchField params {currency}). */
  cashboxes: CashbackRequestCashbox[]
}

export type CashbackRequestDecision = { status: "confirmed"; cashboxId: number } | { status: "rejected" }
