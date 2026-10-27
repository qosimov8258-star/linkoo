// Shared (client + server) shapes of "Оплаты от клиентов" (demo
// #/client-transaction) and "Ожидаемые оплаты" (demo #/pending-payments).
// Server logic: lib/cash/customer-payments.ts; routes: /api/cash/customer-payments/**.
// Client components may import this file (no server code here).

/** Demo tabs (show_tab): "Не принятые" | "Принятые" | "Все". */
export type CustomerPaymentTab = "not_accepted" | "accepted" | "all"

export const CUSTOMER_PAYMENT_TABS: readonly CustomerPaymentTab[] = ["not_accepted", "accepted", "all"]

/** Demo client_confirmation ('' = no Telegram request was ever sent). */
export type ClientConfirmation = "" | "requested" | "confirmed" | "rejected" | "auto"

export const CLIENT_CONFIRMATIONS: readonly Exclude<ClientConfirmation, "">[] = ["confirmed", "requested", "rejected", "auto"]

/** Russian labels (i18n keys) of the "Подтверждение клиента" filter (demo module 3507). */
export const CLIENT_CONFIRMATION_FILTER_LABELS: Record<Exclude<ClientConfirmation, "">, string> = {
  confirmed: "Подтвержден",
  requested: "Ожидает",
  rejected: "Отклонен",
  auto: "Подтвержден автоматически",
}

/** Russian tooltips (i18n keys) of the row status icon. */
export const CLIENT_CONFIRMATION_ICON_LABELS: Record<Exclude<ClientConfirmation, "">, string> = {
  confirmed: "Подтвержден",
  requested: "В ожидании",
  rejected: "Отменен",
  auto: "Автоматически подтвержден системой",
}

/** Filters of GET /api/cash/customer-payments and …/total (demo listFilterSerializer). */
export type CustomerPaymentsQuery = {
  tab?: CustomerPaymentTab
  /** Digits: № (id) or the cash № (doc_no); else client / INN / comment / creator substring. */
  search?: string
  /** "Дата оплаты" (ISO days, inclusive). */
  from?: string
  to?: string
  /** "Дата получения" (acceptance day). */
  acceptedFrom?: string
  acceptedTo?: string
  /** "Дата счет фактуры". */
  invoiceFrom?: string
  invoiceTo?: string
  /** "Счета фактура": set | not_set. */
  invoice?: "" | "set" | "not_set"
  branches?: string[]
  /** "Доставщик": who collected the money (delivery_man or agent). */
  deliveryMen?: string[]
  organizations?: string[]
  /** "Тип клиента" (clients.type; "-" = untyped). */
  clientTypes?: string[]
  /** "Касса" (accepted cashbox). */
  cashboxIds?: number[]
  /** "Зона" (clients.zone). */
  zones?: string[]
  clientIds?: number[]
  /** "Создал". */
  createdBy?: string[]
  /** "Принял". */
  acceptedBy?: string[]
  /** "Ответственный агент магазина" (clients.agent). */
  responsibleAgents?: string[]
  /** "Ответственный доставщик магазина" (clients.deliverer). */
  responsibleDeliverers?: string[]
  /** "Подтверждение клиента". */
  status?: ClientConfirmation
  /** Debt currency ("Валюта"). */
  currency?: string
  /** Demo hidden key notAccept (transaction=0). */
  notAccept?: boolean
  /** id | client | user | created_date | accepted_time | division | amount | cashbox, "-" = desc; default "-id". */
  ordering?: string
  page?: number
  /** Default 25; 0 = all (capped). */
  pageSize?: number
}

export type PaymentRef = { id: number; name: string }

export type CustomerPaymentRow = {
  id: number
  /** Shared cash № (doc_no) — link to Управления кассой. */
  docNo: number
  client: { id: number | null; name: string; inn: string }
  createdBy: string
  /** Local "YYYY-MM-DDTHH:mm:ss" payment date ("Дата оплаты"). */
  date: string
  /** Local acceptance date-time ("Дата приемки"), "" while not accepted. */
  acceptedAt: string
  acceptedBy: string
  /** ISO day ("Дата счет фактуры"), "". */
  invoiceDate: string
  /** Client's responsible agent (clients.agent). */
  responsibleAgent: string
  organization: string
  branch: string
  /** Credited to the client (debt side). */
  amount: number
  currency: string
  /** Base-currency equivalent (demo `internal`), null = unknown. */
  baseAmount: number | null
  /** Base units per 1 debt-currency unit used, null when unknown / base. */
  debtRate: number | null
  /** Money in the cashbox (cash side). */
  realAmount: number
  realCurrency: string
  /** Base units per 1 cash-currency unit used (custom / stored), null when unknown. */
  cashRate: number | null
  rateType: string
  paymentType: "cash" | "bank"
  /** Accepted cashbox (or the cashbox of an unverified cash-page income). */
  cashbox: (PaymentRef & { currency: string }) | null
  /** Collecting agent's cashbox (demo agent_cashbox). */
  agentCashbox: PaymentRef | null
  accepted: boolean
  /** Agent-cash acceptance this payment belongs to (type-8 row on the cash page). */
  acceptance: { id: number; docNo: number } | null
  /** № shown on the cash page for this money (acceptance № or the row's own №); null while not in a cashbox. */
  cashDocNo: number | null
  orderId: number | null
  comment: string
  clientConfirmation: ClientConfirmation
  /** Collector (agent / delivery man). */
  agent: string
  deliveryMan: string
  /** Soft-deleted ("Удалить транзакцию"); lists never return deleted rows, GET by id does. */
  isDeleted: boolean
  /** Local "YYYY-MM-DDTHH:mm:ss" of the deletion, "" while live. */
  deletedAt: string
  deletedBy: string
}

