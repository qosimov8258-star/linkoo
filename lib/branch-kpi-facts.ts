import "server-only"

import type { PgDb } from "@/lib/db"
import type { BranchKpiPlanKey } from "@/lib/branch-kpi-types"
import type { FinanceSchema } from "@/lib/finance/schema"
import { orderCountedSql, orderRealizationTs } from "@/lib/finance/sources"

// Facts of the branch KPI indicators for one month, per branch, in the base
// currency (one SQL statement; values are aggregated in Postgres).
//
// Branch of an order: the client's branch (orders.client_id, by name for
// legacy rows → clients.branch), else the agent's branch (orders.agent →
// employees.branch). Orders count unless Отменен / Не подтвержден; released
// ones are dated by their realization moment (the ledger's rule). Branch of a
// customer payment: the payment's, else its cashbox's, else the client's.
// Order money = Σ order_items qty·price·(1 − discount%) (orders.amount text
// when the order has no items), converted with the currencies' rates.
//   by creation date (non-cancelled orders): "… (продажа-возврат от продаж)",
//     АКБ, Дневной АКБ, Активация неактивных, Количество заказов;
//   by delivery date: "фактической продажи" = released (В пути / Доставлено),
//     "доставки" / "доставленных" = Доставлено;
//   payments accepted into a cashbox (customer_payments.accepted = 1) by the
//     acceptance date: "Оплата (принятые на кассу)", "Количество оплативших клиентов".
// The "− возврат" part of an indicator: accepted client returns (client_returns
// with status 'accepted', the sales module's document — the same returns the
// client ledger and the P&L count) dated by their acceptance moment, money
// = Σ return lines qty·price (the return's amount when it has no lines)
// converted with the rates, quantity / weight of the returned lines. Branch of
// a return: the client's branch, else the agent's (the return's agent, else
// its order's agent) — the order rule above. RETURN_FACT_OF maps each
// "… (продажа - возврат)" indicator to its return fact.

export type BranchFactKey = Exclude<BranchKpiPlanKey, "visit" | "attendance" | "mml" | "plan_visit_by_day" | "perfect_store_visit_percent">

/** Accepted client returns of the month: money (base currency), quantity, weight. */
export type BranchReturnFactKey = "return_sum" | "return_qty" | "return_weight"

export type BranchFacts = Record<BranchFactKey | BranchReturnFactKey, number>

/** The return fact subtracted from each "… − возврат" indicator (others subtract nothing). */
export const RETURN_FACT_OF: Partial<Record<BranchFactKey, BranchReturnFactKey>> = {
  sales_sum: "return_sum",
  product_sales_amount: "return_qty",
  product_sales_weight: "return_weight",
  sales_sum_order: "return_sum",
  product_sales_amount_order: "return_qty",
  delivered_order_sum: "return_sum",
}

const FACT_KEYS: Array<BranchFactKey | BranchReturnFactKey> = [
  "sales_sum",
  "product_sales_amount",
  "sales_sum_order",
  "product_sales_amount_order",
  "activate_count",
  "active_client_count",
  "active_client_count_by_day",
  "payment_to_cashbox",
  "product_sales_weight",
  "delivered_weight",
  "delivered_product_amount",
  "delivered_order_sum",
  "payed_market_count",
  "order_count",
  "return_sum",
  "return_qty",
  "return_weight",
]

export function emptyBranchFacts(): BranchFacts {
  return Object.fromEntries(FACT_KEYS.map((key) => [key, 0])) as BranchFacts
}

/** "Активация неактивных": a buying client without any order in this many days before the month. */
export const INACTIVE_DAYS = 30

const RELEASED = "('В пути', 'Доставлено')"
const DELIVERED = "'Доставлено'"

/** Base-currency multiplier of a currency expression (NULL when the rate is unknown). */
function toBase(currencyExpr: string, rateAlias: string): string {
  return `CASE WHEN COALESCE(${currencyExpr}, @base::text) = @base::text THEN 1 ELSE ${rateAlias}.rate END`
}

function branchJoin(alias: string, nameExpr: string): string {
  return `LEFT JOIN br ${alias} ON fin_place(${nameExpr}) <> '' AND ${alias}.k = fin_key(fin_place(${nameExpr}))`
}

