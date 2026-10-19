import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { russianDateTime } from "@/lib/finance/customer-payment"
import { nowLocalIso } from "@/lib/finance/dates"
import { nameKey } from "@/lib/finance/entities"
import { CashError, currencyContext, loadCashbox, loadEmployee, localDateTime, num, numOrNull, pickRate, type CashboxInfo } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import { operationKey, type AcceptanceDetail, type AcceptGroup, type AcceptGroupFilter, type AgentPayment, type CashOperationKey } from "@/lib/cash/types"

// "Принять деньги" (demo finance/accept_cash_list + accept_client_transaction)
// and "Принять на кассу" of Оплаты от клиентов (demo finance/bulk_accept).
// Agent collections are customer_payments with accepted = 0, no cashbox and
// no batch. Accepting UPDATES those rows (accepted, cashbox_id, kassa,
// accepted_at/by, accept_id) and writes one cash_acceptances header ("Принято денег с
// <agent>", type 8) that the cash list shows instead of the rows. The ledger
// reads only the rows, so nothing is counted twice. A payment collected in
// another currency than the target cashbox keeps its real_amount/real_currency
// and is converted at current rates by every reader (ledger and list).

/** Who collected the money: agent, else delivery man, else creator. */
const AGENT = "COALESCE(NULLIF(btrim(p.agent), ''), NULLIF(btrim(p.delivery_man), ''), NULLIF(btrim(p.created_by), ''), '')"
const CASH_CUR = "COALESCE(fin_cur(NULLIF(p.real_currency, '')), fin_cur(p.currency), @base::text)"
const CASH_AMOUNT = "COALESCE(p.real_amount, p.amount)::float8"
const PAY_TS = "COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true))"
const PENDING = "p.accepted <> 1 AND p.cashbox_id IS NULL AND btrim(p.kassa) = '' AND p.accept_id IS NULL AND p.is_deleted = 0"

export type AcceptGroupsQuery = {
  from?: string
  to?: string
  /** Branch names of the payments. */
  branches?: string[]
  /** Agent cashboxes (agent_cashbox_id). */
  agentCashboxIds?: number[]
}

function groupKey(group: Omit<AcceptGroup, "key" | "amount" | "count">): string {
  return [group.agent, group.currency, group.organization, group.branch, group.agentCashbox?.id ?? 0].join("|")
}

/** Groups of not yet accepted agent collections (agent × currency × organization × branch × agent cashbox). */
export async function listAcceptGroups(query: AcceptGroupsQuery, db: PgDb = getDb()): Promise<AcceptGroup[]> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const rows = (await db
    .prepare(
      `SELECT ${AGENT} AS agent, ${CASH_CUR} AS cur, fin_place(p.organization) AS organization, fin_place(p.branch) AS branch,
              p.agent_cashbox_id, acb.name AS agent_cashbox, SUM(${CASH_AMOUNT}) AS amount, COUNT(*)::int AS n
       FROM customer_payments p LEFT JOIN cashboxes acb ON acb.id = p.agent_cashbox_id
       WHERE ${PENDING}
         AND (@from::text = '' OR ${PAY_TS}::date >= NULLIF(@from::text, '')::date)
         AND (@to::text = '' OR ${PAY_TS}::date <= NULLIF(@to::text, '')::date)
         AND (cardinality(@branches::text[]) = 0 OR fin_key(p.branch) = ANY(@branches::text[]))
         AND (cardinality(@cashboxes::int[]) = 0 OR p.agent_cashbox_id = ANY(@cashboxes::int[]))
       GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 2, 3, 4`,
    )
    .all({
      base: cc.base,
      from: query.from ?? "",
      to: query.to ?? "",
      branches: (query.branches ?? []).map(nameKey).filter(Boolean),
      cashboxes: query.agentCashboxIds ?? [],
    })) as Array<{ agent: string; cur: string; organization: string; branch: string; agent_cashbox_id: number | null; agent_cashbox: string | null; amount: number; n: number }>
  return rows.map((row) => {
    const group = {
      agent: row.agent,
      currency: row.cur,
      organization: row.organization,
      branch: row.branch,
      agentCashbox: row.agent_cashbox_id ? { id: row.agent_cashbox_id, name: row.agent_cashbox ?? "" } : null,
    }
    return { key: groupKey(group), ...group, amount: roundMoney(num(row.amount)), count: num(row.n) }
  })
}

