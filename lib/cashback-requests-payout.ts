import "server-only"

import type { PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { CashError, loadCashbox, loadClient, localDateTime, loyaltyCurrency, pickRate, type CashboxInfo } from "@/lib/cash/common"
import { CASH_OP, CASH_OP_LABELS } from "@/lib/cash/types"

// Cashback payout of a confirmed "Запрос на снятие кэшбэка", written INSIDE the
// caller's transaction (the request status changes in the same one).
//
// The rows are exactly what the cash core writes for "Расход" with a category
// whose option is client_contract / client_card_out (lib/cash/write.ts →
// resolvePlan "expense + client_card_out/client_contract" + cashEntryValues +
// addCashExtras):
//   cash_management_entries   op_type 22 "Выдача денег для кэшбека <client>", client_id,
//                             −amount in the cashbox currency, verified, current rate
//   loyalty_card_transactions client −amount (sum/usd/euro), transaction_id = entry id
// so the cash list, every balance page (cashbox ledger, management "Кешбэк
// покупателей"), "Накопительная карта" and the cash page's edit / delete
// (which remove the loyalty row) treat it like any other op-22 payout.
// The demo confirmation only picks a cashbox, so the entry has no expense
// category (the cash page asks for one only if the operation is edited there).
// createCashOperation() is not used because it opens its own transaction and
// requires a category with the cashback option.

export type CashbackPayoutInput = {
  cashboxId: number
  clientId: number
  /** > 0, in `currency` (= the cashbox currency). */
  amount: number
  currency: string
  /** Cash entry comment. */
  comment: string
  user: string
}

export type CashbackPayoutResult = { entryId: number; docNo: number; cashbox: CashboxInfo }

export async function insertCashbackPayout(tx: PgDb, input: CashbackPayoutInput, cc: CurrencyContext): Promise<CashbackPayoutResult> {
  const cashbox = await loadCashbox(tx, input.cashboxId, cc.base)
  if (cashbox.currency !== normCurrency(input.currency, cc.base)) {
    throw new CashError("Валюта кассы не совпадает с валютой запроса", 400, "cashbox")
  }
  const client = await loadClient(tx, input.clientId)
  const amount = roundMoney(input.amount, 5)
  if (!(amount > 0)) throw new CashError("Укажите сумму", 400, "amount")

  const op = CASH_OP.CLIENT_CONTRACT_OUT
  const signed = -amount
  const cashRate = pickRate(cashbox.currency, cc)
  const now = nowLocalIso()
  const values: Record<string, unknown> = {
    cashbox_id: cashbox.id,
    description: `${CASH_OP_LABELS[op]} ${client.name}`,
    category: "",
    client_name: client.name,
    branch: "",
    organization: "",
    comment: input.comment,
    entry_date: localDateTime(undefined),
    amount: signed,
    op_type: op,
    income_category_id: null,
    expense_category_id: null,
    client_id: client.id,
    supply_id: null,
    supply_expense_id: null,
    employee_id: null,
    employee_name: "",
    currency: cashbox.currency,
    payment_type: cashbox.type,
    internal_amount: cashRate ? roundMoney(signed * cashRate, 5) : null,
    custom_rate: cashRate,
    rate_type: "current",
    is_verified: 1,
    verified_at: now,
    verified_by: input.user,
    amortization_from: "",
    amortization_to: "",
    created_by: input.user,
  }
  const names = Object.keys(values)
  const entry = (await tx
    .prepare(`INSERT INTO cash_management_entries (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")}) RETURNING id, doc_no`)
    .get(values)) as { id: number; doc_no: string | number }
  const entryId = Number(entry.id)
  const docNo = Number(entry.doc_no)

  await tx
    .prepare(
      `INSERT INTO loyalty_card_transactions (client_id, currency, amount, comment, transaction_id, type, created_by)
       VALUES (@clientId, @currency, @amount, @comment, @entryId, 'withdraw', @user)`,
    )
    .run({
      clientId: client.id,
      currency: loyaltyCurrency(cashbox.currency),
      amount: signed,
      comment: `${CASH_OP_LABELS[op]} № ${docNo}`,
      entryId,
      user: input.user,
    })
  return { entryId, docNo, cashbox }
}
