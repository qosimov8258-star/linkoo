import "server-only"

import { getDb } from "@/lib/db"
import { loadCurrencyContext, workFactorSql } from "@/lib/finance/context"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderCountedSql, ownAgentSql } from "@/lib/finance/sources"
import { ensureOrdersSchema } from "@/lib/orders-repo"
import { selectedBranchName } from "@/lib/selected-branch"
import type { BreakdownGroup, BreakdownMeasure, BreakdownRow, DashboardBreakdown } from "@/lib/dashboard-breakdown-types"

export { BREAKDOWN_GROUPS, BREAKDOWN_MEASURES } from "@/lib/dashboard-breakdown-types"
export type { BreakdownGroup, BreakdownMeasure, BreakdownRow, DashboardBreakdown } from "@/lib/dashboard-breakdown-types"

// Home dashboard donut ("Группировка" × "Измерять", demo stats/widget/category_sales/): the period's
// sales split by one dimension. Same orders as the dashboard cards (lib/dashboard-summary-repo.ts):
// counted orders (not Отменен / Не подтвержден) created in the period (local day), of the top-bar
// branch and the reader's agents; returns = ACCEPTED client returns by their acceptance day. Line
// amounts are qty × price × (1 − discount) in the line currency; the donut shows the base currency.

const ORDER_DAY = "fin_ts(o.created_at, true)::date"
const RETURN_DAY = "COALESCE(fin_ts(NULLIF(r.accepted_at, '')), fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))::date"
const WEIGHT = "COALESCE(NULLIF(replace(substring(COALESCE(p.weight, '') FROM '^\\s*([0-9]+(?:[.,][0-9]+)?)'), ',', '.'), '')::float8, 0)"
const UNSET = "Не указано"

/** SQL label of a sale line (o = orders, oi = order_items, p = products). */
function orderLabel(group: BreakdownGroup): string {
  switch (group) {
    case "По товарам":
      return "COALESCE(NULLIF(p.name, ''), oi.product_name)"
    case "По родительскому типу продукта":
      return "p.type"
    case "По типам продуктов":
      return "COALESCE(NULLIF(p.subcategory, ''), p.type)"
    case "По брендам":
      return "p.brand"
    case "По агентам":
      return "o.agent"
    case "По доставщикам":
      return "o.delivery_man"
    case "По клиентам":
      return "o.client"
    case "Территории":
      return "o.zone"
    case "По складам":
      return "o.warehouse"
    case "По филиалам":
      return "o.branch_name"
    case "По дням":
      return `to_char(${ORDER_DAY}, 'YYYY-MM-DD')`
    case "По неделям":
      return `to_char(date_trunc('week', ${ORDER_DAY}), 'YYYY-MM-DD')`
    case "По месяцам":
      return `to_char(${ORDER_DAY}, 'YYYY-MM')`
  }
}

/** SQL label of a return line (r = client_returns, ri = client_return_items, p = products, c = clients, ro = the return's order). */
function returnLabel(group: BreakdownGroup): string {
  switch (group) {
    case "По товарам":
      return "COALESCE(NULLIF(p.name, ''), ri.product_name)"
    case "По родительскому типу продукта":
      return "p.type"
    case "По типам продуктов":
      return "COALESCE(NULLIF(p.subcategory, ''), p.type)"
    case "По брендам":
      return "p.brand"
    case "По агентам":
      return "r.agent"
    case "По доставщикам":
      return "r.deliverer"
    case "По клиентам":
      return "r.client"
    case "Территории":
      return "COALESCE(NULLIF(ro.zone, ''), c.zone)"
    case "По складам":
      return "r.warehouse"
    case "По филиалам":
      return "COALESCE(NULLIF(ro.branch_name, ''), c.branch)"
    case "По дням":
      return `to_char(${RETURN_DAY}, 'YYYY-MM-DD')`
    case "По неделям":
      return `to_char(date_trunc('week', ${RETURN_DAY}), 'YYYY-MM-DD')`
    case "По месяцам":
      return `to_char(${RETURN_DAY}, 'YYYY-MM')`
  }
}

const UNITS: Record<BreakdownMeasure, DashboardBreakdown["unit"]> = {
  "Факт продажи": "money",
  "Факт АКБ": "count",
  "Факт": "pieces",
  "Фактическая скидка": "money",
  "Обьем без учета возвратов": "pieces",
  "КГ без учета возвратов": "kg",
  "Сумма возвратов": "money",
  "Кол-во возвратов": "pieces",
  "Продажа без учета возвратов": "money",
}

/** What one measure takes from the sale lines and from the return lines (null = nothing). */
function measureSql(measure: BreakdownMeasure): { sale: string | null; ret: string | null; distinctClients?: boolean } {
  const amount = "oi.quantity::float8 * oi.unit_price::float8 * (1 - COALESCE(oi.discount_percent, 0)::float8 / 100)"
  const returned = "ri.quantity::float8 * COALESCE(ri.price, 0)::float8"
  switch (measure) {
    case "Факт продажи":
      return { sale: amount, ret: `-(${returned})` }
    case "Продажа без учета возвратов":
      return { sale: amount, ret: null }
    case "Факт":
      return { sale: "oi.quantity::float8", ret: "-ri.quantity::float8" }
    case "Обьем без учета возвратов":
      return { sale: "oi.quantity::float8", ret: null }
    case "КГ без учета возвратов":
      return { sale: `oi.quantity::float8 * ${WEIGHT}`, ret: null }
    case "Фактическая скидка":
      return { sale: "oi.quantity::float8 * oi.unit_price::float8 * COALESCE(oi.discount_percent, 0)::float8 / 100", ret: null }
    case "Сумма возвратов":
      return { sale: null, ret: returned }
    case "Кол-во возвратов":
      return { sale: null, ret: "ri.quantity::float8" }
    case "Факт АКБ":
      return { sale: null, ret: null, distinctClients: true }
  }
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round((Number(value) || 0) * factor) / factor
}

