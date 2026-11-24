// Linko's «Статус объекта» and map point of each shop (market.is_active, market.location):
//   client_object_status  is_active per copied shop: the shop drawer's header dot (green / red) on every page, the
//                         Клиенты row border and «Статус объекта» filter, the edit form's «Статус объекта». The rows
//                         that were there before came from a demo seed, not from Linko.
//   clients.location_lat / location_lng  the full-precision point (КЛИЕНТ «Локация», the edit form, the maps). The
//                         first copy went through float4 columns and kept about 7 digits (41.322964 for 41.322962); a
//                         point only that rounding away from Linko's is replaced, a point farther away (moved in the
//                         app) is kept and reported.
//   clients.realization_by  «Реализация по» of the edit form (market.use_stock_lifo: LIFO, else FIFO), filled only
//                         where the copy has none (a choice made in the app is kept).
// Source: the newest raw shop_drawer.json (fetch-shop-drawer.mjs, market/market/<id>/ of every shop), else markets.json
// of the full download. Shops that are not here are reported; a re-run changes only what differs.
//
//   node scripts/linko-sync/import-shop-state.mjs
import fs from "node:fs"
import path from "node:path"

import { ROOT, captured, connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("shop-state")
// float4 keeps ~7 significant digits: a copied point is at most a few millionths of a degree off.
const ROUNDING = 1e-4

/** Map(shop id → { active, lat, lon }) and where it came from. */
function readShops() {
  const shops = new Map()
  const add = (market, id) => {
    if (!market || typeof market.is_active !== "boolean") return
    const lat = Number(market.location?.lat)
    const lon = Number(market.location?.lon)
    shops.set(Number(market.id ?? id), {
      active: market.is_active,
      lat: Number.isFinite(lat) && market.location?.lat != null ? lat : null,
      lon: Number.isFinite(lon) && market.location?.lon != null ? lon : null,
      realization: typeof market.use_stock_lifo === "boolean" ? (market.use_stock_lifo ? "LIFO" : "FIFO") : "",
    })
  }
  // <RAW>/shop_drawer.json, else the newest backups/linko-raw/<date> that has it; then the raw folder's markets.json
  // (with RAW both inside RAW only).
  const file = captured("shop_drawer.json")
  if (file && fs.existsSync(file)) {
    const body = JSON.parse(fs.readFileSync(file, "utf8"))
    for (const [id, entry] of Object.entries(body.data ?? {})) add(entry?.market, id)
    return { shops, source: path.relative(ROOT, file) }
  }
  if (hasRaw("markets")) {
    for (const market of raw("markets")) add(market, market.id)
    return { shops, source: "markets.json" }
  }
  return null
}

const found = readShops()
if (!found) {
  console.log("shop state: no raw shop_drawer.json or markets.json (run fetch-shop-drawer.mjs or fetch.mjs first)")
  process.exit(0)
}

const client = await connect()
await ensureRegistry(client)
const stats = { status: { insert: 0, update: 0, same: 0 }, location: { update: 0, same: 0, kept: [] }, realization: 0, missing: 0 }
try {
  await client.query("BEGIN")
  // The table of lib/clients-repo.ts (a shop without a row counts as active).
  await client.query(`CREATE TABLE IF NOT EXISTS client_object_status (
    client_id INTEGER PRIMARY KEY,
    is_active INTEGER NOT NULL DEFAULT 1
  )`)
  const local = new Map((await client.query("SELECT id, location_lat, location_lng, realization_by FROM clients")).rows.map((row) => [Number(row.id), row]))
  const status = new Map((await client.query("SELECT client_id, is_active FROM client_object_status")).rows.map((row) => [Number(row.client_id), Number(row.is_active)]))
  for (const [id, shop] of found.shops) {
    const row = local.get(id)
    if (!row) {
      stats.missing++
      continue
    }
    const active = shop.active ? 1 : 0
    if (!status.has(id)) {
      await client.query("INSERT INTO client_object_status (client_id, is_active) VALUES ($1, $2)", [id, active])
      await register(client, run, "client_object_status", id, "insert")
      stats.status.insert++
    } else if (status.get(id) !== active) {
      await client.query("UPDATE client_object_status SET is_active = $2 WHERE client_id = $1", [id, active])
      await register(client, run, "client_object_status", id, "update", { is_active: status.get(id) })
      stats.status.update++
    } else stats.status.same++

    if (shop.realization && !String(row.realization_by ?? "").trim()) {
      await client.query("UPDATE clients SET realization_by = $2 WHERE id = $1", [id, shop.realization])
      await register(client, run, "clients", id, "update", { realization_by: row.realization_by ?? null })
      stats.realization++
    }

    if (shop.lat === null || shop.lon === null || row.location_lat === null || row.location_lng === null) continue
    const lat = Number(row.location_lat)
    const lng = Number(row.location_lng)
    if (lat === shop.lat && lng === shop.lon) {
      stats.location.same++
      continue
    }
    if (Math.abs(lat - shop.lat) >= ROUNDING || Math.abs(lng - shop.lon) >= ROUNDING) {
      stats.location.kept.push(id)
      continue
    }
    await client.query("UPDATE clients SET location_lat = $2, location_lng = $3 WHERE id = $1", [id, shop.lat, shop.lon])
    await register(client, run, "clients", id, "update", { location_lat: lat, location_lng: lng })
    stats.location.update++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(
  `shop state (${found.source}): status ${JSON.stringify(stats.status)}, location updated ${stats.location.update}, same ${stats.location.same}, ` +
    `kept (moved here) ${stats.location.kept.length}${stats.location.kept.length ? ` [${stats.location.kept.slice(0, 20).join(", ")}]` : ""}, ` +
    `«Реализация по» filled ${stats.realization}, shops not here ${stats.missing}`,
)
