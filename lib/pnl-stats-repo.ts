import "server-only"

import { ensureCashSchema } from "@/lib/cash/schema"
import { ensureClientReturnsSchema } from "@/lib/client-returns-repo"
import { loadRateBook } from "@/lib/currency-rates-repo"
import { getDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { REVALUATION_KIND } from "@/lib/net-cost-ledger"
import { ensureOrdersSchema, parseMoneyText } from "@/lib/orders-repo"
import { selectedBranchName } from "@/lib/selected-branch"
import { ensureStockInventoriesSchema } from "@/lib/stock-inventories-schema"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

// Data behind the dashboard "P&L" tab (demo #/ ?toggleTab=profit, GET stats/profit_loss/). Two periods are
// compared. An order counts as a sale when it is delivered or on its way, by its creation day (Tashkent),
// with its total converted to the base currency (Валюты) at the rate valid then. Its lines split the order
// total by their share of the line value, so the product type / brand rows add up to the order. Returns are
// the accepted client returns (Продажи → Возвраты), by their acceptance day. Cost of goods is the one cost of
// the app (lib/stock/costs.ts): the value the cost ledger moved the document's goods at, else the item's
// average of that day. Gross profit is (sales - returns) - (cost - returned cost) and its rentability is that
// profit over the sales.

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
  /** Base currency (Валюты) every amount is in. */
  currency: string
  /** Currencies of documents in the periods that have no rate to the base currency (left out of the sums). */
  missingRates: string[]
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

type OrderRow = {
  id: number
  zone: string
  agent: string
  branch_name: string
  currency: string
  amount: string
  total_price: number | null
  created_at: string
  /** Local (Tashkent) creation day, YYYY-MM-DD. */
  day: string
}
type ItemRow = {
  order_id: number
  item_key: string
  product_name: string
  quantity: number
  unit_price: number
  cost_price: number | null
  discount_percent: number | null
  currency: string | null
  product_type: string | null
  brand: string | null
}
type ReturnLineRow = {
  return_id: number
  /** Local acceptance day, YYYY-MM-DD. */
  day: string
  stamp: string
  currency: string
  zone: string
  agent: string
  branch_name: string
  item_key: string
  product_name: string
  quantity: number
  price: number
  product_type: string | null
  brand: string | null
}

const UNSET = "Не указано"
const SOLD = ["Доставлено", "В пути"]

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
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

/** Stock item key of a document line (lib/stock/sources.ts): the product id, else the product with that
 * name, else 'name:<fin_key>' — so lib/stock/costs.ts finds the item's cost. */
const ITEM_KEY = (idExpr: string, nameExpr: string) =>
  `CASE WHEN COALESCE(${idExpr}, pn.id) IS NOT NULL THEN 'product:' || COALESCE(${idExpr}, pn.id) ELSE 'name:' || fin_key(${nameExpr}) END`
const PRODUCT_BY_NAME = "pn AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, id FROM products WHERE COALESCE(deleted, 0) = 0 ORDER BY fin_key(name), id)"

export async function getPnlStats(first: PnlPeriod, second: PnlPeriod, filters: PnlFilters = {}): Promise<PnlStats> {
  // Tables / columns / fin_* helpers created lazily by their modules (orders, returns, cash journal,
  // inventories; the rate book installs the rate history): fresh-install safe, all outside this request.
  await Promise.all([ensureOrdersSchema(), ensureClientReturnsSchema(), ensureStockInventoriesSchema()])
  const db = getDb()
  await ensureCashSchema(db)
  const book = await loadRateBook(db)
  const missing = new Set<string>()
  /** Units of the base currency per unit of `code` valid at `stamp`; 0 (and noted) when the currency has no rate. */
  const toBase = (code: string | null | undefined, stamp: string): number => {
    const rate = book.rateAt(code, stamp)
    if (rate === null) {
      missing.add(normCurrency(code, book.base))
      return 0
    }
    return rate
  }
  /** End of a local (Tashkent) day as a stamp the rate book reads. */
  const endOfDay = (day: string) => `${day.slice(0, 10)}T23:59:59+05:00`
  const has = (list: string[] | undefined) => !!list && list.length > 0

  const begin = first.begin < second.begin ? first.begin : second.begin
  const end = first.end > second.end ? first.end : second.end
  const branch = await selectedBranchName()
  const orderDay = "fin_ts(o.created_at, true)::date"
  const orders = (await db
    .prepare(
      `SELECT o.id, o.zone, o.agent, o.branch_name, o.currency, o.amount, o.total_price, o.created_at,
              to_char(${orderDay}, 'YYYY-MM-DD') AS day
         FROM orders o
        WHERE o.status = ANY(@sold::text[]) AND (@branch::text = '' OR o.branch_name = @branch)
          AND ${orderDay} BETWEEN @begin::date AND @end::date
        ORDER BY o.id`,
    )
    .all({ sold: SOLD, branch, begin, end })) as OrderRow[]

  const ids = orders.map((order) => Number(order.id))
  const items = ids.length
    ? ((await db
        .prepare(
          `WITH ${PRODUCT_BY_NAME}
           SELECT i.order_id, ${ITEM_KEY("i.product_id", "i.product_name")} AS item_key, i.product_name, i.quantity, i.unit_price, i.cost_price,
                  i.discount_percent, i.currency, p.type AS product_type, p.brand AS brand
             FROM order_items i
             LEFT JOIN pn ON i.product_id IS NULL AND pn.k = fin_key(i.product_name)
             LEFT JOIN products p ON p.id = COALESCE(i.product_id, pn.id)
            WHERE i.order_id = ANY(@ids::int[])
            ORDER BY i.order_id, i.id`,
        )
        .all({ ids })) as ItemRow[])
    : []
  const itemsByOrder = new Map<number, ItemRow[]>()
  for (const item of items) itemsByOrder.set(Number(item.order_id), [...(itemsByOrder.get(Number(item.order_id)) ?? []), item])

  // Accepted client returns of the periods (Продажи → Возвраты), line by line; the order's branch / zone / agent,
  // else the client's.
  const returnDay = "COALESCE(fin_ts(NULLIF(r.accepted_at, '')), fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))::date"
  const returnLines = (await db
    .prepare(
      `WITH ${PRODUCT_BY_NAME}
       SELECT r.id AS return_id, to_char(${returnDay}, 'YYYY-MM-DD') AS day, COALESCE(NULLIF(r.accepted_at, ''), r.created_at) AS stamp,
              COALESCE(NULLIF(btrim(r.currency), ''), NULLIF(btrim(o.currency), ''), '') AS currency,
              COALESCE(NULLIF(btrim(o.zone), ''), btrim(COALESCE(c.zone, '')), '') AS zone,
              COALESCE(NULLIF(btrim(o.agent), ''), NULLIF(btrim(r.agent), ''), btrim(COALESCE(c.agent, '')), '') AS agent,
              COALESCE(NULLIF(btrim(o.branch_name), ''), btrim(COALESCE(c.branch, '')), '') AS branch_name,
              ${ITEM_KEY("ri.product_id", "ri.product_name")} AS item_key, ri.product_name, ri.quantity, ri.price,
              p.type AS product_type, p.brand AS brand
         FROM client_returns r
         JOIN client_return_items ri ON ri.return_id = r.id
         LEFT JOIN orders o ON o.id = r.order_id
         LEFT JOIN clients c ON c.id = COALESCE(r.client_id, o.client_id)
         LEFT JOIN pn ON ri.product_id IS NULL AND pn.k = fin_key(ri.product_name)
         LEFT JOIN products p ON p.id = COALESCE(ri.product_id, pn.id)
        WHERE r.status = 'accepted' AND ${returnDay} BETWEEN @begin::date AND @end::date
        ORDER BY r.id, ri.id`,
    )
    .all({ begin, end })) as ReturnLineRow[]

  // The one cost of goods (base currency): the unit value the cost ledger moved the document's goods at,
  // else the item's average at the end of that day. Loaded once (cached per state of its sources); it also
  // values the write-offs and the stocktaking result below.
  const ledger = await loadCostLedger(db)
  const moved = documentLineValues(ledger)
  const costsByDay = new Map<string, Map<string, number>>()
  const unitCost = (docType: string, docId: number, key: string, day: string): number | undefined => {
    if (!key) return undefined
    const own = documentLineUnit(moved, docType, docId, key)
    if (own !== undefined) return own
    let costs = costsByDay.get(day)
    if (!costs) costsByDay.set(day, (costs = costsFromLedger(ledger, day)))
    return costs.get(key)
  }

  type Slot = "first" | "second"
  type Line = { slot: Slot; branch: string; zone: string; agent: string; productName: string; productType: string; brand: string; sales: number; returns: number; cost: number; returnCost: number }
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
    const orderItems = itemsByOrder.get(Number(order.id)) ?? []
    const parsed = parseMoneyText(order.amount ?? "")
    // The order's currency (every line is in it); legacy orders: the first line's, else the amount text's.
    const currency = normCurrency(order.currency || orderItems[0]?.currency || parsed?.currency || "", book.base)
    const rate = toBase(currency, order.created_at)
    const value = (item: ItemRow) => Number(item.quantity) * Number(item.unit_price) * (1 - Number(item.discount_percent ?? 0) / 100)
    const gross = orderItems.reduce((sum, item) => sum + value(item), 0)
    // The order total (total_price; orders saved before it existed: the amount text, else the lines).
    const total = (order.total_price ?? parsed?.value ?? gross) * rate
    const kept = orderItems.filter(
      (item) =>
        (!has(filters.productTypes) || filters.productTypes!.includes(item.product_type || UNSET)) &&
        (!has(filters.products) || filters.products!.includes(item.product_name)),
    )
    if ((has(filters.productTypes) || has(filters.products)) && kept.length === 0) continue
    const place = { branch: order.branch_name || UNSET, zone: order.zone || UNSET, agent: order.agent || UNSET }
    for (const slot of slotOf(order.day)) {
      if (orderItems.length === 0) {
        lines.push({ slot, ...place, productName: UNSET, productType: UNSET, brand: UNSET, sales: total, returns: 0, cost: 0, returnCost: 0 })
        continue
      }
      for (const item of kept) {
        const share = gross > 0 ? value(item) / gross : 1 / orderItems.length
        // Lines the ledger does not know: their own cost price, in the order's currency.
        const unit = unitCost("orders", Number(order.id), item.item_key, order.day) ?? Number(item.cost_price ?? 0) * rate
        lines.push({
          slot,
          ...place,
          productName: item.product_name || UNSET,
          productType: item.product_type || UNSET,
          brand: item.brand || UNSET,
          sales: total * share,
          // Returns are booked from the return documents below (as the reference does), not from line quantities.
          returns: 0,
          cost: Number(item.quantity) * unit,
          returnCost: 0,
        })
      }
    }
  }

  for (const line of returnLines) {
    if (branch && line.branch_name !== branch) continue
    if (has(filters.branches) && !filters.branches!.includes(line.branch_name || UNSET)) continue
    if (has(filters.zones) && !filters.zones!.includes(line.zone || UNSET)) continue
    if (has(filters.agents) && !filters.agents!.includes(line.agent)) continue
    if (has(filters.productTypes) && !filters.productTypes!.includes(line.product_type || UNSET)) continue
    if (has(filters.products) && !filters.products!.includes(line.product_name)) continue
    const rate = toBase(line.currency, line.stamp)
    const quantity = Number(line.quantity)
    const value = quantity * Number(line.price) * rate
    const cost = quantity * (unitCost("client_returns", Number(line.return_id), line.item_key, line.day) ?? 0)
    for (const slot of slotOf(line.day)) {
      lines.push({
        slot,
        branch: line.branch_name || UNSET,
        zone: line.zone || UNSET,
        agent: line.agent || UNSET,
        productName: line.product_name || UNSET,
        productType: line.product_type || UNSET,
        brand: line.brand || UNSET,
        sales: 0,
        returns: value,
        cost: 0,
        returnCost: cost,
      })
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
    const amount = Math.abs(entry.internal_amount ?? entry.amount * toBase(entry.currency, endOfDay(entry.entry_date)))
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
  // Salary: no source of this company's accruals is wired in yet. (The reference account's figures that the removed
  // demo scripts wrote into pnl_adjustments, together with its write-off / stocktaking / net corrections, are not read.)
  const salary = pair(0, 0)

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
    const amount = Math.abs(row.internal_amount ?? row.amount * toBase(row.currency, endOfDay(row.entry_date)))
    for (const slot of slotOf(row.entry_date)) otherIncome[slot] += amount
  }
  otherIncome.first = round(otherIncome.first, 2)
  otherIncome.second = round(otherIncome.second, 2)

  // Write-offs and the stocktaking result at the one cost of goods (lib/stock/costs.ts): the value the cost ledger
  // moved the goods of every finished write-off ("закрыт") and confirmed count at, by the ledger's document day, as
  // "Остаток на определенную дату" sums them in cost mode (writeoff, inventory_in + inventory_out). A write-off is
  // the value that left (issues are negative in the ledger); a count adds its surplus and takes its shortage.
  const writeoffs = pair(0, 0)
  const inventoryPrice = pair(0, 0)
  for (const list of ledger.postings.values()) {
    for (const posting of list) {
      if (posting.kind === REVALUATION_KIND || posting.day < begin || posting.day > end) continue
      if (posting.docType === "write_offs") for (const slot of slotOf(posting.day)) writeoffs[slot] -= posting.value
      else if (posting.docType === "stock_inventories") for (const slot of slotOf(posting.day)) inventoryPrice[slot] += posting.value
    }
  }
  for (const target of [writeoffs, inventoryPrice]) {
    target.first = round(target.first, 2)
    target.second = round(target.second, 2)
  }
  const indirect = pair(total(indirectExpenses, "first"), total(indirectExpenses, "second"))
  const net = (figs: PnlFigures, slot: Slot) =>
    figs.profit + otherIncome[slot] - indirect[slot] - salary[slot] - writeoffs[slot] + inventoryPrice[slot]
  const netFirst = net(a, "first")
  const netSecond = net(b, "second")

  return {
    currency: book.base,
    missingRates: [...missing].sort(),
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
    branches: group((line) => line.branch),
    agents: group((line) => line.agent),
    productTypes: group((line) => line.productType),
    products: group((line) => line.productName),
    brands: group((line) => line.brand),
    zones: group((line) => line.zone),
  }
}

export async function getPnlOptions(): Promise<PnlOptions> {
  const db = getDb()
  const names = async (sql: string) => [...new Set(((await db.prepare(sql).all()) as { name: string }[]).map((row) => row.name).filter(Boolean))]
  // branches is created lazily by its own module: on a fresh database it lists nothing yet.
  const branchesExist = Boolean(((await db.prepare("SELECT to_regclass('branches') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined)?.ok)
  return {
    branches: branchesExist ? await names("SELECT name FROM branches ORDER BY name") : [],
    // zones: the directory behind the client's "Зона" (client_zones)
    zones: await names("SELECT name FROM client_zones ORDER BY name"),
    agents: await names("SELECT TRIM(first_name || ' ' || last_name) AS name FROM employees WHERE active = 1 ORDER BY 1"),
    productTypes: await names("SELECT name FROM product_types ORDER BY name"),
    products: await names("SELECT name FROM products WHERE deleted = 0 ORDER BY name"),
  }
}
