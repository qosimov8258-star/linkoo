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
  /** Warehouse (warehouses.name) the goods are reserved in / shipped from (contract 4). */
  warehouse?: string
  /** Order currency (currencies.code); every line is in this currency. */
  currency?: string
  /** Deliverer (employee name) of the order; empty = the client's deliverer. */
  deliveryMan?: string
  priceList?: string
  createdBy?: string
  comment?: string
  /** "Доставка" | "Самовывоз" */
  deliveryType?: string
  /** "standard" | "consignment" */
  dealType?: string
  invoiceNumber?: string
  invoiceDate?: string
  invoiceActive?: boolean
  contract?: string
  /** ISO moment the order left the warehouse (В пути / Доставлено). */
  shippedAt?: string | null
  /** UTC "YYYY-MM-DD HH:MM:SS" creation moment. */
  createdAt?: string
  /** Client attributes, read-only (list / card). */
  clientBranch?: string
  clientPhone?: string
  clientDeliverer?: string
}

/** 409 detail of an order that would make its agent sell more of a product than the
 * agent's limit (Продукты → "Добавить лимит"; lib/orders-repo.ts assertAgentLimits). */
export type AgentLimitExceeded = {
  agent: string
  productId: number
  product: string
  /** The limit (product_limits.amount). */
  limit: number
  /** Реализовано without this order. */
  realized: number
  /** This order's quantity of the product. */
  requested: number
  /** limit − realized, never below 0. */
  remaining: number
}

/** Message of an orders API error for the user: the agent-limit refusal is composed from
 * translated parts (agent / product names stay as they are), anything else is translated
 * as a whole; `fallback` (a Russian key) when the server sent no message. */
export function orderApiErrorText(
  body: { error?: string; agentLimit?: AgentLimitExceeded | null; productRestriction?: ProductRestrictionRefusal | null } | null | undefined,
  t: (text: string) => string,
  fallback: string,
): string {
  const limit = body?.agentLimit
  if (limit) {
    const n = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
    return `${t("Превышен лимит агента")} «${limit.agent}» ${t("по товару")} «${limit.product}»: ${t("лимит")} ${n(limit.limit)}, ${t("реализовано")} ${n(limit.realized)}, ${t("в заказе")} ${n(limit.requested)}`
  }
  const names = (body?.productRestriction?.products ?? []).map((product) => product.name).filter(Boolean)
  if (names.length) return `${t(body?.error || "Агенту запрещено продавать товар")}: ${names.join(", ")}`
  return t(body?.error || fallback)
}

/** 409 detail of "Агенту запрещено продавать товар" (Ограничение продуктов): the agent and the
 * products of the order it may not sell. */
export type ProductRestrictionRefusal = { employeeId: number; agent: string; products: Array<{ id: number; name: string }> }

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
