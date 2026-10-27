import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { getDb, outsideTransaction, type PgDb } from "@/lib/db"
import { CashError, currencyContext, num } from "@/lib/cash/common"
import { payOrder } from "@/lib/cash/expected-payments"
import { orderDues } from "@/lib/cash/orders"
import { ensureCashSchema } from "@/lib/cash/schema"
import type { CashWriteResult } from "@/lib/cash/types"
import { docDateCheck, docYearOk } from "@/lib/document-dates"
import { MAX_MONEY } from "@/lib/finance/api"
import type { CurrencyContext } from "@/lib/finance/context"
import { currencyLabel, normCurrency, roundMoney } from "@/lib/finance/currency"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { innKey, nameKey, placeName } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { orderClientJoin, orderCountedSql, orderRealizationTs } from "@/lib/finance/sources"
import { getClientBalanceOptions } from "@/lib/finance-client-balance"
import {
  DEBT_BUCKETS,
  DEFAULT_ORDER_DEBT_CONFIG,
  EMPTY_ORDER_DEBT_FILTERS,
  ORDER_DEBT_ARRAY_FILTERS,
  ORDER_DEBT_STATUSES,
  ORDER_DEBT_TEXT_FILTERS,
  bucketOf,
  emptyBuckets,
  type BucketAmounts,
  type DebtBucket,
  type OrderDebtClientDetail,
  type OrderDebtClientInfo,
  type OrderDebtClientRow,
  type OrderDebtConfig,
  type OrderDebtDetailLine,
  type OrderDebtFilters,
  type OrderDebtListResult,
  type OrderDebtOptions,
  type OrderDebtOrderDetail,
  type OrderDebtOrderRow,
  type OrderDebtQuery,
  type OrderDebtStats,
} from "@/lib/finance-order-debts-types"
import { dbId, strictNum } from "@/lib/strict-number"
import { invalidFieldResponse } from "@/lib/validation"

// "Долги с заказов" (demo #/statistics/debtors): debt aging of order remainders.
//
// Remainder of an order (per currency) = order total − payments linked to it
// (customer_payments.order_id, lib/cash/orders.ts orderDues, the same numbers as
// "Ожидаемые оплаты") − its FIFO share of the client's other credits. The other
// credits ("pool") are derived from the client ledger (lib/finance, "created"
// mode, all time): pool = end balance + Σ positive linked remainders, i.e. the
// client's unlinked payments of every source, opening balance, corrections and
// linked overpayments. The pool pays the oldest orders first (age date, then id),
// so Σ remainders of a client = its ledger debt. A negative pool = debt the
// orders cannot explain (opening debt, minus corrections): the client is
// flagged "Требуется перерасчет" and excluded from the totals until a
// recalculation attributes that debt to a date (order_debt_recalcs).
//
// Orders: every order the client ledger counts (not Отменен / Не подтвержден),
// matched to the client exactly like the ledger (orders.client_id, by name for
// legacy rows); orders of a client that does not exist are not listed.
// Age of an order = days since its realization date (В пути / Доставлено:
// shipped_at, else the planned delivery day capped by updated_at, else
// created_at — the ledger's realization rule, orderRealizationTs) or since
// creation for orders not released yet. Buckets: ≤ p1, ≤ p2, ≤ p3, > p3
// with the periods of order_debt_settings (default 7 / 30 / 120).

const SCHEMA_VERSION = 1

