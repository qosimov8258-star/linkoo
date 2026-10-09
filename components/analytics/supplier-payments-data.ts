// Shared (client + server) types of "Оплаты поставщикам" (demo
// #/provider-transaction) and of the supply card payments dialog ("Список
// оплат по поставке №N"). Rows are supplier_payments written by the cash core
// (cash page «Расход» with a provider / supply category, paid money requests);
// provider refunds (op 4) and soft-deleted rows are never listed.

export type SupplierPaymentType = "cash" | "bank"

/** One line of the "Оплаты поставщикам" list. */
export type SupplierPaymentItem = {
  /** supplier_payments.id (the "№" column, as the balance pages show it). */
  id: number
  /** Shared cash "№" (doc_no): the cash page link searches by it. */
  docNo: number | null
  /** Cash operation type: 5 Расход, 10 Расход на поставку. */
  type: number
  /** Local business date-time "YYYY-MM-DDTHH:mm:ss" ("Дата оплаты"). */
  date: string
  createdBy: string
  supplier: { id: number | null; name: string }
  organization: string
  branch: string
  /** Credited to the supplier ("Сумма"): amount / currency. */
  amount: number
  currency: string
  /** Base-currency equivalent and the rate used (base units per 1 unit); null = same as base / unknown. */
  baseAmount: number | null
  rate: number | null
  /** Taken from the cashbox ("Сумма в кассе"); null when the payment has no cash side. */
  cash: { amount: number; currency: string; baseAmount: number | null; rate: number | null } | null
  /** Cashbox ("Касса"); `linked` = the operation is in the cash page list (clickable). */
  cashbox: { id: number | null; name: string; linked: boolean } | null
  /** cashbox type: "наличные" / "банковский счет" icon. */
  paymentType: SupplierPaymentType
  category: string
  comment: string
  supplyId: number | null
  moneyRequestId: number | null
  /** Unverified payments are listed but not counted (totals, balances). */
  isVerified: boolean
}

export type SupplierPaymentsTotal = { currency: string; total: number; count: number }

export type SupplierPaymentsResult = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  rows: SupplierPaymentItem[]
  /** Σ "Сумма" per currency of the filtered, verified rows (the blue strip). */
  totals: SupplierPaymentsTotal[]
}

export type SupplierPaymentsOptions = {
  baseCurrency: string
  organizations: string[]
  branches: string[]
  suppliers: Array<{ id: number; name: string }>
  currencies: string[]
}

/** One payment of the supply card dialog ("Список оплат по поставке №N"). */
export type SupplyPaymentItem = {
  id: number
  docNo: number | null
  type: number
  date: string
  supplier: string
  createdBy: string
  comment: string
  amount: number
  currency: string
  baseAmount: number | null
  rate: number | null
  /** "На поставку": the amount in the supply currency. */
  allocated: number
  cashbox: string
}

export type SupplyPaymentsResult = {
  supplyId: number
  supplyCurrency: string
  baseCurrency: string
  /** Supply cost (supplier_incomings.amount). */
  total: number
  /** Σ allocated ("Оплачено"). */
  paid: number
  rows: SupplyPaymentItem[]
}

/** Russian label (i18n key) of a supplier payment by cash operation type: 10 = paid for a supply. */
export function supplierPaymentTitle(type: number): string {
  return type === 10 ? "Расход на поставку" : "Оплата поставщику"
}
