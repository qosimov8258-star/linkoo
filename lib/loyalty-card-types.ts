// Shared (client-safe) types of "Накопительная карта" (demo #/cumulative,
// GET sales/cash_back/). Server code: lib/loyalty-card-repo.ts.

/** Demo CASH_BACK_TYPES: accrual by a cashback promotion, payout, manual bonus (custom_price). */
export type CashbackType = "payment" | "withdraw" | "additional"

export const CASHBACK_TYPE_LABELS: Record<CashbackType, string> = {
  payment: "Оплата",
  withdraw: "Снятие денег",
  additional: "Дополнительный бонус",
}

/** Demo getCashBackType(type) || "Не указано". */
export function cashbackTypeLabel(type: string | null | undefined): string {
  return type && type in CASHBACK_TYPE_LABELS ? CASHBACK_TYPE_LABELS[type as CashbackType] : "Не указано"
}

export type LoyaltyCurrency = { code: string; label: string }

export type LoyaltyCardRow = {
  /** clients.id (also for movements whose client was deleted: exists = false). */
  id: number
  name: string
  exists: boolean
  /** Local "YYYY-MM-DDTHH:mm:ss" of the last cashback movement (demo last_created), null = none. */
  lastCreated: string | null
  /** Cashback balance per canonical currency code; a currency without movements is absent (demo price null). */
  balances: Record<string, number>
}

export type LoyaltyCurrencyTotal = { positive: number; negative: number; net: number }

export type LoyaltyCardListResult = {
  count: number
  page: number
  pageSize: number
  rows: LoyaltyCardRow[]
  /** Columns: every system currency + codes seen in movements, ordered by label (Euro, SUM, USD). */
  currencies: LoyaltyCurrency[]
  baseCurrency: string
  /** Over the filtered clients. */
  totals: Record<string, LoyaltyCurrencyTotal>
  /** Σ max(0, balance) × rate over the filtered clients, in the base currency — the management
   * balance's "Кешбэк покупателей" (as of today) when no filter is applied. */
  cashbackBase: number
  /** Currencies with a positive balance but no rate (left out of cashbackBase, as in the management balance). */
  missingRates: string[]
}

export type LoyaltyHistoryRow = {
  id: number
  type: CashbackType | null
  /** Promotion name (demo promotion.name); empty — this app has no promotions. */
  promotion: string
  /** Local "YYYY-MM-DDTHH:mm:ss" (created_at), null when unparseable. */
  date: string | null
  amount: number
  currency: string
  comment: string
  createdBy: string
  /** Cash payout (op 22) the movement belongs to. */
  payout: { entryId: number; docNo: number | null; cashbox: string } | null
}

export type LoyaltyCardDetail = {
  client: { id: number; name: string; exists: boolean }
  balances: Record<string, number>
  currencies: LoyaltyCurrency[]
  count: number
  page: number
  pageSize: number
  rows: LoyaltyHistoryRow[]
}

export type LoyaltyCardOptions = {
  clientTypes: string[]
  currencies: LoyaltyCurrency[]
  baseCurrency: string
}

export type LoyaltyTransactionResult = {
  id: number
  clientId: number
  amount: number
  currency: string
  balances: Record<string, number>
}
