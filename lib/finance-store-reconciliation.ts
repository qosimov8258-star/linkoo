import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb, type PgDb } from "@/lib/db"
import type { ParsedQuery } from "@/lib/finance/api"
import { loadCurrencyContext } from "@/lib/finance/context"
import { convertAmount, roundMoney, visibleCurrencyCodes } from "@/lib/finance/currency"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { nameKey, placeName } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { movementCte } from "@/lib/finance/sources"
import { MOVEMENT_COLUMNS, type BalanceDateMode, type FinanceCurrency } from "@/lib/finance/types"
import { getClientBalanceOptions } from "@/lib/finance-client-balance"
import {
  ORDER_STATUS_OPTIONS,
  RECONCILIATION_STATUS_VALUES,
  type ClientBalanceSum,
  type ReconciliationMoney,
  type ReconciliationStatus,
  type ReconciliationVariant,
  type StoreReconciliationListResult,
  type StoreReconciliationOptions,
  type StoreReconciliationRow,
} from "@/lib/finance-store-reconciliation-types"

// "Сверка магазина через бот" (demo #/sales-market-balance, sales/market_balance;
// variant "client") and "Сверка счетов" (demo #/client-balance,
// sales/client_balances; variant "account"): every client's / account's
// balance on a day ("Долг на определенную дату", default today) per currency,
// split into cash and bank, plus the base-currency total, the bot
// reconciliation status, the debt term, days since the last payment / order
// and the number of orders.
//
// Rows come from the shared ledger (lib/finance): getBalanceList("client") —
// one row per client — or getBalanceList("account") — the rows of "Долги по
// счетам": clients grouped by INN ("inn:<inn>"), a client without INN is its
// own account. The per-currency total is the SUM of the same client movement
// rows the ledger sums for its end balance (an account = Σ its clients), so it
// equals "Баланс клиентов" / "Долги по счетам" for the same end day and date
// mode. Cash / bank: the movement's payment type; orders take
// orders.payment_type (the client ledger leaves orders untyped); whatever has
// no payment type (opening balance, legacy client payments, untyped orders)
// counts as cash, so cash + bank = total.
//
// Own tables (created lazily, never touching existing rows of other tables):
//   client_balance_corrections   manual corrections (Списать / Добавить, "Установить долг с Excel"),
//                                read by the client ledger as none_type_plus / none_type_minus
//   client_reconciliation_messages / account_reconciliation_messages
//                                reconciliation requests and their bot status (per client / per account key)
//   client_payment_deadlines / account_payment_deadlines
//                                "Срок долга" history (latest row per client / account key wins)
//   client_balance_imports       one row per committed Excel import

