import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { getProductionDb, itemKey, nowIso, ProductionError, round, textKey, type ItemKind } from "@/lib/production-schema"
import { lockWarehousesOf, lockWarehouseStock } from "@/lib/internal-transfers-stock"
import { assertMovementDay, assertWarehouseOpen, ensureAvailable, itemCosts, requireCatalogItem, type CatalogItem, type StockNeed } from "@/lib/production-stock"
import { getRecipe, getStage, listRecipes, type ProductionRecipe } from "@/lib/production-stages-repo"
import { docYearOk } from "@/lib/document-dates"
import { isIsoDay, localToUtcText, parseAnyDate, todayIso } from "@/lib/finance/dates"
import { productionDependents } from "@/lib/net-cost-sync"
import { cachedProductCost, documentLineUnit, documentLineValues, loadCostLedger, refreshProductCostCache } from "@/lib/stock/costs"

export type PartyStatus = "pending" | "finished" | "cancelled"

export type ProductionParty = {
  id: number
  stageId: number | null
  stageName: string
  warehouse: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
}

export type ProductionMovement = {
  id: number
  partyId: number | null
  stageId: number | null
  direction: "made" | "raw" | "adjust"
  key: string
  name: string
  unit: string
  amount: number
  cost: number
  total: number
  isDefect: boolean
  comment: string
  image: string
  date: string
  shift: string
  equipmentId: number | null
  equipmentName: string
  worker: string
  userName: string
  createdAt: string
}

/** `series`: the series / expiry date a made product carries («Срок годности»), '' without one. */
export type SummaryLine = { key: string; name: string; unit: string; amount: number; cost: number; total: number; series?: string }

/** A good made line of the batch detail, with the series / expiry date its output carries ('' without one). */
export type PartyMadeLine = ProductionMovement & { series: string }

export type PartyDetail = ProductionParty & {
  /** Good output. Its cost is shown once the batch is finished (0 while it is in progress or cancelled), as the reference shows it. */
  made: PartyMadeLine[]
  /** Good raw lines (what the output is made of). */
  raw: ProductionMovement[]
  madeDefects: ProductionMovement[]
  /** Spoiled raw material (Бракованное сырье): it left the warehouse, but it is no part of the output's cost. */
  rawDefects: ProductionMovement[]
  /** Per product, ordered by product id (the reference's total_made_products). */
  totalMade: SummaryLine[]
  /** The good raw lines per item, ordered by item id (the reference's total_raw_products): spoiled raw is not included. */
  totalRaw: SummaryLine[]
  /** Value of the good raw lines = value of the good output (spoiled raw and brak carry no value into it). */
  totalRawCost: number
}

type PartyRow = {
  id: number
  stage_id: number | null
  stage_name: string
  warehouse: string | null
  date: string
  comment: string
  status: string
  user_name: string
  created_at: string
  finished_at: string
}

export type MovementRow = {
  id: number
  party_id: number | null
  stage_id: number | null
  direction: string
  item_kind: string
  item_id: number
  item_name: string
  unit: string
  amount: number
  cost: number
  is_defect: number
  comment: string
  image: string
  date: string
  shift: string
  equipment_id: number | null
  equipment_name: string | null
  worker: string
  user_name: string
  created_at: string
}

const toStatus = (value: string): PartyStatus => (value === "finished" || value === "cancelled" ? value : "pending")

const toParty = (row: PartyRow): ProductionParty => ({
  id: row.id,
  stageId: row.stage_id,
  stageName: row.stage_name,
  warehouse: row.warehouse ?? "",
  date: row.date,
  comment: row.comment,
  status: toStatus(row.status),
  userName: row.user_name,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
})

export const toMovement = (row: MovementRow): ProductionMovement => ({
  id: row.id,
  partyId: row.party_id,
  stageId: row.stage_id,
  direction: row.direction === "made" ? "made" : row.direction === "adjust" ? "adjust" : "raw",
  key: itemKey(row.item_kind, row.item_id),
  name: row.item_name,
  unit: row.unit,
  amount: row.amount,
  cost: row.cost,
  total: round(row.amount * row.cost, 6),
  isDefect: row.is_defect === 1,
  comment: row.comment,
  image: row.image,
  date: row.date,
  shift: row.shift,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name ?? "",
  worker: row.worker,
  userName: row.user_name,
  createdAt: row.created_at,
})

// A batch moves stock in the warehouse stored on it at creation (the stage's
// warehouse may change later); batches older than that column fall back to
// the stage's warehouse.
const PARTY_SELECT = `
  SELECT p.id, p.stage_id, p.stage_name, COALESCE(NULLIF(p.warehouse, ''), s.warehouse, '') AS warehouse,
         p.date, p.comment, p.status, p.user_name, p.created_at, p.finished_at
  FROM production_parties p LEFT JOIN production_stages s ON s.id = p.stage_id`

export const MOVEMENT_SELECT = `
  SELECT m.*, e.name AS equipment_name
  FROM production_movements m LEFT JOIN production_equipment e ON e.id = m.equipment_id`

// ---- LIST: the Партии list (listParties / listPartiesPage, their filters) ---------------------------------------

export type PartyFilters = {
  status?: string
  search?: string
  stageId?: number
  /** Item keys ("product:171"), one or several (comma separated or an array): a batch matches when ANY of them is
   * among its made / raw lines, as the reference's made_product=171-189 / raw_product. Malformed keys are ignored
   * here (the route refuses them, see parsePartyItemKeys). */
  madeKey?: string | string[]
  rawKey?: string | string[]
  dateFrom?: string
  dateTo?: string
  /** A business day "YYYY-MM-DD" (Asia/Tashkent, the server's day as the reference shows it), or an ISO instant
   * (an older client sent its own day bounds). */
  finishedFrom?: string
  finishedTo?: string
  createdFrom?: string
  createdTo?: string
}

/** The list's order and page: the reference sorts on the server by № or Статус (?ordering=id|-id|status|-status) and
 * pages there (page / page_size). `focus`: the page holding this batch is returned (a link to a batch opens the list
 * where the batch is). */
export type PartyListQuery = { ordering?: string; page?: number; pageSize?: number; focus?: number }
export type PartyListPage = { count: number; page: number; pageSize: number; results: ProductionParty[] }