export type CustomerPaymentsResult = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  rows: CustomerPaymentRow[]
}

export type CustomerPaymentTotal = {
  currency: string
  total: number
  count: number
  /** Accepted rows by cashbox. */
  cashboxes: Array<PaymentRef & { total: number; count: number }>
  /** Not accepted rows by agent cashbox (id 0 = "Не указано"). */
  agentCashboxes: Array<PaymentRef & { total: number; count: number }>
}

export type CustomerPaymentTotalsResult = { baseCurrency: string; totals: CustomerPaymentTotal[] }

/** Body of PUT /api/cash/customer-payments/[id] (demo "Изменение транзакции", updateTransactionSerializer). */
export type CustomerPaymentEditInput = {
  /** Cash side (> 0) in `currency`. */
  amount: number
  /** Cash currency; ignored for rows already in a cashbox (the cashbox currency wins). */
  currency?: string
  /** "Индивидуальная покрытия долга": currency credited to the client (default = currency). */
  debtCurrency?: string
  rateType?: "current" | "custom"
  /** Base units per 1 cash-currency unit (custom). */
  customRate?: number
  /** Base units per 1 debt-currency unit (custom; "Курс" when the cash currency is the base). */
  debtRate?: number
  /** cash | bank; ignored for rows in a cashbox. */
  paymentType?: "cash" | "bank"
  organization?: string
  /** "Пользователь" (Создал). */
  createdBy?: string
  comment?: string
}

/** Body of POST /api/cash/customer-payments/bulk-update (demo bulk_update). */
export type CustomerPaymentBulkUpdateInput = {
  ids: number[]
  changeInvoiceDate: boolean
  /** ISO day; null / "" clears. */
  invoiceDate?: string | null
}

/** Lookup values of both pages' filters and dialogs. */
export type CustomerPaymentOptions = {
  baseCurrency: string
  currencies: Array<{ code: string; label: string; rate: number | null }>
  branches: string[]
  organizations: string[]
  zones: string[]
  clientTypes: string[]
  untyped: boolean
  cashboxes: Array<PaymentRef & { currency: string; type: "cash" | "bank"; branch: string }>
  clients: PaymentRef[]
  /** "Создал" / "Пользователь": stored creators ∪ users ∪ employees. */
  users: string[]
  acceptedBy: string[]
  /** Clients' responsible agents ∪ agent employees. */
  agents: string[]
  /** Delivery people (clients.deliverer ∪ delivery employees ∪ stored collectors). */
  deliverers: string[]
  employees: Array<PaymentRef & { position: string }>
  /** Order statuses of "Ожидаемые оплаты" (without "Отменен"). */
  orderStatuses: string[]
}

// --- Ожидаемые оплаты -------------------------------------------------------------

/** Filters of GET /api/cash/customer-payments/expected (demo PendingPaymentsFilterForm). */
export type ExpectedOrdersQuery = {
  /** Digits = order № exact; else client substring. */
  search?: string
  branches?: string[]
  clientIds?: number[]
  /** "Агент" (orders.agent). */
  agents?: string[]
  paymentType?: "" | "cash" | "bank"
  /** "Доставщик" (order delivery man, else the client's deliverer). */
  deliveryMen?: string[]
  organizations?: string[]
  statuses?: string[]
  /** "Дата создания". */
  from?: string
  to?: string
  /** "Дата доставки". */
  deliveryFrom?: string
  deliveryTo?: string
  /** "Дата оплаты" (due date). */
  dueFrom?: string
  dueTo?: string
  /** id | created_date | payment_date | total_price | total_balance, "-" = desc; default "-id". */
  ordering?: string
  page?: number
  pageSize?: number
}

export type ExpectedOrderRow = {
  /** "<orderId>-<currency>" (one row per order × currency). */
  key: string
  orderId: number
  client: { id: number | null; name: string }
  /** Order zone, else the client's zone. */
  zone: string
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  /** Due date ISO day, "" = "Не указано". */
  paymentDate: string
  organization: string
  branch: string
  agent: string
  deliveryMan: string
  status: string
  /** Delivery day (ISO) when parseable. */
  deliveryDate: string
  paymentType: "cash" | "bank"
  currency: string
  total: number
  /** Paid towards the order: linked payments + its share of the client's other credits. */
  paid: number
  /** FIFO share of the client's unlinked payments / advances (included in paid). */
  allocated: number
  remaining: number
}

export type ExpectedOrderTotal = {
  currency: string
  /** Σ order totals (demo cards). */
  total: number
  remaining: number
  paymentTypes: Array<{ paymentType: "cash" | "bank"; total: number; remaining: number }>
}

export type ExpectedOrdersResult = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  rows: ExpectedOrderRow[]
  totals: ExpectedOrderTotal[]
}

/** Header of the pay dialog (GET /api/cash/customer-payments/expected/[orderId]). */
export type ExpectedOrderDetail = {
  orderId: number
  client: { id: number | null; name: string }
  organization: string
  branch: string
  paymentType: "cash" | "bank"
  createdAt: string
  status: string
  /** paid = linked + allocated (FIFO share of the client's other credits); remaining = what a payment may cover. */
  currencies: Array<{ currency: string; total: number; paid: number; linked: number; allocated: number; remaining: number }>
  /** Contracts of the client (only offered for bank orders). */
  contracts: Array<{ id: number; label: string }>
}
