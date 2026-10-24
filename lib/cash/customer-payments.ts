import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { isIsoDay } from "@/lib/finance/dates"
import { nameKey, placeName } from "@/lib/finance/entities"
import { getClientBalanceOptions } from "@/lib/finance-client-balance"
import { detachPayment } from "@/lib/cash/accept"
import { insertCustomerPayment } from "@/lib/finance/customer-payment"
import { CashError, currencyContext, isoDayOrEmpty, loadClient, localDateTime, num, numOrNull, paymentKind, pickRate } from "@/lib/cash/common"
import { orderDues } from "@/lib/cash/orders"
import { ensureCashSchema } from "@/lib/cash/schema"
import { deleteCashOperation } from "@/lib/cash/write"
import {
  CUSTOMER_PAYMENT_TABS,
  type ClientConfirmation,
  type CustomerPaymentBulkUpdateInput,
  type CustomerPaymentEditInput,
  type CustomerPaymentOptions,
  type CustomerPaymentRow,
  type CustomerPaymentsQuery,
  type CustomerPaymentsResult,
  type CustomerPaymentTab,
  type CustomerPaymentTotal,
  type CustomerPaymentTotalsResult,
  type ExpectedOrderDetail,
  type ExpectedOrderRow,
  type ExpectedOrdersQuery,
  type ExpectedOrdersResult,
  type ExpectedOrderTotal,
} from "@/lib/cash/customer-payments-types"

// Server side of two pages built on the cash core:
//
// "Оплаты от клиентов" (demo #/client-transaction): paged / filtered / sorted
// list of live customer_payments (demo client_transaction type 1) with
// totals per currency, bulk invoice date (demo bulk_update), in-place edit of
// a payment (demo PUT client_transaction), soft delete (demo …/cancel/) and
// "Переотправить запрос" (demo telegram/resend_client_transaction — there is no
// Telegram here: the request is recorded in customer_payment_resends and the
// row goes to client_confirmation = 'requested'). Bulk accept itself is the
// core's POST /api/cash/accept-cash { cashboxId, date, ids }.
//
// "Ожидаемые оплаты" (demo #/pending-payments): orders (not cancelled) with a
// remainder (lib/cash/orders.ts orderDues), the demo's 10 filters, ordering,
// paging and totals per currency with the cash / bank split; the header of the
// pay dialog. Paying is the core's POST /api/cash/orders/[id]/pay.
//
// Writes only customer_payments rows (never client_payments /
// cash_management_entries for the same money), so /api/balances/client and
// /api/balances/cashbox follow automatically.

const SCHEMA_VERSION = 1

// Order fields the demo shows on "Ожидаемые оплаты" (due date, payment type,
// organization, delivery man) — empty until an order writer fills them.
const DDL = `
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_date TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_man TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS customer_payment_resends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  previous_status TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS customer_payment_resends_payment_idx ON customer_payment_resends (payment_id);
`

declare global {
  var __linkoCustomerPaymentsSchema: { version: number; ready: Promise<void> } | undefined
}

async function ensureSchema(db: PgDb = getDb()): Promise<void> {
  await ensureCashSchema(db)
  if (globalThis.__linkoCustomerPaymentsSchema?.version !== SCHEMA_VERSION) {
    const ready = withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(72120903)")
      await tx.exec(DDL)
    }).catch((error) => {
      globalThis.__linkoCustomerPaymentsSchema = undefined
      throw error
    })
    globalThis.__linkoCustomerPaymentsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoCustomerPaymentsSchema!.ready
}

const MAX_ROWS = 20000

function paging(page: number | undefined, pageSize: number | undefined) {
  const size = pageSize === 0 ? 0 : Math.min(MAX_ROWS, Math.max(1, Math.floor(pageSize ?? 25)))
  const current = Math.max(1, Math.floor(page ?? 1))
  return { page: current, pageSize: size, limit: size || MAX_ROWS, offset: size ? (current - 1) * size : 0 }
}

const keys = (values: string[] | undefined) => [...new Set((values ?? []).map((value) => nameKey(placeName(value) || value)).filter(Boolean))]
const ids = (values: number[] | undefined) => [...new Set((values ?? []).filter((value) => Number.isInteger(value) && value > 0))]

// --- Оплаты от клиентов: list ------------------------------------------------------

const PAY_TS = "COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true))"
const ACC_TS = "fin_ts(NULLIF(p.accepted_at, ''))"
const BRANCH = "COALESCE(NULLIF(fin_place(p.branch), ''), NULLIF(fin_place(cb.branch), ''), fin_place(c.branch), '')"
const DEBT_CUR = "COALESCE(fin_cur(p.currency), @base::text)"
const CASH_CUR = "COALESCE(fin_cur(NULLIF(p.real_currency, '')), fin_cur(p.currency), @base::text)"

const FROM = `FROM customer_payments p
  LEFT JOIN (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1) ck ON p.client_id IS NULL AND ck.k = fin_key(p.client)
  LEFT JOIN clients c ON c.id = COALESCE(p.client_id, ck.id)
  LEFT JOIN (SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1) kb ON p.cashbox_id IS NULL AND btrim(p.kassa) <> '' AND kb.k = fin_key(p.kassa)
  LEFT JOIN cashboxes cb ON cb.id = COALESCE(p.cashbox_id, kb.id)
  LEFT JOIN cashboxes acb ON acb.id = p.agent_cashbox_id
  LEFT JOIN cash_acceptances ca ON ca.id = p.accept_id`

