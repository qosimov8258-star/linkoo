// Shared (client + server) types of the server-side sales reports
// (lib/finance/pnl.ts): P&L (/api/balances/pnl) and ABC анализ (/api/balances/abc).
// All money is in the base currency.

export type PnlTotals = {
  /** Реализовано: released order lines. */
  realization: number
  /** Возвраты: accepted client returns. */
  returns: number
  /** Себестоимость реализованной продукции. */
  cost: number
  /** Себестоимость возвратов. */
  returnCost: number
  /** Net quantity (sold − returned). */
  quantity: number
}

export type PnlGroupRow = { name: string; periods: PnlTotals[] }

export type SalesReportOptions = {
  branches: string[]
  organizations: string[]
  productTypes: string[]
  brands: string[]
  products: string[]
  zones: string[]
  agents: string[]
}

export type PnlResult = {
  baseCurrency: string
  /** Currencies of lines left out because they have no rate. */
  missingRates: string[]
  periods: Array<{ from: string; to: string }>
  /** One entry per period. */
  totals: PnlTotals[]
  groups: Record<"branch" | "agent" | "productType" | "brand" | "zone" | "product", PnlGroupRow[]>
  options: SalesReportOptions
}

export type AbcRow = { id: number; name: string; quantity: number; quantityPercent: number; sales: number; salesPercent: number; abcClass: "A" | "B" | "C" }

export type AbcResult = {
  baseCurrency: string
  missingRates: string[]
  from: string
  to: string
  groupBy: string
  rows: AbcRow[]
  totals: { quantity: number; sales: number }
  options: SalesReportOptions
}

/** Net realization, gross profit and its margin (%) of P&L totals. */
export function pnlMetrics(totals: PnlTotals): { net: number; profit: number; margin: number } {
  const net = totals.realization - totals.returns
  const profit = net - (totals.cost - totals.returnCost)
  return { net, profit, margin: net ? Math.round((profit / net) * 1000) / 10 : 0 }
}
