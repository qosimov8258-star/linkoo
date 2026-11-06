// Склад documents of the Linko account with their product lines, in the tables the stock ledger reads:
// - Возврат поставщиков → supplier_returns (items: key, product, qty, series, price, total)
// - Списание → write_offs (items: key, product, code, unit, series, block, qty, cost, sum)
// - Передачи между складами → internal_transfers (items: key, product, article, unit, quantity, price, weight, series)
// - Инвентаризация → stock_inventories + stock_inventory_items. Linko books an inventory's differences as separate
//   documents (a supply from "Инвенторизация" for a surplus, a write-off for a shortage — both imported with the other
//   supplies / write-offs), so an imported inventory is marked booked_by_documents = 1 and the stock ledger does not
//   count its differences a second time.
//
//   node scripts/linko-sync/import-stock-docs.mjs
import { connect, currencyCode, ensureRegistry, fullName, raw, register, ruShortDate, runId, sqlDateTime, upsertById } from "./lib.mjs"

const run = runId("stock-docs")
const num = (v) => (v == null || v === "" ? 0 : Number(v))
const round = (v) => Math.round(v * 1e6) / 1e6
const name = (v) => (v && typeof v === "object" ? v.name ?? "" : v ?? "")
const time = (v) => {
  const m = String(v ?? "").match(/[T ](\d{2}:\d{2})/)
  return m ? m[1] : ""
}
const series = (v) => (v && typeof v === "object" ? v.number ?? v.display_name ?? "" : v ?? "")