const DDL = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_date TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_man TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS order_debt_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_debt_recalcs (
  client_id INTEGER PRIMARY KEY,
  from_date TEXT NOT NULL,
  recalculated_by TEXT NOT NULL DEFAULT '',
  recalculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

declare global {
  var __linkoOrderDebtsSchema: { version: number; ready: Promise<void> } | undefined
}

async function ensureSchema(db: PgDb = getDb()): Promise<void> {
  await ensureCashSchema(db)
  if (globalThis.__linkoOrderDebtsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => getDb().exec(DDL)).catch((error: unknown) => {
      globalThis.__linkoOrderDebtsSchema = undefined
      throw error
    })
    globalThis.__linkoOrderDebtsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoOrderDebtsSchema!.ready
}

const EPS = 0.005
const LEDGER_TO = "2100-12-31"
const MAX_ROWS = 20000

// --- settings ------------------------------------------------------------------------------

const CONFIG_KEYS: Array<keyof OrderDebtConfig> = ["firstDebtPeriod", "secondDebtPeriod", "thirdDebtPeriod"]

async function readConfig(db: PgDb): Promise<OrderDebtConfig> {
  const rows = (await db.prepare("SELECT key, value FROM order_debt_settings").all()) as Array<{ key: string; value: string }>
  const config = { ...DEFAULT_ORDER_DEBT_CONFIG }
  for (const row of rows) {
    const value = Number(row.value)
    if (CONFIG_KEYS.includes(row.key as keyof OrderDebtConfig) && Number.isInteger(value) && value > 0) config[row.key as keyof OrderDebtConfig] = value
  }
  // A broken stored triple falls back to the defaults (the buckets need p1 < p2 < p3).
  return config.firstDebtPeriod < config.secondDebtPeriod && config.secondDebtPeriod < config.thirdDebtPeriod ? config : { ...DEFAULT_ORDER_DEBT_CONFIG }
}

export async function getOrderDebtConfig(): Promise<OrderDebtConfig> {
  const db = getDb()
  await ensureSchema(db)
  return readConfig(db)
}

/** "Настроить период" (demo set_period_config). */
export async function setOrderDebtConfig(input: OrderDebtConfig, user: string): Promise<OrderDebtConfig> {
  const db = getDb()
  await ensureSchema(db)
  if (!(input.firstDebtPeriod < input.secondDebtPeriod && input.secondDebtPeriod < input.thirdDebtPeriod)) {
    throw new CashError("Периоды должны возрастать: первый < второй < третий", 400, "secondDebtPeriod")
  }
  for (const key of CONFIG_KEYS) {
    await db
      .prepare(
        `INSERT INTO order_debt_settings (key, value, updated_by, updated_at) VALUES (@key, @value, @user, datetime('now'))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
         RETURNING key`,
      )
      .run({ key, value: String(input[key]), user })
  }
  return readConfig(db)
}

// --- model ---------------------------------------------------------------------------------

type OrderMeta = {
  id: number
  clientName: string
  clientKey: string
  clientId: number | null
  zone: string
  agent: string
  deliveryMan: string
  organization: string
  paymentType: "cash" | "bank"
  status: string
  product: string
  delivery: string
  createdAt: string
  createdDay: string
  realizationDay: string
  deliveryDay: string
  paymentDay: string
  passedDays: number
  bucket: DebtBucket
}

type Part = { currency: string; total: number; paid: number; allocated: number; remaining: number }

type UnexplainedLine = { currency: string; date: string; passedDays: number; bucket: DebtBucket; remaining: number }

type ClientState = {
  info: OrderDebtClientInfo
  deliverer: string
  code: string
  inn: string
  lastPayment: string | null
  orders: OrderMeta[]
  parts: Map<number, Part[]>
  unexplained: Record<string, number>
  recalc: { fromDate: string; recalculatedAt: string; recalculatedBy: string } | null
  /** Recalculated unexplained debt, aged from the recalculation date. */
  lines: UnexplainedLine[]
  wrong: boolean
  /** Whole order debt of the client per currency (all buckets, no filters). */
  debt: Record<string, number>
}

type Model = { cc: CurrencyContext; config: OrderDebtConfig; today: string; clients: Map<string, ClientState>; orders: Map<number, OrderMeta> }

type OrderSqlRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  agent: string
  delivery_man: string
  organization: string
  payment_type: string
  status: string
  product: string
  delivery: string
  created: string | null
  delivery_day: string | null
  realization_day: string | null
  payment_day: string | null
}

type ClientSqlRow = {
  id: number
  name: string
  phone: string | null
  address: string | null
  landmark: string | null
  type: string | null
  zone: string | null
  agent: string | null
  deliverer: string | null
  branch: string | null
  code: string | null
  inn: string | null
  created: string | null
}

function daysBetween(day: string, today: string): number {
  if (!day) return 0
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000))
}

const RELEASED = new Set(["в пути", "доставлено"])

