import "server-only"

import { type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { stockMovementsSql } from "@/lib/stock/ledger"

// Per-warehouse series balances (Linko's stock/series_balance/?product=&stock=: total_balance, available) of the
// products that keep an expiry. Mezon's stock ledger keeps no balance per series, so the balance is estimated from
// what Mezon does keep:
// - the ledger's movements of the product in the warehouse (lib/stock/ledger.ts), grouped by document;
// - the series each document names: the lines of supplier incomings, supplier returns, write-offs and internal transfers
//   (items[].seriesId, else the series number, else the expiry date of an automatic series), the series rows of orders
//   (order_item_series) and of client returns (client_return_item_series). A document's movement is split over its
//   series in the proportion of its lines; what it does not label stays unlabelled.
// Every series keeps what the labelled movements left in it (never below 0). When the labelled series hold more than the
// warehouse has (goods left without a series: most orders carry none), the difference is taken from the series
// first-expiring first (FIFO), the way the goods leave a warehouse. Stock that came in without a series belongs to no
// series. `reserved` is what orders that have not left the warehouse yet (not shipped, not cancelled) took of a series;
// available = total − reserved.
// `excludeOrderIds` leaves those orders out entirely (their shipment and their series): the stock as it would be without
// them, which an auto distribution of those orders draws from.

export type SeriesStock = { seriesId: number; total: number; reserved: number; available: number }

type SeriesRef = { id: number; product_id: number; number: string | null; expiration_date: string | null; is_auto_created: number | boolean | null }

type Movement = { wk: string; item_key: string; doc_type: string; doc_id: number; qty: number }

/** JSON documents whose lines may name a series, with the field of their line quantity. */
const JSON_DOCS: Record<string, { table: string; qty: string }> = {
  supplier_incomings: { table: "supplier_incomings", qty: "qty" },
  supplier_returns: { table: "supplier_returns", qty: "qty" },
  write_offs: { table: "write_offs", qty: "qty" },
  internal_transfers: { table: "internal_transfers", qty: "quantity" },
}

const EPS = 1e-9
const round9 = (value: number) => Math.round(value * 1e9) / 1e9
const day = (value: unknown) => /^\d{4}-\d{2}-\d{2}/.exec(String(value ?? ""))?.[0] ?? null
const textKey = (value: unknown) => String(value ?? "").trim().toLowerCase()

/** Series in FIFO order: earliest expiry first, a series without an expiry last, then by id. */
export function fifoOrder<T extends { id: number; expiration_date: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = day(a.expiration_date) ?? ""
    const dbb = day(b.expiration_date) ?? ""
    if (!da !== !dbb) return da ? -1 : 1
    if (da !== dbb) return da < dbb ? -1 : 1
    return a.id - b.id
  })
}

/** Resolves the series a document line names: its id, else its number, else the expiry date of an automatic series
 * (Linko names those after the date), else none. */
function resolver(series: SeriesRef[]) {
  const byId = new Map(series.map((row) => [Number(row.id), row]))
  const byNumber = new Map<string, SeriesRef>()
  const byExpiry = new Map<string, SeriesRef>()
  const isAuto = (row: SeriesRef | undefined) => row !== undefined && (row.is_auto_created === true || Number(row.is_auto_created) === 1)
  for (const row of [...series].sort((a, b) => a.id - b.id)) {
    const number = textKey(row.number)
    if (number && !byNumber.has(number)) byNumber.set(number, row)
    // By date: the automatic series of that date, else the first one.
    const expiry = day(row.expiration_date)
    const current = expiry ? byExpiry.get(expiry) : undefined
    if (expiry && (!current || (isAuto(row) && !isAuto(current)))) byExpiry.set(expiry, row)
  }
  return (line: Record<string, unknown>): number | null => {
    const id = Number(line.seriesId)
    if (Number.isSafeInteger(id) && byId.has(id)) return id
    const number = textKey(line.series)
    if (number && byNumber.has(number)) return Number(byNumber.get(number)!.id)
    const expiry = day(line.expiry) ?? day(line.series)
    if (expiry && byExpiry.has(expiry)) return Number(byExpiry.get(expiry)!.id)
    return null
  }
}

/** Per document and product: the quantity of its lines and how much of it each series labels. */
type DocLabels = Map<string, { total: number; bySeries: Map<number, number> }>

function addLabel(labels: DocLabels, key: string, qty: number, seriesId: number | null) {
  let entry = labels.get(key)
  if (!entry) labels.set(key, (entry = { total: 0, bySeries: new Map() }))
  entry.total += qty
  if (seriesId !== null) entry.bySeries.set(seriesId, (entry.bySeries.get(seriesId) ?? 0) + qty)
}

function parseLines(text: unknown): Array<Record<string, unknown>> {
  try {
    const parsed = typeof text === "string" ? JSON.parse(text || "[]") : text
    return Array.isArray(parsed) ? parsed.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object") : []
  } catch {
    return []
  }
}