const WHERE = `p.is_deleted = 0
  AND (@tab::text = 'all' OR (@tab::text = 'accepted' AND p.accepted = 1) OR (@tab::text = 'not_accepted' AND p.accepted <> 1))
  AND (NOT @notAccept::boolean OR p.accepted <> 1)
  AND (@search::text = ''
       OR (@searchId::bigint > 0 AND (p.id = @searchId::bigint OR p.doc_no = @searchId::bigint))
       OR strpos(fin_key(p.client), @search::text) > 0 OR strpos(fin_key(COALESCE(c.inn, '')), @search::text) > 0
       OR strpos(fin_key(p.comment), @search::text) > 0 OR strpos(fin_key(p.created_by), @search::text) > 0)
  AND (@from::text = '' OR ${PAY_TS}::date >= NULLIF(@from::text, '')::date)
  AND (@to::text = '' OR ${PAY_TS}::date <= NULLIF(@to::text, '')::date)
  AND (@acceptedFrom::text = '' OR ${ACC_TS}::date >= NULLIF(@acceptedFrom::text, '')::date)
  AND (@acceptedTo::text = '' OR ${ACC_TS}::date <= NULLIF(@acceptedTo::text, '')::date)
  AND (@invoiceFrom::text = '' OR (p.invoice_date <> '' AND p.invoice_date >= @invoiceFrom::text))
  AND (@invoiceTo::text = '' OR (p.invoice_date <> '' AND p.invoice_date <= @invoiceTo::text))
  AND (@invoice::text = '' OR (@invoice::text = 'set' AND p.invoice_date <> '') OR (@invoice::text = 'not_set' AND p.invoice_date = ''))
  AND (cardinality(@branches::text[]) = 0 OR fin_key(${BRANCH}) = ANY(@branches::text[]))
  AND (cardinality(@deliveryMen::text[]) = 0 OR fin_key(p.delivery_man) = ANY(@deliveryMen::text[]) OR fin_key(p.agent) = ANY(@deliveryMen::text[]))
  AND (cardinality(@organizations::text[]) = 0 OR fin_key(fin_place(p.organization)) = ANY(@organizations::text[]))
  AND (cardinality(@clientTypes::text[]) = 0 OR fin_key(fin_place(COALESCE(c.type, ''))) = ANY(@clientTypes::text[]))
  AND (cardinality(@cashboxes::int[]) = 0 OR cb.id = ANY(@cashboxes::int[]))
  AND (cardinality(@zones::text[]) = 0 OR fin_key(fin_place(COALESCE(c.zone, ''))) = ANY(@zones::text[]))
  AND (cardinality(@clients::int[]) = 0 OR COALESCE(p.client_id, ck.id) = ANY(@clients::int[]))
  AND (cardinality(@createdBy::text[]) = 0 OR fin_key(p.created_by) = ANY(@createdBy::text[]))
  AND (cardinality(@acceptedBy::text[]) = 0 OR fin_key(p.accepted_by) = ANY(@acceptedBy::text[]))
  AND (cardinality(@agents::text[]) = 0 OR fin_key(COALESCE(c.agent, '')) = ANY(@agents::text[]))
  AND (cardinality(@deliverers::text[]) = 0 OR fin_key(COALESCE(c.deliverer, '')) = ANY(@deliverers::text[]))
  AND (@status::text = '' OR p.client_confirmation = @status::text)
  AND (@currency::text = '' OR ${DEBT_CUR} = @currency::text)`

function whereParams(query: CustomerPaymentsQuery, base: string) {
  const search = nameKey(query.search)
  const tab: CustomerPaymentTab = query.tab && CUSTOMER_PAYMENT_TABS.includes(query.tab) ? query.tab : "all"
  return {
    base,
    tab,
    notAccept: Boolean(query.notAccept),
    search,
    searchId: /^\d{1,15}$/.test(search) ? Number(search) : 0,
    from: query.from ?? "",
    to: query.to ?? "",
    acceptedFrom: query.acceptedFrom ?? "",
    acceptedTo: query.acceptedTo ?? "",
    invoiceFrom: query.invoiceFrom ?? "",
    invoiceTo: query.invoiceTo ?? "",
    invoice: query.invoice ?? "",
    branches: keys(query.branches),
    deliveryMen: keys(query.deliveryMen),
    organizations: keys(query.organizations),
    // "-" (no type) → '' like fin_place().
    clientTypes: [...new Set((query.clientTypes ?? []).map((value) => nameKey(placeName(value))))],
    cashboxes: ids(query.cashboxIds),
    zones: keys(query.zones),
    clients: ids(query.clientIds),
    createdBy: keys(query.createdBy),
    acceptedBy: keys(query.acceptedBy),
    agents: keys(query.responsibleAgents),
    deliverers: keys(query.responsibleDeliverers),
    status: query.status ?? "",
    currency: query.currency ? normCurrency(query.currency, base) : "",
  }
}

const ORDERING: Record<string, string> = {
  id: "p.id",
  client: "fin_key(p.client)",
  user: "fin_key(p.created_by)",
  created_date: PAY_TS,
  accepted_time: ACC_TS,
  division: "fin_key(p.organization)",
  amount: "p.amount",
  cashbox: "fin_key(COALESCE(cb.name, ''))",
}

function orderBy(ordering: string | undefined): string {
  const value = String(ordering ?? "").trim() || "-id"
  const desc = value.startsWith("-")
  const expr = ORDERING[value.replace(/^-/, "")] ?? "p.id"
  return `${expr} ${desc ? "DESC" : "ASC"} NULLS LAST, p.id ${desc ? "DESC" : "ASC"}`
}

type ListRow = {
  id: number
  doc_no: string | number | null
  client_id: number | null
  client: string
  inn: string | null
  created_by: string
  date: string
  accepted_at: string
  accepted_by: string
  invoice_date: string
  responsible_agent: string | null
  organization: string
  branch: string
  amount: number
  cur: string
  base_amount: number | null
  debt_rate: number | null
  real_amount: number
  real_cur: string
  custom_rate: number | null
  rate_type: string
  pt: string
  cb_id: number | null
  cb_name: string | null
  cb_cur: string | null
  acb_id: number | null
  acb_name: string | null
  accepted: number
  accept_id: number | null
  acceptance_doc: string | number | null
  order_id: number | null
  comment: string
  client_confirmation: string
  agent: string
  delivery_man: string
}

