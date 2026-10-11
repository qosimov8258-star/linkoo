// Shared (isomorphic) types of "Долги с заказов" (demo #/statistics/debtors):
// debt aging of order remainders per client and currency. Server side:
// lib/finance-order-debts.ts; routes: app/api/order-debts/**.

export const DEBT_BUCKETS = ["first", "second", "third", "fourth"] as const
export type DebtBucket = (typeof DEBT_BUCKETS)[number]

/** Aging periods in days (demo debtors_stats.config, defaults 7 / 30 / 120). */
export type OrderDebtConfig = { firstDebtPeriod: number; secondDebtPeriod: number; thirdDebtPeriod: number }
export const DEFAULT_ORDER_DEBT_CONFIG: OrderDebtConfig = { firstDebtPeriod: 7, secondDebtPeriod: 30, thirdDebtPeriod: 120 }

/** Amount per bucket + total ("Итого" / "Общий долг"), one currency. */
export type BucketAmounts = Record<DebtBucket | "total", number>

export type OrderDebtTab = "client" | "order"

/** Order statuses that can carry a debt (everything except "Отменен"). */
export const ORDER_DEBT_STATUSES = ["Есть на складе", "В пути", "Доставлено"] as const

/** Filter / list query (URL and API share these names; arrays = repeated params). */
export type OrderDebtFilters = {
  /** Client branch. */
  branch: string[]
  /** Order organization (demo division). */
  division: string[]
  /** "Заказ оформил" = orders.agent. */
  user: string[]
  /** Order delivery man (fallback: client deliverer). */
  deliveryMan: string[]
  /** Client type (demo marketTypeParent); "-" = without type. */
  marketTypeParent: string[]
  /** Client zone (fallback: order zone). */
  zone: string[]
  /** Order status. */
  status: string[]
  /** Order payment type. */
  paymentType: "" | "cash" | "bank"
  /** "Есть задолженность за период". */
  marketDebtType: "" | DebtBucket
  /** Days since the client's last payment, from / to. */
  minPaymentDays: string
  paymentDays: string
  createdFromDate: string
  createdToDate: string
  deliveryFromDate: string
  deliveryToDate: string
  paymentFromDate: string
  paymentToDate: string
  acceptedFromDate: string
  acceptedToDate: string
  /** "Требуется перерасчет": only clients whose debt needs a recalculation. */
  withWrongDebt: boolean
}

export const EMPTY_ORDER_DEBT_FILTERS: OrderDebtFilters = {
  branch: [],
  division: [],
  user: [],
  deliveryMan: [],
  marketTypeParent: [],
  zone: [],
  status: [],
  paymentType: "",
  marketDebtType: "",
  minPaymentDays: "",
  paymentDays: "",
  createdFromDate: "",
  createdToDate: "",
  deliveryFromDate: "",
  deliveryToDate: "",
  paymentFromDate: "",
  paymentToDate: "",
  acceptedFromDate: "",
  acceptedToDate: "",
  withWrongDebt: false,
}

export const ORDER_DEBT_ARRAY_FILTERS = ["branch", "division", "user", "deliveryMan", "marketTypeParent", "zone", "status"] as const
export const ORDER_DEBT_TEXT_FILTERS = [
  "paymentType",
  "marketDebtType",
  "minPaymentDays",
  "paymentDays",
  "createdFromDate",
  "createdToDate",
  "deliveryFromDate",
  "deliveryToDate",
  "paymentFromDate",
  "paymentToDate",
  "acceptedFromDate",
  "acceptedToDate",
] as const

export type OrderDebtQuery = OrderDebtFilters & {
  tab: OrderDebtTab
  search: string
  /** Client tab: name | phone | address | guide | agent | type | <bucket|total>.<CUR>; order tab: id | client | passed_days | total |
   * remaining | payment_date | agent | client_debt.<CUR> | delivery_man | realization | delivery | created. "-" = desc. */
  ordering: string
  page: number
  /** 0 = all rows. */
  pageSize: number
}

export type OrderDebtCurrency = { code: string; label: string }

export type OrderDebtStats = {
  config: OrderDebtConfig
  /** Local business day the ages are counted to. */
  today: string
  /** Σ remainders per currency and bucket (clients that need a recalculation excluded, like the demo). */
  amounts: Record<string, BucketAmounts>
  /** Debt orders per bucket (demo debtors). */
  debtors: Record<DebtBucket, number>
  /** Of those, orders whose payment date is today or later ("Заказов обработано", demo expect). */
  expect: Record<DebtBucket, number>
  wrongDebtClientCount: number
  wrongDebtClientIds: number[]
}