async function buildModel(db: PgDb): Promise<Model> {
  await ensureSchema(db)
  const s = await ensureFinanceSchema(db)
  const [cc, config] = await Promise.all([currencyContext(db), readConfig(db)])
  const today = todayIso()
  // Same orders and the same client resolution as the client ledger
  // (lib/finance/sources.ts): counted statuses only, the client by
  // orders.client_id (by name for legacy rows), orders of a client that does
  // not exist are left out — so Σ order debts = Σ client debts.
  const [orderRows, clientRows, recalcRows, ledger] = await Promise.all([
    db
      .prepare(
        `WITH ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)
         SELECT o.id, o.client, oc.id AS client_id, fin_place(o.zone) AS zone, fin_place(o.agent) AS agent,
                fin_place(o.delivery_man) AS delivery_man, fin_place(o.organization) AS organization,
                COALESCE(NULLIF(fin_pt(o.payment_type), ''), 'cash') AS payment_type, o.status, COALESCE(o.product, '') AS product,
                COALESCE(o.delivery, '') AS delivery,
                to_char(fin_ts(o.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') AS created,
                to_char(fin_ts(o.delivery), 'YYYY-MM-DD') AS delivery_day,
                to_char(${orderRealizationTs(s, "o")}, 'YYYY-MM-DD') AS realization_day,
                to_char(fin_ts(NULLIF(o.payment_date, '')), 'YYYY-MM-DD') AS payment_day
         FROM orders o ${orderClientJoin(s, "o", "oc", "ck")}
         WHERE ${orderCountedSql("o")}`,
      )
      .all() as Promise<OrderSqlRow[]>,
    db
      .prepare(
        `SELECT id, name, phone, address, landmark, type, zone, agent, deliverer, branch, code, inn,
                to_char(fin_ts(created_at, true), 'YYYY-MM-DD') AS created
         FROM clients`,
      )
      .all() as Promise<ClientSqlRow[]>,
    db.prepare("SELECT client_id, from_date, recalculated_by, recalculated_at FROM order_debt_recalcs").all() as Promise<
      Array<{ client_id: number; from_date: string; recalculated_by: string; recalculated_at: string }>
    >,
    getBalanceList("client", { from: today, to: LEDGER_TO, pageSize: 0 }, db),
  ])

  const recalcs = new Map(recalcRows.map((row) => [Number(row.client_id), row]))
  const balances = new Map(ledger.rows.map((row) => [row.key, row]))
  const clients = new Map<string, ClientState>()
  const newClient = (info: OrderDebtClientInfo, extra: Partial<ClientState> = {}): ClientState => ({
    info,
    deliverer: "",
    code: "",
    inn: "",
    lastPayment: null,
    orders: [],
    parts: new Map(),
    unexplained: {},
    recalc: null,
    lines: [],
    wrong: false,
    debt: {},
    ...extra,
  })
  for (const row of clientRows) {
    const key = String(row.id)
    const recalc = recalcs.get(row.id)
    clients.set(
      key,
      newClient(
        {
          key,
          id: row.id,
          name: row.name ?? "",
          phone: row.phone ?? "",
          address: placeName(row.address),
          guide: placeName(row.landmark),
          agent: placeName(row.agent),
          type: placeName(row.type),
          zone: placeName(row.zone),
          branch: placeName(row.branch),
        },
        {
          deliverer: placeName(row.deliverer),
          code: row.code ?? "",
          inn: row.inn ?? "",
          lastPayment: (balances.get(key)?.info.last_payment as string | null | undefined) ?? null,
          recalc: recalc ? { fromDate: recalc.from_date, recalculatedAt: recalc.recalculated_at, recalculatedBy: recalc.recalculated_by } : null,
        },
      ),
    )
  }

  const orders = new Map<number, OrderMeta>()
  for (const row of orderRows) {
    const clientId = Number(row.client_id)
    const clientKey = String(clientId)
    const client = clients.get(clientKey)
    if (!client) continue
    const createdAt = row.created ?? ""
    const createdDay = createdAt.slice(0, 10)
    const released = RELEASED.has(nameKey(row.status))
    const realizationDay = released ? (row.realization_day ?? createdDay) : ""
    const passedDays = daysBetween(realizationDay || createdDay || today, today)
    const meta: OrderMeta = {
      id: Number(row.id),
      clientName: row.client ?? "",
      clientKey,
      clientId,
      zone: row.zone ?? "",
      agent: row.agent ?? "",
      deliveryMan: row.delivery_man || client.deliverer,
      organization: row.organization ?? "",
      paymentType: row.payment_type === "bank" ? "bank" : "cash",
      status: row.status ?? "",
      product: row.product ?? "",
      delivery: row.delivery ?? "",
      createdAt,
      createdDay,
      realizationDay,
      deliveryDay: row.delivery_day ?? "",
      paymentDay: row.payment_day ?? "",
      passedDays,
      bucket: bucketOf(passedDays, config),
    }
    orders.set(meta.id, meta)
    client.orders.push(meta)
  }

  // Totals and linked payments per order × currency (the cash core's numbers).
  const dues = orders.size ? await orderDues(db, [...orders.keys()], cc) : []
  for (const due of dues) {
    const meta = orders.get(due.id)
    if (!meta) continue
    clients.get(meta.clientKey)!.parts.set(
      due.id,
      due.currencies.map((part) => ({ currency: normCurrency(part.currency, cc.base), total: part.total, paid: part.paid, allocated: 0, remaining: 0 })),
    )
  }

  for (const client of clients.values()) {
    // Oldest first: the pool pays the oldest orders.
    client.orders.sort((a, b) => (a.realizationDay || a.createdDay).localeCompare(b.realizationDay || b.createdDay) || a.id - b.id)
    const balance = balances.get(client.info.key)
    const codes = new Set<string>()
    for (const parts of client.parts.values()) for (const part of parts) codes.add(part.currency)
    if (balance) for (const [code, value] of Object.entries(balance.currencies)) if (Math.abs(value.end_balance) > EPS) codes.add(code)
    for (const code of codes) {
      const parts = client.orders.map((order) => client.parts.get(order.id)?.find((part) => part.currency === code)).filter((part): part is Part => Boolean(part))
      let positive = 0
      let overflow = 0
      for (const part of parts) {
        const rest = part.total - part.paid
        part.remaining = Math.max(0, rest)
        positive += part.remaining
        overflow += Math.max(0, -rest)
      }
      let pool = balance ? (balance.currencies[code]?.end_balance ?? 0) + positive : overflow
      pool = roundMoney(pool)
      if (pool < -EPS) {
        client.unexplained[code] = roundMoney(-pool)
        continue
      }
      for (const part of parts) {
        if (pool <= EPS) break
        const share = Math.min(part.remaining, pool)
        part.allocated = roundMoney(share)
        part.remaining = roundMoney(part.remaining - share)
        pool = roundMoney(pool - share)
      }
    }
    for (const parts of client.parts.values()) for (const part of parts) part.remaining = roundMoney(part.remaining)

    const unexplainedCodes = Object.keys(client.unexplained)
    if (unexplainedCodes.length) {
      if (client.recalc && client.info.id !== null) {
        const passedDays = daysBetween(client.recalc.fromDate, today)
        client.lines = unexplainedCodes.map((currency) => ({
          currency,
          date: client.recalc!.fromDate,
          passedDays,
          bucket: bucketOf(passedDays, config),
          remaining: client.unexplained[currency],
        }))
      } else client.wrong = true
    }
    for (const parts of client.parts.values()) for (const part of parts) if (part.remaining > EPS) client.debt[part.currency] = (client.debt[part.currency] ?? 0) + part.remaining
    for (const line of client.lines) client.debt[line.currency] = (client.debt[line.currency] ?? 0) + line.remaining
    for (const code of Object.keys(client.debt)) client.debt[code] = roundMoney(client.debt[code])
  }
  return { cc, config, today, clients, orders }
}

// --- filtering -----------------------------------------------------------------------------