const LIST_SELECT = `SELECT p.id, p.doc_no, COALESCE(p.client_id, ck.id) AS client_id, p.client, c.inn, p.created_by,
    COALESCE(to_char(${PAY_TS}, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS date,
    COALESCE(to_char(${ACC_TS}, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS accepted_at,
    p.accepted_by, p.invoice_date, c.agent AS responsible_agent, fin_place(p.organization) AS organization, ${BRANCH} AS branch,
    p.amount::float8 AS amount, ${DEBT_CUR} AS cur, p.amount_sum_equivalent::float8 AS base_amount, p.debt_rate::float8 AS debt_rate,
    COALESCE(p.real_amount, p.amount)::float8 AS real_amount, ${CASH_CUR} AS real_cur, p.custom_rate::float8 AS custom_rate, p.rate_type,
    COALESCE(NULLIF(fin_pt(p.icon), ''), 'cash') AS pt, cb.id AS cb_id, cb.name AS cb_name, cb.currency AS cb_cur,
    acb.id AS acb_id, acb.name AS acb_name, p.accepted, p.accept_id, ca.doc_no AS acceptance_doc, p.order_id, p.comment,
    p.client_confirmation, p.agent, p.delivery_man`

const CONFIRMATIONS = new Set(["requested", "confirmed", "rejected", "auto"])

function toRow(row: ListRow, base: string, rates: Record<string, number | null>): CustomerPaymentRow {
  const amount = roundMoney(num(row.amount), 5)
  const realAmount = roundMoney(num(row.real_amount), 5)
  const cashRate =
    row.real_cur === base ? 1 : numOrNull(row.custom_rate) && num(row.custom_rate) > 0 ? num(row.custom_rate) : (rates[row.real_cur] ?? null)
  let baseAmount = numOrNull(row.base_amount)
  if (baseAmount === null) {
    const rate = row.cur === base ? 1 : (rates[row.cur] ?? null)
    baseAmount = rate ? roundMoney(amount * rate) : null
  }
  const debtRate =
    row.cur === base ? 1 : numOrNull(row.debt_rate) && num(row.debt_rate) > 0 ? num(row.debt_rate) : baseAmount !== null && amount ? roundMoney(baseAmount / amount, 5) : null
  const accepted = num(row.accepted) === 1
  const acceptanceDoc = row.accept_id && row.acceptance_doc !== null ? Number(row.acceptance_doc) : null
  const docNo = Number(row.doc_no ?? 0)
  return {
    id: row.id,
    docNo,
    client: { id: row.client_id, name: row.client ?? "", inn: row.inn ?? "" },
    createdBy: row.created_by ?? "",
    date: row.date,
    acceptedAt: accepted ? row.accepted_at : "",
    acceptedBy: accepted ? (row.accepted_by ?? "") : "",
    invoiceDate: row.invoice_date ?? "",
    responsibleAgent: placeName(row.responsible_agent),
    organization: row.organization ?? "",
    branch: row.branch ?? "",
    amount,
    currency: row.cur,
    baseAmount,
    debtRate,
    realAmount,
    realCurrency: row.real_cur,
    cashRate,
    rateType: row.rate_type ?? "",
    paymentType: row.pt === "bank" ? "bank" : "cash",
    cashbox: row.cb_id ? { id: row.cb_id, name: row.cb_name ?? "", currency: normCurrency(row.cb_cur, base) } : null,
    agentCashbox: row.acb_id ? { id: row.acb_id, name: row.acb_name ?? "" } : null,
    accepted,
    acceptance: row.accept_id && acceptanceDoc !== null ? { id: row.accept_id, docNo: acceptanceDoc } : null,
    cashDocNo: acceptanceDoc ?? (row.cb_id && docNo ? docNo : null),
    orderId: row.order_id,
    comment: row.comment === "Не указано" ? "" : (row.comment ?? ""),
    clientConfirmation: (CONFIRMATIONS.has(row.client_confirmation) ? row.client_confirmation : "") as ClientConfirmation,
    agent: row.agent ?? "",
    deliveryMan: row.delivery_man ?? "",
  }
}

