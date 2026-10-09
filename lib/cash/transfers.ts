import "server-only"

import { getDb, withTransaction } from "@/lib/db"
import { roundMoney } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { CashError, currencyContext, isoDayOrEmpty, loadCashbox, localDateTime, pickRate } from "@/lib/cash/common"
import { transferAmountTo } from "@/lib/cash/rates"
import { ensureCashSchema } from "@/lib/cash/schema"
import { CASH_OP, operationKey, type CashTransferInput, type CashTransferResult } from "@/lib/cash/types"

// "Перевод" (demo finance/transfer): a cash_transfers header and two
// cash_management_entries legs sharing transfer_id — op 1 (−amountFrom, source
// cashbox, "Перевод в <to>") and op 2 (+amountTo, target, "Перевод из <from>"),
// category 'Перевод' kept for older readers. Cross-currency transfers carry
// their own amounts; the branch ledger pairs the legs by transfer_id.

export async function createTransfer(input: CashTransferInput, user: string): Promise<CashTransferResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    if (input.fromCashboxId === input.toCashboxId) throw new CashError("Выберите другую кассу", 400, "toCashbox")
    const from = await loadCashbox(tx, input.fromCashboxId, cc.base, "fromCashbox")
    const to = await loadCashbox(tx, input.toCashboxId, cc.base, "toCashbox")
    const amountFrom = Number(input.amountFrom)
    if (!Number.isFinite(amountFrom) || amountFrom <= 0) throw new CashError("Укажите сумму", 400, "amountFrom")
    const percentMode = from.currency === to.currency && from.type !== to.type && input.percentage !== undefined && input.percentage !== null
    let amountTo = Number(input.amountTo)
    let rate: number | null = input.rate && input.rate > 0 ? input.rate : null
    if (!(Number.isFinite(amountTo) && amountTo > 0)) {
      const computed = transferAmountTo({
        amountFrom,
        fromCurrency: from.currency,
        toCurrency: to.currency,
        baseCurrency: cc.base,
        rates: cc.rates,
        rate,
        percentage: percentMode ? input.percentage : null,
      })
      if (computed.amountTo === null) throw new CashError("Курс валюты не задан", 400, "rate")
      amountTo = computed.amountTo
      rate = computed.rate
    }
    if (!(amountTo > 0)) throw new CashError("Укажите сумму", 400, "amountTo")
    const date = localDateTime(input.date)
    const accFrom = isoDayOrEmpty(input.accumulatedFrom, "accumulatedMoney")
    const accTo = isoDayOrEmpty(input.accumulatedTo, "accumulatedMoney")
    const fromBranch = input.fromBranch?.trim() || from.branch
    const toBranch = input.toBranch?.trim() || to.branch
    const comment = input.comment?.trim() ?? ""

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
        percentage: percentMode ? Number(input.percentage) : 0,
        fromOrg: input.fromOrganization?.trim() ?? "",
        toOrg: input.toOrganization?.trim() ?? "",
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
    const outLeg = await leg(CASH_OP.FROM_TRANSFER, from.id, from.currency, from.type, -amountFrom, `Перевод в ${to.name}`, input.fromOrganization?.trim() ?? "", fromBranch)
    const inLeg = await leg(CASH_OP.TO_TRANSFER, to.id, to.currency, to.type, amountTo, `Перевод из ${from.name}`, input.toOrganization?.trim() ?? "", toBranch)
    return { transferId, docNo: Number(header.doc_no), from: outLeg, to: inLeg, amountFrom, amountTo, rate }
  })
}