/** Largest page the list serves (the reference's page sizes go up to 2000). */
export const PARTY_PAGE_SIZE_MAX = 2000
const MAX_INT4 = 2_147_483_647
/** At most this many items per made / raw filter. */
const MAX_FILTER_KEYS = 500

/** The item keys of a made / raw filter, or null when one of them is not "product:<id>" / "raw_material:<id>" with a
 * canonical int4 id (so a crafted value answers 400 instead of reaching Postgres). Empty input → []. */
export function parsePartyItemKeys(value: string | string[] | null | undefined): Array<{ kind: ItemKind; id: number }> | null {
  const parts = (Array.isArray(value) ? value : [value ?? ""])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (parts.length > MAX_FILTER_KEYS) return null
  const keys: Array<{ kind: ItemKind; id: number }> = []
  for (const part of parts) {
    const match = /^(product|raw_material):([1-9]\d{0,9})$/.exec(part)
    if (!match || Number(match[2]) > MAX_INT4) return null
    keys.push({ kind: match[1] as ItemKind, id: Number(match[2]) })
  }
  return keys
}

/** "%term%" for LIKE / ILIKE with the term's own %, _ and \ taken literally (\ is Postgres' default escape). */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** A range bound as a UTC instant. A business day starts at its Asia/Tashkent midnight; its end is the next day's
 * midnight, exclusive. A plain instant (older clients) is inclusive. A value that is neither is no filter. */
type Bound = { at: string; exclusive: boolean }
function businessMidnight(day: string): string | null {
  const utc = localToUtcText(`${day}T00:00`)
  return utc ? `${utc.replace(" ", "T")}Z` : null
}
function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
}
function rangeBound(value: string | undefined, side: "from" | "to"): Bound | null {
  if (!value || !docYearOk(value)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!isIsoDay(value)) return null
    const at = businessMidnight(side === "from" ? value : nextDay(value))
    return at ? { at, exclusive: side === "to" } : null
  }
  // An instant must be a real calendar moment ("2026-02-30T…" is none: Date.parse would roll it into March).
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !parseAnyDate(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? { at: new Date(time).toISOString(), exclusive: false } : null
}

function partyWhere(filters: PartyFilters): { sql: string; params: unknown[] } {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.status) {
    where.push("p.status = ?")
    params.push(filters.status)
  }
  if (filters.stageId) {
    where.push("p.stage_id = ?")
    params.push(filters.stageId)
  }
  if (filters.dateFrom) {
    where.push("p.date >= ?")
    params.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    where.push("p.date <= ?")
    params.push(filters.dateTo)
  }
  // Stored times mix "Z" and "+05:00" offsets, so the bounds are compared as instants.
  const createdFrom = rangeBound(filters.createdFrom, "from")
  const createdTo = rangeBound(filters.createdTo, "to")
  if (createdFrom) {
    where.push("NULLIF(p.created_at, '')::timestamptz >= ?::timestamptz")
    params.push(createdFrom.at)
  }
  if (createdTo) {
    where.push(`NULLIF(p.created_at, '')::timestamptz ${createdTo.exclusive ? "<" : "<="} ?::timestamptz`)
    params.push(createdTo.at)
  }
  // «Период сдачи» narrows the batches that are done (finished, or cancelled) by the day they were done; batches still
  // in progress stay in the list. A cancelled batch that was never finished has no such day and is left out. (The
  // reference's own field narrows nothing: its server ignores delivered_date_*; this is the filter the label means.)
  const finishedFrom = rangeBound(filters.finishedFrom, "from")
  const finishedTo = rangeBound(filters.finishedTo, "to")
  if (finishedFrom) {
    where.push("(p.status = 'pending' OR NULLIF(p.finished_at, '')::timestamptz >= ?::timestamptz)")
    params.push(finishedFrom.at)
  }
  if (finishedTo) {
    where.push(`(p.status = 'pending' OR NULLIF(p.finished_at, '')::timestamptz ${finishedTo.exclusive ? "<" : "<="} ?::timestamptz)`)
    params.push(finishedTo.at)
  }
  for (const [value, direction] of [[filters.madeKey, "made"], [filters.rawKey, "raw"]] as const) {
    const keys = parsePartyItemKeys(value)
    if (!keys?.length) continue
    const byKind = new Map<ItemKind, number[]>()
    for (const key of keys) byKind.set(key.kind, [...(byKind.get(key.kind) ?? []), key.id])
    // Any of the items (the reference ORs them). A booked line that the batch no longer lists (copied from Linko
    // without a batch, see source_party_id in lib/production-schema.ts) still counts for its batch, as in the reference.
    where.push(
      `p.id IN (SELECT COALESCE(m.party_id, m.source_party_id) FROM production_movements m WHERE m.direction = ? AND (${[...byKind.keys()]
        .map(() => "(m.item_kind = ? AND m.item_id = ANY(?::int[]))")
        .join(" OR ")}))`,
    )
    params.push(direction, ...[...byKind.entries()].flatMap(([kind, ids]) => [kind, ids]))
  }
  // Like the reference: the № as text (a part of it matches, "11" → 11, 110…119) or the stage's name.
  const search = filters.search?.trim()
  if (search) {
    const pattern = likePattern(search)
    where.push("(CAST(p.id AS TEXT) LIKE ? OR p.stage_name ILIKE ?)")
    params.push(pattern, pattern)
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
}

// Статус sorts as the reference's status codes do: cancelled, finished, pending (ties newest first).
const STATUS_RANK = "CASE p.status WHEN 'cancelled' THEN 0 WHEN 'finished' THEN 1 ELSE 2 END"
const PARTY_ORDERINGS: Record<string, string> = {
  id: "p.id ASC",
  "-id": "p.id DESC",
  status: `${STATUS_RANK} ASC, p.id DESC`,
  "-status": `${STATUS_RANK} DESC, p.id DESC`,
}
export const PARTY_ORDERING_KEYS: ReadonlyArray<string> = Object.keys(PARTY_ORDERINGS)

/** Every batch of the filters, newest first. */
export async function listParties(filters: PartyFilters = {}): Promise<ProductionParty[]> {
  const db = await getProductionDb()
  const { sql, params } = partyWhere(filters)
  return ((await db.prepare(`${PARTY_SELECT} ${sql} ORDER BY p.id DESC`).all(...params)) as PartyRow[]).map(toParty)
}

