import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey, placeName } from "@/lib/finance/entities"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { orderClientJoin, orderCountedSql, orderRealizationTs, orderReleasedSql } from "@/lib/finance/sources"
import type { AbcResult, AbcRow, PnlGroupRow, PnlResult, PnlTotals, SalesReportOptions } from "@/lib/finance/pnl-types"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

// Server side of the sales reports "P&L" (/analytics/pnl) and "ABC анализ"
// (/analytics/abc-analysis), computed from the same documents as the client
// ledger:
// - sales = order lines of released orders (В пути / Доставлено), dated by
//   their realization moment (orderRealizationTs, like Баланс клиентов "по дате
//   реализации"); cancelled / unconfirmed / not shipped orders are no sale.
//   ABC ranks every counted order (not Отменен / Не подтвержден) by its
//   creation day ("Дата создания").
// - returns = items of accepted client returns (client_returns, sales
//   module), dated by the acceptance day.
// - money is converted to the base currency with the currencies' rates;
//   lines in a currency without a rate are left out (missingRates).
// - cost of goods = the value the cost ledger (lib/stock/costs.ts, the one cost
//   of goods of the app) moved the document's goods at: an order's issue / a
//   return's receipt at the moving average of their real moment, per unit of the
//   item on that document. So the P&L cost of sales and of returns equals the change
//   of stock value they caused ("Остаток на определенную дату" in cost mode).
//   A line the ledger did not move (an order without a warehouse) falls back to
//   quantity × the item's average at the end of that day.

export type SalesLine = {
  kind: "sale" | "return"
  day: string
  branch: string
  zone: string
  agent: string
  organization: string
  productType: string
  brand: string
  product: string
  itemKey: string
  quantity: number
  /** Base currency. */
  amount: number
  /** Base currency (quantity × the ledger's unit cost of the document's goods). */
  cost: number
}

export type SalesFilters = {
  branches?: string[]
  zones?: string[]
  agents?: string[]
  productTypes?: string[]
  brands?: string[]
  products?: string[]
  organizations?: string[]
}

type RawLine = {
  kind: "sale" | "return"
  /** orders.id / client_returns.id. */
  doc_id: number | string | null
  day: string | null
  branch: string | null
  zone: string | null
  agent: string | null
  organization: string | null
  product_type: string | null
  brand: string | null
  product: string | null
  item_key: string
  qty: number | string | null
  amount: number | string | null
  cur: string
}

const EMPTY = (): PnlTotals => ({ realization: 0, returns: 0, cost: 0, returnCost: 0, quantity: 0 })

/** raw_materials (not a ledger table): exists / has a soft-delete flag. */
type RawMaterialsTable = { exists: boolean; deleted: boolean }

/** Product dimensions and the stock item key of a sold / returned line. The
 * key follows the stock core (lib/stock/sources.ts): the line's product id,
 * else the product, else the raw material with that name, else
 * 'name:<fin_key>', so lib/stock/costs.ts finds the item's cost. */
function productJoin(s: FinanceSchema, raw: RawMaterialsTable, idExpr: string, nameExpr: string): { ctes: string[]; joins: string; key: string; type: string; brand: string; name: string } {
  const rawCte = raw.exists
    ? [`rn AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, id FROM raw_materials ${raw.deleted ? "WHERE COALESCE(deleted, 0) = 0" : ""} ORDER BY fin_key(name), id)`]
    : []
  if (!s.has("products")) {
    return {
      ctes: rawCte,
      joins: raw.exists ? `LEFT JOIN rn ON rn.k = fin_key(${nameExpr})` : "",
      key: raw.exists ? `CASE WHEN rn.id IS NOT NULL THEN 'raw_material:' || rn.id ELSE 'name:' || fin_key(${nameExpr}) END` : `'name:' || fin_key(${nameExpr})`,
      type: "''",
      brand: "''",
      name: nameExpr,
    }
  }
  const alive = s.col("products", "deleted") ? "WHERE COALESCE(deleted, 0) = 0" : ""
  const product = `COALESCE(${idExpr}, pn.id)`
  return {
    ctes: [`pn AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, id FROM products ${alive} ORDER BY fin_key(name), id)`, ...rawCte],
    joins: `LEFT JOIN pn ON ${idExpr} IS NULL AND pn.k = fin_key(${nameExpr}) LEFT JOIN products pr ON pr.id = ${product}${
      raw.exists ? ` LEFT JOIN rn ON ${product} IS NULL AND rn.k = fin_key(${nameExpr})` : ""
    }`,
    key: `CASE WHEN ${product} IS NOT NULL THEN 'product:' || ${product}${raw.exists ? " WHEN rn.id IS NOT NULL THEN 'raw_material:' || rn.id" : ""} ELSE 'name:' || fin_key(${nameExpr}) END`,
    type: s.col("products", "type") ? "fin_place(pr.type)" : "''",
    brand: s.col("products", "brand") ? "fin_place(pr.brand)" : "''",
    name: `COALESCE(NULLIF(btrim(${nameExpr}), ''), pr.name, '')`,
  }
}

