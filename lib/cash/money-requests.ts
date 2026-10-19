import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { nameKey } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { CashError, num } from "@/lib/cash/common"
import { appendLog, lockFundRequest, parseLog, requestStatus } from "@/lib/cash/request-links"
import { ensureCashSchema } from "@/lib/cash/schema"
import { createCashOperation } from "@/lib/cash/write"
import { operationKey, type CashOperationInput, type CashWriteResult, type MoneyRequest, type MoneyRequestStatus } from "@/lib/cash/types"

// Money requests ("Запрос средств" / "Ожидаемые расходы", demo
// finance/money_request): supplier_balance_transactions rows with kind
// 'fund_request'. Lifecycle: pending → approved (amount/currency may change)
// → given (only by a supplier payment with money_request_id) ; pending |
// approved → cancelled. given / cancelled are final. The supplier ledger counts
// pending + approved as "Запросы в ожидании" (money_request).
// Created on Баланс поставщиков (POST /api/supplier-balance-transactions kind fund_request).

export type MoneyRequestsQuery = {
  /** "" / undefined = all. */
  status?: MoneyRequestStatus | ""
  /** Digits only = request id (exact); else a supplier / comment substring. */
  search?: string
  supplierIds?: number[]
  /** id | date | amount | debt ("-" = desc); default "-id". */
  ordering?: string
  page?: number
  /** Default 25; 0 = all. */
  pageSize?: number
}

type RequestRow = {
  id: number
  supplier_id: number
  supplier_name: string | null
  currency: string
  amount: number
  comment: string
  status: string
  created_by: string
  created_s: string
  responsible_user: string
  approved_at: string
  payment_id: number | null
  payment_doc: string | number | null
  log: string
}

async function hasTable(db: PgDb): Promise<boolean> {
  return ((await db.prepare("SELECT to_regclass('supplier_balance_transactions') IS NOT NULL AS ok").get()) as { ok: boolean }).ok
}

const SELECT = `SELECT t.id, t.supplier_id, s.name AS supplier_name, t.currency, t.amount::float8 AS amount, t.comment, t.status, t.created_by,
    COALESCE(to_char(COALESCE(fin_ts(t.created_at, true), fin_ts(t.date)), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS created_s,
    t.responsible_user, t.approved_at, t.payment_id, sp.doc_no AS payment_doc, t.log
  FROM supplier_balance_transactions t LEFT JOIN suppliers s ON s.id = t.supplier_id
  LEFT JOIN supplier_payments sp ON sp.id = t.payment_id
  WHERE t.kind = 'fund_request'`

async function supplierBalances(db: PgDb, rows: RequestRow[]): Promise<Map<string, { balance: number; reserve: number; remain: number }>> {
  const keys = [...new Set(rows.map((row) => String(row.supplier_id)))]
  const out = new Map<string, { balance: number; reserve: number; remain: number }>()
  if (!keys.length) return out
  const today = todayIso()
  const list = await getBalanceList("supplier", { from: today, to: today, keys, pageSize: 0 }, db)
  for (const row of list.rows) {
    for (const [code, balance] of Object.entries(row.currencies)) {
      out.set(`${row.key}:${code}`, { balance: num(balance.end_balance), reserve: num(balance.reserve), remain: num(balance.remain) })
    }
  }
  return out
}

function toRequest(row: RequestRow, balances: Map<string, { balance: number; reserve: number; remain: number }>): MoneyRequest {
  const currency = normCurrency(row.currency)
  return {
    id: row.id,
    supplier: { id: row.supplier_id, name: row.supplier_name ?? "" },
    amount: roundMoney(Math.abs(num(row.amount))),
    currency,
    comment: row.comment ?? "",
    status: requestStatus(row.status),
    createdBy: row.created_by ?? "",
    createdAt: row.created_s,
    responsibleUser: row.responsible_user ?? "",
    approvedAt: row.approved_at ?? "",
    payment: row.payment_id ? { key: operationKey("supplier", row.payment_id), docNo: Number(row.payment_doc ?? 0) } : null,
    balances: balances.get(`${row.supplier_id}:${currency}`) ?? { balance: 0, reserve: 0, remain: 0 },
    logs: parseLog(row.log),
  }
}

const ORDER: Record<string, string> = { id: "t.id", date: "t.created_at", amount: "t.amount" }

