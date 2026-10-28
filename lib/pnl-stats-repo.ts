import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getDb } from "@/lib/db"
import { parseAnyDay } from "@/lib/finance/dates"

// Data behind the dashboard "P&L" tab (demo #/ ?toggleTab=profit, GET stats/profit_loss/). Two periods are
// compared. An order counts as a sale when it is delivered or on its way, by its creation day, with its
// total converted to SUM at the rate valid then. Its lines split the order total by their share of the
// line value, so the product type / brand rows add up to the order. Gross profit is
// (sales - returns) - (cost - returned cost) and its rentability is that profit over the sales.

export type PnlFilters = {
  branches?: string[]
  zones?: string[]
  agents?: string[]
  productTypes?: string[]
  products?: string[]
}

export type PnlPeriod = { begin: string; end: string }
export type PnlPair = { first: number; second: number }
export type PnlFigures = { sales: number; returns: number; factSales: number; netCost: number; profit: number; rentability: number }
export type PnlRow = { name: string; first: PnlFigures; second: PnlFigures }
export type PnlExpense = { id: number; name: string; first: number; second: number; children: { id: number; name: string; first: number; second: number }[] }

export type PnlStats = {
  summary: {
    sales: PnlPair
    salesNetCost: PnlPair
    returns: PnlPair
    returnsNetCost: PnlPair
    salesProfit: PnlPair
    salesProfitRentability: PnlPair
    otherIncome: PnlPair
    indirectExpenses: PnlPair
    salary: PnlPair
    writeoffs: PnlPair
    inventoryPrice: PnlPair
    netProfit: PnlPair
    netProfitRentability: PnlPair
  }
  indirectExpenses: PnlExpense[]
  directExpenses: PnlExpense[]
  branches: PnlRow[]
  agents: PnlRow[]
  productTypes: PnlRow[]
  products: PnlRow[]
  brands: PnlRow[]
  zones: PnlRow[]
}

export type PnlOptions = { branches: string[]; zones: string[]; agents: string[]; productTypes: string[]; products: string[] }

type OrderRow = { id: number; market_name: string; zone: string; agent: string; branch_name: string; amount: string; total_price: number | null; created_at: string }
type ItemRow = {
  order_id: number
  product_name: string
  quantity: number
  unit_price: number
  cost_price: number
  discount_percent: number | null
  return_quantity: number | null
  product_type: string | null
  brand: string | null
}

const UNSET = "Не указано"
const SOLD = ["Доставлено", "В пути"]

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function currencyOf(amount: string) {
  const match = amount.trim().match(/([A-Za-zА-Яа-я]+)\s*$/)
  return (match?.[1] ?? "SUM").toUpperCase()
}

type Totals = { sales: number; returns: number; cost: number; returnCost: number }
const emptyTotals = (): Totals => ({ sales: 0, returns: 0, cost: 0, returnCost: 0 })

function figures(totals: Totals): PnlFigures {
  const factSales = totals.sales - totals.returns
  const profit = factSales - (totals.cost - totals.returnCost)
  return {
    sales: round(totals.sales, 2),
    returns: round(totals.returns, 2),
    factSales: round(factSales, 2),
    netCost: round(totals.cost, 2),
    profit: round(profit, 2),
    rentability: totals.sales ? round((profit / totals.sales) * 100, 2) : 0,
  }
}