async function rawMaterialsTable(db: PgDb): Promise<RawMaterialsTable> {
  const rows = (await db
    .prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'raw_materials'")
    .all()) as Array<{ column_name: string }>
  const columns = new Set(rows.map((row) => row.column_name))
  return { exists: columns.has("id") && columns.has("name"), deleted: columns.has("deleted") }
}

/** Raw sale / return lines dated inside [from, to] ("realization" = released
 * orders by realization day, "created" = counted orders by creation day). */
async function loadLines(db: PgDb, s: FinanceSchema, base: string, from: string, to: string, basis: "realization" | "created"): Promise<RawLine[]> {
  if (!s.has("orders") || !s.has("clients")) return []
  const raw = await rawMaterialsTable(db)
  const parts: string[] = []
  const ctes = ["ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)"]
  const hasWarehouses = s.has("warehouses") && s.col("warehouses", "branch")
  if (hasWarehouses) ctes.push("wb AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, fin_place(branch) AS branch FROM warehouses ORDER BY fin_key(name), id)")
  const clientBranch = s.col("clients", "branch") ? "fin_place(oc.branch)" : "''"
  const clientZone = s.col("clients", "zone") ? "fin_place(oc.zone)" : "''"
  const clientAgent = s.col("clients", "agent") ? "fin_place(oc.agent)" : "''"
  const orderWarehouse = hasWarehouses && s.col("orders", "warehouse")
  const orderBranch = orderWarehouse ? `COALESCE(NULLIF(wb.branch, ''), ${clientBranch})` : clientBranch
  const orderOrg = s.col("orders", "organization") ? "fin_place(o.organization)" : "''"
  const orderTs = basis === "realization" ? orderRealizationTs(s, "o") : "fin_ts(o.created_at, true)"
  const orderWhere = `${basis === "realization" ? orderReleasedSql("o") : orderCountedSql("o")} AND (${orderTs})::date BETWEEN @from::date AND @to::date`
  const orderJoins = `${orderClientJoin(s, "o", "oc", "ck")} ${orderWarehouse ? "LEFT JOIN wb ON wb.k = fin_key(o.warehouse)" : ""}`

  if (s.has("order_items")) {
    const product = productJoin(s, raw, s.col("order_items", "product_id") ? "oi.product_id" : "NULL::int", "oi.product_name")
    for (const cte of product.ctes) if (!ctes.includes(cte)) ctes.push(cte)
    const discount = s.col("order_items", "discount_percent") ? "(1 - COALESCE(oi.discount_percent, 0)::float8 / 100)" : "1"
    const currency = s.col("order_items", "currency") ? "COALESCE(fin_cur(oi.currency), @base)" : "@base"
    parts.push(`SELECT 'sale' AS kind, o.id AS doc_id, to_char(${orderTs}, 'YYYY-MM-DD') AS day, ${orderBranch} AS branch,
        COALESCE(NULLIF(fin_place(o.zone), ''), ${clientZone}) AS zone, COALESCE(NULLIF(fin_place(o.agent), ''), ${clientAgent}) AS agent, ${orderOrg} AS organization,
        ${product.type} AS product_type, ${product.brand} AS brand, ${product.name} AS product, ${product.key} AS item_key,
        oi.quantity::float8 AS qty, oi.quantity::float8 * oi.unit_price::float8 * ${discount} AS amount, ${currency} AS cur
      FROM orders o ${orderJoins} JOIN order_items oi ON oi.order_id = o.id ${product.joins}
      WHERE ${orderWhere}`)
  }
  // Orders without lines (legacy free-text amount "1 000 SUM, 12 USD").
  parts.push(`SELECT 'sale' AS kind, o.id AS doc_id, to_char(${orderTs}, 'YYYY-MM-DD') AS day, ${orderBranch} AS branch,
      COALESCE(NULLIF(fin_place(o.zone), ''), ${clientZone}) AS zone, COALESCE(NULLIF(fin_place(o.agent), ''), ${clientAgent}) AS agent, ${orderOrg} AS organization,
      '' AS product_type, '' AS brand, '' AS product, '' AS item_key, 0::float8 AS qty, a.amount AS amount, COALESCE(a.currency, @base) AS cur
    FROM orders o ${orderJoins} CROSS JOIN LATERAL fin_amounts(o.amount) a
    WHERE ${orderWhere} ${s.has("order_items") ? "AND NOT EXISTS (SELECT 1 FROM order_items z WHERE z.order_id = o.id)" : ""}`)

  // Accepted client returns (contract: client_returns / client_return_items of the sales module).
  const CR = "client_returns"
  const CRI = "client_return_items"
  if (s.has(CR) && s.has(CRI) && s.col(CR, "status") && s.col(CRI, "return_id")) {
    const product = productJoin(s, raw, s.col(CRI, "product_id") ? "ri.product_id" : "NULL::int", s.col(CRI, "product_name") ? "ri.product_name" : "''")
    for (const cte of product.ctes) if (!ctes.includes(cte)) ctes.push(cte)
    const returnTs = [s.col(CR, "accepted_at") ? "fin_ts(r.accepted_at::text, true)" : "", s.col(CR, "return_date") ? "fin_ts(r.return_date::text)" : ""].filter(Boolean)
    const tsExpr = returnTs.length ? `COALESCE(${returnTs.join(", ")})` : "NULL::timestamp"
    const client = s.col(CR, "client_id")
      ? s.col(CR, "client")
        ? "LEFT JOIN ck rk ON r.client_id IS NULL AND rk.k = fin_key(r.client) JOIN clients oc ON oc.id = COALESCE(r.client_id, rk.id)"
        : "JOIN clients oc ON oc.id = r.client_id"
      : "JOIN ck rk ON rk.k = fin_key(r.client) JOIN clients oc ON oc.id = rk.id"
    const withOrder = s.col(CR, "order_id")
    const returnWarehouse = hasWarehouses && s.col(CR, "warehouse")
    const branch = returnWarehouse ? `COALESCE(NULLIF(wr.branch, ''), ${clientBranch})` : clientBranch
    parts.push(`SELECT 'return' AS kind, r.id AS doc_id, to_char(${tsExpr}, 'YYYY-MM-DD') AS day, ${branch} AS branch,
        COALESCE(${withOrder ? "NULLIF(fin_place(ro.zone), ''), " : ""}${clientZone}) AS zone,
        COALESCE(${withOrder ? "NULLIF(fin_place(ro.agent), ''), " : ""}${clientAgent}) AS agent,
        ${withOrder && s.col("orders", "organization") ? "fin_place(ro.organization)" : "''"} AS organization,
        ${product.type} AS product_type, ${product.brand} AS brand, ${product.name} AS product, ${product.key} AS item_key,
        COALESCE(ri.quantity, 0)::float8 AS qty, COALESCE(ri.quantity, 0)::float8 * COALESCE(ri.price, 0)::float8 AS amount,
        COALESCE(fin_cur(${s.col(CR, "currency") ? "r.currency" : "NULL"}), @base) AS cur
      FROM ${CR} r ${client} JOIN ${CRI} ri ON ri.return_id = r.id ${product.joins}
      ${withOrder ? "LEFT JOIN orders ro ON ro.id = r.order_id" : ""}
      ${returnWarehouse ? "LEFT JOIN wb wr ON wr.k = fin_key(r.warehouse)" : ""}
      WHERE r.status = 'accepted' AND (${tsExpr})::date BETWEEN @from::date AND @to::date`)
  }

  return (await db.prepare(`WITH ${ctes.join(",\n")}\n${parts.join("\nUNION ALL\n")}`).all({ base, from, to })) as RawLine[]
}

