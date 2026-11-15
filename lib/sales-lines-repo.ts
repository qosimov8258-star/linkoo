import "server-only"

import { getDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { roundMoney } from "@/lib/finance/currency"
import { loadRateHistory, rateAt } from "@/lib/finance/pnl"
import { ensureOrdersSchema } from "@/lib/orders-repo"
import { currencyRates } from "@/lib/supplier-refs"
import type { SalesLine, SalesLines } from "@/lib/sales-lines-types"

// The lines of «Прибыль от агентов» / «Прибыль от товаров» (Linko's stats/user_profits and stats/products):
// - sales: the lines of every order that is not cancelled («Отменен» is left out, as Linko's sales are);
// - returns: the lines of the accepted client returns (client_returns / client_return_items).
// Each line carries its local (Asia/Tashkent) days — creation and the transfer from the warehouse (Linko's
// accepted_time: the order's accepted_date, else its shipped_at for one still on the way; a return's
// accepted_at) — the fields the filters read, and its amount
// in the base currency at the rate of the document's creation day (Валюты' rate history, as Linko's reports;
// today's rate without a history). Linko's net cost (sales_net_cost) is the product's company-wide
// cost price on the line's day × quantity — the history of Себестоимость (net_cost_records, place and scope
// empty), else the product's current cost (checked against Linko's stats/user_profits for 2026-01, -07 and -08:
// quantities, sums, net costs and profits agree); a line without a catalog product keeps
// its own cost price.

type Row = {
  kind: "sale" | "return"
  id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  unit_price: number
  discount_percent: number
  currency: string
  line_cost: number | null
  product_cost: number | null
  client: string
  agent: string
  status: string
  created_day: string | null
  transfer_day: string | null
  branch: string
  organization: string
  warehouse: string
  product_type: string
  brand: string
  client_type: string
  /** The document's creation moment (UTC text): the day of its currency rate. */
  doc_ts: string | null
}

const day = (expr: string) => `to_char((${expr})::date, 'YYYY-MM-DD')`

export async function listSalesLines(options: { withCost: boolean }): Promise<SalesLines> {
  const db = getDb()
  await ensureOrdersSchema()
  await ensureFinanceSchema(db)
  const { base, rateOf } = await currencyRates(db)
  const exists = (await db
    .prepare(
      `SELECT to_regclass('client_returns') IS NOT NULL AND to_regclass('client_return_items') IS NOT NULL AS returns,
              to_regclass('net_cost_records') IS NOT NULL AS history`,
    )
    .get()) as { returns: boolean; history: boolean }
  // The company-wide cost of a product on a day (the last record up to it), or NULL.
  const costOn = (productId: string, dayExpr: string) =>
    exists.history
      ? `(SELECT nc.cost FROM net_cost_records nc
           WHERE nc.item_key = 'product:' || ${productId} AND COALESCE(nc.place, '') = '' AND COALESCE(nc.scope, '') = '' AND nc.day <= ${dayExpr}
           ORDER BY nc.day DESC, nc.seq DESC LIMIT 1)`
      : "NULL::float8"
  const saleDay = day("COALESCE(fin_ts(NULLIF(o.accepted_date, '')), fin_ts(NULLIF(o.shipped_at, '')), fin_ts(o.created_at, true))")
  const returnDay = day("COALESCE(fin_ts(NULLIF(r.accepted_at, '')), fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))")

  const sales = `
    SELECT 'sale' AS kind, i.id, i.product_id, i.product_name, i.unit, i.quantity, i.unit_price, i.discount_percent,
           COALESCE(fin_cur(NULLIF(i.currency, '')), fin_cur(NULLIF(o.currency, '')), @base) AS currency,
           i.cost_price AS line_cost, COALESCE(${costOn("i.product_id", saleDay)}, p.cost) AS product_cost,
           o.client, o.agent, o.status,
           ${day("fin_ts(o.created_at, true)")} AS created_day,
           ${day("COALESCE(fin_ts(NULLIF(o.accepted_date, '')), fin_ts(NULLIF(o.shipped_at, '')))")} AS transfer_day,
           COALESCE(o.branch_name, '') AS branch, COALESCE(o.organization, '') AS organization,
           COALESCE(NULLIF(o.stock_name, ''), o.warehouse, '') AS warehouse,
           COALESCE(p.type, '') AS product_type, COALESCE(p.brand, '') AS brand, COALESCE(c.type, '') AS client_type,
           o.created_at::text AS doc_ts
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      LEFT JOIN products p ON p.id = i.product_id
      LEFT JOIN clients c ON c.id = o.client_id
     WHERE COALESCE(o.status, '') <> 'Отменен'`
  const returns = `
    SELECT 'return' AS kind, ri.id, ri.product_id, ri.product_name, ri.unit, ri.quantity, ri.price AS unit_price, 0::float8 AS discount_percent,
           COALESCE(fin_cur(NULLIF(r.currency, '')), @base) AS currency,
           NULL::float8 AS line_cost, COALESCE(${costOn("ri.product_id", returnDay)}, p.cost) AS product_cost,
           r.client, COALESCE(NULLIF(o.agent, ''), r.agent, '') AS agent, COALESCE(o.status, '') AS status,
           ${day("COALESCE(fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))")} AS created_day,
           ${returnDay} AS transfer_day,
           COALESCE(o.branch_name, '') AS branch, COALESCE(NULLIF(r.organization, ''), o.organization, '') AS organization,
           COALESCE(r.warehouse, '') AS warehouse,
           COALESCE(p.type, '') AS product_type, COALESCE(p.brand, '') AS brand, COALESCE(c.type, '') AS client_type,
           COALESCE(o.created_at::text, r.created_at::text) AS doc_ts
      FROM client_return_items ri
      JOIN client_returns r ON r.id = ri.return_id
      LEFT JOIN orders o ON o.id = r.order_id
      LEFT JOIN products p ON p.id = ri.product_id
      LEFT JOIN clients c ON c.id = r.client_id
     WHERE r.status = 'accepted'`
  const rows = (await db.prepare(exists.returns ? `${sales} UNION ALL ${returns}` : sales).all({ base })) as Row[]

  const history = await loadRateHistory(db)
  const missingRates = new Set<string>()
  const lines = rows.map((row): SalesLine => {
    const quantity = Number(row.quantity) || 0
    const unitPrice = Number(row.unit_price) || 0
    const discountPercent = Number(row.discount_percent) || 0
    const gross = quantity * unitPrice
    const amount = gross * (1 - discountPercent / 100)
    const docTs = String(row.doc_ts ?? "").replace("T", " ").slice(0, 19)
    const rate = (docTs && rateOf(row.currency) !== 1 ? rateAt(history, row.currency, docTs) : null) ?? rateOf(row.currency)
    if (rate === null) missingRates.add(row.currency)
    const toBase = (value: number) => roundMoney(value * (rate ?? 1))
    const productCost = row.product_cost === null || row.product_cost === undefined ? null : Number(row.product_cost)
    // The product's cost price (history, even 0) is in the base currency; only a line without one keeps its own
    // cost price, in its currency.
    const costBase = productCost !== null ? roundMoney(quantity * productCost) : toBase(quantity * (Number(row.line_cost) || 0))
    return {
      kind: row.kind,
      id: Number(row.id),
      productId: row.product_id === null ? null : Number(row.product_id),
      productName: row.product_name || "",
      unit: row.unit || "",
      quantity,
      currency: row.currency,
      amountBase: toBase(amount),
      discountBase: toBase(gross - amount),
      costBase: options.withCost ? costBase : 0,
      discounted: discountPercent > 0,
      client: row.client || "",
      agent: row.agent || "",
      status: row.status || "",
      createdDay: row.created_day ?? "",
      transferDay: row.transfer_day ?? "",
      branch: row.branch,
      organization: row.organization,
      warehouse: row.warehouse,
      productType: row.product_type,
      brand: row.brand,
      clientType: row.client_type,
    }
  })
  return { base, canSeeCost: options.withCost, missingRates: [...missingRates], lines }
}
