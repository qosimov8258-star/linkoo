export type Order = {
  id: number
  client: string
  zone: string
  type: string
  product: string
  created: string
  delivery: string
  agent: string
  amount: string
  balance: string
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

export const statuses = ["Есть на складе", "В пути", "Доставлено", "Отменен"]

export const initialOrders: Order[] = [
  { id: 1584, client: "Tinchlik market", zone: "spark", type: "market", product: "ddr", created: "25 июля 17:17", delivery: "25 июля 2026", agent: "Admin Ritm", amount: "788,39 USD", balance: "6 970 000 SUM", status: statuses[0] },
  { id: 1583, client: "Tinchlik market", zone: "spark", type: "market", product: "baby still", created: "25 июля 17:13", delivery: "25 июля 2026", agent: "Admin Ritm", amount: "0,36 USD", balance: "6 970 000 SUM", status: statuses[0] },
  { id: 1581, client: "magazin", zone: "", type: "market", product: "NEW ORG", created: "05 июня 11:10", delivery: "06 июня 2026", agent: "Admin Ritm", amount: "130 USD", balance: "2 653 000 SUM", status: statuses[0] },
  { id: 1580, client: "Doston market", zone: "spark", type: "chakana savdo", product: "NEW ORG", created: "01 июня 23:03", delivery: "01 июня 2026", agent: "Admin Ritm", amount: "50 000 SUM", balance: "-220 000 SUM", negative: true, status: statuses[1] },
  { id: 1579, client: "Ashraf Hakimi", zone: "spark", type: "chakana savdo", product: "DostonFood", created: "24 мая 11:49", delivery: "17 июля 2026", agent: "Admin Ritm", amount: "1 171 800 SUM", balance: "0 SUM", status: statuses[2] },
  { id: 1578, client: "Ashraf Hakimi", zone: "spark", type: "chakana savdo", product: "energetik", created: "24 мая 11:49", delivery: "17 июля 2026", agent: "Admin Ritm", amount: "250 000 000 SUM", balance: "0 SUM", status: statuses[2] },
  { id: 1576, client: "Частное Лицо", zone: "Andijon shaharchasi", type: "Юр. лицо", product: "05,08,2025", created: "12 мая 13:48", delivery: "13 мая 2026", agent: "Samandar Abdurahmonov", amount: "0 SUM", balance: "-773 375 SUM", negative: true, status: statuses[0] },
  { id: 1573, client: "Android", zone: "spark", type: "Розничный", product: "robototexnika", created: "01 мая 11:47", delivery: "02 мая 2026", agent: "Admin Ritm", amount: "2 USD", balance: "92 643 690 003,5 SUM", status: statuses[0] },
  { id: 1571, client: "Частное Лицо", zone: "Andijon shaharchasi", type: "Юр. лицо", product: "05,08,2025", created: "25 апр. 13:22", delivery: "08 мая 2026", agent: "Admin Ritm", amount: "150 000 SUM", balance: "-773 375 SUM", negative: true, status: statuses[0] },
  { id: 1540, client: "Klient_Karim110", zone: "", type: "market109", product: "energetik", created: "03 февр. 14:18", delivery: "06 февр. 2026", agent: "Temur Raupov", amount: "50 000 SUM", balance: "0 SUM", status: statuses[2] },
]

/**
 * Organization shown for an order. `product` holds the organization for imported orders but the items summary
 * ("Name x2, Other x1") for orders edited/created here, so prefer the real column and ignore the summary.
 */
export function orderOrganization(order: Pick<Order, "organization" | "product">): string {
  if (order.organization) return order.organization
  return / x\d+(,|$)/.test(order.product) ? "" : order.product
}