const GROUP_WHERE = `${PENDING}
  AND ${AGENT} = @agent::text AND ${CASH_CUR} = @cur::text AND fin_place(p.organization) = @organization::text AND fin_place(p.branch) = @branch::text
  AND COALESCE(p.agent_cashbox_id, 0) = @agentCashbox::int
  AND (@from::text = '' OR ${PAY_TS}::date >= NULLIF(@from::text, '')::date)
  AND (@to::text = '' OR ${PAY_TS}::date <= NULLIF(@to::text, '')::date)`

function groupParams(group: AcceptGroupFilter, base: string) {
  return {
    base,
    agent: group.agent ?? "",
    cur: normCurrency(group.currency, base),
    organization: group.organization ?? "",
    branch: group.branch ?? "",
    agentCashbox: group.agentCashboxId ?? 0,
    from: group.from ?? "",
    to: group.to ?? "",
  }
}

const RATE_OF = (code: string) => `(CASE WHEN ${code} = @base::text THEN 1::float8 ELSE (SELECT MAX(c.rate)::float8 FROM currencies c WHERE fin_cur(c.code) = ${code}) END)`
const CB_CUR = "COALESCE(fin_cur(cb.currency), @base::text)"
/** Cash side in the accepting cashbox currency (same rule as the ledger); NULL while not in a cashbox. */
const CASHBOX_AMOUNT = `CASE WHEN cb.id IS NULL THEN NULL
    WHEN p.real_amount IS NOT NULL AND fin_cur(NULLIF(p.real_currency, '')) = ${CB_CUR} THEN p.real_amount::float8
    WHEN COALESCE(fin_cur(p.currency), @base::text) = ${CB_CUR} THEN p.amount::float8
    ELSE p.amount::float8 * COALESCE(${RATE_OF("COALESCE(fin_cur(p.currency), @base::text)")} / NULLIF(${RATE_OF(CB_CUR)}, 0), 1) END`

const PAYMENT_SELECT = `SELECT p.id, p.doc_no, ${CASHBOX_AMOUNT} AS cashbox_amount, COALESCE(p.client_id, ck.id) AS client_id, p.client, ${AGENT} AS agent, p.agent_cashbox_id, acb.name AS agent_cashbox,
    p.cashbox_id, cb.name AS cashbox, fin_place(p.branch) AS branch, fin_place(p.organization) AS organization,
    COALESCE(to_char(${PAY_TS}, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS date, COALESCE(to_char(fin_ts(p.accepted_at), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS accepted_at,
    p.accepted_by, p.order_id, ${CASH_AMOUNT} AS amount, ${CASH_CUR} AS cur, p.amount::float8 AS debt_amount,
    COALESCE(fin_cur(p.currency), @base::text) AS debt_cur, p.amount_sum_equivalent::float8 AS base_amount, p.custom_rate, p.comment, p.accepted
  FROM customer_payments p
  LEFT JOIN cashboxes acb ON acb.id = p.agent_cashbox_id LEFT JOIN cashboxes cb ON cb.id = p.cashbox_id
  LEFT JOIN (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1) ck ON p.client_id IS NULL AND ck.k = fin_key(p.client)`

