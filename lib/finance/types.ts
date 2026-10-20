// Shared (client + server) types of the finance ledger model behind the
// "Финансы → Баланс" pages. Every balance is reported per entity per
// currency: begin_balance (everything dated before `from`), the demo's
// movement columns inside [from, to], and end_balance = begin + movements.
// Server code lives in lib/finance/*.ts files marked "server-only"; client
// components may import only this file, currency.ts and dates.ts.

export type BalanceEntityKind = "cashbox" | "client" | "account" | "supplier" | "vansell" | "branch" | "employee" | "deliverer" | "agent"

export const BALANCE_ENTITY_KINDS: readonly BalanceEntityKind[] = ["cashbox", "client", "account", "supplier", "vansell", "branch", "employee", "deliverer", "agent"]

/** Movement columns per entity kind, in the demo's column order and with the
 * demo's field names. Sign of each column (see MOVEMENT_SIGNS) is the sign the
 * amount normally has; manual corrections may cross zero. */
export const MOVEMENT_COLUMNS = {
  cashbox: ["income", "expenses", "transfer_income", "transfer_expense"],
  client: ["order", "order_return", "payment", "none_type_plus", "none_type_minus"],
  account: ["order", "order_return", "payment", "none_type_plus", "none_type_minus"],
  supplier: ["supply", "supply_return", "supply_expense", "payment", "none_type_plus", "none_type_minus"],
  vansell: ["stock_transfer_minus", "stock_transfer_plus", "cash_transfer_plus", "bank_transfer_plus", "order_return_plus", "none_type_plus", "none_type_minus"],
  branch: ["stock_transfer_minus", "stock_transfer_plus", "payments", "none_type_plus", "none_type_minus"],
  employee: ["monthly", "performance_bonus", "payment", "penalty", "none_type"],
  // "Долги доставщиков": the client ledger re-keyed by delivery man + his corrections.
  deliverer: ["order", "order_return", "payment", "none_type"],
  // "Долги агентов": client balances rolled up by the clients' responsible agent.
  agent: ["order", "order_return", "payment", "none_type_plus", "none_type_minus"],
} as const satisfies Record<BalanceEntityKind, readonly string[]>

export type MovementColumn<K extends BalanceEntityKind = BalanceEntityKind> = (typeof MOVEMENT_COLUMNS)[K][number]

/** Order statuses that are neither a sale nor a debt anywhere in finance
 * (Баланс клиентов: "Все заказы (кроме неподтвержденных и отмененных заказов)"). */
export const ORDER_EXCLUDED_STATUSES = ["Отменен", "Не подтвержден"] as const

/** Released (shipped) order statuses: the goods left the warehouse, the order is realized. */
export const ORDER_RELEASED_STATUSES = ["В пути", "Доставлено"] as const

/** "+" = column is normally positive, "-" = normally negative, "±" = either. */
export const MOVEMENT_SIGNS: Record<string, "+" | "-" | "±"> = {
  income: "+",
  expenses: "-",
  transfer_income: "+",
  transfer_expense: "-",
  order: "-",
  order_return: "+",
  payment: "+",
  none_type_plus: "+",
  none_type_minus: "-",
  supply: "-",
  supply_return: "+",
  supply_expense: "-",
  stock_transfer_minus: "-",
  stock_transfer_plus: "+",
  cash_transfer_plus: "+",
  bank_transfer_plus: "+",
  order_return_plus: "+",
  payments: "+",
  monthly: "+",
  performance_bonus: "+",
  penalty: "-",
  none_type: "±",
}

/** Russian UI label (= i18n key) of every movement column per kind, as the
 * demo table headers name them. */
