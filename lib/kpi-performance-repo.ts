import "server-only"

import { ensureAttendanceSchema } from "@/lib/attendance-schema"
import { holidaysOf } from "@/lib/attendance-weekend-days-repo"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { normCurrency } from "@/lib/finance/currency"
import { loadCurrencyContext } from "@/lib/finance/context"
import { nowLocalIso } from "@/lib/finance/dates"
import { kpiPlanCode } from "@/lib/kpi-form-rules"
import { kpiFirstLevel, kpiLevelBreakdown, kpiRowNumbers, roundHalfUp, workDaysAt, type KpiDetailRule, type KpiLevelPart } from "@/lib/kpi-performance-rules"

/*
 * «Выполнения KPI» (Linko's staff/staff_balance + staff/performance_indicator/balance): one row per employee and KPI
 * planned for the month in «Зарплата и установка планов» (salary_records.indicators).
 *
 * Like Linko, the rows are a stored snapshot (kpi_staff_balances): «Перерасчет» (this page or «Перерасчет KPI» of the
 * salary page) computes them as of that moment and stores the moment (kpi_balance_dates, «данные за»); the page shows
 * the stored rows. A month that was never recalculated has no rows.
 *
 * The facts, as of the calculation moment T, for the period [first day of the month, min(last day, T)] — rules read
 * off Linko's stored rows of 2024-10 … 2026-08 (orders, returns, visits, payments of the copy of the Linko account):
 * - the employee of a document: orders.agent (Linko's order user), client_returns.agent (the return's responsible
 *   agent), customer_payments.agent / created_by (the payment's user), field_visits.employee_id; a name maps to the
 *   lowest employee id with that name.
 * - an order counts unless it was «Отменен» at T: its status at T is the status of its last log (order_logs) written
 *   up to T (Linko recomputes nothing later, so an order cancelled after T still counts); a return counts unless it is
 *   cancelled.
 * - dates: «Дата создания» = the order's creation; «Дата доставки» = the order's delivery date (orders.delivery,
 *   whatever its status); «Дата передачи» = its transfer from the warehouse; a return by its creation or its
 *   acceptance (the KPI's «Дата возврата»).
 * - money is the documents' own totals (an order's = the sum of its lines, which is Linko's total to the last digit; the
 *   order's rounded total only when it has no lines), summed as they are: a KPI with a currency counts only documents in it, one
 *   without a currency adds every document's number (Linko does not convert).
 * - sales_sum / product_sales_amount: sales of the period − returns of the period (amount / quantity of the lines);
 *   sales_sum_order / product_sales_amount_order: sales of the period − returns made up to T of those orders;
 *   active_client_count: shops with a counted order;
 *   visit: visits started; payment_to_cashbox: the employee's client payments (not deleted).
 * - today's columns: the same over the calculation day.
 * Plan types not listed (Плановый Визит ПО ДНЯМ: Linko's route plans of the past are not kept; Дневной АКБ: no Linko row
 * to check it against; ММЛ, вес, доставка, посещение …) and KPIs with conditions this engine
 * does not apply have no fact (null): their rows keep the plan only. Level, bonus, percents, forecast and daily plan:
 * lib/kpi-performance-rules.ts.
 */

const SCHEMA_VERSION = 1

declare global {
  var __linkoKpiBalancesSchema: { version: number; ready: Promise<void> } | undefined
}

function ensureSchema(): Promise<void> {
  if (globalThis.__linkoKpiBalancesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:kpi_staff_balances:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS kpi_staff_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            kpi_id INTEGER NOT NULL,
            plan_type TEXT NOT NULL DEFAULT '',
            currency TEXT NOT NULL DEFAULT '',
            plan DOUBLE PRECISION NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 1,
            sales DOUBLE PRECISION,
            returns DOUBLE PRECISION,
            fact DOUBLE PRECISION,
            bonus DOUBLE PRECISION,
            forecast DOUBLE PRECISION,
            fact_percent DOUBLE PRECISION,
            forecast_percent DOUBLE PRECISION,
            daily_plan DOUBLE PRECISION,
            daily_sales DOUBLE PRECISION,
            daily_returns DOUBLE PRECISION,
            daily_fact DOUBLE PRECISION,
            daily_fact_percent DOUBLE PRECISION,
            computed_at TEXT NOT NULL DEFAULT '',
            UNIQUE (month, year, user_id, kpi_id)
          );
        `)
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS kpi_balance_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            last_date TEXT NOT NULL,
            UNIQUE (month, year)
          );
        `)
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoKpiBalancesSchema = undefined
      throw error
    })
    globalThis.__linkoKpiBalancesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoKpiBalancesSchema!.ready
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One planned KPI of one employee. */
export type KpiPlanInput = { userId: number; kpiId: number; plan: number }

type KpiDetail = KpiDetailRule & {
  currency?: { name?: string } | null
  products?: Array<{ id?: number; name?: string }>
  product_types?: Array<{ id?: number; name?: string }>
  brands?: Array<{ id?: number; name?: string }>
  group_products?: Array<{ id?: number; name?: string }>
  price_lists?: Array<{ id?: number; name?: string }>
  branches?: Array<{ id?: number; name?: string }>
  market_types?: Array<{ id?: number; name?: string }>
  borders?: Array<{ id?: number; title?: string; name?: string }>
  order_status?: unknown[]
  order_return_status?: unknown[]
  is_order_status?: boolean
  is_order_return_status?: boolean
  order_date_type?: string
  order_return_date_type?: string
  exclude_product?: boolean
  exclude_brand?: boolean
  exclude_product_type?: boolean
  exclude_group_product?: boolean
  start_date?: string | null
  till_date?: string | null
  sku_amount_from?: string | number | null
  sku_amount_to?: string | number | null
  total_price_from?: string | number | null
  total_price_to?: string | number | null
  [key: string]: unknown
}

