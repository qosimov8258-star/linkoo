// Shared (client + server) types and constants of the cash core behind the
// "Финансы → Работа с кассой" pages (Управления кассой, Оплаты от клиентов,
// Оплаты поставщикам, Ожидаемые расходы, Ожидаемые оплаты, Расходы по
// категориям, Расходы на персонал). Client components may import this file
// and lib/cash/rates.ts; everything else in lib/cash is server-only.
//
// One money fact = one row in one table (the table that owns the counterparty):
//   cash_management_entries  plain income/expense, client withdrawal, cashback payout,
//                            supply-expense payment, staff payouts, transfer legs
//   customer_payments        client money (Kirim client/order, group income, agent collections)
//   supplier_payments        supplier money (Chiqim provider/supply, paid money requests, refunds)
//   cash_acceptances         header of an agent-cash acceptance ("Принято денег с …", type 8);
//                            the money itself stays in the accepted customer_payments rows
// The cash page list is a read-only UNION of the four (lib/cash/list.ts).

/** Demo transaction types (main.js module 0264). */
export const CASH_OP = {
  FROM_TRANSFER: 1,
  TO_TRANSFER: 2,
  ORDER: 3,
  INCOME: 4,
  OUTCOME: 5,
  INCOME_TO_CLIENT: 6,
  OUTCOME_FROM_CLIENT: 7,
  INCOME_FROM_AGENT: 8,
  SUPPLY_EXPENSE: 9,
  OUTCOME_FOR_SUPPLY: 10,
  /** Supplier income from the reference (shown without "Описание"); never created locally. */
  SUPPLIER_INCOME: 11,
  CLIENT_CONTRACT_OUT: 22,
} as const

export type CashOpType = (typeof CASH_OP)[keyof typeof CASH_OP]

export const CASH_OP_TYPES: readonly CashOpType[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22]

/** Russian label (= i18n key) of every type: "Описание" of the list and the type filter. */
export const CASH_OP_LABELS: Record<CashOpType, string> = {
  1: "Перевод с кассы",
  2: "Перевод на кассу",
  3: "Оплата заказа",
  4: "Приход",
  5: "Расход",
  6: "Приход на счет клиента",
  7: "Снято со счета клиента",
  8: "Приемка наличных с агента",
  9: "Доп. расход на поставку",
  10: "Расход на поставку",
  11: "",
  22: "Выдача денег для Кэшбека",
}

/** Category option keys (demo main/options; the demo's misspelled
 * "supply_expanse" is read as "supply_expense"). A category may carry several;
 * the FIRST one decides which panel the Приход/Расход dialog shows. */
export const CATEGORY_OPTION_KEYS = [
  "client",
  "client_card_out",
  "client_contract",
  "provider",
  "supply",
  "order",
  "supply_expense",
  "staff_expense",
  "staff_income",
  "transaction_child",
  "amortization",
] as const

export type CategoryOptionKey = (typeof CATEGORY_OPTION_KEYS)[number]

export type CategoryOptionInfo = {
  key: CategoryOptionKey
  /** Russian title (= i18n key), as the demo option list names it. */
  title: string
  /** Dialogs where the option has an effect. */
  income: boolean
  expense: boolean
  /** What the dialog must collect when this option is the category's first option. */
  requires: "client" | "provider" | "supply" | "order" | "supply_expense" | "staff" | "children" | null
}

export const CATEGORY_OPTIONS: Record<CategoryOptionKey, CategoryOptionInfo> = {
  client: { key: "client", title: "Клиент", income: true, expense: true, requires: "client" },
  client_card_out: { key: "client_card_out", title: "Карта клиента", income: false, expense: true, requires: "client" },
  client_contract: { key: "client_contract", title: "Выдача денег для Кэшбек", income: false, expense: true, requires: "client" },
  provider: { key: "provider", title: "Поставщик", income: true, expense: true, requires: "provider" },
  supply: { key: "supply", title: "Поставка", income: false, expense: true, requires: "supply" },
  order: { key: "order", title: "Заказ", income: true, expense: false, requires: "order" },
  supply_expense: { key: "supply_expense", title: "Доп. расход", income: false, expense: true, requires: "supply_expense" },
  staff_expense: { key: "staff_expense", title: "Расход на сотрудников", income: false, expense: true, requires: "staff" },
  staff_income: { key: "staff_income", title: "Возврат от сотрудников", income: true, expense: false, requires: "staff" },
  transaction_child: { key: "transaction_child", title: "Детализация", income: true, expense: true, requires: "children" },
  amortization: { key: "amortization", title: "Амортизация", income: true, expense: true, requires: null },
}