/** GET /api/cash/customer-payments — one page of live customer payments. */
export async function listCustomerPayments(query: CustomerPaymentsQuery): Promise<CustomerPaymentsResult> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const params = whereParams(query, cc.base)
  const { page, pageSize, limit, offset } = paging(query.page, query.pageSize)
  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*)::int AS n ${FROM} WHERE ${WHERE}`).get(params) as Promise<{ n: number }>,
    db.prepare(`${LIST_SELECT} ${FROM} WHERE ${WHERE} ORDER BY ${orderBy(query.ordering)} LIMIT ${limit} OFFSET ${offset}`).all(params) as Promise<ListRow[]>,
  ])
  return { baseCurrency: cc.base, count: num(count.n), page, pageSize, rows: rows.map((row) => toRow(row, cc.base, cc.rates)) }
}

/** GET /api/cash/customer-payments/total — Σ amount per debt currency (demo total_payment). */
export async function customerPaymentTotals(query: CustomerPaymentsQuery): Promise<CustomerPaymentTotalsResult> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const rows = (await db
    .prepare(
      `SELECT ${DEBT_CUR} AS cur, (p.accepted = 1) AS acc, cb.id AS cb_id, cb.name AS cb_name, acb.id AS acb_id, acb.name AS acb_name,
              SUM(p.amount)::float8 AS total, COUNT(*)::int AS n
       ${FROM} WHERE ${WHERE} GROUP BY 1, 2, 3, 4, 5, 6`,
    )
    .all(whereParams(query, cc.base))) as Array<{ cur: string; acc: boolean; cb_id: number | null; cb_name: string | null; acb_id: number | null; acb_name: string | null; total: number; n: number }>
  const byCurrency = new Map<string, CustomerPaymentTotal>()
  const bump = (list: CustomerPaymentTotal["cashboxes"], id: number, name: string, total: number, count: number) => {
    const item = list.find((entry) => entry.id === id)
    if (item) {
      item.total += total
      item.count += count
    } else list.push({ id, name, total, count })
  }
  for (const row of rows) {
    let item = byCurrency.get(row.cur)
    if (!item) byCurrency.set(row.cur, (item = { currency: row.cur, total: 0, count: 0, cashboxes: [], agentCashboxes: [] }))
    const total = num(row.total)
    const count = num(row.n)
    item.total += total
    item.count += count
    if (row.acc) bump(item.cashboxes, row.cb_id ?? 0, row.cb_name ?? "Не указано", total, count)
    else bump(item.agentCashboxes, row.acb_id ?? 0, row.acb_name ?? "Не указано", total, count)
  }
  const order = (code: string) => {
    const index = cc.currencies.findIndex((currency) => currency.code === code)
    return index < 0 ? 999 : index
  }
  const totals = [...byCurrency.values()]
    .sort((a, b) => order(a.currency) - order(b.currency) || a.currency.localeCompare(b.currency))
    .map((item) => ({
      ...item,
      total: roundMoney(item.total, 3),
      cashboxes: item.cashboxes.map((entry) => ({ ...entry, total: roundMoney(entry.total, 3) })),
      agentCashboxes: item.agentCashboxes.map((entry) => ({ ...entry, total: roundMoney(entry.total, 3) })),
    }))
  return { baseCurrency: cc.base, totals }
}

// --- Оплаты от клиентов: writes ------------------------------------------------------

type LockedRow = {
  id: number
  amount: number
  currency: string
  real_amount: number | null
  real_currency: string
  icon: string
  order_id: number | null
  accept_id: number | null
  is_deleted: number
  organization: string
  created_by: string
  comment: string
  client_confirmation: string
  cb_id: number | null
  cb_currency: string | null
  cb_type: string | null
}

async function lockPayment(tx: PgDb, id: number): Promise<LockedRow> {
  const row = (await tx
    .prepare(
      `SELECT p.id, p.amount::float8 AS amount, p.currency, p.real_amount::float8 AS real_amount, p.real_currency, p.icon, p.order_id, p.accept_id,
              p.is_deleted, p.organization, p.created_by, p.comment, p.client_confirmation,
              cb.id AS cb_id, cb.currency AS cb_currency, cb.payment_type AS cb_type
       FROM customer_payments p
       LEFT JOIN cashboxes cb ON cb.id = COALESCE(p.cashbox_id, (SELECT MIN(k.id) FROM cashboxes k WHERE btrim(p.kassa) <> '' AND fin_key(k.name) = fin_key(p.kassa)))
       WHERE p.id = @id FOR UPDATE OF p`,
    )
    .get({ id })) as LockedRow | undefined
  if (!row) throw new CashError("Оплата не найдена", 404)
  if (num(row.is_deleted)) throw new CashError("Операция удалена", 409)
  return row
}

/** "Изменение транзакции" (demo ClientBalanceUpdateForm → PUT client_transaction):
 * edits the cash side, the debt side ("Индивидуальная покрытия долга" + rate),
 * payment type, organization, creator and comment in place. Rows already in a
 * cashbox keep the cashbox currency and type (the cashbox balance follows the
 * new amount); rows inside an agent-cash acceptance are edited there (409). */
export async function updateCustomerPayment(id: number, input: CustomerPaymentEditInput, user: string): Promise<CustomerPaymentRow> {
  await ensureSchema()
  const cc = await currencyContext(getDb())
  await withTransaction(async (tx) => {
    const row = await lockPayment(tx, id)
    if (row.accept_id) throw new CashError("Оплата входит в приемку наличных — измените приемку", 409)
    const cash = Number(input.amount)
    if (!Number.isFinite(cash) || cash <= 0) throw new CashError("Укажите сумму", 400, "amount")
    const inCashbox = row.cb_id !== null
    const cashCur = inCashbox
      ? normCurrency(row.cb_currency, cc.base)
      : normCurrency(input.currency || row.real_currency || row.currency, cc.base)
    // Order payments stay in the order currency (it reduces that order's remainder).
    const debtCur = row.order_id ? normCurrency(row.currency, cc.base) : normCurrency(input.debtCurrency || cashCur, cc.base)
    const custom = input.rateType === "custom"
    const cashRate = pickRate(cashCur, cc, custom ? input.customRate : null)
    const internal = cashRate ? cash * cashRate : null
    let debt = cash
    let debtRate: number | null = null
    if (debtCur !== cashCur) {
      debtRate = pickRate(debtCur, cc, custom ? input.debtRate : null)
      if (internal === null || !debtRate) throw new CashError("Курс валюты не задан", 400, "currencyRate")
      debt = roundMoney(internal / debtRate, 5)
    }
    const type = inCashbox ? paymentKind(row.cb_type) : (input.paymentType ?? (paymentKind(row.icon) === "bank" ? "bank" : "cash"))
    await tx
      .prepare(
        `UPDATE customer_payments SET amount = @debt, currency = @debtCur, real_amount = @cash, real_currency = @cashCur,
           amount_sum_equivalent = @internal, custom_rate = @cashRate, debt_rate = @debtRate, rate_type = @rateType,
           icon = @icon, cash_amount = @cashAmount, organization = @organization, created_by = @createdBy, comment = @comment,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        debt,
        debtCur,
        cash,
        cashCur,
        internal: internal === null ? null : roundMoney(internal),
        cashRate,
        debtRate,
        rateType: custom ? "custom" : "current",
        icon: type === "bank" ? "card" : "cash",
        cashAmount: inCashbox && type === "cash" ? cash : 0,
        organization: input.organization !== undefined ? input.organization.trim() : row.organization,
        createdBy: input.createdBy?.trim() || row.created_by,
        comment: input.comment !== undefined ? input.comment.trim() || "Не указано" : row.comment,
      })
    void user
  })
  return (await getCustomerPayment(id))!
}

