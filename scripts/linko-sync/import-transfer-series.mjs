// Серия of the lines of «Передачи между складами»: Linko's stock_transfer_product.series (an object with the series id)
// → internal_transfers.items[].seriesId (+ its name in items[].series), on the shared series catalog stock_series
// (import-series.mjs copies it with Linko's ids).
//
//   node scripts/linko-sync/import-transfer-series.mjs
//
// import-stock-docs.mjs already writes seriesId for the transfers it imports; this step adds it to transfers imported
// before it did, and touches nothing else: a local line gets Linko's series id only when it is the same line (same
// position, product and quantity) and has no series id yet, and its series text is empty or Linko's. A line whose series
// was chosen or distributed in the app (it has a series id) is left alone. Run after import-series.mjs and
// import-stock-docs.mjs. Raw file: stock_transfers_detail (the full download).
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("transfer-series")
const client = await connect()
await ensureRegistry(client)
const stats = { transfers: 0, lines: 0, missingSeries: 0, skipped: 0 }
try {
  await client.query("BEGIN")
  const known = new Set((await client.query("SELECT id FROM stock_series")).rows.map((row) => Number(row.id)))
  const docs = raw("stock_transfers_detail")
  for (const doc of Object.values(docs)) {
    if (!doc || doc.__status || !Number.isInteger(doc.id)) continue
    const linkoLines = doc.products ?? []
    if (!linkoLines.some((line) => line.series && typeof line.series === "object")) continue
    const row = (await client.query("SELECT id, items FROM internal_transfers WHERE id = $1 FOR UPDATE", [doc.id])).rows[0]
    if (!row) continue
    let all
    try {
      all = JSON.parse(row.items || "[]")
    } catch {
      continue
    }
    if (!Array.isArray(all)) continue
    const lines = all.filter((line) => line && typeof line === "object")
    let changed = 0
    linkoLines.forEach((linko, position) => {
      const series = linko.series
      const local = lines[position]
      if (!series || typeof series !== "object" || !Number.isInteger(series.id) || !local) return
      const name = String(series.number ?? series.display_name ?? "")
      const sameLine = local.key === `product:${linko.product?.id}` && Math.abs(Number(local.quantity) - Number(linko.amount)) < 1e-6
      if (!sameLine || local.seriesId != null || (local.series && local.series !== name)) {
        if (local.seriesId !== series.id) stats.skipped++
        return
      }
      if (!known.has(series.id)) {
        stats.missingSeries++
        return
      }
      local.seriesId = series.id
      local.series = name
      changed++
    })
    if (!changed) continue
    let position = 0
    const next = all.map((line) => (line && typeof line === "object" ? lines[position++] : line))
    await client.query("UPDATE internal_transfers SET items = $2 WHERE id = $1", [row.id, JSON.stringify(next)])
    await register(client, run, "internal_transfers", row.id, "update", { items: row.items })
    stats.transfers++
    stats.lines += changed
  }
  await client.query("COMMIT")
  console.log(
    `transfer series: ${stats.lines} lines of ${stats.transfers} transfers given their series id` +
      `${stats.missingSeries ? `; series missing from stock_series (run import-series.mjs first) ${stats.missingSeries}` : ""}` +
      `${stats.skipped ? `; lines that differ locally, left alone ${stats.skipped}` : ""}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
