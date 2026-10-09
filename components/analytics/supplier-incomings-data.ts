export type IncomingPaymentType = "Банковский счет" | "Наличный"
export type IncomingStatus = "принят" | "ожидает" | "отменен"

export type IncomingItem = {
  id: number
  product: string
  expiry: string
  qty: number
  block: number
  kg: number
  netWeight: number
  cost: number
  total: number
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
  /** Additional costs of the supply (delivery, customs, ...), summed. */
  expensesTotal: number
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
}

export type IncomingLog = { id: number; action: string; details: string; userName: string; createdAt: string }

export const incomingPaymentTypes: IncomingPaymentType[] = ["Банковский счет", "Наличный"]

export type CostLine = { product: string; qty: number; purchasePrice: number; expensePerUnit: number; unitCost: number; total: number }

/** Unit cost of every line with the supply's additional costs spread over
 * the lines in proportion to their value. */
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
