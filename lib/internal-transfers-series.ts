import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import type { Transfer, TransferItem, TransferSeriesOption, TransferSeriesPrev } from "@/lib/internal-transfers-types"

// Series (Серия) of the lines of "Передачи между складами", on the shared series catalog stock_series
// (lib/client-returns-series-repo.ts creates it; rows copied from Linko keep Linko's ids). Like Linko's
// stock_transfer_product.series, a line holds at most one series: internal_transfers.items[].seriesId with its
// display name in items[].series. Series only label quantities: the stock ledger keeps no balance per series.

/** The series catalog's schema (lib/client-returns-series-repo.ts owns it). Loaded lazily: that module reaches the
 * orders and client returns, which import the finance modules that import the transfers repo (a static import here
 * would close that cycle). */
async function ensureSeriesCatalog(): Promise<void> {
  const { ensureReturnSeriesSchema } = await import("@/lib/client-returns-series-repo")
  await ensureReturnSeriesSchema()
}

const MAX_ID = 2_147_483_647
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= MAX_ID

/** The catalog product id of a line key ("product:176" → 176), else null. */
export function productIdOfKey(key: string | undefined | null): number | null {
  const match = /^product:(\d+)$/.exec(String(key ?? ""))
  const id = match ? Number(match[1]) : NaN
  return validId(id) ? id : null
}

type SeriesRow = { id: number; product_id: number; number: string | null; expiration_date: string | null }

function toOption(row: SeriesRow): TransferSeriesOption {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(row.expiration_date ?? "")?.[0] ?? null
  return { id: Number(row.id), productId: Number(row.product_id), number: row.number ?? "", expirationDate: day, displayName: row.number || day || String(row.id) }
}

/** Order of the Серия pickers (Linko's series_balance): the latest expiry first, series without one last. */
const PICKER_ORDER = "ORDER BY NULLIF(btrim(COALESCE(expiration_date, '')), '') DESC NULLS LAST, id"

/** Series of a product for the pickers (GET /api/internal-transfers/series). */
export async function listTransferSeries(productId: number, search = "", limit = 50): Promise<{ count: number; results: TransferSeriesOption[] }> {
  if (!validId(productId)) return { count: 0, results: [] }
  await ensureSeriesCatalog()
  const term = search.trim().toLowerCase()
  const rows = (await getDb()
    .prepare(
      `SELECT id, product_id, number, expiration_date FROM stock_series
        WHERE product_id = @productId AND (@term = '' OR lower(number) LIKE '%' || @term || '%' OR COALESCE(expiration_date, '') LIKE '%' || @term || '%')
        ${PICKER_ORDER}`,
    )
    .all({ productId, term })) as SeriesRow[]
  return { count: rows.length, results: rows.slice(0, Math.min(Math.max(limit, 1), 200)).map(toOption) }
}

/** Every series of the given products, in picker order. */
export async function seriesOfProducts(db: PgDb, productIds: number[]): Promise<TransferSeriesOption[]> {
  const ids = [...new Set(productIds.filter(validId))]
  if (!ids.length) return []
  await ensureSeriesCatalog()
  const rows = (await db.prepare(`SELECT id, product_id, number, expiration_date FROM stock_series WHERE product_id = ANY(@ids::int[]) ${PICKER_ORDER}`).all({ ids })) as SeriesRow[]
  return rows.map(toOption)
}

export type ProductFacts = { trackExpiry: boolean; boxAmount: number; boxUnit: string }

/** «Учитывать срок годности» and the box of the catalog products behind line keys (missing lazy columns read as off / none). */
export async function productFacts(db: PgDb, keys: string[]): Promise<Map<string, ProductFacts>> {
  const ids = [...new Set(keys.map(productIdOfKey).filter((id): id is number => id !== null))]
  const out = new Map<string, ProductFacts>()
  if (!ids.length) return out
  const rows = (await db
    .prepare(
      `SELECT p.id, COALESCE(NULLIF(to_jsonb(p) ->> 'track_expiry', '')::int, 0) AS track_expiry,
              COALESCE(NULLIF(to_jsonb(p) ->> 'box_amount', '')::double precision, 0) AS box_amount,
              COALESCE(to_jsonb(p) ->> 'box_unit', '') AS box_unit
         FROM products p WHERE p.id = ANY(@ids::int[])`,
    )
    .all({ ids })) as Array<{ id: number; track_expiry: number; box_amount: number; box_unit: string }>
  for (const row of rows) {
    const boxAmount = Number(row.box_amount) > 0 ? Number(row.box_amount) : 0
    out.set(`product:${row.id}`, { trackExpiry: Number(row.track_expiry) === 1, boxAmount, boxUnit: boxAmount ? String(row.box_unit ?? "").trim() : "" })
  }
  return out
}

