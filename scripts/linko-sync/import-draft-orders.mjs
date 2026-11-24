// «Интеграция» (Продажи): Linko's draft orders (sales/draft_order/) into ref_records kind 'draft-order' (id = Linko's
// id), the rows components/orders/draft-orders-view.tsx reads. Each person column there shows the record the draft is
// linked to in Linko (market, delivery_man, user; «Не указано» while it is null) above the name and id the integration
// sent (s_market_*, s_delivery_man_*, s_user_*). Every field the list and the draft's card print is written the way
// Linko prints it — a draft already here gets them refreshed (its other fields stay), a draft missing here is added
// whole — and, where the draft's card was captured (draft_order_details: sales/draft_order/<id>/), its product lines
// (`products`: product id and name, quantity and sum, the card's table). A draft deleted here stays deleted.
//
// Raw files: the newest backups/linko-raw/<date>/draft_orders.json and draft_order_details.json (with RAW=<folder> only
// those of RAW).
//
//   node scripts/linko-sync/import-draft-orders.mjs
//   node scripts/linko-sync/import-draft-orders.mjs --dry-run  (prints what would change, writes nothing)
import fs from "node:fs"

import { captured, capturedOrSkip, connect, ensureRegistry, fullName, register, ruShortDate, ruShortDateTime, runId } from "./lib.mjs"

const DRY_RUN = process.argv.includes("--dry-run")
const KIND = "draft-order"
const text = (value) => (value == null ? "" : String(value))

/** The `data` of the raw file of that name (<RAW>/<name>.json only when RAW is set, else the newest
 * backups/linko-raw/<date> that has it), or undefined. */
function latest(name) {
  const file = captured(`${name}.json`)
  return file ? JSON.parse(fs.readFileSync(file, "utf8")).data : undefined
}

// With RAW set, a folder without draft_orders.json skips the step.
capturedOrSkip("draft_orders.json")
const list = latest("draft_orders")
if (!Array.isArray(list)) throw new Error("Raw file missing: draft_orders.json (run fetch.mjs first)")
const details = latest("draft_order_details") ?? {}
const run = runId("draft-orders")

/** The linked records of a draft (null where Linko has none). */
function linked(row) {
  const market = row.market && Number.isSafeInteger(Number(row.market.id)) ? { id: Number(row.market.id), name: text(row.market.name) } : null
  return { market, deliveryMan: fullName(row.delivery_man) || null, user: fullName(row.user) || null }
}

/** "4,14221": Linko's number (5 decimals at most, trailing zeros dropped, a space between thousands). */
function number(value) {
  const fixed = Number(value ?? 0).toFixed(5).replace(/\.?0+$/, "")
  const [whole, fraction] = fixed.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${grouped}${fraction ? `,${fraction}` : ""}`
}

/** "4,14221 SUM": the number and the currency's name. */
function amount(value, currency) {
  return `${number(value)} ${text(currency?.name) || "SUM"}`
}

/** The card's product lines (№, Товар, Количество, Сумма); undefined when the card was not captured. */
function products(detail) {
  if (!detail || !Array.isArray(detail.products)) return undefined
  return detail.products.map((line) => ({
    id: line.id,
    productId: line.product?.id ?? null,
    name: text(line.product?.name),
    amount: number(line.amount),
    totalPrice: number(line.total_price),
  }))
}

/** A whole row, as the list prints a draft: "04 сент. 17:58" (no year), "04 сент. 2026", "Самовывоз" without a day. */
function fullData(row) {
  const lines = products(details[String(row.id)])
  return {
    id: row.id,
    type: row.type === "order_return" ? "Возврат" : "Заказ",
    serviceId: row.service_id == null ? null : String(row.service_id),
    ...linked(row),
    clientName: text(row.s_market_name),
    clientId: text(row.s_market_id),
    createdAt: ruShortDateTime(row.created_date).replace(/ \d{4}, /, " "),
    delivererName: text(row.s_delivery_man_name),
    delivererId: text(row.s_delivery_man_id),
    deliveryDate: row.date_delivery ? ruShortDate(row.date_delivery) : "Самовывоз",
    agentName: text(row.s_user_name),
    agentId: text(row.s_user_id),
    total: amount(row.total_price, row.currency),
    // The raw values Linko's header sort (ordering=createdDate / dateDelivery / totalPrice) orders by.
    createdDate: text(row.created_date),
    dateDelivery: row.date_delivery ? text(row.date_delivery) : null,
    totalPrice: Number(row.total_price ?? 0),
    comment: text(row.comment),
    ...(lines ? { products: lines } : {}),
  }
}

const client = await connect()
const stats = { inserted: 0, updated: 0, same: 0, deleted: 0 }
try {
  if (!DRY_RUN) {
    await client.query("BEGIN")
    await ensureRegistry(client)
  }
  for (const row of list) {
    const id = String(row.id)
    const current = (await client.query("SELECT data, deleted FROM ref_records WHERE kind = $1 AND id = $2", [KIND, id])).rows[0]
    if (!current) {
      const json = JSON.stringify(fullData(row))
      if (DRY_RUN) console.log("insert", id, json)
      else {
        await client.query("INSERT INTO ref_records (kind, id, data) VALUES ($1, $2, $3)", [KIND, id, json])
        await register(client, run, "ref_records", `${KIND}:${id}`, "insert")
      }
      stats.inserted++
      continue
    }
    if (current.deleted !== 0) {
      stats.deleted++
      continue
    }
    let data
    try {
      data = JSON.parse(current.data)
    } catch {
      data = null
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn(`draft ${id}: stored data is not an object, left alone`)
      continue
    }
    const json = JSON.stringify({ ...data, ...fullData(row) })
    if (json === current.data) {
      stats.same++
      continue
    }
    if (DRY_RUN) console.log("update", id, "\n  before", current.data, "\n  after ", json)
    else {
      await client.query("UPDATE ref_records SET data = $3, updated_at = datetime('now') WHERE kind = $1 AND id = $2", [KIND, id, json])
      await register(client, run, "ref_records", `${KIND}:${id}`, "update", current)
    }
    stats.updated++
  }
  if (!DRY_RUN) await client.query("COMMIT")
} catch (error) {
  if (!DRY_RUN) await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `draft orders: ${list.length} in Linko; ${DRY_RUN ? "would insert" : "inserted"} ${stats.inserted}, ${DRY_RUN ? "would update" : "updated"} ${stats.updated}, unchanged ${stats.same}` +
    (stats.deleted ? `, ${stats.deleted} deleted here (left alone)` : ""),
)
