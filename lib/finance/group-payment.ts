import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { insertCustomerPayment, lockClientPayments } from "@/lib/finance/customer-payment"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { innKey, nameKey } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// "Групповой приход" (group payment) shared by Баланс клиентов and Долги по
// счетам: one customer payment per selected client, in the cashbox currency.
// Rows go to customer_payments (the client ledger's payment source), so they
// show up as "Оплачено" on the client/account balance, as income of the
// cashbox on Баланс кассы (accepted ones only) and on "Оплаты от клиентов",
// where not yet confirmed ones (isVerified = false) can be accepted later.

export class FinanceInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export type GroupPaymentItem = {
  /** BalanceRow.key: a clients.id ("12") or an account key ("inn:123456789"). */
  key: string
  amount: number
  comment?: string
}

export type GroupPaymentInput = {
  /** ISO day or local date-time ("2026-10-09" / "2026-10-09T14:05"); default now. */
  date?: string
  cashboxId: number
  /** Organization (division) name — required like in the demo. */
  organization: string
  branch?: string
  /** Income category id (income_categories.id); wins over the name. */
  incomeCategoryId?: number | null
  /** Income category name (income_categories.name), resolved to its id. */
  incomeCategory?: string
  deliveryMan?: string
  /** "Подтвержденный приход (Я получил деньги)": accepted into the cashbox now. Default true. */
  isVerified?: boolean
  /** "current" = currencies.rate, "custom" = customRate (base units per 1 unit), only for the base equivalent. */
  rateType?: "current" | "custom"
  customRate?: number
  comment?: string
  items: GroupPaymentItem[]
}

export type GroupPaymentResult = { ids: number[]; currency: string; total: number; accepted: boolean }

/** Income category of a payment: by id, else by name (case/space-insensitive,
 * lowest id), so customer_payments.income_category_id is always stored and the
 * cash page can edit the row. null = no category chosen ("Не указано"). */
async function resolveIncomeCategory(db: PgDb, id: number | null, name: string): Promise<{ id: number; name: string } | null> {
  if (!id && !nameKey(name)) return null
  const exists = (await db.prepare("SELECT to_regclass('income_categories') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) throw new FinanceInputError("Категория не найдена", 404)
  const row = (
    id
      ? await db.prepare("SELECT id, name FROM income_categories WHERE id = @id").get({ id })
      : await db.prepare("SELECT id, name FROM income_categories WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })
  ) as { id: number; name: string } | undefined
  if (!row) throw new FinanceInputError("Категория не найдена", 404)
  return { id: Number(row.id), name: String(row.name) }
}

export async function createGroupPayment(input: GroupPaymentInput, createdBy: string): Promise<GroupPaymentResult> {
  const db = getDb()
  const schema = await ensureFinanceSchema(db)
  const items = input.items.filter((item) => item.amount > 0)
  if (!items.length) throw new FinanceInputError("Укажите сумму оплаты")
  if (!input.organization.trim()) throw new FinanceInputError("Организация обязательна")

  const cashbox = (await db.prepare("SELECT id, name, currency, payment_type FROM cashboxes WHERE id = @id").get({ id: input.cashboxId })) as
    | { id: number; name: string; currency: string; payment_type: string }
    | undefined
  if (!cashbox) throw new FinanceInputError("Касса не найдена", 404)

  const code = schema.col("clients", "code") ? "code" : "''"
  const clients = (await db.prepare(`SELECT id, name, COALESCE(inn, '') AS inn, ${code} AS code FROM clients ORDER BY id`).all()) as Array<{
    id: number
    name: string
    inn: string
    code: string
  }>
  const byId = new Map(clients.map((client) => [String(client.id), client]))
  const byInn = new Map<string, (typeof clients)[number]>()
  for (const client of clients) {
    const inn = innKey(client.inn)
    if (inn && !byInn.has(inn)) byInn.set(inn, client)
  }
  const resolved = items.map((item) => {
    const client = item.key.startsWith("inn:") ? byInn.get(item.key.slice(4)) : byId.get(item.key)
    if (!client) throw new FinanceInputError("Клиент не найден", 404)
    return { client, amount: item.amount, comment: item.comment?.trim() || input.comment?.trim() || "" }
  })

  const category = await resolveIncomeCategory(db, input.incomeCategoryId ?? null, input.incomeCategory ?? "")

  const currency = normCurrency(cashbox.currency)
  const cc = await loadCurrencyContext(db)
  const rate = input.rateType === "custom" && input.customRate && input.customRate > 0 ? input.customRate : (cc.rates[currency] ?? null)
  const localDate = parseAnyDate(input.date) ?? nowLocalIso()
  const accepted = input.isVerified !== false
  const isBank = /^(банк|bank|card|переч)/.test(nameKey(cashbox.payment_type))

  const ids = await withTransaction(async (tx) => {
    // The clients' credits change what their orders still owe: same lock as the order payments (lib/cash/orders.ts),
    // every client up front in ascending id order.
    await lockClientPayments(tx, resolved.map((row) => row.client.id))
    const created: number[] = []
    for (const row of resolved) {
      const { id } = await insertCustomerPayment(tx, {
        client: { id: row.client.id, name: row.client.name, code: row.client.code || null },
        cashbox: { id: cashbox.id, name: cashbox.name, currency, isBank },
        amount: row.amount,
        currency,
        sumEquivalent: rate ? row.amount * rate : null,
        date: localDate,
        accepted,
        acceptedBy: createdBy,
        organization: input.organization.trim(),
        branch: input.branch?.trim() ?? "",
        deliveryMan: input.deliveryMan?.trim() ?? "",
        incomeCategory: category?.name ?? "",
        incomeCategoryId: category?.id ?? null,
        comment: row.comment,
        createdBy,
        opType: 6,
        customRate: input.rateType === "custom" && input.customRate && input.customRate > 0 ? input.customRate : null,
        rateType: input.rateType ?? "",
      })
      created.push(id)
    }
    return created
  })
  return { ids, currency, total: roundMoney(resolved.reduce((sum, row) => sum + row.amount, 0)), accepted }
}
