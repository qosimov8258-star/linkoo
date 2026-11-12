// The financial account each client document was booked on in Linko, where it is not the shop's current account.
//
// Linko keeps a client's debt per financial account (client_transactions.client) and per shop (.market). A shop that
// later moved to another account keeps its old documents on the old account; a payment can also be booked on an
// account without any shop. The account balances (Долги по счетам, the client list's balance) follow Linko only if
// the document says which account it was booked on: financial_account_id on orders (type 4), client_returns (3),
// customer_payments (1), client_balance_corrections (9) and cash_management_entries (5, withdrawals), set only where
// it differs from the shop's current account (lib/finance/sources.ts reads it as the movement's "acc"). A payment
// without a shop also loses its client_id (it was the account's id, which is some other shop's id). An order without a
// debt (cancelled, «без долга») carries the account written on the order (Заказы «Баланс» shows its balance).
//
//   node scripts/linko-sync/import-document-accounts.mjs     (raw: client_transactions, orders; after the finance imports)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("document-accounts")
const client = await connect()
await ensureRegistry(client)

// Linko transaction type → the local document it is booked as (table, id).
const TARGET = {
  1: (t) => ["customer_payments", t.id],
  3: (t) => (t.order_return ? ["client_returns", t.order_return?.id ?? t.order_return] : null),
  4: (t) => (t.order ? ["orders", t.order?.id ?? t.order] : null),
  5: (t) => (t.transaction ? ["cash_management_entries", t.transaction] : null),
  9: (t) => ["client_balance_corrections", t.id],
}
const TABLES = ["orders", "client_returns", "customer_payments", "client_balance_corrections", "cash_management_entries"]

const stats = { set: 0, cleared: 0, same: 0, missing: 0, shopless: 0 }
try {
  await client.query("BEGIN")
  for (const table of TABLES) await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS financial_account_id INTEGER`)
  const accountOf = new Map((await client.query("SELECT client_id, financial_account_id FROM financial_account_markets")).rows.map((r) => [Number(r.client_id), Number(r.financial_account_id)]))

  // What each document should carry: the booking account where it is not the shop's current one. A document with
  // several transactions (an order debited again) follows the latest.
  const wanted = new Map(TABLES.map((table) => [table, new Map()]))
  const shopless = []
  const transactions = raw("client_transactions").slice().sort((a, b) => a.id - b.id)
  for (const t of transactions) {
    const target = TARGET[t.type]?.(t)
    if (!target || !t.client?.id) continue
    const [table, id] = target
    const shop = t.market?.id ?? null
    const booked = Number(t.client.id)
    wanted.get(table).set(Number(id), shop !== null && accountOf.get(Number(shop)) === booked ? null : booked)
    if (shop === null && table === "customer_payments") shopless.push(Number(id))
  }
  // An order Linko booked no debt for (cancelled, or «без долга»: no transaction, orders.no_debt) still belongs to the
  // account on the order (orders.client): Linko's order list shows that account's balance in «Баланс». The ledger does
  // not count these orders, so the account changes no balance.
  const debited = new Set(transactions.filter((t) => t.type === 4 && t.order).map((t) => Number(t.order?.id ?? t.order)))
  for (const order of raw("orders")) {
    const id = Number(order.id)
    const booked = Number(order.client?.id ?? order.client)
    if (debited.has(id) || !Number.isInteger(booked) || booked <= 0) continue
    const shop = order.market?.id ?? null
    wanted.get("orders").set(id, shop !== null && accountOf.get(Number(shop)) === booked ? null : booked)
  }

  for (const table of TABLES) {
    const targets = wanted.get(table)
    const current = new Map((await client.query(`SELECT id, financial_account_id FROM ${table} WHERE financial_account_id IS NOT NULL`)).rows.map((r) => [Number(r.id), Number(r.financial_account_id)]))
    // Documents that no longer need an account (or were never Linko's) go back to the shop's account.
    for (const [id, value] of current) {
      if (targets.get(id)) continue
      await client.query(`UPDATE ${table} SET financial_account_id = NULL WHERE id = $1`, [id])
      await register(client, run, table, id, "update", { financial_account_id: value })
      stats.cleared++
    }
    for (const [id, account] of targets) {
      if (!account) continue
      if (current.get(id) === account) {
        stats.same++
        continue
      }
      const updated = await client.query(`UPDATE ${table} SET financial_account_id = $2 WHERE id = $1`, [id, account])
      if (!updated.rowCount) {
        stats.missing++
        continue
      }
      await register(client, run, table, id, "update", { financial_account_id: current.get(id) ?? null })
      stats.set++
    }
  }

  // Payments booked on an account without a shop: no shop of their own.
  for (const id of shopless) {
    const row = (await client.query("SELECT client_id FROM customer_payments WHERE id = $1", [id])).rows[0]
    if (!row || row.client_id === null) continue
    await client.query("UPDATE customer_payments SET client_id = NULL WHERE id = $1", [id])
    await register(client, run, "customer_payments", id, "update", { client_id: row.client_id })
    stats.shopless++
  }

  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`document accounts: ${JSON.stringify(stats)}`)
