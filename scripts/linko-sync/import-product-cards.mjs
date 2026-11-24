// Продукты: what only Linko's product card (main/product/{id}/) carries. The list the first copy came from has no
// «Минимальный остаток», «Поставщик», «Описание», «Продать только в группе», «Балл», shelf-life days, «Дополнительные
// параметры» (box_sizes), the min / max sale price, the attributes («Характеристика») and the real «Код для интеграции»
// (the list answers the first barcode as `code` when the product has none), and its «Показывать в боте» / ММЛ flags
// were not copied. This step reads the cards captured read-only from Linko (the SPA's own GETs while #/product/{id}
// opens) and:
//   1. writes those fields into products where they differ (a placeholder such as «Не указано» counts as empty);
//   2. adds the products Linko keeps in «Удалённые» that are not here yet (products.deleted = 1), from the same cards,
//      and gives the deleted ones copied before from documents their barcodes, creation date and prices;
//   3. copies each product's attribute values (product_options) into product_attribute_assignments, keyed by the
//      attribute id.
// Every change is registered in linko_sync_rows (an update with the previous values).
//
//   node scripts/linko-sync/import-product-cards.mjs          (DRY=1 only reports)
//   (raw: backups/linko-raw/<day>/product-detail/products_detail.json {id: card} and products_show_deleted.json —
//    the newest day that has them; with RAW=<folder> only <RAW>/product-detail/ or the capture folder RAW itself, the
//    step skipped without it)
import fs from "node:fs"
import path from "node:path"

import { bumpSequence, connect, currencyCode, ensureRegistry, productCardsFile, register, ruShortDate, runId, sqlDateTime } from "./lib.mjs"

// <RAW>/product-detail/products_detail.json or <RAW>/products_detail.json (skipped when RAW has neither), else the newest
// backups/linko-raw/<date> that has it (lib.mjs productCardsFile); the folder of that file holds the other captures.
const cardsFile = productCardsFile()
if (!cardsFile) {
  console.log("product cards: no raw product-detail/products_detail.json (capture the product cards first)")
  process.exit(0)
}
const folder = path.dirname(cardsFile)
const cards = Object.values(JSON.parse(fs.readFileSync(path.join(folder, "products_detail.json"), "utf8"))).filter((card) => card && card.id && !card.__status && !card.__error)
const deletedFile = path.join(folder, "products_show_deleted.json")
const deletedList = fs.existsSync(deletedFile) ? (JSON.parse(fs.readFileSync(deletedFile, "utf8")).results ?? []) : []
const deletedIds = new Set(deletedList.map((item) => Number(item.id)))

const run = runId("product-cards")
const PLACEHOLDERS = new Set(["", "не указано", "-", "no brand", "не указано м³.", "0 кг."])
const empty = (value) => PLACEHOLDERS.has(String(value ?? "").trim().toLowerCase())
const number = (value) => {
  const parsed = Number(value)
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? 0 : parsed
}
/** The leading number of a stored text ("20 шт.", "0,5 кг."). */
const leading = (value) => {
  const match = /-?\d[\d\s]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  return match ? Number(match[0].replace(/\s/g, "").replace(",", ".")) || 0 : 0
}
const plain = (value) => String(Math.round(number(value) * 1e6) / 1e6)
const flag = (value) => (value ? 1 : 0)
const text = (value) => String(value ?? "").trim()

