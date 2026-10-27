import "server-only"

import type { PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderClientJoin, orderCountedSql, orderRealizationTs, orderReleasedSql } from "@/lib/finance/sources"
import { num } from "@/lib/cash/common"

// What a client still owes on an order ("Ожидаемые оплаты" / pay-order dialog).
// Order total per currency = Σ order_items (qty × price × (1 − discount%)) by
// item currency, else the amounts parsed from orders.amount (same rule as the
// client ledger). Linked paid = Σ live customer_payments.amount with order_id
// (debt side, accepted or not — the client balance counts them at creation).
//
// orderDues(): linked payments only (remaining = total − linked). The input of
// "Долги с заказов" (lib/finance-order-debts.ts), which allocates the rest itself.
//
// allocatedOrderDues(): what the cash pages show and cap payments by — the
// SAME rule as "Долги с заказов": the client's other credits (unlinked payments
// of every source, opening balance, corrections, linked overpayments) form a
// pool = client ledger end balance + Σ positive linked remainders, which pays
// the client's oldest orders first (realization day of released orders, else
// creation day, then id). Σ remainders of a client = its ledger debt, so
// "Ожидаемые оплаты", "Долги с заказов" and "Баланс клиентов" agree. A negative
// pool (debt the orders cannot explain) allocates nothing. The orders and the
// client resolution are the ledger's own (lib/finance/sources.ts: counted
// statuses — not Отменен / Не подтвержден —, orders.client_id first, by name for
// legacy rows, orders of a client that does not exist are not counted); such
// orders come back with `counted: false` and no share.
//
// Orders are linked to clients by orders.client_id when that column exists
// (contract 6), else by name (legacy rows).

export type OrderDueCurrency = { currency: string; total: number; paid: number; remaining: number }

export type OrderDue = {
  id: number
  client: string
  clientId: number | null
  zone: string
  agent: string
  status: string
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  createdAt: string
  delivery: string
  currencies: OrderDueCurrency[]
}

/** paid = linked + allocated; remaining = max(0, total − paid). */
export type AllocatedOrderDueCurrency = OrderDueCurrency & {
  /** Σ payments linked to the order (customer_payments.order_id). */
  linked: number
  /** FIFO share of the client's other credits. */
  allocated: number
}

export type AllocatedOrderDue = Omit<OrderDue, "currencies"> & {
  /** The client ledger counts this order as debt (counted status, existing client). */
  counted: boolean
  currencies: AllocatedOrderDueCurrency[]
}

type DueRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  agent: string
  status: string
  created: string
  delivery: string
  cur: string | null
  total: number | null
  paid: number | null
}

const EPS = 0.005
const LEDGER_TO = "2100-12-31"

