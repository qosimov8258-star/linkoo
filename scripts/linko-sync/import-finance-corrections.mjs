// Баланс клиентов: the arbitrary client balance changes of the Linko account (client_transaction type 9,
// "Произвольный" — Добавить / Списать, Excel debt imports) into client_balance_corrections, one row per Linko
// transaction (id = Linko id). The earlier parity corrections (rows that only made totals match) are removed, so a
// client's balance is now made of its real orders, returns, payments, withdrawals and these corrections. Linko has no
// separate opening balances, so the parity baselines in clients.balance are cleared too.
//
//   node scripts/linko-sync/import-finance-corrections.mjs        (raw: client_transactions)
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"
import { bumpIdSequence, counter, deleteOthers, localIso, money, name, putRow, text, utcText } from "./finance-lib.mjs"

const rows = raw("client_transactions").filter((x) => x.type === 9)
const run = runId("finance-corrections")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  stats.del("client_balance_corrections", await deleteOthers(client, run, "client_balance_corrections", new Set(rows.map((x) => x.id))))
  for (const x of rows) {
    stats.add(
      "client_balance_corrections",
      await putRow(client, run, "client_balance_corrections", x.id, {
        client_id: x.market?.id ?? x.client?.id,
        amount: money(x.amount),
        currency: currencyCode(x.currency),
        payment_type: x.payment_type === "bank" ? "bank" : x.payment_type === "cash" ? "cash" : "",
        organization: text(x.division?.name),
        correction_date: localIso(x.created_date),
        comment: text(x.comment),
        delivery_man: name(x.delivery_man),
        source: "manual",
        import_id: null,
        created_by: name(x.user),
        created_at: utcText(x.created_date),
        is_deleted: 0,
        deleted_at: "",
        deleted_by: "",
      }),
    )
  }
  await bumpIdSequence(client, "client_balance_corrections")

  // Opening balances ("Первоначальный баланс", clients.balance): Linko has none — every client balance there is the sum
  // of its transactions — so the parity baselines written into this column are cleared (old values kept in the registry).
  const openings = (await client.query("SELECT id, balance FROM clients WHERE balance IS NOT NULL AND balance <> 0")).rows
  for (const row of openings) {
    await client.query("UPDATE clients SET balance = NULL WHERE id = $1", [row.id])
    await register(client, run, "clients", row.id, "update", { balance: row.balance })
  }
  console.log(`client opening balances cleared: ${openings.length}`)

  // "Срок долга" of Сверка счетов (sales/client_balances payment_deadline): the local account key is "inn:<INN>" of the
  // account's client, else the client id (lib/finance-store-reconciliation.ts).
  let deadlines = 0
  for (const account of raw("client_balances").filter((a) => a.payment_deadline)) {
    const market = (await client.query("SELECT c.id, c.inn FROM financial_account_markets m JOIN clients c ON c.id = m.client_id WHERE m.financial_account_id = $1 ORDER BY c.id LIMIT 1", [account.id])).rows[0]
    const inn = String(market?.inn ?? "").replace(/\s+/g, "")
    const key = inn ? `inn:${inn}` : String(market?.id ?? account.id)
    const latest = (await client.query("SELECT payment_deadline FROM account_payment_deadlines WHERE account_key = $1 ORDER BY id DESC LIMIT 1", [key])).rows[0]
    if (latest?.payment_deadline === account.payment_deadline) continue
    const row = (await client.query("INSERT INTO account_payment_deadlines (account_key, payment_deadline, created_by) VALUES ($1, $2, '') RETURNING id", [key, account.payment_deadline])).rows[0]
    await register(client, run, "account_payment_deadlines", row.id, "insert")
    deadlines++
  }
  console.log(`account payment deadlines added: ${deadlines}`)
  await client.query("COMMIT")
  stats.print(`client corrections: ${rows.length} Linko type-9 transactions`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