type Kpi = { id: number; name: string; planType: string; detail: KpiDetail }

/** Plan types this engine computes (see the header). */
const SUPPORTED = new Set([
  "sales_sum",
  "product_sales_amount",
  "sales_sum_order",
  "product_sales_amount_order",
  "active_client_count",
  "visit",
  "payment_to_cashbox",
])

/** Conditions of a KPI this engine does not apply: such a KPI gets no fact rather than a wrong one. */
function unsupportedCondition(detail: KpiDetail): boolean {
  const list = (key: string) => Array.isArray(detail[key]) && (detail[key] as unknown[]).length > 0
  const set = (key: string) => detail[key] !== null && detail[key] !== undefined && detail[key] !== ""
  return (
    Boolean(detail.is_mml) ||
    Boolean(detail.only_new_market) ||
    Boolean(detail.calc_in_box) ||
    Boolean(detail.for_supervisor) ||
    detail.is_paid_fully === true ||
    Boolean(detail.is_date_return) ||
    set("paid_days_from") ||
    set("paid_days_to") ||
    set("total_payment_from") ||
    set("total_payment_to") ||
    list("transports") ||
    list("operators") ||
    list("attendance_type")
  )
}

const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const key = (value: unknown) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

async function loadKpis(db: PgDb, ids: number[]): Promise<Map<number, Kpi>> {
  if (!(await tableExists(db, "kpi_tasks"))) return new Map()
  const details = await tableExists(db, "kpi_task_details")
  const rows = (await db
    .prepare(
      `SELECT t.id, t.name, t.plan_type, ${details ? "d.detail" : "NULL::text AS detail"} FROM kpi_tasks t
       ${details ? "LEFT JOIN kpi_task_details d ON d.task_id = t.id" : ""} WHERE t.id = ANY(@ids::int[])`,
    )
    .all({ ids })) as Array<{ id: number; name: string; plan_type: string; detail: string | null }>
  const map = new Map<number, Kpi>()
  for (const row of rows) {
    let detail: KpiDetail = {}
    try {
      detail = row.detail ? (JSON.parse(row.detail) as KpiDetail) : {}
    } catch {
      detail = {}
    }
    map.set(Number(row.id), { id: Number(row.id), name: row.name, planType: kpiPlanCode(row.plan_type) || row.plan_type, detail })
  }
  return map
}