/** Σ live payments of an acceptance in its cashbox currency (snapshot stored on the header). */
export async function liveAcceptanceAmount(db: PgDb, acceptanceId: number, base: string): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(${CASHBOX_AMOUNT}), 0) AS total
       FROM customer_payments p LEFT JOIN cashboxes cb ON cb.id = p.cashbox_id WHERE p.accept_id = @id AND p.is_deleted = 0`,
    )
    .get({ id: acceptanceId, base })) as { total: number }
  return roundMoney(num(row.total), 5)
}

type PaymentRow = {
  id: number
  doc_no: string | number
  cashbox_amount: number | null
  client_id: number | null
  client: string
  agent: string
  agent_cashbox_id: number | null
  agent_cashbox: string | null
  cashbox_id: number | null
  cashbox: string | null
  branch: string
  organization: string
  date: string
  accepted_at: string
  accepted_by: string
  order_id: number | null
  amount: number
  cur: string
  debt_amount: number
  debt_cur: string
  base_amount: number | null
  custom_rate: number | null
  comment: string
  accepted: number
}

function toPayment(row: PaymentRow): AgentPayment {
  return {
    id: row.id,
    docNo: Number(row.doc_no),
    client: { id: row.client_id, name: row.client },
    agent: row.agent,
    agentCashbox: row.agent_cashbox_id ? { id: row.agent_cashbox_id, name: row.agent_cashbox ?? "" } : null,
    cashbox: row.cashbox_id ? { id: row.cashbox_id, name: row.cashbox ?? "" } : null,
    branch: row.branch,
    organization: row.organization,
    date: row.date,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by ?? "",
    orderId: row.order_id,
    amount: roundMoney(num(row.amount)),
    currency: row.cur,
    cashboxAmount: row.cashbox_amount === null ? null : roundMoney(num(row.cashbox_amount)),
    debtAmount: roundMoney(num(row.debt_amount)),
    debtCurrency: row.debt_cur,
    baseAmount: row.base_amount === null ? null : roundMoney(num(row.base_amount)),
    rate: numOrNull(row.custom_rate),
    comment: row.comment === "Не указано" ? "" : (row.comment ?? ""),
    accepted: num(row.accepted) === 1,
  }
}

/** Payments of one accept group (expanded row of the dialog). */
export async function listAgentPayments(
  group: AcceptGroupFilter & { page?: number; pageSize?: number },
  db: PgDb = getDb(),
): Promise<{ count: number; page: number; pageSize: number; rows: AgentPayment[]; total: number; currency: string }> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const params = groupParams(group, cc.base)
  const agg = (await db.prepare(`SELECT COUNT(*)::int AS n, COALESCE(SUM(${CASH_AMOUNT}), 0) AS total FROM customer_payments p WHERE ${GROUP_WHERE}`).get(params)) as {
    n: number
    total: number
  }
  const pageSize = group.pageSize === 0 ? 0 : Math.max(1, Math.floor(group.pageSize ?? 25))
  const page = Math.max(1, Math.floor(group.page ?? 1))
  const paging = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await db.prepare(`${PAYMENT_SELECT} WHERE ${GROUP_WHERE} ORDER BY p.id DESC${paging}`).all(params)) as PaymentRow[]
  return { count: num(agg.n), page, pageSize, rows: rows.map(toPayment), total: roundMoney(num(agg.total)), currency: params.cur }
}

export type AcceptCashInput = {
  cashboxId: number
  /** Accept date-time ("YYYY-MM-DD" or local date-time); default now. */
  date?: string
  comment?: string
  /** Explicit payment ids (single "Принять", bulk accept of Оплаты от клиентов). */
  ids?: number[]
  /** Or a whole group ("Принять все"). */
  group?: AcceptGroupFilter
}

export type AcceptCashResult = { key: CashOperationKey; id: number; docNo: number; amount: number; currency: string; count: number; paymentIds: number[] }

type LockedPayment = {
  id: number
  agent: string
  organization: string
  branch: string
  agent_cashbox_id: number | null
  amount: number
  currency: string
  real_amount: number | null
  real_currency: string
  amount_sum_equivalent: number | null
}

/** Cash amount of a payment converted into the cashbox currency (current rates). */
function cashIn(payment: { real_amount: number | null; real_currency: string; amount: number; currency: string }, cashbox: CashboxInfo, cc: CurrencyContext) {
  const cur = normCurrency(payment.real_currency || payment.currency, cc.base)
  const amount = num(payment.real_amount ?? payment.amount)
  if (cur === cashbox.currency) return amount
  const from = pickRate(cur, cc)
  const to = pickRate(cashbox.currency, cc)
  if (!from || !to) throw new CashError("Курс валюты не задан", 400, "currencyRate")
  return roundMoney((amount * from) / to, 5)
}

async function findEmployeeId(db: PgDb, name: string): Promise<number | null> {
  if (!name.trim()) return null
  const row = (await db.prepare("SELECT id FROM employees WHERE fin_key(first_name || ' ' || last_name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })) as
    | { id: number }
    | undefined
  return row?.id ?? null
}

const common = <T>(values: T[]): T | null => (values.length && values.every((value) => value === values[0]) ? values[0] : null)

/** Accepts agent collections (a group or explicit ids) into a cashbox. */
export async function acceptCash(input: AcceptCashInput, user: string): Promise<AcceptCashResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const cashbox = await loadCashbox(tx, input.cashboxId, cc.base)
    let payments: LockedPayment[]
    const select = `SELECT p.id, ${AGENT} AS agent, fin_place(p.organization) AS organization, fin_place(p.branch) AS branch, p.agent_cashbox_id,
        p.amount::float8 AS amount, p.currency, p.real_amount::float8 AS real_amount, p.real_currency, p.amount_sum_equivalent::float8 AS amount_sum_equivalent
      FROM customer_payments p`
    if (input.ids?.length) {
      payments = (await tx
        .prepare(`${select} WHERE p.id = ANY(@ids::int[]) AND p.accepted <> 1 AND p.is_deleted = 0 AND p.accept_id IS NULL ORDER BY p.id FOR UPDATE`)
        .all({ ids: input.ids, base: cc.base })) as LockedPayment[]
    } else if (input.group) {
      payments = (await tx.prepare(`${select} WHERE ${GROUP_WHERE} ORDER BY p.id FOR UPDATE`).all(groupParams(input.group, cc.base))) as LockedPayment[]
    } else throw new CashError("Выберите оплаты", 400, "client_transaction")
    if (!payments.length) throw new CashError("Нет оплат для приемки", 400, "client_transaction")

    const date = localDateTime(input.date)
    const converted = payments.map((payment) => ({ payment, cash: cashIn(payment, cashbox, cc) }))
    const total = roundMoney(converted.reduce((sum, item) => sum + item.cash, 0), 5)
    const agent = common(payments.map((payment) => payment.agent)) ?? ""
    const header = (await tx
      .prepare(
        `INSERT INTO cash_acceptances (cashbox_id, agent, agent_id, agent_cashbox_id, organization, branch, currency, amount, date, comment, created_by)
         VALUES (@cashboxId, @agent, @agentId, @agentCashboxId, @organization, @branch, @currency, @amount, @date, @comment, @user) RETURNING id, doc_no`,
      )
      .get({
        cashboxId: cashbox.id,
        agent,
        agentId: await findEmployeeId(tx, agent),
        agentCashboxId: common(payments.map((payment) => payment.agent_cashbox_id)),
        organization: common(payments.map((payment) => payment.organization)) ?? "",
        branch: common(payments.map((payment) => payment.branch)) ?? "",
        currency: cashbox.currency,
        amount: total,
        date,
        comment: input.comment?.trim() ?? "",
        user,
      })) as { id: number; doc_no: string | number }
    const acceptId = Number(header.id)
    const cashRate = pickRate(cashbox.currency, cc)
    for (const { payment, cash } of converted) {
      await tx
        .prepare(
          `UPDATE customer_payments SET accepted = 1, cashbox_id = @cashboxId, kassa = @kassa, accepted_at = @acceptedAt, accepted_by = @user,
             accept_id = @acceptId, icon = @icon, cash_amount = @cashAmount,
             amount_sum_equivalent = COALESCE(amount_sum_equivalent, @sumEq), updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({
          id: payment.id,
          cashboxId: cashbox.id,
          kassa: cashbox.name,
          acceptedAt: russianDateTime(date),
          user,
          acceptId,
          icon: cashbox.type === "bank" ? "card" : "cash",
          cashAmount: cashbox.type === "bank" ? 0 : cash,
          sumEq: cashRate ? roundMoney(cash * cashRate) : null,
        })
    }
    return {
      key: operationKey("acceptance", acceptId),
      id: acceptId,
      docNo: Number(header.doc_no),
      amount: roundMoney(total),
      currency: cashbox.currency,
      count: payments.length,
      paymentIds: payments.map((payment) => payment.id),
    }
  })
}

