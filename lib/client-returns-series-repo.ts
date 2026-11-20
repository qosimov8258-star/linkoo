import "server-only"

import { ClientReturnError, ensureClientReturnsSchema } from "@/lib/client-returns-repo"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { MAX_QTY } from "@/lib/orders-repo"

// Series (Серии) of client returns, like Linko's stock/series + sales/order_return_product_exp.
//
// stock_series(id, product_id, number, expiration_date, party_id, is_auto_created): the series catalog. Rows copied
// from Linko keep Linko's id (scripts/linko-sync/import-series.mjs); its display name is the number.
// client_return_item_series(id, return_id → client_returns ON DELETE CASCADE, return_item_id, product_id,
// order_item_id, line_seq, series_id → stock_series, amount, linko_id): how much of a return line belongs to which
// series. A row belongs to its line id: editing a return in the app keeps the ids of the lines it keeps
// (updateClientReturn), so the rows of a deleted line are not shown (and go with the next save) instead of moving to
// another line. (product, order line, occurrence of that pair among the return's lines ordered by id) is the line's key
// for rows without a line id and for the sync: import-returns.mjs replaces a return's lines with new ids, and
// import-series.mjs moves the rows to the new lines by that key.
// order_item_series(id, order_id, order_item_id, series_id, amount, linko_id): the series of order lines (Linko's
// sales/order_product_exp); the auto distribution gives a return line of an order its order line's series.
//
// Series only label quantities: the stock ledger does not keep balances per series.

const DDL = `
CREATE TABLE IF NOT EXISTS stock_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  expiration_date TEXT,
  party_id INTEGER,
  is_auto_created INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS stock_series_product_idx ON stock_series (product_id);
CREATE TABLE IF NOT EXISTS client_return_item_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_item_id INTEGER NOT NULL,
  series_id INTEGER NOT NULL REFERENCES stock_series(id),
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  linko_id INTEGER
);
CREATE INDEX IF NOT EXISTS order_item_series_item_idx ON order_item_series (order_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_item_series_linko_idx ON order_item_series (linko_id);
`

const SCHEMA_VERSION = 2

declare global {
  var __mezonReturnSeriesSchema: { version: number; ready: Promise<void> } | undefined
}

export function ensureReturnSeriesSchema(): Promise<void> {
  if (globalThis.__mezonReturnSeriesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(async () => {
      await ensureClientReturnsSchema()
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120941)")
        await tx.exec(DDL)
      })
    }).catch((error) => {
      globalThis.__mezonReturnSeriesSchema = undefined
      throw error
    })
    globalThis.__mezonReturnSeriesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__mezonReturnSeriesSchema!.ready
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StockSeries = {
  id: number
  productId: number
  number: string
  /** YYYY-MM-DD, or null when the series has no expiry. */
  expirationDate: string | null
  isAutoCreated: boolean
  displayName: string
}

export type ReturnSeriesRow = {
  id: number
  /** The return line the row belongs to (its current id). */
  returnItemId: number
  productId: number | null
  productName: string
  amount: number
  series: StockSeries
}

/** A return line whose product keeps an expiry (Linko's order_return_product/?use_expiration=true). */
export type ReturnSeriesLine = { id: number; productId: number; productName: string; quantity: number; unit: string }

export type SeriesAutoType = "fifo" | "lifo" | "from_market"
export const SERIES_AUTO_TYPES: SeriesAutoType[] = ["fifo", "lifo", "from_market"]

type SeriesDbRow = { id: number; product_id: number; number: string; expiration_date: string | null; is_auto_created: number | boolean | null }

type LineDbRow = { id: number; product_id: number | null; order_item_id: number | null; product_name: string; quantity: number; unit: string; track_expiry?: number | string | null }

type StoredDbRow = { id: number; return_item_id: number | null; product_id: number | null; order_item_id: number | null; line_seq: number; amount: number } & {
  s_id: number
  s_product_id: number
  s_number: string
  s_expiration_date: string | null
  s_is_auto_created: number | boolean | null
}

const MAX_ID = 2_147_483_647
const round9 = (value: number) => Math.round(value * 1e9) / 1e9

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

/** Key of a line: (product, order line, how many lines with the same pair come before it). */
function keyOf(productId: number | null, orderItemId: number | null, seq: number) {
  return `${productId ?? ""}:${orderItemId ?? ""}:${seq}`
}

