// Cancelled «Передачи между складами» of the Linko account → internal_transfers (status «отменен») + their «Логи»
// (internal_transfer_logs). Linko lists a cancelled transfer only with «Показать отмененные передачи»
// (stock/stock_transfer/?with_cancelled=true), so the full download of 2026-11-06 did not have them (the manifest asks
// for them since 2026-11-20). A cancelled transfer moves no stock and no money (the stock ledger and the finance
// sources read «в пути» / «принят» only); it shows in the list with the checkbox and opens its card.
//
//   node scripts/linko-sync/import-cancelled-transfers.mjs          (DRY=1: list what would change, then roll back)
//
// Source: a read-only capture of Linko's screens (the list with with_cancelled=true, each cancelled card and its
// «Логи» tab) in backups/linko-raw/2026-11-20/stock-transfers-cancelled (stock_transfers_detail.json,
// stock_transfers_logs.json); CANCELLED_DIR=<folder> picks another one. A full download that has them
// (stock_transfers_detail with cancelled documents) is imported by import-stock-docs.mjs instead.
//
// Fields as import-stock-docs.mjs maps a transfer, with what Linko keeps on a cancelled one: the hand-over and
// acceptance moments its card still shows (given_time / accepted_time), and the moment and user of its last «canceled»
// log entry (Linko's cancelled_time is empty). Linko cannot open the card of five old cancelled transfers (4, 5, 10, 15,
// 17), so their «Логи» were not captured: they come without log rows. A transfer that already exists here is updated
// only while it is cancelled here too (a live document is never touched); logs are added as import-transfer-logs.mjs
// does (not when the app wrote its own rows for the transfer).
import fs from "node:fs"
import path from "node:path"

import { ROOT, bumpSequence, connect, currencyCode, ensureRegistry, fullName, register, ruShortDate, runId, sqlDateTime, upsertById } from "./lib.mjs"