/** The KPI plans of the month in «Зарплата и установка планов». */
async function salaryPlans(db: PgDb, month: number, year: number): Promise<KpiPlanInput[]> {
  const exists = (await db.prepare("SELECT to_regclass('salary_records') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return []
  const rows = (await db.prepare("SELECT user_id, indicators FROM salary_records WHERE month = ? AND year = ?").all(month, year)) as Array<{
    user_id: number
    indicators: string
  }>
  const plans: KpiPlanInput[] = []
  for (const row of rows) {
    let indicators: Array<{ id: number; plan: number }> = []
    try {
      indicators = JSON.parse(row.indicators || "[]")
    } catch {
      indicators = []
    }
    for (const item of indicators) if (num(item.plan) > 0 && num(item.id) > 0) plans.push({ userId: Number(row.user_id), kpiId: Number(item.id), plan: num(item.plan) })
  }
  return plans
}

// ---------------------------------------------------------------------------
// Documents of the period
// ---------------------------------------------------------------------------

type Line = { productId: number | null; qty: number; amount: number; type: string; brand: string; group: string }
type OrderDoc = {
  id: number
  userId: number
  clientId: number | null
  created: string
  deliveryDay: string | null
  transferDay: string | null
  currency: string
  total: number
  priceList: string
  status: string
  lines: Line[]
}
type ReturnDoc = {
  id: number
  userId: number | null
  clientId: number | null
  orderId: number | null
  created: string
  accepted: string | null
  currency: string
  total: number
  status: string
  lines: Array<Line & { orderId: number | null }>
}
type Client = { branch: string; type: string; zone: string }
type Docs = {
  orders: OrderDoc[]
  returns: ReturnDoc[]
  visits: Array<{ userId: number; clientId: number | null; at: string }>
  payments: Array<{ userId: number; clientId: number | null; at: string; currency: string; amount: number }>
  clients: Map<number, Client>
}

/** Linko's order status code of an order status label (the codes the order logs keep). */
const STATUS_CODE: Record<string, string> = { "В процессе": "0", "Есть на складе": "1", "В пути": "2", "Доставлено": "3", "Отменен": "4", "Не подтвержден": "5" }
/** Linko's return status codes of the local return statuses (pending = new / waiting). */
const RETURN_CODE: Record<string, string[]> = { pending: ["0", "1"], accepted: ["2"], cancelled: ["3"] }

const LOCAL = `'YYYY-MM-DD"T"HH24:MI:SS'`

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(?) IS NOT NULL AS ok").get(table)) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

async function loadDocs(db: PgDb, userIds: number[], from: string, at: string, base: string): Promise<Docs> {
  // Every document of the employees from the first day of the month up to T (orders of a delivery / transfer date in the
  // month may be older; returns of the month's orders may come up to T).
  const ek = `ek AS (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1)`
  const orderRows = (await db
    .prepare(
      `WITH ${ek},
       o AS (
         SELECT o.id, ek.id AS user_id, o.client_id, o.status, o.price_list, o.currency, o.total_price, o.amount,
                fin_ts(o.created_at, true) AS created_ts,
                fin_ts(NULLIF(o.delivery, ''))::date AS delivery_day,
                COALESCE(fin_ts(NULLIF(o.accepted_date, '')), fin_ts(NULLIF(o.shipped_at, '')))::date AS transfer_day
           FROM orders o JOIN ek ON ek.k = fin_key(o.agent)
          WHERE ek.id = ANY(@users::int[]))
       SELECT o.id, o.user_id, o.client_id, o.status, COALESCE(o.price_list, '') AS price_list,
              COALESCE(fin_cur(o.currency), @base) AS currency,
              COALESCE((SELECT SUM(i.quantity::float8 * i.unit_price::float8 * (1 - COALESCE(i.discount_percent, 0)::float8 / 100))
                          FROM order_items i WHERE i.order_id = o.id),
                       o.total_price, (SELECT SUM(a.amount) FROM fin_amounts(o.amount) a), 0)::float8 AS total,
              to_char(o.created_ts, ${LOCAL}) AS created,
              to_char(o.delivery_day, 'YYYY-MM-DD') AS delivery_day,
              to_char(o.transfer_day, 'YYYY-MM-DD') AS transfer_day,
              (SELECT l.status FROM order_logs l
                WHERE l.order_id = o.id AND l.status <> '' AND fin_ts(l.created_at) <= @at::timestamp
                ORDER BY fin_ts(l.created_at) DESC, l.id DESC LIMIT 1) AS status_at
         FROM o
        WHERE o.created_ts <= @at::timestamp
          AND (o.created_ts >= @from::timestamp - interval '1 day' OR o.delivery_day >= @from::date OR o.transfer_day >= @from::date)`,
    )
    .all({ users: userIds, at, from, base })) as Array<Record<string, unknown>>
  const orderIds = orderRows.map((row) => Number(row.id))
  const lineRows = orderIds.length
    ? ((await db
        .prepare(
          `SELECT i.order_id, i.product_id, i.quantity::float8 AS qty,
                  (i.quantity::float8 * i.unit_price::float8 * (1 - COALESCE(i.discount_percent, 0)::float8 / 100)) AS amount,
                  COALESCE(p.type, '') AS type, COALESCE(p.brand, '') AS brand, COALESCE(p.product_group, '') AS grp
             FROM order_items i LEFT JOIN products p ON p.id = i.product_id
            WHERE i.order_id = ANY(@ids::int[])`,
        )
        .all({ ids: orderIds })) as Array<Record<string, unknown>>)
    : []
  const linesOf = new Map<number, Line[]>()
  for (const row of lineRows) {
    const list = linesOf.get(Number(row.order_id)) ?? []
    list.push({ productId: row.product_id === null ? null : Number(row.product_id), qty: num(row.qty), amount: num(row.amount), type: String(row.type), brand: String(row.brand), group: String(row.grp) })
    linesOf.set(Number(row.order_id), list)
  }
  const orders: OrderDoc[] = orderRows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    clientId: row.client_id === null ? null : Number(row.client_id),
    created: String(row.created ?? ""),
    deliveryDay: (row.delivery_day as string | null) ?? null,
    transferDay: (row.transfer_day as string | null) ?? null,
    currency: String(row.currency),
    total: num(row.total),
    priceList: String(row.price_list ?? ""),
    status: (row.status_at as string | null) || STATUS_CODE[String(row.status ?? "")] || "",
    lines: linesOf.get(Number(row.id)) ?? [],
  }))

  let returns: ReturnDoc[] = []
  if (await tableExists(db, "client_returns")) {
    const returnRows = (await db
      .prepare(
        `WITH ${ek},
         r AS (
           SELECT r.id, r.client_id, r.status, r.currency, r.amount,
                  COALESCE(r.order_id, (SELECT oi.order_id FROM client_return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = r.id LIMIT 1)) AS order_id,
                  COALESCE(fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true)) AS created_ts,
                  fin_ts(NULLIF(r.accepted_at, '')) AS accepted_ts,
                  NULLIF(r.agent, '') AS agent
             FROM client_returns r)
         SELECT r.id, ek.id AS user_id, r.client_id, r.order_id, r.status, COALESCE(fin_cur(r.currency), @base) AS currency,
                COALESCE(r.amount, 0)::float8 AS total, to_char(r.created_ts, ${LOCAL}) AS created, to_char(r.accepted_ts, ${LOCAL}) AS accepted
           FROM r LEFT JOIN ek ON ek.k = fin_key(r.agent)
          WHERE r.created_ts <= @at::timestamp
            AND (ek.id = ANY(@users::int[]) OR r.order_id = ANY(@orders::int[])
                 OR EXISTS (SELECT 1 FROM client_return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = r.id AND oi.order_id = ANY(@orders::int[])))`,
      )
      .all({ users: userIds, orders: orderIds, at, base })) as Array<Record<string, unknown>>
    const returnIds = returnRows.map((row) => Number(row.id))
    const returnLines = returnIds.length
      ? ((await db
          .prepare(
            `SELECT ri.return_id, ri.product_id, COALESCE(ri.quantity, 0)::float8 AS qty, (COALESCE(ri.quantity, 0) * COALESCE(ri.price, 0))::float8 AS amount,
                    oi.order_id, COALESCE(p.type, '') AS type, COALESCE(p.brand, '') AS brand, COALESCE(p.product_group, '') AS grp
               FROM client_return_items ri
               LEFT JOIN order_items oi ON oi.id = ri.order_item_id
               LEFT JOIN products p ON p.id = ri.product_id
              WHERE ri.return_id = ANY(@ids::int[])`,
          )
          .all({ ids: returnIds })) as Array<Record<string, unknown>>)
      : []
    const byReturn = new Map<number, ReturnDoc["lines"]>()
    for (const row of returnLines) {
      const list = byReturn.get(Number(row.return_id)) ?? []
      list.push({
        productId: row.product_id === null ? null : Number(row.product_id),
        qty: num(row.qty),
        amount: num(row.amount),
        type: String(row.type),
        brand: String(row.brand),
        group: String(row.grp),
        orderId: row.order_id === null ? null : Number(row.order_id),
      })
      byReturn.set(Number(row.return_id), list)
    }
    returns = returnRows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id === null ? null : Number(row.user_id),
      clientId: row.client_id === null ? null : Number(row.client_id),
      orderId: row.order_id === null ? null : Number(row.order_id),
      created: String(row.created ?? ""),
      accepted: (row.accepted as string | null) ?? null,
      currency: String(row.currency),
      total: num(row.total),
      status: String(row.status ?? ""),
      lines: byReturn.get(Number(row.id)) ?? [],
    }))
  }

  const visits = !(await tableExists(db, "field_visits"))
    ? []
    : ((await db
      .prepare(
        `SELECT employee_id AS user_id, client_id, to_char((started_at AT TIME ZONE 'UTC') + interval '5 hours', ${LOCAL}) AS at
           FROM field_visits
          WHERE employee_id = ANY(@users::int[]) AND started_at >= (@from::timestamp - interval '5 hours') AT TIME ZONE 'UTC'
            AND started_at <= (@at::timestamp - interval '5 hours') AT TIME ZONE 'UTC'`,
      )
      .all({ users: userIds, from, at })) as Array<Record<string, unknown>>).map((row) => ({
        userId: Number(row.user_id),
        clientId: row.client_id === null ? null : Number(row.client_id),
        at: String(row.at),
      }))

  const payments = !(await tableExists(db, "customer_payments"))
    ? []
    : ((await db
      .prepare(
        `WITH ${ek}
         SELECT ek.id AS user_id, p.client_id, COALESCE(fin_cur(p.currency), @base) AS currency, p.amount::float8 AS amount,
                to_char(COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.created_at, true)), ${LOCAL}) AS at
           FROM customer_payments p JOIN ek ON ek.k = fin_key(COALESCE(NULLIF(p.agent, ''), p.created_by))
          WHERE ek.id = ANY(@users::int[]) AND COALESCE(p.is_deleted, 0) = 0
            AND COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.created_at, true)) BETWEEN @from::timestamp AND @at::timestamp`,
      )
      .all({ users: userIds, from, at, base })) as Array<Record<string, unknown>>).map((row) => ({
        userId: Number(row.user_id),
        clientId: row.client_id === null ? null : Number(row.client_id),
        at: String(row.at),
        currency: String(row.currency),
        amount: num(row.amount),
      }))

  const clientIds = [...new Set([...orders, ...returns].map((doc) => doc.clientId).filter((id): id is number => id !== null))]
  const clients = new Map<number, Client>()
  if (clientIds.length) {
    const rows = (await db.prepare("SELECT id, COALESCE(branch, '') AS branch, COALESCE(type, '') AS type, COALESCE(zone, '') AS zone FROM clients WHERE id = ANY(@ids::int[])").all({ ids: clientIds })) as Array<
      Record<string, unknown>
    >
    for (const row of rows) clients.set(Number(row.id), { branch: String(row.branch), type: String(row.type), zone: String(row.zone) })
  }
  return { orders, returns, visits, payments, clients }
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