export type OrderDebtClientInfo = {
  /** clients.id as text, or "name:<lower name>" for orders whose client is not in the clients table. */
  key: string
  id: number | null
  name: string
  phone: string
  address: string
  /** clients.landmark (demo guide, "Ориентир"). */
  guide: string
  /** Responsible agent (clients.agent). */
  agent: string
  type: string
  zone: string
  branch: string
}

export type OrderDebtClientRow = OrderDebtClientInfo & {
  /** Debt that the orders cannot explain is not attributed yet ("Требуется перерасчет"). */
  wrongDebt: boolean
  /** Debt orders of the client (remainder > 0). */
  orders: number
  currencies: Record<string, BucketAmounts>
}

export type OrderDebtOrderRow = {
  /** "<orderId>-<CUR>" */
  key: string
  orderId: number
  currency: string
  client: { key: string; id: number | null; name: string }
  status: string
  /** orders.agent ("Заказ оформил" / "Агент"). */
  agent: string
  deliveryMan: string
  organization: string
  paymentType: "cash" | "bank"
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  /** Realization day (В пути / Доставлено) or "". */
  realizationDate: string
  /** Delivery day or "". */
  deliveryDate: string
  /** Promised payment day ("Срок оплаты") or "". */
  paymentDate: string
  /** Days since the realization (or creation when not released). */
  passedDays: number
  bucket: DebtBucket
  /** Order amount in this currency. */
  total: number
  /** Payments linked to the order (customer_payments.order_id). */
  paid: number
  /** Share of the client's other credits (FIFO, oldest order first). */
  allocated: number
  remaining: number
  /** The client is flagged "Требуется перерасчет". */
  wrongDebt: boolean
  /** The client's whole order debt per currency ("Общий долг"). */
  clientDebt: Record<string, number>
}

export type OrderDebtListResult = {
  tab: OrderDebtTab
  baseCurrency: string
  currencies: OrderDebtCurrency[]
  stats: OrderDebtStats
  count: number
  page: number
  pageSize: number
  clients: OrderDebtClientRow[]
  orders: OrderDebtOrderRow[]
}

/** Line of the client drill-down: a debt order, or the debt the orders cannot explain
 * (opening balance, corrections) once it has been recalculated ("Долг без заказа"). */
export type OrderDebtDetailLine =
  | ({ kind: "order" } & OrderDebtOrderRow)
  | { kind: "unexplained"; key: string; currency: string; date: string; passedDays: number; bucket: DebtBucket; remaining: number }

export type OrderDebtClientDetail = {
  client: OrderDebtClientRow
  config: OrderDebtConfig
  today: string
  /** Per currency: debt not explained by orders (> 0 only). */
  unexplained: Record<string, number>
  recalc: { fromDate: string; recalculatedAt: string; recalculatedBy: string } | null
  count: number
  page: number
  pageSize: number
  lines: OrderDebtDetailLine[]
}

export type OrderDebtOrderDetail = {
  order: OrderDebtOrderRow & { zone: string; delivery: string; product: string }
  parts: Array<{ currency: string; total: number; paid: number; allocated: number; remaining: number }>
  items: Array<{ id: number; name: string; unit: string; quantity: number; price: number; discount: number; currency: string; amount: number }>
}

export type OrderDebtOptions = {
  branches: string[]
  organizations: string[]
  users: string[]
  deliveryMen: string[]
  clientTypes: string[]
  untyped: boolean
  zones: string[]
  statuses: string[]
}

/** Bucket of an age in days: ≤ p1 first, ≤ p2 second, ≤ p3 third, else fourth. */
export function bucketOf(days: number, config: OrderDebtConfig): DebtBucket {
  if (days <= config.firstDebtPeriod) return "first"
  if (days <= config.secondDebtPeriod) return "second"
  if (days <= config.thirdDebtPeriod) return "third"
  return "fourth"
}

/** Header of a bucket as a Russian i18n key + the values to put into it. */
export function bucketLabel(bucket: DebtBucket | "total", config: OrderDebtConfig): { key: string; values: Record<string, number> } {
  const { firstDebtPeriod: p1, secondDebtPeriod: p2, thirdDebtPeriod: p3 } = config
  if (bucket === "first") return { key: "Прошло до {days} дней", values: { days: p1 } }
  if (bucket === "second") return { key: "C {from} дней - До {to}", values: { from: p1, to: p2 } }
  if (bucket === "third") return { key: "C {from} дней - До {to}", values: { from: p2, to: p3 } }
  if (bucket === "fourth") return { key: "Больше {days} дней", values: { days: p3 } }
  return { key: "Итого", values: {} }
}

/** Fills "{name}" placeholders of a translated text. */
export function fillTemplate(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}

export const emptyBuckets = (): BucketAmounts => ({ first: 0, second: 0, third: 0, fourth: 0, total: 0 })