/** Desired column values of one card; `same(column, current)` tells whether the stored value already says it. */
function columnsOf(card) {
  const minMax = Boolean(card.min_price && card.max_price)
  return {
    name: { value: text(card.name), same: (current) => current === text(card.name) },
    full_name: { value: text(card.full_name), same: (current) => text(current) === text(card.full_name) },
    article: { value: text(card.vendor_code), same: (current) => text(current) === text(card.vendor_code) },
    integration_code: { value: text(card.code), same: (current) => text(current) === text(card.code) },
    order_number: {
      value: card.stock_number === null || card.stock_number === undefined ? "" : plain(card.stock_number),
      same: (current) => text(current) === (card.stock_number === null || card.stock_number === undefined ? "" : plain(card.stock_number)),
    },
    type: { value: text(card.type?.name), same: (current) => text(current) === text(card.type?.name) },
    organization: { value: text(card.division?.name), same: (current) => text(current) === text(card.division?.name) },
    brand: { value: text(card.brand?.name) || "No brand", same: (current) => (empty(current) && !text(card.brand?.name)) || text(current) === text(card.brand?.name) },
    supplier: { value: text(card.provider?.name) || "Не указано", same: (current) => (empty(current) && !text(card.provider?.name)) || text(current) === text(card.provider?.name) },
    color: { value: text(card.bg_color?.name) || "Не указано", same: (current) => (empty(current) && !text(card.bg_color?.name)) || text(current) === text(card.bg_color?.name) },
    description: { value: text(card.description) || "Не указано", same: (current) => (empty(current) && !text(card.description)) || text(current) === text(card.description) },
    min_stock: { value: plain(card.min_amount), same: (current) => leading(current) === number(card.min_amount) },
    weight: { value: plain(card.kg_value), same: (current) => leading(current) === number(card.kg_value) },
    net_weight: { value: plain(card.weight_netto), same: (current) => leading(current) === number(card.weight_netto) },
    volume: { value: plain(card.capacity), same: (current) => leading(current) === number(card.capacity) },
    ikpu: { value: text(card.ikpu), same: (current) => text(current) === text(card.ikpu) },
    invoice_unit_code: { value: text(card.factura_package_code), same: (current) => text(current) === text(card.factura_package_code) },
    vat: {
      value: card.vat_percent === null || card.vat_percent === undefined || card.vat_percent === "" ? "Без НДС" : `${number(card.vat_percent)}%`,
      same: (current) =>
        card.vat_percent === null || card.vat_percent === undefined || card.vat_percent === "" ? !/\d/.test(String(current ?? "")) : leading(current) === number(card.vat_percent),
    },
    can_sell: { value: flag(card.can_sell), same: (current) => Number(current) === flag(card.can_sell) },
    only_mml: { value: flag(card.is_mml), same: (current) => Number(current) === flag(card.is_mml) },
    is_inventory: { value: flag(card.is_gear), same: (current) => Number(current) === flag(card.is_gear) },
    group_only: { value: flag(card.sell_only_box), same: (current) => Number(current) === flag(card.sell_only_box) },
    show_in_bot: { value: flag(card.show_in_market), same: (current) => Number(current) === flag(card.show_in_market) },
    track_expiry: { value: flag(card.use_expiration), same: (current) => Number(current) === flag(card.use_expiration) },
    track_series: { value: flag(card.use_series), same: (current) => Number(current) === flag(card.use_series) },
    expiration_days: { value: card.expiration_days ?? null, same: (current) => (current ?? null) === (card.expiration_days ?? null) },
    notify_expire_days: { value: card.notify_expire_days ?? null, same: (current) => (current ?? null) === (card.notify_expire_days ?? null) },
    marked_product: { value: flag(card.use_mark), same: (current) => Number(current) === flag(card.use_mark) },
    manual_discount: { value: flag(card.use_discount_percent), same: (current) => Number(current) === flag(card.use_discount_percent) },
    hide_from_agent: { value: flag(card.is_promo), same: (current) => Number(current) === flag(card.is_promo) },
    limit_price: { value: flag(minMax), same: (current) => Number(current) === flag(minMax) },
    sale_min_price: { value: minMax ? number(card.min_price) : 0, same: (current) => number(current) === (minMax ? number(card.min_price) : 0) },
    sale_max_price: { value: minMax ? number(card.max_price) : 0, same: (current) => number(current) === (minMax ? number(card.max_price) : 0) },
    sale_price_currency: { value: minMax ? currencyCode(card.currency) : "", same: (current) => text(current) === (minMax ? currencyCode(card.currency) : "") },
    sale_points: { value: plain(card.ball), same: (current) => leading(current) === number(card.ball) },
    box_sizes: {
      // Linko keeps an all-zero row for most products; its card prints it («Дополнительные параметры» 0 / 0 / 0).
      value: JSON.stringify(
        (card.box_sizes ?? []).map((size) => ({ unit: text(size.measurement?.name), height: number(size.height), width: number(size.width), length: number(size.length) })),
      ),
      same: (current) => {
        let stored = []
        try {
          stored = JSON.parse(String(current || "[]"))
        } catch {
          stored = []
        }
        const want = card.box_sizes ?? []
        return (
          Array.isArray(stored) &&
          stored.length === want.length &&
          want.every(
            (size, index) =>
              text(stored[index]?.unit) === text(size.measurement?.name) &&
              number(stored[index]?.height) === number(size.height) &&
              number(stored[index]?.width) === number(size.width) &&
              number(stored[index]?.length) === number(size.length),
          )
        )
      },
    },
  }
}

/** A card's prices in the app's price_lists JSON (lib/item-prices.ts): name, cash / non-cash and their currencies. */
const pricesOf = (card) =>
  (card.prices ?? [])
    .filter((price) => text(price.price_list?.name))
    .map((price) => ({
      name: text(price.price_list.name),
      cash: number(price.cash_price),
      nonCash: number(price.transfer_price),
      min: number(price.min_price),
      max: number(price.max_price),
      currency: currencyCode(price.cash_currency),
      nonCashCurrency: currencyCode(price.transfer_currency ?? price.cash_currency),
    }))

/** What a deleted product copied from Linko's documents lacks: its barcodes, creation date and prices (filled only where
 * empty here; the prices of live products are import-price-list-items.mjs's). */
function deletedGaps(card, row) {
  const values = {}
  const barcodes = (card.barcodes ?? []).map(text).filter(Boolean)
  if (barcodes.length && (!text(row.barcode) || /^не установлен/i.test(text(row.barcode)))) values.barcode = barcodes.join(", ")
  if (!text(row.created_date) && card.created_date) values.created_date = ruShortDate(card.created_date)
  const prices = pricesOf(card)
  if (prices.length && ["", "[]"].includes(text(row.price_lists))) values.price_lists = JSON.stringify(prices)
  return values
}