function matches(line: SalesLine, filters: SalesFilters): boolean {
  const test = (values: string[] | undefined, value: string) => {
    const wanted = (values ?? []).map(nameKey).filter(Boolean)
    return !wanted.length || wanted.includes(nameKey(value))
  }
  return (
    test(filters.branches, line.branch) &&
    test(filters.zones, line.zone) &&
    test(filters.agents, line.agent) &&
    test(filters.productTypes, line.productType) &&
    test(filters.brands, line.brand) &&
    test(filters.products, line.product) &&
    test(filters.organizations, line.organization)
  )
}

/** Sale / return lines of [from, to] in the base currency with their cost of goods. */
export async function loadSalesLines(
  params: { from: string; to: string; basis: "realization" | "created"; withCost: boolean },
  db: PgDb = getDb(),
): Promise<{ base: string; lines: SalesLine[]; missingRates: string[] }> {
  const s = await ensureFinanceSchema(db)
  const cc = await loadCurrencyContext(db)
  const raw = await loadLines(db, s, cc.base, params.from, params.to, params.basis)
  const missing = new Set<string>()
  // Unit costs of each document's goods in the cost ledger (one load per report); the
  // end-of-day average only for lines the ledger did not move.
  const ledger = params.withCost && raw.some((row) => row.day && row.item_key) ? await loadCostLedger(db) : null
  const moved = ledger ? documentLineValues(ledger) : null
  const costCache = new Map<string, Map<string, number>>()
  const costs = (day: string): Map<string, number> => {
    let entry = costCache.get(day)
    if (!entry) costCache.set(day, (entry = ledger ? costsFromLedger(ledger, day) : new Map()))
    return entry
  }
  const lines: SalesLine[] = []
  for (const row of raw) {
    if (!row.day) continue
    const rate = cc.rates[row.cur]
    const amount = Number(row.amount ?? 0)
    if (!rate) {
      if (amount) missing.add(row.cur)
      continue
    }
    const quantity = Number(row.qty ?? 0)
    const docType = row.kind === "return" ? "client_returns" : "orders"
    const unitCost =
      ledger && moved && row.item_key ? (documentLineUnit(moved, docType, Number(row.doc_id), row.item_key) ?? costs(row.day).get(row.item_key) ?? 0) : 0
    lines.push({
      kind: row.kind,
      day: row.day,
      branch: placeName(row.branch),
      zone: placeName(row.zone),
      agent: placeName(row.agent),
      organization: placeName(row.organization),
      productType: placeName(row.product_type),
      brand: placeName(row.brand),
      product: String(row.product ?? "").trim(),
      itemKey: row.item_key,
      quantity,
      amount: amount * rate,
      cost: quantity * unitCost,
    })
  }
  return { base: cc.base, lines, missingRates: [...missing].sort() }
}