type Window = { from: string; to: string }
type Fact = { sales: number; returns: number; fact: number }

const names = (list: Array<{ name?: string; title?: string }> | undefined) => new Set((list ?? []).map((item) => key(item.name ?? item.title)))

function inWindow(stamp: string | null, window: Window): boolean {
  if (!stamp) return false
  if (stamp.length === 10) return stamp >= window.from.slice(0, 10) && stamp <= window.to.slice(0, 10)
  return stamp >= window.from && stamp <= window.to
}

function makeFilters(detail: KpiDetail, base: string) {
  const currency = detail.currency?.name ? normCurrency(detail.currency.name, base) : ""
  const products = new Set((detail.products ?? []).map((item) => Number(item.id)))
  const types = names(detail.product_types)
  const brands = names(detail.brands)
  const groups = names(detail.group_products)
  const priceLists = names(detail.price_lists)
  const branches = names(detail.branches)
  const marketTypes = names(detail.market_types)
  const borders = names(detail.borders)
  const orderStatuses = detail.is_order_status && detail.order_status?.length ? new Set(detail.order_status.map(String)) : null
  const returnStatuses = detail.is_order_return_status && detail.order_return_status?.length ? new Set(detail.order_return_status.map(String)) : null
  const productFilter = products.size > 0 || types.size > 0 || brands.size > 0 || groups.size > 0
  const skuFrom = detail.sku_amount_from === null || detail.sku_amount_from === undefined ? null : num(detail.sku_amount_from)
  const skuTo = detail.sku_amount_to === null || detail.sku_amount_to === undefined ? null : num(detail.sku_amount_to)
  const priceFrom = num(detail.total_price_from)
  const priceTo = num(detail.total_price_to)

  const lineOk = (line: Line) => {
    if (products.size && products.has(Number(line.productId)) === Boolean(detail.exclude_product)) return false
    if (types.size && types.has(key(line.type)) === Boolean(detail.exclude_product_type)) return false
    if (brands.size && brands.has(key(line.brand)) === Boolean(detail.exclude_brand)) return false
    if (groups.size && groups.has(key(line.group)) === Boolean(detail.exclude_group_product)) return false
    return true
  }
  const clientOk = (clients: Map<number, Client>, clientId: number | null) => {
    if (!branches.size && !marketTypes.size && !borders.size) return true
    const client = clientId === null ? undefined : clients.get(clientId)
    if (!client) return false
    if (branches.size && !branches.has(key(client.branch))) return false
    if (marketTypes.size && !marketTypes.has(key(client.type))) return false
    if (borders.size && !borders.has(key(client.zone))) return false
    return true
  }
  const orderOk = (order: OrderDoc, clients: Map<number, Client>) => {
    if (order.status === "4") return false
    if (currency && order.currency !== currency) return false
    if (orderStatuses && !orderStatuses.has(order.status)) return false
    if (priceLists.size && !priceLists.has(key(order.priceList))) return false
    if (!clientOk(clients, order.clientId)) return false
    const matching = productFilter ? order.lines.filter(lineOk) : order.lines
    if (productFilter && !matching.length) return false
    if (skuFrom !== null || skuTo !== null) {
      const sku = new Set(matching.map((line) => line.productId)).size
      if (skuFrom !== null && sku < skuFrom) return false
      if (skuTo !== null && skuTo > 0 && sku > skuTo) return false
    }
    if ((priceFrom > 0 || priceTo > 0) && (order.total < priceFrom || (priceTo > 0 && order.total > priceTo))) return false
    return true
  }
  const returnOk = (doc: ReturnDoc, clients: Map<number, Client>) => {
    if (doc.status === "cancelled") return false
    if (currency && doc.currency !== currency) return false
    if (returnStatuses && !(RETURN_CODE[doc.status] ?? []).some((code) => returnStatuses.has(code))) return false
    if (!clientOk(clients, doc.clientId)) return false
    return true
  }
  const orderMoney = (order: OrderDoc) => (productFilter ? order.lines.filter(lineOk).reduce((sum, line) => sum + line.amount, 0) : order.total)
  const orderQty = (order: OrderDoc) => (productFilter ? order.lines.filter(lineOk) : order.lines).reduce((sum, line) => sum + line.qty, 0)
  return { currency, productFilter, lineOk, orderOk, returnOk, orderMoney, orderQty }
}