function lineQty(line: Record<string, unknown>, field: string) {
  const value = Number(String(line[field] ?? "").replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

/**
 * Series stock of each requested (product, warehouse). The result is keyed `${warehouse}|${productId}` with the warehouse
 * as it was asked; every series of the product that holds or reserves something in the warehouse is listed.
 */
export async function seriesStock(
  db: PgDb,
  requests: Array<{ productId: number; warehouse: string }>,
  options: { excludeOrderIds?: number[] } = {},
): Promise<Map<string, Map<number, SeriesStock>>> {
  const out = new Map<string, Map<number, SeriesStock>>()
  const wanted = requests.filter((request) => Number.isSafeInteger(request.productId) && request.productId > 0 && String(request.warehouse ?? "").trim())
  if (!wanted.length) return out
  const productIds = [...new Set(wanted.map((request) => request.productId))]
  const warehouses = [...new Set(wanted.map((request) => request.warehouse))]
  const skip = [...new Set((options.excludeOrderIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0))]

  const { sql, params } = await stockMovementsSql({}, db)
  // fin_key is the ledger's spelling-insensitive warehouse key.
  const keys = (await db.prepare("SELECT x AS name, fin_key(x) AS k FROM unnest(@names::text[]) AS x").all({ names: warehouses })) as Array<{ name: string; k: string }>
  const keyOf = new Map(keys.map((row) => [row.name, row.k]))
  const movements = (await db
    .prepare(
      `SELECT fin_key(m.warehouse) AS wk, m.item_key, m.doc_type, m.doc_id, SUM(m.qty) AS qty
         FROM (${sql}) m
        WHERE m.item_key = ANY(@sb_keys::text[]) AND fin_key(m.warehouse) = ANY(@sb_whs::text[]) AND m.day <= @sb_day
          AND NOT (m.doc_type = 'orders' AND m.doc_id = ANY(@sb_skip::int[]))
        GROUP BY 1, 2, 3, 4`,
    )
    .all({
      ...params,
      sb_keys: productIds.map((id) => `product:${id}`),
      sb_whs: [...new Set(keys.map((row) => row.k))],
      sb_day: todayIso(),
      sb_skip: skip,
    })) as Movement[]

  const series = (await db
    .prepare("SELECT id, product_id, number, expiration_date, is_auto_created FROM stock_series WHERE product_id = ANY(@ids::int[])")
    .all({ ids: productIds })) as SeriesRef[]
  const seriesOf = new Map<number, SeriesRef[]>()
  for (const row of series) {
    const list = seriesOf.get(Number(row.product_id)) ?? []
    list.push(row)
    seriesOf.set(Number(row.product_id), list)
  }
  const resolve = new Map([...seriesOf].map(([productId, rows]) => [productId, resolver(rows)]))
  const productNames = new Map(
    ((await db.prepare("SELECT id, name FROM products WHERE id = ANY(@ids::int[])").all({ ids: productIds })) as Array<{ id: number; name: string }>).map((row) => [
      Number(row.id),
      textKey(row.name),
    ]),
  )

  // --- the series each document names ------------------------------------------------------------------------------
  const labels: DocLabels = new Map()
  const docIds = (type: string) => [...new Set(movements.filter((row) => row.doc_type === type).map((row) => Number(row.doc_id)))]
  for (const [type, doc] of Object.entries(JSON_DOCS)) {
    const ids = docIds(type)
    if (!ids.length) continue
    const rows = (await db.prepare(`SELECT id, items FROM ${doc.table} WHERE id = ANY(@ids::int[])`).all({ ids })) as Array<{ id: number; items: unknown }>
    for (const row of rows) {
      for (const line of parseLines(row.items)) {
        const key = /^product:(\d+)$/.exec(String(line.key ?? ""))
        // Lines without a catalog key are matched by name, as the ledger does.
        const productId = key ? Number(key[1]) : productIds.find((id) => productNames.get(id) && productNames.get(id) === textKey(line.product))
        if (!productId || !seriesOf.has(productId)) continue
        addLabel(labels, `${type}:${row.id}:${productId}`, lineQty(line, doc.qty), resolve.get(productId)!(line))
      }
    }
  }
  const orderIds = docIds("orders")
  if (orderIds.length) {
    const lines = (await db
      .prepare("SELECT id, order_id, product_id, quantity FROM order_items WHERE order_id = ANY(@ids::int[]) AND product_id = ANY(@products::int[])")
      .all({ ids: orderIds, products: productIds })) as Array<{ id: number; order_id: number; product_id: number; quantity: number }>
    const rows = (await db
      .prepare("SELECT order_item_id, series_id, amount FROM order_item_series WHERE order_id = ANY(@ids::int[])")
      .all({ ids: orderIds })) as Array<{ order_item_id: number; series_id: number; amount: number }>
    labelLines(labels, "orders", lines.map((line) => ({ id: line.id, doc: line.order_id, productId: line.product_id, quantity: line.quantity })), rows.map((row) => ({ lineId: row.order_item_id, seriesId: row.series_id, amount: row.amount })), seriesOf)
  }
  const returnIds = docIds("client_returns")
  if (returnIds.length) {
    const lines = (await db
      .prepare("SELECT id, return_id, product_id, quantity FROM client_return_items WHERE return_id = ANY(@ids::int[]) AND product_id = ANY(@products::int[])")
      .all({ ids: returnIds, products: productIds })) as Array<{ id: number; return_id: number; product_id: number; quantity: number }>
    const rows = (await db
      .prepare("SELECT return_item_id, series_id, amount FROM client_return_item_series WHERE return_id = ANY(@ids::int[]) AND return_item_id IS NOT NULL")
      .all({ ids: returnIds })) as Array<{ return_item_id: number; series_id: number; amount: number }>
    labelLines(labels, "client_returns", lines.map((line) => ({ id: line.id, doc: line.return_id, productId: line.product_id, quantity: line.quantity })), rows.map((row) => ({ lineId: row.return_item_id, seriesId: row.series_id, amount: row.amount })), seriesOf)
  }

  // --- balances ----------------------------------------------------------------------------------------------------
  type Acc = { balance: number; bySeries: Map<number, number> }
  const acc = new Map<string, Acc>()
  for (const move of movements) {
    const productId = Number(String(move.item_key).slice("product:".length))
    const key = `${move.wk}|${productId}`
    let entry = acc.get(key)
    if (!entry) acc.set(key, (entry = { balance: 0, bySeries: new Map() }))
    const qty = Number(move.qty) || 0
    entry.balance += qty
    const label = labels.get(`${move.doc_type}:${move.doc_id}:${productId}`)
    if (!label || !(label.total > EPS)) continue
    const labelled = [...label.bySeries.values()].reduce((sum, value) => sum + value, 0)
    const base = Math.max(label.total, labelled)
    for (const [seriesId, amount] of label.bySeries) entry.bySeries.set(seriesId, (entry.bySeries.get(seriesId) ?? 0) + (qty * amount) / base)
  }
  const reserved = (await db
    .prepare(
      `SELECT fin_key(o.warehouse) AS wk, i.product_id, s.series_id, SUM(s.amount) AS amount
         FROM order_item_series s JOIN orders o ON o.id = s.order_id JOIN order_items i ON i.id = s.order_item_id AND i.order_id = s.order_id
        WHERE o.status NOT IN ('В пути', 'Доставлено', 'Отменен') AND i.product_id = ANY(@products::int[])
          AND fin_key(o.warehouse) = ANY(@whs::text[]) AND NOT (o.id = ANY(@skip::int[]))
        GROUP BY 1, 2, 3`,
    )
    .all({ products: productIds, whs: [...new Set(keys.map((row) => row.k))], skip })) as Array<{ wk: string; product_id: number; series_id: number; amount: number }>

  for (const request of wanted) {
    const wk = keyOf.get(request.warehouse) ?? ""
    const entry = acc.get(`${wk}|${request.productId}`)
    const own = seriesOf.get(request.productId) ?? []
    const totals = new Map<number, number>()
    for (const row of own) totals.set(Number(row.id), Math.max(0, entry?.bySeries.get(Number(row.id)) ?? 0))
    // More in the series than in the warehouse: the rest left first-expiring first.
    let excess = [...totals.values()].reduce((sum, value) => sum + value, 0) - Math.max(0, entry?.balance ?? 0)
    for (const row of fifoOrder(own)) {
      if (excess <= EPS) break
      const have = totals.get(Number(row.id)) ?? 0
      const take = Math.min(have, excess)
      totals.set(Number(row.id), have - take)
      excess -= take
    }
    const result = new Map<number, SeriesStock>()
    for (const row of own) {
      const id = Number(row.id)
      const total = round9(totals.get(id) ?? 0)
      const held = round9(
        reserved.filter((item) => item.wk === wk && Number(item.product_id) === request.productId && Number(item.series_id) === id).reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
      )
      if (Math.abs(total) <= EPS && Math.abs(held) <= EPS) continue
      result.set(id, { seriesId: id, total, reserved: held, available: round9(total - held) })
    }
    out.set(`${request.warehouse}|${request.productId}`, result)
  }
  return out
}

/** Labels of documents whose series sit on their lines (orders, client returns): per document and product, the lines'
 * quantity and the series amounts of the lines of that product. */
function labelLines(
  labels: DocLabels,
  type: string,
  lines: Array<{ id: number; doc: number; productId: number; quantity: number }>,
  rows: Array<{ lineId: number; seriesId: number; amount: number }>,
  seriesOf: Map<number, SeriesRef[]>,
) {
  const lineOf = new Map(lines.map((line) => [Number(line.id), line]))
  for (const line of lines) addLabel(labels, `${type}:${line.doc}:${line.productId}`, Number(line.quantity) || 0, null)
  for (const row of rows) {
    const line = lineOf.get(Number(row.lineId))
    if (!line) continue
    // A series of another product does not label this line.
    if (!(seriesOf.get(Number(line.productId)) ?? []).some((series) => Number(series.id) === Number(row.seriesId))) continue
    const entry = labels.get(`${type}:${line.doc}:${line.productId}`)!
    entry.bySeries.set(Number(row.seriesId), (entry.bySeries.get(Number(row.seriesId)) ?? 0) + (Number(row.amount) || 0))
  }
}