function addLine(totals: PnlTotals, line: SalesLine) {
  if (line.kind === "return") {
    totals.returns += line.amount
    totals.returnCost += line.cost
    totals.quantity -= line.quantity
  } else {
    totals.realization += line.amount
    totals.cost += line.cost
    totals.quantity += line.quantity
  }
}

function roundTotals(totals: PnlTotals): PnlTotals {
  return {
    realization: roundMoney(totals.realization),
    returns: roundMoney(totals.returns),
    cost: roundMoney(totals.cost),
    returnCost: roundMoney(totals.returnCost),
    quantity: roundMoney(totals.quantity, 3),
  }
}

const NONE = "Не указано"

/** Filter options of the sales reports: the factory's own dictionaries plus
 * every value used on counted orders. */
export async function getSalesReportOptions(db: PgDb = getDb()): Promise<SalesReportOptions> {
  const s = await ensureFinanceSchema(db)
  const values = async (sql: string, ok: boolean): Promise<string[]> => (ok ? ((await db.prepare(sql).all()) as Array<{ v: unknown }>).map((row) => placeName(row.v)) : [])
  const alive = s.col("products", "deleted") ? "WHERE COALESCE(deleted, 0) = 0" : ""
  const [branches, organizations, productTypes, brands, productTypesUsed, brandsUsed, products, zones, agents, clientZones] = await Promise.all([
    values("SELECT name AS v FROM branches", s.has("branches")),
    values("SELECT name AS v FROM organizations", s.has("organizations")),
    values("SELECT name AS v FROM product_types", (await tableExists(db, "product_types"))),
    values("SELECT name AS v FROM brands", (await tableExists(db, "brands"))),
    values(`SELECT DISTINCT type AS v FROM products ${alive}`, s.col("products", "type")),
    values(`SELECT DISTINCT brand AS v FROM products ${alive}`, s.col("products", "brand")),
    values(`SELECT name AS v FROM products ${alive}`, s.has("products")),
    values(`SELECT DISTINCT o.zone AS v FROM orders o WHERE ${orderCountedSql("o")}`, s.has("orders")),
    values(`SELECT DISTINCT o.agent AS v FROM orders o WHERE ${orderCountedSql("o")}`, s.has("orders")),
    values("SELECT DISTINCT zone AS v FROM clients", s.col("clients", "zone")),
  ])
  const unique = (...lists: string[][]) => {
    const seen = new Map<string, string>()
    for (const value of lists.flat()) if (value && !seen.has(nameKey(value))) seen.set(nameKey(value), value)
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  return {
    branches: unique(branches),
    organizations: unique(organizations),
    productTypes: unique(productTypes, productTypesUsed),
    brands: unique(brands, brandsUsed),
    products: unique(products),
    zones: unique(zones, clientZones),
    agents: unique(agents),
  }
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** P&L of two periods: totals and the same totals grouped by branch / agent /
 * product type / brand / zone / product. */
export async function getPnl(params: { periods: Array<{ from: string; to: string }>; filters: SalesFilters }, db: PgDb = getDb()): Promise<PnlResult> {
  const loaded = await Promise.all(params.periods.map((period) => loadSalesLines({ ...period, basis: "realization", withCost: true }, db)))
  const base = loaded[0]?.base ?? "SUM"
  const totals = params.periods.map(() => EMPTY())
  const dimensions = ["branch", "agent", "productType", "brand", "zone", "product"] as const
  const groups = Object.fromEntries(dimensions.map((dimension) => [dimension, new Map<string, PnlTotals[]>()])) as Record<(typeof dimensions)[number], Map<string, PnlTotals[]>>
  loaded.forEach((period, index) => {
    for (const line of period.lines) {
      if (!matches(line, params.filters)) continue
      addLine(totals[index], line)
      for (const dimension of dimensions) {
        const name = line[dimension] || NONE
        let entry = groups[dimension].get(name)
        if (!entry) groups[dimension].set(name, (entry = params.periods.map(() => EMPTY())))
        addLine(entry[index], line)
      }
    }
  })
  const rows = (map: Map<string, PnlTotals[]>): PnlGroupRow[] =>
    [...map.entries()].map(([name, list]) => ({ name, periods: list.map(roundTotals) })).sort((a, b) => a.name.localeCompare(b.name, "ru"))
  return {
    baseCurrency: base,
    missingRates: [...new Set(loaded.flatMap((period) => period.missingRates))].sort(),
    periods: params.periods,
    totals: totals.map(roundTotals),
    groups: {
      branch: rows(groups.branch),
      agent: rows(groups.agent),
      productType: rows(groups.productType),
      brand: rows(groups.brand),
      zone: rows(groups.zone),
      product: rows(groups.product),
    },
    options: await getSalesReportOptions(db),
  }
}

export type AbcGroupBy = "product" | "brand" | "branch" | "productType"

/** ABC classification of the counted orders created in [from, to] by sales
 * amount (base currency): A up to 80 % cumulative share, B up to 95 %, C beyond. */
export async function getAbc(params: { from: string; to: string; groupBy: AbcGroupBy; filters: SalesFilters }, db: PgDb = getDb()): Promise<AbcResult> {
  const { base, lines, missingRates } = await loadSalesLines({ from: params.from, to: params.to, basis: "created", withCost: false }, db)
  const buckets = new Map<string, { quantity: number; sales: number }>()
  for (const line of lines) {
    if (line.kind !== "sale" || !matches(line, params.filters)) continue
    const key = line[params.groupBy] || NONE
    const bucket = buckets.get(key) ?? { quantity: 0, sales: 0 }
    bucket.quantity += line.quantity
    bucket.sales += line.amount
    buckets.set(key, bucket)
  }
  const totalQuantity = [...buckets.values()].reduce((sum, bucket) => sum + bucket.quantity, 0)
  const totalSales = [...buckets.values()].reduce((sum, bucket) => sum + bucket.sales, 0)
  let cumulative = 0
  const rows: AbcRow[] = [...buckets.entries()]
    .sort((a, b) => b[1].sales - a[1].sales || a[0].localeCompare(b[0], "ru"))
    .map(([name, bucket], index) => {
      cumulative += bucket.sales
      const share = totalSales ? (cumulative / totalSales) * 100 : 0
      return {
        id: index + 1,
        name,
        quantity: roundMoney(bucket.quantity, 3),
        quantityPercent: totalQuantity ? roundMoney((bucket.quantity / totalQuantity) * 100, 1) : 0,
        sales: roundMoney(bucket.sales),
        salesPercent: totalSales ? roundMoney((bucket.sales / totalSales) * 100, 1) : 0,
        abcClass: share <= 80 + 1e-9 ? "A" : share <= 95 + 1e-9 ? "B" : "C",
      }
    })
  return { baseCurrency: base, missingRates, from: params.from, to: params.to, groupBy: params.groupBy, rows, totals: { quantity: roundMoney(totalQuantity, 3), sales: roundMoney(totalSales) }, options: await getSalesReportOptions(db) }
}
