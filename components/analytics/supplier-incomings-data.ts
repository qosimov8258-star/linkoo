export type IncomingPaymentType = "Банковский счет" | "Наличный"
export type IncomingStatus = "принят" | "ожидает" | "отменен"

export type IncomingItem = {
  id: number
  /** Linko's id of the line (supply_product), for a supply copied from Linko: the «№» of «Продукты поставки». */
  linkoId?: number
  /** Catalog key ("product:12"), when known (lines imported from Linko): the stock ledger books the line under it. */
  key?: string
  product: string
  expiry: string
  qty: number
  block: number
  kg: number
  netWeight: number
  cost: number
  total: number
  /** Series number of the line (products with «Серия»), Linko's supply_product.series. */
  series?: string
  /** Received so far, when it differs from `qty` (a line copied from Linko: posted_amount). */
  posted?: number
  /** The product needs marking codes (Linko's product.use_mark when the line was copied). */
  useMark?: boolean
  /** Linko's mark_stat of the line: codes in the invoice / scanned on the warehouse / scanned but not in the invoice. */
  markStat?: { inInvoice: number; inStock: number; extra: number }
}

export type Incoming = {
  id: number
  supplier: string
  warehouse: string
  date: string
  paymentType: IncomingPaymentType
  contractNumber: string
  amount: number
  status: IncomingStatus
  invoiceNumber: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: IncomingItem[]
  currency: string
  invoiceDate: string
  acceptedAt: string
  acceptedBy: string
  /** Additional costs of the supply (delivery, customs, ...), converted into
   * the supply currency (each expense at its own rate snapshot, else the live rate). */
  expensesTotal: number
  /** The same additional costs in the base currency. */
  expensesBase: number
  /** Base-currency units per 1 unit of the supply currency, frozen at acceptance
   * (contract rate_to_base); null while not accepted / for legacy rows. */
  rateToBase: number | null
  /** A supply generated from an inventory surplus (Linko's is_inventory): no edit, expenses or logs. */
  isInventory: boolean
  /** «Принимать на склад»: Linko's is_confirmed (a supply not confirmed yet is not planned for receiving). */
  isConfirmed: boolean
  invoiceComment: string
  /** «Ожидаемый выход с завода» / «Ожидаемое прибытие в таможню» (YYYY-MM-DD or ""). */
  expectedFactoryExit: string
  expectedCustomsArrival: string
  /** The supplier's id (Linko's provider id), when the row carries it. */
  supplierId?: number | null
  /** The day the list's «Дата создания» filter compares (Linko's begin_date / end_date): the day of the last «Изменить»,
   * else the day the supply was created (YYYY-MM-DD). */
  createdDay?: string
  /** Name of the supplier's contact person on the supply (Linko's contact.name), searched by the list. */
  contactName?: string
  /** Linko's ids of the supply's warehouse, branch and organization (a supply copied from Linko, until an edit changes
   * the name): the list's filter and search use them, names may repeat. */
  warehouseId?: number | null
  branchId?: number | null
  organizationId?: number | null
}

export type IncomingExpense = {
  id: number
  incomingId: number
  date: string
  description: string
  amount: number
  currency: string
  paymentType: string
  createdBy: string
  createdAt: string
  /** Rate of the expense currency to the base currency at its creation (null = legacy row). */
  rateToBase?: number | null
  /** «Тип распределения»: Linko's distribute_type (cost = «Авто от суммы», weight, capacity, manual). */
  distributeType?: string
  /** «Привязан к поставщику» (Linko's bind_to_provider). */
  bindToProvider?: boolean
  /** «Оплачено»: what live cash entries paid for the expense, in its currency. */
  paid?: number
}

/** `status`: the supply's status code when the entry was written (Linko's 0 ожидает, 1 в процессе, 2 принят, 4 отменен);
 * `eventDate`: the day of a «Добавить лог» event (sent_out / come_to_post). */
export type IncomingLog = { id: number; action: string; details: string; userName: string; createdAt: string; status?: string; eventDate?: string }

/** Linko's status codes of a supply, as its logs store them. */
export const INCOMING_STATUS_CODE: Record<IncomingStatus, string> = { ожидает: "0", принят: "2", отменен: "4" }

export const incomingPaymentTypes: IncomingPaymentType[] = ["Банковский счет", "Наличный"]

export type CostLine = { product: string; qty: number; purchasePrice: number; expensePerUnit: number; unitCost: number; total: number }

/** Unit cost of every line, in the supply currency, with the supply's additional
 * costs (`expensesTotal`, already converted into the supply currency) spread over
 * the lines in proportion to their value (as the stock ledger books them). */
export function supplyCostLines(incoming: Pick<Incoming, "items" | "expensesTotal">): CostLine[] {
  const value = incoming.items.reduce((sum, item) => sum + item.qty * item.cost, 0)
  const totalQty = incoming.items.reduce((sum, item) => sum + item.qty, 0)
  return incoming.items.map((item) => {
    const share = value > 0 ? (item.qty * item.cost) / value : totalQty > 0 ? item.qty / totalQty : 0
    const lineExpense = incoming.expensesTotal * share
    const expensePerUnit = item.qty > 0 ? lineExpense / item.qty : 0
    const unitCost = item.cost + expensePerUnit
    return { product: item.product, qty: item.qty, purchasePrice: item.cost, expensePerUnit, unitCost, total: unitCost * item.qty }
  })
}
