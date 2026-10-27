import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { CashError, currencyContext, isoDayOrEmpty, loadCashbox, localDateTime, MAX_MONEY, pickRate, resolveOrganization } from "@/lib/cash/common"
import { guardCashboxBalances } from "@/lib/cash/guard"
import { resolveTransfer } from "@/lib/cash/rates"
import { ensureCashSchema } from "@/lib/cash/schema"
import { CASH_OP, operationKey, type CashTransferInput, type CashTransferResult } from "@/lib/cash/types"

// "Перевод" (demo finance/transfer): a cash_transfers header and two
// cash_management_entries legs sharing transfer_id — op 1 (−amountFrom, source
// cashbox, "Перевод в <to>") and op 2 (+amountTo, target, "Перевод из <from>"),
// category 'Перевод' kept for older readers. Cross-currency transfers carry
// their own amounts; the branch ledger pairs the legs by transfer_id.
// A transfer never creates money (resolveTransfer in lib/cash/rates.ts): the
// same currency and type moves the same amount, cash ↔ bank allows a bounded
// commission (50…100 %), and a cross-currency transfer receives, at the currency
// table's rates, between 90 % and 102 % of the value sent.
// The source cashbox never ends overdrawn (lib/cash/guard.ts). Organizations
// default to the cashbox's (its cashier's single organization), then to the
// other side's, then to the only organization.

export async function createTransfer(input: CashTransferInput, user: string): Promise<CashTransferResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  if (input.fromCashboxId === input.toCashboxId) throw new CashError("Выберите другую кассу", 400, "toCashbox")
  return withTransaction(async (tx) =>
    guardCashboxBalances(tx, [input.fromCashboxId], cc.base, () => insertTransfer(tx, input, user, cc), "amountFrom"),
  )
}

async function insertTransfer(tx: PgDb, input: CashTransferInput, user: string, cc: CurrencyContext): Promise<CashTransferResult> {
  const from = await loadCashbox(tx, input.fromCashboxId, cc.base, "fromCashbox")
  const to = await loadCashbox(tx, input.toCashboxId, cc.base, "toCashbox")
  const amountFrom = Number(input.amountFrom)
  if (!Number.isFinite(amountFrom) || amountFrom <= 0 || amountFrom > MAX_MONEY) throw new CashError("Укажите сумму", 400, "amountFrom")
  // A transfer never creates money (lib/cash/rates.ts resolveTransfer): same currency and type →
  // amountTo = amountFrom; cash ↔ bank → a bounded "Процент"; different currencies → a rate close
  // to the currency table.
  const resolved = resolveTransfer({
    amountFrom,
    fromCurrency: from.currency,
    toCurrency: to.currency,
    fromType: from.type,
    toType: to.type,
    baseCurrency: cc.base,
    rates: cc.rates,
    amountTo: input.amountTo ?? null,
    rate: input.rate && input.rate > 0 ? input.rate : null,
    percentage: input.percentage ?? null,
  })
  if (!resolved.ok) throw new CashError(resolved.error, 400, resolved.field)
  const { amountTo, rate } = resolved
  if (!(amountTo > 0) || amountTo > MAX_MONEY) throw new CashError("Укажите сумму", 400, "amountTo")
  const date = localDateTime(input.date)
  const accFrom = isoDayOrEmpty(input.accumulatedFrom, "accumulatedMoney")
  const accTo = isoDayOrEmpty(input.accumulatedTo, "accumulatedMoney")
  const fromBranch = input.fromBranch?.trim() || from.branch
  const toBranch = input.toBranch?.trim() || to.branch
  const comment = input.comment?.trim() ?? ""
  const explicitFrom = input.fromOrganization?.trim() ? await resolveOrganization(tx, input.fromOrganization, {}, "fromOrganization") : ""
  const explicitTo = input.toOrganization?.trim() ? await resolveOrganization(tx, input.toOrganization, {}, "toOrganization") : ""
  const ownFrom = explicitFrom || (await resolveOrganization(tx, "", { cashboxId: from.id }))
  const ownTo = explicitTo || (await resolveOrganization(tx, "", { cashboxId: to.id }))
  const fromOrg = explicitFrom || ownFrom || ownTo
  const toOrg = explicitTo || ownTo || fromOrg

  const header = (await tx
    .prepare(
      `INSERT INTO cash_transfers (from_cashbox_id, to_cashbox_id, from_currency, to_currency, amount_from, amount_to, rate, percentage,
         from_organization, to_organization, from_branch, to_branch, date, comment, accumulated_from, accumulated_to, created_by)
       VALUES (@fromId, @toId, @fromCur, @toCur, @amountFrom, @amountTo, @rate, @percentage, @fromOrg, @toOrg, @fromBranch, @toBranch,
         @date, @comment, @accFrom, @accTo, @user) RETURNING id, doc_no`,
    )
    .get({
      fromId: from.id,
      toId: to.id,
      fromCur: from.currency,
      toCur: to.currency,
      amountFrom,
      amountTo,
      rate,
      percentage: resolved.percentage ?? 0,
      fromOrg,
      toOrg,
      fromBranch,
      toBranch,
      date,
      comment,
      accFrom,
      accTo,
      user,
    })) as { id: number; doc_no: string | number }
  const transferId = Number(header.id)
  const now = nowLocalIso()
  // Base rate of a leg: the demo "Курс" when it prices that (non-base) side, else the current rate.
  const legRate = (currency: string) => {
    if (rate && from.currency !== to.currency) {
      if (to.currency === cc.base && currency === from.currency) return rate
      if (from.currency === cc.base && currency === to.currency) return rate
    }
    return pickRate(currency, cc)
  }
  const leg = async (op: number, cashboxId: number, currency: string, type: string, amount: number, description: string, organization: string, branch: string) => {
    const rateOfLeg = legRate(currency)
    const row = (await tx
      .prepare(
        `INSERT INTO cash_management_entries (cashbox_id, description, category, client_name, branch, organization, comment, entry_date, amount,
           created_by, op_type, transfer_id, currency, payment_type, internal_amount, custom_rate, rate_type, is_verified, verified_at, verified_by)
         VALUES (@cashboxId, @description, 'Перевод', '', @branch, @organization, @comment, @date, @amount,
           @user, @op, @transferId, @currency, @type, @internal, @rate, 'current', 1, @now, @user) RETURNING id, doc_no`,
      )
      .get({
        cashboxId,
        description,
        branch,
        organization,
        comment,
        date,
        amount,
        user,
        op,
        transferId,
        currency,
        type,
        internal: rateOfLeg ? roundMoney(amount * rateOfLeg, 5) : null,
        rate: rateOfLeg,
        now,
      })) as { id: number; doc_no: string | number }
    return { key: operationKey("cash", Number(row.id)), source: "cash" as const, id: Number(row.id), docNo: Number(row.doc_no) }
  }
  const outLeg = await leg(CASH_OP.FROM_TRANSFER, from.id, from.currency, from.type, -amountFrom, `Перевод в ${to.name}`, fromOrg, fromBranch)
  const inLeg = await leg(CASH_OP.TO_TRANSFER, to.id, to.currency, to.type, amountTo, `Перевод из ${from.name}`, toOrg, toBranch)
  return { transferId, docNo: Number(header.doc_no), from: outLeg, to: inLeg, amountFrom, amountTo, rate }
}
