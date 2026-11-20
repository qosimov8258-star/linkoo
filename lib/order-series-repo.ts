import "server-only"

import { SERIES_AUTO_TYPES, ensureReturnSeriesSchema, type SeriesAutoType, type StockSeries } from "@/lib/client-returns-series-repo"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { fifoOrder, seriesStock } from "@/lib/order-series-balance"
import { MAX_QTY, OrderError } from "@/lib/orders-repo"

// Series (Серии) of orders, like Linko's order card (#/order/<id>?tab=expireDate) and sales/order_product_exp:
// order_item_series(id, order_id, order_item_id, series_id → stock_series, amount, linko_id) says how much of an order
// line belongs to which series (the table and the series catalog are created by lib/client-returns-series-repo.ts;
// scripts/linko-sync/import-series.mjs copies Linko's rows). A row belongs to its line: the rows of a deleted line, or of
// a line that now holds another product, are not shown and go with the next save; deleting the line or the order deletes
// them. Series only label the order's quantities: they do not move stock (lib/order-series-balance.ts estimates the
// balance of each series from them and the other documents that name series).

const DDL = `
ALTER TABLE order_item_series ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE order_item_series ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT (datetime('now'));
CREATE INDEX IF NOT EXISTS order_item_series_order_idx ON order_item_series (order_id);
-- The promotion that added a copied bonus line (Linko's order_product.promotion.name: «Акция: <name>» under the line in
-- «Наименование» of «Изменит серии»); filled by scripts/linko-sync/import-order-line-promotions.mjs.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS promotion TEXT NOT NULL DEFAULT '';
DO $$
BEGIN
  -- NOT VALID: existing rows are left as they are (the app hides rows of lines that are gone); new rows must name a line.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_series_item_fk') THEN
    ALTER TABLE order_item_series ADD CONSTRAINT order_item_series_item_fk FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
`

const SCHEMA_VERSION = 2

declare global {
  var __mezonOrderSeriesSchema: { version: number; ready: Promise<void> } | undefined
}

export function ensureOrderSeriesSchema(): Promise<void> {
  if (globalThis.__mezonOrderSeriesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(async () => {
      await ensureReturnSeriesSchema()
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120942)")
        await tx.exec(DDL)
      })
    }).catch((error) => {
      globalThis.__mezonOrderSeriesSchema = undefined
      throw error
    })
    globalThis.__mezonOrderSeriesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__mezonOrderSeriesSchema!.ready
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrderSeriesRow = {
  id: number
  /** The order line the row belongs to. */
  orderItemId: number
  productId: number | null
  productName: string
  amount: number
  series: StockSeries
}

/** An order line whose product keeps an expiry (Linko's sales/order_product/?order=&use_expiration=true). `number` is
 * the line's «№»: Linko's line id for a line copied from Linko (as the client returns show it), else its own id;
 * `promotion` names the promotion that added a bonus line ("" = none). */
export type OrderSeriesLine = { id: number; number: number; productId: number; productName: string; quantity: number; unit: string; isBonus: boolean; promotion: string }

/** A series with its balance in a warehouse (Linko's stock/series_balance/). */
export type SeriesBalanceOption = StockSeries & { totalBalance: number; available: number }

export type OrderSeriesInput = { amount: number; orderItemId: number; seriesId: number }

type SeriesDbRow = { id: number; product_id: number; number: string; expiration_date: string | null; is_auto_created: number | boolean | null }

type LineDbRow = { id: number; order_id: number; product_id: number | null; product_name: string; quantity: number; unit: string; is_bonus: number | null; linko_line: number | null; track_expiry: number | null; promotion: string | null }

const MAX_ID = 2_147_483_647
const EPS = 1e-9
const round9 = (value: number) => Math.round(value * 1e9) / 1e9
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= MAX_ID

function toSeries(row: SeriesDbRow): StockSeries {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(row.expiration_date ?? "")?.[0] ?? null
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    number: row.number ?? "",
    expirationDate: day,
    isAutoCreated: row.is_auto_created === true || Number(row.is_auto_created) === 1,
    displayName: row.number || day || String(row.id),
  }
}

/** The order's lines (with the product's «Учитывать срок годности»), in Linko's order for the lines copied from it
 * (its line ids), then by id. */
