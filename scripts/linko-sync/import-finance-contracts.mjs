// Договоры and Валюты: every contract of the Linko account (sales/contract, all statuses) with its clients into
// contracts + contract_clients (id = Linko id; status pending/finished/canceled → active/completed/cancelled, the
// values lib/contracts-types.ts stores), and the currency rate history (finance/currency_rate) and the individual
// rates (finance/individual_rate) into currency_rates / individual_rates (id = Linko id).
// Rate rows keep their Linko moment in UTC with the fraction of a second, so the app's "remove the old demo seed"
// step (lib/currency-rates-repo.ts, which only drops rows equal to the seed in every field) never takes them.
//
//   node scripts/linko-sync/import-finance-contracts.mjs    (raw: fin_contracts_all, fin_currency_rates, fin_individual_rates)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"
import { bumpIdSequence, counter, deleteOthers, localIso, name, putRow, text, utcText } from "./finance-lib.mjs"

const contracts = raw("fin_contracts_all")
const rates = raw("fin_currency_rates")
const individual = raw("fin_individual_rates")

const STATUS = { pending: "active", finished: "completed", canceled: "cancelled", cancelled: "cancelled", active: "active", completed: "completed" }

/** "2020-01-31T23:17:27.495140" (Tashkent) → "2020-01-31 18:17:27.495" UTC: datetime('now') form plus milliseconds. */
function utcWithMs(value) {
  const base = utcText(value)
  const ms = String(value ?? "").match(/\.(\d{1,3})/)
  return base && ms ? `${base}.${ms[1].padEnd(3, "0")}` : base
}

const run = runId("finance-contracts")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")

  // --- contracts ---------------------------------------------------------------------------------------------------------
  stats.del("contracts", await deleteOthers(client, run, "contracts", new Set(contracts.map((c) => c.id))))
  const contractIds = contracts.map((c) => c.id)
  const removedLinks = (await client.query("DELETE FROM contract_clients WHERE contract_id <> ALL($1::int[]) RETURNING *", [contractIds])).rows
  for (const row of removedLinks) await register(client, run, "contract_clients", row.id, "delete", row)
  stats.del("contract_clients", removedLinks.length)
  for (const c of contracts) {
    const markets = c.markets ?? []
    const first = markets[0] ?? null
    stats.add(
      "contracts",
      await putRow(client, run, "contracts", c.id, {
        client: text(first?.name),
        agent: name(c.agent),
        zone: text(first?.border?.title),
        inn: text(c.inn),
        organization: text(c.division?.name),
        comment: text(c.comment),
        official_name: text(c.official_name),
        status: STATUS[String(c.status ?? "").toLowerCase()] ?? "active",
        year: Number(c.year) || Number(String(c.created_date).slice(0, 4)),
        contract_number: c.contract_number ?? null,
        contract_prefix: text(c.contract_prefix),
        contract_suffix: text(c.contract_suffix),
        contract_date: localIso(c.created_date),
        agent_id: c.agent?.id ?? null,
        organization_id: c.division?.id ?? null,
        created_by: name(c.agent),
        created_at: utcText(c.created_date),
        updated_at: utcText(c.created_date),
      }),
    )
    // Clients of the contract, in Linko's order.
    const current = (await client.query("SELECT client_id, client_name, position FROM contract_clients WHERE contract_id = $1 ORDER BY position, id", [c.id])).rows
    const wanted = markets.map((m, position) => ({ client_id: m.id, client_name: text(m.name), position }))
    const same = current.length === wanted.length && current.every((r, i) => r.client_id === wanted[i].client_id && r.client_name === wanted[i].client_name && r.position === wanted[i].position)
    if (!same) {
      await client.query("DELETE FROM contract_clients WHERE contract_id = $1", [c.id])
      for (const w of wanted) {
        await client.query("INSERT INTO contract_clients (contract_id, client_id, client_name, position) VALUES ($1, $2, $3, $4)", [c.id, w.client_id, w.client_name, w.position])
      }
      await register(client, run, "contract_clients", `contract:${c.id}`, "replace", current)
      stats.add("contract_clients", "update")
    } else stats.add("contract_clients", "same")
  }
  await bumpIdSequence(client, "contracts")
  await bumpIdSequence(client, "contract_clients")

  // --- currency rates ----------------------------------------------------------------------------------------------------
  stats.del("currency_rates", await deleteOthers(client, run, "currency_rates", new Set(rates.map((r) => r.id))))
  for (const r of rates) {
    stats.add(
      "currency_rates",
      await putRow(client, run, "currency_rates", r.id, {
        currency_id: typeof r.currency === "object" ? r.currency.id : r.currency,
        rate: Number(r.rate),
        created_at: utcWithMs(r.created_date),
      }),
    )
  }
  await bumpIdSequence(client, "currency_rates")

  stats.del("individual_rates", await deleteOthers(client, run, "individual_rates", new Set(individual.map((r) => r.id))))
  for (const r of individual) {
    stats.add(
      "individual_rates",
      await putRow(client, run, "individual_rates", r.id, {
        name: text(r.name),
        rate: Number(r.rate),
        begin_date: text(r.begin_date),
        end_date: text(r.end_date),
        created_at: utcWithMs(r.created_date),
      }),
    )
  }
  await bumpIdSequence(client, "individual_rates")

  await client.query("COMMIT")
  stats.print(`contracts ${contracts.length}, currency rates ${rates.length}, individual rates ${individual.length} (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
