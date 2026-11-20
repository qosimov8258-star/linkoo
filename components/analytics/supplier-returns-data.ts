export type ReturnStatus = "завершен" | "в процессе" | "отменен"

/** `key`: the catalog key ("product:12") when known (pickers, lines imported from Linko): the stock ledger books the line under it.
 * `seriesId`: the line's series in the shared series catalog (stock_series, Linko's series.id); `series` is its display name. */
export type ReturnItem = { id: number; key?: string; product: string; qty: number; series: string; seriesId?: number | null; price: number; total: number }

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
  /** "банковский счет" | "наличный" (the API's i18n keys), "" when unknown. */
  paymentType: string
  priceList: string
  branch: string
  transferTime: string
  /** Who handed the goods over to the supplier ("Передал"). */
  transferredBy: string
  cancelledAt: string
  cancelledBy: string
  reason: string
  /** Linko's returnFromOldBase: such a return cannot be edited. */
  fromOldBase: boolean
  items: ReturnItem[]
}

/** The return's payment types (i18n keys). Suppliers, warehouses, branches, organizations, price lists and
 * products always come from their own lists (/api/suppliers, /api/organizations, …), never from fixed names. */
export const returnPaymentTypes = ["банковский счет", "наличный"]

/** A stored payment type ("Наличные", "наличный", "cash", "Банковский счет", "bank") → its key in returnPaymentTypes. */
export function returnPaymentType(value: string | null | undefined): string {
  const text = String(value ?? "").trim().toLowerCase()
  if (!text) return ""
  if (text.startsWith("налич") || text === "cash") return "наличный"
  if (text.startsWith("банк") || text === "bank") return "банковский счет"
  return text
}
