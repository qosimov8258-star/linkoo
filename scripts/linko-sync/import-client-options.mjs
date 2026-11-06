// Client attribute values (Linko's market_options: "ИНН", "Полное наименование", "nomer", the 1C "PRICE_LIST_ID" …)
// into clients.attributes, keyed by the attribute name, in Linko's order (the client list's «Информация» shows the
// first two, as Linko does). The app's own keys (those starting with "_": stored balance lines, linked Linko markets)
// and any value Linko does not have are kept.
//
//   node scripts/linko-sync/import-client-options.mjs     (raw: markets)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("client-options")
const client = await connect()
await ensureRegistry(client)
const stats = { clients: 0, updated: 0, values: 0, missing: 0 }

function parse(text) {
  try {
    const value = JSON.parse(text || "{}")
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

try {
  await client.query("BEGIN")
  for (const market of raw("markets")) {
    const options = (market.market_options ?? []).filter((option) => option && option.option_name && option.text_value != null && String(option.text_value) !== "")
    const row = (await client.query("SELECT attributes FROM clients WHERE id = $1", [market.id])).rows[0]
    if (!row) {
      if (options.length) stats.missing++
      continue
    }
    stats.clients++
    const current = parse(row.attributes)
    const internal = Object.entries(current).filter(([key]) => key.startsWith("_"))
    const linko = options.map((option) => [String(option.option_name), String(option.text_value)])
    const linkoKeys = new Set(linko.map(([key]) => key))
    const kept = Object.entries(current).filter(([key]) => !key.startsWith("_") && !linkoKeys.has(key))
    const next = JSON.stringify(Object.fromEntries([...internal, ...linko, ...kept]))
    stats.values += linko.length
    if (next === JSON.stringify(current)) continue
    await client.query("UPDATE clients SET attributes = $2 WHERE id = $1", [market.id, next])
    await register(client, run, "clients", market.id, "update", { attributes: row.attributes })
    stats.updated++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`client options: ${JSON.stringify(stats)}`)