/** income_categories.parameter / expense_categories.parameter (single Russian
 * label written by the categories pages) → option keys. Keep in sync with the
 * SQL function cash_param_options() in lib/cash/schema.ts. */
export const PARAMETER_OPTIONS: Record<string, CategoryOptionKey[]> = {
  "детализация": ["transaction_child"],
  "клиент": ["client"],
  "заказ": ["order"],
  "доп. расход": ["supply_expense"],
  "расход на сотрудников": ["staff_expense"],
  "поставка": ["supply", "provider"],
  "поставщик": ["provider"],
  "карта клиента": ["client_card_out"],
  "выдача денег для кэшбек": ["client_contract"],
  "кэшбек": ["client_contract"],
  "амортизация": ["amortization"],
  "возврат от сотрудников": ["staff_income"],
}

/** Normalises any option list (JSON text, array, demo spelling) to known keys, unique, in order. */
export function normalizeOptions(value: unknown): CategoryOptionKey[] {
  let list: unknown = value
  if (typeof value === "string") {
    try {
      list = JSON.parse(value)
    } catch {
      list = []
    }
  }
  const out: CategoryOptionKey[] = []
  for (const item of Array.isArray(list) ? list : []) {
    const raw = typeof item === "object" && item !== null ? (item as { key_name?: unknown; key?: unknown }).key_name ?? (item as { key?: unknown }).key : item
    const key = String(raw ?? "").trim().toLowerCase().replace("supply_expanse", "supply_expense") as CategoryOptionKey
    if ((CATEGORY_OPTION_KEYS as readonly string[]).includes(key) && !out.includes(key)) out.push(key)
  }
  return out
}

/** Options of a category parameter label (or a raw key). */
export function optionsOfParameter(parameter: string | null | undefined): CategoryOptionKey[] {
  const key = String(parameter ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  if (!key) return []
  return PARAMETER_OPTIONS[key] ?? normalizeOptions([key])
}

/** "reference" = archived reference operations (cash_reference_rows, list-only, read-only). */
export type CashSource = "cash" | "customer" | "supplier" | "acceptance" | "reference"

/** Operation key "<source>-<id>" (URL-safe): cash-12, customer-5, supplier-3, acceptance-2. */
export type CashOperationKey = `${CashSource}-${number}`

export function operationKey(source: CashSource, id: number): CashOperationKey {
  return `${source}-${id}`
}

export function parseOperationKey(key: string): { source: CashSource; id: number } | null {
  const match = /^(cash|customer|supplier|acceptance|reference)-(\d{1,10})$/.exec(String(key ?? "").trim())
  if (!match) return null
  const id = Number(match[2])
  // Rows ids are INTEGER (int4): a larger id cannot exist.
  return id > 0 && id <= 2_147_483_647 ? { source: match[1] as CashSource, id } : null
}

export type CashPaymentType = "cash" | "bank"

export type CashboxWithBalance = {
  id: number
  name: string
  /** 'cash' (наличные) | 'bank' (банковский счет). */
  type: CashPaymentType
  currency: string
  cashier: string
  branch: string
  vansell: boolean
  /** cashboxes.order_number (demo `position`), list order. */
  position: number
  /** All-time ledger end balance (verified, not deleted) = Баланс кассы. */
  balance: number
}

export type CashboxListResult = {
  baseCurrency: string
  cashboxes: CashboxWithBalance[]
  /** Σ balance per currency over all cashboxes. */
  totals: Record<string, number>
}

export type CashRef = { id: number | null; name: string }

/** One row of the "Управления кассой" list (any source). Amounts are in the
 * cashbox currency, signed from the cashbox's point of view (+ in, − out). */
export type CashOperation = {
  key: CashOperationKey
  source: CashSource
  /** Row id in its source table. */
  id: number
  /** Shared "№" (unique across sources). */
  docNo: number
  type: CashOpType
  /** Russian label of the type (i18n key). */
  title: string
  /** Local business date-time "YYYY-MM-DDTHH:mm:ss" (Указанная дата). */
  date: string
  /** Local creation date-time. */
  createdAt: string
  createdBy: string
  cashbox: { id: number; name: string; type: CashPaymentType; currency: string; branch: string }
  amount: number
  currency: string
  /** Amount in the base currency (stored at creation, else converted at current rates); null = unknown rate. */
  baseAmount: number | null
  baseCurrency: string
  /** Base units per 1 cashbox-currency unit used (custom/stored rate, else current). */
  rate: number | null
  /** Debt side of client/supplier money when it differs from the cash side ("Индивидуальная покрытия долга"). */
  debtAmount: number | null
  debtCurrency: string
  client: CashRef | null
  supplier: CashRef | null
  category: { id: number | null; name: string; kind: "income" | "expense" | ""; options: CategoryOptionKey[] } | null
  branch: string
  organization: string
  comment: string
  /** "Ответственный персонал" / acceptance agent. */
  employee: CashRef | null
  /** Transfer legs: the other cashbox and the transfer header. */
  transfer: { id: number | null; otherCashbox: string; accumulatedFrom: string; accumulatedTo: string } | null
  orderId: number | null
  supplyId: number | null
  supplyExpenseId: number | null
  moneyRequestId: number | null
  contract: string
  amortization: { from: string; to: string } | null
  isVerified: boolean
  isDeleted: boolean
  verifiedAt: string
  deletedAt: string
  /** Detalization lines / staff allocations exist (popups). */
  hasChildren: boolean
  hasStaff: boolean
  /** Number of agent payments in an acceptance (type 8). */
  paymentCount: number
  /** Demo row-menu rules: edit/duplicate disabled for transfers; type 8 edits through the acceptance dialog. */
  canEdit: boolean
  canDuplicate: boolean
  canDelete: boolean
  canPrint: boolean
}

export type CashListResult = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  rows: CashOperation[]
}