export const MOVEMENT_LABELS: { [K in BalanceEntityKind]: Record<MovementColumn<K>, string> } = {
  cashbox: {
    income: "Приход за период",
    expenses: "Расход за период",
    transfer_income: "Перевод на кассу",
    transfer_expense: "Перевод с кассы",
  },
  client: {
    order: "Продано",
    order_return: "Возврат",
    payment: "Оплачено",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
  account: {
    order: "Продано",
    order_return: "Возврат",
    payment: "Оплачено",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
  supplier: {
    supply: "Поставки",
    supply_return: "Возврат",
    supply_expense: "Расходы",
    payment: "Оплачено",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
  vansell: {
    stock_transfer_minus: "Передача на склад",
    stock_transfer_plus: "Возврат передачи",
    cash_transfer_plus: "Наличные",
    bank_transfer_plus: "Перечисление",
    order_return_plus: "Отход",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
  branch: {
    stock_transfer_minus: "Передача на склад",
    stock_transfer_plus: "Возврат передачи",
    payments: "Оплата",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
  employee: {
    monthly: "Зарплата",
    performance_bonus: "Зачислено KPI",
    payment: "Введено с кассы",
    penalty: "Штрафы",
    none_type: "Коректировки",
  },
  deliverer: {
    order: "Отгрузка (Заказы)",
    order_return: "Возврат",
    payment: "Оплачено",
    none_type: "Корректировка",
  },
  agent: {
    order: "Продано",
    order_return: "Возврат",
    payment: "Оплачено",
    none_type_plus: "Прочие приходы",
    none_type_minus: "Прочие расходы",
  },
}

export type FinanceCurrency = {
  /** Canonical code: SUM | USD | EUR | any other upper-case code. */
  code: string
  /** Label the demo shows next to amounts: "SUM", "USD", "Euro". */
  label: string
  /** currencies.name when the currency exists in the currencies table. */
  name: string
  /** Units of base currency per 1 unit (current rate, no history); null = unknown. */
  rate: number | null
  isBase: boolean
  /** currencies.id, or null for a currency only seen in money rows. */
  id: number | null
}

/** One currency of one entity (or of the totals), keyed by field name.
 * Always contains begin_balance, end_balance and every movement column of the
 * kind (0 when there is nothing). end_balance = begin_balance + Σ movement
 * columns. Kind extras:
 * - client/account: not_accepted_payment (Σ customer_payments with accepted=0
 *   in the period; already included in `payment` in "created" mode);
 * - supplier: money_request (Σ pending fund requests, all time), reserve
 *   (Σ suppliers.products qty*price), remain (= end_balance + reserve). */
export type CurrencyBalance = Record<string, number> & { begin_balance: number; end_balance: number }

export type BalanceInfoValue = string | number | null

export type BalanceRow = {
  /** Stable key: String(id) for DB rows; "name:<name>" for a supplier only
   * referenced by documents; "inn:<inn>" for an account grouping clients;
   * "type:<type>" in client-type mode. Pass it back as `key` to statements. */
  key: string
  /** Primary DB id (cashboxes.id, clients.id, suppliers.id, employees.id,
   * branches.id) or null for virtual rows. */
  id: number | null
  name: string
  /** Kind-specific attributes, see ENTITY_INFO in foundation.md. */
  info: Record<string, BalanceInfoValue>
  /** Keyed by currency code; every code of BalanceListResult.currencies is present. */
  currencies: Record<string, CurrencyBalance>
  /** Account rows ("inn:…") and client-type rows ("type:…"): the clients.id values summed into the row. */
  members?: number[]
}

export type BalanceListResult = {
  kind: BalanceEntityKind
  from: string
  to: string
  mode: BalanceDateMode
  baseCurrency: string
  /** All currencies (currencies table ∪ codes seen in money rows), base first, then by id. */
  currencies: FinanceCurrency[]
  /** Demo rule: codes with any non-zero value in `totals`; if none, the first currency. */
  visibleCurrencies: string[]
  /** Number of rows after all filters (before paging). */
  count: number
  page: number
  pageSize: number
  rows: BalanceRow[]
  /** Per-currency sums over the filtered rows (see totalsIgnoreSearch). */
  totals: Record<string, CurrencyBalance>
}

/** "created" = by transaction creation date (demo "По дате создание
 * транзакции"); "realization" = by realization date, only realized orders and
 * accepted payments (demo "По дате реализации"). Only clients/accounts differ. */
export type BalanceDateMode = "created" | "realization"

export type StatementRow = {
  /** `${source}:${sourceId}:${currency}` (unique within a statement). */
  id: string
  /** Source table tag, see SOURCE_TAGS in foundation.md. */
  source: string
  sourceId: number | null
  /** Local (Asia/Tashkent) date-time "YYYY-MM-DDTHH:mm:ss". */
  date: string
  /** Movement column this row is summed into. */
  column: string
  /** Russian i18n key describing the row type ("Заказ", "Оплата", ...). */
  title: string
  /** Document number to print after the title ("Заказ № 12"), or "". */
  docNumber: string
  /** Free text stored on the source row (cash entry description, ...). */
  description: string
  comment: string
  category: string
  counterparty: string
  organization: string
  branch: string
  /** "cash" | "bank" | "" */
  paymentType: string
  cashbox: string
  createdBy: string
  /** Link to the source document page, or "". */
  href: string
  /** True for manual rows the page may edit/delete (its own *_balance_transactions row). */
  editable: boolean
  /** false for not yet accepted customer payments. */
  accepted: boolean
  amount: number
  currency: string
  /** Running balance of `currency` after this row (begin_balance + rows up to here). */
  balance: number
}

export type StatementSummary = CurrencyBalance & {
  /** Σ positive / negative movements before `from` (demo begin_income / begin_expanse). */
  begin_income: number
  begin_expense: number
  /** Σ positive / negative movements up to `to` incl. begin (demo end_income / end_expanse). */
  end_income: number
  end_expense: number
  /** Σ positive / negative movements inside [from, to]. */
  period_income: number
  period_expense: number
}

export type OrganizationBalance = {
  /** "" = movements without an organization (shown as "Не указано"). */
  organization: string
  /** End balance (≤ to) per currency, and split by payment type ("cash" | "bank" | ""). */
  currencies: Record<string, number>
  paymentTypes: Array<{ paymentType: string; currency: string; amount: number }>
}

export type StatementResult = {
  kind: BalanceEntityKind
  key: string
  entity: { key: string; id: number | null; name: string; info: Record<string, BalanceInfoValue> }
  from: string
  to: string
  mode: BalanceDateMode
  baseCurrency: string
  currencies: FinanceCurrency[]
  /** Currencies with any movement for this entity (all time ≤ to); at least one. */
  visibleCurrencies: string[]
  summary: Record<string, StatementSummary>
  /** Rows inside [from, to] after filters, ordered as requested, paged. */
  rows: StatementRow[]
  count: number
  page: number
  pageSize: number
  /** Distinct values of the period rows (before column/category/counterparty/search filters). */
  facets: { categories: string[]; counterparties: string[]; organizations: string[] }
  /** Only when requested (withOrganizations): end balance per organization. */
  organizations?: OrganizationBalance[]
}

export type ManagementLine = {
  /** Demo key: stock | cashbox | market_balance | provider_balance | staff_balance | branch_balance | cashback_balance */
  key: string
  /** Russian i18n key of the line; the UI appends the currency label for per-currency lines. */
  label: string
  /** Currency of the line amounts; base currency for stock/cashback. */
  currency: string
  /** true when the label is shown with the currency suffix ("Касса SUM"). */
  perCurrency: boolean
  begin_balance: number
  end_balance: number
  difference: number
  /** Optional drill-down link (relative app URL). */
  href: string
}

export type ManagementSection = {
  key: "assets" | "passives" | "profit" | "rate"
  label: string
  /** Section totals are in base currency (lines converted with current rates). */
  begin_balance: number
  end_balance: number
  difference: number
  lines: ManagementLine[]
}

export type ManagementBranch = {
  /** branches.id, or null for the virtual "Без филиала" card. */
  id: number | null
  name: string
  sections: ManagementSection[]
}

export type ManagementBalanceResult = {
  from: string
  to: string
  baseCurrency: string
  currencies: FinanceCurrency[]
  /** Non-base codes that appear in lines but have no rate (left out of section totals). */
  missingRates: string[]
  branches: ManagementBranch[]
}
