// Shared (client + server) answer of GET /api/cash/flow ("Движения денежных средств", lib/cash/flow.ts).

export type CashFlowRow = {
  /** Article: the category name or the operation type label (Russian i18n key / data). */
  name: string
  /** "YYYY-MM" → amount in the base currency (income +, expense −). */
  months: Record<string, number>
  total: number
  /** Number of operations. */
  count: number
}

export type CashFlowSection = {
  key: "income" | "expense" | "transfer"
  /** Russian i18n key. */
  title: string
  rows: CashFlowRow[]
  months: Record<string, number>
  total: number
}

export type CashFlowResult = {
  baseCurrency: string
  from: string
  to: string
  months: string[]
  /** Balance of the chosen cash desks before the period (base currency). */
  opening: number
  sections: CashFlowSection[]
  net: Record<string, number>
  netTotal: number
  closing: number
}