/** Acceptance header + its payments (type-8 info dialog). */
export async function getAcceptance(id: number, db: PgDb = getDb()): Promise<AcceptanceDetail | null> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const header = (await db
    .prepare(
      `SELECT a.*, cb.name AS cashbox_name, cb.currency AS cashbox_currency, acb.name AS agent_cashbox_name,
              COALESCE(to_char(fin_ts(a.date), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS date_s,
              COALESCE(to_char(fin_ts(a.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS created_s
       FROM cash_acceptances a LEFT JOIN cashboxes cb ON cb.id = a.cashbox_id LEFT JOIN cashboxes acb ON acb.id = a.agent_cashbox_id
       WHERE a.id = @id`,
    )
    .get({ id })) as Record<string, unknown> | undefined
  if (!header) return null
  const rows = (await db.prepare(`${PAYMENT_SELECT} WHERE p.accept_id = @id AND p.is_deleted = 0 ORDER BY p.id`).all({ id, base: cc.base })) as PaymentRow[]
  const payments = rows.map(toPayment)
  const deleted = num(header.is_deleted) !== 0
  const currency = normCurrency(String(header.cashbox_currency ?? header.currency ?? ""), cc.base)
  return {
    id,
    docNo: Number(header.doc_no),
    key: operationKey("acceptance", id),
    cashbox: { id: numOrNull(header.cashbox_id), name: String(header.cashbox_name ?? ""), currency },
    agent: String(header.agent ?? ""),
    agentCashbox: header.agent_cashbox_id ? { id: Number(header.agent_cashbox_id), name: String(header.agent_cashbox_name ?? "") } : null,
    organization: String(header.organization ?? ""),
    branch: String(header.branch ?? ""),
    deliveryMan: String(header.delivery_man ?? ""),
    date: String(header.date_s ?? ""),
    comment: String(header.comment ?? ""),
    createdBy: String(header.created_by ?? ""),
    createdAt: String(header.created_s ?? ""),
    isDeleted: deleted,
    amount: deleted ? roundMoney(num(header.amount)) : roundMoney(payments.reduce((sum, payment) => sum + (payment.cashboxAmount ?? 0), 0)),
    currency,
    payments,
  }
}

