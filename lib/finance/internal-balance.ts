import "server-only"

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
//   another currency counts at the rate Linko booked the document at (linko_document_rates, import-document-rates.mjs),
//     a payment of the app at its debt rate, else at the rate of its moment (Валюты rate history).
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
  const [moves, accountRows, innRows, docRates, payRates] = await Promise.all([
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

  const byAccount = new Map<string, number>()
  for (const move of moves) {
    if (move.pending || !counted.has(move.col) || !move.ek) continue
    const key = keyOf(move.ek)
    byAccount.set(key, (byAccount.get(key) ?? 0) + move.amt * rateOf(move))
  }
  return { currency: cc.work || cc.base, byAccount, accountOf }
}