export async function getDashboardBreakdown(begin: string, end: string, group: BreakdownGroup, measure: BreakdownMeasure, salesEmployeeIds?: number[]): Promise<DashboardBreakdown> {
  const db = getDb()
  await ensureOrdersSchema()
  await ensureFinanceSchema(db)
  const baseRow = (await db.prepare("SELECT code FROM currencies ORDER BY is_base DESC, id LIMIT 1").get()) as { code: string } | undefined
  const base = baseRow?.code ?? "SUM"
  const branch = await selectedBranchName()
  const params = { from: begin, to: end, base, branch, scoped: salesEmployeeIds !== undefined, agentIds: salesEmployeeIds ?? [] }
  const orderWhere = `${orderCountedSql("o")} AND ${ORDER_DAY} BETWEEN @from::date AND @to::date AND (@branch::text = '' OR o.branch_name = @branch::text) AND ${ownAgentSql("o.agent")}`
  const { sale, ret, distinctClients } = measureSql(measure)
  const money = UNITS[measure] === "money"
  // With an app currency (Настройки → Валюта приложения) every line counts, converted into it.
  const cc = await loadCurrencyContext(db)
  const work = money && cc.work ? cc.work : ""
  // Money: base-currency lines only (the donut and its total are in the base currency, like the "Продажи" card's first figure).
  const saleCurrency = money && !work ? " AND COALESCE(fin_cur(oi.currency), @base::text) = @base::text" : ""
  const saleFactor = work ? ` * ${workFactorSql(cc, "COALESCE(fin_cur(oi.currency), @base::text)")}` : ""
  const parts: string[] = []
  if (distinctClients) {
    parts.push(`SELECT ${orderLabel(group)} AS label, COALESCE(o.client_id::text, 'name:' || fin_key(o.client)) AS client, 0::float8 AS value
      FROM orders o JOIN order_items oi ON oi.order_id = o.id LEFT JOIN products p ON p.id = oi.product_id WHERE ${orderWhere}`)
  }
  if (sale) {
    parts.push(`SELECT ${orderLabel(group)} AS label, NULL::text AS client, (${sale})${saleFactor} AS value
      FROM orders o JOIN order_items oi ON oi.order_id = o.id LEFT JOIN products p ON p.id = oi.product_id WHERE ${orderWhere}${saleCurrency}`)
  }
  const returnsExist = ((await db.prepare("SELECT to_regclass('client_return_items') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  if (ret && returnsExist) {
    const returnCurrency = money && !work ? " AND COALESCE(NULLIF(r.currency, ''), @base::text) = @base::text" : ""
    const returnFactor = work ? ` * ${workFactorSql(cc, "COALESCE(fin_cur(NULLIF(r.currency, '')), @base::text)")}` : ""
    parts.push(`SELECT ${returnLabel(group)} AS label, NULL::text AS client, (${ret})${returnFactor} AS value
      FROM client_returns r JOIN client_return_items ri ON ri.return_id = r.id LEFT JOIN products p ON p.id = ri.product_id
      LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN orders ro ON ro.id = r.order_id
      WHERE r.status = 'accepted' AND ${RETURN_DAY} BETWEEN @from::date AND @to::date
        AND (@branch::text = '' OR COALESCE(NULLIF(ro.branch_name, ''), c.branch) = @branch::text) AND ${ownAgentSql("r.agent")}${returnCurrency}`)
  }
  let rows: BreakdownRow[] = []
  if (parts.length) {
    const value = distinctClients ? "COUNT(DISTINCT client)::float8" : "SUM(value)::float8"
    const found = (await db
      .prepare(`SELECT COALESCE(NULLIF(btrim(label), ''), @unset::text) AS name, ${value} AS value FROM (${parts.join("\nUNION ALL\n")}) x GROUP BY 1`)
      .all({ ...params, unset: UNSET })) as Array<{ name: string; value: number }>
    rows = found.map((row) => ({ name: row.name, value: round(row.value, UNITS[measure] === "kg" ? 3 : 2) })).filter((row) => row.value !== 0)
  }
  const byTime = group === "По дням" || group === "По неделям" || group === "По месяцам"
  rows.sort((a, b) => (byTime ? a.name.localeCompare(b.name) : b.value - a.value || a.name.localeCompare(b.name, "ru")))
  // АКБ: a client counts once in the total even when it bought in several groups.
  let total = rows.reduce((sum, row) => sum + row.value, 0)
  if (distinctClients) {
    const akb = (await db
      .prepare(`SELECT COUNT(DISTINCT COALESCE(o.client_id::text, 'name:' || fin_key(o.client)))::int AS n FROM orders o WHERE ${orderWhere}`)
      .get(params)) as { n: number } | undefined
    total = akb?.n ?? 0
  }
  return { group, measure, currency: work || base, unit: UNITS[measure], rows, total: round(total, 3) }
}