export type UpdateAcceptanceInput = {
  /** New cash amounts (cashbox currency) of payments of this batch. */
  payments?: Array<{ id: number; amount: number }>
  branch?: string
  organization?: string
  cashboxId?: number
  /** "Ответственный персонал" (employees.id); null clears. */
  deliveryManId?: number | null
  /** "Дата принятия". */
  date?: string
  comment?: string
}

/** "Изменить транзакцию" of a type-8 row (demo group_payment_update). */
export async function updateAcceptance(id: number, input: UpdateAcceptanceInput, user: string): Promise<AcceptanceDetail> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  await withTransaction(async (tx) => {
    const header = (await tx.prepare("SELECT * FROM cash_acceptances WHERE id = @id FOR UPDATE").get({ id })) as Record<string, unknown> | undefined
    if (!header) throw new CashError("Операция не найдена", 404)
    if (num(header.is_deleted)) throw new CashError("Операция удалена", 409)
    const cashbox = await loadCashbox(tx, input.cashboxId ?? numOrNull(header.cashbox_id), cc.base)
    const rows = (await tx
      .prepare(
        `SELECT id, amount::float8 AS amount, currency, real_amount::float8 AS real_amount, real_currency, custom_rate, debt_rate
         FROM customer_payments WHERE accept_id = @id AND is_deleted = 0 ORDER BY id FOR UPDATE`,
      )
      .all({ id })) as Array<{ id: number; amount: number; currency: string; real_amount: number | null; real_currency: string; custom_rate: number | null; debt_rate: number | null }>
    const edits = new Map((input.payments ?? []).map((item) => [item.id, Number(item.amount)]))
    for (const paymentId of edits.keys()) if (!rows.some((row) => row.id === paymentId)) throw new CashError("Оплата не входит в эту приемку", 400, "payments")
    const date = input.date ? localDateTime(input.date) : String(header.date)
    const cashRate = pickRate(cashbox.currency, cc)
    let total = 0
    for (const row of rows) {
      const edited = edits.get(row.id)
      if (edited !== undefined && !(edited > 0)) throw new CashError("Укажите сумму", 400, "payments")
      const cash = edited ?? cashIn(row, cashbox, cc)
      const debtCur = normCurrency(row.currency, cc.base)
      let debt = num(row.amount)
      if (edited !== undefined) {
        if (debtCur === cashbox.currency) debt = cash
        else {
          const debtRate = pickRate(debtCur, cc, row.debt_rate)
          if (!cashRate || !debtRate) throw new CashError("Курс валюты не задан", 400, "currencyRate")
          debt = roundMoney((cash * cashRate) / debtRate, 5)
        }
      }
      total += cash
      // Only an edited amount fixes the cash side in the cashbox currency; other rows keep
      // their collected amount/currency (the ledger converts them at current rates).
      await tx
        .prepare(
          `UPDATE customer_payments SET cashbox_id = @cashboxId, kassa = @kassa, accepted_at = @acceptedAt,
             real_amount = CASE WHEN @edited::boolean THEN @cash::float8 ELSE real_amount END,
             real_currency = CASE WHEN @edited::boolean THEN @cur::text ELSE real_currency END,
             amount = @debt, amount_sum_equivalent = CASE WHEN @edited::boolean THEN @sumEq::float8 ELSE amount_sum_equivalent END,
             icon = @icon, cash_amount = @cashAmount, updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({
          id: row.id,
          edited: edited !== undefined,
          cashboxId: cashbox.id,
          kassa: cashbox.name,
          acceptedAt: russianDateTime(date),
          cash,
          cur: cashbox.currency,
          debt,
          sumEq: cashRate ? roundMoney(cash * cashRate) : null,
          icon: cashbox.type === "bank" ? "card" : "cash",
          cashAmount: cashbox.type === "bank" ? 0 : cash,
        })
    }
    const deliveryMan = input.deliveryManId ? await loadEmployee(tx, input.deliveryManId) : null
    await tx
      .prepare(
        `UPDATE cash_acceptances SET cashbox_id = @cashboxId, currency = @cur, amount = @amount, date = @date, branch = @branch, organization = @organization,
           delivery_man = @deliveryMan, delivery_man_id = @deliveryManId, comment = @comment, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        cashboxId: cashbox.id,
        cur: cashbox.currency,
        amount: roundMoney(total, 5),
        date,
        branch: input.branch?.trim() ?? String(header.branch ?? ""),
        organization: input.organization?.trim() ?? String(header.organization ?? ""),
        deliveryMan: input.deliveryManId === null ? "" : (deliveryMan?.name ?? String(header.delivery_man ?? "")),
        deliveryManId: input.deliveryManId === null ? null : (deliveryMan?.id ?? numOrNull(header.delivery_man_id)),
        comment: input.comment?.trim() ?? String(header.comment ?? ""),
      })
    void user
  })
  return (await getAcceptance(id))!
}

