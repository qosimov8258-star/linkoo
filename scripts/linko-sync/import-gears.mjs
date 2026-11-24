// Склад → Работа с инвентарем: Linko's equipment (main/gear) into the tables of lib/inventory-items-schema.ts.
//   gears              main/gear/?status=all                   the items (inventory_items, same ids)
//   gears_detail       main/gear/{id}/?thumbnail_type=large    the card of each item: its own date (the list fills an
//                                                             empty one with the creation day) and its photo file
//   gear_logs          main/gear_log/                          История движений (inventory_item_logs, by linko_id)
//   gear_checks        main/gear_check/?with_image=true        История проверки (inventory_item_checks, by linko_id, with
//                                                             each review's photo list)
//   gear_conditions    main/gear_condition/                    Состояние (inventory_conditions, same ids)
//   gear_products      stock/all_balances/?is_gear=true        the products Linko keeps as inventory (products.is_inventory)
//                                                             and their order in its Продукт select
//                                                             (inventory_product_positions)
// - An item keeps Linko's date as it is: empty when Linko has none (the card then shows nothing, the list the creation
//   day), and the address and file id of its photo (Linko no longer serves those files; the card shows the empty frame
//   as Linko's does, its viewer writes openImageDialog=<file id>). A photo uploaded in this app (a data URL) is kept.
// - Movements and reviews are matched by Linko's id (linko_id); new ones are added in Linko's id order, so the lists
//   (newest first) keep Linko's order. Rows the app wrote itself are left alone.
// - Only products that exist here are flagged; a product no longer in Linko's list loses the flag (when that list is
//   complete).
// Every change is registered in linko_sync_rows (the previous values of an update too).
//
//   node scripts/linko-sync/import-gears.mjs
//
// The raw files come from fetch.mjs (lists gears, gear_logs, gear_checks, gear_conditions, gear_products; details
// gears_detail) or from a read-only capture of the screens; they are read from the newest backups/linko-raw/<date>
// folder that has gears.json (RAW=<folder> picks one).
import fs from "node:fs"
import path from "node:path"

import { bumpSequence, capturedOrSkip, connect, ensureRegistry, fullName, register, runId, upsertById, utcIso } from "./lib.mjs"

// <RAW>/gears.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> that has it; the other gear
// files are read from the same folder.
const gearsFile = capturedOrSkip("gears.json")
if (!gearsFile) {
  console.log("gears: no raw gears.json (run fetch.mjs first)")
  process.exit(0)
}
const folder = path.dirname(gearsFile)
function load(name) {
  const file = path.join(folder, `${name}.json`)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
}
const gears = load("gears")
const details = load("gears_detail")?.data ?? {}
const logs = load("gear_logs")
const checks = load("gear_checks")
const conditions = load("gear_conditions")
const gearProducts = load("gear_products")

// Same DDL as lib/inventory-items-schema.ts (the app creates it too; a fresh database gets it from either).
const DDL = `
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS photo TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS photo_id INTEGER;
CREATE INDEX IF NOT EXISTS inventory_items_client_idx ON inventory_items (client_id);
CREATE TABLE IF NOT EXISTS inventory_product_positions (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_item_logs (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  client_id INTEGER,
  client TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  move_date TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  request_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inventory_item_logs_item_idx ON inventory_item_logs (item_id);
CREATE TABLE IF NOT EXISTS inventory_item_checks (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  client_id INTEGER,
  client TEXT NOT NULL DEFAULT '',
  is_reviewed INTEGER NOT NULL DEFAULT 1,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inventory_item_checks_item_idx ON inventory_item_checks (item_id);
ALTER TABLE inventory_item_logs ADD COLUMN IF NOT EXISTS linko_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_logs_linko_idx ON inventory_item_logs (linko_id) WHERE linko_id IS NOT NULL;
ALTER TABLE inventory_item_checks ADD COLUMN IF NOT EXISTS linko_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_checks_linko_idx ON inventory_item_checks (linko_id) WHERE linko_id IS NOT NULL;
ALTER TABLE inventory_item_checks ADD COLUMN IF NOT EXISTS images TEXT NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS inventory_conditions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
`

