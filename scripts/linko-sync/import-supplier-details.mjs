// Поставщики: what only a supplier's card has in Linko (stock/provider/{id}/) — its «Контакты» (name, email, phone, in
// Linko's order), «Добавить запас» (reserve_products: the product, the amount, the cost, its currency and whether the
// cost was «Указан вручную») and the «Дата добавления» of the card, which is Linko's modified_date (kept in
// suppliers.updated_at). The list (stock/provider/) has none of them, so the first copy left every supplier without
// contacts or reserve.
//
// Source: providers_detail.json of the raw folder (fetch.mjs «details» step, manifest entry «providers»), else the
// read-only capture backups/linko-raw/2026-11-20/providers_detail.json (never with RAW set); PROVIDERS_DETAIL=<file> picks
// another one.
// Only suppliers with the same id here are touched; a supplier whose contacts, reserve and date are already equal is
// left alone, so a second run changes nothing.
//
//   node scripts/linko-sync/import-supplier-details.mjs        (DRY=1 lists the changes and rolls back)
import fs from "node:fs"
import path from "node:path"

import { ROOT, capturedOrSkip, connect, ensureRegistry, hasRaw, override, rawDir, register, runId, sqlDateTime } from "./lib.mjs"

// PROVIDERS_DETAIL, else the raw folder's file (with RAW: <RAW>/providers_detail.json, skipped when it is not there),
// else the first account's capture of 2026-11-20.
const file =
  override("PROVIDERS_DETAIL") ??
  (hasRaw("providers_detail") ? path.join(rawDir(), "providers_detail.json") : capturedOrSkip("providers_detail.json", { legacy: "2026-11-20/providers_detail.json" }))
const details = JSON.parse(fs.readFileSync(file, "utf8")).data
const run = runId("supplier-details")
const dry = process.env.DRY === "1"

const text = (value) => (value == null ? "" : String(value))
const contactsOf = (doc) => (doc.contacts ?? []).map((contact) => ({ id: Number(contact.id), name: text(contact.name), email: text(contact.email), phone: text(contact.phone) }))
const productsOf = (doc) =>
  (doc.reserve_products ?? []).map((line) => ({
    id: Number(line.id),
    productId: line.product?.id == null ? null : Number(line.product.id),
    product: text(line.product?.name),
    unit: text(line.product?.measurement?.name),
    qty: Number(line.amount) || 0,
    price: Number(line.cost) || 0,
    currency: text(line.currency?.name) || "SUM",
    manual: Boolean(line.manual_cost),
  }))

let changed = 0
const missing = []
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  const local = new Map((await client.query("SELECT id, contacts, products, updated_at FROM suppliers")).rows.map((row) => [Number(row.id), row]))
  for (const [key, doc] of Object.entries(details)) {
    const id = Number(key)
    if (!doc || doc.__status) continue
    const row = local.get(id)
    if (!row) {
      missing.push(id)
      continue
    }
    const contacts = JSON.stringify(contactsOf(doc))
    const products = JSON.stringify(productsOf(doc))
    const modified = sqlDateTime(doc.modified_date) ?? row.updated_at
    if (row.contacts === contacts && row.products === products && row.updated_at === modified) continue
    if (dry) console.log(id, { contacts: contactsOf(doc).length, products: productsOf(doc).length, modified })
    await client.query("UPDATE suppliers SET contacts = $1, products = $2, updated_at = $3 WHERE id = $4", [contacts, products, modified, id])
    await register(client, run, "suppliers", id, "update", { contacts: row.contacts, products: row.products, updated_at: row.updated_at })
    changed++
  }
  await client.query(dry ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`supplier details (${path.relative(ROOT, file)}): ${changed} suppliers ${dry ? "would change" : "updated"}; missing here: ${missing.join(",") || "none"}`)
