// Продажи → Возвраты, the order lines of the return form («Изменение возврата» / «Добавление возврата»):
// - order_items.linko_order_product_id: Linko's id of each copied order line (the «(N)» of «Заказ: 1453 (1149)» in the
//   form's product picker and of the lines an order brings), matched the way import-orders.mjs copied the lines (same
//   order, same product, same quantity first, in Linko's line order).
// - client_return_items.order_item_id of a copied return line: the local copy of its Linko order line. An earlier copy
//   pointed some lines at another line of the same product of the order (two lines of one order line), which made
//   the order's returnable quantities wrong.
// - With CARDS=<folder>: Linko's line facts (order line id, bonus flag, promotion) from return cards captured later with
//   the read-only harness (files sales_order_return_<id>_.json / order_return-<id>.json, Linko's
//   sales/order_return/{id}/ answers), for the lines that still match Linko's by place, product and quantity (a
//   cancelled return's line loses its order line id there).
// Every change is registered in linko_sync_rows with the previous value. --dry-run prints the changes and writes nothing.
//
//   node scripts/linko-sync/import-return-order-lines.mjs
//   CARDS=backups/linko-raw/2026-11-19/verify-edit-form node scripts/linko-sync/import-return-order-lines.mjs [--dry-run]
//   (raw: order_products — <RAW>/order_products.json when RAW is set, else the newest backups/linko-raw/<date> that
//   has it; CARDS is an explicit folder and is read as given)
import fs from "node:fs"
import path from "node:path"

import { ROOT, capturedOrSkip, connect, ensureRegistry, override, register, runId } from "./lib.mjs"

const DRY = process.argv.includes("--dry-run")

/** <RAW>/<name>.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> that has it. */
function rawFile(name) {
  const file = capturedOrSkip(`${name}.json`)
  if (!file) throw new Error(`No raw ${name}.json under backups/linko-raw: run scripts/linko-sync/fetch.mjs first`)
  return file
}

/** Captured return cards: {id → Linko's detail} from CARDS (a folder of single answers). */
function capturedCards() {
  const value = override("CARDS", { base: ROOT })
  const folder = value ? path.resolve(ROOT, value) : ""
  const cards = new Map()
  if (!folder) return cards
  for (const name of fs.readdirSync(folder)) {
    const match = /^(?:sales_)?order_return[-_](\d+)_?\.json$/.exec(name)
    if (!match) continue
    const body = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"))
    const detail = body?.returned_products ? body : body?.data?.returned_products ? body.data : null
    if (detail && Number(detail.id) === Number(match[1])) cards.set(Number(match[1]), detail)
  }
  return cards
}

const orderProducts = JSON.parse(fs.readFileSync(rawFile("order_products"), "utf8")).data
const cards = capturedCards()
const run = runId("return-order-lines")
const stats = { orderLines: { set: 0, same: 0, unmatched: 0 }, returnLines: { moved: 0 }, cardFacts: { set: 0, same: 0, skipped: [] } }
const changes = []

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The same column as lib/client-returns-repo.ts adds.
  await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS linko_order_product_id INTEGER")

  // 1. Linko's order line id on each copied order line.
  const linkoByOrder = new Map()
  for (const line of orderProducts) {
    if (!linkoByOrder.has(line.order_id)) linkoByOrder.set(line.order_id, [])
    linkoByOrder.get(line.order_id).push(line)
  }
  const localOf = new Map()
  for (const [orderId, want] of linkoByOrder) {
    const have = (await client.query("SELECT id, product_id, quantity, linko_order_product_id FROM order_items WHERE order_id = $1 ORDER BY id", [orderId])).rows
    const used = new Set()
    for (const line of want.sort((a, b) => a.id - b.id)) {
      const qty = Number(line.amount)
      const match =
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id && Math.abs(Number(h.quantity) - qty) < 1e-6) ??
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id)
      if (!match) {
        stats.orderLines.unmatched++
        continue
      }
      used.add(match.id)
      localOf.set(line.id, { id: match.id, orderId })
      if (match.linko_order_product_id === line.id) {
        stats.orderLines.same++
        continue
      }
      await client.query("UPDATE order_items SET linko_order_product_id = $2 WHERE id = $1", [match.id, line.id])
      await register(client, run, "order_items", match.id, "update", { linko_order_product_id: match.linko_order_product_id })
      stats.orderLines.set++
    }
  }

  // 2. Return lines copied from Linko (is_bonus set) that point at another local line than their Linko order line's.
  const copied = (await client.query(
    `SELECT i.id, i.return_id, i.order_item_id, i.linko_order_product_id, oi.order_id AS x_order
       FROM client_return_items i LEFT JOIN order_items oi ON oi.id = i.order_item_id
      WHERE i.is_bonus IS NOT NULL AND i.linko_order_product_id IS NOT NULL ORDER BY i.id`,
  )).rows
  for (const line of copied) {
    const local = localOf.get(line.linko_order_product_id)
    // Only within the same order: a line moved to another order here is left alone.
    if (!local || local.id === line.order_item_id || (line.x_order !== null && line.x_order !== local.orderId)) continue
    await client.query("UPDATE client_return_items SET order_item_id = $2 WHERE id = $1", [line.id, local.id])
    await register(client, run, "client_return_items", line.id, "update", { order_item_id: line.order_item_id })
    changes.push(`return ${line.return_id} line ${line.id}: order line ${line.order_item_id} → ${local.id} (Linko ${line.linko_order_product_id})`)
    stats.returnLines.moved++
  }

  // 3. Line facts of later captured return cards.
  for (const [returnId, detail] of cards) {
    const products = detail.returned_products ?? []
    const have = (await client.query("SELECT id, product_id, quantity, linko_order_product_id, is_bonus, promotion FROM client_return_items WHERE return_id = $1 ORDER BY id", [returnId])).rows
    const matches = have.length === products.length && have.every((h, i) => h.product_id === (products[i].product?.id ?? null) && Math.abs(Number(h.quantity) - Number(products[i].amount)) < 1e-9)
    if (!matches) {
      stats.cardFacts.skipped.push(returnId)
      continue
    }
    for (const [i, h] of have.entries()) {
      const p = products[i]
      const facts = { linko_order_product_id: p.order_product ?? null, is_bonus: p.is_bonus === true ? 1 : 0, promotion: p.promotion?.name ?? "" }
      if ((h.linko_order_product_id ?? null) === facts.linko_order_product_id && Number(h.is_bonus ?? -1) === facts.is_bonus && (h.promotion ?? "") === facts.promotion) {
        stats.cardFacts.same++
        continue
      }
      await client.query("UPDATE client_return_items SET linko_order_product_id = $2, is_bonus = $3, promotion = $4 WHERE id = $1", [h.id, facts.linko_order_product_id, facts.is_bonus, facts.promotion])
      await register(client, run, "client_return_items", h.id, "update", { linko_order_product_id: h.linko_order_product_id, is_bonus: h.is_bonus, promotion: h.promotion })
      changes.push(`return ${returnId} line ${h.id}: Linko order line ${h.linko_order_product_id} → ${facts.linko_order_product_id}`)
      stats.cardFacts.set++
    }
  }

  await client.query(DRY ? "ROLLBACK" : "COMMIT")
  for (const line of changes) console.log(line)
  console.log(`${DRY ? "(dry run, nothing written) " : ""}${JSON.stringify(stats)}`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