const client = await connect()
await ensureRegistry(client)
const out = {}
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE stock_inventories ADD COLUMN IF NOT EXISTS booked_by_documents INTEGER NOT NULL DEFAULT 0")
  await client.query("ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS supplier_id INTEGER")
  // The supplier of a return to the supplier by id (the detail names it only; the list row carries the id).
  const providerIds = new Map()
  for (const row of raw("supply_returns")) if (row.provider?.id) providerIds.set(row.id, row.provider.id)

  // --- Возврат поставщиков ------------------------------------------------------------------------------------------
  {
    const STATUS = { completed: "завершен", cancelled: "отменен", in_progress: "в процессе" }
    const PAYMENT = { cash: "Наличные", bank: "Банковский счет" }
    const docs = raw("supply_returns_detail")
    const s = (out.supplier_returns = { insert: 0, update: 0, same: 0 })
    for (const doc of Object.values(docs)) {
      if (doc.__status) throw new Error(`supply return ${doc.id}: detail missing`)
      const status = STATUS[doc.status] ?? "в процессе"
      const items = (doc.return_products ?? []).map((line, i) => ({
        id: i + 1,
        key: line.product?.id ? `product:${line.product.id}` : "",
        product: line.product?.name ?? "",
        qty: num(line.amount),
        series: series(line.series),
        price: round(num(line.cost)),
        total: round(num(line.total_price) || num(line.amount) * num(line.cost)),
      }))
      s[
        await upsertById(client, run, "supplier_returns", doc.id, {
          from_whom: name(doc.provider),
          warehouse: name(doc.from_stock),
          added_by: fullName(doc.created_by),
          date: ruShortDate(doc.created_date),
          time: time(doc.created_date),
          amount: num(doc.total_price),
          status,
          organization: name(doc.division),
          currency: currencyCode(doc.currency),
          payment_type: PAYMENT[doc.payment_type] ?? doc.payment_type ?? "",
          price_list: name(doc.price_list),
          branch: name(doc.branch),
          transfer_time: status === "завершен" ? sqlDateTime(doc.accepted_time ?? doc.created_date) : "",
          transferred_by: status === "завершен" ? fullName(doc.accepted_by) || fullName(doc.created_by) : "",
          cancelled_at: status === "отменен" ? sqlDateTime(doc.cancelled_time) ?? "" : "",
          cancelled_by: status === "отменен" ? fullName(doc.cancelled_by) : "",
          reason: doc.comment ?? "",
          items: JSON.stringify(items),
          supplier_id: providerIds.get(doc.id) ?? null,
        })
      ]++
    }
  }

  // --- Списание -----------------------------------------------------------------------------------------------------
  {
    const STATUS = { finished: "закрыт", canceled: "отменен", cancelled: "отменен", pending: "ожидает", new: "ожидает" }
    const docs = raw("writeoffs_detail")
    const s = (out.write_offs = { insert: 0, update: 0, same: 0 })
    for (const doc of Object.values(docs)) {
      if (doc.__status) throw new Error(`write-off ${doc.id}: detail missing`)
      const status = STATUS[doc.status] ?? "ожидает"
      const items = (doc.products ?? []).map((line, i) => ({
        id: i + 1,
        key: line.product?.id ? `product:${line.product.id}` : "",
        product: line.product?.name ?? "",
        code: line.product?.code ?? "",
        unit: line.product?.measurement?.name ?? "",
        series: series(line.series),
        block: 0,
        qty: num(line.amount),
        cost: round(num(line.price)),
        sum: round(num(line.total_price)),
      }))
      const created = sqlDateTime(doc.created_date)
      s[
        await upsertById(client, run, "write_offs", doc.id, {
          creator: fullName(doc.user),
          warehouse: name(doc.stock),
          date: String(doc.created_date ?? "").slice(0, 26),
          status,
          comment: doc.comment ?? "",
          items: JSON.stringify(items),
          created_at: created,
          finished_at: status === "закрыт" ? created : "",
          finished_by: status === "закрыт" ? fullName(doc.user) : "",
          cancelled_at: status === "отменен" ? created : "",
          cancelled_by: status === "отменен" ? fullName(doc.user) : "",
        })
      ]++
    }
  }

  // --- Передачи между складами ------------------------------------------------------------------------------------
  {
    const STATUS = { accepted: "принят", approved: "потвержден", given: "в пути", pending: "ожидает", cancelled: "отменен", canceled: "отменен" }
    const docs = raw("stock_transfers_detail")
    const s = (out.internal_transfers = { insert: 0, update: 0, same: 0 })
    for (const doc of Object.values(docs)) {
      if (doc.__status) throw new Error(`transfer ${doc.id}: detail missing`)
      const status = STATUS[doc.status] ?? "ожидает"
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
          ...(box && box.amount && qty ? { boxLabel: `${round(qty / box.amount)} ${box.measurement?.name ?? ""}`.trim() } : {}),
        }
      })
      const given = ["в пути", "принят"].includes(status)
      s[
        await upsertById(client, run, "internal_transfers", doc.id, {
          from_warehouse: name(doc.from_stock),
          to_warehouse: name(doc.to_stock),
          created_by: fullName(doc.user) || fullName(doc.accepted_by),
          created_at_label: ruShortDate(doc.created_date),
          delivered_at: ruShortDate(doc.date_delivery ?? doc.created_date),
          amount: num(doc.total_price),
          weight: num(doc.total_weight),
          status,
          price_list: name(doc.price_list),
          organization: name(doc.division),
          invoice_number: doc.invoice_number ?? "",
          transport_number: doc.transport_number ?? "",
          driver: doc.driver_name ?? "",
          comment: doc.comment ?? "",
          items: JSON.stringify(items),
          created_at: sqlDateTime(doc.created_date),
          given_at: given ? sqlDateTime(doc.given_time ?? doc.accepted_time ?? doc.created_date) : "",
          accepted_at: status === "принят" ? sqlDateTime(doc.accepted_time ?? doc.given_time ?? doc.created_date) : "",
          accepted_by: status === "принят" ? fullName(doc.accepted_by) : "",
          cancelled_at: status === "отменен" ? sqlDateTime(doc.cancelled_time) ?? "" : "",
          cancelled_by: status === "отменен" ? fullName(doc.cancelled_by) : "",
          currency: currencyCode(doc.currency),
        })
      ]++
    }
  }

  // --- Инвентаризация ---------------------------------------------------------------------------------------------
  {
    const STATUS = { confirmed: "confirmed", pending: "pending", canceled: "canceled", cancelled: "canceled" }
    const list = raw("inventories")
    const docs = raw("inventories_detail")
    const s = (out.stock_inventories = { insert: 0, update: 0, same: 0, items: 0, headersOnly: [] })
    for (const head of list) {
      const doc = docs[head.id] && !docs[head.id].__status ? docs[head.id] : null
      const src = doc ?? head
      const status = STATUS[src.status] ?? "pending"
      const created = sqlDateTime(src.created_date)
      s[
        await upsertById(client, run, "stock_inventories", head.id, {
          warehouse: name(src.stock),
          inv_date: String(src.created_date ?? "").slice(0, 10),
          for_day_end: src.for_day_end ? 1 : 0,
          type: src.type ?? "fact_date",
          status,
          comment: src.comment ?? "",
          currency: currencyCode(src.currency),
          total_price: num(src.total_price),
          created_by: fullName(src.created_by),
          created_at: created,
          confirmed_at: status === "confirmed" ? created : "",
          confirmed_by: status === "confirmed" ? fullName(src.created_by) : "",
          canceled_at: status === "canceled" ? created : "",
          canceled_by: status === "canceled" ? fullName(src.created_by) : "",
          booked_by_documents: 1,
        })
      ]++
      if (!doc) {
        s.headersOnly.push(head.id) // Linko answers 500 for this document: its lines cannot be read
        continue
      }
      const before = (await client.query("SELECT * FROM stock_inventory_items WHERE inventory_id = $1 ORDER BY id", [head.id])).rows
      await client.query("DELETE FROM stock_inventory_items WHERE inventory_id = $1", [head.id])
      let position = 0
      for (const line of doc.inventory_products ?? []) {
        const amount = num(line.amount)
        const balance = num(line.balance_amount)
        await client.query(
          `INSERT INTO stock_inventory_items (inventory_id, item_key, item_name, unit, amount, balance_amount, diff, cost, total_price, series, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            head.id,
            line.product?.id ? `product:${line.product.id}` : `name:${line.product?.name ?? ""}`,
            line.product?.name ?? "",
            line.product?.measurement?.name ?? "",
            amount,
            balance,
            round(amount - balance),
            round(num(line.cost)),
            round(num(line.total_price)),
            series(line.series),
            position++,
          ],
        )
        s.items++
      }
      await register(client, run, "stock_inventory_items", `inventory:${head.id}`, "replace", before)
    }
  }

  await client.query("COMMIT")
  console.log(JSON.stringify(out))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