export const CLIENT_CORRECTIONS_TABLE = "client_balance_corrections"

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS client_balance_corrections (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  correction_date TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  delivery_man TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  import_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS client_balance_corrections_client_idx ON client_balance_corrections (client_id);
CREATE TABLE IF NOT EXISTS client_reconciliation_messages (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_send',
  text TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT '',
  balances TEXT NOT NULL DEFAULT '',
  telegram_user TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS client_reconciliation_messages_client_idx ON client_reconciliation_messages (client_id);
CREATE TABLE IF NOT EXISTS client_payment_deadlines (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  payment_deadline TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS client_payment_deadlines_client_idx ON client_payment_deadlines (client_id);
CREATE TABLE IF NOT EXISTS client_balance_imports (
  id SERIAL PRIMARY KEY,
  debt_date TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  organizations TEXT NOT NULL DEFAULT '',
  by_payment_type INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'created',
  file_name TEXT NOT NULL DEFAULT '',
  rows_count INTEGER NOT NULL DEFAULT 0,
  corrections_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account_reconciliation_messages (
  id SERIAL PRIMARY KEY,
  account_key TEXT NOT NULL,
  client_ids TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_send',
  text TEXT NOT NULL DEFAULT '',
  as_of TEXT NOT NULL DEFAULT '',
  balances TEXT NOT NULL DEFAULT '',
  telegram_user TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS account_reconciliation_messages_key_idx ON account_reconciliation_messages (account_key);
CREATE TABLE IF NOT EXISTS account_payment_deadlines (
  id SERIAL PRIMARY KEY,
  account_key TEXT NOT NULL,
  payment_deadline TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS account_payment_deadlines_key_idx ON account_payment_deadlines (account_key)`

declare global {
  // v2: + account_* tables (a new name so a running process creates them too).
  var __linkoStoreReconciliationSchemaV2: Promise<void> | undefined
}

/** Creates the pages' own tables once per process. */
export async function ensureStoreReconciliationSchema(db: PgDb = getDb()): Promise<void> {
  if (!globalThis.__linkoStoreReconciliationSchemaV2) {
    globalThis.__linkoStoreReconciliationSchemaV2 = db.exec(SCHEMA_SQL).catch((error: unknown) => {
      globalThis.__linkoStoreReconciliationSchemaV2 = undefined
      throw error
    })
  }
  await globalThis.__linkoStoreReconciliationSchemaV2
}

/** Per-variant tables of reconciliation requests / debt terms; `key` = the
 * entity key column as text (clients.id for shops, the account key for accounts). */
export const RECONCILIATION_STORES: Record<ReconciliationVariant, { messages: string; deadlines: string; key: string }> = {
  client: { messages: "client_reconciliation_messages", deadlines: "client_payment_deadlines", key: "client_id::text" },
  account: { messages: "account_reconciliation_messages", deadlines: "account_payment_deadlines", key: "account_key" },
}

export const variantSchema = z.enum(["client", "account"])

// --- query --------------------------------------------------------------------------

export type BalanceKind = "debtor" | "loaner"

export type StoreReconciliationParams = {
  /** Default "client". */
  variant?: ReconciliationVariant
  mode: BalanceDateMode
  /** Balance day, default today. */
  debtDate?: string
  search?: string
  branches?: string[]
  zones?: string[]
  agents?: string[]
  clientTypes?: string[]
  organizations?: string[]
  /** "Клиента создал": clients have no creator, so any value matches nobody. */
  createdBy?: string[]
  messageStatuses?: string[]
  /** ORDER_STATUS_OPTIONS values: only orders in these statuses count. */
  orderStatuses?: string[]
  balanceType?: BalanceKind | ""
  /** Only with balanceType: judge the cash or bank part. */
  paymentType?: "cash" | "bank" | ""
  deadlineFrom?: string
  deadlineTo?: string
  orderDaysMin?: number
  orderDaysMax?: number
  paymentDaysMin?: number
  paymentDaysMax?: number
  /** Visits / refusals are not recorded: applied strictly against "none". */
  rejectDaysMin?: number
  rejectDaysMax?: number
  visitDaysMin?: number
  visitDaysMax?: number
  lastVisit?: "success" | "unsuccess" | ""
  clientCreatedFrom?: string
  clientCreatedTo?: string
  /** "name" | "status" | "deadline" | "payment_days" | "order_days" | "total" | "orders" | "cash.<CUR>" | "bank.<CUR>"; "-" = desc. */
  ordering?: string[]
  page?: number
  /** 0 = all. */
  pageSize?: number
}

const day = z.string().refine(isIsoDay, "YYYY-MM-DD")
const days = z.coerce.number().int().min(0).optional()
const list = z.array(z.string().trim().min(1)).optional()

const listQuery = z.object({
  variant: variantSchema.optional(),
  mode: z.enum(["created", "realization"]).optional(),
  debtDate: day.optional(),
  search: z.string().trim().optional(),
  branch: list,
  zone: list,
  agent: list,
  clientType: list,
  organization: list,
  createdBy: list,
  messageStatus: z.array(z.enum(["pending", "is_null", "confirmed", "rejected", "not_send"])).optional(),
  orderStatus: z.array(z.enum(ORDER_STATUS_OPTIONS.map((option) => option.value) as ["1", "2", "3"])).optional(),
  balanceType: z.enum(["debtor", "loaner", ""]).optional(),
  paymentType: z.enum(["cash", "bank", ""]).optional(),
  deadlineFrom: day.optional(),
  deadlineTo: day.optional(),
  orderDaysMin: days,
  orderDaysMax: days,
  paymentDaysMin: days,
  paymentDaysMax: days,
  rejectDaysMin: days,
  rejectDaysMax: days,
  visitDaysMin: days,
  visitDaysMax: days,
  lastVisit: z.enum(["success", "unsuccess", ""]).optional(),
  clientCreatedFrom: day.optional(),
  clientCreatedTo: day.optional(),
  ordering: list,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(0).max(100000).optional(),
})

const LIST_ARRAYS = ["branch", "zone", "agent", "clientType", "organization", "createdBy", "messageStatus", "orderStatus", "ordering"]

/** Query of GET /api/store-reconciliation (arrays = repeated params). */
export function parseStoreReconciliationQuery(url: string): ParsedQuery<StoreReconciliationParams> {
  const search = new URL(url).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const name of new Set(search.keys())) {
    if (LIST_ARRAYS.includes(name)) raw[name] = search.getAll(name).filter((value) => value.trim() !== "")
    else {
      const value = search.get(name) ?? ""
      if (value.trim() !== "" || name === "balanceType" || name === "paymentType" || name === "lastVisit") raw[name] = value
    }
  }
  const parsed = listQuery.safeParse(raw)
  if (!parsed.success) return { error: NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: parsed.error.flatten() }, { status: 400 }) }
  const q = parsed.data
  return {
    data: {
      variant: q.variant ?? "client",
      mode: q.mode ?? "created",
      debtDate: q.debtDate,
      search: q.search,
      branches: q.branch,
      zones: q.zone,
      agents: q.agent,
      clientTypes: q.clientType,
      organizations: q.organization,
      createdBy: q.createdBy,
      messageStatuses: q.messageStatus,
      orderStatuses: q.orderStatus,
      balanceType: q.balanceType,
      paymentType: q.paymentType,
      deadlineFrom: q.deadlineFrom,
      deadlineTo: q.deadlineTo,
      orderDaysMin: q.orderDaysMin,
      orderDaysMax: q.orderDaysMax,
      paymentDaysMin: q.paymentDaysMin,
      paymentDaysMax: q.paymentDaysMax,
      rejectDaysMin: q.rejectDaysMin,
      rejectDaysMax: q.rejectDaysMax,
      visitDaysMin: q.visitDaysMin,
      visitDaysMax: q.visitDaysMax,
      lastVisit: q.lastVisit,
      clientCreatedFrom: q.clientCreatedFrom,
      clientCreatedTo: q.clientCreatedTo,
      ordering: q.ordering,
      page: q.page,
      pageSize: q.pageSize,
    },
  }
}

// --- balances split by payment type -------------------------------------------------------

export type SplitOptions = {
  /** Balance day (inclusive). */
  to: string
  mode: BalanceDateMode
  organizations?: string[]
  /** orders.status values; empty = the ledger's own order rule only. */
  orderStatuses?: string[]
  /** Restrict to these client ids. */
  clientIds?: number[]
}

export type ClientSplit = { currencies: Map<string, ReconciliationMoney>; orders: number }

/** Per client: per currency cash / bank / total of the client ledger up to
 * `to` (inclusive), and the number of orders counted. One SQL pass over the
 * same movement rows the ledger aggregates (lib/finance/sources.ts). */
export async function clientBalanceSplit(db: PgDb, s: FinanceSchema, base: string, options: SplitOptions): Promise<Map<string, ClientSplit>> {
  const orderPt = s.col("orders", "payment_type") ? "WHEN mv.src = 'order' AND fin_pt(o.payment_type) <> '' THEN fin_pt(o.payment_type)" : ""
  const statuses = options.orderStatuses ?? []
  const joinOrders = orderPt || statuses.length ? "LEFT JOIN orders o ON mv.src = 'order' AND o.id = mv.src_id" : ""
  // Same row filter as the ledger's aggregate (MOVEMENT_WHERE + counted columns);
  // OFFSET 0 keeps the date parsing above the entity joins, like the ledger.
  const sql = `${movementCte("client", s, { mode: options.mode, lean: false, orderScope: null })}
    SELECT m.ek, m.cur, SUM(m.amt) AS total, SUM(m.amt) FILTER (WHERE m.pay = 'bank') AS bank,
           COUNT(DISTINCT m.src_id) FILTER (WHERE m.src = 'order') AS orders
    FROM (
      SELECT mv.ek, mv.cur, mv.amt, mv.src, mv.src_id, mv.ts,
             CASE WHEN mv.pt <> '' THEN mv.pt ${orderPt} ELSE 'cash' END AS pay
      FROM mv ${joinOrders}
      WHERE mv.ek IS NOT NULL
        AND mv.col = ANY(@cols::text[])
        AND (NOT mv.pending OR @countPending)
        AND (cardinality(@orgs::text[]) = 0 OR fin_key(mv.org) = ANY(@orgs::text[]))
        AND (cardinality(@keys::text[]) = 0 OR mv.ek = ANY(@keys::text[]))
        ${statuses.length ? "AND (mv.src <> 'order' OR o.status = ANY(@statuses::text[]))" : ""}
      OFFSET 0
    ) m
    WHERE m.ts::date <= @to::date
    GROUP BY GROUPING SETS ((m.ek, m.cur), (m.ek))`
  const rows = (await db.prepare(sql).all({
    base,
    to: options.to,
    cols: [...MOVEMENT_COLUMNS.client],
    countPending: options.mode === "created",
    orgs: (options.organizations ?? []).map(nameKey).filter(Boolean),
    keys: (options.clientIds ?? []).map(String),
    statuses,
  })) as Array<{ ek: string; cur: string | null; total: number | string | null; bank: number | string | null; orders: number | string | null }>
  const out = new Map<string, ClientSplit>()
  for (const row of rows) {
    let entry = out.get(row.ek)
    if (!entry) out.set(row.ek, (entry = { currencies: new Map(), orders: 0 }))
    if (row.cur === null) {
      entry.orders = Number(row.orders ?? 0)
      continue
    }
    const total = roundMoney(Number(row.total ?? 0))
    const bank = roundMoney(Number(row.bank ?? 0))
    entry.currencies.set(row.cur, { cash: roundMoney(total - bank), bank, total })
  }
  return out
}

// --- list ------------------------------------------------------------------------------

type StatusRow = { ek: string; status: string; created_at: string; confirmed_at: string }

/** Latest reconciliation request per entity key. */
async function latestStatuses(db: PgDb, variant: ReconciliationVariant): Promise<Map<string, StatusRow>> {
  const store = RECONCILIATION_STORES[variant]
  const rows = (await db
    .prepare(
      `SELECT DISTINCT ON (${store.key}) ${store.key} AS ek, status, to_char(fin_ts(created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
              CASE WHEN confirmed_at = '' THEN '' ELSE to_char(fin_ts(confirmed_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') END AS confirmed_at
       FROM ${store.messages} ORDER BY ${store.key}, id DESC`,
    )
    .all()) as StatusRow[]
  return new Map(rows.map((row) => [String(row.ek), row]))
}

/** Current debt term per entity key (latest row wins; "" = cleared). */
async function latestDeadlines(db: PgDb, variant: ReconciliationVariant): Promise<Map<string, string>> {
  const store = RECONCILIATION_STORES[variant]
  const rows = (await db
    .prepare(`SELECT DISTINCT ON (${store.key}) ${store.key} AS ek, payment_deadline FROM ${store.deadlines} ORDER BY ${store.key}, id DESC`)
    .all()) as Array<{ ek: string; payment_deadline: string }>
  return new Map(rows.filter((row) => isIsoDay(row.payment_deadline)).map((row) => [String(row.ek), row.payment_deadline]))
}

function daysSince(dayIso: string | null, today: string): number | null {
  if (!dayIso) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayIso}T00:00:00Z`)) / 86_400_000)
}

/** Same rule as the shared list: a missing value passes only an open upper bound. */
function inRange(value: number | null, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true
  if (value === null) return max === undefined
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function emptyMoney(): ReconciliationMoney {
  return { cash: 0, bank: 0, total: 0 }
}

/** Demo column order: currencies by label (Euro, SUM, USD). */
function demoOrder(currencies: FinanceCurrency[]): FinanceCurrency[] {
  return [...currencies].sort((a, b) => a.label.localeCompare(b.label, "en"))
}

/** Row id for the default order: clients.id, or the newest client of an INN account. */
function rowId(row: StoreReconciliationRow): number {
  return row.id ?? row.members.reduce((max, member) => Math.max(max, member.id), 0)
}

function sortValue(row: StoreReconciliationRow, key: string): number | string | null {
  if (key === "name") return row.name.toLowerCase()
  if (key === "status") return row.status ?? ""
  if (key === "deadline") return row.paymentDeadline
  if (key === "payment_days") return row.paymentDays
  if (key === "order_days") return row.orderDays
  if (key === "total") return row.total
  if (key === "orders") return row.orders
  if (key === "id") return rowId(row)
  const [field, code] = key.split(".")
  if ((field === "cash" || field === "bank" || field === "total") && code) return row.currencies[code]?.[field] ?? 0
  return null
}

/** Multi-key sort; empty values (no deadline, never paid …) always last. */
export function sortReconciliationRows(rows: StoreReconciliationRow[], ordering: string[] | undefined): StoreReconciliationRow[] {
  const keys = (ordering ?? []).filter(Boolean)
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  const effective = keys.length ? keys : ["-id"]
  return [...rows].sort((a, b) => {
    for (const raw of effective) {
      const desc = raw.startsWith("-")
      const key = desc ? raw.slice(1) : raw
      const left = sortValue(a, key)
      const right = sortValue(b, key)
      if (left === right) continue
      if (left === null || left === "") return 1
      if (right === null || right === "") return -1
      const result = typeof left === "string" && typeof right === "string" ? collator.compare(left, right) : Number(left) - Number(right)
      if (result) return desc ? -result : result
    }
    return rowId(b) - rowId(a) || a.key.localeCompare(b.key)
  })
}

function matchesBalanceKind(row: StoreReconciliationRow, kind: BalanceKind | "" | undefined, paymentType: "cash" | "bank" | "" | undefined): boolean {
  if (!kind) return true
  const field = paymentType || "total"
  return Object.values(row.currencies).some((money) => (kind === "debtor" ? money[field] < -1e-9 : money[field] > 1e-9))
}

function addMoney(target: ReconciliationMoney, source: ReconciliationMoney) {
  target.cash += source.cash
  target.bank += source.bank
  target.total += source.total
}

/** Rows (one page) + totals of "Сверка магазина через бот" (variant client) /
 * "Сверка счетов" (variant account). */
export async function getStoreReconciliationList(params: StoreReconciliationParams, db: PgDb = getDb()): Promise<StoreReconciliationListResult> {
  await ensureStoreReconciliationSchema(db)
  const s = await ensureFinanceSchema(db)
  const variant = params.variant ?? "client"
  // "Сверка счетов" lists the demo app's shops one by one (sales/client_balances): its archived rows replace the INN groups.
  const refTable =
    variant === "account" &&
    ((await db.prepare("SELECT to_regclass('store_reconciliation_reference_rows') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
  const today = todayIso()
  const asOf = params.debtDate ?? today
  const orderStatuses = (params.orderStatuses ?? [])
    .map((value) => ORDER_STATUS_OPTIONS.find((option) => option.value === value)?.status)
    .filter((value): value is (typeof ORDER_STATUS_OPTIONS)[number]["status"] => Boolean(value))

  const [list, statuses, deadlines] = await Promise.all([
    getBalanceList(
      refTable ? "client" : variant,
      {
        from: asOf,
        to: asOf,
        mode: params.mode,
        organizations: params.organizations,
        search: params.search,
        branches: params.branches,
        zones: params.zones,
        agents: params.agents,
        clientTypes: params.clientTypes,
        clientCreatedFrom: params.clientCreatedFrom,
        clientCreatedTo: params.clientCreatedTo,
        orderDaysMin: params.orderDaysMin,
        orderDaysMax: params.orderDaysMax,
        paymentDaysMin: params.paymentDaysMin,
        paymentDaysMax: params.paymentDaysMax,
        pageSize: 0,
      },
      db,
    ),
    latestStatuses(db, variant),
    latestDeadlines(db, variant),
  ])
  const split = await clientBalanceSplit(db, s, list.baseCurrency, { to: asOf, mode: params.mode, organizations: params.organizations, orderStatuses })
  const seen = new Set(list.currencies.map((currency) => currency.code))
  const currencies = [...list.currencies]
  for (const entry of split.values()) {
    for (const code of entry.currencies.keys()) {
      if (!seen.has(code)) {
        seen.add(code)
        currencies.push({ code, label: code, name: code, rate: null, isBase: false, id: null })
      }
    }
  }
  const codes = currencies.map((currency) => currency.code)
  const rates = Object.fromEntries(currencies.map((currency) => [currency.code, currency.rate]))
  const missing = new Set<string>()

  let rows: StoreReconciliationRow[] = []
  for (const balanceRow of list.rows) {
    // A shop row is one client; an account row sums its clients (ledger members).
    const memberIds = variant === "account" && !refTable ? (balanceRow.members ?? []) : balanceRow.id !== null ? [balanceRow.id] : []
    if (!memberIds.length) continue
    const money: Record<string, ReconciliationMoney> = Object.fromEntries(codes.map((code) => [code, emptyMoney()]))
    let orders = 0
    for (const memberId of memberIds) {
      const entry = split.get(String(memberId))
      if (!entry) continue
      orders += entry.orders
      for (const [code, value] of entry.currencies) if (money[code]) addMoney(money[code], value)
    }
    let total = 0
    for (const code of codes) {
      money[code] = { cash: roundMoney(money[code].cash), bank: roundMoney(money[code].bank), total: roundMoney(money[code].total) }
      if (!money[code].total) continue
      const converted = convertAmount(money[code].total, code, list.baseCurrency, rates)
      if (converted === null) missing.add(code)
      else total += converted
    }
    const status = statuses.get(balanceRow.key)
    const lastOrder = (balanceRow.info.last_order as string | null) || null
    const lastPayment = (balanceRow.info.last_payment as string | null) || null
    rows.push({
      key: balanceRow.key,
      id: balanceRow.id,
      name: balanceRow.name,
      info: {
        inn: String(balanceRow.info.inn ?? ""),
        phone: String(balanceRow.info.phone ?? ""),
        type: String(balanceRow.info.type ?? ""),
        zone: String(balanceRow.info.zone ?? ""),
        agent: String(balanceRow.info.agent ?? ""),
        branch: String(balanceRow.info.branch ?? ""),
        created: String(balanceRow.info.created ?? ""),
        clients: memberIds.length,
      },
      members: memberIds.map((id) => ({ id, name: variant === "client" || refTable ? balanceRow.name : "" })),
      status: status && (RECONCILIATION_STATUS_VALUES as readonly string[]).includes(status.status) ? (status.status as ReconciliationStatus) : null,
      statusDate: status?.created_at || null,
      confirmedDate: status?.confirmed_at || null,
      paymentDeadline: deadlines.get(balanceRow.key) ?? null,
      lastOrder,
      lastPayment,
      orderDays: daysSince(lastOrder, today),
      paymentDays: daysSince(lastPayment, today),
      total: roundMoney(total),
      currencies: money,
      orders,
    })
  }

  if (refTable) rows = await applyReferenceRows(db, rows, { codes, rates, baseCurrency: list.baseCurrency, params, missing })

  // Page filters the shared list does not know.
  const wantedStatuses = params.messageStatuses ?? []
  if (wantedStatuses.length) rows = rows.filter((row) => wantedStatuses.includes(row.status ?? "is_null"))
  if (params.deadlineFrom || params.deadlineTo) {
    rows = rows.filter(
      (row) => row.paymentDeadline !== null && (!params.deadlineFrom || row.paymentDeadline >= params.deadlineFrom) && (!params.deadlineTo || row.paymentDeadline <= params.deadlineTo),
    )
  }
  // Nothing about client creators, visits or refusals is stored (same rule as "Баланс клиентов").
  if ((params.createdBy ?? []).length || params.lastVisit) rows = []
  if (!inRange(null, params.rejectDaysMin, params.rejectDaysMax) || !inRange(null, params.visitDaysMin, params.visitDaysMax)) rows = []
  rows = rows.filter((row) => matchesBalanceKind(row, params.balanceType, params.balanceType ? params.paymentType : ""))

  const totals: Record<string, ReconciliationMoney> = Object.fromEntries(codes.map((code) => [code, emptyMoney()]))
  const balances = new Map<string, ClientBalanceSum>(
    currencies.map((currency) => [
      currency.code,
      { currency: currency.code, label: currency.label, rate: currency.rate, loaners_count: 0, loaners_sum: 0, loaners_sum_primary: 0, borrowers_count: 0, borrowers_sum: 0, borrowers_sum_primary: 0 },
    ]),
  )
  let grandTotal = 0
  for (const row of rows) {
    grandTotal += row.total
    for (const code of codes) {
      const money = row.currencies[code]
      totals[code].cash += money.cash
      totals[code].bank += money.bank
      totals[code].total += money.total
      const sum = balances.get(code)!
      const primary = convertAmount(money.total, code, list.baseCurrency, rates) ?? 0
      if (money.total > 1e-9) {
        sum.loaners_count += 1
        sum.loaners_sum += money.total
        sum.loaners_sum_primary += primary
      } else if (money.total < -1e-9) {
        sum.borrowers_count += 1
        sum.borrowers_sum += money.total
        sum.borrowers_sum_primary += primary
      }
    }
  }
  for (const code of codes) totals[code] = { cash: roundMoney(totals[code].cash), bank: roundMoney(totals[code].bank), total: roundMoney(totals[code].total) }

  const sorted = sortReconciliationRows(rows, params.ordering)
  const pageSize = Math.max(0, Math.floor(params.pageSize ?? 0))
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const ordered = demoOrder(currencies)
  const pageRows = pageSize ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted
  if (variant === "account") await attachMemberNames(db, pageRows)

  return {
    asOf,
    mode: params.mode,
    baseCurrency: list.baseCurrency,
    currencies: ordered,
    visibleCurrencies: visibleCurrencyCodes(ordered, totals),
    count: sorted.length,
    page,
    pageSize,
    rows: pageRows,
    totals,
    total: roundMoney(grandTotal),
    balances: ordered.map((currency) => {
      const sum = balances.get(currency.code)!
      return {
        ...sum,
        loaners_sum: roundMoney(sum.loaners_sum),
        loaners_sum_primary: roundMoney(sum.loaners_sum_primary),
        borrowers_sum: roundMoney(sum.borrowers_sum),
        borrowers_sum_primary: roundMoney(sum.borrowers_sum_primary),
      }
    }),
    missingRates: [...missing],
  }
}

type ReferenceShop = { id: number; name: string; created_date: string; orders: number; money: Record<string, [number, number]> }

/** "Сверка счетов": rows = the demo app's shops (store_reconciliation_reference_rows) with its cash / bank balances,
 * keeping the local client details when the shop exists here; clients created after those rows come from the ledger. */
async function applyReferenceRows(
  db: PgDb,
  rows: StoreReconciliationRow[],
  ctx: { codes: string[]; rates: Record<string, number | null>; baseCurrency: string; params: StoreReconciliationParams; missing: Set<string> },
): Promise<StoreReconciliationRow[]> {
  const { codes, rates, baseCurrency, params, missing } = ctx
  const shops = (await db.prepare("SELECT id, name, created_date, orders, money FROM store_reconciliation_reference_rows ORDER BY id").all()) as ReferenceShop[]
  const clientIds = new Set(((await db.prepare("SELECT id FROM clients").all()) as Array<{ id: number }>).map((row) => Number(row.id)))
  const byId = new Map(rows.filter((row) => row.id !== null).map((row) => [row.id as number, row]))
  const maxShop = shops.reduce((max, shop) => Math.max(max, Number(shop.id)), 0)
  const attributeFilter = Boolean(
    params.zones?.length || params.agents?.length || params.clientTypes?.length || params.branches?.length || params.organizations?.length ||
      params.clientCreatedFrom || params.clientCreatedTo || params.orderDaysMin !== undefined || params.orderDaysMax !== undefined ||
      params.paymentDaysMin !== undefined || params.paymentDaysMax !== undefined,
  )
  const search = (params.search ?? "").trim().toLowerCase()
  const money = (shop: ReferenceShop): { money: Record<string, ReconciliationMoney>; total: number } => {
    const out: Record<string, ReconciliationMoney> = {}
    let total = 0
    for (const code of codes) {
      const [cash, bank] = shop.money?.[code] ?? [0, 0]
      out[code] = { cash: roundMoney(cash), bank: roundMoney(bank), total: roundMoney(cash + bank) }
      if (!out[code].total) continue
      const converted = convertAmount(out[code].total, code, baseCurrency, rates)
      if (converted === null) missing.add(code)
      else total += converted
    }
    return { money: out, total: roundMoney(total) }
  }
  const result: StoreReconciliationRow[] = []
  for (const shop of shops) {
    const id = Number(shop.id)
    const base = byId.get(id)
    const next = money(shop)
    if (base) {
      result.push({ ...base, currencies: next.money, total: next.total, orders: Number(shop.orders) || 0 })
    } else if (!clientIds.has(id) && !attributeFilter && (!search || shop.name.toLowerCase().includes(search) || String(id) === search)) {
      result.push({
        key: String(id),
        id,
        name: shop.name,
        info: { inn: "", phone: "", type: "", zone: "", agent: "", branch: "", created: String(shop.created_date ?? "").slice(0, 10), clients: 1 },
        members: [{ id, name: shop.name }],
        status: null,
        statusDate: null,
        confirmedDate: null,
        paymentDeadline: null,
        lastOrder: null,
        lastPayment: null,
        orderDays: null,
        paymentDays: null,
        total: next.total,
        currencies: next.money,
        orders: Number(shop.orders) || 0,
      })
    }
  }
  for (const row of rows) if (row.id !== null && row.id > maxShop) result.push(row)
  return result
}

/** Names of the clients of account rows (the Списать / Добавить client choice). */
async function attachMemberNames(db: PgDb, rows: StoreReconciliationRow[]): Promise<void> {
  const ids = [...new Set(rows.flatMap((row) => row.members.map((member) => member.id)))]
  if (!ids.length) return
  const names = (await db.prepare("SELECT id, name FROM clients WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  const byId = new Map(names.map((row) => [Number(row.id), String(row.name)]))
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  for (const row of rows) {
    row.members = row.members.map((member) => ({ id: member.id, name: byId.get(member.id) ?? "" })).sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
  }
}

// --- options ---------------------------------------------------------------------------

/** Filter / dialog lookups: the client balance options + users + currencies. */
export async function getStoreReconciliationOptions(db: PgDb = getDb()): Promise<StoreReconciliationOptions> {
  const [base, users, context] = await Promise.all([
    getClientBalanceOptions(db),
    db.prepare(`SELECT COALESCE(NULLIF(display_name, ''), username) AS name FROM users ORDER BY id`).all() as Promise<Array<{ name: string }>>,
    loadCurrencyContext(db),
  ])
  const names = new Map<string, string>()
  for (const row of users) {
    const name = placeName(row.name)
    if (name && !names.has(nameKey(name))) names.set(nameKey(name), name)
  }
  return { ...base, users: [...names.values()], currencies: demoOrder(context.currencies), baseCurrency: context.base }
}