export async function getPnlStats(first: PnlPeriod, second: PnlPeriod, filters: PnlFilters = {}): Promise<PnlStats> {
  const db = getDb()
  const has = (list: string[] | undefined) => !!list && list.length > 0

  const begin = first.begin < second.begin ? first.begin : second.begin
  const end = first.end > second.end ? first.end : second.end
  const branch = await selectedBranchName()
  const orders = (await db
    .prepare(
      `SELECT id, market_name, zone, agent, branch_name, amount, total_price, created_at FROM orders
       WHERE substr(created_at, 1, 10) BETWEEN ? AND ? AND status IN (${SOLD.map(() => "?").join(",")}) AND (?::text = '' OR branch_name = ?) ORDER BY id`,
    )
    .all(begin, end, ...SOLD, branch, branch)) as OrderRow[]

  const ids = orders.map((order) => order.id)
  const items = ids.length
    ? ((await db
        .prepare(
          `SELECT i.order_id, i.product_name, i.quantity, i.unit_price, i.cost_price, i.discount_percent, i.return_quantity,
                  p.type AS product_type, p.brand AS brand
           FROM order_items i LEFT JOIN products p ON p.id = i.product_id
           WHERE i.order_id IN (${ids.map(() => "?").join(",")})`,
        )
        .all(...ids)) as ItemRow[])
    : []
  const itemsByOrder = new Map<number, ItemRow[]>()
  for (const item of items) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item])

  const currencies = (await db.prepare("SELECT id, name, rate FROM currencies").all()) as { id: number; name: string; rate: number }[]
  const rateRows = (await db.prepare("SELECT currency_id, rate, created_at FROM currency_rates ORDER BY created_at").all()) as {
    currency_id: number
    rate: number
    created_at: string
  }[]
  const rateAt = (code: string, createdAt: string) => {
    const currency = currencies.find((item) => item.name.toUpperCase() === code)
    if (!currency || currency.rate === 1) return 1
    let rate = 0
    for (const row of rateRows) if (row.currency_id === currency.id && row.created_at <= createdAt) rate = row.rate
    return rate || currency.rate
  }

  // Unit cost in SUM from the warehouse's average-cost journal (latest row on or before the day); order lines
  // fall back to their own cost_price when a product has no journal row.
  await db.exec("ALTER TABLE cost_of_goods_rows ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''")
  const costRows = (await db.prepare("SELECT name, row_date, avg_cost, source FROM cost_of_goods_rows ORDER BY row_date, id").all()) as { name: string; row_date: string; avg_cost: number; source: string }[]
  // A product that has the reference's own journal rows is costed from those alone; the others keep their demo journal.
  const hasReference = new Set(costRows.filter((row) => row.source === "reference").map((row) => row.name))
  const costsByName = new Map<string, { date: string; cost: number }[]>()
  for (const row of costRows) {
    if (hasReference.has(row.name) && row.source !== "reference") continue
    costsByName.set(row.name, [...(costsByName.get(row.name) ?? []), { date: row.row_date, cost: row.avg_cost }])
  }
  const costAt = (name: string, dayIso: string): number | null => {
    const list = costsByName.get(name)
    if (!list?.length) return null
    let found = list[0].cost
    for (const row of list) if (row.date <= dayIso) found = row.cost
    return found
  }

  type Slot = "first" | "second"
  type Line = { slot: Slot; order: OrderRow; item: ItemRow | null; productName: string; productType: string; brand: string; sales: number; returns: number; cost: number; returnCost: number }
  const slotOf = (day: string): Slot[] => {
    const slots: Slot[] = []
    if (day >= first.begin && day <= first.end) slots.push("first")
    if (day >= second.begin && day <= second.end) slots.push("second")
    return slots
  }

  const lines: Line[] = []
  for (const order of orders) {
    if (has(filters.branches) && !filters.branches!.includes(order.branch_name || UNSET)) continue
    if (has(filters.zones) && !filters.zones!.includes(order.zone || UNSET)) continue
    if (has(filters.agents) && !filters.agents!.includes(order.agent)) continue
    const rate = rateAt(currencyOf(order.amount), order.created_at)
    const total = (order.total_price ?? 0) * rate
    const orderItems = itemsByOrder.get(order.id) ?? []
    const value = (item: ItemRow) => item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100)
    const gross = orderItems.reduce((sum, item) => sum + value(item), 0)
    const kept = orderItems.filter(
      (item) =>
        (!has(filters.productTypes) || filters.productTypes!.includes(item.product_type || UNSET)) &&
        (!has(filters.products) || filters.products!.includes(item.product_name)),
    )
    if ((has(filters.productTypes) || has(filters.products)) && kept.length === 0) continue
    for (const slot of slotOf(order.created_at.slice(0, 10))) {
      if (orderItems.length === 0) {
        lines.push({ slot, order, item: null, productName: UNSET, productType: UNSET, brand: UNSET, sales: total, returns: 0, cost: 0, returnCost: 0 })
        continue
      }
      for (const item of kept) {
        const share = gross > 0 ? value(item) / gross : 1 / orderItems.length
        lines.push({
          slot,
          order,
          item,
          productName: item.product_name || UNSET,
          productType: item.product_type || UNSET,
          brand: item.brand || UNSET,
          sales: total * share,
          // Returns are booked from the customer return documents below (as the reference does), not from line quantities.
          returns: 0,
          cost: item.quantity * (costAt(item.product_name, order.created_at.slice(0, 10)) ?? item.cost_price * rate),
          returnCost: 0,
        })
      }
    }
  }

  // Customer return documents: booked on their own day, valued at the order price and the journal cost.
  const returnDocs = (await db
    .prepare(
      `SELECT r.product_name, r.quantity, r.unit_price, r.discount_percent, r.cost_price, r.currency, r.return_date,
              o.market_name, o.zone, o.agent, o.branch_name, o.id AS order_id, o.amount, o.created_at,
              p.type AS product_type, p.brand AS brand
       FROM customer_returns r JOIN orders o ON o.id = r.order_id LEFT JOIN products p ON p.name = r.product_name
       WHERE r.return_date BETWEEN ? AND ?`,
    )
    .all(begin, end)) as {
    product_name: string
    quantity: number
    unit_price: number
    discount_percent: number | null
    cost_price: number
    currency: string
    return_date: string
    market_name: string
    zone: string
    agent: string
    branch_name: string
    order_id: number
    amount: string
    created_at: string
    product_type: string | null
    brand: string | null
  }[]
  for (const doc of returnDocs) {
    if (has(filters.branches) && !filters.branches!.includes(doc.branch_name || UNSET)) continue
    if (has(filters.zones) && !filters.zones!.includes(doc.zone || UNSET)) continue
    if (has(filters.agents) && !filters.agents!.includes(doc.agent)) continue
    if (has(filters.productTypes) && !filters.productTypes!.includes(doc.product_type || UNSET)) continue
    if (has(filters.products) && !filters.products!.includes(doc.product_name)) continue
    const rate = rateAt((doc.currency || "SUM").toUpperCase(), `${doc.return_date} 23:59:59`)
    const value = doc.quantity * doc.unit_price * (1 - (doc.discount_percent ?? 0) / 100) * rate
    const cost = doc.quantity * (costAt(doc.product_name, doc.return_date) ?? doc.cost_price * rate)
    const order: OrderRow = { id: doc.order_id, market_name: doc.market_name, zone: doc.zone, agent: doc.agent, branch_name: doc.branch_name, amount: doc.amount, total_price: null, created_at: doc.created_at }
    for (const slot of slotOf(doc.return_date)) {
      lines.push({ slot, order, item: null, productName: doc.product_name || UNSET, productType: doc.product_type || UNSET, brand: doc.brand || UNSET, sales: 0, returns: value, cost: 0, returnCost: cost })
    }
  }

  const sum = (slot: Slot) => {
    const totals = emptyTotals()
    for (const line of lines) {
      if (line.slot !== slot) continue
      totals.sales += line.sales
      totals.returns += line.returns
      totals.cost += line.cost
      totals.returnCost += line.returnCost
    }
    return totals
  }
  const group = (keyOf: (line: Line) => string): PnlRow[] => {
    const map = new Map<string, { first: Totals; second: Totals }>()
    for (const line of lines) {
      const key = keyOf(line)
      const entry = map.get(key) ?? { first: emptyTotals(), second: emptyTotals() }
      const totals = entry[line.slot]
      totals.sales += line.sales
      totals.returns += line.returns
      totals.cost += line.cost
      totals.returnCost += line.returnCost
      map.set(key, entry)
    }
    return [...map.entries()]
      .map(([name, entry]) => ({ name, first: figures(entry.first), second: figures(entry.second) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }

  // Expenses: the cash journal's entries booked to an expense category, split by the category's "direct" flag.
  const categories = (await db.prepare("SELECT id, name, parent_id, direct, exclude_from_pnl, parameter FROM expense_categories").all()) as {
    id: number
    name: string
    parent_id: number | null
    direct: number
    exclude_from_pnl: number
    parameter: string | null
  }[]
  const entries = (await db
    .prepare(
      `SELECT expense_category_id, amount, internal_amount, currency, entry_date FROM cash_management_entries
       WHERE is_deleted = 0 AND expense_category_id IS NOT NULL AND entry_date BETWEEN ? AND ?`,
    )
    .all(begin, end)) as { expense_category_id: number; amount: number; internal_amount: number | null; currency: string | null; entry_date: string }[]
  const spent = new Map<number, PnlPair>()
  for (const entry of entries) {
    const rate = rateAt((entry.currency || "SUM").toUpperCase(), `${entry.entry_date} 23:59:59`)
    const amount = Math.abs(entry.internal_amount ?? entry.amount * rate)
    for (const slot of slotOf(entry.entry_date)) {
      const pair = spent.get(entry.expense_category_id) ?? { first: 0, second: 0 }
      pair[slot] += amount
      spent.set(entry.expense_category_id, pair)
    }
  }
  // Reference rule: a root shows up in the direct tree with the children flagged direct and in the indirect tree with the
  // others; the root's own entries follow the root's own flag and, when it has children, appear as a child named like it.
  const expenseTree = (direct: boolean): PnlExpense[] => {
    const slotsOf = (id: number): PnlPair => spent.get(id) ?? { first: 0, second: 0 }
    const rows: PnlExpense[] = []
    for (const category of categories) {
      if (category.parent_id != null || category.exclude_from_pnl) continue
      const kids = categories.filter((child) => child.parent_id === category.id)
      const children = kids
        .filter((child) => !!child.direct === direct)
        .map((child) => ({ id: child.id, name: child.name, first: round(slotsOf(child.id).first, 2), second: round(slotsOf(child.id).second, 2) }))
        .filter((child) => child.first !== 0 || child.second !== 0)
      const own = !!category.direct === direct ? slotsOf(category.id) : { first: 0, second: 0 }
      if (kids.length > 0 && (own.first !== 0 || own.second !== 0)) children.unshift({ id: category.id, name: category.name, first: round(own.first, 2), second: round(own.second, 2) })
      const first = round(own.first + children.filter((child) => child.id !== category.id).reduce((sum, child) => sum + child.first, 0), 2)
      const second = round(own.second + children.filter((child) => child.id !== category.id).reduce((sum, child) => sum + child.second, 0), 2)
      if (first !== 0 || second !== 0) rows.push({ id: category.id, name: category.name, first, second, children })
    }
    return rows
  }
  const indirectExpenses = expenseTree(false)
  const directExpenses = expenseTree(true)
  const total = (rows: PnlExpense[], slot: Slot) => rows.reduce((amount, row) => amount + row[slot], 0)

  const a = figures(sum("first"))
  const b = figures(sum("second"))
  const pair = (x: number, y: number): PnlPair => ({ first: x, second: y })
  // Salary accruals, write-off and stocktaking corrections come from pnl_adjustments (kind, entry_date, amount).
  await db.exec("CREATE TABLE IF NOT EXISTS pnl_adjustments (id SERIAL PRIMARY KEY, kind TEXT NOT NULL, entry_date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, note TEXT NOT NULL DEFAULT '')")
  const adjustments = (await db
    .prepare("SELECT kind, entry_date, amount FROM pnl_adjustments WHERE entry_date BETWEEN ? AND ?")
    .all(begin, end)) as { kind: string; entry_date: string; amount: number }[]
  const adjusted = (kind: string): PnlPair => {
    const result = pair(0, 0)
    for (const row of adjustments) if (row.kind === kind) for (const slot of slotOf(row.entry_date)) result[slot] += row.amount
    return result
  }
  const salary = adjusted("salary")
  salary.first = round(salary.first, 2)
  salary.second = round(salary.second, 2)

  // Other income: cash receipts booked to an income category flagged "other income".
  const otherIncome = pair(0, 0)
  const incomeEntries = (await db
    .prepare(
      `SELECT e.amount, e.internal_amount, e.currency, e.entry_date FROM cash_management_entries e
       JOIN income_categories c ON c.id = e.income_category_id
       WHERE e.is_deleted = 0 AND c.other_income = 1 AND e.entry_date BETWEEN ? AND ?`,
    )
    .all(begin, end)) as { amount: number; internal_amount: number | null; currency: string | null; entry_date: string }[]
  for (const row of incomeEntries) {
    const rate = rateAt((row.currency || "SUM").toUpperCase(), `${row.entry_date} 23:59:59`)
    for (const slot of slotOf(row.entry_date)) otherIncome[slot] += Math.abs(row.internal_amount ?? row.amount * rate)
  }
  otherIncome.first = round(otherIncome.first, 2)
  otherIncome.second = round(otherIncome.second, 2)

  // Write-offs (document items valued at their cost) and confirmed stocktaking results, by document day.
  const RU_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
  const ruDay = (text: string): string | null => {
    const match = text.trim().match(/^(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})$/i)
    const month = match ? RU_MONTHS.findIndex((name) => match[2].toLowerCase().startsWith(name)) : -1
    return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}` : null
  }
  const writeoffs = pair(0, 0)
  // Only finished documents write goods off (a cancelled one never moved stock); the day is read from any stored date format.
  const writeoffRows = (await db.prepare("SELECT date, created_at, items FROM write_offs WHERE status = 'закрыт'").all()) as { date: string | null; created_at: string | null; items: string | null }[]
  for (const row of writeoffRows) {
    const dayIso = ruDay(row.date ?? "") ?? parseAnyDay(row.date) ?? parseAnyDay(row.created_at, true)
    if (!dayIso) continue
    let value = 0
    try {
      for (const item of JSON.parse(row.items || "[]") as { qty?: number; cost?: number; sum?: number }[]) value += item.sum ?? (item.qty ?? 0) * (item.cost ?? 0)
    } catch {
      // an unreadable items list contributes nothing
    }
    for (const slot of slotOf(dayIso)) writeoffs[slot] += value
  }
  const inventoryPrice = pair(0, 0)
  const inventoryRows = (await db
    .prepare("SELECT amount, created_at FROM inventory_records WHERE status = 'Подтвержденный' AND substr(created_at, 1, 10) BETWEEN ? AND ?")
    .all(begin, end)) as { amount: string | null; created_at: string }[]
  for (const row of inventoryRows) {
    const value = Number((row.amount ?? "").replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(value)) continue
    for (const slot of slotOf(row.created_at.slice(0, 10))) inventoryPrice[slot] += value
  }
  for (const [target, kind] of [[writeoffs, "writeoffs"], [inventoryPrice, "inventory"]] as const) {
    const extra = adjusted(kind)
    target.first = round(target.first + extra.first, 2)
    target.second = round(target.second + extra.second, 2)
  }
  const indirect = pair(total(indirectExpenses, "first"), total(indirectExpenses, "second"))
  const net = (figs: PnlFigures, slot: Slot) =>
    figs.profit + otherIncome[slot] - indirect[slot] - salary[slot] - writeoffs[slot] + inventoryPrice[slot]
  const netExtra = adjusted("net")
  const netFirst = net(a, "first") + netExtra.first
  const netSecond = net(b, "second") + netExtra.second

  return {
    summary: {
      sales: pair(a.sales, b.sales),
      salesNetCost: pair(a.netCost, b.netCost),
      returns: pair(a.returns, b.returns),
      returnsNetCost: pair(round(sum("first").returnCost, 2), round(sum("second").returnCost, 2)),
      salesProfit: pair(a.profit, b.profit),
      salesProfitRentability: pair(a.rentability, b.rentability),
      otherIncome,
      indirectExpenses: indirect,
      salary,
      writeoffs,
      inventoryPrice,
      netProfit: pair(round(netFirst, 2), round(netSecond, 2)),
      netProfitRentability: pair(a.sales ? round((netFirst / a.sales) * 100, 2) : 0, b.sales ? round((netSecond / b.sales) * 100, 2) : 0),
    },
    indirectExpenses,
    directExpenses,
    branches: group((line) => line.order.branch_name || UNSET),
    agents: group((line) => line.order.agent || UNSET),
    productTypes: group((line) => line.productType),
    products: group((line) => line.productName),
    brands: group((line) => line.brand),
    zones: group((line) => line.order.zone || UNSET),
  }
}

export async function getPnlOptions(): Promise<PnlOptions> {
  const db = getDb()
  const names = async (sql: string) => [...new Set(((await db.prepare(sql).all()) as { name: string }[]).map((row) => row.name).filter(Boolean))]
  return {
    branches: await names("SELECT name FROM branches ORDER BY name"),
    zones: await names("SELECT title AS name FROM zone_options ORDER BY title"),
    agents: await names("SELECT TRIM(first_name || ' ' || last_name) AS name FROM employees WHERE active = 1 ORDER BY 1"),
    productTypes: await names("SELECT name FROM product_types ORDER BY name"),
    products: await names("SELECT name FROM products WHERE deleted = 0 ORDER BY name"),
  }
}
