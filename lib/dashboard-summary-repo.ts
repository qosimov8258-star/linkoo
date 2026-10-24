import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getFieldSummary, type FieldSummary } from "@/lib/agent-visits-repo"
import { getDb } from "@/lib/db"

export type CurrencyAmount = { value: number; currency: string }

export type DashboardSummary = {
  sales: CurrencyAmount
  payments: CurrencyAmount
  returns: CurrencyAmount
  akb: number
  field: FieldSummary
  orderStatusCounts: {
    shipped: number
    inTransit: number
    delivered: number
    cancelledShipped: number
  }
}

// Orders store `amount` as a display string like "788,39 USD" or "50 000 SUM"
// rather than a structured number, so it has to be parsed back out here.
function parseAmountText(text: string): CurrencyAmount {
  const match = text.trim().match(/^([\d\s .,]+)\s*([A-Za-zА-Яа-я]+)?$/)
  if (!match) return { value: 0, currency: "SUM" }
  const numeric = Number.parseFloat(match[1].replace(/[\s ]/g, "").replace(",", "."))
  return {
    value: Number.isFinite(numeric) ? numeric : 0,
    currency: (match[2] || "SUM").toUpperCase(),
  }
}

function addToMap(map: Map<string, number>, amount: CurrencyAmount) {
  map.set(amount.currency, (map.get(amount.currency) ?? 0) + amount.value)
}

// Multiple currencies can appear in one range; surface the one with the
// largest absolute total so the card shows a single meaningful number.
function pickPrimary(map: Map<string, number>): CurrencyAmount {
  let best: CurrencyAmount = { value: 0, currency: "SUM" }
  for (const [currency, value] of map) {
    if (Math.abs(value) >= Math.abs(best.value)) best = { value, currency }
  }
  return best
}

export async function getDashboardSummary(beginISO: string, endISO: string): Promise<DashboardSummary> {
  const db = getDb()

  const branch = await selectedBranchName()
  const orderRows = (await db
      .prepare("SELECT client, amount, status FROM orders WHERE date(created_at) BETWEEN ? AND ? AND (?::text = '' OR branch_name = ?)")
      .all(beginISO, endISO, branch, branch)) as { client: string; amount: string; status: string }[]

  const salesByCurrency = new Map<string, number>()
  const returnsByCurrency = new Map<string, number>()
  const clients = new Set<string>()
  let inTransit = 0
  let delivered = 0
  let cancelledShipped = 0

  for (const row of orderRows) {
    clients.add(row.client)
    const amount = parseAmountText(row.amount)
    if (row.status === "Отменен") {
      addToMap(returnsByCurrency, amount)
      cancelledShipped += 1
    } else {
      addToMap(salesByCurrency, amount)
    }
    if (row.status === "В пути") inTransit += 1
    if (row.status === "Доставлено") delivered += 1
  }

  const paymentRows = (await db
      .prepare("SELECT amount, currency FROM customer_payments WHERE date(created_at) BETWEEN ? AND ?")
      .all(beginISO, endISO)) as { amount: number; currency: string }[]

  const paymentsByCurrency = new Map<string, number>()
  for (const row of paymentRows) {
    paymentsByCurrency.set(row.currency, (paymentsByCurrency.get(row.currency) ?? 0) + row.amount)
  }

  return {
    sales: pickPrimary(salesByCurrency),
    payments: pickPrimary(paymentsByCurrency),
    returns: pickPrimary(returnsByCurrency),
    akb: clients.size,
    field: await getFieldSummary(beginISO, endISO),
    orderStatusCounts: {
      shipped: inTransit + delivered,
      inTransit,
      delivered,
      cancelledShipped,
    },
  }
}