function computeFact(kpi: Kpi, userId: number, docs: Docs, window: Window, at: string, base: string): Fact | null {
  const detail = kpi.detail
  const f = makeFilters(detail, base)
  const orderDay = (order: OrderDoc) =>
    detail.order_date_type === "delivered_date" ? order.deliveryDay : detail.order_date_type === "accepted_date" ? order.transferDay : order.created
  const returnDay = (doc: ReturnDoc) => (detail.order_return_date_type === "accepted_date" ? doc.accepted : doc.created)
  const counted = docs.orders.filter((order) => order.userId === userId && order.created <= at && f.orderOk(order, docs.clients) && inWindow(orderDay(order), window))
  const money = kpi.planType === "sales_sum" || kpi.planType === "sales_sum_order"
  const amountOf = (order: OrderDoc) => (money ? f.orderMoney(order) : f.orderQty(order))
  const returnAmount = (doc: ReturnDoc, linePick: (line: ReturnDoc["lines"][number]) => boolean) => {
    const lines = doc.lines.filter((line) => (!f.productFilter || f.lineOk(line)) && linePick(line))
    if (money) return f.productFilter || doc.lines.some((line) => !linePick(line)) ? lines.reduce((sum, line) => sum + line.amount, 0) : doc.total
    return lines.reduce((sum, line) => sum + line.qty, 0)
  }
  switch (kpi.planType) {
    case "sales_sum":
    case "product_sales_amount": {
      const sales = counted.reduce((sum, order) => sum + amountOf(order), 0)
      const returns = docs.returns
        .filter((doc) => doc.userId === userId && f.returnOk(doc, docs.clients) && inWindow(returnDay(doc), window))
        .reduce((sum, doc) => sum + returnAmount(doc, () => true), 0)
      return { sales, returns, fact: sales - returns }
    }
    case "sales_sum_order":
    case "product_sales_amount_order": {
      const sales = counted.reduce((sum, order) => sum + amountOf(order), 0)
      const ids = new Set(counted.map((order) => order.id))
      const returns = docs.returns
        .filter((doc) => f.returnOk(doc, docs.clients) && doc.created <= at && (ids.has(Number(doc.orderId)) || doc.lines.some((line) => ids.has(Number(line.orderId)))))
        .reduce((sum, doc) => sum + returnAmount(doc, (line) => line.orderId === null ? ids.has(Number(doc.orderId)) : ids.has(line.orderId)), 0)
      return { sales, returns, fact: sales - returns }
    }
    case "active_client_count": {
      const shops = new Set(counted.map((order) => order.clientId ?? `o${order.id}`))
      return { sales: shops.size, returns: 0, fact: shops.size }
    }
    case "active_client_count_by_day": {
      const shopDays = new Set(counted.map((order) => `${order.clientId ?? `o${order.id}`}|${String(orderDay(order) ?? "").slice(0, 10)}`))
      return { sales: shopDays.size, returns: 0, fact: shopDays.size }
    }
    case "visit": {
      const count = docs.visits.filter((visit) => visit.userId === userId && inWindow(visit.at, window)).length
      return { sales: count, returns: 0, fact: count }
    }
    case "payment_to_cashbox": {
      const sum = docs.payments
        .filter((payment) => payment.userId === userId && (!f.currency || payment.currency === f.currency) && inWindow(payment.at, window))
        .reduce((total, payment) => total + payment.amount, 0)
      return { sales: sum, returns: 0, fact: sum }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0")

export type KpiBalanceRow = {
  userId: number
  firstName: string
  secondName: string
  kpiId: number
  kpiName: string
  planType: string
  currency: string
  plan: number
  level: number
  sales: number | null
  returns: number | null
  fact: number | null
  bonus: number | null
  forecast: number | null
  factPercent: number | null
  forecastPercent: number | null
  dailyPlan: number | null
  dailySales: number | null
  dailyReturns: number | null
  dailyFact: number | null
  dailyFactPercent: number | null
}

type StoredRow = Omit<KpiBalanceRow, "firstName" | "secondName" | "kpiName">

/** A computed row with what Linko's salary card keeps besides the stored row: the KPI's name, the daily plan before
 * rounding and the levels that make up the bonus (kpiLevelBreakdown; the lowest level with no bonus when the fact
 * reaches none, nothing for a KPI without levels or without a fact). */
export type KpiComputedRow = StoredRow & { kpiName: string; dailyPlanExact: number | null; levels: KpiLevelPart[] }

/** The schemas the calculation reads (finance SQL functions, holidays); run outside a transaction. */
export async function prepareKpiSources(): Promise<void> {
  await ensureFinanceSchema()
  await ensureAttendanceSchema()
  await ensureSchema()
}

/** Computes the rows of the month as of `at` (local "YYYY-MM-DDTHH:mm:ss") for the given plans (prepareKpiSources first). */
export async function computeKpiBalances(db: PgDb, month: number, year: number, at: string, plans: KpiPlanInput[]): Promise<KpiComputedRow[]> {
  if (!plans.length) return []
  const base = (await loadCurrencyContext(db)).base
  const kpis = await loadKpis(db, [...new Set(plans.map((plan) => plan.kpiId))])
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthFrom = `${year}-${pad(month)}-01T00:00:00`
  const monthTo = `${year}-${pad(month)}-${pad(last)}T23:59:59`
  const cut = at < monthTo ? at : monthTo
  const calcYear = Number(at.slice(0, 4))
  const calcMonth = Number(at.slice(5, 7))
  const calcDay = Number(at.slice(8, 10))
  const holidays = await holidaysOf(db, calcYear, calcMonth)
  const days = workDaysAt(calcYear, calcMonth, calcDay, holidays.dates)
  const dayFrom = `${at.slice(0, 10)}T00:00:00`
  const users = [...new Set(plans.map((plan) => plan.userId))]
  const docs = await loadDocs(db, users, monthFrom, at, base)

  const rows: KpiComputedRow[] = []
  for (const plan of plans) {
    const kpi = kpis.get(plan.kpiId)
    const planType = kpi?.planType ?? ""
    const currency = kpi?.detail.currency?.name ? normCurrency(kpi.detail.currency.name, base) : ""
    const supported = Boolean(kpi) && SUPPORTED.has(planType) && !unsupportedCondition(kpi!.detail)
    // A KPI's own validity period narrows the month.
    const startDate = kpi?.detail.start_date ? `${kpi.detail.start_date}T00:00:00` : ""
    const tillDate = kpi?.detail.till_date ? `${kpi.detail.till_date}T23:59:59` : ""
    const window: Window = { from: startDate > monthFrom ? startDate : monthFrom, to: tillDate && tillDate < cut ? tillDate : cut }
    const dayWindow: Window = { from: dayFrom > window.from ? dayFrom : window.from, to: window.to }
    const month1 = supported ? computeFact(kpi!, plan.userId, docs, window, at, base) : null
    const today = supported && dayWindow.from <= dayWindow.to ? computeFact(kpi!, plan.userId, docs, dayWindow, at, base) : supported ? { sales: 0, returns: 0, fact: 0 } : null
    if (!month1) {
      rows.push({
        userId: plan.userId,
        kpiId: plan.kpiId,
        kpiName: kpi?.name ?? "",
        planType,
        currency,
        plan: plan.plan,
        level: 1,
        sales: null,
        returns: null,
        fact: null,
        bonus: null,
        forecast: null,
        factPercent: null,
        forecastPercent: null,
        dailyPlan: null,
        dailyPlanExact: null,
        dailySales: null,
        dailyReturns: null,
        dailyFact: null,
        dailyFactPercent: null,
        levels: [],
      })
      continue
    }
    const { level, bonus, parts } = kpiLevelBreakdown(kpi!.detail, month1.fact, plan.plan)
    const first = parts.length ? null : kpiFirstLevel(kpi!.detail)
    const numbers = kpiRowNumbers({ planType, plan: plan.plan, fact: month1.fact, dailyFact: today?.fact ?? 0, kpiMonth: month, calcMonth, total: days.total, passed: days.passed })
    rows.push({
      userId: plan.userId,
      kpiId: plan.kpiId,
      kpiName: kpi!.name,
      planType,
      currency,
      plan: plan.plan,
      level,
      sales: month1.sales,
      returns: month1.returns,
      fact: month1.fact,
      bonus,
      forecast: numbers.forecast,
      factPercent: numbers.factPercent,
      forecastPercent: numbers.forecastPercent,
      dailyPlan: numbers.dailyPlan,
      dailyPlanExact: numbers.dailyPlanExact,
      dailySales: today?.sales ?? 0,
      dailyReturns: today?.returns ?? 0,
      dailyFact: today?.fact ?? 0,
      dailyFactPercent: numbers.dailyFactPercent,
      levels: parts.length ? parts : first ? [{ ...first, bonus: 0 }] : [],
    })
  }
  return rows
}

/** One balance of Linko's salary card (staff/salary/<id>/ → balances, the salary_kpi_balances row of the record's card). */
export type KpiCardBalance = {
  kpiId: number
  kpiName: string
  planType: string
  level: number | null
  levelFrom: number | null
  levelTo: number | null
  calculationType: string
  plan: number
  sales: number | null
  returns: number | null
  fact: number | null
  bonus: number
  forecast: number | null
  dailyPlan: number | null
  dailySales: number | null
  dailyReturns: number | null
  dailyFact: number | null
}

/** Linko stores the card's numbers with nine decimals (numeric(…, 9)). */
const nine = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? value : Number(value.toFixed(9)))

/**
 * An employee's computed rows as the balances of Linko's salary card: per KPI one balance per level of the bonus chain
 * (each with that level's part of the bonus) and the KPI's month and today figures repeated on each, the daily plan
 * unrounded; a KPI without a fact (or without levels) is one balance without a level and with no bonus. Ordered by KPI
 * and level, like Linko's card.
 */
export function kpiCardBalances(rows: KpiComputedRow[]): KpiCardBalance[] {
  const out: KpiCardBalance[] = []
  for (const row of [...rows].sort((a, b) => a.kpiId - b.kpiId)) {
    const common = {
      kpiId: row.kpiId,
      kpiName: row.kpiName,
      planType: row.planType,
      plan: row.plan,
      sales: nine(row.sales),
      returns: nine(row.returns),
      fact: nine(row.fact),
      forecast: nine(row.forecast),
      dailyPlan: nine(row.dailyPlanExact),
      dailySales: nine(row.dailySales),
      dailyReturns: nine(row.dailyReturns),
      dailyFact: nine(row.dailyFact),
    }
    if (!row.levels.length) {
      out.push({ ...common, level: null, levelFrom: null, levelTo: null, calculationType: "", bonus: 0 })
      continue
    }
    for (const part of row.levels) {
      out.push({ ...common, level: part.level, levelFrom: part.from, levelTo: part.to, calculationType: part.calculationType, bonus: nine(part.bonus) ?? 0 })
    }
  }
  return out
}

/**
 * «Перерасчет»: computes the month's rows as of `at` (now by default) for `plans` (the month's plans in «Зарплата и
 * установка планов» by default), replaces the stored rows and stamps «данные за». Returns the stored rows.
 */
export async function recalculateKpiBalances(month: number, year: number, options: { at?: string; plans?: KpiPlanInput[] } = {}): Promise<KpiComputedRow[]> {
  await prepareKpiSources()
  const at = options.at ?? nowLocalIso()
  return withTransaction(async (db) => {
    await db.exec(`SELECT pg_advisory_xact_lock(hashtext('linko:kpi_staff_balances:${year}-${month}'))`)
    const plans = options.plans ?? (await salaryPlans(db, month, year))
    const rows = await computeKpiBalances(db, month, year, at, plans)
    await db.prepare("DELETE FROM kpi_staff_balances WHERE month = ? AND year = ?").run(month, year)
    const insert = db.prepare(
      `INSERT INTO kpi_staff_balances (month, year, user_id, kpi_id, plan_type, currency, plan, level, sales, returns, fact, bonus, forecast,
         fact_percent, forecast_percent, daily_plan, daily_sales, daily_returns, daily_fact, daily_fact_percent, computed_at)
       VALUES (@month, @year, @userId, @kpiId, @planType, @currency, @plan, @level, @sales, @returns, @fact, @bonus, @forecast,
         @factPercent, @forecastPercent, @dailyPlan, @dailySales, @dailyReturns, @dailyFact, @dailyFactPercent, @at)
       ON CONFLICT (month, year, user_id, kpi_id) DO NOTHING`,
    )
    for (const row of rows) await insert.run({ ...row, month, year, at })
    await db
      .prepare(`INSERT INTO kpi_balance_dates (month, year, last_date) VALUES (?, ?, ?) ON CONFLICT (month, year) DO UPDATE SET last_date = EXCLUDED.last_date`)
      .run(month, year, at)
    return rows
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type KpiBalanceCard = {
  id: number
  name: string
  planType: string
  planAmount: number
  factAmount: number | null
  factPercent: number | null
  forecastAmount: number | null
  forecastPercent: number | null
  bonusAmount: number | null
}

/** lastDate: the month's last «Перерасчет»; todayDate: the last «Перерасчет» of today, of any month (what Linko's page
 * prints after «данные за»: it asks staff_balance/last_date/?by=today, empty unless something was recalculated today). */
export type KpiPerformance = { month: number; year: number; lastDate: string | null; todayDate: string | null; cards: KpiBalanceCard[]; rows: KpiBalanceRow[] }

// Linko lists the KPIs by name in its database collation: case, spaces and punctuation ignored, Latin before Cyrillic.
const nameCollator = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true })

async function storedRows(db: PgDb, month: number, year: number): Promise<KpiBalanceRow[]> {
  const tasks = await tableExists(db, "kpi_tasks")
  const rows = (await db
    .prepare(
      `SELECT b.*, COALESCE(e.first_name, '') AS first_name, COALESCE(e.last_name, '') AS last_name, ${tasks ? "COALESCE(t.name, '')" : "''"} AS kpi_name
         FROM kpi_staff_balances b
         LEFT JOIN employees e ON e.id = b.user_id
         ${tasks ? "LEFT JOIN kpi_tasks t ON t.id = b.kpi_id" : ""}
        WHERE b.month = ? AND b.year = ?
        ORDER BY b.user_id, b.kpi_id`,
    )
    .all(month, year)) as Array<Record<string, unknown>>
  const opt = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return rows.map((row) => ({
    userId: Number(row.user_id),
    firstName: String(row.first_name),
    secondName: String(row.last_name),
    kpiId: Number(row.kpi_id),
    kpiName: String(row.kpi_name),
    planType: String(row.plan_type),
    currency: String(row.currency ?? ""),
    plan: Number(row.plan),
    level: Number(row.level),
    sales: opt(row.sales),
    returns: opt(row.returns),
    fact: opt(row.fact),
    bonus: opt(row.bonus),
    forecast: opt(row.forecast),
    factPercent: opt(row.fact_percent),
    forecastPercent: opt(row.forecast_percent),
    dailyPlan: opt(row.daily_plan),
    dailySales: opt(row.daily_sales),
    dailyReturns: opt(row.daily_returns),
    dailyFact: opt(row.daily_fact),
    dailyFactPercent: opt(row.daily_fact_percent),
  }))
}

/** The page: the KPI cards (sorted by name, like Linko) and the rows (by employee, then KPI), optionally of one KPI. */
export async function getKpiPerformance(month: number, year: number, kpiId?: number | null): Promise<KpiPerformance> {
  await ensureSchema()
  const db = getDb()
  const all = await storedRows(db, month, year)
  const last = (await db.prepare("SELECT last_date FROM kpi_balance_dates WHERE month = ? AND year = ?").get(month, year)) as { last_date: string } | undefined
  const today = (await db.prepare("SELECT MAX(last_date) AS last_date FROM kpi_balance_dates WHERE left(last_date, 10) = ?").get(nowLocalIso().slice(0, 10))) as
    | { last_date: string | null }
    | undefined
  const byKpi = new Map<number, KpiBalanceRow[]>()
  for (const row of all) byKpi.set(row.kpiId, [...(byKpi.get(row.kpiId) ?? []), row])
  const cards: KpiBalanceCard[] = [...byKpi.entries()].map(([id, rows]) => {
    const planAmount = rows.reduce((sum, row) => sum + row.plan, 0)
    const known = rows.every((row) => row.fact !== null)
    const factAmount = known ? rows.reduce((sum, row) => sum + (row.fact ?? 0), 0) : null
    const forecastAmount = known ? rows.reduce((sum, row) => sum + (row.forecast ?? 0), 0) : null
    const percent = (value: number | null) => (value === null ? null : planAmount ? roundHalfUp((value / planAmount) * 100, 1) : 0)
    return {
      id,
      name: rows[0].kpiName,
      planType: rows[0].planType,
      planAmount,
      factAmount,
      factPercent: percent(factAmount),
      forecastAmount,
      forecastPercent: percent(forecastAmount),
      bonusAmount: known ? rows.reduce((sum, row) => sum + (row.bonus ?? 0), 0) : null,
    }
  })
  cards.sort((a, b) => nameCollator.compare(a.name, b.name) || a.id - b.id)
  const rows = kpiId ? all.filter((row) => row.kpiId === kpiId) : all
  return { month, year, lastDate: last?.last_date ?? null, todayDate: today?.last_date ?? null, cards, rows }
}

/** The KPI bonuses of the month per employee and currency (an indicator without a currency pays in the base currency). */
export async function kpiBonusesOf(month: number, year: number): Promise<Map<number, Map<string, number>>> {
  await ensureSchema()
  const db = getDb()
  const base = (await loadCurrencyContext(db)).base
  const rows = (await db.prepare("SELECT user_id, currency, bonus FROM kpi_staff_balances WHERE month = ? AND year = ? AND bonus IS NOT NULL").all(month, year)) as Array<{
    user_id: number
    currency: string
    bonus: number
  }>
  const out = new Map<number, Map<string, number>>()
  for (const row of rows) {
    const currency = row.currency || base
    const map = out.get(Number(row.user_id)) ?? new Map<string, number>()
    map.set(currency, (map.get(currency) ?? 0) + Number(row.bonus))
    out.set(Number(row.user_id), map)
  }
  return out
}

/** The stored rows of a month for the «Скачать EXCEL» sheet: per employee and KPI name [plan, sales, returns, fact, %, level, bonus]. */
export async function kpiSheetRows(month: number, year: number): Promise<{ columns: string[]; facts: Map<number, Record<string, Array<number | null>>> }> {
  const data = await getKpiPerformance(month, year)
  const columns = data.cards.map((card) => card.name)
  const facts = new Map<number, Record<string, Array<number | null>>>()
  for (const row of data.rows) {
    const entry = facts.get(row.userId) ?? {}
    const percent = row.fact === null || !row.plan ? null : roundHalfUp((row.fact / row.plan) * 100, 1)
    entry[row.kpiName] = [row.plan, row.sales, row.returns, row.fact, percent, row.fact === null ? null : row.level, row.bonus]
    facts.set(row.userId, entry)
  }
  return { columns, facts }
}
