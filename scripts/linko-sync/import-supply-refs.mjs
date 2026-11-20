// Склад → Приход от поставщиков → «Поиск» and «Фильтр»: per supply copied from Linko, the name of the supplier's contact
// person (Linko's contact.name — its list search matches it, with the id, supplier, comment and warehouse id) and the
// ids of the supply's warehouse, branch and organization (Linko's stock / branch / division ids: its filter and search
// use ids, and several warehouses, branches and organizations share a name, so the names alone cannot tell them apart).
// Into supplier_incomings.contact_name, warehouse_id, branch_id and organization_id; an id the local table does not
// know is left empty. Only these columns of rows that exist already (import-supplies.mjs) are written; each change is
// registered in linko_sync_rows with the previous values.
//
//   node scripts/linko-sync/import-supply-refs.mjs     (raw file: supplies_detail; RAW=<dir> picks the folder)
//   DRY=1 node scripts/linko-sync/import-supply-refs.mjs   lists what it would change, then rolls back
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const details = raw("supplies_detail")
const run = runId("supply-refs")
const dry = process.env.DRY === "1"
const client = await connect()
await ensureRegistry(client)
const stats = { update: 0, same: 0, missingSupply: 0, unknownRef: 0 }
const changes = []
try {
  await client.query("BEGIN")
  // Same columns as lib/supplier-incomings-repo.ts adds (installSchema).
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS contact_name TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS warehouse_id INTEGER")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS branch_id INTEGER")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS organization_id INTEGER")
  const known = async (table) => new Set((await client.query(`SELECT id FROM ${table}`)).rows.map((row) => Number(row.id)))
  const tables = { warehouse_id: await known("warehouses"), branch_id: await known("branches"), organization_id: await known("organizations") }
  const refId = (column, value) => {
    const id = Number(value?.id)
    if (!Number.isInteger(id) || id <= 0) return null
    if (tables[column].has(id)) return id
    stats.unknownRef++
    return null
  }
  for (const [key, doc] of Object.entries(details)) {
    const id = Number(doc?.id ?? key)
    if (!Number.isInteger(id) || id <= 0 || doc?.__status) continue
    const next = {
      contact_name: String(doc.contact?.name ?? "").trim(),
      warehouse_id: refId("warehouse_id", doc.stock),
      branch_id: refId("branch_id", doc.branch),
      organization_id: refId("organization_id", doc.division),
    }
    const row = (await client.query("SELECT id, contact_name, warehouse_id, branch_id, organization_id FROM supplier_incomings WHERE id = $1", [id])).rows[0]
    if (!row) {
      stats.missingSupply++
      continue
    }
    const previous = { contact_name: row.contact_name ?? "", warehouse_id: row.warehouse_id, branch_id: row.branch_id, organization_id: row.organization_id }
    const changed = Object.keys(next).filter((column) => (previous[column] ?? null) !== (next[column] ?? null))
    if (!changed.length) {
      stats.same++
      continue
    }
    await client.query("UPDATE supplier_incomings SET contact_name = $2, warehouse_id = $3, branch_id = $4, organization_id = $5 WHERE id = $1", [
      id,
      next.contact_name,
      next.warehouse_id,
      next.branch_id,
      next.organization_id,
    ])
    await register(client, run, "supplier_incomings", id, "update", Object.fromEntries(changed.map((column) => [column, previous[column] ?? null])))
    changes.push(`${id}: ${changed.map((column) => `${column} ${JSON.stringify(previous[column] ?? null)} → ${JSON.stringify(next[column])}`).join(", ")}`)
    stats.update++
  }
  if (dry) {
    await client.query("ROLLBACK")
    console.log(changes.join("\n"))
    console.log("DRY run, rolled back:", JSON.stringify(stats))
  } else {
    await client.query("COMMIT")
    console.log(`supply refs: ${Object.keys(details).length} supplies in Linko →`, JSON.stringify(stats))
  }
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
