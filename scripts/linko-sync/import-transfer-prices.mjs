// Prices and currency of the «Передачи между складами» copied from Linko, as Linko has them.
//
//   node scripts/linko-sync/import-transfer-prices.mjs        (DRY=1: list what would change, then roll back)
//
// A transfer without a price list keeps the prices typed on its lines in Linko (custom_price, often 0) and no currency.
// Until 2026-11-20 the app valued every given transfer without a price list at the cost of goods, including the ones
// copied from Linko (their lines were marked `priced: "cost"` and repriced), and the import gave a transfer without a
// currency SUM. This step puts Linko's values back, and touches nothing else:
// - line prices: only on a transfer whose goods Linko moved (given / accepted) and that is still as the import left it
//   (same status, same give moment), only lines that are the same line (place, product, quantity) and carry the app's
//   cost mark, and only when every marked line is such a line; the transfer's amount is then its lines' total;
// - currency: '' where Linko has none and the row still has the import's fallback SUM.
// Run after import-stock-docs.mjs. Raw file: stock_transfers_detail (the full download).
import { connect, ensureRegistry, raw, register, runId, sqlDateTime } from "./lib.mjs"

const run = runId("transfer-prices")
const dry = process.env.DRY === "1"
const num = (v) => (v == null || v === "" ? 0 : Number(v))
const round = (v) => Math.round(v * 1e6) / 1e6
const STATUS = { accepted: "принят", given: "в пути" }

const client = await connect()
await ensureRegistry(client)
const stats = { transfers: 0, lines: 0, currency: 0, skipped: 0 }
try {
  await client.query("BEGIN")
  for (const doc of Object.values(raw("stock_transfers_detail"))) {
    if (!doc || doc.__status || !Number.isInteger(doc.id)) continue
    const row = (await client.query("SELECT id, status, items, amount, currency, price_list, given_at FROM internal_transfers WHERE id = $1 FOR UPDATE", [doc.id])).rows[0]
    if (!row) continue
    const set = {}
    // Currency: Linko has none, the row still has the import's fallback.
    if (!doc.currency && row.currency === "SUM") set.currency = ""
    // Line prices of a transfer without a price list whose goods Linko moved, as imported.
    const status = STATUS[doc.status]
    const importedGive = status ? sqlDateTime(doc.given_time ?? doc.accepted_time ?? doc.created_date) : null
    if (!doc.price_list && !String(row.price_list ?? "").trim() && status && row.status === status && row.given_at === importedGive) {
      let all
      try {
        all = JSON.parse(row.items || "[]")
      } catch {
        all = null
      }
      const lines = Array.isArray(all) ? all.filter((line) => line && typeof line === "object") : []
      const marked = lines.filter((line) => line.priced === "cost")
      const linkoLines = doc.products ?? []
      const same = (line, position) => {
        const linko = linkoLines[position]
        return Boolean(linko) && line.key === `product:${linko.product?.id}` && Math.abs(num(line.quantity) - num(linko.amount)) < 1e-6
      }
      if (marked.length && lines.length === linkoLines.length && lines.every((line, position) => line.priced !== "cost" || same(line, position))) {
        const next = lines.map((line, position) => {
          if (line.priced !== "cost") return line
          const rest = { ...line }
          delete rest.priced
          return { ...rest, price: round(num(linkoLines[position].price)) }
        })
        let position = 0
        set.items = JSON.stringify(all.map((line) => (line && typeof line === "object" ? next[position++] : line)))
        set.amount = round(next.reduce((sum, line) => sum + num(line.quantity) * num(line.price), 0))
        stats.lines += marked.length
      } else if (marked.length) stats.skipped++
    }
    const columns = Object.keys(set)
    if (!columns.length) continue
    if (dry) console.log(`transfer ${doc.id}: ${columns.map((column) => `${column} ${JSON.stringify(row[column])} → ${JSON.stringify(set[column])}`).join("; ")}`)
    await client.query(`UPDATE internal_transfers SET ${columns.map((column, i) => `${column} = $${i + 2}`).join(", ")} WHERE id = $1`, [row.id, ...columns.map((column) => set[column])])
    await register(client, run, "internal_transfers", row.id, "update", Object.fromEntries(columns.map((column) => [column, row[column]])))
    stats.transfers++
    if ("currency" in set) stats.currency++
  }
  await client.query(dry ? "ROLLBACK" : "COMMIT")
  console.log(
    `${dry ? "[dry run] " : ""}transfer prices: ${stats.transfers} transfers changed; ${stats.lines} lines given Linko's price back; ${stats.currency} without a currency` +
      `${stats.skipped ? `; transfers whose lines differ locally, left alone ${stats.skipped}` : ""}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
