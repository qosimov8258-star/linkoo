// Производство → Партии: the figures Linko shows inside a batch (manufacture/party/{id}/): each made line's cost
// (made_products[].cost — for a finished batch its raw cost over its good units, null while it is pending) and the
// batch's total raw cost (total_raw_cost, which also counts raw material Linko no longer lists as a line). Kept apart
// in linko_party_costs and only read by the batch detail (lib/production-batches-repo.ts getPartyDetail): the stock and
// cost ledgers keep the movements as they are. A batch whose figures changed in Linko is updated, the previous values
// registered.
//
//   node scripts/linko-sync/import-party-costs.mjs     (raw: parties_detail)
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("party-costs")
if (!hasRaw("parties_detail")) {
  console.log("party costs: no raw parties_detail (run fetch.mjs first)")
  process.exit(0)
}
const parties = raw("parties_detail")
const num = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
const stats = { inserted: 0, updated: 0, same: 0, missing: [] }

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS linko_party_costs (
    party_id INTEGER PRIMARY KEY,
    total_raw_cost DOUBLE PRECISION,
    made_costs TEXT NOT NULL DEFAULT '[]'
  )`)
  const known = new Set((await client.query("SELECT id FROM production_parties")).rows.map((row) => Number(row.id)))
  for (const [id, party] of Object.entries(parties)) {
    if (!party || party.__status) continue
    const partyId = Number(id)
    if (!known.has(partyId)) {
      stats.missing.push(partyId)
      continue
    }
    // Linko's good made lines in its order: [product id, amount, cost or null].
    const made = JSON.stringify((party.made_products ?? []).map((line) => [Number(line.product?.id) || null, num(line.amount), num(line.cost)]))
    const total = num(party.total_raw_cost)
    const current = (await client.query("SELECT total_raw_cost, made_costs FROM linko_party_costs WHERE party_id = $1", [partyId])).rows[0]
    if (!current) {
      await client.query("INSERT INTO linko_party_costs (party_id, total_raw_cost, made_costs) VALUES ($1, $2, $3) RETURNING party_id", [partyId, total, made])
      await register(client, run, "linko_party_costs", partyId, "insert")
      stats.inserted++
    } else if (num(current.total_raw_cost) !== total || current.made_costs !== made) {
      await client.query("UPDATE linko_party_costs SET total_raw_cost = $2, made_costs = $3 WHERE party_id = $1", [partyId, total, made])
      await register(client, run, "linko_party_costs", partyId, "update", { total_raw_cost: current.total_raw_cost, made_costs: current.made_costs })
      stats.updated++
    } else {
      stats.same++
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`party costs: ${stats.inserted} added, ${stats.updated} updated, ${stats.same} unchanged; batches not here: ${stats.missing.join(",") || "none"}`)
