export type Order = {
  id: number
  /** Client name snapshot (the client itself is `clientId`). */
  client: string
  /** clients.id (contract 6); null only for legacy rows written before the column existed. */
  clientId?: number | null
  zone: string
  type: string
  /** Summary of the order lines ("<name> x<qty>, …"), or free text for orders without lines. */
  product: string
  created: string
  delivery: string
  agent: string
  /** Order total as text: "<amount> <currency>" (derived from the lines when there are any). */
  amount: string
  /** The client's current balance (ledger end balance per currency, read-only). */
  balance: string
  /** The client owes money in some currency. */
  negative?: boolean
  status: string
  discount?: string
  /** Final payment date (YYYY-MM-DD) — "Ожидаемые оплаты" uses it as "Дата оплаты". */
  paymentDate?: string
  /** "cash" | "bank" */
  paymentType?: string
  organization?: string
  /** Shop name shown in the list (falls back to `client`). */
  marketName?: string
  deliveryMan?: string
  expeditor?: string
  /** Date the delivery was accepted (YYYY-MM-DD). */
  acceptedDate?: string
  totalPrice?: number
  returnPrice?: number
  factPrice?: number
  weight?: number
  discountPercent?: number
  /** "cash" | "bank" — picks the payment icon in the list. */
  payMethod?: string
  /** Outstanding amount of this order (red payment icon while > 0). */
  orderBalance?: number
  invoiceActive?: boolean
  transportNumber?: string
  branchName?: string
  stockName?: string
  priceList?: string
  paidAmount?: number
  /** Client's operative / actual debt shown on the order card (SUM). */
  operativeDebt?: number
  actualDebt?: number
  /** "0" standard, "1" consignment. */
  dealType?: string
  /** "delivery" | "self" (pickup). */
  deliveryType?: string
  payTypeName?: string
  /** Final payment date (YYYY-MM-DD) as the order card shows it. */
  dueDate?: string
  wrongDebt?: boolean
  /** Creation timestamp "YYYY-MM-DD HH:MM:SS" (the list's `created` label has no year). */
  createdAt?: string
  invoiceNumber?: string
  /** Invoice date (YYYY-MM-DD). */
  invoiceDate?: string
  invoiceContract?: string
  /** Client's operative / actual debt per currency, as the reference order card lists them. */
  operativeExpand?: { currency: string; amount: number }[]
  actualExpand?: { currency: string; amount: number }[]
  /** Warehouse (warehouses.name) the goods are reserved in / shipped from (contract 4). */
  warehouse?: string
  /** Order currency (currencies.code); every line is in this currency. */
  currency?: string
  createdBy?: string
  comment?: string
  contract?: string
  /** ISO moment the order left the warehouse (В пути / Доставлено). */
  shippedAt?: string | null
  /** Client attributes, read-only (list / card). */
  clientBranch?: string
  clientPhone?: string
  clientDeliverer?: string
}

/** Reference status labels (the app's /sales/order status codes 0-5) keyed by the stored status. */
export const ORDER_STATUS_REF_LABEL: Record<string, string> = {
  "В процессе": "В процессе",
  "Есть на складе": "Есть на складе",
  "В пути": "Передан доставщику",
  "Доставлено": "Доставлен",
  "Отменен": "Отменен",
  "Не подтвержден": "Не подтвержден",
}

export const ORDER_STATUS_REF_OPTIONS = ["В процессе", "Есть на складе", "Передан доставщику", "Доставлен", "Отменен", "Не подтвержден"]


/**
 * Organization shown for an order. `product` holds the organization for imported orders but the items summary
 * ("Name x2, Other x1") for orders edited/created here, so prefer the real column and ignore the summary.
 */
export function orderOrganization(order: Pick<Order, "organization" | "product">): string {
  if (order.organization) return order.organization
  return / x\d+(,|$)/.test(order.product) ? "" : order.product
}


/** Every order status, in workflow order. */
export const ORDER_STATUSES = ["Не подтвержден", "В процессе", "Есть на складе", "В пути", "Доставлено", "Отменен"] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Statuses that hold stock: reserved ("Есть на складе") or shipped (В пути / Доставлено). */
export const STOCK_STATUSES: readonly string[] = ["Есть на складе", "В пути", "Доставлено"]
/** Shipped statuses: the goods left the warehouse. */
export const RELEASED_STATUSES: readonly string[] = ["В пути", "Доставлено"]
/** Final statuses: the order can no longer change (returns go through client returns). */
export const FINAL_STATUSES: readonly string[] = ["Доставлено", "Отменен"]
/** Statuses whose lines can still be edited. */
export const EDITABLE_STATUSES: readonly string[] = ["Не подтвержден", "В процессе", "Есть на складе"]

/** Allowed status changes (from → to). Unknown legacy statuses may move to any status. */
export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  "Не подтвержден": ["В процессе", "Есть на складе", "В пути", "Доставлено", "Отменен"],
  "В процессе": ["Не подтвержден", "Есть на складе", "В пути", "Доставлено", "Отменен"],
  "Есть на складе": ["Не подтвержден", "В процессе", "В пути", "Доставлено", "Отменен"],
  "В пути": ["Есть на складе", "Доставлено", "Отменен"],
  "Доставлено": [],
  "Отменен": [],
}

export function canChangeStatus(from: string, to: string): boolean {
  if (from === to) return true
  const allowed = ORDER_TRANSITIONS[from]
  if (!allowed) return (ORDER_STATUSES as readonly string[]).includes(to)
  return allowed.includes(to)
}

/** Kept for older imports: the statuses the list tabs show. */
export const statuses = ["Есть на складе", "В пути", "Доставлено", "Отменен"]