/** One row (deleted ones too, for the edit / delete responses). */
export async function getCustomerPayment(id: number): Promise<CustomerPaymentRow | null> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const row = (await db.prepare(`${LIST_SELECT} ${FROM} WHERE p.id = @id`).get({ id, base: cc.base })) as ListRow | undefined
  return row ? toRow(row, cc.base, cc.rates) : null
}

/** "Удалить транзакцию" (demo POST …/cancel/): soft delete through the cash core;
 * a payment inside an agent-cash acceptance is detached first (the acceptance
 * amount follows; an empty acceptance is removed). */
export async function deleteCustomerPayment(id: number, user: string): Promise<{ id: number; deleted: boolean }> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, accept_id, is_deleted FROM customer_payments WHERE id = @id").get({ id })) as
    | { id: number; accept_id: number | null; is_deleted: number }
    | undefined
  if (!row) throw new CashError("Оплата не найдена", 404)
  if (num(row.is_deleted)) return { id, deleted: false }
  if (row.accept_id) await detachPayment(Number(row.accept_id), id, user)
  const result = await deleteCashOperation(`customer-${id}`, user)
  return { id, deleted: result.deleted.length > 0 }
}

/** "Переотправить запрос" (demo telegram/resend_client_transaction). No Telegram
 * bot exists here: the request is logged (customer_payment_resends + server log)
 * and the payment waits for the client's confirmation ('requested'). */
export async function resendCustomerPayment(id: number, user: string): Promise<{ id: number; clientConfirmation: ClientConfirmation; resends: number }> {
  await ensureSchema()
  const resends = await withTransaction(async (tx) => {
    const row = await lockPayment(tx, id)
    if (row.client_confirmation === "confirmed" || row.client_confirmation === "auto") throw new CashError("Транзакция уже подтверждена", 409)
    await tx
      .prepare("INSERT INTO customer_payment_resends (payment_id, previous_status, created_by) VALUES (@id, @previous, @user)")
      .run({ id, previous: row.client_confirmation ?? "", user })
    await tx.prepare("UPDATE customer_payments SET client_confirmation = 'requested', updated_at = datetime('now') WHERE id = @id").run({ id })
    const count = (await tx.prepare("SELECT COUNT(*)::int AS n FROM customer_payment_resends WHERE payment_id = @id").get({ id })) as { n: number }
    return num(count.n)
  })
  console.info(`[customer-payments] confirmation request #${resends} for payment ${id} recorded by ${user} (Telegram is not configured, nothing was sent)`)
  return { id, clientConfirmation: "requested", resends }
}

/** "Изменить выбранные оплаты" (demo bulk_update): invoice date of many payments. */
export async function bulkUpdateCustomerPayments(input: CustomerPaymentBulkUpdateInput): Promise<{ updated: number }> {
  await ensureSchema()
  const list = ids(input.ids)
  if (!list.length) throw new CashError("Выберите хотя бы одного", 400, "client_transactions")
  if (!input.changeInvoiceDate) return { updated: 0 }
  const day = isoDayOrEmpty(input.invoiceDate ?? "", "invoiceDate")
  const result = await getDb()
    .prepare("UPDATE customer_payments SET invoice_date = @day, updated_at = datetime('now') WHERE id = ANY(@ids::int[]) AND is_deleted = 0")
    .run({ day, ids: list })
  return { updated: result.changes }
}

/** "Добавить оплату" of the client card (legacy POST /api/client-payments): money
 * received from a client without a cashbox yet — a not accepted customer payment
 * (like an agent collection) that "Оплаты от клиентов" / "Принять деньги" accept
 * into a cashbox later. The client balance counts it at once (as before). */
export async function createClientCardPayment(
  input: { clientId: number; amount: number; currency?: string; comment?: string; paymentDate?: string },
  user: string,
): Promise<{ id: number; docNo: number }> {
  await ensureSchema()
  const cc = await currencyContext(getDb())
  if (!(input.amount > 0)) throw new CashError("Укажите сумму", 400, "amount")
  const currency = normCurrency(input.currency, cc.base)
  const rate = pickRate(currency, cc)
  return withTransaction(async (tx) => {
    const client = await loadClient(tx, input.clientId)
    return insertCustomerPayment(tx, {
      client,
      cashbox: null,
      amount: input.amount,
      currency,
      realAmount: input.amount,
      realCurrency: currency,
      sumEquivalent: rate ? input.amount * rate : null,
      date: localDateTime(input.paymentDate),
      accepted: false,
      comment: input.comment,
      createdBy: user,
    })
  })
}

// --- lookups ---------------------------------------------------------------------------

const ORDER_STATUSES = ["Есть на складе", "В пути", "Доставлено"]

