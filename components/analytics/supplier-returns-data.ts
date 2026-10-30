export type ReturnStatus = "завершен" | "в процессе" | "отменен"

export type ReturnItem = { id: number; product: string; qty: number; series: string; price: number; total: number }

export type SupplierReturn = {
  id: number
  fromWhom: string
  warehouse: string
  addedBy: string
  date: string
  time: string
  amount: number
  status: ReturnStatus
  organization: string
  currency: string
  paymentType: string
  priceList: string
  branch: string
  transferTime: string
  /** Who handed the goods over to the supplier ("Передал"). */
  transferredBy: string
  cancelledAt: string
  cancelledBy: string
  reason: string
  items: ReturnItem[]
}

/** The return's payment types (i18n keys). Suppliers, warehouses, branches, organizations, price lists and
 * products always come from their own lists (/api/suppliers, /api/organizations, …), never from fixed names. */
export const returnPaymentTypes = ["банковский счет", "наличный"]