async function hasColumn(db: PgDb, table: string, column: string): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
              AND table_name = @table AND column_name = @column) AS ok`,
    )
    .get({ table, column })) as { ok: boolean }
  return row.ok
}

/** SQL of an order's client id (orders.client_id first, legacy rows by name via the ck CTE). */
export async function orderClientIdSql(db: PgDb, alias = "o", nameJoin = "ck"): Promise<string> {
  return (await hasColumn(db, "orders", "client_id")) ? `COALESCE(${alias}.client_id, ${nameJoin}.id)` : `${nameJoin}.id`
}

/** Dues of the given orders (all orders when `ids` is null), linked payments only. */
export async function orderDues(db: PgDb, ids: number[] | null, cc: CurrencyContext): Promise<OrderDue[]> {
  const items = ((await db.prepare("SELECT to_regclass('order_items') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  const clientId = await orderClientIdSql(db)
  const itemTotals = items
    ? `SELECT oi.order_id AS oid, COALESCE(fin_cur(oi.currency), @base::text) AS cur,
              SUM(oi.quantity::float8 * oi.unit_price::float8 * (1 - COALESCE(oi.discount_percent, 0)::float8 / 100)) AS total
       FROM order_items oi JOIN sel ON sel.id = oi.order_id GROUP BY 1, 2
       UNION ALL `
    : ""
  const noItems = items ? "AND NOT EXISTS (SELECT 1 FROM order_items z WHERE z.order_id = o.id)" : ""
  const rows = (await db
    .prepare(
      `WITH sel AS (SELECT id FROM orders WHERE @all::boolean OR id = ANY(@ids::int[])),
       tot AS (
         ${itemTotals}
         SELECT o.id AS oid, COALESCE(a.currency, @base::text) AS cur, SUM(a.amount) AS total
         FROM orders o JOIN sel ON sel.id = o.id CROSS JOIN LATERAL fin_amounts(o.amount) a WHERE true ${noItems} GROUP BY 1, 2
       ),
       paid AS (
         SELECT p.order_id AS oid, COALESCE(fin_cur(p.currency), @base::text) AS cur, SUM(p.amount::float8) AS paid
         FROM customer_payments p JOIN sel ON sel.id = p.order_id WHERE p.is_deleted = 0 GROUP BY 1, 2
       ),
       cur AS (SELECT oid, cur FROM tot UNION SELECT oid, cur FROM paid),
       ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)
       SELECT o.id, o.client, ${clientId} AS client_id, o.zone, o.agent, o.status, COALESCE(to_char(fin_ts(o.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS created,
              o.delivery, c.cur, t.total, p.paid
       FROM orders o JOIN sel ON sel.id = o.id
       LEFT JOIN ck ON ck.k = fin_key(o.client)
       LEFT JOIN cur c ON c.oid = o.id
       LEFT JOIN tot t ON t.oid = o.id AND t.cur = c.cur
       LEFT JOIN paid p ON p.oid = o.id AND p.cur = c.cur
       ORDER BY o.id DESC, c.cur`,
    )
    .all({ base: cc.base, all: ids === null, ids: ids ?? [] })) as DueRow[]
  const byId = new Map<number, OrderDue>()
  for (const row of rows) {
    let due = byId.get(row.id)
    if (!due) {
      due = {
        id: row.id,
        client: row.client,
        clientId: row.client_id === null ? null : Number(row.client_id),
        zone: row.zone ?? "",
        agent: row.agent ?? "",
        status: row.status ?? "",
        createdAt: row.created,
        delivery: row.delivery ?? "",
        currencies: [],
      }
      byId.set(row.id, due)
    }
    if (row.cur) {
      const total = roundMoney(num(row.total))
      const paid = roundMoney(num(row.paid))
      due.currencies.push({ currency: row.cur, total, paid, remaining: roundMoney(total - paid) })
    }
  }
  return [...byId.values()]
}

/** Due of one order (linked payments only), or null. */
export async function orderDue(db: PgDb, id: number, cc: CurrencyContext): Promise<OrderDue | null> {
  const [due] = await orderDues(db, [id], cc)
  return due ?? null
}

type ScopeRow = { id: number; cid: number | null; counted: boolean; age_day: string }

/** Dues of the given orders (every order when `ids` is null) with the client's
 * other credits allocated FIFO (see the header). Cancelled orders get no share. */
export async function allocatedOrderDues(db: PgDb, ids: number[] | null, cc: CurrencyContext): Promise<AllocatedOrderDue[]> {
  if (ids !== null && !ids.length) return []
  const s = await ensureFinanceSchema(db)
  // The orders the client ledger counts, with the ledger's client (an order of an unknown client has none).
  const counted = (await db
    .prepare(
      `WITH ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1),
       o2 AS (
         SELECT o.id, oc.id AS cid,
                to_char(CASE WHEN ${orderReleasedSql("o")} THEN ${orderRealizationTs(s, "o")} ELSE fin_ts(o.created_at, true) END, 'YYYY-MM-DD') AS age_day
         FROM orders o ${orderClientJoin(s, "o", "oc", "ck")}
         WHERE ${orderCountedSql("o")}
       ),
       req AS (SELECT cid FROM o2 WHERE @all::boolean OR id = ANY(@ids::int[]))
       SELECT o2.id, o2.cid, true AS counted, COALESCE(o2.age_day, '') AS age_day FROM o2
       WHERE @all::boolean OR o2.cid IN (SELECT cid FROM req)`,
    )
    .all({ all: ids === null, ids: ids ?? [] })) as ScopeRow[]
  const countedIds = new Set(counted.map((row) => row.id))
  // Requested orders the ledger does not count (cancelled, unconfirmed, unknown client): linked payments only.
  const extra = ids === null ? [] : ids.filter((id) => !countedIds.has(id))
  const scope = [...counted, ...extra.map((id) => ({ id, cid: null, counted: false, age_day: "" }))]
  if (!scope.length) return []
  const dues = await orderDues(db, scope.map((row) => row.id), cc)
  const dueById = new Map(dues.map((due) => [due.id, due]))
  const clientKeys = [...new Set(scope.filter((row) => row.cid !== null).map((row) => String(row.cid)))]
  const ledger = clientKeys.length ? await getBalanceList("client", { from: todayIso(), to: LEDGER_TO, keys: clientKeys, pageSize: 0 }, db) : { rows: [] }
  const balances = new Map(ledger.rows.map((row) => [row.key, row]))

  type Part = AllocatedOrderDueCurrency
  const parts = new Map<number, Part[]>()
  for (const due of dues) {
    parts.set(
      due.id,
      due.currencies.map((part) => ({
        currency: normCurrency(part.currency, cc.base),
        total: part.total,
        linked: part.paid,
        allocated: 0,
        paid: part.paid,
        remaining: Math.max(0, roundMoney(part.total - part.paid)),
      })),
    )
  }

  // Group the counted orders by client.
  const byClient = new Map<string, ScopeRow[]>()
  for (const row of counted) {
    if (row.cid === null) continue
    const key = String(row.cid)
    const list = byClient.get(key) ?? []
    list.push(row)
    byClient.set(key, list)
  }
  for (const [key, orders] of byClient) {
    orders.sort((a, b) => a.age_day.localeCompare(b.age_day) || a.id - b.id)
    const balance = balances.get(key)
    const codes = new Set<string>()
    for (const order of orders) for (const part of parts.get(order.id) ?? []) codes.add(part.currency)
    for (const code of codes) {
      const list = orders.map((order) => parts.get(order.id)?.find((part) => part.currency === code)).filter((part): part is Part => Boolean(part))
      let positive = 0
      let overflow = 0
      for (const part of list) {
        const rest = part.total - part.linked
        positive += Math.max(0, rest)
        overflow += Math.max(0, -rest)
      }
      let pool = roundMoney(balance ? num(balance.currencies[code]?.end_balance) + positive : overflow)
      if (pool < -EPS) continue
      for (const part of list) {
        if (pool <= EPS) break
        const share = Math.min(part.remaining, pool)
        if (share <= 0) continue
        part.allocated = roundMoney(share)
        part.remaining = roundMoney(part.remaining - share)
        pool = roundMoney(pool - share)
      }
    }
  }

  const wanted = ids === null ? scope.map((row) => row.id) : ids
  const out: AllocatedOrderDue[] = []
  for (const id of [...new Set(wanted)]) {
    const due = dueById.get(id)
    if (!due) continue
    out.push({
      ...due,
      counted: countedIds.has(id),
      currencies: (parts.get(id) ?? []).map((part) => ({
        ...part,
        paid: roundMoney(part.linked + part.allocated),
        remaining: roundMoney(Math.max(0, part.remaining)),
      })),
    })
  }
  return out.sort((a, b) => b.id - a.id)
}

/** Allocated due of one order, or null. */
export async function allocatedOrderDue(db: PgDb, id: number, cc: CurrencyContext): Promise<AllocatedOrderDue | null> {
  const [due] = await allocatedOrderDues(db, [id], cc)
  return due ?? null
}
