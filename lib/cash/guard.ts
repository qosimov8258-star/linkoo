import "server-only"

import type { PgDb } from "@/lib/db"
import { CashError, isDbId } from "@/lib/cash/common"
import { cashboxBalances } from "@/lib/cash/list"

// "Недостаточно средств в кассе": a cashbox never pays out more than it holds.
// Every writer that can take money out of a cashbox (expense, supplier payment,
// transfer, cashback payout, edits that move or shrink an income, verifying an
// expense) runs its write through guardCashboxBalances() inside its transaction:
// the cashbox rows are locked (writers of one cashbox are serialised), the
// all-time balances are read before and after the write, and the write is
// rolled back when a balance ends below zero AND lower than it was. A cashbox
// that is already negative (older data) still accepts incomes and edits that do
// not make it worse.

const EPS = 0.005

export async function guardCashboxBalances<T>(tx: PgDb, cashboxIds: Array<number | null | undefined>, base: string, write: () => Promise<T>, field = "amount"): Promise<T> {
  const ids = [...new Set(cashboxIds.filter((id): id is number => isDbId(id)))].sort((a, b) => a - b)
  if (!ids.length) return write()
  await tx.prepare("SELECT id FROM cashboxes WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE").all({ ids })
  const before = await cashboxBalances(tx, ids, base)
  const result = await write()
  const after = await cashboxBalances(tx, ids, base)
  for (const id of ids) {
    const was = before.get(id) ?? 0
    const now = after.get(id) ?? 0
    if (now < -EPS && now < was - EPS) throw new CashError("Недостаточно средств в кассе", 400, field)
  }
  return result
}