/** One page of the list (count + rows), sorted on the server over the whole filtered list. A page past the last one
 * answers the last page (the reference answers 404 «Неправильная страница» and shows nothing). */
export async function listPartiesPage(filters: PartyFilters, query: PartyListQuery = {}): Promise<PartyListPage> {
  const db = await getProductionDb()
  const { sql, params } = partyWhere(filters)
  const order = PARTY_ORDERINGS[query.ordering ?? ""] ?? "p.id DESC"
  const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), PARTY_PAGE_SIZE_MAX)
  const counted = (await db.prepare(`SELECT COUNT(*)::int AS n FROM production_parties p ${sql}`).get(...params)) as { n: number } | undefined
  const count = Number(counted?.n ?? 0)
  let page = Math.max(1, Math.floor(query.page ?? 1))
  if (query.focus) {
    const found = (await db
      .prepare(`SELECT x.rn FROM (SELECT p.id, ROW_NUMBER() OVER (ORDER BY ${order}) AS rn FROM production_parties p ${sql}) x WHERE x.id = ?`)
      .get(...params, query.focus)) as { rn: number | string } | undefined
    if (found) page = Math.ceil(Number(found.rn) / pageSize)
  }
  page = Math.min(page, Math.max(1, Math.ceil(count / pageSize)))
  const rows = (await db.prepare(`${PARTY_SELECT} ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize)) as PartyRow[]
  return { count, page, pageSize, results: rows.map(toParty) }
}

// ---- (end LIST) ------------------------------------------------------------------------------------------------

export async function getParty(id: number): Promise<ProductionParty | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${PARTY_SELECT} WHERE p.id = ?`).get(id)) as PartyRow | undefined
  return row ? toParty(row) : null
}

/** The catalog id of an item key ("product:145" → 145). */
const keyId = (key: string) => Number(key.slice(key.indexOf(":") + 1)) || 0

/** One line per item, ordered by item id as the reference orders a batch's totals (total_made_products /
 * total_raw_products); a made product keeps the first series its lines carry. */
function summarize(rows: Array<ProductionMovement & { series?: string }>): SummaryLine[] {
  const lines = new Map<string, SummaryLine>()
  for (const row of rows) {
    const line = lines.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, amount: 0, cost: 0, total: 0 }
    line.amount = round(line.amount + row.amount)
    line.total = round(line.total + row.total, 6)
    line.cost = line.amount ? round(line.total / line.amount, 6) : row.cost
    if (row.series !== undefined && !line.series) line.series = row.series
    lines.set(row.key, line)
  }
  return Array.from(lines.values()).sort((a, b) => keyId(a.key) - keyId(b.key) || a.key.localeCompare(b.key))
}

/** The cost of each line as the cost ledger moved it (lib/stock/costs.ts, the one cost
 * of goods): raw lines at the average they were issued at, a batch's good output at the
 * value of everything the batch consumed ÷ its good units, shift output at its recipe
 * norms × the components' averages of its day — so a later change of a raw material's
 * average (back-dated receipt, expense on an accepted supply) shows here too. Lines the
 * ledger did not move (a cancelled batch) keep the cost booked when they were added. */
export async function withLedgerCosts(db: PgDb, rows: ProductionMovement[]): Promise<ProductionMovement[]> {
  if (!rows.length) return rows
  const index = documentLineValues(await loadCostLedger(db))
  return rows.map((row) => {
    const unit = documentLineUnit(index, "production_movements", row.id, row.key)
    if (unit === undefined) return row
    const cost = round(unit, 6)
    return { ...row, cost, total: round(row.amount * cost, 6) }
  })
}

/** [product id, amount, cost (null while the batch is not finished), series display name (optional: the series /
 * expiry date the output carries, Linko's made_products[].series.display_name)]. */
type LinkoMadeLine = [productId: number | null, amount: number | null, cost: number | null, series?: string | null]

/** Linko's own figures of a batch copied from it (scripts/linko-sync/import-party-costs.mjs): its good made lines'
 * costs and its total raw cost, as Linko shows them inside the batch; null for the app's own batches. */