/** List by status with the supplier balances (Ожидаемые расходы tabs, cash-page "Запрос средств" with status approved). */
export async function listMoneyRequests(query: MoneyRequestsQuery, db: PgDb = getDb()): Promise<{ count: number; page: number; pageSize: number; rows: MoneyRequest[] }> {
  await ensureCashSchema(db)
  const pageSize = query.pageSize === 0 ? 0 : Math.max(1, Math.floor(query.pageSize ?? 25))
  const page = Math.max(1, Math.floor(query.page ?? 1))
  if (!(await hasTable(db))) return { count: 0, page, pageSize, rows: [] }
  const status = query.status ?? ""
  const statuses = status === "pending" ? ["", "pending"] : status === "cancelled" ? ["cancelled", "rejected"] : status ? [status] : []
  const search = nameKey(query.search)
  const where = `AND (cardinality(@statuses::text[]) = 0 OR t.status = ANY(@statuses::text[]))
    AND (cardinality(@suppliers::int[]) = 0 OR t.supplier_id = ANY(@suppliers::int[]))
    AND (@q::text = '' OR (@qnum::int >= 0 AND t.id = @qnum::int) OR (@qnum::int < 0 AND strpos(fin_key(concat_ws(' ', s.name, t.comment)), @q::text) > 0))`
  const params = { statuses, suppliers: query.supplierIds ?? [], q: search, qnum: /^\d{1,9}$/.test(search) ? Number(search) : -1 }
  const ordering = String(query.ordering ?? "-id")
  const desc = ordering.startsWith("-")
  const field = ordering.replace(/^-/, "")
  const sortByDebt = field === "debt"
  const order = `${ORDER[field] ?? "t.id"} ${desc ? "DESC" : "ASC"}, t.id DESC`
  const count = (await db.prepare(`SELECT COUNT(*)::int AS n FROM (${SELECT} ${where}) x`).get(params)) as { n: number }
  const paging = pageSize && !sortByDebt ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await db.prepare(`${SELECT} ${where} ORDER BY ${order}${paging}`).all(params)) as RequestRow[]
  const balances = await supplierBalances(db, rows)
  let result = rows.map((row) => toRequest(row, balances))
  if (sortByDebt) {
    result.sort((a, b) => (desc ? b.balances.balance - a.balances.balance : a.balances.balance - b.balances.balance))
    if (pageSize) result = result.slice((page - 1) * pageSize, page * pageSize)
  }
  return { count: num(count.n), page, pageSize, rows: result }
}

export async function getMoneyRequest(id: number, db: PgDb = getDb()): Promise<MoneyRequest | null> {
  await ensureCashSchema(db)
  if (!(await hasTable(db))) return null
  const row = (await db.prepare(`${SELECT} AND t.id = @id`).get({ id })) as RequestRow | undefined
  if (!row) return null
  return toRequest(row, await supplierBalances(db, [row]))
}

export type MoneyRequestUpdate = {
  /** approved = "Подтвердить" / "Изменить"; cancelled = "Отменить" / cash-page "Удалить". */
  status: "approved" | "cancelled"
  amount?: number
  currency?: string
  comment?: string
}

/** Approve / edit / cancel (demo PUT finance/money_request/<id> {provider, amount, currency, status}). */
export async function updateMoneyRequest(id: number, input: MoneyRequestUpdate, user: string): Promise<MoneyRequest> {
  await ensureCashSchema()
  await withTransaction(async (tx) => {
    const request = await lockFundRequest(tx, id)
    const status = requestStatus(request.status)
    if (status === "given" || status === "cancelled") throw new CashError("Запрос уже закрыт", 409, "status")
    const amount = input.amount !== undefined ? Number(input.amount) : request.amount
    if (!(amount > 0)) throw new CashError("Укажите сумму", 400, "amount")
    const currency = input.currency ? normCurrency(input.currency) : request.currency
    const now = nowLocalIso()
    const approving = input.status === "approved"
    await tx
      .prepare(
        `UPDATE supplier_balance_transactions SET status = @status, amount = @amount, currency = @currency, comment = @comment,
           responsible_user = @responsible, approved_at = @approvedAt, log = @log, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        status: input.status,
        amount,
        currency,
        comment: input.comment?.trim() ?? request.comment,
        responsible: approving ? user : request.responsible_user,
        approvedAt: approving ? (status === "approved" ? request.approved_at || now : now) : request.approved_at,
        log: appendLog(request.log, {
          status: approving && status === "approved" ? "edited" : input.status,
          comment: input.comment?.trim() ?? "",
          user,
          amount,
          currency,
        }),
      })
  })
  return (await getMoneyRequest(id))!
}

/** Cash side of the payment; categoryId (expense category) is optional here. */
export type PayMoneyRequestInput = Omit<CashOperationInput, "kind" | "moneyRequestId" | "supplierId">

/** "Оплатить": a supplier payment (cash «Расход») for an approved request;
 * the request becomes "given". amount defaults to the request amount
 * converted into the cashbox currency. */
export async function payMoneyRequest(id: number, input: PayMoneyRequestInput, user: string): Promise<CashWriteResult> {
  return createCashOperation({ ...input, kind: "expense", moneyRequestId: id, isVerified: input.isVerified ?? true }, user)
}
