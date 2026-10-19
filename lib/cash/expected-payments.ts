import "server-only"

import { getDb } from "@/lib/db"
import { nameKey } from "@/lib/finance/entities"
import { CashError, currencyContext, loadCategories } from "@/lib/cash/common"
import { orderDue, orderDues, type OrderDue } from "@/lib/cash/orders"
import { ensureCashSchema } from "@/lib/cash/schema"
import { createCashOperation } from "@/lib/cash/write"
import type { CashOperationInput, CashWriteResult } from "@/lib/cash/types"

// "Ожидаемые оплаты": orders (not cancelled) with an unpaid remainder, one row
// per order × currency, and the pay action (the shared "Приход" dialog in
// order mode → customer_payments op 3 with order_id).

export type ExpectedPaymentsQuery = {
  /** Order id (exact) or client-name substring. */
  search?: string
  clientIds?: number[]
  /** orders.status values (Есть на складе / В пути / Доставлено). */
  statuses?: string[]
  /** orders.created_at day range. */
  from?: string
  to?: string
  /** Default true: only remaining > 0. */
  onlyOpen?: boolean
  /** id | created | total | remaining, "-" = desc; default "-id". */
  ordering?: string
  page?: number
  /** Default 25; 0 = all. */
  pageSize?: number
}

export type ExpectedPaymentRow = {
  key: string
  orderId: number
  client: { id: number | null; name: string }
  zone: string
  agent: string
  status: string
  createdAt: string
  delivery: string
  currency: string
  total: number
  paid: number
  remaining: number
}

export type ExpectedPaymentsResult = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  rows: ExpectedPaymentRow[]
  totals: Array<{ currency: string; total: number; paid: number; remaining: number }>
}

function flatten(dues: OrderDue[]): ExpectedPaymentRow[] {
  return dues.flatMap((due) =>
    due.currencies.map((part) => ({
      key: `${due.id}-${part.currency}`,
      orderId: due.id,
      client: { id: due.clientId, name: due.client },
      zone: due.zone,
      agent: due.agent,
      status: due.status,
      createdAt: due.createdAt,
      delivery: due.delivery,
      currency: part.currency,
      total: part.total,
      paid: part.paid,
      remaining: part.remaining,
    })),
  )
}

export async function listExpectedPayments(query: ExpectedPaymentsQuery): Promise<ExpectedPaymentsResult> {
  const db = getDb()
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  let rows = flatten(await orderDues(db, null, cc)).filter((row) => row.status !== "Отменен")
  if (query.onlyOpen !== false) rows = rows.filter((row) => row.remaining > 0.005)
  const search = nameKey(query.search)
  if (search) rows = rows.filter((row) => String(row.orderId) === search || nameKey(row.client.name).includes(search))
  if (query.clientIds?.length) rows = rows.filter((row) => row.client.id !== null && query.clientIds!.includes(row.client.id))
  if (query.statuses?.length) rows = rows.filter((row) => query.statuses!.includes(row.status))
  if (query.from) rows = rows.filter((row) => row.createdAt.slice(0, 10) >= query.from!)
  if (query.to) rows = rows.filter((row) => row.createdAt.slice(0, 10) <= query.to!)
  const ordering = String(query.ordering ?? "-id")
  const desc = ordering.startsWith("-")
  const field = ordering.replace(/^-/, "")
  const value = (row: ExpectedPaymentRow): number | string =>
    field === "created" ? row.createdAt : field === "total" ? row.total : field === "remaining" ? row.remaining : row.orderId
  rows.sort((a, b) => {
    const x = value(a)
    const y = value(b)
    const cmp = x < y ? -1 : x > y ? 1 : a.orderId - b.orderId
    return desc ? -cmp : cmp
  })
  const totals = new Map<string, { currency: string; total: number; paid: number; remaining: number }>()
  for (const row of rows) {
    const item = totals.get(row.currency) ?? { currency: row.currency, total: 0, paid: 0, remaining: 0 }
    item.total += row.total
    item.paid += row.paid
    item.remaining += row.remaining
    totals.set(row.currency, item)
  }
  const pageSize = query.pageSize === 0 ? 0 : Math.max(1, Math.floor(query.pageSize ?? 25))
  const page = Math.max(1, Math.floor(query.page ?? 1))
  return {
    baseCurrency: cc.base,
    count: rows.length,
    page,
    pageSize,
    rows: pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows,
    totals: [...totals.values()].map((item) => ({
      currency: item.currency,
      total: Math.round(item.total * 100) / 100,
      paid: Math.round(item.paid * 100) / 100,
      remaining: Math.round(item.remaining * 100) / 100,
    })),
  }
}

/** Order header for the pay dialog (totals / paid / remaining per currency). */
export async function getOrderDue(orderId: number): Promise<OrderDue | null> {
  const db = getDb()
  await ensureCashSchema(db)
  return orderDue(db, orderId, await currencyContext(db))
}

export type PayOrderInput = Omit<CashOperationInput, "kind" | "orderId" | "moneyRequestId" | "supplierId" | "supplyId">

/** Pays an order: an income in order mode (customer_payments op 3). Category
 * defaults to the first income category with the "order" option. */
export async function payOrder(orderId: number, input: PayOrderInput, user: string): Promise<CashWriteResult> {
  const db = getDb()
  await ensureCashSchema(db)
  const categories = (await loadCategories(db)).filter((category) => category.kind === "income")
  let categoryId = input.categoryId
  if (categoryId) {
    const category = categories.find((item) => item.id === categoryId)
    if (category && !category.options.includes("order")) throw new CashError("Категория прихода без опции «Заказ»", 400, "incomeCategory")
  } else {
    categoryId = categories.find((category) => category.options.includes("order"))?.id
  }
  return createCashOperation({ ...input, kind: "income", orderId, categoryId }, user)
}