function uniqueSorted(values: unknown[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = placeName(value)
    if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
}

/** GET /api/cash/customer-payments/options — values of both pages' filters and dialogs. */
export async function customerPaymentOptions(): Promise<CustomerPaymentOptions> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const [base, cashboxes, clients, stored, users, employees, statuses] = await Promise.all([
    getClientBalanceOptions(db),
    db.prepare("SELECT id, name, currency, payment_type, branch FROM cashboxes ORDER BY order_number NULLS LAST, id").all() as Promise<
      Array<{ id: number; name: string; currency: string; payment_type: string; branch: string }>
    >,
    db.prepare(`SELECT id, name FROM clients ORDER BY fin_key(name), id LIMIT ${MAX_ROWS}`).all() as Promise<Array<{ id: number; name: string }>>,
    db.prepare("SELECT DISTINCT created_by, accepted_by, agent, delivery_man FROM customer_payments WHERE is_deleted = 0").all() as Promise<
      Array<{ created_by: string; accepted_by: string; agent: string; delivery_man: string }>
    >,
    db.prepare("SELECT display_name FROM users").all() as Promise<Array<{ display_name: string }>>,
    db.prepare("SELECT id, first_name, last_name, position FROM employees WHERE active = 1 ORDER BY first_name, last_name, id").all() as Promise<
      Array<{ id: number; first_name: string; last_name: string; position: string }>
    >,
    db.prepare("SELECT DISTINCT status FROM orders").all() as Promise<Array<{ status: string }>>,
  ])
  const staff = employees.map((row) => ({ id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(), position: row.position ?? "" }))
  return {
    baseCurrency: cc.base,
    currencies: cc.currencies.map((currency) => ({ code: currency.code, label: currency.label, rate: currency.rate })),
    branches: base.branches,
    organizations: base.organizations,
    zones: base.zones,
    clientTypes: base.types,
    untyped: base.untyped,
    cashboxes: cashboxes.map((row) => ({
      id: row.id,
      name: row.name,
      currency: normCurrency(row.currency, cc.base),
      type: paymentKind(row.payment_type),
      branch: placeName(row.branch),
    })),
    clients: clients.map((row) => ({ id: row.id, name: row.name })),
    users: uniqueSorted([...stored.map((row) => row.created_by), ...users.map((row) => row.display_name), ...staff.map((row) => row.name)]),
    acceptedBy: uniqueSorted(stored.map((row) => row.accepted_by)),
    agents: base.agents,
    deliverers: uniqueSorted([...base.deliverers, ...stored.flatMap((row) => [row.agent, row.delivery_man])]),
    employees: staff.filter((row) => row.name),
    orderStatuses: uniqueSorted([...ORDER_STATUSES, ...statuses.map((row) => row.status)]).filter((status) => nameKey(status) !== "отменен"),
  }
}

// --- Ожидаемые оплаты --------------------------------------------------------------------

/** Orders with the fields the page shows (client by name, branch / zone / deliverer fallback from the client). */
function ordersSql(where: string): string {
  return `WITH ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1),
  base AS (
    SELECT o.id, o.client, ck.id AS client_id,
           COALESCE(NULLIF(fin_place(o.zone), ''), fin_place(COALESCE(c.zone, '')), '') AS zone,
           fin_place(COALESCE(c.branch, '')) AS branch, fin_place(o.agent) AS agent,
           COALESCE(NULLIF(fin_place(o.delivery_man), ''), fin_place(COALESCE(c.deliverer, '')), '') AS delivery_man,
           o.status, fin_ts(o.created_at) AS created_ts, fin_ts(o.delivery) AS delivery_ts,
           fin_ts(NULLIF(o.payment_date, '')) AS payment_ts, fin_place(o.organization) AS organization,
           COALESCE(NULLIF(fin_pt(o.payment_type), ''), 'cash') AS payment_type, o.order_balance
    FROM orders o LEFT JOIN ck ON ck.k = fin_key(o.client) LEFT JOIN clients c ON c.id = ck.id
  )
  SELECT id, client, client_id, zone, branch, agent, delivery_man, status,
         COALESCE(to_char(created_ts, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS created,
         COALESCE(to_char(delivery_ts, 'YYYY-MM-DD'), '') AS delivery_day,
         COALESCE(to_char(payment_ts, 'YYYY-MM-DD'), '') AS payment_day, organization, payment_type, order_balance
  FROM base WHERE ${where}`
}

type OrderBaseRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  branch: string
  agent: string
  delivery_man: string
  status: string
  created: string
  delivery_day: string
  payment_day: string
  organization: string
  payment_type: string
  /** The demo's own balance (set for orders backfilled from the demo, null for orders created here). */
  order_balance: number | null
}

const ORDERS_WHERE = `fin_key(status) <> 'отменен'
  AND (@search::text = '' OR (@searchId::bigint > 0 AND id = @searchId::bigint) OR strpos(fin_key(client), @search::text) > 0)
  AND (cardinality(@branches::text[]) = 0 OR fin_key(branch) = ANY(@branches::text[]))
  AND (cardinality(@clients::int[]) = 0 OR client_id = ANY(@clients::int[]))
  AND (cardinality(@agents::text[]) = 0 OR fin_key(agent) = ANY(@agents::text[]))
  AND (@paymentType::text = '' OR payment_type = @paymentType::text)
  AND (cardinality(@deliveryMen::text[]) = 0 OR fin_key(delivery_man) = ANY(@deliveryMen::text[]))
  AND (cardinality(@organizations::text[]) = 0 OR fin_key(organization) = ANY(@organizations::text[]))
  AND (cardinality(@statuses::text[]) = 0 OR fin_key(status) = ANY(@statuses::text[]))
  AND (@from::text = '' OR created_ts::date >= NULLIF(@from::text, '')::date)
  AND (@to::text = '' OR created_ts::date <= NULLIF(@to::text, '')::date)
  AND (@deliveryFrom::text = '' OR delivery_ts::date >= NULLIF(@deliveryFrom::text, '')::date)
  AND (@deliveryTo::text = '' OR delivery_ts::date <= NULLIF(@deliveryTo::text, '')::date)
  AND (@dueFrom::text = '' OR payment_ts::date >= NULLIF(@dueFrom::text, '')::date)
  AND (@dueTo::text = '' OR payment_ts::date <= NULLIF(@dueTo::text, '')::date)`