const client = await connect()
await ensureRegistry(client)
const stats = { updated: 0, same: 0, inserted: 0, fields: {}, attributes: 0, skipped: [] }
try {
  await client.query("BEGIN")
  const COLUMNS = Object.keys(columnsOf({}))
  for (const card of cards) {
    const id = Number(card.id)
    const wanted = columnsOf(card)
    const row = (
      await client.query(`SELECT ${COLUMNS.map((column) => `"${column}"`).join(", ")}, deleted, barcode, created_date, price_lists FROM products WHERE id = $1 FOR UPDATE`, [id])
    ).rows[0]
    if (!row) {
      // Only the products Linko lists under «Удалённые» are added here (a live product missing locally is a gap of
      // the first copy that this step does not try to fill).
      if (!card.is_delete || !deletedIds.has(id)) {
        stats.skipped.push(id)
        continue
      }
      const barcodes = (card.barcodes ?? []).map(text).filter(Boolean)
      const box = (card.boxes ?? [])[0]
      const boxName = text(box?.measurement?.name)
      const boxAmount = number(box?.amount)
      const values = {
        id,
        ...Object.fromEntries(COLUMNS.map((column) => [column, wanted[column].value])),
        barcode: barcodes.length ? barcodes.join(", ") : "не установлен",
        unit: text(card.measurement?.name),
        created_date: ruShortDate(card.created_date),
        created_at: sqlDateTime(card.created_date) ?? undefined,
        product_group: boxName && boxAmount > 0 ? boxName : "",
        box_unit: boxName && boxAmount > 0 ? boxName : "",
        box_amount: boxName && boxAmount > 0 ? boxAmount : 0,
        price_lists: JSON.stringify(pricesOf(card)),
        deleted: 1,
        is_raw: card.is_raw ? 1 : 0,
      }
      const columns = Object.keys(values).filter((column) => values[column] !== undefined)
      await client.query(
        `INSERT INTO products (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
        columns.map((column) => values[column]),
      )
      await register(client, run, "products", id, "insert")
      stats.inserted++
      continue
    }
    const changed = COLUMNS.filter((column) => !wanted[column].same(row[column]))
    const gaps = Number(row.deleted) === 1 ? deletedGaps(card, row) : {}
    const values = { ...Object.fromEntries(changed.map((column) => [column, wanted[column].value])), ...gaps }
    const columns = Object.keys(values)
    if (!columns.length) {
      stats.same++
      continue
    }
    await client.query(`UPDATE products SET ${columns.map((column, index) => `"${column}" = $${index + 2}`).join(", ")} WHERE id = $1`, [
      id,
      ...columns.map((column) => values[column]),
    ])
    await register(client, run, "products", id, "update", Object.fromEntries(columns.map((column) => [column, row[column]])))
    for (const column of Object.keys(gaps)) stats.fields[column] = (stats.fields[column] ?? 0) + 1
    for (const column of changed) stats.fields[column] = (stats.fields[column] ?? 0) + 1
    stats.updated++
  }
  await bumpSequence(client, "products")

  // «Характеристика»: the attribute values of a product, {attribute id: value}.
  await client.query(`CREATE TABLE IF NOT EXISTS product_attribute_assignments (
    product_id INTEGER PRIMARY KEY,
    values_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  for (const card of cards) {
    const options = card.product_options ?? []
    if (!options.length) continue
    const values = {}
    for (const option of options) {
      const attribute = option.option?.id ?? option.option_id
      const value = text(option.value ?? option.options_value?.value)
      if (attribute && value) values[String(attribute)] = value
    }
    if (!Object.keys(values).length) continue
    const current = (await client.query("SELECT values_json FROM product_attribute_assignments WHERE product_id = $1", [card.id])).rows[0]
    const json = JSON.stringify(values)
    if (current?.values_json === json) continue
    await client.query(
      `INSERT INTO product_attribute_assignments (product_id, values_json) VALUES ($1, $2)
       ON CONFLICT (product_id) DO UPDATE SET values_json = excluded.values_json, updated_at = datetime('now')`,
      [card.id, json],
    )
    await register(client, run, "product_attribute_assignments", card.id, current ? "update" : "insert", current ? { values_json: current.values_json } : null)
    stats.attributes++
  }
  // DRY=1: report what would change and leave the database as it was.
  await client.query(process.env.DRY === "1" ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `product cards: ${cards.length} cards; ${stats.updated} products updated (${Object.entries(stats.fields)
    .map(([column, count]) => `${column} ${count}`)
    .join(", ")}), ${stats.same} already equal, ${stats.inserted} deleted products added, ${stats.attributes} attribute sets; not here and not deleted in Linko: ${stats.skipped.join(",") || "none"}`,
)