/** The transfer with each line's product facts (Серия column, Группа line) for the card and the edit form. */
export async function withProductFacts(transfer: Transfer, db: PgDb = getDb()): Promise<Transfer> {
  const facts = await productFacts(
    db,
    transfer.items.map((item) => item.key),
  )
  return {
    ...transfer,
    items: transfer.items.map((item) => {
      const fact = facts.get(item.key)
      return fact ? { ...item, trackExpiry: fact.trackExpiry, boxAmount: fact.boxAmount, boxUnit: fact.boxUnit } : item
    }),
  }
}

export type LineSeriesInput = { seriesId?: number | null; series?: string; seriesAuto?: boolean; seriesPrev?: { id?: number | null; series?: string } | null }

type ResolvedSeries = Pick<TransferItem, "series" | "seriesId" | "seriesAuto" | "seriesPrev">

/** A stored or sent «series before the distribution»: an id (kept only when `valid` says it is one of the line's
 * product) and a name; null when it holds neither. */
function prevOf(value: unknown, valid: (id: number) => boolean): TransferSeriesPrev | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const id = Number(raw.id)
  const series = String(raw.series ?? "").trim().slice(0, 200)
  const keepId = validId(id) && valid(id)
  if (!keepId && !series) return null
  return { ...(keepId ? { id } : {}), series }
}

/** The series fields a saved line stores: a chosen series must exist and belong to the line's product (its
 * display name is stored with it); without one, a legacy text (Excel, documents copied from Linko) stays as typed.
 * A series the distribution set keeps its mark and the series it replaced while it is still the line's series.
 * Returns an error text for a bad series. */
export async function resolveLineSeries(db: PgDb, lines: Array<{ key: string; input: LineSeriesInput }>): Promise<Array<ResolvedSeries | { error: string; position: number }>> {
  const wanted = [...new Set(lines.flatMap((line) => [Number(line.input.seriesId), Number(line.input.seriesPrev?.id)]).filter(validId))]
  const byId = new Map<number, TransferSeriesOption>()
  if (wanted.length) {
    await ensureSeriesCatalog()
    const rows = (await db.prepare("SELECT id, product_id, number, expiration_date FROM stock_series WHERE id = ANY(@ids::int[])").all({ ids: wanted })) as SeriesRow[]
    for (const row of rows) byId.set(Number(row.id), toOption(row))
  }
  return lines.map((line, position) => {
    const raw = line.input.seriesId
    if (raw === undefined || raw === null || raw === 0) return { series: String(line.input.series ?? "").trim().slice(0, 200) }
    const id = Number(raw)
    const found = validId(id) ? byId.get(id) : undefined
    if (!found) return { error: "Серия не найдена", position }
    const productId = productIdOfKey(line.key)
    if (found.productId !== productId) return { error: "Серия не относится к товару", position }
    if (!line.input.seriesAuto) return { series: found.displayName, seriesId: found.id }
    const prev = prevOf(line.input.seriesPrev, (prevId) => byId.get(prevId)?.productId === productId)
    return { series: found.displayName, seriesId: found.id, seriesAuto: true, ...(prev ? { seriesPrev: prev } : {}) }
  })
}

/** The series fields of a stored line (parseItems). */
export function storedSeries(line: Record<string, unknown>): Pick<TransferItem, "seriesId" | "seriesAuto" | "seriesPrev"> {
  const id = Number(line.seriesId)
  if (!validId(id)) return {}
  if (line.seriesAuto !== true) return { seriesId: id }
  const prev = prevOf(line.seriesPrev, () => true)
  return { seriesId: id, seriesAuto: true, ...(prev ? { seriesPrev: prev } : {}) }
}