/** The key of every line, lines ordered by id. */
function lineKeys(lines: LineDbRow[]): Map<number, { key: string; seq: number }> {
  const seen = new Map<string, number>()
  const out = new Map<number, { key: string; seq: number }>()
  for (const line of [...lines].sort((a, b) => a.id - b.id)) {
    const pair = `${line.product_id ?? ""}:${line.order_item_id ?? ""}`
    const seq = seen.get(pair) ?? 0
    seen.set(pair, seq + 1)
    out.set(line.id, { key: keyOf(line.product_id, line.order_item_id, seq), seq })
  }
  return out
}

async function loadLines(db: PgDb, returnId: number): Promise<LineDbRow[]> {
  return (await db
    .prepare(
      `SELECT i.id, i.product_id, i.order_item_id, i.product_name, i.quantity, i.unit, COALESCE((to_jsonb(p) ->> 'track_expiry')::int, 0) AS track_expiry
         FROM client_return_items i LEFT JOIN products p ON p.id = i.product_id
        WHERE i.return_id = ? ORDER BY i.id`,
    )
    .all(returnId)) as LineDbRow[]
}

const tracked = (line: LineDbRow) => Number(line.track_expiry) === 1

async function returnExists(db: PgDb, id: number, lock = false): Promise<{ id: number; client_id: number | null } | undefined> {
  return (await db.prepare(`SELECT id, client_id FROM client_returns WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as { id: number; client_id: number | null } | undefined
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= MAX_ID

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The «Серии» tab of a return (Linko's order_return_product_exp/?order_return=): newest row first; null = no return. */
export async function listReturnSeries(returnId: number): Promise<ReturnSeriesRow[] | null> {
  if (!validId(returnId)) return null
  await ensureReturnSeriesSchema()
  const db = getDb()
  if (!(await returnExists(db, returnId))) return null
  return readRows(db, returnId)
}

async function readRows(db: PgDb, returnId: number): Promise<ReturnSeriesRow[]> {
  const lines = await loadLines(db, returnId)
  const keys = lineKeys(lines)
  const byKey = new Map<string, LineDbRow>()
  for (const line of lines) byKey.set(keys.get(line.id)!.key, line)
  const byId = new Map(lines.map((line) => [line.id, line]))
  const stored = (await db
    .prepare(
      `SELECT r.id, r.return_item_id, r.product_id, r.order_item_id, r.line_seq, r.amount,
              s.id AS s_id, s.product_id AS s_product_id, s.number AS s_number, s.expiration_date AS s_expiration_date, s.is_auto_created AS s_is_auto_created
         FROM client_return_item_series r JOIN stock_series s ON s.id = r.series_id
        WHERE r.return_id = ? ORDER BY r.id DESC`,
    )
    .all(returnId)) as StoredDbRow[]
  const out: ReturnSeriesRow[] = []
  for (const row of stored) {
    const line = row.return_item_id !== null ? byId.get(Number(row.return_item_id)) : byKey.get(keyOf(row.product_id, row.order_item_id, Number(row.line_seq)))
    // A line that now holds another product is not the line the row was written for.
    if (!line || (row.product_id !== null && line.product_id !== null && Number(row.product_id) !== Number(line.product_id))) continue
    out.push({
      id: Number(row.id),
      returnItemId: line.id,
      productId: line.product_id,
      productName: line.product_name,
      amount: round9(Number(row.amount) || 0),
      series: toSeries({ id: row.s_id, product_id: row.s_product_id, number: row.s_number, expiration_date: row.s_expiration_date, is_auto_created: row.s_is_auto_created }),
    })
  }
  return out
}

/** «Наименование» of «Изменит серии»: the return's lines whose product keeps an expiry; null = no return. */
export async function listSeriesLines(returnId: number, search = ""): Promise<ReturnSeriesLine[] | null> {
  if (!validId(returnId)) return null
  await ensureReturnSeriesSchema()
  const db = getDb()
  if (!(await returnExists(db, returnId))) return null
  const term = search.trim().toLowerCase()
  return (await loadLines(db, returnId))
    .filter((line) => tracked(line) && line.product_id !== null)
    .filter((line) => !term || line.product_name.toLowerCase().includes(term))
    .slice(0, 50)
    .map((line) => ({ id: line.id, productId: line.product_id!, productName: line.product_name, quantity: Number(line.quantity) || 0, unit: line.unit ?? "" }))
}

/** Series of a product (Linko's stock/series/?product=&search=), newest first. */
export async function listStockSeries(query: { productId: number; search?: string; limit?: number }): Promise<{ count: number; results: StockSeries[] }> {
  await ensureReturnSeriesSchema()
  if (!validId(query.productId)) return { count: 0, results: [] }
  const term = (query.search ?? "").trim().toLowerCase()
  const rows = (await getDb()
    .prepare(
      `SELECT id, product_id, number, expiration_date, is_auto_created FROM stock_series
        WHERE product_id = @productId AND (@term = '' OR lower(number) LIKE '%' || @term || '%' OR COALESCE(expiration_date, '') LIKE '%' || @term || '%')
        ORDER BY id DESC`,
    )
    .all({ productId: query.productId, term })) as SeriesDbRow[]
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  return { count: rows.length, results: rows.slice(0, limit).map(toSeries) }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ReturnSeriesInput = { amount: number; returnItemId: number; seriesId: number }

type ResolvedRow = { line: LineDbRow; seq: number; seriesId: number; amount: number }

async function replaceRows(db: PgDb, returnId: number, rows: ResolvedRow[], user: string) {
  await db.prepare("DELETE FROM client_return_item_series WHERE return_id = ?").run(returnId)
  for (const row of rows) {
    await db
      .prepare(
        `INSERT INTO client_return_item_series (return_id, return_item_id, product_id, order_item_id, line_seq, series_id, amount, created_by)
         VALUES (@returnId, @lineId, @productId, @orderItemId, @seq, @seriesId, @amount, @user)`,
      )
      .run({ returnId, lineId: row.line.id, productId: row.line.product_id, orderItemId: row.line.order_item_id, seq: row.seq, seriesId: row.seriesId, amount: round9(row.amount), user })
  }
}

/** «Изменит серии» → СОХРАНИТЬ (Linko's order_return_product_exp/set/): the list replaces the return's series rows;
 * an empty list clears them. Each line must be a line of this return, each series a series of the line's product. */
export async function setReturnSeries(returnId: number, input: ReturnSeriesInput[], user: { displayName: string }): Promise<ReturnSeriesRow[] | null> {
  if (!validId(returnId)) return null
  await ensureReturnSeriesSchema()
  return withTransaction(async (tx) => {
    if (!(await returnExists(tx, returnId, true))) return null
    const lines = await loadLines(tx, returnId)
    const keys = lineKeys(lines)
    const byId = new Map(lines.map((line) => [line.id, line]))
    const seriesIds = [...new Set(input.map((row) => row.seriesId))]
    const series = seriesIds.length
      ? ((await tx.prepare("SELECT id, product_id FROM stock_series WHERE id = ANY(?::int[])").all(seriesIds)) as Array<{ id: number; product_id: number }>)
      : []
    const productOf = new Map(series.map((row) => [Number(row.id), Number(row.product_id)]))
    const resolved: ResolvedRow[] = input.map((row, index) => {
      const line = byId.get(row.returnItemId)
      if (!line) throw new ClientReturnError("Товар не найден в возврате", 400, { field: `products.${index}.returnItemId` })
      const product = productOf.get(row.seriesId)
      if (product === undefined) throw new ClientReturnError("Серия не найдена", 400, { field: `products.${index}.seriesId` })
      if (product !== line.product_id) throw new ClientReturnError("Серия не относится к товару", 400, { field: `products.${index}.seriesId` })
      if (!(row.amount > 0) || row.amount > MAX_QTY) throw new ClientReturnError("Количество должно быть больше 0", 400, { field: `products.${index}.amount` })
      return { line, seq: keys.get(line.id)!.seq, seriesId: row.seriesId, amount: row.amount }
    })
    // Series label the line's quantity: together they may not exceed it.
    const totals = new Map<number, number>()
    for (const [index, row] of resolved.entries()) {
      const total = round9((totals.get(row.line.id) ?? 0) + row.amount)
      totals.set(row.line.id, total)
      if (total > round9(Number(row.line.quantity) || 0) + 1e-9) {
        throw new ClientReturnError("Количество по сериям больше количества товара", 400, { field: `products.${index}.amount`, available: Number(row.line.quantity) || 0 })
      }
    }
    await replaceRows(tx, returnId, resolved, user.displayName)
    return readRows(tx, returnId)
  })
}

/** Order of the series for a distribution: FIFO = earliest expiry first, LIFO = latest first (no expiry last). */
function sortSeries<T extends { id: number; expiration_date: string | null }>(rows: T[], lifo: boolean): T[] {
  return [...rows].sort((a, b) => {
    const da = a.expiration_date ?? ""
    const dbb = b.expiration_date ?? ""
    if (!da !== !dbb) return da ? -1 : 1
    if (da !== dbb) return (da < dbb ? -1 : 1) * (lifo ? -1 : 1)
    return (a.id - b.id) * (lifo ? -1 : 1)
  })
}

/** «Авто распределение по сериям» (Linko's order_return_product_exp/auto_set/): fills the series of every line of the
 * returns whose product keeps an expiry, replacing their rows. A line of an order takes the series its order line got
 * (in that series' order, up to their amounts); the rest of a line (or a line without an order) goes to the product's
 * first series by expiry: FIFO the earliest, LIFO the latest; «По типу указанному у клиента» uses the client's
 * «Реализация по» (FIFO unless LIFO). A line whose product has no series gets none. */
export async function autoDistributeReturnSeries(ids: number[], type: SeriesAutoType, user: { displayName: string }): Promise<{ returns: number; rows: number }> {
  const unique = [...new Set(ids)].filter(validId)
  if (!unique.length) throw new ClientReturnError("Выберите возвраты", 400, { field: "ids" })
  if (!SERIES_AUTO_TYPES.includes(type)) throw new ClientReturnError("Неверные данные", 400, { field: "autoType" })
  await ensureReturnSeriesSchema()
  return withTransaction(async (tx) => {
    let written = 0
    for (const id of unique.sort((a, b) => a - b)) {
      const head = await returnExists(tx, id, true)
      if (!head) throw new ClientReturnError("Возврат не найден", 404, { id })
      let lifo = type === "lifo"
      if (type === "from_market") {
        const client = head.client_id ? ((await tx.prepare("SELECT realization_by FROM clients WHERE id = ?").get(head.client_id)) as { realization_by?: string | null } | undefined) : undefined
        lifo = String(client?.realization_by ?? "").trim().toUpperCase() === "LIFO"
      }
      const lines = await loadLines(tx, id)
      const keys = lineKeys(lines)
      const wanted = lines.filter((line) => tracked(line) && line.product_id !== null && Number(line.quantity) > 0)
      const productIds = [...new Set(wanted.map((line) => line.product_id!))]
      const orderItemIds = [...new Set(wanted.map((line) => line.order_item_id).filter((value): value is number => value !== null))]
      const allSeries = productIds.length
        ? ((await tx.prepare("SELECT id, product_id, number, expiration_date, is_auto_created FROM stock_series WHERE product_id = ANY(?::int[])").all(productIds)) as SeriesDbRow[])
        : []
      const orderSeries = orderItemIds.length
        ? ((await tx
            .prepare(
              `SELECT o.order_item_id, o.series_id AS id, o.amount, s.product_id, s.expiration_date
                 FROM order_item_series o JOIN stock_series s ON s.id = o.series_id
                WHERE o.order_item_id = ANY(?::int[]) ORDER BY o.id`,
            )
            .all(orderItemIds)) as Array<{ order_item_id: number; id: number; amount: number; product_id: number; expiration_date: string | null }>)
        : []
      const rows: ResolvedRow[] = []
      for (const line of wanted) {
        const seq = keys.get(line.id)!.seq
        let rest = Number(line.quantity)
        const add = (seriesId: number, amount: number) => {
          const same = rows.find((row) => row.line.id === line.id && row.seriesId === seriesId)
          if (same) same.amount += amount
          else rows.push({ line, seq, seriesId, amount })
        }
        const fromOrder = sortSeries(
          orderSeries.filter((row) => row.order_item_id === line.order_item_id && row.product_id === line.product_id),
          lifo,
        )
        for (const row of fromOrder) {
          if (rest <= 1e-9) break
          const take = Math.min(rest, Number(row.amount) || 0)
          if (take > 0) {
            add(Number(row.id), take)
            rest = round9(rest - take)
          }
        }
        if (rest > 1e-9) {
          const first = sortSeries(allSeries.filter((row) => Number(row.product_id) === line.product_id), lifo)[0]
          if (first) add(Number(first.id), rest)
        }
      }
      await replaceRows(tx, id, rows, user.displayName)
      written += rows.length
    }
    return { returns: unique.length, rows: written }
  })
}
