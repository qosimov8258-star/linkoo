// Себестоимость: Linko's own cost history becomes the history of the app's cost ledger (lib/net-cost-sync.ts).
// - Linko books one cost record per product on 2010-01-01 (its initial cost, mostly 1,00): it goes to
//   products.initial_cost, the default cost the ledger starts an item from.
// - Every other record (the cost after a supply, a cost set by hand, a revaluation) goes to net_cost_entries as a
//   source 'linko' entry at the moment Linko booked it (entered_at; the supply's own moment, so it applies right after
//   the supply), in the warehouse of a per-warehouse record: after it the cost is Linko's, whatever the app's own
//   averaging of the copied documents gave.
// - linko_history 'net_cost' = the moment the records were read: before it production output comes in at the average,
//   as Linko books it; after it the app's own rules apply to new documents.
// Every change is registered in linko_sync_rows; re-running inserts nothing twice (comment "Linko #<record id>").
//
//   node scripts/linko-sync/import-net-cost-history.mjs   (raw: net_costs)
import fs from "node:fs"
import path from "node:path"
import { connect, ensureRegistry, raw, rawDir, register, runId } from "./lib.mjs"

/** The `fetched` timestamp of a raw file (when it was read from Linko). */
const rawFetched = (name) => JSON.parse(fs.readFileSync(path.join(rawDir(), `${name}.json`), "utf8")).fetched

const records = raw("net_costs")
const run = runId("net-cost-history")
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : 0
}
const isInitial = (record) => String(record.created_date ?? "").startsWith("2010-01-01")
const booked = records.filter((record) => !isInitial(record))
const initial = records.filter((record) => !record.supply_id && !record.inventory_id && isInitial(record))

const client = await connect()
await ensureRegistry(client)
const stats = { initial: { update: 0, same: 0, missing: [] }, entries: { insert: 0, same: 0, missing: [] } }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS initial_cost DOUBLE PRECISION")
  await client.query("ALTER TABLE net_cost_entries ADD COLUMN IF NOT EXISTS entered_at TEXT")
  const products = new Map((await client.query("SELECT id, name, initial_cost FROM products")).rows.map((row) => [Number(row.id), row]))
  const rawByName = new Map(
    (await client.query("SELECT id, lower(btrim(name)) AS k FROM raw_materials").catch(() => ({ rows: [] }))).rows.map((row) => [row.k, Number(row.id)]),
  )

  // Initial costs: the latest 2010-01-01 record of each product.
  const firstCost = new Map()
  for (const record of [...initial].sort((a, b) => a.id - b.id)) firstCost.set(Number(record.product?.id), money(record.cost))
  for (const [id, cost] of firstCost) {
    const product = products.get(id)
    if (!product) {
      stats.initial.missing.push(id)
      continue
    }
    if (product.initial_cost !== null && Math.abs(Number(product.initial_cost) - cost) < 1e-9) {
      stats.initial.same++
      continue
    }
    await client.query("UPDATE products SET initial_cost = $2 WHERE id = $1", [id, cost])
    await register(client, run, "products", id, "update", { initial_cost: product.initial_cost })
    stats.initial.update++
  }

  // Every other record as the ledger's entry.
  const existing = new Map((await client.query("SELECT id, comment, entered_at FROM net_cost_entries WHERE source = 'linko'")).rows.map((row) => [row.comment, row]))
  for (const record of [...booked].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || a.id - b.id)) {
    const comment = `Linko #${record.id}`
    const moment = String(record.created_date ?? "").slice(0, 19)
    // A per-warehouse record: Linko keeps that warehouse's cost apart from its first record on, so the warehouse is
    // its own scope from the start of that day (entered_at unknown) and that day's receipts blend there, not into the
    // common cost. A common record applies at its moment, right after the document Linko booked it for.
    const enteredAt = record.stock ? null : moment
    const known = existing.get(comment)
    if (known) {
      if ((known.entered_at ?? null) !== enteredAt) {
        await client.query("UPDATE net_cost_entries SET entered_at = $2 WHERE id = $1", [known.id, enteredAt])
        await register(client, run, "net_cost_entries", known.id, "update", { entered_at: known.entered_at })
        stats.entries.update = (stats.entries.update ?? 0) + 1
      } else stats.entries.same++
      continue
    }
    const productId = Number(record.product?.id)
    const product = products.get(productId)
    const rawId = product ? null : (rawByName.get(String(record.product?.name ?? "").trim().toLowerCase()) ?? null)
    if (!product && !rawId) {
      stats.entries.missing.push(record.id)
      continue
    }
    // created_at is UTC like the app writes it (Linko's moment is local Tashkent time); entered_at keeps the local moment.
    const createdUtc = new Date(`${moment}+05:00`).toISOString().slice(0, 19).replace("T", " ")
    const inserted = await client.query(
      `INSERT INTO net_cost_entries (product_id, raw_material_id, item_label, cost, entry_date, warehouse, comment, source, created_by, created_at, updated_at, entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'linko', 'Linko', $8, $8, $9) RETURNING id`,
      [
        product ? productId : null,
        rawId,
        String(record.product?.name ?? ""),
        money(record.cost),
        moment.slice(0, 10),
        String(record.stock?.name ?? ""),
        comment,
        createdUtc,
        enteredAt,
      ],
    )
    await register(client, run, "net_cost_entries", inserted.rows[0].id, "insert")
    stats.entries.insert++
  }
  // The moment Linko's records were read (the raw file's own timestamp).
  const fetched = String(rawFetched("net_costs") ?? "").replace("T", " ").slice(0, 19)
  if (fetched) {
    await client.query("CREATE TABLE IF NOT EXISTS linko_history (ledger TEXT PRIMARY KEY, until TEXT NOT NULL)")
    const before = (await client.query("SELECT until FROM linko_history WHERE ledger = 'net_cost'")).rows[0]?.until ?? null
    if (before !== fetched) {
      await client.query("INSERT INTO linko_history (ledger, until) VALUES ('net_cost', $1) ON CONFLICT (ledger) DO UPDATE SET until = EXCLUDED.until", [fetched])
      await register(client, run, "linko_history", "net_cost", before === null ? "insert" : "update", before === null ? null : { until: before })
    }
    stats.until = fetched
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