async function loadLines(db: PgDb, orderIds: number[]): Promise<LineDbRow[]> {
  return (await db
    .prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.quantity, i.unit,
              COALESCE(NULLIF(to_jsonb(i) ->> 'is_bonus', '')::int, 0) AS is_bonus,
              NULLIF(to_jsonb(i) ->> 'linko_order_product_id', '')::int AS linko_line, COALESCE(to_jsonb(i) ->> 'promotion', '') AS promotion,
              COALESCE(NULLIF(to_jsonb(p) ->> 'track_expiry', '')::int, 0) AS track_expiry
         FROM order_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = ANY(@ids::int[]) ORDER BY i.order_id, linko_line NULLS LAST, i.id`,
    )
    .all({ ids: orderIds })) as LineDbRow[]
}

const tracked = (line: LineDbRow) => Number(line.track_expiry) === 1 && line.product_id !== null

type OrderHead = { id: number; warehouse: string | null; client_id: number | null }

async function orderHead(db: PgDb, id: number, lock = false): Promise<OrderHead | undefined> {
  return (await db.prepare(`SELECT id, warehouse, client_id FROM orders WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as OrderHead | undefined
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The «Серии» tab of an order (Linko's order_product_exp/?order=): newest row first (rows copied from Linko in Linko's
 * order: the importer wrote them newest first); null = no order. */
export async function listOrderSeries(orderId: number): Promise<OrderSeriesRow[] | null> {
  if (!validId(orderId)) return null
  await ensureOrderSeriesSchema()
  const db = getDb()
  if (!(await orderHead(db, orderId))) return null
  return readRows(db, orderId)
}

async function readRows(db: PgDb, orderId: number): Promise<OrderSeriesRow[]> {
  const rows = (await db
    .prepare(
      `SELECT r.id, r.order_item_id, r.amount, i.product_id, i.product_name,
              s.id AS s_id, s.product_id AS s_product_id, s.number AS s_number, s.expiration_date AS s_expiration_date, s.is_auto_created AS s_is_auto_created
         FROM order_item_series r
         JOIN order_items i ON i.id = r.order_item_id AND i.order_id = r.order_id
         JOIN stock_series s ON s.id = r.series_id
        WHERE r.order_id = ? ORDER BY r.linko_id DESC NULLS FIRST, r.id DESC`,
    )
    .all(orderId)) as Array<{
    id: number
    order_item_id: number
    amount: number
    product_id: number | null
    product_name: string
    s_id: number
    s_product_id: number
    s_number: string
    s_expiration_date: string | null
    s_is_auto_created: number | boolean | null
  }>
  return (
    rows
      // A line that now holds another product is not the line the row was written for.
      .filter((row) => row.product_id === null || Number(row.product_id) === Number(row.s_product_id))
      .map((row) => ({
        id: Number(row.id),
        orderItemId: Number(row.order_item_id),
        productId: row.product_id === null ? null : Number(row.product_id),
        productName: row.product_name,
        amount: round9(Number(row.amount) || 0),
        series: toSeries({ id: row.s_id, product_id: row.s_product_id, number: row.s_number, expiration_date: row.s_expiration_date, is_auto_created: row.s_is_auto_created }),
      }))
  )
}

/** «Наименование» of «Изменит серии»: the order's lines whose product keeps an expiry, by id; null = no order. */
export async function listOrderSeriesLines(orderId: number, search = ""): Promise<OrderSeriesLine[] | null> {
  if (!validId(orderId)) return null
  await ensureOrderSeriesSchema()
  const db = getDb()
  if (!(await orderHead(db, orderId))) return null
  const term = search.trim().toLowerCase()
  return (await loadLines(db, [orderId]))
    .filter(tracked)
    .filter((line) => !term || line.product_name.toLowerCase().includes(term))
    .slice(0, 50)
    .map((line) => ({ id: Number(line.id), number: Number(line.linko_line) || Number(line.id), productId: Number(line.product_id), productName: line.product_name, quantity: Number(line.quantity) || 0, unit: line.unit ?? "", isBonus: Number(line.is_bonus) === 1, promotion: (line.promotion ?? "").trim() }))
}

/** The series of a product that hold something in a warehouse, with their balance (Linko's stock/series_balance/
 * ?product=&stock=&search=): the latest expiry first, a series without one last. */
export async function listSeriesBalance(query: { productId: number; warehouse: string; search?: string; limit?: number }): Promise<{ count: number; results: SeriesBalanceOption[] }> {
  if (!validId(query.productId) || !query.warehouse.trim()) return { count: 0, results: [] }
  await ensureOrderSeriesSchema()
  const db = getDb()
  const stock = (await seriesStock(db, [{ productId: query.productId, warehouse: query.warehouse }])).get(`${query.warehouse}|${query.productId}`) ?? new Map()
  const ids = [...stock.values()].filter((row) => row.total > EPS).map((row) => row.seriesId)
  if (!ids.length) return { count: 0, results: [] }
  const term = (query.search ?? "").trim().toLowerCase()
  const rows = (await db
    .prepare(
      `SELECT id, product_id, number, expiration_date, is_auto_created FROM stock_series
        WHERE id = ANY(@ids::int[]) AND (@term = '' OR lower(number) LIKE '%' || @term || '%' OR COALESCE(expiration_date, '') LIKE '%' || @term || '%')
        ORDER BY NULLIF(btrim(COALESCE(expiration_date, '')), '') DESC NULLS LAST, id`,
    )
    .all({ ids, term })) as SeriesDbRow[]
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  return {
    count: rows.length,
    results: rows.slice(0, limit).map((row) => {
      const balance = stock.get(Number(row.id))!
      return { ...toSeries(row), totalBalance: balance.total, available: balance.available }
    }),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type ResolvedRow = { line: LineDbRow; seriesId: number; amount: number }

async function replaceRows(db: PgDb, orderId: number, rows: ResolvedRow[], user: string) {
  await db.prepare("DELETE FROM order_item_series WHERE order_id = ?").run(orderId)
  for (const row of rows) {
    await db
      .prepare("INSERT INTO order_item_series (order_id, order_item_id, series_id, amount, created_by) VALUES (@orderId, @lineId, @seriesId, @amount, @user)")
      .run({ orderId, lineId: row.line.id, seriesId: row.seriesId, amount: round9(row.amount), user })
  }
}

/** «Изменит серии» → СОХРАНИТЬ (Linko's order_product_exp/set/): the list replaces the order's series rows; an empty
 * list clears them. Each line must be a line of this order, each series a series of the line's product, and the series of
 * a line may not hold more than the line. Any status, like Linko. */
export async function setOrderSeries(orderId: number, input: OrderSeriesInput[], user: { displayName: string }): Promise<OrderSeriesRow[] | null> {
  if (!validId(orderId)) return null
  await ensureOrderSeriesSchema()
  return withTransaction(async (tx) => {
    if (!(await orderHead(tx, orderId, true))) return null
    const byId = new Map((await loadLines(tx, [orderId])).map((line) => [Number(line.id), line]))
    const seriesIds = [...new Set(input.map((row) => row.seriesId))]
    const series = seriesIds.length ? ((await tx.prepare("SELECT id, product_id FROM stock_series WHERE id = ANY(?::int[])").all(seriesIds)) as Array<{ id: number; product_id: number }>) : []
    const productOf = new Map(series.map((row) => [Number(row.id), Number(row.product_id)]))
    const resolved: ResolvedRow[] = input.map((row, index) => {
      const line = byId.get(row.orderItemId)
      if (!line) throw new OrderError("Товар не найден в заказе", 400, { field: `products.${index}.orderItemId` })
      const product = productOf.get(row.seriesId)
      if (product === undefined) throw new OrderError("Серия не найдена", 400, { field: `products.${index}.seriesId` })
      if (product !== Number(line.product_id)) throw new OrderError("Серия не относится к товару", 400, { field: `products.${index}.seriesId` })
      if (!(row.amount > 0) || row.amount > MAX_QTY) throw new OrderError("Количество должно быть больше 0", 400, { field: `products.${index}.amount` })
      return { line, seriesId: row.seriesId, amount: row.amount }
    })
    // Series label the line's quantity: together they may not exceed it.
    const totals = new Map<number, number>()
    for (const [index, row] of resolved.entries()) {
      const total = round9((totals.get(row.line.id) ?? 0) + row.amount)
      totals.set(row.line.id, total)
      if (total > round9(Number(row.line.quantity) || 0) + EPS) {
        throw new OrderError("Количество по сериям больше количества товара", 400, { field: `products.${index}.amount`, available: Number(row.line.quantity) || 0 })
      }
    }
    await replaceRows(tx, orderId, resolved, user.displayName)
    return readRows(tx, orderId)
  })
}

/**
 * «Авто распределение по сериям» (Linko's order_product_exp/auto_set/ {auto_type, orders}): fills the series of every
 * line of the orders whose product keeps an expiry, replacing their rows. A line takes the series its order's warehouse
 * holds, in the order of the chosen rule — FIFO the earliest expiry first, LIFO the latest first; «По типу указанному у
 * клиента» uses the client's «Реализация по» (FIFO unless LIFO) — each up to what is available in it, so a line may be
 * split over several series. The balances are lib/order-series-balance.ts's estimate without these orders (their own
 * shipment and series given back); the orders draw from it one after another (by id), lines by id. What no series can
 * cover stays without a series. `unassigned` = that quantity.
 */
export async function autoDistributeOrderSeries(ids: number[], type: SeriesAutoType, user: { displayName: string }): Promise<{ orders: number; rows: number; unassigned: number }> {
  const unique = [...new Set(ids)].filter(validId).sort((a, b) => a - b)
  if (!unique.length) throw new OrderError("Выберите заказ из списка", 400, { field: "ids" })
  if (!SERIES_AUTO_TYPES.includes(type)) throw new OrderError("Неверные данные", 400, { field: "autoType" })
  await ensureOrderSeriesSchema()
  return withTransaction(async (tx) => {
    const heads = (await tx
      .prepare(
        `SELECT o.id, o.warehouse, o.client_id, upper(btrim(COALESCE(to_jsonb(c) ->> 'realization_by', ''))) AS realization
           FROM orders o LEFT JOIN clients c ON c.id = o.client_id
          WHERE o.id = ANY(@ids::int[]) ORDER BY o.id FOR UPDATE OF o`,
      )
      .all({ ids: unique })) as Array<OrderHead & { realization: string }>
    if (heads.length !== unique.length) throw new OrderError("Заказ не найден", 404, { ids: unique.filter((id) => !heads.some((head) => Number(head.id) === id)) })
    const lines = (await loadLines(tx, unique)).filter((line) => tracked(line) && Number(line.quantity) > 0)
    const warehouseOf = new Map(heads.map((head) => [Number(head.id), String(head.warehouse ?? "").trim()]))
    const requests = lines.filter((line) => warehouseOf.get(Number(line.order_id))).map((line) => ({ productId: Number(line.product_id), warehouse: warehouseOf.get(Number(line.order_id))! }))
    const stock = await seriesStock(tx, requests, { excludeOrderIds: unique })
    const productIds = [...new Set(lines.map((line) => Number(line.product_id)))]
    const catalog = productIds.length
      ? ((await tx.prepare("SELECT id, product_id, number, expiration_date, is_auto_created FROM stock_series WHERE product_id = ANY(@ids::int[])").all({ ids: productIds })) as SeriesDbRow[])
      : []
    // What is left of each series in each warehouse while the orders draw from it.
    const left = new Map<string, number>()
    for (const [key, bySeries] of stock) for (const [seriesId, row] of bySeries) left.set(`${key}|${seriesId}`, Math.max(0, row.available))
    let written = 0
    let unassigned = 0
    for (const head of heads) {
      const lifo = type === "lifo" || (type === "from_market" && head.realization === "LIFO")
      const warehouse = warehouseOf.get(Number(head.id)) ?? ""
      const rows: ResolvedRow[] = []
      for (const line of lines.filter((item) => Number(item.order_id) === Number(head.id))) {
        const ordered = fifoOrder(catalog.filter((row) => Number(row.product_id) === Number(line.product_id)))
        if (lifo) ordered.reverse()
        let rest = Number(line.quantity)
        for (const series of warehouse ? ordered : []) {
          if (rest <= EPS) break
          const key = `${warehouse}|${line.product_id}|${series.id}`
          const take = Math.min(rest, left.get(key) ?? 0)
          if (take <= EPS) continue
          rows.push({ line, seriesId: Number(series.id), amount: take })
          left.set(key, round9((left.get(key) ?? 0) - take))
          rest = round9(rest - take)
        }
        unassigned = round9(unassigned + Math.max(0, rest))
      }
      await replaceRows(tx, Number(head.id), rows, user.displayName)
      written += rows.length
    }
    return { orders: unique.length, rows: written, unassigned }
  })
}
