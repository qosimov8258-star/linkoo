import "server-only"

import { AmountSum, roundToDigits } from "@/lib/amount-precision"
import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { localToUtcText, todayIso } from "@/lib/finance/dates"
import { innKey } from "@/lib/finance/entities"
import { listLedgerMovements } from "@/lib/finance/ledger"
import { loadRateHistory, rateAt } from "@/lib/finance/pnl"
import { MOVEMENT_COLUMNS } from "@/lib/finance/types"

// Заказы «Баланс», as Linko's market_internal_balance (shown with ORDER_LIST_WITH_MARKET_INTERNAL_BALANCE and counted
// with ORDER_LIST_ONLY_ACCEPTED_MARKET_BALANCE, both on in Linko's settings): one figure per financial account, in the
// base currency — the account's accepted client documents (the client ledger in realization mode), each at its own
// rate (Linko's client_transactions.internal):
//   a base-currency document counts its amount;
//   another currency counts what Linko booked it at while its amount is still Linko's (linko_document_internals,
//     import-document-internals.mjs), else at the rate Linko booked the document at (linko_document_rates,
//     import-document-rates.mjs), a payment of the app at its debt rate, else at the rate of its moment (Валюты rate
//     history).
// The account is the shop's financial account (all its shops and the money booked on the account itself), else the
// shop's INN, else the shop — the same grouping as Сверка счетов / Долги по счетам. With an app currency
// (Настройки → Валюта приложения) the ledger already gives every amount in it.

export type InternalBalances = {
  /** The currency of the figures (the base currency, or the app currency when one is chosen). */
  currency: string
  /** Account key ("acc:<id>", "inn:<inn>" or the shop id) → its balance. */
  byAccount: Map<string, number>
  /** The account key of a shop. */
  accountOf: (shopId: number) => string
}

export async function accountInternalBalances(db: PgDb = getDb()): Promise<InternalBalances> {
  const cc = await loadCurrencyContext(db)
  const [moves, accountRows, innRows, docRates, payRates, docInternals] = await Promise.all([
    listLedgerMovements("account", { from: "2000-01-01", to: todayIso(), mode: "realization" }, db),
    db
      .prepare(
        `SELECT m.client_id, m.financial_account_id AS account_id FROM financial_account_markets m
          WHERE to_regclass('financial_account_markets') IS NOT NULL`,
      )
      .all()
      .catch(() => []) as Promise<Array<{ client_id: number; account_id: number }>>,
    db.prepare("SELECT id, COALESCE(inn, '') AS inn FROM clients").all() as Promise<Array<{ id: number; inn: string }>>,
    db
      .prepare("SELECT src, src_id, cur, rate::float8 AS rate FROM linko_document_rates")
      .all()
      .catch(() => []) as Promise<Array<{ src: string; src_id: number; cur: string; rate: number }>>,
    db
      .prepare("SELECT id, debt_rate::float8 AS rate FROM customer_payments WHERE debt_rate IS NOT NULL AND debt_rate::float8 > 0")
      .all()
      .catch(() => []) as Promise<Array<{ id: number; rate: number }>>,
    db
      .prepare("SELECT src, src_id, cur, amount::text AS amount, internal::text AS internal FROM linko_document_internals")
      .all()
      .catch(() => []) as Promise<Array<{ src: string; src_id: number; cur: string; amount: string; internal: string }>>,
  ])

  const accountOfShop = new Map(accountRows.map((row) => [Number(row.client_id), `acc:${Number(row.account_id)}`]))
  const innOfShop = new Map(innRows.map((row) => [Number(row.id), innKey(row.inn)]))
  const accountOf = (shopId: number) => accountOfShop.get(shopId) ?? (innOfShop.get(shopId) ? `inn:${innOfShop.get(shopId)}` : String(shopId))
  const keyOf = (ek: string) => {
    if (!/^\d+$/.test(ek)) return ek
    return accountOf(Number(ek))
  }

  const linkoRate = new Map(docRates.map((row) => [`${row.src}:${Number(row.src_id)}:${row.cur}`, Number(row.rate)]))
  const paymentRate = new Map(payRates.map((row) => [Number(row.id), Number(row.rate)]))
  const linkoInternal = new Map(docInternals.map((row) => [`${row.src}:${Number(row.src_id)}:${row.cur}`, row]))
  const counted = new Set<string>(MOVEMENT_COLUMNS.account)
  const foreign = !cc.work && moves.some((move) => move.cur !== cc.base)
  const history = foreign ? await loadRateHistory(db) : null
  const rateOf = (move: (typeof moves)[number]): number => {
    if (cc.work || move.cur === cc.base) return 1
    const own = linkoRate.get(`${move.src}:${move.src_id}:${move.cur}`)
    if (own !== undefined) return own
    if (move.src === "customer_payment" && move.src_id !== null) {
      const debt = paymentRate.get(Number(move.src_id))
      if (debt) return debt
    }
    const utc = localToUtcText(move.ts)
    return (history && utc ? rateAt(history, move.cur, utc) : null) ?? cc.rates[move.cur] ?? 0
  }

  // Added up as exact decimals (AmountSum), like Linko's numeric sum of client_transactions.internal: Linko's own
  // figure while the document's amount is Linko's, else the amount kept to 9 decimals (-0.12345678912 →
  // -0.123456789) times the rate, kept to 9 decimals. Float products and additions of a few thousand documents drift a
  // unit in the fifth decimal of a large balance.
  const sums = new Map<string, AmountSum>()
  for (const move of moves) {
    if (move.pending || !counted.has(move.col) || !move.ek || !move.amt) continue
    const key = keyOf(move.ek)
    let sum = sums.get(key)
    if (!sum) sums.set(key, (sum = new AmountSum()))
    const rate = rateOf(move)
    if (rate === 1) {
      sum.add(move.amt)
      continue
    }
    // The local amount of a Linko order comes from its lines as a float: it may differ from Linko's 9-decimal amount in
    // the last digit (-1234567.123456789 / …790), never by a real change.
    const booked = linkoInternal.get(`${move.src}:${move.src_id}:${move.cur}`)
    if (booked && Math.abs(Number(booked.amount) - move.amt) <= 2e-9 + Math.abs(move.amt) * 1e-14) sum.add(booked.internal)
    else sum.addProduct(roundToDigits(move.amt, 9), rate, 9)
  }
  const byAccount = new Map([...sums].map(([key, sum]) => [key, sum.value()]))
  return { currency: cc.work || cc.base, byAccount, accountOf }
}
