export type Client = {
  id: number
  name: string
  phone: string
  info?: string
  inn?: string
  type: string
  zone: string
  zoneAgent: string
  agent: string
  deliverer: string
  collector: string
  balance?: number
  tab: "unconfirmed" | "problem" | "plan" | "closing" | "all"
  branch?: string
  /** Has an agent route assigned (reference «Маршрут»). */
  inRoute?: boolean
  /** Shown under the «Проблемные» tab. */
  isProblem?: boolean
  /** «Статус объекта»: an inactive confirmed client is marked red in the list. */
  isActive?: boolean
  salesChannel?: string
  realizationBy?: string
  address?: string
  landmark?: string
  locationLat?: number
  locationLng?: number
  telegramLocationLink?: string
  code?: string
  contactPerson?: string
  note?: string
  autoDelivery?: boolean
  unlimitedDebt?: boolean
  attributes?: Record<string, string>
  /** Current ledger balance lines per currency, e.g. "-12 047 000 SUM" (read-only). */
  balanceLines?: string[]
  /** Current ledger end balance per currency code (read-only; negative = the client owes). */
  currentBalances?: Record<string, number>
  /** Last order / payment day (YYYY-MM-DD) from the client ledger (read-only). */
  lastOrder?: string | null
  lastPayment?: string | null
  createdAt?: string
  createdBy?: string
}

export const clientTabs = [
  { id: "unconfirmed", label: "Не подтвержденные" },
  { id: "problem", label: "Проблемные" },
  { id: "plan", label: "Плановый ОКБ" },
  { id: "closing", label: "Закрытие" },
  { id: "all", label: "Все" },
] as const
