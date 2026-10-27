// Shared (client + server) type of GET /api/balances/overview, the data of the
// dashboard tab "БАЛАНС" (lib/finance/overview.ts).

import type { PnlGroupRow, PnlTotals } from "@/lib/finance/pnl-types"
import type { FinanceCurrency } from "@/lib/finance/types"

export type OverviewAmount = { name: string; currency: string; begin: number; end: number }

export type BalanceOverview = {
  from: string
  to: string
  baseCurrency: string
  currencies: FinanceCurrency[]
  /** Codes without a rate (left out of base-currency totals). */
  missingRates: string[]
  /** Management balance lines summed over every branch (label = Russian i18n key). */
  lines: Array<{ key: string; label: string; section: "assets" | "passives"; currency: string; begin: number; end: number }>
  /** Base currency. */
  totals: Record<"assets" | "passives" | "equity", { begin: number; end: number }>
  cashboxes: Array<{ id: number | null; name: string; currency: string; begin: number; income: number; expenses: number; transferIncome: number; transferExpense: number; end: number }>
  /** Σ cashbox income of the period per currency. */
  cashIncome: Record<string, number>
  /** Stock value per warehouse (base currency). */
  warehouses: Array<{ name: string; begin: number; end: number }>
  /** Net debt of the clients of each client type (positive = they owe). */
  clientDebts: OverviewAmount[]
  /** What we owe each supplier (positive = we owe). */
  supplierDebts: OverviewAmount[]
  sales: PnlTotals
  salesByType: PnlGroupRow[]
  salesByBrand: PnlGroupRow[]
  salesByAgent: PnlGroupRow[]
  /** Costs of the period by expense category (base currency, positive): plain cashbox expenses only —
   * no settlements (supplier / client money, supply extra costs, cashback payouts or categories with
   * those options) and no P&L-excluded categories (lib/finance/overview.ts). */
  expenses: { direct: Array<{ name: string; amount: number }>; indirect: Array<{ name: string; amount: number }> }
}