/** Facts per branch id for [from, to) (local dates "YYYY-MM-DD"). Branches without movements are absent. */
export async function computeBranchFacts(db: PgDb, s: FinanceSchema, base: string, from: string, to: string): Promise<Map<number, BranchFacts>> {
  const result = new Map<number, BranchFacts>()
  if (!s.has("branches")) return result

  const ctes: string[] = [
    "br AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM branches GROUP BY 1)",
    s.has("currencies")
      ? "rates AS (SELECT fin_cur(code) AS code, MAX(rate)::float8 AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1)"
      : "rates AS (SELECT NULL::text AS code, NULL::float8 AS rate WHERE false)",
  ]
  const hasClients = s.has("clients")
  const clientBranch = hasClients && s.col("clients", "branch")
  if (hasClients) ctes.push("ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)")
  const hasEmployees = s.has("employees") && s.col("employees", "branch")
  if (hasEmployees) ctes.push("ek AS (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1)")
  const hasWeight = s.has("products") && s.col("products", "weight")
  /** Unit weight of product `alias` (products.weight is free text; non-numbers count 0). */
  const weightOf = (alias: string) =>
    `CASE WHEN replace(btrim(COALESCE(${alias}.weight, '')), ',', '.') ~ '^[0-9]+([.][0-9]+){0,1}$'
          THEN replace(btrim(${alias}.weight), ',', '.')::float8 ELSE 0 END`
  const metrics: Array<{ name: string; sql: string }> = []

  if (s.has("orders")) {
    const hasItems = s.has("order_items")
    const weight = hasItems && hasWeight ? weightOf("p") : "0"
    if (hasItems) {
      ctes.push(`oi AS (
        SELECT i.order_id,
               SUM(i.quantity::float8 * i.unit_price::float8 * (1 - COALESCE(i.discount_percent, 0)::float8 / 100) * ${toBase("fin_cur(i.currency)", "r")}) AS amount,
               SUM(i.quantity::float8) AS qty,
               SUM(i.quantity::float8 * ${weight}) AS weight
        FROM order_items i
        LEFT JOIN rates r ON r.code = COALESCE(fin_cur(i.currency), @base::text)
        ${weight === "0" ? "" : "LEFT JOIN products p ON p.id = i.product_id"}
        GROUP BY 1)`)
    }
    ctes.push(`oa AS (
      SELECT o.id AS order_id, SUM(a.amount * ${toBase("a.currency", "r")}) AS amount
      FROM orders o CROSS JOIN LATERAL fin_amounts(o.amount) a
      LEFT JOIN rates r ON r.code = COALESCE(a.currency, @base::text)
      ${hasItems ? "WHERE NOT EXISTS (SELECT 1 FROM order_items z WHERE z.order_id = o.id)" : ""}
      GROUP BY 1)`)
    const orderBranchIds = [clientBranch ? "bc.id" : "", hasEmployees ? "be.id" : ""].filter(Boolean)
    const orderBranch = orderBranchIds.length ? `COALESCE(${orderBranchIds.join(", ")})` : "NULL::int"
    ctes.push(`ord AS (
      SELECT o.id, o.status,
             ${hasClients ? "COALESCE(c.id::text, 'n:' || fin_key(o.client))" : "'n:' || fin_key(o.client)"} AS ckey,
             ${orderBranch} AS branch_id,
             fin_ts(o.created_at, true) AS created_ts,
             ${orderRealizationTs(s, "o")} AS delivery_ts,
             COALESCE(${hasItems ? "oi.amount, " : ""}oa.amount, 0) AS amount,
             ${hasItems ? "COALESCE(oi.qty, 0)" : "0::float8"} AS qty,
             ${hasItems ? "COALESCE(oi.weight, 0)" : "0::float8"} AS weight
      FROM orders o
      ${
        hasClients
          ? s.col("orders", "client_id")
            ? "LEFT JOIN ck ON o.client_id IS NULL AND ck.k = fin_key(o.client) LEFT JOIN clients c ON c.id = COALESCE(o.client_id, ck.id)"
            : "LEFT JOIN ck ON ck.k = fin_key(o.client) LEFT JOIN clients c ON c.id = ck.id"
          : ""
      }
      ${clientBranch ? branchJoin("bc", "c.branch") : ""}
      ${hasEmployees ? `LEFT JOIN ek ON ek.k = fin_key(o.agent) LEFT JOIN employees e ON e.id = ek.id ${branchJoin("be", "e.branch")}` : ""}
      ${hasItems ? "LEFT JOIN oi ON oi.order_id = o.id" : ""}
      LEFT JOIN oa ON oa.order_id = o.id
      WHERE ${orderCountedSql("o")})`)
    ctes.push(`mc AS (
      SELECT o.branch_id,
             SUM(o.amount) AS sales_sum_order,
             SUM(o.qty) AS product_sales_amount_order,
             COUNT(*) AS order_count,
             COUNT(DISTINCT o.ckey) AS active_client_count,
             COUNT(DISTINCT o.ckey || '|' || o.created_ts::date::text) AS active_client_count_by_day,
             COUNT(DISTINCT o.ckey) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM ord q WHERE q.ckey = o.ckey
                 AND q.created_ts >= @from::timestamp - make_interval(days => ${INACTIVE_DAYS}) AND q.created_ts < @from::timestamp)) AS activate_count
      FROM ord o
      WHERE o.branch_id IS NOT NULL AND o.created_ts >= @from::timestamp AND o.created_ts < @to::timestamp
      GROUP BY 1)`)
    ctes.push(`md AS (
      SELECT o.branch_id,
             SUM(o.amount) FILTER (WHERE o.status IN ${RELEASED}) AS sales_sum,
             SUM(o.qty) FILTER (WHERE o.status IN ${RELEASED}) AS product_sales_amount,
             SUM(o.weight) FILTER (WHERE o.status IN ${RELEASED}) AS product_sales_weight,
             SUM(o.amount) FILTER (WHERE o.status = ${DELIVERED}) AS delivered_order_sum,
             SUM(o.qty) FILTER (WHERE o.status = ${DELIVERED}) AS delivered_product_amount,
             SUM(o.weight) FILTER (WHERE o.status = ${DELIVERED}) AS delivered_weight
      FROM ord o
      WHERE o.branch_id IS NOT NULL AND o.delivery_ts >= @from::timestamp AND o.delivery_ts < @to::timestamp
      GROUP BY 1)`)
    metrics.push(
      { name: "mc", sql: "sales_sum_order, product_sales_amount_order, order_count, active_client_count, active_client_count_by_day, activate_count" },
      { name: "md", sql: "sales_sum, product_sales_amount, product_sales_weight, delivered_order_sum, delivered_product_amount, delivered_weight" },
    )
  }

  // Accepted client returns of the month (the "− возврат" part, see the header).
  const CR = "client_returns"
  const CRI = "client_return_items"
  if (s.has(CR) && s.col(CR, "status")) {
    const hasLines = s.has(CRI) && s.col(CRI, "return_id") && s.col(CRI, "quantity")
    const linePrice = hasLines && s.col(CRI, "price") ? "COALESCE(i.price, 0)::float8" : "0::float8"
    const lineWeight = hasLines && hasWeight && s.col(CRI, "product_id") ? weightOf("p") : "0"
    if (hasLines) {
      ctes.push(`rl AS (
        SELECT i.return_id, SUM(COALESCE(i.quantity, 0)::float8 * ${linePrice}) AS amount, SUM(COALESCE(i.quantity, 0)::float8) AS qty,
               SUM(COALESCE(i.quantity, 0)::float8 * ${lineWeight}) AS weight
        FROM ${CRI} i ${lineWeight === "0" ? "" : "LEFT JOIN products p ON p.id = i.product_id"}
        GROUP BY 1)`)
    }
    const acceptedTs = [
      s.col(CR, "accepted_at") ? "fin_ts(r.accepted_at::text, true)" : "",
      s.col(CR, "return_date") ? "fin_ts(r.return_date::text)" : "",
      s.col(CR, "created_at") ? "fin_ts(r.created_at::text, true)" : "",
    ].filter(Boolean)
    const returnTs = acceptedTs.length ? `COALESCE(${acceptedTs.join(", ")})` : "NULL::timestamp"
    const currency = s.col(CR, "currency") ? "fin_cur(r.currency)" : "NULL::text"
    const ownAmount = s.col(CR, "amount") ? "COALESCE(r.amount, 0)::float8" : "0::float8"
    const withOrder = s.col(CR, "order_id") && s.has("orders")
    const agentNames = [s.col(CR, "agent") ? "NULLIF(fin_place(r.agent), '')" : "", withOrder && s.col("orders", "agent") ? "NULLIF(fin_place(ro.agent), '')" : ""].filter(Boolean)
    const returnClient = !hasClients
      ? ""
      : s.col(CR, "client_id")
        ? s.col(CR, "client")
          ? "LEFT JOIN ck rk ON r.client_id IS NULL AND rk.k = fin_key(r.client) LEFT JOIN clients rc ON rc.id = COALESCE(r.client_id, rk.id)"
          : "LEFT JOIN clients rc ON rc.id = r.client_id"
        : s.col(CR, "client")
          ? "LEFT JOIN ck rk ON rk.k = fin_key(r.client) LEFT JOIN clients rc ON rc.id = rk.id"
          : ""
    const branchIds = [returnClient && clientBranch ? "rbc.id" : "", hasEmployees && agentNames.length ? "rbe.id" : ""].filter(Boolean)
    ctes.push(`ret AS (
      SELECT ${branchIds.length ? `COALESCE(${branchIds.join(", ")})` : "NULL::int"} AS branch_id,
             ${hasLines ? `COALESCE(rl.amount, ${ownAmount})` : ownAmount} * ${toBase(currency, "rr")} AS amount,
             ${hasLines ? "COALESCE(rl.qty, 0)" : "0::float8"} AS qty,
             ${hasLines ? "COALESCE(rl.weight, 0)" : "0::float8"} AS weight
      FROM ${CR} r
      ${returnClient}
      ${hasLines ? "LEFT JOIN rl ON rl.return_id = r.id" : ""}
      ${withOrder ? "LEFT JOIN orders ro ON ro.id = r.order_id" : ""}
      ${returnClient && clientBranch ? branchJoin("rbc", "rc.branch") : ""}
      ${
        hasEmployees && agentNames.length
          ? `LEFT JOIN ek rek ON rek.k = fin_key(COALESCE(${agentNames.join(", ")}, '')) LEFT JOIN employees re ON re.id = rek.id ${branchJoin("rbe", "re.branch")}`
          : ""
      }
      LEFT JOIN rates rr ON rr.code = COALESCE(${currency}, @base::text)
      WHERE r.status = 'accepted' AND ${returnTs} >= @from::timestamp AND ${returnTs} < @to::timestamp)`)
    ctes.push(`mr AS (
      SELECT branch_id, SUM(amount) AS return_sum, SUM(qty) AS return_qty, SUM(weight) AS return_weight
      FROM ret WHERE branch_id IS NOT NULL
      GROUP BY 1)`)
    metrics.push({ name: "mr", sql: "return_sum, return_qty, return_weight" })
  }

  if (s.has("customer_payments") && s.col("customer_payments", "is_deleted") && s.col("customer_payments", "branch")) {
    const hasCashboxes = s.has("cashboxes")
    if (hasCashboxes) ctes.push("kb AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1)")
    const branchIds = ["bp.id", hasCashboxes ? "bcb.id" : "", clientBranch ? "bcl.id" : ""].filter(Boolean).join(", ")
    ctes.push(`pay AS (
      SELECT COALESCE(${branchIds}) AS branch_id,
             ${hasClients ? "COALESCE(c.id::text, 'n:' || fin_key(p.client))" : "'n:' || fin_key(p.client)"} AS ckey,
             p.amount::float8 * ${toBase("fin_cur(p.currency)", "r")} AS amount,
             COALESCE(fin_ts(NULLIF(p.accepted_at, '')), fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true)) AS ts
      FROM customer_payments p
      ${hasClients ? "LEFT JOIN ck ON p.client_id IS NULL AND ck.k = fin_key(p.client) LEFT JOIN clients c ON c.id = COALESCE(p.client_id, ck.id)" : ""}
      ${hasCashboxes ? "LEFT JOIN kb ON p.cashbox_id IS NULL AND btrim(COALESCE(p.kassa, '')) <> '' AND kb.k = fin_key(p.kassa) LEFT JOIN cashboxes cb ON cb.id = COALESCE(p.cashbox_id, kb.id)" : ""}
      ${branchJoin("bp", "p.branch")}
      ${hasCashboxes ? branchJoin("bcb", "cb.branch") : ""}
      ${clientBranch ? branchJoin("bcl", "c.branch") : ""}
      LEFT JOIN rates r ON r.code = COALESCE(fin_cur(p.currency), @base::text)
      WHERE COALESCE(p.is_deleted, 0) = 0 AND p.accepted = 1)`)
    ctes.push(`mp AS (
      SELECT branch_id, SUM(amount) AS payment_to_cashbox, COUNT(DISTINCT ckey) AS payed_market_count
      FROM pay WHERE branch_id IS NOT NULL AND ts >= @from::timestamp AND ts < @to::timestamp
      GROUP BY 1)`)
    metrics.push({ name: "mp", sql: "payment_to_cashbox, payed_market_count" })
  }

  if (!metrics.length) return result
  const columns = metrics.flatMap((metric) => metric.sql.split(",").map((column) => `${metric.name}.${column.trim()}::float8 AS ${column.trim()}`))
  const joins = metrics.map((metric) => `LEFT JOIN ${metric.name} ON ${metric.name}.branch_id = b.id`)
  const any = metrics.map((metric) => `${metric.name}.branch_id IS NOT NULL`).join(" OR ")
  const rows = (await db
    .prepare(`WITH ${ctes.join(",\n")}
      SELECT b.id AS branch_id, ${columns.join(", ")}
      FROM branches b ${joins.join(" ")}
      WHERE ${any}`)
    .all({ base, from, to })) as Array<Record<string, number | null> & { branch_id: number }>
  for (const row of rows) {
    const facts = emptyBranchFacts()
    for (const key of FACT_KEYS) facts[key] = Number(row[key] ?? 0) || 0
    result.set(Number(row.branch_id), facts)
  }
  return result
}