/** Removes one payment from an acceptance (it returns to "not accepted");
 * an acceptance left without payments is deleted. */
export async function detachPayment(acceptanceId: number, paymentId: number, user: string): Promise<AcceptanceDetail> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  await withTransaction(async (tx) => {
    const header = (await tx.prepare("SELECT * FROM cash_acceptances WHERE id = @id FOR UPDATE").get({ id: acceptanceId })) as Record<string, unknown> | undefined
    if (!header) throw new CashError("Операция не найдена", 404)
    if (num(header.is_deleted)) throw new CashError("Операция удалена", 409)
    const { changes } = await tx
      .prepare(
        `UPDATE customer_payments SET accepted = 0, cashbox_id = NULL, kassa = '', accept_id = NULL, accepted_at = '', accepted_by = '', updated_at = datetime('now')
         WHERE id = @paymentId AND accept_id = @id`,
      )
      .run({ id: acceptanceId, paymentId })
    if (!changes) throw new CashError("Оплата не входит в эту приемку", 404, "client_transaction")
    const left = (await tx.prepare("SELECT COUNT(*)::int AS n FROM customer_payments WHERE accept_id = @id AND is_deleted = 0").get({ id: acceptanceId })) as { n: number }
    if (!num(left.n)) {
      await tx
        .prepare("UPDATE cash_acceptances SET is_deleted = 1, deleted_at = @at, deleted_by = @user, amount = 0, updated_at = datetime('now') WHERE id = @id")
        .run({ id: acceptanceId, at: nowLocalIso(), user })
    } else {
      const amount = await liveAcceptanceAmount(tx, acceptanceId, cc.base)
      await tx.prepare("UPDATE cash_acceptances SET amount = @amount, updated_at = datetime('now') WHERE id = @id").run({ id: acceptanceId, amount })
    }
  })
  return (await getAcceptance(acceptanceId))!
}