export type CashTotalsRow = {
  currency: string
  income: number
  outcome: number
  total: number
  types: Array<{ type: CashPaymentType; income: number; outcome: number }>
}

export type CashTotalsResult = { baseCurrency: string; totals: CashTotalsRow[] }

/** Body of create / edit / duplicate (Приход / Расход dialog). Amounts > 0; the sign comes from `kind`. */
export type CashOperationInput = {
  kind: "income" | "expense"
  /** "YYYY-MM-DD" or local "YYYY-MM-DDTHH:mm[:ss]"; default now. */
  date?: string
  cashboxId: number
  branch?: string
  organization?: string
  /** income_categories.id (income) / expense_categories.id (expense); required except when paying a money request. */
  categoryId?: number
  /** In the cashbox currency; ignored when staff / children are given (Σ of them). */
  amount?: number
  comment?: string
  /** "Подтвержденный приход/расход"; default true. */
  isVerified?: boolean
  clientId?: number
  contractId?: number
  orderId?: number
  supplierId?: number
  supplyId?: number
  supplyExpenseId?: number
  /** "Ответственный персонал" (employees.id). */
  responsibleId?: number
  staff?: Array<{ employeeId: number; amount: number }>
  children?: Array<{ name: string; amount: number }>
  amortizationFrom?: string
  amortizationTo?: string
  /** "Индивидуальная покрытия долга": currency credited to the client / supplier (default = cashbox currency). */
  debtCurrency?: string
  /** current = currencies.rate, order = same (no order rates stored), custom = customRate / debtRate. */
  rateType?: "current" | "order" | "custom"
  /** Base units per 1 cashbox-currency unit ("Курс кассы"). */
  customRate?: number
  /** Base units per 1 debt-currency unit ("Курс долга"). */
  debtRate?: number
  /** Expense only: pays this approved money request (amount / supplier / currency come from it). */
  moneyRequestId?: number
}

export type CashWriteResult = { key: CashOperationKey; source: CashSource; id: number; docNo: number }

export type CashTransferInput = {
  fromCashboxId: number
  toCashboxId: number
  fromOrganization?: string
  toOrganization?: string
  /** Default: the cashbox branch. */
  fromBranch?: string
  toBranch?: string
  /** Taken from the source cashbox (> 0, source currency). */
  amountFrom: number
  /** Received by the target; computed when omitted (see transferAmountTo in lib/cash/rates.ts). */
  amountTo?: number
  /** Different currencies: see transferAmountTo. */
  rate?: number
  /** Same currency, cash ↔ bank: share received in % (demo "Процент", default 100). */
  percentage?: number
  date?: string
  comment?: string
  /** "Деньги накопленные за период" (ISO days). */
  accumulatedFrom?: string
  accumulatedTo?: string
}