const EXPECTED_ORDERING: Record<string, (row: ExpectedOrderRow) => number | string> = {
  id: (row) => row.orderId,
  created_date: (row) => row.createdAt,
  payment_date: (row) => row.paymentDate,
  total_price: (row) => row.total,
  total_balance: (row) => row.remaining,
}

const orderPaymentType = (value: string): "cash" | "bank" => (value === "bank" ? "bank" : "cash")

/** GET /api/cash/customer-payments/expected — orders (not cancelled) with an unpaid
 * remainder, one row per order × currency, with totals over the filtered set. */
export async function listExpectedOrders(query: ExpectedOrdersQuery): Promise<ExpectedOrdersResult> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const search = nameKey(query.search)
  const orders = (await db.prepare(ordersSql(ORDERS_WHERE)).all({
    search,
    searchId: /^\d{1,9}$/.test(search) ? Number(search) : 0,
    branches: keys(query.branches),
    clients: ids(query.clientIds),
    agents: keys(query.agents),
    paymentType: query.paymentType ?? "",
    deliveryMen: keys(query.deliveryMen),
    organizations: keys(query.organizations),
    statuses: keys(query.statuses),
    from: query.from ?? "",
    to: query.to ?? "",
    deliveryFrom: query.deliveryFrom ?? "",
    deliveryTo: query.deliveryTo ?? "",
    dueFrom: query.dueFrom ?? "",
    dueTo: query.dueTo ?? "",
  })) as OrderBaseRow[]
  const dues = new Map((orders.length ? await orderDues(db, orders.map((order) => order.id), cc) : []).map((due) => [due.id, due]))
  const rows: ExpectedOrderRow[] = []
  for (const order of orders) {
    const demoBalance = order.order_balance === null ? null : Number(order.order_balance)
    // The demo's own balance (it also nets the returns) decides for orders backfilled from the demo:
    // settled → not an expected payment, otherwise the remainder is that balance.
    if (demoBalance !== null && demoBalance <= 0) continue
    let parts = dues.get(order.id)?.currencies ?? []
    if (demoBalance !== null) {
      const main = [...parts].sort((a, b) => b.total - a.total)[0]
      parts = main ? [{ ...main, remaining: roundMoney(demoBalance) }] : []
    }
    for (const part of parts) {
      if (demoBalance === null && part.remaining <= 0.005) continue
      rows.push({
        key: `${order.id}-${part.currency}`,
        orderId: order.id,
        client: { id: order.client_id, name: order.client ?? "" },
        zone: order.zone ?? "",
        createdAt: order.created,
        paymentDate: order.payment_day || order.delivery_day,
        organization: order.organization ?? "",
        branch: order.branch ?? "",
        agent: order.agent ?? "",
        deliveryMan: order.delivery_man ?? "",
        status: order.status ?? "",
        deliveryDate: order.delivery_day,
        paymentType: orderPaymentType(order.payment_type),
        currency: part.currency,
        total: part.total,
        paid: part.paid,
        remaining: part.remaining,
      })
    }
  }
  const ordering = String(query.ordering ?? "").trim() || "-id"
  const desc = ordering.startsWith("-")
  const value = EXPECTED_ORDERING[ordering.replace(/^-/, "")] ?? EXPECTED_ORDERING.id
  rows.sort((a, b) => {
    const x = value(a)
    const y = value(b)
    // Empty due dates go last in both directions.
    if (x === "" && y !== "") return 1
    if (y === "" && x !== "") return -1
    const cmp = x < y ? -1 : x > y ? 1 : 0
    return (desc ? -cmp : cmp) || (desc ? b.orderId - a.orderId : a.orderId - b.orderId) || a.currency.localeCompare(b.currency)
  })

  const totals = new Map<string, ExpectedOrderTotal>()
  for (const row of rows) {
    let item = totals.get(row.currency)
    if (!item) {
      item = {
        currency: row.currency,
        total: 0,
        remaining: 0,
        paymentTypes: [
          { paymentType: "cash", total: 0, remaining: 0 },
          { paymentType: "bank", total: 0, remaining: 0 },
        ],
      }
      totals.set(row.currency, item)
    }
    item.total += row.total
    item.remaining += row.remaining
    const part = item.paymentTypes.find((entry) => entry.paymentType === row.paymentType)!
    part.total += row.total
    part.remaining += row.remaining
  }
  const order = (code: string) => {
    const index = cc.currencies.findIndex((currency) => currency.code === code)
    return index < 0 ? 999 : index
  }
  const { page, pageSize, offset } = paging(query.page, query.pageSize)
  return {
    baseCurrency: cc.base,
    count: rows.length,
    page,
    pageSize,
    rows: pageSize ? rows.slice(offset, offset + pageSize) : rows.slice(0, MAX_ROWS),
    totals: [...totals.values()]
      .sort((a, b) => order(a.currency) - order(b.currency) || a.currency.localeCompare(b.currency))
      .map((item) => ({
        ...item,
        total: roundMoney(item.total),
        remaining: roundMoney(item.remaining),
        paymentTypes: item.paymentTypes.map((entry) => ({ ...entry, total: roundMoney(entry.total), remaining: roundMoney(entry.remaining) })),
      })),
  }
}