const keyList = (values: string[]) => [...new Set(values.map((value) => nameKey(placeName(value))).filter(Boolean))]

function intOrUndefined(value: string): number | undefined {
  if (value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

function inRange(value: number | null, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true
  if (value === null) return max === undefined
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function dayIn(day: string, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!day) return false
  return (!from || day >= from) && (!to || day <= to)
}

function clientText(client: ClientState): string {
  const { info } = client
  return [info.name, info.phone, client.code, client.inn, innKey(client.inn)].map(nameKey).join(" ")
}

/** Client-level filters (attributes of the client card). */
function clientFilter(filters: OrderDebtFilters, today: string) {
  const branches = keyList(filters.branch)
  const types = [...new Set(filters.marketTypeParent.map((value) => nameKey(placeName(value))))]
  const zones = keyList(filters.zone)
  const minDays = intOrUndefined(filters.minPaymentDays)
  const maxDays = intOrUndefined(filters.paymentDays)
  return (client: ClientState): boolean => {
    if (branches.length && !branches.includes(nameKey(client.info.branch))) return false
    if (filters.marketTypeParent.length && !types.includes(nameKey(client.info.type))) return false
    if (zones.length && !zones.includes(nameKey(client.info.zone))) return false
    if (minDays !== undefined || maxDays !== undefined) {
      const days = client.lastPayment ? daysBetween(client.lastPayment, today) : null
      if (!inRange(days, minDays, maxDays)) return false
    }
    return true
  }
}

function orderFiltersActive(filters: OrderDebtFilters): boolean {
  return Boolean(
    filters.division.length ||
      filters.user.length ||
      filters.deliveryMan.length ||
      filters.status.length ||
      filters.paymentType ||
      filters.createdFromDate ||
      filters.createdToDate ||
      filters.deliveryFromDate ||
      filters.deliveryToDate ||
      filters.paymentFromDate ||
      filters.paymentToDate ||
      filters.acceptedFromDate ||
      filters.acceptedToDate,
  )
}

/** Order-level filters (attributes of the order). */
function orderFilter(filters: OrderDebtFilters) {
  const divisions = keyList(filters.division)
  const users = keyList(filters.user)
  const deliveryMen = keyList(filters.deliveryMan)
  const statuses = keyList(filters.status)
  return (order: OrderMeta): boolean => {
    if (divisions.length && !divisions.includes(nameKey(order.organization))) return false
    if (users.length && !users.includes(nameKey(order.agent))) return false
    if (deliveryMen.length && !deliveryMen.includes(nameKey(order.deliveryMan))) return false
    if (statuses.length && !statuses.includes(nameKey(order.status))) return false
    if (filters.paymentType && order.paymentType !== filters.paymentType) return false
    if (!dayIn(order.createdDay, filters.createdFromDate, filters.createdToDate)) return false
    if (!dayIn(order.deliveryDay, filters.deliveryFromDate, filters.deliveryToDate)) return false
    if (!dayIn(order.paymentDay, filters.paymentFromDate, filters.paymentToDate)) return false
    if (!dayIn(order.realizationDay, filters.acceptedFromDate, filters.acceptedToDate)) return false
    return true
  }
}

function orderRow(order: OrderMeta, part: Part, client: ClientState): OrderDebtOrderRow {
  return {
    key: `${order.id}-${part.currency}`,
    orderId: order.id,
    currency: part.currency,
    client: { key: client.info.key, id: client.info.id, name: client.info.id !== null ? client.info.name : order.clientName },
    status: order.status,
    agent: order.agent,
    deliveryMan: order.deliveryMan,
    organization: order.organization,
    paymentType: order.paymentType,
    createdAt: order.createdAt,
    realizationDate: order.realizationDay,
    deliveryDate: order.deliveryDay,
    paymentDate: order.paymentDay,
    passedDays: order.passedDays,
    bucket: order.bucket,
    total: part.total,
    paid: part.paid,
    allocated: part.allocated,
    remaining: part.remaining,
    wrongDebt: client.wrong,
    clientDebt: client.debt,
  }
}

type Selection = {
  /** Debt order parts (remaining > 0) after all filters. */
  rows: Array<{ client: ClientState; order: OrderMeta; part: Part }>
  /** Recalculated unexplained debt lines after all filters. */
  lines: Array<{ client: ClientState; line: UnexplainedLine }>
  /** Clients after the client-level filters and the search (wrong-debt counter). */
  clients: ClientState[]
}

function select(model: Model, query: OrderDebtQuery): Selection {
  const passClient = clientFilter(query, model.today)
  const passOrder = orderFilter(query)
  const withLines = !orderFiltersActive(query)
  const search = nameKey(query.search)
  const searchId = query.tab === "order" && /^\d{1,9}$/.test(search) ? Number(search) : 0

  let clients = [...model.clients.values()].filter(passClient)
  if (query.withWrongDebt) clients = clients.filter((client) => client.wrong)
  const textHit = (client: ClientState) => !search || clientText(client).includes(search)

  let rows: Selection["rows"] = []
  let lines: Selection["lines"] = []
  for (const client of clients) {
    const clientHit = textHit(client)
    for (const order of client.orders) {
      if (!passOrder(order)) continue
      if (!clientHit && order.id !== searchId) continue
      for (const part of client.parts.get(order.id) ?? []) if (part.remaining > EPS) rows.push({ client, order, part })
    }
    if (withLines && clientHit) for (const line of client.lines) lines.push({ client, line })
  }
  const bucket = query.marketDebtType
  if (bucket) {
    if (query.tab === "order") {
      rows = rows.filter((row) => row.order.bucket === bucket)
      lines = lines.filter((item) => item.line.bucket === bucket)
    } else {
      // "Есть задолженность за период": clients with a debt in that bucket (all their buckets stay).
      const keys = new Set([...rows.filter((row) => row.order.bucket === bucket).map((row) => row.client.info.key), ...lines.filter((item) => item.line.bucket === bucket).map((item) => item.client.info.key)])
      rows = rows.filter((row) => keys.has(row.client.info.key))
      lines = lines.filter((item) => keys.has(item.client.info.key))
    }
  }
  const searched = clients.filter((client) => textHit(client) || (searchId > 0 && client.orders.some((order) => order.id === searchId)))
  return { rows, lines, clients: searched }
}

function statsOf(model: Model, selection: Selection): OrderDebtStats {
  const amounts: Record<string, BucketAmounts> = {}
  const debtors: Record<DebtBucket, Set<number>> = { first: new Set(), second: new Set(), third: new Set(), fourth: new Set() }
  const expect: Record<DebtBucket, Set<number>> = { first: new Set(), second: new Set(), third: new Set(), fourth: new Set() }
  const add = (currency: string, bucket: DebtBucket, value: number) => {
    const item = (amounts[currency] ??= emptyBuckets())
    item[bucket] += value
    item.total += value
  }
  for (const { client, order, part } of selection.rows) {
    if (client.wrong) continue
    add(part.currency, order.bucket, part.remaining)
    debtors[order.bucket].add(order.id)
    if (order.paymentDay && order.paymentDay >= model.today) expect[order.bucket].add(order.id)
  }
  for (const { client, line } of selection.lines) if (!client.wrong) add(line.currency, line.bucket, line.remaining)
  for (const item of Object.values(amounts)) for (const key of Object.keys(item) as Array<keyof BucketAmounts>) item[key] = roundMoney(item[key])
  const wrong = selection.clients.filter((client) => client.wrong && client.info.id !== null)
  const count = (sets: Record<DebtBucket, Set<number>>) => Object.fromEntries(DEBT_BUCKETS.map((bucket) => [bucket, sets[bucket].size])) as Record<DebtBucket, number>
  return {
    config: model.config,
    today: model.today,
    amounts,
    debtors: count(debtors),
    expect: count(expect),
    wrongDebtClientCount: wrong.length,
    wrongDebtClientIds: wrong.map((client) => client.info.id!),
  }
}

function clientRows(selection: Selection, withWrong: boolean): OrderDebtClientRow[] {
  const byKey = new Map<string, OrderDebtClientRow>()
  const ensure = (client: ClientState) => {
    let row = byKey.get(client.info.key)
    if (!row) byKey.set(client.info.key, (row = { ...client.info, wrongDebt: client.wrong, orders: 0, currencies: {} }))
    return row
  }
  const seen = new Set<number>()
  for (const { client, order, part } of selection.rows) {
    const row = ensure(client)
    const item = (row.currencies[part.currency] ??= emptyBuckets())
    item[order.bucket] += part.remaining
    item.total += part.remaining
    if (!seen.has(order.id)) {
      seen.add(order.id)
      row.orders += 1
    }
  }
  for (const { client, line } of selection.lines) {
    const item = (ensure(client).currencies[line.currency] ??= emptyBuckets())
    item[line.bucket] += line.remaining
    item.total += line.remaining
  }
  // "Требуется перерасчет" lists the flagged clients even when no order part is left.
  if (withWrong) for (const client of selection.clients) if (client.wrong) ensure(client)
  for (const row of byKey.values()) for (const item of Object.values(row.currencies)) for (const key of Object.keys(item) as Array<keyof BucketAmounts>) item[key] = roundMoney(item[key])
  return [...byKey.values()]
}

// --- ordering ------------------------------------------------------------------------------

type Comparable = string | number

function compare(a: Comparable, b: Comparable): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  const x = String(a)
  const y = String(b)
  // Empty text goes last in both directions.
  if (!x && y) return Number.POSITIVE_INFINITY
  if (x && !y) return Number.NEGATIVE_INFINITY
  return x.localeCompare(y, "ru")
}

function sortRows<R>(rows: R[], ordering: string, value: (row: R, field: string) => Comparable, tie: (a: R, b: R) => number): R[] {
  const desc = ordering.startsWith("-")
  const field = ordering.replace(/^-/, "")
  return [...rows].sort((a, b) => {
    const cmp = compare(value(a, field), value(b, field))
    if (!Number.isFinite(cmp)) return cmp > 0 ? 1 : -1
    return (desc ? -cmp : cmp) || tie(a, b)
  })
}

function clientValue(row: OrderDebtClientRow, field: string): Comparable {
  const [name, code] = field.split(".")
  if (code) return row.currencies[code]?.[name as keyof BucketAmounts] ?? 0
  if (name === "phone" || name === "address" || name === "guide" || name === "agent" || name === "type") return nameKey(row[name])
  return nameKey(row.name)
}

function orderValue(row: OrderDebtOrderRow, field: string): Comparable {
  const [name, code] = field.split(".")
  switch (name) {
    case "client":
      return nameKey(row.client.name)
    case "passed_days":
      return row.passedDays
    case "total":
      return row.total
    case "remaining":
      return row.remaining
    case "payment_date":
      return row.paymentDate
    case "agent":
      return nameKey(row.agent)
    case "client_debt":
      return row.clientDebt[code] ?? 0
    case "delivery_man":
      return nameKey(row.deliveryMan)
    case "realization":
      return row.realizationDate
    case "delivery":
      return row.deliveryDate
    case "created":
      return row.createdAt
    default:
      return row.orderId
  }
}

function paginate<R>(rows: R[], page: number, pageSize: number) {
  const size = pageSize === 0 ? 0 : Math.min(MAX_ROWS, Math.max(1, Math.floor(pageSize)))
  const current = Math.max(1, Math.floor(page || 1))
  return { page: current, pageSize: size, rows: size ? rows.slice((current - 1) * size, current * size) : rows.slice(0, MAX_ROWS) }
}

/** GET /api/order-debts — cards (stats) + one page of the clients or orders tab. */
export async function listOrderDebts(query: OrderDebtQuery): Promise<OrderDebtListResult> {
  const model = await buildModel(getDb())
  const selection = select(model, query)
  const stats = statsOf(model, selection)
  const currencies = model.cc.currencies.map((currency) => ({ code: currency.code, label: currency.label }))
  for (const code of Object.keys(stats.amounts)) if (!currencies.some((currency) => currency.code === code)) currencies.push({ code, label: currencyLabel(code) })
  const base = { tab: query.tab, baseCurrency: model.cc.base, currencies, stats }
  if (query.tab === "order") {
    const rows = sortRows(
      selection.rows.map(({ client, order, part }) => orderRow(order, part, client)),
      query.ordering || "-id",
      orderValue,
      (a, b) => b.orderId - a.orderId || a.currency.localeCompare(b.currency),
    )
    const paged = paginate(rows, query.page, query.pageSize)
    return { ...base, count: rows.length, page: paged.page, pageSize: paged.pageSize, clients: [], orders: paged.rows }
  }
  const rows = sortRows(clientRows(selection, query.withWrongDebt), query.ordering || "name", clientValue, (a, b) => nameKey(a.name).localeCompare(nameKey(b.name), "ru") || a.key.localeCompare(b.key))
  const paged = paginate(rows, query.page, query.pageSize)
  return { ...base, count: rows.length, page: paged.page, pageSize: paged.pageSize, clients: paged.rows, orders: [] }
}

/** GET /api/order-debts/clients/[key] — the client drill-down (all its debt orders). */
export async function getClientDebtDetail(key: string, params: { debtType?: DebtBucket | ""; page?: number; pageSize?: number }): Promise<OrderDebtClientDetail | null> {
  const model = await buildModel(getDb())
  const client = model.clients.get(key)
  if (!client) return null
  const lines: OrderDebtDetailLine[] = []
  const orders = [...client.orders].sort((a, b) => b.id - a.id)
  for (const order of orders) {
    if (params.debtType && order.bucket !== params.debtType) continue
    for (const part of client.parts.get(order.id) ?? []) if (part.remaining > EPS) lines.push({ kind: "order", ...orderRow(order, part, client) })
  }
  for (const line of client.lines) {
    if (params.debtType && line.bucket !== params.debtType) continue
    lines.push({ kind: "unexplained", key: `unexplained-${line.currency}`, ...line })
  }
  const row = clientRows({ rows: client.orders.flatMap((order) => (client.parts.get(order.id) ?? []).filter((part) => part.remaining > EPS).map((part) => ({ client, order, part }))), lines: client.lines.map((line) => ({ client, line })), clients: [client] }, true)[0]
  const paged = paginate(lines, params.page ?? 1, params.pageSize ?? 25)
  return {
    client: row ?? { ...client.info, wrongDebt: client.wrong, orders: 0, currencies: {} },
    config: model.config,
    today: model.today,
    unexplained: client.unexplained,
    recalc: client.recalc,
    count: lines.length,
    page: paged.page,
    pageSize: paged.pageSize,
    lines: paged.rows,
  }
}

/** GET /api/order-debts/orders/[id] — the order dialog (header, parts, items). */
export async function getOrderDebtDetail(orderId: number): Promise<OrderDebtOrderDetail | null> {
  const db = getDb()
  const model = await buildModel(db)
  const order = model.orders.get(orderId)
  if (!order) return null
  const client = model.clients.get(order.clientKey)!
  const parts = client.parts.get(orderId) ?? []
  const first = parts[0] ?? { currency: model.cc.base, total: 0, paid: 0, allocated: 0, remaining: 0 }
  const hasItems = ((await db.prepare("SELECT to_regclass('order_items') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  const items = hasItems
    ? ((await db
        .prepare(
          `SELECT id, product_name, unit, quantity::float8 AS quantity, unit_price::float8 AS price, COALESCE(discount_percent, 0)::float8 AS discount,
                  COALESCE(fin_cur(currency), @base::text) AS currency
           FROM order_items WHERE order_id = @id ORDER BY id`,
        )
        .all({ id: orderId, base: model.cc.base })) as Array<{ id: number; product_name: string; unit: string; quantity: number; price: number; discount: number; currency: string }>)
    : []
  return {
    order: { ...orderRow(order, first, client), zone: order.zone || client.info.zone, delivery: order.delivery, product: order.product },
    parts: parts.map((part) => ({ ...part })),
    items: items.map((item) => {
      const quantity = num(item.quantity)
      const price = num(item.price)
      const discount = num(item.discount)
      return {
        id: Number(item.id),
        name: item.product_name ?? "",
        unit: item.unit ?? "",
        quantity,
        price,
        discount,
        currency: item.currency,
        amount: roundMoney(quantity * price * (1 - discount / 100)),
      }
    }),
  }
}

// --- writes --------------------------------------------------------------------------------

/** "Пересчитать" (demo recalc_wrong_debt): attributes the debt the orders cannot explain
 * to a date — one client (`clientId`, optional `fromDate`) or every flagged client
 * (default date: the client's creation day, when its opening balance is dated). */
export async function recalcOrderDebts(input: { clientId?: number; fromDate?: string }, user: string): Promise<{ recalculated: number; wrongDebtClientCount: number }> {
  const db = getDb()
  const model = await buildModel(db)
  const targets = [...model.clients.values()].filter((client) => client.info.id !== null && (input.clientId ? client.info.id === input.clientId : client.wrong))
  if (input.clientId && !targets.length) throw new CashError("Клиент не найден", 404, "client")
  const created = new Map(
    ((await db.prepare("SELECT id, to_char(fin_ts(created_at, true), 'YYYY-MM-DD') AS day FROM clients WHERE id = ANY(@ids::int[])").all({ ids: targets.map((client) => client.info.id) })) as Array<{
      id: number
      day: string | null
    }>).map((row) => [Number(row.id), row.day]),
  )
  let recalculated = 0
  for (const client of targets) {
    // Nothing to attribute: the client's orders explain its whole debt.
    if (!Object.keys(client.unexplained).length) continue
    const fromDate = input.fromDate || created.get(client.info.id!) || model.today
    await db
      .prepare(
        `INSERT INTO order_debt_recalcs (client_id, from_date, recalculated_by, recalculated_at) VALUES (@id, @fromDate, @user, datetime('now'))
         ON CONFLICT (client_id) DO UPDATE SET from_date = EXCLUDED.from_date, recalculated_by = EXCLUDED.recalculated_by, recalculated_at = EXCLUDED.recalculated_at
         RETURNING client_id`,
      )
      .run({ id: client.info.id, fromDate, user })
    recalculated += 1
  }
  const after = [...(await buildModel(db)).clients.values()].filter((client) => client.wrong && client.info.id !== null).length
  return { recalculated, wrongDebtClientCount: after }
}

/** "Изменение даты оплаты" (demo order bulk_update {order_list, payment_date}). */
export async function updateOrderPaymentDates(orderIds: number[], paymentDate: string): Promise<{ updated: number }> {
  const db = getDb()
  await ensureSchema(db)
  const ids = [...new Set(orderIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) throw new CashError("Выберите хотя бы один заказ", 400, "orderIds")
  const result = await db.prepare(`UPDATE orders o SET payment_date = @day WHERE o.id = ANY(@ids::int[]) AND ${orderCountedSql("o")}`).run({ day: paymentDate, ids })
  return { updated: result.changes }
}

export type OrderGroupPaymentInput = z.infer<typeof orderGroupPaymentSchema>

/** "Групповая оплата" of the selected orders (demo finance/group_payment): one order
 * payment per row through the cash core (POST /api/cash/orders/[id]/pay rules). Rows
 * are validated first; a row that fails later is reported, the saved ones stay. */
export async function payOrdersGroup(input: OrderGroupPaymentInput, user: string): Promise<{ results: Array<CashWriteResult & { orderId: number }>; failed: Array<{ orderId: number; error: string }> }> {
  const db = getDb()
  await ensureSchema(db)
  const items = input.items.filter((item) => item.amount > 0)
  if (!items.length) throw new CashError("Укажите сумму", 400, "amount")
  const known = new Set(
    ((await db.prepare(`SELECT o.id FROM orders o WHERE o.id = ANY(@ids::int[]) AND ${orderCountedSql("o")}`).all({ ids: items.map((item) => item.orderId) })) as Array<{ id: number }>).map((row) =>
      Number(row.id),
    ),
  )
  const missing = items.find((item) => !known.has(item.orderId))
  if (missing) throw new CashError(`Заказ не найден: № ${missing.orderId}`, 404, "orderId")
  const results: Array<CashWriteResult & { orderId: number }> = []
  const failed: Array<{ orderId: number; error: string }> = []
  for (const item of items) {
    try {
      const result = await payOrder(
        item.orderId,
        {
          cashboxId: input.cashboxId,
          date: input.date,
          branch: input.branch,
          categoryId: input.categoryId,
          responsibleId: input.responsibleId,
          isVerified: input.isVerified,
          amount: item.amount,
          comment: item.comment || input.comment,
          debtCurrency: item.currency,
          rateType: "current",
        },
        user,
      )
      results.push({ ...result, orderId: item.orderId })
    } catch (error) {
      if (!(error instanceof CashError)) throw error
      failed.push({ orderId: item.orderId, error: error.message })
    }
  }
  if (!results.length && failed.length) throw new CashError(failed[0].error, 400)
  return { results, failed }
}

/** GET /api/order-debts/options — values of the filter form. */
export async function getOrderDebtOptions(): Promise<OrderDebtOptions> {
  const db = getDb()
  await ensureSchema(db)
  const [base, rows] = await Promise.all([
    getClientBalanceOptions(db),
    db.prepare(`SELECT DISTINCT o.agent, o.delivery_man, o.organization, o.status, o.zone FROM orders o WHERE ${orderCountedSql("o")}`).all() as Promise<
      Array<{ agent: string; delivery_man: string; organization: string; status: string; zone: string }>
    >,
  ])
  const unique = (values: unknown[]) => {
    const seen = new Map<string, string>()
    for (const value of values) {
      const name = placeName(value)
      if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  return {
    branches: base.branches,
    organizations: unique([...base.organizations, ...rows.map((row) => row.organization)]),
    users: unique(rows.map((row) => row.agent)),
    deliveryMen: unique([...base.deliverers, ...rows.map((row) => row.delivery_man)]),
    clientTypes: base.types,
    untyped: base.untyped,
    zones: unique([...base.zones, ...rows.map((row) => row.zone)]),
    statuses: [...new Set<string>([...ORDER_DEBT_STATUSES, ...unique(rows.map((row) => row.status))])],
  }
}

// --- HTTP parsing --------------------------------------------------------------------------

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint: string) {
  return invalidFieldResponse(name, hint)
}

type DateFilterName = Extract<(typeof ORDER_DEBT_TEXT_FILTERS)[number], `${string}Date`>
const DATE_FILTERS = ORDER_DEBT_TEXT_FILTERS.filter((name): name is DateFilterName => name.endsWith("Date"))

/** Query of GET /api/order-debts (names = the page URL; arrays as repeated params or "a-b" ids). */
export function parseOrderDebtQuery(url: string): Parsed<OrderDebtQuery> {
  const search = new URL(url).searchParams
  const filters: OrderDebtFilters = { ...EMPTY_ORDER_DEBT_FILTERS }
  for (const name of ORDER_DEBT_ARRAY_FILTERS) {
    filters[name] = search
      .getAll(name)
      .map((value) => value.trim())
      .filter(Boolean)
  }
  for (const name of DATE_FILTERS) {
    const value = search.get(name)?.trim() ?? ""
    if (value && !isIsoDay(value)) return { error: bad(name, "YYYY-MM-DD") }
    filters[name] = value
  }
  const paymentType = search.get("paymentType") ?? ""
  if (!["", "cash", "bank"].includes(paymentType)) return { error: bad("paymentType", "cash | bank") }
  filters.paymentType = paymentType as OrderDebtFilters["paymentType"]
  const bucket = search.get("marketDebtType") ?? ""
  if (bucket && !(DEBT_BUCKETS as readonly string[]).includes(bucket)) return { error: bad("marketDebtType", "first | second | third | fourth") }
  filters.marketDebtType = bucket as OrderDebtFilters["marketDebtType"]
  for (const name of ["minPaymentDays", "paymentDays"] as const) {
    const value = search.get(name)?.trim() ?? ""
    if (value && !/^\d{1,6}$/.test(value)) return { error: bad(name, "0..999999") }
    filters[name] = value
  }
  const flag = search.get("withWrongDebt")
  filters.withWrongDebt = flag === "1" || flag === "true"
  const tab = search.get("toggle") ?? search.get("tab") ?? "client"
  if (tab !== "client" && tab !== "order") return { error: bad("toggle", "client | order") }
  const int = (name: string, fallback: number) => {
    const value = Number(search.get(name) ?? "")
    return search.get(name) !== null && search.get(name) !== "" && Number.isFinite(value) ? Math.floor(value) : fallback
  }
  return {
    data: {
      ...filters,
      tab,
      search: search.get("search")?.trim() ?? "",
      ordering: search.get("ordering")?.trim() ?? "",
      page: Math.max(1, int("page", 1)),
      pageSize: Math.max(0, int("pageSize", 25)),
    },
  }
}

const period = strictNum(z.number().int().min(1).max(3650))

/** Body of PUT /api/order-debts/settings. */
export const orderDebtConfigSchema = z.object({ firstDebtPeriod: period, secondDebtPeriod: period, thirdDebtPeriod: period })

/** A real day of a sane year (2000..2100, lib/document-dates.ts); an expected payment date may be in the future. */
const isoDay = z.string().trim().refine((value) => isIsoDay(value) && docYearOk(value), "YYYY-MM-DD")

/** Body of POST /api/order-debts/recalc. */
export const orderDebtRecalcSchema = z.object({
  clientId: dbId().optional(),
  fromDate: isoDay.optional(),
})

/** Body of POST /api/order-debts/payment-date. */
export const orderPaymentDateSchema = z.object({
  orderIds: z.array(dbId()).min(1).max(5000),
  /** "" clears the date. */
  paymentDate: z.union([isoDay, z.literal("")]),
})

/** Body of POST /api/order-debts/group-payment. */
export const orderGroupPaymentSchema = z.object({
  cashboxId: dbId(),
  /** A money document: year 2000..2100, never after today (lib/document-dates.ts). */
  date: z.string().trim().max(40).optional().superRefine(docDateCheck()),
  branch: z.string().trim().max(200).optional(),
  categoryId: dbId().optional(),
  responsibleId: dbId().optional(),
  isVerified: z.boolean().optional(),
  comment: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        orderId: dbId(),
        /** Cash taken, in the cashbox currency. */
        amount: strictNum(z.number().finite().nonnegative().max(MAX_MONEY)),
        /** Order part (debt) currency. */
        currency: z.string().trim().min(1),
        comment: z.string().trim().optional(),
      }),
    )
    .min(1)
    .max(1000),
})

/** Maps CashError to { error, field } like the cash routes. */
export function orderDebtErrorResponse(error: unknown): NextResponse {
  if (error instanceof CashError) return NextResponse.json({ error: error.message, field: error.field ?? null }, { status: error.status })
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}
