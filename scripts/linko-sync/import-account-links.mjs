// Клиенты → Финансовые счета: which financial account (Linko sales/client) each shop (Linko market = clients.id)
// belongs to, from the shop's own `client` in Linko, into financial_account_markets. "Долги по счетам" / "Сверка
// счетов" add the shops of an account up, as Linko does.
//
//   node scripts/linko-sync/import-account-links.mjs     (raw: markets, clients)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("account-links")
const markets = raw("markets")
const accounts = new Map(raw("clients").map((a) => [a.id, a]))
const client = await connect()
await ensureRegistry(client)
const stats = { linked: 0, relinked: 0, same: 0, accountsAdded: 0, unknownShop: 0 }
try {
  await client.query("BEGIN")
  const shops = new Set((await client.query("SELECT id FROM clients")).rows.map((r) => r.id))
  const haveAccounts = new Set((await client.query("SELECT id FROM financial_accounts")).rows.map((r) => r.id))
  for (const market of markets) {
    const accountId = market.client?.id
    if (!accountId) continue
    if (!shops.has(market.id)) {
      stats.unknownShop++
      continue
    }
    if (!haveAccounts.has(accountId)) {
      // An account Linko deleted (its list leaves it out) that a shop still names: kept, as deleted.
      const account = accounts.get(accountId) ?? { name: market.client?.name ?? "", deleted: true }
      await client.query("INSERT INTO financial_accounts (id, name, address, created_at, deleted) VALUES ($1, $2, $3, $4, $5)", [accountId, account.name ?? "", account.address ?? "", String(account.created_date ?? "").replace("T", " ").slice(0, 19), account.deleted ? 1 : 0])
      await register(client, run, "financial_accounts", accountId, "insert")
      haveAccounts.add(accountId)
      stats.accountsAdded++
    }
    const current = (await client.query("SELECT financial_account_id FROM financial_account_markets WHERE client_id = $1", [market.id])).rows[0]
    if (!current) {
      await client.query("INSERT INTO financial_account_markets (client_id, financial_account_id) VALUES ($1, $2)", [market.id, accountId])
      await register(client, run, "financial_account_markets", market.id, "insert")
      stats.linked++
    } else if (current.financial_account_id !== accountId) {
      await client.query("UPDATE financial_account_markets SET financial_account_id = $2 WHERE client_id = $1", [market.id, accountId])
      await register(client, run, "financial_account_markets", market.id, "update", current)
      stats.relinked++
    } else stats.same++
  }
  // Accounts this database has that Linko's list leaves out (deleted there): deleted here too.
  const live = [...accounts.keys()]
  const gone = (await client.query("SELECT id FROM financial_accounts WHERE COALESCE(deleted, 0) = 0 AND NOT (id = ANY($1::int[]))", [live])).rows
  for (const row of gone) {
    await client.query("UPDATE financial_accounts SET deleted = 1 WHERE id = $1", [row.id])
    await register(client, run, "financial_accounts", row.id, "update", { deleted: 0 })
    stats.accountsDeleted = (stats.accountsDeleted ?? 0) + 1
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`account links: ${JSON.stringify(stats)}`)
