/** A line of «Прибыль от агентов» / «Прибыль от товаров» (GET /api/sales-lines, lib/sales-lines-repo.ts). */
export type SalesLine = {
  /** "sale": a line of a not cancelled order; "return": a line of an accepted client return. */
  kind: "sale" | "return"
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  /** The document's own currency. */
  currency: string
  /** Amount after the discount, the discount itself and the net cost, in the base currency (0 when hidden). */
  amountBase: number
  discountBase: number
  costBase: number
  discounted: boolean
  client: string
  agent: string
  /** The order's status ("" for a return without an order). */
  status: string
  /** Local days "YYYY-MM-DD": created; transferred from the warehouse (a return: accepted). "" when none. */
  createdDay: string
  transferDay: string
  branch: string
  organization: string
  warehouse: string
  productType: string
  brand: string
  clientType: string
}

export type SalesLines = {
  base: string
  /** False when the reader may not see cost prices (the profit columns stay hidden then). */
  canSeeCost: boolean
  /** Currencies without a rate: their amounts are counted 1:1. */
  missingRates: string[]
  lines: SalesLine[]
}

/** The filters of the two reports (Linko's filter panels). */
export type SalesLineFilters = {
  branch: string
  organization: string
  productType: string
  brand: string
  status: string
  client: string
  agent: string
  clientType: string
  warehouse: string
  /** «Продано дешевле себестоимости»: only the sales below the net cost. */
  belowCost: boolean
}

export const EMPTY_SALES_FILTERS: SalesLineFilters = {
  branch: "",
  organization: "",
  productType: "",
  brand: "",
  status: "",
  client: "",
  agent: "",
  clientType: "",
  warehouse: "",
  belowCost: false,
}

const same = (value: string, wanted: string) => !wanted || value.replace(/\s+/g, " ").trim().toLowerCase() === wanted.replace(/\s+/g, " ").trim().toLowerCase()
const inDays = (value: string, from?: string, to?: string) => !from || !to || (value !== "" && value >= from && value <= to)

/**
 * The lines a report counts. `created` = the creation period, `transfer` = the period of the transfer from the
 * warehouse (Linko's accepted_time); each one given applies. The order status filter applies to the sales only.
 */
export function selectSalesLines(
  lines: SalesLine[],
  filters: SalesLineFilters,
  periods: { created?: { from: string; to: string }; transfer?: { from: string; to: string } },
): SalesLine[] {
  return lines.filter(
    (line) =>
      inDays(line.createdDay, periods.created?.from, periods.created?.to) &&
      inDays(line.transferDay, periods.transfer?.from, periods.transfer?.to) &&
      same(line.branch, filters.branch) &&
      same(line.organization, filters.organization) &&
      same(line.productType, filters.productType) &&
      same(line.brand, filters.brand) &&
      same(line.client, filters.client) &&
      same(line.agent, filters.agent) &&
      same(line.clientType, filters.clientType) &&
      same(line.warehouse, filters.warehouse) &&
      (line.kind === "return" || same(line.status, filters.status)) &&
      (!filters.belowCost || (line.kind === "sale" && line.costBase > 0 && line.amountBase < line.costBase)),
  )
}

/** Sums of one row of the reports (sales, returns of the period, actual sales, profit, discounts). */
export type SalesTotals = {
  saleQty: number
  saleSum: number
  saleCost: number
  returnQty: number
  returnSum: number
  returnCost: number
  discountQty: number
  discountSum: number
}

export const emptyTotals = (): SalesTotals => ({ saleQty: 0, saleSum: 0, saleCost: 0, returnQty: 0, returnSum: 0, returnCost: 0, discountQty: 0, discountSum: 0 })

export function addLine(total: SalesTotals, line: SalesLine, money: (amountBase: number) => number): void {
  if (line.kind === "return") {
    total.returnQty += line.quantity
    total.returnSum += money(line.amountBase)
    total.returnCost += money(line.costBase)
    return
  }
  total.saleQty += line.quantity
  total.saleSum += money(line.amountBase)
  total.saleCost += money(line.costBase)
  if (line.discounted) {
    total.discountQty += line.quantity
    total.discountSum += money(line.discountBase)
  }
}

/** Linko's profit_sum: the actual sales minus the net cost of what stayed sold. */
export const profitOf = (total: SalesTotals) => total.saleSum - total.returnSum - (total.saleCost - total.returnCost)

/** "372 035,2": quantities and money with at most 3 decimals (never the raw 372035.19999999995). */
export const reportNumber = (value: number) => (Math.round(value * 1000) / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 3 })
