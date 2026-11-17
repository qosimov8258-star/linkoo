// Клиенты → the shop's card → «Агенты магазина»: the agents Linko gives each shop, with a comment and price lists
// (market/market/{id}/ extra_message.market_users, fetch step market-users) as rows of client_market_users, the table
// «Изменение агентов» writes (lib/client-agents-repo.ts). Shop ids are Linko's market ids, employee and price list ids
// Linko's. A row keeps Linko's record id (linko_id): a re-run updates those rows and drops the ones Linko no longer has;
// an agent set here (no linko_id) is kept and Linko's row for the same agent is skipped. A shop, an employee or a price
// list that is not here is reported.
//
//   node scripts/linko-sync/import-market-users.mjs
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("market-users")
if (!hasRaw("market_users")) {
  console.log("market users: no raw market_users (run fetch.mjs market-users first)")
  process.exit(0)
}
const data = raw("market_users")
const stats = { inserted: 0, updated: 0, removed: 0, keptLocal: 0, shops: new Set(), missingShops: new Set(), missingEmployees: new Set(), missingPriceLists: new Set(), failedShops: 0 }

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:client_market_users'))")
  await client.query(`CREATE TABLE IF NOT EXISTS client_market_users (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_list_ids TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0,
    linko_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (client_id, employee_id)
  )`)
  const shops = new Set((await client.query("SELECT id FROM clients")).rows.map((row) => Number(row.id)))
  const employees = new Set((await client.query("SELECT id FROM employees")).rows.map((row) => Number(row.id)))
  const priceLists = new Set((await client.query("SELECT id FROM price_lists")).rows.map((row) => Number(row.id)))
  const existing = new Map(
    (await client.query("SELECT id, client_id, employee_id, linko_id FROM client_market_users")).rows.map((row) => [`${row.client_id}:${row.employee_id}`, row]),
  )
  const seenLinko = new Set()
  for (const [id, users] of Object.entries(data)) {
    if (!Array.isArray(users)) {
      stats.failedShops++
      continue
    }
    const shopId = Number(id)
    if (!shops.has(shopId)) {
      stats.missingShops.add(shopId)
      continue
    }
    for (const [position, item] of users.entries()) {
      const employeeId = Number(item?.user?.id)
      if (!employees.has(employeeId)) {
        stats.missingEmployees.add(employeeId)
        continue
      }
      const lists = (item.price_lists ?? []).map((list) => Number(list.id)).filter((listId) => {
        if (priceLists.has(listId)) return true
        stats.missingPriceLists.add(listId)
        return false
      })
      const linkoId = Number(item.id) || null
      if (linkoId) seenLinko.add(linkoId)
      const key = `${shopId}:${employeeId}`
      const row = existing.get(key)
      if (row && row.linko_id === null) {
        stats.keptLocal++
        continue
      }
      if (row) {
        await client.query("UPDATE client_market_users SET description = $1, price_list_ids = $2, position = $3, linko_id = $4 WHERE id = $5", [
          String(item.description ?? ""),
          JSON.stringify(lists),
          position,
          linkoId,
          row.id,
        ])
        stats.updated++
      } else {
        const inserted = await client.query(
          "INSERT INTO client_market_users (client_id, employee_id, description, price_list_ids, position, linko_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [shopId, employeeId, String(item.description ?? ""), JSON.stringify(lists), position, linkoId],
        )
        await register(client, run, "client_market_users", String(inserted.rows[0].id), "insert")
        stats.inserted++
      }
      stats.shops.add(shopId)
    }
  }
  // Linko's rows it no longer has (only rows copied from Linko; a failed shop keeps its rows).
  const failed = new Set(Object.entries(data).filter(([, users]) => !Array.isArray(users)).map(([id]) => Number(id)))
  for (const row of existing.values()) {
    if (row.linko_id === null || seenLinko.has(Number(row.linko_id)) || failed.has(Number(row.client_id))) continue
    await client.query("DELETE FROM client_market_users WHERE id = $1", [row.id])
    stats.removed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}

console.log(
  `market users: ${stats.inserted} added, ${stats.updated} updated, ${stats.removed} removed, ${stats.keptLocal} kept (set here), shops ${stats.shops.size}` +
    (stats.failedShops ? `, Linko failed for ${stats.failedShops} shops` : "") +
    (stats.missingShops.size ? `, unknown shops ${[...stats.missingShops].slice(0, 10).join(", ")}` : "") +
    (stats.missingEmployees.size ? `, unknown employees ${[...stats.missingEmployees].slice(0, 10).join(", ")}` : "") +
    (stats.missingPriceLists.size ? `, unknown price lists ${[...stats.missingPriceLists].slice(0, 10).join(", ")}` : ""),
)