/** Linko's Tashkent wall-clock moment → the UTC text the tables keep ("2026-05-14 08:41:08"). */
const utcText = (value) => (utcIso(value) ?? "").slice(0, 19).replace("T", " ")
const text = (value) => (value == null ? "" : String(value).trim())

const run = runId("gears")
const stats = { conditions: {}, products: { flagged: 0, unflagged: 0 }, positions: {}, items: {}, logs: {}, checks: {}, skipped: [] }
const count = (bucket, action) => (bucket[action] = (bucket[action] ?? 0) + 1)

function same(a, b) {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b)
  return String(a) === String(b)
}

/** Insert or update a row keyed by linko_id (new rows take the next local id). */
async function upsertByLinkoId(client, table, linkoId, values) {
  const cols = Object.keys(values)
  const current = (await client.query(`SELECT id, ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE linko_id = $1`, [linkoId])).rows[0]
  if (!current) {
    const all = [...cols, "linko_id"]
    const inserted = await client.query(
      `INSERT INTO ${table} (${all.map((c) => `"${c}"`).join(", ")}) VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      [...cols.map((c) => values[c]), linkoId],
    )
    await register(client, run, table, inserted.rows[0].id, "insert")
    return "insert"
  }
  const changed = cols.filter((c) => !same(current[c], values[c]))
  if (!changed.length) return "same"
  await client.query(`UPDATE ${table} SET ${changed.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} WHERE id = $1`, [current.id, ...changed.map((c) => values[c])])
  await register(client, run, table, current.id, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
  return "update"
}

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query(DDL)

  // Состояние
  for (const row of conditions?.data ?? []) {
    if (!row?.id || !text(row.name)) continue
    count(stats.conditions, await upsertById(client, run, "inventory_conditions", Number(row.id), { name: text(row.name) }))
  }
  if (conditions?.data?.length) await bumpSequence(client, "inventory_conditions")

  // Products kept as inventory (Linko is_gear)
  if (gearProducts?.data) {
    const ids = gearProducts.data.map((row) => Number(row.id)).filter((id) => id > 0)
    const flag = await client.query("SELECT id, is_inventory FROM products WHERE id = ANY($1::int[]) AND COALESCE(is_inventory, 0) <> 1", [ids])
    for (const row of flag.rows) {
      await client.query("UPDATE products SET is_inventory = 1 WHERE id = $1", [row.id])
      await register(client, run, "products", row.id, "update", { is_inventory: row.is_inventory })
      stats.products.flagged++
    }
    // Linko's order of the Продукт select (its server order of stock/all_balances?is_gear=true), by product id.
    const existing = new Set((await client.query("SELECT id FROM products WHERE id = ANY($1::int[])", [ids])).rows.map((row) => Number(row.id)))
    for (const [index, id] of ids.entries()) {
      if (existing.has(id)) count(stats.positions, await upsertById(client, run, "inventory_product_positions", id, { position: index + 1 }))
    }
    if (gearProducts.count === gearProducts.data.length) {
      const unflag = await client.query("SELECT id, is_inventory FROM products WHERE is_inventory = 1 AND COALESCE(deleted, 0) = 0 AND NOT (id = ANY($1::int[]))", [ids])
      for (const row of unflag.rows) {
        await client.query("UPDATE products SET is_inventory = 0 WHERE id = $1", [row.id])
        await register(client, run, "products", row.id, "update", { is_inventory: row.is_inventory })
        stats.products.unflagged++
      }
    }
  }

  // Items
  const creators = new Map()
  for (const log of logs?.data ?? []) if (log.status === "create" && log.gear?.id && log.user) creators.set(Number(log.gear.id), fullName(log.user))
  const known = new Set()
  for (const listed of gears?.data ?? []) {
    const id = Number(listed.id)
    if (!id) continue
    const gear = details[id] && !details[id].__status ? details[id] : listed
    const fromDetail = gear !== listed
    const productId = gear.product?.id ? Number(gear.product.id) : null
    const product = productId ? (await client.query("SELECT 1 FROM products WHERE id = $1", [productId])).rows[0] : null
    if (productId && !product) {
      stats.skipped.push(`item ${id}: product ${productId} missing`)
      continue
    }
    const current = (await client.query("SELECT photo, created_by FROM inventory_items WHERE id = $1", [id])).rows[0]
    const values = {
      serial_number: text(gear.serial_number),
      client: text(gear.market?.name),
      client_id: gear.market?.id ? Number(gear.market.id) : null,
      inventory_type: text(gear.product?.name),
      product_id: productId,
      inventory_code: text(gear.stock_number),
      warehouse: text(gear.stock?.name),
      condition: text(gear.condition?.name),
      responsible: fullName(gear.user),
      // The card's date (the list's is filled with the creation day when the item has none).
      attach_date: fromDetail ? text(gear.date) : text(listed.date),
      created_at: utcText(gear.created_date),
      approved: gear.is_reviewed ? 1 : 0,
      comment: text(gear.comment),
    }
    if (fromDetail && !String(current?.photo ?? "").startsWith("data:")) {
      values.photo = text(gear.photo?.file)
      values.photo_id = gear.photo?.id ? Number(gear.photo.id) : null
    }
    if (creators.has(id)) values.created_by = creators.get(id)
    else if (!current) values.created_by = values.responsible
    if (!current) values.created_date = values.created_at
    if (values.client_id && !(await client.query("SELECT 1 FROM clients WHERE id = $1", [values.client_id])).rows[0]) {
      stats.skipped.push(`item ${id}: client ${values.client_id} missing`)
      continue
    }
    const action = await upsertById(client, run, "inventory_items", id, values)
    if (action === "update") await client.query("UPDATE inventory_items SET updated_at = datetime('now') WHERE id = $1", [id])
    count(stats.items, action)
    known.add(id)
  }
  if (gears?.data?.length) await bumpSequence(client, "inventory_items")

  // История движений, oldest first so new rows follow Linko's order
  for (const log of [...(logs?.data ?? [])].sort((a, b) => a.id - b.id)) {
    const itemId = Number(log.gear?.id)
    if (!known.has(itemId)) {
      stats.skipped.push(`log ${log.id}: item ${itemId} not imported`)
      continue
    }
    const action = await upsertByLinkoId(client, "inventory_item_logs", Number(log.id), {
      item_id: itemId,
      status: ["create", "give", "take"].includes(log.status) ? log.status : "create",
      client_id: log.market?.id ? Number(log.market.id) : null,
      client: text(log.market?.name),
      warehouse: text(log.stock?.name),
      condition: text(log.condition?.name),
      move_date: text(log.date),
      comment: text(log.comment),
      created_by: fullName(log.user),
      created_at: utcText(log.created_date),
    })
    count(stats.logs, action)
  }

  // История проверки
  for (const check of [...(checks?.data ?? [])].sort((a, b) => a.id - b.id)) {
    const itemId = Number(check.gear?.id)
    if (!known.has(itemId)) {
      stats.skipped.push(`check ${check.id}: item ${itemId} not imported`)
      continue
    }
    const action = await upsertByLinkoId(client, "inventory_item_checks", Number(check.id), {
      item_id: itemId,
      client_id: check.market?.id ? Number(check.market.id) : null,
      client: text(check.market?.name),
      comment: text(check.comment),
      created_by: fullName(check.created_by),
      created_at: utcText(check.created_date),
      // The review's photos (raw captured with with_image=true); a raw without the key leaves them as they are.
      ...(Array.isArray(check.images)
        ? { images: JSON.stringify(check.images.map((image) => ({ id: Number(image.id), file: text(image.file), file_id: image.file_id == null ? null : Number(image.file_id) }))) }
        : {}),
    })
    count(stats.checks, action)
  }

  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`gears (${path.basename(folder)}): ${JSON.stringify(stats)}`)
