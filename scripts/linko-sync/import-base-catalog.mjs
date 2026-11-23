// Base catalog of a Linko account: the rows every other catalog and document step expects to find, created from the
// download (a new account's copy starts without them; the first account's came from an early one-off import).
//
//   measurements                     → units_of_measure (Ед.измерения: Linko id, name, parent, «весовой»)
//   product_types                    → product_types (Типы продуктов: Linko id, parent, «Порядок» = order, organization
//                                      = the division's name, «Показывать в боте» = show_in_market, picture)
//   brands                           → brands (Linko id, organization = the division's name, picture: Linko's
//                                      «no photo» placeholder as the app's /no-photo-available.svg, as the first copy)
//   price_lists                      → price_lists (headers only: Linko id, currency, «Связать прайс-лист» by name,
//                                      «Порядок», active / default flags, creation and change time stored as UTC like
//                                      the page writes them); the prices are import-price-list-items.mjs's
//   products (+ products_notraw, products_raw, products_deleted)
//                                    → products (Linko id: order lines, documents and the later steps look products up
//                                      by it), with what Linko's list carries: names, barcodes («не установлен» when
//                                      none), article, «Код для интеграции» (the list answers the first barcode as
//                                      `code`: such a code is left to import-product-cards.mjs), the product's own type
//                                      name, organization, unit, brand («No brand»), creation day, «Порядковый номер»,
//                                      sale / ММЛ / bot flags, «Балл», weight, volume, ИКПУ, package code, НДС, colour,
//                                      the box (Мера: products.product_group / box_unit / box_amount, as
//                                      import-product-boxes.mjs), is_raw, and the cost cache from products_net_costs
//   products_raw                     → raw_materials too (Сырье lists them; ids of their own, matched by name and unit
//                                      as import-product-boxes.mjs / import-raw-cards.mjs match them)
//   excel_codes                      → order_excel_settings (Linko id, name, key, the switched-on columns)
//   e_options / e_option_values      → product_attributes / product_attribute_values (Характеристики: Linko option id)
//   rival_products                   → rival_products (name, competitor = the rival's name; ids of their own as in the
//                                      first copy: a Linko row is matched by its name and competitor, never renamed)
//
// What only the product card carries (min stock, supplier, description, attributes, shelf life …) is
// import-product-cards.mjs's, prices are import-price-list-items.mjs / import-price-bounds.mjs's, deleted products the
// documents name are import-deleted-products.mjs's. frozen_products (stock/frozen_product/: stock amounts and days
// without movement) is a report the app computes itself: nothing is copied from it.
//
// Idempotent: a new row is inserted with its Linko id, an existing one gets only the columns whose value differs from
// Linko's (compared the way import-product-cards.mjs compares, so the two steps never undo each other); a value that a
// later step refines (the box, a barcode-like «Код для интеграции», the cost cache) is only filled where empty, and a
// product deleted here is never revived. Every insert / update is registered in linko_sync_rows (an update with the
// previous values). The app's own tables and columns are created first by base-catalog-schema.ts (the app's code).
//
//   node scripts/linko-sync/import-base-catalog.mjs        (DRY=1 lists the changes and rolls back; the schema step
//   still runs. RAW / TARGET_DB / the account guard as for every importer, lib.mjs)
import { spawnSync } from "node:child_process"
import path from "node:path"

import { ROOT, bumpSequence, connect, currencyCode, ensureRegistry, hasRaw, raw, register, ruShortDate, runId, sqlDateTime, utcIso } from "./lib.mjs"

const dry = process.env.DRY === "1"
const run = runId("base-catalog")
const list = (name) => (hasRaw(name) ? raw(name) : [])
const rows = (data) => (Array.isArray(data) ? data : []).filter((row) => row && Number.isInteger(Number(row.id)) && Number(row.id) > 0 && !row.__status)

// --- raw -------------------------------------------------------------------------------------------------------------

if (!hasRaw("products") && !hasRaw("products_notraw")) throw new Error("Raw file missing: products.json (main/product/)")
const rawItems = rows(list("products_raw"))
const rawIds = new Set(rawItems.map((item) => Number(item.id)))
// main/product/ lists every live product (raw ones too); the is_raw / is_delete lists add what it may leave out. Linko
// ignores ?is_delete=true (its «Удалённые» tab reads another filter), so only a row flagged is_delete counts as deleted.
const productsById = new Map()
for (const item of [...rows(list("products")), ...rows(list("products_notraw")), ...rawItems]) if (!productsById.has(Number(item.id))) productsById.set(Number(item.id), item)
for (const item of rows(list("products_deleted"))) if (item.is_delete && !productsById.has(Number(item.id))) productsById.set(Number(item.id), item)
const products = [...productsById.values()].sort((a, b) => a.id - b.id)
const netCost = new Map(rows(list("products_net_costs")).map((row) => [Number(row.id), row.net_cost]))
const measurements = rows(list("measurements"))
const productTypes = rows(list("product_types"))
const brands = rows(list("brands"))
const priceLists = rows(list("price_lists"))
const excelCodes = rows(list("excel_codes"))
const options = rows(list("e_options")).filter((option) => !option.is_delete)
const optionValues = rows(list("e_option_values")).filter((value) => !value.is_delete)
const rivalProducts = rows(list("rival_products"))

