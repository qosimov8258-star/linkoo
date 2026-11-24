// Series (Серии): Linko's series catalog (stock/series/), the series of order lines (sales/order_product_exp/) and of
// client return lines (sales/order_return_product_exp/), into stock_series / order_item_series /
// client_return_item_series (lib/client-returns-series-repo.ts); and each product's «Учитывать срок годности» /
// series flags (products.track_expiry / track_series) from Linko's use_expiration / use_series, which only the product
// objects nested in documents carry (Linko's product list does not).
//
//   node scripts/linko-sync/import-series.mjs
//
// Raw files (the newest backups/linko-raw/<date> folder that has each one, or RAW=<folder>): series, order_product_exp,
// order_products, order_returns_detail, order_return_product_exp, and the document files with nested products.
// order_return_product_exp is either the full list (fetch.mjs "lists") or {<return id>: rows} read per return card
// (its Серии tab); only the returns it covers are touched. A return whose series were set in the app (rows without a
// Linko id) is left alone. Run after import-orders.mjs and import-returns.mjs (it maps Linko's lines to theirs).
// Also: a series row whose line import-returns.mjs replaced (new line ids, the old lines in linko_sync_rows) moves to
// the new line with the same key; and the clients' «Реализация по» (clients.realization_by, read by «По типу указанному
// у клиента») follows Linko's market.use_stock_lifo from shop_drawer.json.
import fs from "node:fs"

import { bumpSequence, captured, capturedOrSkip, connect, ensureRegistry, register, runId, upsertById } from "./lib.mjs"

/** The `data` of the raw file of that name (<RAW>/<name>.json only when RAW is set, else the newest
 * backups/linko-raw/<date> that has it), or undefined. */
function latest(name) {
  const file = captured(`${name}.json`)
  return file ? JSON.parse(fs.readFileSync(file, "utf8")).data : undefined
}

function required(name) {
  const data = latest(name)
  if (data === undefined) throw new Error(`Raw file missing: ${name}.json`)
  return data
}
// With RAW set, a folder without one of the required files skips the step before anything is written.
for (const name of ["series", "order_products", "order_returns_detail"]) capturedOrSkip(`${name}.json`)

const day = (value) => /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ""))?.[0] ?? null
const num = (value) => Number(value) || 0

const DDL = `
CREATE TABLE IF NOT EXISTS stock_series (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  expiration_date TEXT,
  party_id INTEGER,
  is_auto_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stock_series_product_idx ON stock_series (product_id);
CREATE TABLE IF NOT EXISTS client_return_item_series (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE,
  return_item_id INTEGER,
  product_id INTEGER,
  order_item_id INTEGER,
  line_seq INTEGER NOT NULL DEFAULT 0,
  series_id INTEGER NOT NULL REFERENCES stock_series(id),
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  linko_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE client_return_item_series ADD COLUMN IF NOT EXISTS return_item_id INTEGER;
CREATE INDEX IF NOT EXISTS client_return_item_series_return_idx ON client_return_item_series (return_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_return_item_series_linko_idx ON client_return_item_series (linko_id);
CREATE TABLE IF NOT EXISTS order_item_series (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL REFERENCES stock_series(id),
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  linko_id INTEGER
);
CREATE INDEX IF NOT EXISTS order_item_series_item_idx ON order_item_series (order_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_item_series_linko_idx ON order_item_series (linko_id);
`

// Documents whose rows carry Linko's full product object (with use_expiration / use_series).
const PRODUCT_FILES = [
  "order_products",
  "orders_detail",
  "order_returns_detail",
  "supply_products",
  "supplies_detail",
  "supply_returns_detail",
  "inventories_detail",
  "writeoffs_detail",
  "stock_transfers_detail",
  "reprices_detail",
  "parties_detail",
  "net_costs",
  "barcode_history",
  "manufacture_orders",
  "manufacture_returns",
  "manufacture_writeoffs",
  "order_product_exp",
  "order_return_product_exp",
]