/** Header of the pay dialog: order, client, organization, payment type, dues and the client's contracts. */
export async function getExpectedOrder(orderId: number): Promise<ExpectedOrderDetail | null> {
  const db = getDb()
  await ensureSchema(db)
  const cc = await currencyContext(db)
  const order = (await db.prepare(ordersSql("id = @id")).get({ id: orderId })) as OrderBaseRow | undefined
  if (!order) return null
  const [due] = await orderDues(db, [orderId], cc)
  const contracts = (await db
    .prepare(
      `SELECT id, official_name, organization, year FROM contracts
       WHERE fin_key(client) = fin_key(@client) AND COALESCE(status, '') <> 'cancelled' ORDER BY id DESC`,
    )
    .all({ client: order.client })) as Array<{ id: number; official_name: string; organization: string; year: number | null }>
  return {
    orderId,
    client: { id: order.client_id, name: order.client ?? "" },
    organization: order.organization ?? "",
    branch: order.branch ?? "",
    paymentType: orderPaymentType(order.payment_type),
    createdAt: order.created,
    status: order.status ?? "",
    currencies: due?.currencies ?? [],
    contracts: contracts.map((row) => ({
      id: row.id,
      // Same label the cash core stores (lib/cash/common.ts loadContract).
      label: [`№ ${row.id}`, row.official_name, row.organization, row.year ? String(row.year) : ""].filter(Boolean).join(" · "),
    })),
  }
}

// --- HTTP parsing ----------------------------------------------------------------------------

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint = "YYYY-MM-DD") {
  return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [name]: [hint] } } }, { status: 400 })
}

function idList(search: URLSearchParams, name: string): number[] {
  return search
    .getAll(name)
    .flatMap((value) => value.split(/[,-]/))
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

const textList = (search: URLSearchParams, name: string) =>
  search
    .getAll(name)
    .map((value) => value.trim())
    .filter(Boolean)

function intParam(search: URLSearchParams, name: string): number | undefined {
  const value = search.get(name)
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined
}

function days(search: URLSearchParams, names: string[]): { values: Record<string, string>; error?: NextResponse } {
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = search.get(name)?.trim() ?? ""
    if (value && !isIsoDay(value)) return { values, error: bad(name) }
    values[name] = value
  }
  return { values }
}

/** Query of GET /api/cash/customer-payments(/total). */
export function parseCustomerPaymentsQuery(url: string): Parsed<CustomerPaymentsQuery> {
  const search = new URL(url).searchParams
  const dates = days(search, ["from", "to", "acceptedFrom", "acceptedTo", "invoiceFrom", "invoiceTo"])
  if (dates.error) return { error: dates.error }
  const tab = search.get("tab") ?? "all"
  if (!(CUSTOMER_PAYMENT_TABS as readonly string[]).includes(tab)) return { error: bad("tab", "not_accepted | accepted | all") }
  const invoice = search.get("invoice") ?? ""
  if (!["", "set", "not_set"].includes(invoice)) return { error: bad("invoice", "set | not_set") }
  const status = search.get("status") ?? ""
  if (status && !CONFIRMATIONS.has(status)) return { error: bad("status", "confirmed | requested | rejected | auto") }
  const flag = search.get("notAccept")
  return {
    data: {
      tab: tab as CustomerPaymentTab,
      search: search.get("search")?.trim() || undefined,
      ...dates.values,
      invoice: invoice as CustomerPaymentsQuery["invoice"],
      branches: textList(search, "branch"),
      deliveryMen: textList(search, "deliveryMan"),
      organizations: textList(search, "organization"),
      clientTypes: textList(search, "clientType"),
      cashboxIds: idList(search, "cashbox"),
      zones: textList(search, "zone"),
      clientIds: idList(search, "client"),
      createdBy: textList(search, "createdBy"),
      acceptedBy: textList(search, "acceptedBy"),
      responsibleAgents: textList(search, "responsibleAgent"),
      responsibleDeliverers: textList(search, "responsibleDeliverer"),
      status: status as ClientConfirmation,
      currency: search.get("currency")?.trim() || undefined,
      notAccept: flag === "1" || flag === "true",
      ordering: search.get("ordering")?.trim() || undefined,
      page: intParam(search, "page"),
      pageSize: intParam(search, "pageSize"),
    },
  }
}

/** Query of GET /api/cash/customer-payments/expected. */
export function parseExpectedOrdersQuery(url: string): Parsed<ExpectedOrdersQuery> {
  const search = new URL(url).searchParams
  const dates = days(search, ["from", "to", "deliveryFrom", "deliveryTo", "dueFrom", "dueTo"])
  if (dates.error) return { error: dates.error }
  const paymentType = search.get("paymentType") ?? ""
  if (!["", "cash", "bank"].includes(paymentType)) return { error: bad("paymentType", "cash | bank") }
  return {
    data: {
      search: search.get("search")?.trim() || undefined,
      ...dates.values,
      branches: textList(search, "branch"),
      clientIds: idList(search, "client"),
      agents: textList(search, "agent"),
      paymentType: paymentType as ExpectedOrdersQuery["paymentType"],
      deliveryMen: textList(search, "deliveryMan"),
      organizations: textList(search, "organization"),
      statuses: textList(search, "status"),
      ordering: search.get("ordering")?.trim() || undefined,
      page: intParam(search, "page"),
      pageSize: intParam(search, "pageSize"),
    },
  }
}

const positiveId = z.coerce.number().int().positive()
const optText = z.string().trim().optional()
const optRate = z.coerce.number().finite().positive().optional()

/** Body of PUT /api/cash/customer-payments/[id]. */
export const customerPaymentEditSchema = z.object({
  amount: z.coerce.number().finite().positive(),
  currency: optText,
  debtCurrency: optText,
  rateType: z.enum(["current", "custom"]).optional(),
  customRate: optRate,
  debtRate: optRate,
  paymentType: z.enum(["cash", "bank"]).optional(),
  organization: z.string().optional(),
  createdBy: optText,
  comment: z.string().optional(),
})

/** Body of POST /api/cash/customer-payments/bulk-update. */
export const customerPaymentBulkUpdateSchema = z.object({
  ids: z.array(positiveId).min(1),
  changeInvoiceDate: z.boolean(),
  invoiceDate: z.string().trim().nullable().optional(),
})