// --- values as the app stores them ----------------------------------------------------------------------------------

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
const money = (value) => Math.round(number(value) * 1e6) / 1e6
const flag = (value) => (value ? 1 : 0)
const text = (value) => String(value ?? "").trim()
const nameOf = (value) => text(value && typeof value === "object" ? value.name : value)
const idOf = (value) => {
  const id = Number(value && typeof value === "object" ? value.id : value)
  return Number.isInteger(id) && id > 0 ? id : null
}
/** Linko's Tashkent wall-clock time as the UTC text the app's datetime('now') writes ("2024-09-21 14:25:46"). */
const utcText = (value) => (utcIso(value) ? utcIso(value).slice(0, 19).replace("T", " ") : undefined)
/** A picture of Linko (an address, or {file} of its media server) as the dictionaries store it: Linko's «no photo»
 * placeholder is the app's own copy of it, another picture keeps its address (lib/dictionaries-schema.ts storedImageUrl
 * shows an http(s) address as it is). */
const pictureOf = (value) => {
  const file = text(value && typeof value === "object" ? value.file : value)
  if (!file) return null
  return /\/no-photo-available\.[a-z]+$/i.test(file) ? "/no-photo-available.svg" : file
}
/** The barcodes of a stored text (as lib/products-catalog.ts splitBarcodes reads them). */
const storedBarcodes = (value) =>
  text(value)
    .split(/[,;\n]/)
    .map((code) => code.trim())
    .filter((code) => code && !/^не установлен/i.test(code))

// Column specs: { value, same(current) } — `same` tells whether the stored value already says Linko's; `fill` = write
// only while the stored value is empty (a later step or the app refines it); `insert` = only on a new row.
const exact = (value) => ({ value: text(value), same: (current) => text(current) === text(value) })
const named = (value, fallback) => ({ value: text(value) || fallback, same: (current) => (empty(current) && !text(value)) || text(current) === text(value) })
const amount = (value) => ({ value: plain(value), same: (current) => leading(current) === number(value) })
const bool = (value) => ({ value: flag(value), same: (current) => Number(current) === flag(value) })
const nullable = (value) => ({ value: value ?? null, same: (current) => (current ?? null) === (value ?? null) })
const integer = (value) => ({ value: Math.trunc(number(value)), same: (current) => Number(current) === Math.trunc(number(value)) })
const json = (value) => ({ value: JSON.stringify(value), same: (current) => text(current) === JSON.stringify(value) })
const stamp = (value) => ({ value, same: (current) => value === undefined || text(current) === value })
/** Written on a new row only (a change time the app moves on its own edits). */
const onInsert = (value) => ({ value, insert: true })