const run = runId("series")
const client = await connect()
await ensureRegistry(client)
const stats = { series: { insert: 0, update: 0, same: 0 }, flags: 0, realization: 0, orderRows: 0, orderRemoved: 0, returnRows: 0, returnRemoved: 0, returnsKept: [], ordersKept: new Set(), unmapped: 0, moved: 0 }

/** id → {key, seq} of a return's lines, as lib/client-returns-series-repo.ts keys them (lines ordered by id). */
function lineKeys(lines) {
  const seen = new Map()
  const out = new Map()
  for (const line of [...lines].sort((a, b) => Number(a.id) - Number(b.id))) {
    const pair = `${line.product_id ?? ""}:${line.order_item_id ?? ""}`
    const seq = seen.get(pair) ?? 0
    seen.set(pair, seq + 1)
    out.set(Number(line.id), { key: `${pair}:${seq}`, seq })
  }
  return out
}
try {
  await client.query("BEGIN")
  await client.query(DDL)

  // --- the series catalog ------------------------------------------------------------------------------------------
  // A failed download is saved as Linko's error object: such a file counts as missing.
  const orderExpRaw = latest("order_product_exp")
  const orderExp = Array.isArray(orderExpRaw) ? orderExpRaw : []
  const returnExpRaw = latest("order_return_product_exp")
  const returnExp = Array.isArray(returnExpRaw) || (returnExpRaw && typeof returnExpRaw === "object") ? returnExpRaw : {}
  const returnExpRows = Array.isArray(returnExp) ? returnExp : Object.values(returnExp).filter(Array.isArray).flat()
  const catalog = new Map()
  for (const row of required("series")) catalog.set(row.id, row)
  // The series nested in the line rows are newer than the catalog download.
  for (const row of [...orderExp, ...returnExpRows]) if (row.series?.id) catalog.set(row.series.id, { ...catalog.get(row.series.id), ...row.series })
  for (const row of [...catalog.values()].sort((a, b) => a.id - b.id)) {
    const values = {
      product_id: typeof row.product === "object" ? row.product?.id : row.product,
      number: String(row.number ?? ""),
      expiration_date: day(row.expiration_date),
      party_id: typeof row.party === "object" ? row.party?.id ?? null : row.party ?? null,
      is_auto_created: row.is_auto_created ? 1 : 0,
    }
    if (!values.product_id) continue
    stats.series[await upsertById(client, run, "stock_series", row.id, values)]++
  }
  await bumpSequence(client, "stock_series")

  // --- products: «Учитывать срок годности» and series ----------------------------------------------------------------
  const flags = new Map()
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== "object") return
    if ("use_expiration" in value && Number.isInteger(value.id) && typeof value.name === "string") {
      // Some nested objects leave use_series out: it only counts where it is present.
      const known = flags.get(value.id)
      flags.set(value.id, { expiry: Boolean(value.use_expiration), series: "use_series" in value ? Boolean(value.use_series) : Boolean(known?.series) })
    }
    for (const child of Object.values(value)) if (child && typeof child === "object") walk(child)
  }
  for (const name of PRODUCT_FILES) {
    const data = latest(name)
    if (data !== undefined) walk(data)
  }
  const products = new Map((await client.query("SELECT id, track_expiry, track_series FROM products")).rows.map((row) => [row.id, row]))
  for (const [id, flag] of flags) {
    const current = products.get(id)
    if (!current) continue
    const expiry = flag.expiry ? 1 : 0
    const series = flag.expiry && flag.series ? 1 : 0
    if (Number(current.track_expiry) === expiry && Number(current.track_series) === series) continue
    await client.query("UPDATE products SET track_expiry = $2, track_series = $3 WHERE id = $1", [id, expiry, series])
    await register(client, run, "products", id, "update", { track_expiry: current.track_expiry, track_series: current.track_series })
    stats.flags++
  }

  // --- clients: «Реализация по» -------------------------------------------------------------------------------------
  // Linko's market.use_stock_lifo (false = FIFO, true = LIFO) comes with the shop cards of shop_drawer.json. An empty
  // value already reads as FIFO, so FIFO is written only over a LIFO: the client cards keep showing what they showed.
  const drawer = latest("shop_drawer")
  if (drawer && typeof drawer === "object") {
    const lifoOf = new Map()
    for (const entry of Object.values(drawer)) {
      const market = entry?.market
      if (Number.isInteger(market?.id) && typeof market.use_stock_lifo === "boolean") lifoOf.set(market.id, market.use_stock_lifo)
    }
    const clients = (await client.query("SELECT id, realization_by FROM clients WHERE id = ANY($1::int[])", [[...lifoOf.keys()]])).rows
    for (const row of clients) {
      const was = String(row.realization_by ?? "").trim().toUpperCase()
      const next = lifoOf.get(Number(row.id)) ? "LIFO" : was === "LIFO" ? "FIFO" : null
      if (!next || next === was) continue
      await client.query("UPDATE clients SET realization_by = $2 WHERE id = $1", [row.id, next])
      await register(client, run, "clients", row.id, "update", { realization_by: row.realization_by })
      stats.realization++
    }
  }

  // --- order lines -------------------------------------------------------------------------------------------------
  // Linko's order line → the local one, matched like import-orders.mjs does (same product and quantity, else product).
  const linkoLines = required("order_products")
  const byOrder = new Map()
  for (const line of linkoLines) {
    if (!byOrder.has(line.order_id)) byOrder.set(line.order_id, [])
    byOrder.get(line.order_id).push(line)
  }
  const localOrderLine = new Map()
  const wantedOrders = new Set(orderExp.map((row) => linkoLines.find((line) => line.id === row.order_product)?.order_id).filter(Boolean))
  for (const orderId of wantedOrders) {
    const have = (await client.query("SELECT id, product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY id", [orderId])).rows
    const used = new Set()
    for (const line of byOrder.get(orderId).sort((a, b) => a.id - b.id)) {
      const qty = num(line.amount)
      const match =
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id && Math.abs(h.quantity - qty) < 1e-6) ??
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id)
      if (!match) continue
      used.add(match.id)
      localOrderLine.set(line.id, { orderId, itemId: match.id })
    }
  }
  const orderLinkoIds = []
  // An order whose series were set in the app (rows without a Linko id: «Изменит серии» / the auto distribution replace
  // the whole list) is left alone, like the returns below.
  const appOrders = new Set((await client.query("SELECT DISTINCT order_id FROM order_item_series WHERE linko_id IS NULL")).rows.map((entry) => Number(entry.order_id)))
  for (const row of orderExp) {
    const local = localOrderLine.get(row.order_product)
    if (!local || !row.series?.id) {
      stats.unmapped++
      continue
    }
    if (appOrders.has(local.orderId)) {
      stats.ordersKept.add(local.orderId)
      continue
    }
    orderLinkoIds.push(row.id)
    const values = [local.orderId, local.itemId, row.series.id, num(row.amount), row.id]
    const current = (await client.query("SELECT id, order_id, order_item_id, series_id, amount FROM order_item_series WHERE linko_id = $1", [row.id])).rows[0]
    if (!current) {
      const inserted = await client.query("INSERT INTO order_item_series (order_id, order_item_id, series_id, amount, linko_id) VALUES ($1, $2, $3, $4, $5) RETURNING id", values)
      await register(client, run, "order_item_series", inserted.rows[0].id, "insert")
      stats.orderRows++
    } else if (current.order_id !== values[0] || current.order_item_id !== values[1] || current.series_id !== values[2] || Math.abs(current.amount - values[3]) > 1e-9) {
      await client.query("UPDATE order_item_series SET order_id = $1, order_item_id = $2, series_id = $3, amount = $4 WHERE linko_id = $5", values)
      await register(client, run, "order_item_series", current.id, "update", current)
      stats.orderRows++
    }
  }
  if (orderExp.length) {
    // The order list is complete: Linko rows it no longer has go.
    const gone = (await client.query("DELETE FROM order_item_series WHERE linko_id IS NOT NULL AND NOT (linko_id = ANY($1::int[])) RETURNING *", [orderLinkoIds])).rows
    for (const row of gone) await register(client, run, "order_item_series", row.id, "delete", row)
    stats.orderRemoved += gone.length
  }

  // --- return lines --------------------------------------------------------------------------------------------------
  const details = required("order_returns_detail")
  // Linko's return line id → its return (a full list carries no return id).
  const returnOfLine = new Map()
  for (const [id, detail] of Object.entries(details)) for (const line of detail?.returned_products ?? []) returnOfLine.set(line.id, Number(id))
  const perReturn = new Map()
  if (Array.isArray(returnExp)) {
    for (const id of Object.keys(details)) perReturn.set(Number(id), [])
    for (const row of returnExp) {
      const id = returnOfLine.get(row.order_return_product)
      if (id) perReturn.get(id)?.push(row)
    }
  } else {
    for (const [id, rows] of Object.entries(returnExp)) if (Array.isArray(rows)) perReturn.set(Number(id), rows)
  }
  for (const [returnId, rows] of [...perReturn].sort((a, b) => a[0] - b[0])) {
    const exists = (await client.query("SELECT id FROM client_returns WHERE id = $1", [returnId])).rows[0]
    if (!exists) continue
    let stored = (await client.query("SELECT * FROM client_return_item_series WHERE return_id = $1 ORDER BY id", [returnId])).rows
    if (stored.some((row) => row.linko_id === null)) {
      stats.returnsKept.push(returnId)
      continue
    }
    // The tab lists rows newest first by the local id: local ids must follow Linko's, else the rows are written again.
    if (stored.some((row, index) => index > 0 && row.linko_id < stored[index - 1].linko_id)) {
      for (const row of stored) {
        await client.query("DELETE FROM client_return_item_series WHERE id = $1", [row.id])
        await register(client, run, "client_return_item_series", row.id, "delete", row)
        stats.returnRemoved++
      }
      stored = []
    }
    // Linko's lines of the return → the local ones: by position when both lists hold the same products and quantities
    // in the same order (import-returns.mjs writes them in Linko's order), else by product and quantity.
    const lines = (await client.query("SELECT id, product_id, order_item_id, quantity FROM client_return_items WHERE return_id = $1 ORDER BY id", [returnId])).rows
    const linko = details[returnId]?.returned_products ?? []
    const localOf = new Map()
    if (linko.length === lines.length && linko.every((line, index) => line.product?.id === lines[index].product_id && Math.abs(num(line.amount) - lines[index].quantity) < 1e-6)) {
      linko.forEach((line, index) => localOf.set(line.id, lines[index]))
    } else {
      const used = new Set()
      for (const line of linko) {
        const match =
          lines.find((l) => !used.has(l.id) && l.product_id === line.product?.id && Math.abs(l.quantity - num(line.amount)) < 1e-6) ??
          lines.find((l) => !used.has(l.id) && l.product_id === line.product?.id)
        if (match) {
          used.add(match.id)
          localOf.set(line.id, match)
        }
      }
    }
    // The key of each local line, as lib/client-returns-series-repo.ts computes it.
    const seqOf = new Map()
    const seen = new Map()
    for (const line of lines) {
      const pair = `${line.product_id ?? ""}:${line.order_item_id ?? ""}`
      const seq = seen.get(pair) ?? 0
      seen.set(pair, seq + 1)
      seqOf.set(line.id, seq)
    }
    const keep = []
    for (const row of [...rows].sort((a, b) => a.id - b.id)) {
      const line = localOf.get(row.order_return_product)
      if (!line || !row.series?.id) {
        stats.unmapped++
        continue
      }
      keep.push(row.id)
      const values = { return_item_id: line.id, product_id: line.product_id, order_item_id: line.order_item_id, line_seq: seqOf.get(line.id), series_id: row.series.id, amount: num(row.amount) }
      const current = stored.find((s) => s.linko_id === row.id)
      if (!current) {
        const inserted = await client.query(
          "INSERT INTO client_return_item_series (return_id, return_item_id, product_id, order_item_id, line_seq, series_id, amount, linko_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Linko') RETURNING id",
          [returnId, values.return_item_id, values.product_id, values.order_item_id, values.line_seq, values.series_id, values.amount, row.id],
        )
        await register(client, run, "client_return_item_series", inserted.rows[0].id, "insert")
        stats.returnRows++
      } else if (Object.entries(values).some(([key, value]) => (typeof value === "number" ? Math.abs(Number(current[key]) - value) > 1e-9 : current[key] !== value))) {
        await client.query(
          "UPDATE client_return_item_series SET return_item_id = $2, product_id = $3, order_item_id = $4, line_seq = $5, series_id = $6, amount = $7 WHERE id = $1",
          [current.id, values.return_item_id, values.product_id, values.order_item_id, values.line_seq, values.series_id, values.amount],
        )
        await register(client, run, "client_return_item_series", current.id, "update", current)
        stats.returnRows++
      }
    }
    for (const row of stored.filter((s) => !keep.includes(s.linko_id))) {
      await client.query("DELETE FROM client_return_item_series WHERE id = $1", [row.id])
      await register(client, run, "client_return_item_series", row.id, "delete", row)
      stats.returnRemoved++
    }
  }
  // --- rows whose line import-returns.mjs replaced -------------------------------------------------------------------
  // It replaces a return's lines (new ids) and keeps the old ones in linko_sync_rows ("replace", row id return:<id>): a
  // row of an old line moves to the current line with the same key. A row whose line was deleted in the app has no such
  // entry and stays where it is (the app does not show it).
  const lost = (
    await client.query(
      `SELECT s.* FROM client_return_item_series s
        WHERE s.return_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_return_items i WHERE i.id = s.return_item_id)
        ORDER BY s.id`,
    )
  ).rows
  for (const returnId of [...new Set(lost.map((row) => Number(row.return_id)))]) {
    const replaced = (
      await client.query("SELECT previous FROM linko_sync_rows WHERE table_name = 'client_return_items' AND row_id = $1 AND action = 'replace' ORDER BY seq DESC", [`return:${returnId}`])
    ).rows.map((entry) => entry.previous)
    if (!replaced.length) continue
    const now = lineKeys((await client.query("SELECT id, product_id, order_item_id FROM client_return_items WHERE return_id = $1", [returnId])).rows)
    const lineOfKey = new Map([...now].map(([id, value]) => [value.key, id]))
    for (const row of lost.filter((item) => Number(item.return_id) === returnId)) {
      const before = replaced.find((lines) => Array.isArray(lines) && lines.some((line) => Number(line.id) === Number(row.return_item_id)))
      const key = before ? lineKeys(before).get(Number(row.return_item_id))?.key : undefined
      const target = key ? lineOfKey.get(key) : undefined
      if (!target) continue
      await client.query("UPDATE client_return_item_series SET return_item_id = $2, line_seq = $3 WHERE id = $1", [row.id, target, now.get(target).seq])
      await register(client, run, "client_return_item_series", row.id, "update", row)
      stats.moved++
    }
  }

  await bumpSequence(client, "client_return_item_series")
  await bumpSequence(client, "order_item_series")
  await client.query("COMMIT")
  console.log(
    `series: catalog inserted ${stats.series.insert}, updated ${stats.series.update}, unchanged ${stats.series.same}; product flags changed ${stats.flags}; ` +
      `clients «Реализация по» changed ${stats.realization}; order rows written ${stats.orderRows}, removed ${stats.orderRemoved}; ` +
      `return rows written ${stats.returnRows}, removed ${stats.returnRemoved}, moved to replaced lines ${stats.moved}` +
      `${stats.unmapped ? `; lines not found locally ${stats.unmapped}` : ""}${stats.returnsKept.length ? `; returns with series set in the app kept: ${stats.returnsKept.join(",")}` : ""}` +
      `${stats.ordersKept.size ? `; orders with series set in the app kept: ${[...stats.ordersKept].join(",")}` : ""}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