export type CashTransferResult = {
  transferId: number
  docNo: number
  from: CashWriteResult
  to: CashWriteResult
  amountFrom: number
  amountTo: number
  rate: number | null
}

/** Agent collections waiting for "Принять деньги" (customer_payments accepted = 0 without a cashbox). */
export type AcceptGroup = {
  /** Opaque group id; pass back the fields below (not the key) to accept / list payments. */
  key: string
  agent: string
  currency: string
  organization: string
  branch: string
  agentCashbox: CashRef | null
  amount: number
  count: number
}

export type AcceptGroupFilter = {
  agent: string
  currency: string
  organization: string
  branch: string
  /** null / 0 / omitted = "Не указано". */
  agentCashboxId?: number | null
  from?: string
  to?: string
}

export type AgentPayment = {
  id: number
  docNo: number
  client: CashRef
  agent: string
  agentCashbox: CashRef | null
  cashbox: CashRef | null
  branch: string
  organization: string
  /** Local "YYYY-MM-DDTHH:mm:ss" of the payment. */
  date: string
  acceptedAt: string
  acceptedBy: string
  orderId: number | null
  /** Cash side as collected (real_amount / real_currency). */
  amount: number
  currency: string
  /** Cash side in the accepting cashbox currency (converted at current rates when it differs); null while not in a cashbox. */
  cashboxAmount: number | null
  /** Credited to the client (amount / currency). */
  debtAmount: number
  debtCurrency: string
  baseAmount: number | null
  rate: number | null
  comment: string
  accepted: boolean
}

export type AcceptanceDetail = {
  id: number
  docNo: number
  key: CashOperationKey
  cashbox: CashRef & { currency: string }
  agent: string
  agentCashbox: CashRef | null
  organization: string
  branch: string
  deliveryMan: string
  date: string
  comment: string
  createdBy: string
  createdAt: string
  isDeleted: boolean
  amount: number
  currency: string
  payments: AgentPayment[]
}

export type MoneyRequestStatus = "pending" | "approved" | "given" | "cancelled"

export const MONEY_REQUEST_STATUSES: readonly MoneyRequestStatus[] = ["pending", "approved", "given", "cancelled"]

/** Russian labels (i18n keys) of the demo status chips. */
export const MONEY_REQUEST_STATUS_LABELS: Record<MoneyRequestStatus, string> = {
  pending: "В ожидании",
  approved: "Подтвержден",
  given: "Оплачен",
  cancelled: "Отменен",
}

export type MoneyRequestLog = { status: MoneyRequestStatus | "created" | "edited"; comment: string; user: string; at: string; amount?: number; currency?: string }

export type MoneyRequest = {
  /** Ordinal among all fund requests (the "№" column of the reference). */
  number?: number
  id: number
  supplier: CashRef
  amount: number
  currency: string
  comment: string
  status: MoneyRequestStatus
  createdBy: string
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  responsibleUser: string
  approvedAt: string
  payment: { key: CashOperationKey; docNo: number } | null
  /** Supplier balance in the request currency (today): end balance, reserve, remain = balance + reserve. */
  balances: { balance: number; reserve: number; remain: number }
  logs: MoneyRequestLog[]
}

export type ConvertResult = {
  from: string
  to: string
  amount: number
  /** amount converted into `to`; null when a rate is unknown. */
  result: number | null
  /** Units of `to` per 1 unit of `from`. */
  rate: number | null
  /** Base units per 1 unit (as used). */
  fromRate: number | null
  toRate: number | null
  baseCurrency: string
  /** Currencies without a rate. */
  missing: string[]
}

export type CashReceipt = {
  key: CashOperationKey
  docNo: number
  type: CashOpType
  title: string
  createdAt: string
  date: string
  cashbox: string
  organization: string
  /** "Перевод" for transfers, else the category name. */
  category: string
  direction: "income" | "expense"
  rows: Array<{ n: number; name: string; amount: number; currency: string; rate: number | null; baseAmount: number | null }>
  total: number | null
  baseCurrency: string
}