/** The columns of a products row from Linko's list item. */
function productColumns(product) {
  const barcodes = (product.barcodes ?? []).map(text).filter(Boolean)
  const code = text(product.code)
  // Linko's list answers the first barcode as `code` when the product has none: only the card knows the real one.
  const codeIsBarcode = Boolean(code) && barcodes.includes(code)
  const box = (product.boxes ?? [])[0]
  const boxName = text(box?.measurement?.name)
  const boxAmount = number(box?.amount)
  const hasBox = Boolean(box && boxName && boxAmount > 0)
  const vat = product.vat_percent === null || product.vat_percent === undefined || product.vat_percent === "" ? null : number(product.vat_percent)
  const stock = product.stock_number === null || product.stock_number === undefined ? "" : plain(product.stock_number)
  return {
    name: exact(product.name),
    full_name: exact(product.full_name),
    barcode: {
      value: barcodes.length ? barcodes.join(", ") : "не установлен",
      same: (current) => JSON.stringify(storedBarcodes(current)) === JSON.stringify(barcodes),
    },
    article: exact(product.vendor_code),
    integration_code: { value: codeIsBarcode ? "" : code, same: (current) => (codeIsBarcode ? true : text(current) === code) },
    type: exact(nameOf(product.type)),
    organization: exact(nameOf(product.division)),
    unit: exact(nameOf(product.measurement)),
    brand: named(nameOf(product.brand), "No brand"),
    created_date: exact(ruShortDate(product.created_date)),
    created_at: stamp(sqlDateTime(product.created_date) ?? undefined),
    order_number: { value: stock, same: (current) => text(current) === stock },
    can_sell: bool(product.can_sell),
    only_mml: bool(product.is_mml),
    show_in_bot: bool(product.show_in_market),
    sale_points: amount(product.ball),
    weight: amount(product.kg_value),
    volume: amount(product.capacity),
    ikpu: exact(product.ikpu),
    invoice_unit_code: exact(product.factura_package_code),
    vat: { value: vat === null ? "Без НДС" : `${vat}%`, same: (current) => (vat === null ? !/\d/.test(String(current ?? "")) : leading(current) === vat) },
    color: named(nameOf(product.bg_color), "Не указано"),
    is_raw: bool(rawIds.has(Number(product.id))),
    // The box (Мера «коробка / 20 шт»): filled where empty, as import-product-boxes.mjs does.
    product_group: { value: hasBox ? boxName : "", fill: true },
    box_unit: { value: hasBox ? boxName : "", fill: true },
    box_amount: { value: hasBox ? boxAmount : 0, fill: true },
    // The products.cost cache (the cost of goods is the app's ledger, lib/stock/costs.ts): Linko's current cost until
    // the ledger has one.
    cost: { value: netCost.has(Number(product.id)) ? money(netCost.get(Number(product.id))) : 0, fill: true },
    // Linko's deleted flag; a product deleted here is never revived.
    deleted: { value: flag(product.is_delete), same: (current) => !product.is_delete || Number(current) === 1 },
  }
}

/** The columns of a raw_materials row (Сырье) from Linko's list item of a raw product. */
function rawMaterialColumns(product) {
  const all = productColumns(product)
  const pick = (...names) => Object.fromEntries(names.map((name) => [name, all[name]]))
  return {
    ...pick("name", "full_name", "barcode", "article", "integration_code", "type", "organization", "unit", "brand", "created_date", "created_at"),
    ...pick("order_number", "can_sell", "only_mml", "show_in_bot", "sale_points", "volume", "ikpu", "invoice_unit_code", "vat", "color", "deleted"),
    mass: amount(product.kg_value),
    product_group: all.product_group,
    box_amount: all.box_amount,
  }
}

// --- writes ----------------------------------------------------------------------------------------------------------

const stats = {}
const count = (table, action) => {
  stats[table] ??= { insert: 0, update: 0, same: 0 }
  stats[table][action]++
}
const filled = (value) => !(value === null || value === undefined || text(value) === "" || text(value) === "0" || text(value) === "[]")