const dir = process.env.CANCELLED_DIR ?? path.join(ROOT, "backups", "linko-raw", "2026-11-20", "stock-transfers-cancelled")
const read = (name) => {
  const file = path.join(dir, `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`Capture missing: ${file}`)
  return JSON.parse(fs.readFileSync(file, "utf8")).data ?? {}
}
const details = read("stock_transfers_detail")
const logs = read("stock_transfers_logs")

const run = runId("cancelled-transfers")
const dry = process.env.DRY === "1"
const num = (v) => (v == null || v === "" ? 0 : Number(v))
const round = (v) => Math.round(v * 1e6) / 1e6
const name = (v) => (v && typeof v === "object" ? v.name ?? "" : v ?? "")
const series = (v) => (v && typeof v === "object" ? v.number ?? v.display_name ?? "" : v ?? "")
// Linko's statuses → the app's (lib/internal-transfers-repo.ts statusOf).
const STATUS = { pending: "ожидает", approved: "потвержден", given: "в пути", accepted: "принят", cancelled: "отменен", canceled: "отменен" }
const ACTIONS = new Set(["created", "updated", "approved", "given", "cancel_given", "accepted", "cancel_accepted", "canceled"])

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, liveSkipped: [], logRows: 0, logsKept: 0, noLogs: [] }
try {
  await client.query("BEGIN")
  for (const doc of Object.values(details)) {
    if (!doc || !Number.isInteger(doc.id) || doc.status !== "cancelled") continue
    const current = (await client.query("SELECT status FROM internal_transfers WHERE id = $1", [doc.id])).rows[0]
    if (current && current.status !== "отменен") {
      stats.liveSkipped.push(doc.id)
      continue
    }
    const items = (doc.products ?? []).map((line, i) => {
      const box = (line.product?.boxes ?? [])[0]
      const qty = num(line.amount)
      return {
        id: i + 1,
        key: line.product?.id ? `product:${line.product.id}` : "",
        product: line.product?.name ?? "",
        article: line.product?.vendor_code ?? line.product?.code ?? "",
        unit: line.product?.measurement?.name ?? "",
        quantity: qty,
        price: round(num(line.price)),
        weight: num(line.product?.kg_value),
        series: series(line.series),
        ...(line.series && typeof line.series === "object" && Number.isInteger(line.series.id) ? { seriesId: line.series.id } : {}),
        ...(box && box.amount && qty ? { boxLabel: `${round(qty / box.amount)} ${box.measurement?.name ?? ""}`.trim() } : {}),
      }
    })
    const entries = Array.isArray(logs[doc.id]) ? logs[doc.id] : []
    const cancel = [...entries].filter((entry) => entry.action === "canceled").sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)))[0]
    stats[
      await upsertById(client, run, "internal_transfers", doc.id, {
        from_warehouse: name(doc.from_stock),
        to_warehouse: name(doc.to_stock),
        created_by: fullName(doc.user) || fullName(doc.accepted_by),
        created_at_label: ruShortDate(doc.created_date),
        delivered_at: ruShortDate(doc.date_delivery ?? doc.created_date),
        amount: num(doc.total_price),
        weight: num(doc.total_weight),
        status: "отменен",
        price_list: name(doc.price_list),
        organization: name(doc.division),
        invoice_number: doc.invoice_number ?? "",
        transport_number: doc.transport_number ?? "",
        driver: doc.driver_name ?? "",
        comment: doc.comment ?? "",
        items: JSON.stringify(items),
        created_at: sqlDateTime(doc.created_date),
        given_at: doc.given_time ? sqlDateTime(doc.given_time) : "",
        accepted_at: doc.accepted_time ? sqlDateTime(doc.accepted_time) : "",
        accepted_by: doc.accepted_time ? fullName(doc.accepted_by) : "",
        cancelled_at: doc.cancelled_time ? sqlDateTime(doc.cancelled_time) : cancel ? sqlDateTime(cancel.created_date) : "",
        cancelled_by: fullName(doc.cancelled_by) || (cancel ? fullName(cancel.created_by) : ""),
        // A transfer without a currency in Linko (no price list, typed prices) keeps none.
        currency: doc.currency ? currencyCode(doc.currency) : "",
      })
    ]++

    // --- «Логи» (as import-transfer-logs.mjs) ---
    if (!entries.length) {
      stats.noLogs.push(doc.id)
      continue
    }
    const existing = (
      await client.query(
        `SELECT l.action, left(l.created_at::text, 19) AS at,
                EXISTS (SELECT 1 FROM linko_sync_rows s WHERE s.table_name = 'internal_transfer_logs' AND s.row_id = l.id::text) AS imported
           FROM internal_transfer_logs l WHERE l.transfer_id = $1`,
        [doc.id],
      )
    ).rows
    if (existing.some((row) => !row.imported)) {
      stats.logsKept++
      continue
    }
    const have = new Set(existing.map((row) => `${row.action}|${String(row.at).replace("T", " ")}`))
    for (const entry of [...entries].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)))) {
      const action = ACTIONS.has(entry.action) ? entry.action : entry.action === "cancelled" ? "canceled" : null
      if (!action) continue
      const at = String(entry.created_date ?? "").slice(0, 19)
      if (have.has(`${action}|${at.replace("T", " ")}`)) continue
      const inserted = await client.query(
        `INSERT INTO internal_transfer_logs (transfer_id, action, status, from_warehouse, to_warehouse, comment, currency, items, user_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          doc.id,
          action,
          STATUS[entry.status] ?? String(entry.status ?? ""),
          String(entry.from_stock_name ?? ""),
          String(entry.to_stock_name ?? ""),
          String(entry.comment ?? ""),
          String(entry.currency?.name ?? "").toUpperCase() === "EURO" ? "EUR" : String(entry.currency?.name ?? ""),
          JSON.stringify(items),
          fullName(entry.created_by),
          at,
        ],
      )
      await register(client, run, "internal_transfer_logs", inserted.rows[0].id, "insert")
      stats.logRows++
    }
  }
  await bumpSequence(client, "internal_transfers")
  await client.query(dry ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `cancelled transfers${dry ? " (dry run, rolled back)" : ""}: ${stats.insert} added, ${stats.update} updated, ${stats.same} same; live here, left alone: ${stats.liveSkipped.join(",") || "none"}; ${stats.logRows} log rows (${stats.logsKept} transfers kept their own log; without a captured log: ${stats.noLogs.join(",") || "none"})`,
)
