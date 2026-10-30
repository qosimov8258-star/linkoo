import "server-only"

import type { PgDb } from "@/lib/db"
import { roundMoney } from "@/lib/finance/currency"

// The one writer of customer_payments rows (demo client_transaction type 1),
// shared by "Групповой приход" (lib/finance/group-payment.ts) and the cash
// core (lib/cash: Kirim with a client/order option, group income, expected
// order payments). The ledger reads these rows as the client's `payment`
// (amount/currency = credited to the client) and, once accepted, as income of
// cashbox_id (real_amount/real_currency = cash in the cashbox).

const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** "09 октября 2026, 14:05" — the paid_at/accepted_at text customer/supplier payments display. */
export function russianDateTime(localIso: string): string {
  const [y, m, d] = localIso.slice(0, 10).split("-").map(Number)
  return `${String(d).padStart(2, "0")} ${MONTHS_GENITIVE[m - 1]} ${y}, ${localIso.slice(11, 16) || "00:00"}`
}

export type CustomerPaymentValues = {
  client: { id: number; name: string; code?: string | null }
  /** null = agent collection (not in any cashbox yet). */
  cashbox: { id: number; name: string; currency: string; isBank: boolean } | null
  /** Credited to the client (debt side). */
  amount: number
  currency: string
  /** Cash side; default = amount / currency. */
  realAmount?: number | null
  realCurrency?: string
  /** Base-currency equivalent (demo `internal`). */
  sumEquivalent: number | null
  /** Local "YYYY-MM-DDTHH:mm[:ss]" business date of the payment. */
  date: string
  accepted: boolean
  /** Local date-time of the acceptance (default = date). */
  acceptedAt?: string
  acceptedBy?: string
  organization?: string
  branch?: string
  deliveryMan?: string
  deliveryManId?: number | null
  incomeCategory?: string
  incomeCategoryId?: number | null
  comment?: string
  createdBy: string
  opType?: number | null
  orderId?: number | null
  contractId?: number | null
  contract?: string
  customRate?: number | null
  debtRate?: number | null
  rateType?: string
  agent?: string
  agentCashboxId?: number | null
  /** Keep an existing document number (edit that moves a row between tables). */
  docNo?: number | null
}

/** Column values of a customer_payments row (insert and in-place update share them). */
export function customerPaymentColumns(v: CustomerPaymentValues): Record<string, unknown> {
  const realAmount = v.realAmount ?? v.amount
  const accepted = v.accepted && v.cashbox !== null
  return {
    client: v.client.name,
    client_code: v.client.code || null,
    client_id: v.client.id,
    paid_at: russianDateTime(v.date),
    payment_date: v.date,
    accepted_at: accepted ? russianDateTime(v.acceptedAt || v.date) : "",
    accepted_by: accepted ? (v.acceptedBy ?? v.createdBy) : "",
    accepted: accepted ? 1 : 0,
    agent: v.agent ?? "",
    organization: v.organization?.trim() ?? "",
    amount: v.amount,
    currency: v.currency,
    amount_sum_equivalent: v.sumEquivalent === null ? null : roundMoney(v.sumEquivalent),
    real_amount: realAmount,
    real_currency: v.realCurrency || v.currency,
    // Legacy "Сумма в кассе" display: cash only (bank cashboxes show 0), like the original group payment.
    cash_amount: v.cashbox && !v.cashbox.isBank ? realAmount : 0,
    kassa: v.cashbox?.name ?? "",
    cashbox_id: v.cashbox?.id ?? null,
    comment: v.comment?.trim() || "Не указано",
    icon: v.cashbox?.isBank ? "card" : "cash",
    branch: v.branch?.trim() ?? "",
    delivery_man: v.deliveryMan?.trim() ?? "",
    delivery_man_id: v.deliveryManId ?? null,
    income_category: v.incomeCategory?.trim() ?? "",
    income_category_id: v.incomeCategoryId ?? null,
    op_type: v.opType ?? null,
    order_id: v.orderId ?? null,
    contract_id: v.contractId ?? null,
    contract: v.contract ?? "",
    custom_rate: v.customRate ?? null,
    debt_rate: v.debtRate ?? null,
    rate_type: v.rateType ?? "",
    agent_cashbox_id: v.agentCashboxId ?? null,
  }
}

/** Advisory lock namespace, pg_advisory_xact_lock(key, clientId). It serialises the writers of one client's money that
 * the order remainders depend on (lib/cash/orders.ts spreads a client's credits over all of its orders):
 * - an order payment and its edit take it before they read the order's remainder (lib/cash/orders.ts lockOrderPayments);
 * - client incomes take it too: cash "Приход" with a client, "Груповой приход" of the cash page and of the balance
 *   pages, and the client card's payment.
 * So a parallel payment re-reads the remainder after the first one has committed and never overpays the order.
 * Lock order: cashbox row locks (lib/cash/guard.ts) first, then this lock, never the other way round; several clients
 * are locked in ascending id order. */
const CLIENT_PAYMENTS_LOCK = 72120904

/** Takes the client-payments lock of each client (inside the transaction; ids that are not int4 ids are skipped). */
export async function lockClientPayments(tx: PgDb, clientIds: ReadonlyArray<number | null | undefined>): Promise<void> {
  const ids = [...new Set(clientIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2147483647))]
  ids.sort((a, b) => a - b)
  for (const id of ids) await tx.prepare("SELECT pg_advisory_xact_lock(@key::int, @id::int) AS ok").get({ key: CLIENT_PAYMENTS_LOCK, id })
}

/** INSERT of one customer payment (call inside withTransaction after
 * ensureFinanceSchema, which guarantees the extension columns). */
export async function insertCustomerPayment(tx: PgDb, v: CustomerPaymentValues): Promise<{ id: number; docNo: number }> {
  const columns = { ...customerPaymentColumns(v), created_by: v.createdBy, ...(v.docNo ? { doc_no: v.docNo } : {}) }
  const names = Object.keys(columns)
  const row = (await tx
    .prepare(`INSERT INTO customer_payments (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")}) RETURNING id, doc_no`)
    .get(columns)) as { id: number; doc_no: string | number }
  return { id: Number(row.id), docNo: Number(row.doc_no) }
}