/** Inserts the row (`id` given, or a new one) or updates the columns that differ; registers what it did. Returns the id. */
async function sync(client, table, id, spec) {
  const columns = Object.keys(spec)
  const quoted = columns.map((column) => `"${column}"`).join(", ")
  const current = id === null ? null : (await client.query(`SELECT ${quoted} FROM ${table} WHERE id = $1 FOR UPDATE`, [id])).rows[0]
  if (!current) {
    const insert = columns.filter((column) => spec[column].value !== undefined)
    const names = [...(id === null ? [] : ["id"]), ...insert]
    const result = await client.query(
      `INSERT INTO ${table} (${names.map((column) => `"${column}"`).join(", ")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
      [...(id === null ? [] : [id]), ...insert.map((column) => spec[column].value)],
    )
    const newId = Number(result.rows[0].id)
    await register(client, run, table, newId, "insert")
    count(table, "insert")
    return newId
  }
  const changed = columns.filter((column) => {
    const { value, same, fill, insert } = spec[column]
    if (insert || value === undefined) return false
    if (fill) return !filled(current[column]) && filled(value)
    return !same(current[column])
  })
  if (!changed.length) {
    count(table, "same")
    return id
  }
  await client.query(`UPDATE ${table} SET ${changed.map((column, index) => `"${column}" = $${index + 2}`).join(", ")} WHERE id = $1`, [
    id,
    ...changed.map((column) => spec[column].value),
  ])
  await register(client, run, table, id, "update", Object.fromEntries(changed.map((column) => [column, current[column]])))
  count(table, "update")
  if (dry) console.log(`  ${table} #${id}: ${changed.map((column) => `${column} ${JSON.stringify(current[column])} → ${JSON.stringify(spec[column].value)}`).join("; ")}`)
  return id
}

/** Rows of a tree (parent first), so a parent_id always points at a row written before it. */
function parentsFirst(items, parentOf) {
  const byId = new Map(items.map((item) => [Number(item.id), item]))
  const depth = (item, seen = new Set()) => {
    const parent = parentOf(item)
    if (parent === null || !byId.has(parent) || seen.has(parent)) return 0
    seen.add(parent)
    return 1 + depth(byId.get(parent), seen)
  }
  return [...items].sort((a, b) => depth(a) - depth(b) || a.id - b.id)
}

const FIELD_TYPES = { text: "Текстовое поле", number: "Цифровое поле", select: "Выбор вариантов" }

// The app's own schema first (its code creates the lazily made tables and columns on the target database).
const schema = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", "--tsconfig", path.join(ROOT, "tsconfig.json"), path.join(ROOT, "scripts/linko-sync/base-catalog-schema.ts")],
  { stdio: "inherit", env: process.env, cwd: ROOT },
)
if (schema.status !== 0) {
  console.error("base catalog: the schema step failed; nothing written")
  process.exit(1)
}

const client = await connect()
await ensureRegistry(client)
const unknown = { parents: [], fieldTypes: [], calcMethods: [], rawAmbiguous: [] }
try {
  await client.query("BEGIN")

  // Ед.измерения (a parent: Linko's id or {id})
  const unitIds = new Set(measurements.map((unit) => Number(unit.id)))
  for (const unit of parentsFirst(measurements, (item) => idOf(item.parent))) {
    const parent = idOf(unit.parent)
    if (parent !== null && !unitIds.has(parent)) unknown.parents.push(`unit ${unit.id}→${parent}`)
    await sync(client, "units_of_measure", Number(unit.id), {
      name: exact(unit.name),
      parent_id: nullable(parent !== null && unitIds.has(parent) ? parent : null),
      is_weighted: bool(unit.is_weighted),
      created_at: stamp(sqlDateTime(unit.created_date) ?? undefined),
    })
  }
  await bumpSequence(client, "units_of_measure")

  // Типы продуктов (two levels; a product keeps its own type's name)
  const typeIds = new Set(productTypes.map((type) => Number(type.id)))
  const typeNames = new Map(productTypes.map((type) => [Number(type.id), text(type.name)]))
  for (const type of parentsFirst(productTypes, (item) => idOf(item.parent))) {
    const parent = idOf(type.parent)
    if (parent !== null && !typeIds.has(parent)) unknown.parents.push(`type ${type.id}→${parent}`)
    await sync(client, "product_types", Number(type.id), {
      name: exact(type.name),
      organization: exact(nameOf(type.division)),
      parent_id: nullable(parent !== null && typeIds.has(parent) ? parent : null),
      show_in_bot: bool(type.show_in_market),
      position: integer(type.order),
      image: nullable(pictureOf(type.image)),
      created_at: stamp(sqlDateTime(type.created_date) ?? undefined),
    })
  }
  await bumpSequence(client, "product_types")

  // Бренд
  for (const brand of brands) {
    await sync(client, "brands", Number(brand.id), {
      name: exact(brand.name),
      organization: exact(nameOf(brand.division)),
      photo_url: nullable(pictureOf(brand.image)),
      created_at: stamp(sqlDateTime(brand.created_date) ?? undefined),
    })
  }
  await bumpSequence(client, "brands")

  // Прайс-листы (the headers; Linko's calc methods have no counterpart in its data so far: one is reported, not guessed)
  for (const list of priceLists) {
    if (list.calc_method || (list.method_values ?? []).length) unknown.calcMethods.push(list.id)
    const code = list.currency ? currencyCode(list.currency) : ""
    await sync(client, "price_lists", Number(list.id), {
      name: exact(list.name),
      // The currency's code; none = the base currency (a stored «Euro» already says EUR, as lib/finance/currency.ts
      // normCurrency reads it).
      currency: { value: code, same: (current) => (text(current) ? currencyCode(text(current)) : "") === code },
      linked_list: named(nameOf(list.connected_price_list), "Не указано"),
      position: integer(list.position),
      is_active: bool(list.is_active ?? true),
      is_default_for_order: bool(list.is_default_for_order),
      created_at: stamp(utcText(list.created_date)),
      updated_at: onInsert(utcText(list.modified_date ?? list.created_date)),
    })
  }
  await bumpSequence(client, "price_lists")

  // Продукты
  for (const product of products) await sync(client, "products", Number(product.id), productColumns(product))
  await bumpSequence(client, "products")

  // Сырье: the raw products as raw_materials rows (ids of their own; matched by name, then unit)
  if (rawItems.length) {
    const key = (value) => text(value).toLowerCase().replace(/\s+/g, " ")
    const local = (await client.query("SELECT id, name, unit FROM raw_materials")).rows
    for (const item of rawItems) {
      const candidates = local.filter((row) => key(row.name) === key(item.name))
      const byUnit = candidates.filter((row) => key(row.unit) === key(nameOf(item.measurement)))
      const row = byUnit.length === 1 ? byUnit[0] : candidates.length === 1 ? candidates[0] : null
      if (!row && candidates.length) {
        unknown.rawAmbiguous.push(item.id)
        continue
      }
      const id = await sync(client, "raw_materials", row ? Number(row.id) : null, rawMaterialColumns(item))
      if (!row) local.push({ id, name: text(item.name), unit: nameOf(item.measurement) })
    }
    await bumpSequence(client, "raw_materials")
  }

  // Excel: the order layouts (Накладные по заказам / клиентам, Для зав.склада, …) and their switched-on columns
  for (const layout of excelCodes) {
    await sync(client, "order_excel_settings", Number(layout.id), {
      name: exact(layout.name),
      key: exact(layout.key),
      codes: json((layout.codes ?? []).map((entry) => ({ code: text(entry.code), isActive: Boolean(entry.is_active) }))),
    })
  }
  if (excelCodes.length) await bumpSequence(client, "order_excel_settings")

  // Характеристики: the options and, per option, its values (Linko's value order)
  const valuesOf = new Map()
  const addValue = (optionId, value) => {
    if (!optionId || !value || !text(value.value)) return
    if (!valuesOf.has(optionId)) valuesOf.set(optionId, new Map())
    valuesOf.get(optionId).set(Number(value.id) || valuesOf.get(optionId).size + 1, text(value.value))
  }
  for (const option of options) for (const value of option.option_values ?? []) if (!value?.is_delete) addValue(Number(option.id), value)
  for (const value of optionValues) addValue(idOf(value.option), value)
  for (const option of options) {
    const fieldType = FIELD_TYPES[text(option.field_type)]
    if (!fieldType) unknown.fieldTypes.push(`${option.id}:${option.field_type}`)
    const types = (option.categories ?? []).map((category) => nameOf(category) || typeNames.get(idOf(category)) || "").filter(Boolean)
    await sync(client, "product_attributes", Number(option.id), {
      name: exact(option.name),
      field_type: exact(fieldType ?? FIELD_TYPES.select),
      all_types: bool(option.is_all_type),
      types_json: json(types),
      created_at: stamp(sqlDateTime(option.created_date) ?? undefined),
      updated_at: onInsert(sqlDateTime(option.modified_date ?? option.created_date) ?? undefined),
    })
    const values = valuesOf.get(Number(option.id))
    if (!values?.size) continue
    await sync(client, "product_attribute_values", Number(option.id), {
      attribute: exact(option.name),
      values_json: json([...values.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value)),
      created_at: stamp(sqlDateTime(option.created_date) ?? undefined),
      updated_at: onInsert(sqlDateTime(option.modified_date ?? option.created_date) ?? undefined),
    })
  }
  if (options.length) {
    await bumpSequence(client, "product_attributes")
    await bumpSequence(client, "product_attribute_values")
  }

  // Продукты конкурентов: each Linko row takes one local row with the same name and competitor (Linko repeats some), else
  // a new row
  if (rivalProducts.length) {
    const pair = (name, competitor) => `${text(name).toLowerCase()}\u0000${text(competitor).toLowerCase()}`
    const free = new Map()
    for (const row of (await client.query("SELECT id, name, competitor FROM rival_products ORDER BY id")).rows) {
      const key = pair(row.name, row.competitor)
      if (!free.has(key)) free.set(key, [])
      free.get(key).push(Number(row.id))
    }
    for (const product of [...rivalProducts].sort((a, b) => a.id - b.id)) {
      const id = free.get(pair(product.name, nameOf(product.rival)))?.shift() ?? null
      await sync(client, "rival_products", id, { name: exact(product.name), competitor: exact(nameOf(product.rival)) })
    }
  }

  await client.query(dry ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
const reported = Object.entries(unknown).filter(([, values]) => values.length)
console.log(
  `base catalog${dry ? " (dry run, rolled back)" : ""}: ${Object.entries(stats)
    .map(([table, s]) => `${table} +${s.insert} ~${s.update} =${s.same}`)
    .join(", ") || "nothing in the raw files"}` +
    (reported.length ? `; not copied as Linko has them: ${reported.map(([name, values]) => `${name} ${values.join(",")}`).join("; ")}` : ""),
)