async function linkoPartyCosts(db: PgDb, id: number): Promise<{ totalRawCost: number | null; made: LinkoMadeLine[] } | null> {
  const table = (await db.prepare("SELECT to_regclass('public.linko_party_costs') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!table?.ok) return null
  const row = (await db.prepare("SELECT total_raw_cost, made_costs FROM linko_party_costs WHERE party_id = ?").get(id)) as
    | { total_raw_cost: number | string | null; made_costs: string | null }
    | undefined
  if (!row) return null
  let made: LinkoMadeLine[] = []
  try {
    const parsed = JSON.parse(row.made_costs || "[]") as unknown
    if (Array.isArray(parsed)) made = parsed as LinkoMadeLine[]
  } catch {
    made = []
  }
  return { totalRawCost: row.total_raw_cost === null ? null : Number(row.total_raw_cost), made }
}

/** The good made lines of a Linko batch at Linko's cost and with Linko's series (matched in order by product and
 * amount; a pending batch's cost is null there, shown as 0); every other line keeps the cost it was booked with
 * (Linko's, for a copied batch). */
function withLinkoMadeCosts(rows: ProductionMovement[], made: LinkoMadeLine[]): Array<ProductionMovement & { series?: string }> {
  const left = [...made]
  return rows.map((row) => {
    if (row.direction !== "made" || row.isDefect) return row
    const productId = Number(row.key.split(":")[1])
    const index = left.findIndex(([id, amount]) => id === productId && amount !== null && Math.abs(amount - row.amount) < 1e-9)
    if (index < 0) return row
    const [, , linkoCost, series] = left[index]
    const cost = linkoCost ?? 0
    left.splice(index, 1)
    return { ...row, cost, total: round(row.amount * cost, 6), series: typeof series === "string" ? series.trim() : "" }
  })
}

/** The URL a production line's stored photo is served from (app/api/production/movements/[id]/image). */
export const movementImageUrl = (id: number) => `/api/production/movements/${id}/image`

/** A photo stored inline (a data: URL) travels by its URL: the batch detail does not carry the picture itself, and
 * the browser can open it (a top-level data: URL is blocked). Other values (an http(s) / site path) stay. */
function withImageUrl<T extends ProductionMovement>(row: T): T {
  return row.image.startsWith("data:") ? { ...row, image: movementImageUrl(row.id) } : row
}

export async function getPartyDetail(id: number): Promise<PartyDetail | null> {
  const party = await getParty(id)
  if (!party) return null
  const db = await getProductionDb()
  // Oldest line first, as the reference lists a batch's lines.
  const booked = ((await db.prepare(`${MOVEMENT_SELECT} WHERE m.party_id = ? ORDER BY m.id`).all(id)) as MovementRow[]).map(toMovement)
  // A batch copied from Linko shows Linko's figures (its own lines as booked — the raw costs are Linko's — its made
  // lines' costs and its total raw cost); the app's own batches follow the cost ledger.
  const linko = await linkoPartyCosts(db, id)
  const valued: Array<ProductionMovement & { series?: string }> = linko ? withLinkoMadeCosts(booked, linko.made) : await withLedgerCosts(db, booked)
  const movements = valued.map(withImageUrl)
  // Like the reference, the output's cost shows once the batch is finished: "0" while it is in progress, and
  // again once it is cancelled (the stock ledger values the output all the same).
  const finished = party.status === "finished"
  const made: PartyMadeLine[] = movements
    .filter((row) => row.direction === "made" && !row.isDefect)
    .map((row) => ({ ...row, series: row.series ?? "", ...(finished ? {} : { cost: 0, total: 0 }) }))
  // Spoiled raw material (Бракованное сырье) left the warehouse, but the output is not made of it: like the
  // reference, it is listed under Брак only, never in «Затраченное сырье», «Итого» or the output's cost.
  const raw = movements.filter((row) => row.direction === "raw" && !row.isDefect)
  return {
    ...party,
    made,
    raw,
    madeDefects: movements.filter((row) => row.direction === "made" && row.isDefect),
    rawDefects: movements.filter((row) => row.direction === "raw" && row.isDefect),
    totalMade: summarize(made),
    totalRaw: summarize(raw),
    totalRawCost: linko?.totalRawCost ?? round(raw.reduce((sum, row) => sum + row.total, 0), 6),
  }
}

/** The stored photo of a production line (a raster data URL) as bytes; null without one. */
export async function getMovementImage(id: number): Promise<{ type: string; data: Buffer } | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT image FROM production_movements WHERE id = ?").get(id)) as { image: string | null } | undefined
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(row?.image ?? "")
  if (!match) return null
  return { type: `image/${match[1] === "jpg" ? "jpeg" : match[1]}`, data: Buffer.from(match[2], "base64") }
}

export type CreatePartyResult = ProductionParty | "stage_not_found"

export async function createParty(input: { stageId: number; date: string; comment: string }, userName: string): Promise<CreatePartyResult> {
  const stage = await getStage(input.stageId)
  if (!stage) return "stage_not_found"
  assertMovementDay(input.date)
  const db = await getProductionDb()
  await assertWarehouseOpen(db, stage.warehouse)
  const result = await db
    .prepare("INSERT INTO production_parties (stage_id, stage_name, warehouse, date, comment, status, user_name, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(stage.id, stage.name, stage.warehouse, input.date, input.comment, userName, nowIso())
  return (await getParty(result.lastInsertRowid))!
}

export type PartyUpdateResult = ProductionParty | "not_found" | "stage_not_found" | "stage_locked"

/** «Изменение партии» refused: the batch has lines in its warehouse and the chosen stage works in another one. */
export const STAGE_WAREHOUSE_LOCKED = "В партии уже есть товары — этап с другим складом выбрать нельзя"

// Status changes: like the reference, every status can be chosen from every other one — a finished batch can be
// reopened (В процессе) or cancelled, a cancelled one taken back into work (В процессе) or finished again. Each change
// re-checks what it does to the stock: cancelling takes the batch's output back and returns its raw (the user's rule:
// a cancel fully reverts the batch), taking a cancelled batch back books its lines again, and finishing needs good raw.

type PartyLine = {
  direction: string
  item_kind: string
  item_id: number
  item_name: string
  unit: string
  amount: number
  is_defect: number
  warehouse: string
  date: string
  in_stock: number
}

/** Whether a batch line is in the stock (lib/stock/sources.ts): like the reference, a batch's defective output
 * (Бракованный товар) never enters the warehouse, and a line copied from Linko that Linko never booked
 * (in_stock = 0) stays on the batch only. Removing or cancelling such a line moves no stock. Spoiled raw
 * (Бракованное сырье) did leave the warehouse: it is in the stock like any raw line. */
function batchLineInStock(line: { direction: string; is_defect: number | null; in_stock?: number | null }): boolean {
  if (Number(line.in_stock ?? 1) === 0) return false
  return !(line.direction === "made" && Number(line.is_defect) === 1)
}

/** Refusal of finishing a batch whose good output consumed no raw material. */
export const NO_RAW_ERROR = "В партии нет сырья — завершить ее нельзя"

/** A batch can only be finished when its good output was made from something: good
 * output without a single good raw line would bring goods in from nothing (the cost ledger
 * then takes them in at the average, never at a cost of 0). Spoiled raw (Бракованное
 * сырье) does not count: the output is not made of it. Brak-only batches carry no value
 * and may be finished. */
function assertConsumed(lines: Array<Pick<PartyLine, "direction" | "amount" | "is_defect">>) {
  const good = lines.reduce((sum, line) => sum + (line.direction === "made" && Number(line.is_defect) !== 1 ? Number(line.amount) || 0 : 0), 0)
  if (good > 0 && !lines.some((line) => line.direction === "raw" && Number(line.is_defect) !== 1)) throw new ProductionError(409, NO_RAW_ERROR)
}

async function partyLines(db: PgDb, partyId: number): Promise<PartyLine[]> {
  return (await db
    .prepare(
      "SELECT direction, item_kind, item_id, item_name, unit, amount, is_defect, warehouse, date, COALESCE(in_stock, 1) AS in_stock FROM production_movements WHERE party_id = ? ORDER BY id",
    )
    .all(partyId)) as PartyLine[]
}

/** The stock a batch's status change moves, checked inside the caller's transaction (409 when it does not fit):
 * - "undo" (cancelling it, deleting it while in progress) takes its good output back out of the warehouse and returns
 *   its raw materials (spoiled raw included: it took good units), so the output must still be there;
 * - "redo" (taking a cancelled batch back into work) books its lines again on their own days: its raw leaves the
 *   warehouse once more and must fit the stock on every day from its day on, its output comes back, and the
 *   warehouse must still be open to movements.
 * Lines outside the stock (defective output, lines Linko never booked) move nothing. */
async function ensureBatchStock(db: PgDb, lines: PartyLine[], change: "undo" | "redo", prefix: string) {
  const byWarehouse = new Map<string, { warehouse: string; needs: StockNeed[] }>()
  for (const line of lines) {
    if (!batchLineInStock(line)) continue
    const amount = Number(line.amount) || 0
    // Undo: removing output takes stock (+), returning raw gives it back (−); redo is the reverse.
    const undo = line.direction === "made" ? amount : line.direction === "raw" ? -amount : 0
    const qty = change === "undo" ? undo : -undo
    if (!qty) continue
    const group = byWarehouse.get(textKey(line.warehouse)) ?? { warehouse: line.warehouse, needs: [] }
    group.needs.push({ key: itemKey(line.item_kind, line.item_id), name: line.item_name, unit: line.unit, qty, date: line.date })
    byWarehouse.set(textKey(line.warehouse), group)
  }
  for (const group of byWarehouse.values()) {
    if (!textKey(group.warehouse)) continue
    if (change === "redo") await assertWarehouseOpen(db, group.warehouse)
    await ensureAvailable(db, group.warehouse, group.needs, prefix)
  }
}

export async function updateParty(id: number, input: { stageId: number; status: PartyStatus; comment: string; date: string }): Promise<PartyUpdateResult> {
  const stage = await getStage(input.stageId)
  await getProductionDb()
  // The items of a batch whose status changed (their products' cached cost is refreshed after the commit).
  let touched: string[] = []
  const result = await withTransaction(async (db) => {
    // Lock order (C1): a status change moves stock in every warehouse the batch's lines are in (a cancel, or taking a
    // cancelled batch back) — their stock locks (one sorted call) before the batch's row lock. Taken on every edit: the
    // batch's current status is only known under its row lock.
    await lockWarehousesOf(db, "SELECT DISTINCT warehouse FROM production_movements WHERE party_id = @id", { id })
    const current = await lockParty(db, id)
    if (!current) return "not_found" as const
    if (!stage) return "stage_not_found" as const
    const lines = await partyLines(db, id)
    const stageChanged = stage.id !== current.stageId
    // The lines moved the stock of the warehouse they were booked in. Like the reference, a batch with lines may move
    // to another stage — of the same warehouse, so that its stock stays where it is (the lines follow the stage).
    const booked = new Set([current.warehouse, ...lines.map((line) => line.warehouse)].map(textKey).filter(Boolean))
    if (stageChanged && lines.length > 0 && [...booked].some((key) => key !== textKey(stage.warehouse))) return "stage_locked" as const
    // The batch's day: a real day, not after today (it moves stock). Its lines keep the day their stock moved on,
    // so a batch with lines may change its date too, as in the reference.
    if (input.date !== current.date) assertMovementDay(input.date)
    if (input.status !== current.status) {
      if (input.status === "cancelled") await ensureBatchStock(db, lines, "undo", "Не возможно отменить. ")
      else if (current.status === "cancelled") await ensureBatchStock(db, lines, "redo", "Не возможно изменить. ")
      if (input.status === "finished") assertConsumed(lines)
      touched = lineKeys(lines)
    }
    if (stageChanged) await assertWarehouseOpen(db, stage.warehouse)
    const warehouse = stageChanged ? stage.warehouse : current.warehouse
    // Like the reference: finishing stamps the moment (kept while the batch stays finished), reopening clears it,
    // and cancelling keeps it (a finished batch that was cancelled still shows when it was finished).
    const finishedAt =
      input.status === "finished" ? (current.status === "finished" && current.finishedAt) || nowIso() : input.status === "cancelled" ? current.finishedAt : ""
    await db
      .prepare("UPDATE production_parties SET stage_id = ?, stage_name = ?, warehouse = ?, status = ?, comment = ?, date = ?, finished_at = ? WHERE id = ?")
      .run(stage.id, stage.name, warehouse, input.status, input.comment, input.date, finishedAt, id)
    // The batch's lines belong to its stage (the stage's Активность lists them).
    if (stageChanged && lines.length > 0) await db.prepare("UPDATE production_movements SET stage_id = ? WHERE party_id = ?").run(stage.id, id)
    return "ok" as const
  })
  // A cancel takes the batch out of the stock and the cost ledger, taking it back books it again; finishing and
  // reopening keep it there (both count, lib/stock/sources.ts), so the refresh then finds nothing stale.
  if (result === "ok" && touched.length) await refreshProductionCosts(touched)
  return result === "ok" ? (await getParty(id))! : result
}

/** Only batches still in progress or cancelled can be deleted (a finished one is reopened or
 * cancelled first); their movements go with them. A batch in progress already moved stock (its raw
 * lines left the warehouse, its output came in), so deleting it is the same undo as
 * cancelling it: it must leave no warehouse negative on any day (409 otherwise). A cancelled
 * batch no longer counts in the stock or the cost ledger. */
export async function deleteParty(id: number): Promise<"ok" | "not_found" | "finished"> {
  await getProductionDb()
  // A batch in progress leaves the stock with its lines: their products' cached cost is refreshed after the commit.
  let touched: string[] = []
  const result = await withTransaction(async (db) => {
    // Lock order (C1): the stock locks of every warehouse the batch touched, before the batch's row lock.
    await lockWarehousesOf(db, "SELECT DISTINCT warehouse FROM production_movements WHERE party_id = @id", { id })
    const current = await lockParty(db, id)
    if (!current) return "not_found" as const
    if (current.status === "finished") return "finished" as const
    if (current.status === "pending") {
      const lines = await partyLines(db, id)
      await ensureBatchStock(db, lines, "undo", "Не возможно удалить. ")
      touched = lineKeys(lines)
    }
    await db.prepare("DELETE FROM production_movements WHERE party_id = ?").run(id)
    await db.prepare("DELETE FROM production_parties WHERE id = ?").run(id)
    return "ok" as const
  })
  if (result === "ok") await refreshProductionCosts(touched)
  return result
}

/** The value of the batch's good raw lines goes to its GOOD output, as the
 * reference costs it (good raw ÷ good units): spoiled raw material (Бракованное
 * сырье) left the warehouse at its average but is no part of the output, and
 * defective output (brak) carries no value — exactly as the cost ledger holds it
 * (lib/net-cost-sync.ts). Σ good made value = Σ good raw value. */
async function recalcPartyCost(db: PgDb, partyId: number) {
  const totals = (await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'raw' AND is_defect <> 1 THEN amount * cost ELSE 0 END), 0) AS raw_cost,
         COALESCE(SUM(CASE WHEN direction = 'made' AND is_defect <> 1 THEN amount ELSE 0 END), 0) AS good_amount
       FROM production_movements WHERE party_id = ?`,
    )
    .get(partyId)) as { raw_cost: number; good_amount: number }
  const goodAmount = Number(totals.good_amount) || 0
  const unitCost = goodAmount > 0 ? (Number(totals.raw_cost) || 0) / goodAmount : 0
  await db
    .prepare("UPDATE production_movements SET cost = CASE WHEN is_defect = 1 THEN 0 ELSE CAST(? AS DOUBLE PRECISION) END WHERE party_id = ? AND direction = 'made'")
    .run(unitCost, partyId)
}

export type MovementItemInput = { kind: ItemKind; id: number; amount: number }
type MovementContext = {
  stageId: number | null
  partyId: number | null
  warehouse: string
  date: string
  userName: string
  shift?: string
  equipmentId?: number | null
  worker?: string
  inventoryId?: number | null
  /** The worker shift session a shift entry belongs to (production_movements.session_id, lib/production-sessions-repo.ts);
   * written only when set, so batch lines and adjustments insert as before. */
  sessionId?: number | null
}

/** The cost of a shift entry's good output and the recipe norms it was costed with
 * (per unit of output), which the cost ledger re-values it by. */
export type MadeCost = { cost: number; basis?: Array<{ key: string; amount: number }> }

/** Inserts stock movements atomically (inside the caller's transaction):
 * every item must exist (404 otherwise, nothing is inserted); raw lines and
 * negative adjustments must fit the warehouse's available stock on every day
 * from the movement day on (business rule 8; 409 otherwise); raw / adjust lines are valued at
 * the shared cost of goods of that day; good made lines get `madeCost` (or the
 * batch recalculation that follows), defective made lines 0. The cost stored here
 * is the booking-time value: the cost ledger values every line again from its own
 * averages (see withLedgerCosts). */
export async function insertMovements(
  db: PgDb,
  context: MovementContext,
  direction: "made" | "raw" | "adjust",
  items: Array<MovementItemInput & { isDefect?: boolean; comment?: string; image?: string }>,
  madeCost?: (item: CatalogItem) => Promise<MadeCost>,
  shortagePrefix = "",
): Promise<number> {
  assertMovementDay(context.date)
  await assertWarehouseOpen(db, context.warehouse)
  const lines: Array<{ input: (typeof items)[number]; item: CatalogItem }> = []
  for (const input of items) {
    if (direction === "adjust" ? !input.amount : !(input.amount > 0)) continue
    lines.push({ input, item: await requireCatalogItem(db, input.kind, input.id) })
  }
  if (!lines.length) return 0
  const takes = lines.filter(({ input }) => direction === "raw" || (direction === "adjust" && input.amount < 0))
  if (takes.length) {
    await ensureAvailable(
      db,
      context.warehouse,
      takes.map(({ input, item }) => ({ key: item.key, name: item.name, unit: item.unit, qty: Math.abs(input.amount), date: context.date })),
      shortagePrefix,
    )
  }
  const costs = direction === "made" ? null : await itemCosts(db, context.date)
  for (const { input, item } of lines) {
    // Defective output (brak) carries no value.
    const made = !costs && !input.isDefect && madeCost ? await madeCost(item) : null
    const cost = costs ? costs.get(item.key) ?? 0 : made ? made.cost : 0
    const basis = made?.basis?.length ? JSON.stringify(made.basis) : null
    const session = context.sessionId ? [context.sessionId] : []
    await db
      .prepare(
        `INSERT INTO production_movements
           (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect,
            comment, image, date, shift, equipment_id, worker, user_name, created_at, inventory_id, cost_basis${session.length ? ", session_id" : ""})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${session.length ? ", ?" : ""})`,
      )
      .run(
        context.stageId,
        context.partyId,
        context.warehouse,
        direction,
        item.kind,
        item.id,
        item.name,
        item.unit,
        input.amount,
        Number.isFinite(cost) ? cost : 0,
        input.isDefect ? 1 : 0,
        input.comment ?? "",
        input.image ?? "",
        context.date,
        context.shift ?? "",
        context.equipmentId ?? null,
        context.worker ?? "",
        context.userName,
        nowIso(),
        context.inventoryId ?? null,
        basis,
        ...session,
      )
  }
  return lines.length
}

/** Reads the batch row with a row lock, so concurrent edits of one batch
 * (double-clicked "Подтвердить", parallel adds) apply one after another. */
async function lockParty(db: PgDb, partyId: number): Promise<ProductionParty | null> {
  const row = (await db.prepare(`${PARTY_SELECT} WHERE p.id = ? FOR UPDATE OF p`).get(partyId)) as PartyRow | undefined
  return row ? toParty(row) : null
}

async function lockPendingParty(db: PgDb, partyId: number, userName: string, date?: string): Promise<MovementContext | "not_found" | "not_pending"> {
  const party = await lockParty(db, partyId)
  if (!party) return "not_found"
  if (party.status !== "pending") return "not_pending"
  return { stageId: party.stageId, partyId, warehouse: party.warehouse, date: date || party.date, userName }
}

export type MovementResult = PartyDetail | "not_found" | "not_pending" | "empty"

/** Runs a batch mutation atomically against the locked, still-pending batch
 * and returns the refreshed detail. */
async function mutatePendingParty(
  partyId: number,
  userName: string,
  date: string | undefined,
  mutate: (db: PgDb, context: MovementContext) => Promise<"ok" | "empty" | "recipe_not_found">,
): Promise<MovementResult | "recipe_not_found"> {
  await getProductionDb()
  // The items of the batch's lines once changed: their products' cached cost is refreshed after the commit.
  let touched: string[] = []
  const result = await withTransaction(async (db) => {
    // Lock order (C1): raw lines take stock — the batch warehouse's stock lock before the batch's row lock.
    await lockWarehousesOf(
      db,
      "SELECT COALESCE(NULLIF(p.warehouse, ''), s.warehouse, '') AS warehouse FROM production_parties p LEFT JOIN production_stages s ON s.id = p.stage_id WHERE p.id = @id",
      { id: partyId },
    )
    const context = await lockPendingParty(db, partyId, userName, date)
    if (typeof context === "string") return context
    const outcome = await mutate(db, context)
    if (outcome === "ok") {
      await recalcPartyCost(db, partyId)
      touched = lineKeys(await partyLines(db, partyId))
    }
    return outcome
  })
  if (result === "ok") await refreshProductionCosts(touched)
  return result === "ok" ? (await getPartyDetail(partyId))! : result
}

/** «Добавить сырье» refused: the item is no raw material of the stage's product norms. */
export const RAW_NOT_IN_NORMS = "Этого сырья нет в нормах продуктов этапа"
/** «Добавить продукт» refused: the item is not one of the stage's products. */
const MADE_NOT_ON_STAGE = "Продукт этапа не найден"
/** «Бракованное сырье» refused: the item is not one of the batch's raw lines. */
export const RAW_DEFECT_NOT_IN_BATCH = "Этого сырья нет в партии"
const QTY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
const MAX_LINE_QTY = 1e9

/** What a batch of the stage may take and put out, as the reference's batch pickers list it
 * (stock/all_balances?party=…&manufacture_type=raw|made): the raw lines of its products' norms, and its products. */
async function stageNorms(stageId: number | null): Promise<{ raw: Set<string>; made: Set<string> }> {
  const recipes = stageId ? await listRecipes(stageId) : []
  return {
    raw: new Set(recipes.flatMap((recipe) => recipe.components.filter((component) => component.role === "raw").map((component) => component.key))),
    made: new Set(recipes.map((recipe) => recipe.key)),
  }
}

/** «Добавить сырье» / «Добавить продукт». Like the reference, a batch takes only raw materials of its stage's norms and
 * puts out only its stage's products: any other item is refused (400), not only left out of the pickers. The lines
 * are booked on the batch's date unless the dialog names another day. */
export async function addPartyItems(
  partyId: number,
  direction: "made" | "raw",
  input: { date?: string; items: MovementItemInput[] },
  userName: string,
): Promise<MovementResult> {
  const result = await mutatePendingParty(partyId, userName, input.date, async (db, context) => {
    const norms = await stageNorms(context.stageId)
    const allowed = direction === "raw" ? norms.raw : norms.made
    const outside = input.items.find((item) => !allowed.has(itemKey(item.kind, item.id)))
    if (outside) throw new ProductionError(400, direction === "raw" ? RAW_NOT_IN_NORMS : MADE_NOT_ON_STAGE, { key: itemKey(outside.kind, outside.id) })
    return (await insertMovements(db, context, direction, input.items)) ? "ok" : "empty"
  })
  return result === "recipe_not_found" ? "empty" : result
}

/** «Добавить бракованный товар». Like the reference, spoiled raw (Бракованное сырье) is one of the batch's own raw
 * materials (one of its raw lines; 400 otherwise); a defective product may be any product. */
export async function addPartyDefect(
  partyId: number,
  input: { type: "made" | "raw"; kind: ItemKind; id: number; amount: number; comment: string; image: string; date?: string },
  userName: string,
): Promise<MovementResult> {
  const result = await mutatePendingParty(partyId, userName, input.date, async (db, context) => {
    if (input.type === "raw") {
      const used = await db
        .prepare("SELECT 1 AS ok FROM production_movements WHERE party_id = ? AND direction = 'raw' AND is_defect <> 1 AND item_kind = ? AND item_id = ? LIMIT 1")
        .get(partyId, input.kind, input.id)
      if (!used) throw new ProductionError(400, RAW_DEFECT_NOT_IN_BATCH, { field: "key" })
    }
    const inserted = await insertMovements(db, context, input.type, [
      { kind: input.kind, id: input.id, amount: input.amount, isDefect: true, comment: input.comment, image: input.image },
    ])
    return inserted ? "ok" : "empty"
  })
  return result === "recipe_not_found" ? "empty" : result
}

/** The raw materials an auto-finish consumes, worked out from the norm as the reference does: each raw line × the
 * amount made ÷ the norm's own quantity (the same item twice = one line). The norm's ready lines (what it puts out,
 * by-products included) are neither consumed nor produced. */
export function autoFinishComponents(recipe: Pick<ProductionRecipe, "amount" | "components">, amount: number): MovementItemInput[] {
  const lines = new Map<string, MovementItemInput>()
  for (const component of recipe.components) {
    if (component.role !== "raw") continue
    const line = lines.get(component.key) ?? { kind: component.kind, id: component.itemId, amount: 0 }
    line.amount += (component.amount * amount) / (recipe.amount > 0 ? recipe.amount : 1)
    lines.set(component.key, line)
  }
  return [...lines.values()].map((line) => ({ ...line, amount: round(line.amount, 6) }))
}

/** "Автодобавление": records the product made plus the raw materials its norm consumes for that amount, and closes
 * the batch, like the reference's party auto_finish (which takes only the product and the amount: the consumption
 * comes from the norm, never from the client). Like finishing by hand, it needs at least one good raw line in the
 * batch (409 otherwise). */
export async function autoFinishParty(
  partyId: number,
  input: { recipeId: number; amount: number; comment: string },
  userName: string,
): Promise<MovementResult | "recipe_not_found"> {
  const comment = input.comment.trim()
  return mutatePendingParty(partyId, userName, undefined, async (db, context) => {
    // Read under the batch's lock, in the same transaction as the lines it books.
    const recipe = await getRecipe(input.recipeId)
    if (!recipe || recipe.stageId !== context.stageId) return "recipe_not_found"
    const components = autoFinishComponents(recipe, input.amount)
    if (components.some((line) => line.amount > MAX_LINE_QTY)) throw new ProductionError(400, QTY_ERROR)
    await insertMovements(db, context, "raw", components)
    await insertMovements(db, context, "made", [{ kind: recipe.kind, id: recipe.itemId, amount: input.amount, comment }])
    assertConsumed(await partyLines(db, partyId))
    await db.prepare("UPDATE production_parties SET status = 'finished', finished_at = ? WHERE id = ?").run(nowIso(), partyId)
    // The note is kept on the made line; it also becomes the batch comment
    // when the batch has none yet.
    if (comment) await db.prepare("UPDATE production_parties SET comment = ? WHERE id = ? AND comment = ''").run(comment, partyId)
    return "ok"
  })
}

type DeletableLine = PartyLine & { party_id: number | null }

const DELETABLE_LINE_SELECT =
  "SELECT party_id, direction, item_kind, item_id, item_name, unit, amount, is_defect, warehouse, date, COALESCE(in_stock, 1) AS in_stock FROM production_movements WHERE id = ?"

/** Removing a batch's output takes it out of the warehouse — unless the line never entered the stock (defective
 * output, a line Linko never booked). */
const removalTakesStock = (row: DeletableLine) => row.direction === "made" && batchLineInStock(row)

/** Deletes one line of a running batch. Only batch lines: a shift entry (no batch) is deleted through
 * lib/production-activity-repo.ts deleteActivityEntry, which also guards a handed-over session — here it is
 * "not_found", as a batch line is there. Inventory adjustments belong to their inventory and cannot be deleted
 * alone; removing output requires it to be still in the warehouse. A line that is gone once its locks are held
 * (a parallel delete of the same line got them first) is "not_found". */
export async function deleteMovement(id: number): Promise<"ok" | "not_found" | "not_pending"> {
  await getProductionDb()
  for (let attempt = 0; attempt < 3; attempt++) {
    // The items whose products' cached cost is refreshed after the commit: the batch's lines and the deleted one.
    let touched: string[] = []
    const result = await withTransaction(async (db) => {
      // Read without a lock first, to know the locks to take.
      const peek = (await db.prepare(DELETABLE_LINE_SELECT).get(id)) as DeletableLine | undefined
      if (!peek) return "not_found" as const
      if (peek.direction === "adjust") throw new ProductionError(409, "Строка относится к инвентаризации — удалить ее нельзя")
      if (!peek.party_id) return "not_found" as const
      const takesStock = removalTakesStock(peek)
      // Lock order (C1): removing output takes stock — the warehouse's stock lock before the batch's row lock.
      if (takesStock) await lockWarehouseStock(db, [peek.warehouse])
      const party = await lockParty(db, peek.party_id)
      if (party && party.status !== "pending") return "not_pending" as const
      // Read again under those locks (and lock the line): a parallel delete of the same line may have removed it while
      // this one waited for them — then nothing is left to delete or to check the stock for.
      const row = (await db.prepare(`${DELETABLE_LINE_SELECT} FOR UPDATE`).get(id)) as DeletableLine | undefined
      if (!row || !row.party_id) return "not_found" as const
      // Its warehouse was renamed between the two reads (the stock lock taken is the old name's): start again.
      if (row.party_id !== peek.party_id || (takesStock && textKey(row.warehouse) !== textKey(peek.warehouse))) return "moved" as const
      if (takesStock && textKey(row.warehouse)) {
        await ensureAvailable(
          db,
          row.warehouse,
          [{ key: itemKey(row.item_kind, row.item_id), name: row.item_name, unit: row.unit, qty: Number(row.amount) || 0, date: row.date }],
          "Не возможно удалить. ",
        )
      }
      await db.prepare("DELETE FROM production_movements WHERE id = ?").run(id)
      await recalcPartyCost(db, row.party_id)
      touched = lineKeys(await partyLines(db, row.party_id))
      touched.push(itemKey(row.item_kind, row.item_id))
      return "ok" as const
    })
    if (result === "moved") continue
    if (result === "ok") await refreshProductionCosts(touched)
    return result
  }
  throw new ProductionError(503, "Не удалось выполнить запрос")
}

// ---- products.cost after production bookings --------------------------------------------------------------------

/** The item keys of production lines ("product:12", "raw_material:3"). */
function lineKeys(lines: Array<Pick<PartyLine, "item_kind" | "item_id">>): string[] {
  return lines.map((line) => itemKey(line.item_kind, line.item_id))
}

/** products.cost is only a cache of the cost of goods (lib/stock/costs.ts). A production booking (a batch's line added
 * or removed, a batch cancelled, taken back or deleted, a shift entry) changes the cost of the items it moves and of
 * everything made from them, at any depth (lib/net-cost-sync.ts productionDependents). After the booking committed,
 * this brings the cache of those products to the ledger the way the supplies and the Себестоимость entries refresh
 * theirs: in a transaction of its own, where refreshProductCostCache locks and re-checks each row; only the rows that
 * are stale are locked. A failure is logged, never raised: the ledger stays the source, and the readers that overlay
 * it (GET /api/products, Остаток, the batch detail) are right meanwhile. Call it after the transaction, never inside
 * one. */
export async function refreshProductionCosts(itemKeys: Iterable<string>): Promise<void> {
  const seeds = [...new Set([...itemKeys].filter((key) => /^(product|raw_material):[1-9]\d{0,9}$/.test(key)))]
  if (!seeds.length) return
  try {
    const db = getDb()
    const ids = (await productionDependents(db, seeds))
      .map((key) => /^product:([1-9]\d{0,9})$/.exec(key))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => Number(match[1]))
      .filter((id) => id <= 2_147_483_647)
    if (!ids.length) return
    // The ledger of the committed state, built here on the pool (and cached): the refresh's transaction and the next
    // reader (the batch detail answered right after) reuse it instead of building it again on their own connection.
    const ledger = await loadCostLedger(db)
    const today = todayIso()
    const rows = (await db
      .prepare("SELECT id, cost, initial_cost FROM products WHERE id = ANY(@ids::int[]) AND COALESCE(deleted, 0) = 0")
      .all({ ids })) as Array<{ id: number; cost: number | null; initial_cost: number | null }>
    // Only the rows whose cache differs from the value refreshProductCostCache writes (lib/stock/costs.ts, one rule).
    const stale = rows
      .filter((row) => {
        const cost = cachedProductCost(ledger, row, today)
        return Number.isFinite(cost) && cost !== Number(row.cost)
      })
      .map((row) => Number(row.id))
    if (stale.length) await withTransaction((tx) => refreshProductCostCache(tx, stale))
  } catch (error) {
    console.error("[production] products.cost refresh failed", error)
  }
}
