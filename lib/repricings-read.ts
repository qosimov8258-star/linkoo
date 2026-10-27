import "server-only"

import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"
import { getDb, outsideTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { convertAmount, normCurrency } from "@/lib/finance/currency"
import type { ItemPriceEntry } from "@/lib/item-prices"
import { ensurePriceListsSchema } from "@/lib/price-lists-repo"
import { itemNames } from "@/lib/repricings-items"
import type {
  Repricing,
  RepricingDetail,
  RepricingItemKind,
  RepricingLine,
  RepricingListResult,
  RepricingOptions,
  RepricingSource,
  RepricingStatus,
} from "@/components/analytics/repricing-data"

// Schema, row mapping and reads of "Переоценка" (writes: lib/repricings-repo.ts, which re-exports
// these for the routes). Storage: the original repricings table (one product per row, written by a
// supply's "Наценка") extended with items (JSON lines with the previous price entry), comment,
// totals, source, parent_id and the cancel / recalc stamps.

export const STATUS_DB: Record<RepricingStatus, string> = { finished: "проведен", canceled: "отменен" }
export const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

export class RepricingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: { conflicts?: number[]; missing?: string[]; currency?: string } = {},
  ) {
    super(message)
  }
}

export function repricingErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof RepricingError) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
  if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 })
  return dbErrorResponse(error)
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

declare global {
  var __linkoRepricingsSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  await ensurePriceListsSchema()
  await getDb().exec(`ALTER TABLE repricings
    ADD COLUMN IF NOT EXISTS items TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS total DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_old DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_new DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS parent_id INTEGER,
    ADD COLUMN IF NOT EXISTS canceled_at TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS canceled_by TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS recalculated_at TEXT NOT NULL DEFAULT ''`)
}

export function ensureRepricingsSchema(): Promise<void> {
  if (globalThis.__linkoRepricingsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoRepricingsSchema = undefined
      throw error
    })
    globalThis.__linkoRepricingsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoRepricingsSchema!.ready
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Line as stored in repricings.items. */
export type StoredLine = {
  kind: RepricingItemKind
  id: number
  key: string
  name: string
  /** = name: lets the product rename cascade / delete check (lib/catalog-refs.ts, JSON "items" with
   * element field "product") see the line; readers resolve the current name by id anyway. */
  product: string
  unit: string
  amount: number
  oldPrice: number | null
  oldCurrency: string
  /** Units of the document currency per 1 unit of oldCurrency when the line was saved (1 = same
   * currency; null = no rate then). Absent on lines saved before it was kept: the current rates. */
  oldRate?: number | null
  /** In the document currency (= the price list's currency for documents saved now). */
  price: number
  /** Entry of the price list before this repricing (null = there was none). Absent on legacy lines. */
  oldEntry?: ItemPriceEntry | null
  legacy?: boolean
}

export type Row = {
  id: number
  created_by: string | null
  user: string | null
  created_iso: string | null
  price_list_id: number | null
  price_list_name: string | null
  product_id: number | null
  product_name: string | null
  product_unit: string | null
  amount: number | null
  currency: string | null
  status: string | null
  items: string | null
  comment: string | null
  total: number | null
  total_old: number | null
  total_new: number | null
  source: string | null
  parent_id: number | null
  canceled_iso: string | null
  canceled_by: string | null
  recalculated_iso: string | null
  line_count: number | null
}

const iso = (column: string) => `to_char(fin_ts(NULLIF(${column}, ''), true), 'YYYY-MM-DD"T"HH24:MI:SS')`

const SELECT = `SELECT r.id, r.created_by, r."user", ${iso("r.created_at")} AS created_iso, r.price_list_id, pl.name AS price_list_name,
  r.product_id, p.name AS product_name, p.unit AS product_unit, r.amount, r.currency, r.status, r.items, r.comment,
  r.total, r.total_old, r.total_new, r.source, r.parent_id, ${iso("r.canceled_at")} AS canceled_iso, r.canceled_by,
  ${iso("r.recalculated_at")} AS recalculated_iso,
  CASE WHEN r.items LIKE '[%' AND r.items <> '[]' THEN jsonb_array_length(r.items::jsonb) WHEN r.product_id IS NOT NULL THEN 1 ELSE 0 END AS line_count
  FROM repricings r
  LEFT JOIN price_lists pl ON pl.id = r.price_list_id
  LEFT JOIN products p ON p.id = r.product_id`

export const statusOf = (value: string | null): RepricingStatus => (value === STATUS_DB.canceled ? "canceled" : "finished")

function sourceOf(row: Row): RepricingSource {
  if (row.source === "manual" || row.source === "connected" || row.source === "supplier_incoming") return row.source
  return isLegacy(row) ? "supplier_incoming" : "manual"
}

function isLegacy(row: Row): boolean {
  return (!row.items || row.items === "[]") && row.product_id !== null
}

export function parseLines(row: Row): StoredLine[] {
  if (isLegacy(row)) {
    return [
      {
        kind: "product",
        id: Number(row.product_id),
        key: `product:${row.product_id}`,
        name: row.product_name ?? "",
        product: row.product_name ?? "",
        unit: row.product_unit ?? "",
        amount: 0,
        oldPrice: null,
        oldCurrency: normCurrency(row.currency),
        price: Number(row.amount) || 0,
        legacy: true,
      },
    ]
  }
  try {
    const parsed = JSON.parse(row.items || "[]") as unknown
    return Array.isArray(parsed) ? (parsed as StoredLine[]).filter((line) => line && typeof line === "object" && line.key) : []
  } catch {
    return []
  }
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  const result = Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
  return Object.is(result, -0) ? 0 : result
}

/** Rates of the currencies table: units of base per 1 unit (base = 1; null = unknown). */
export type RateMap = Record<string, number | null | undefined>

/**
 * Factor that puts a line's old price (oldCurrency) into the document currency: the rate kept when
 * the line was saved (null kept = there was no rate: unknown), 1 for the same currency, else (a line
 * saved before the rate was kept) the current rates; null = unknown.
 */
function oldPriceFactor(line: StoredLine, currency: string, rates?: RateMap): number | null {
  if (typeof line.oldRate === "number" && Number.isFinite(line.oldRate) && line.oldRate > 0) return line.oldRate
  const from = normCurrency(line.oldCurrency, currency)
  if (from === currency) return 1
  if (line.oldRate === null) return null
  return rates ? convertAmount(1, from, currency, rates) : null
}

/**
 * True when a line's old price is in another currency and the line was saved before the rate was
 * kept (lines of documents saved before currencies were checked): the current rates are needed, and
 * the totals stored on such a document may mix currencies (they are recomputed on read).
 */
function needsRates(lines: StoredLine[], currency: string): boolean {
  return lines.some((line) => line.oldPrice !== null && line.oldPrice !== undefined && line.oldRate === undefined && normCurrency(line.oldCurrency, currency) !== currency)
}

/** Current rates, loaded only when a line needs them. */
export async function ratesFor(db: PgDb, lines: StoredLine[], currency: string): Promise<RateMap | undefined> {
  return needsRates(lines, currency) ? (await loadCurrencyContext(db)).rates : undefined
}

/**
 * "Сумма до" / "Сумма после" / "Разница" of a line, all in the DOCUMENT currency: the old price is
 * converted from its own currency (an entry may be kept in another currency than its list); when
 * that is impossible (no rate) or the old price is unknown, the line counts as unchanged.
 */
function lineTotals(line: StoredLine, currency: string, rates?: RateMap): { totalOld: number; totalNew: number; diff: number } {
  const totalNew = round(line.price * line.amount)
  const factor = line.oldPrice === null || line.oldPrice === undefined ? null : oldPriceFactor(line, currency, rates)
  const totalOld = factor === null ? totalNew : round(Number(line.oldPrice) * factor * line.amount)
  return { totalOld, totalNew, diff: round(totalNew - totalOld) }
}

/** Σ over the lines in the document currency `currency` (see lineTotals). */
export function docTotals(lines: StoredLine[], currency: string, rates?: RateMap): { total: number; totalOld: number; totalNew: number } {
  const code = normCurrency(currency)
  let totalOld = 0
  let totalNew = 0
  for (const line of lines) {
    const totals = lineTotals(line, code, rates)
    totalOld += totals.totalOld
    totalNew += totals.totalNew
  }
  return { total: round(totalNew - totalOld), totalOld: round(totalOld), totalNew: round(totalNew) }
}

type Totals = { total: number; totalOld: number; totalNew: number }

/**
 * Totals of a document saved before currencies were checked whose old prices are in another
 * currency (its stored "Сумма переоценки" mixes currencies): recomputed in the document currency
 * with the current rates, like its lines (detailOf) and "Перерасчет по текущей дате". null = the
 * stored totals are right (every other document).
 */
function staleTotals(row: Row, rates: RateMap | undefined): Totals | null {
  const lines = parseLines(row)
  const currency = normCurrency(row.currency)
  return needsRates(lines, currency) ? docTotals(lines, currency, rates) : null
}

/** Current rates when one of the rows has stale totals (see staleTotals), else undefined. */
async function ratesForRows(db: PgDb, rows: Row[]): Promise<RateMap | undefined> {
  return rows.some((row) => needsRates(parseLines(row), normCurrency(row.currency))) ? (await loadCurrencyContext(db)).rates : undefined
}

function rowToRepricing(row: Row, totals: Totals | null = null): Repricing {
  return {
    id: Number(row.id),
    createdBy: row.created_by || row.user || "",
    createdAt: row.created_iso ?? "",
    priceListId: row.price_list_id === null ? null : Number(row.price_list_id),
    priceList: row.price_list_name ?? "",
    currency: normCurrency(row.currency),
    comment: row.comment ?? "",
    status: statusOf(row.status),
    total: totals ? totals.total : Number(row.total) || 0,
    totalOld: totals ? totals.totalOld : Number(row.total_old) || 0,
    totalNew: totals ? totals.totalNew : Number(row.total_new) || 0,
    lineCount: Number(row.line_count) || 0,
    source: sourceOf(row),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    canceledAt: row.canceled_iso ?? "",
    canceledBy: row.canceled_by ?? "",
    recalculatedAt: row.recalculated_iso ?? "",
  }
}

export async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  if (lock) await db.prepare("SELECT id FROM repricings WHERE id = ? FOR UPDATE").get(id)
  return (await db.prepare(`${SELECT} WHERE r.id = ?`).get(id)) as Row | undefined
}

export async function detailOf(db: PgDb, row: Row): Promise<RepricingDetail> {
  const stored = parseLines(row)
  const currency = normCurrency(row.currency)
  const names = await itemNames(db, stored.map((line) => line.key))
  const rates = await ratesFor(db, stored, currency)
  const lines: RepricingLine[] = stored.map((line) => ({
    kind: line.kind,
    id: Number(line.id),
    key: line.key,
    name: names.get(line.key)?.name ?? line.name,
    unit: names.get(line.key)?.unit ?? line.unit,
    amount: Number(line.amount) || 0,
    oldPrice: line.oldPrice === null || line.oldPrice === undefined ? null : Number(line.oldPrice),
    oldCurrency: normCurrency(line.oldCurrency, currency),
    price: Number(line.price) || 0,
    ...lineTotals(line, currency, rates),
  }))
  const children = (await db.prepare("SELECT id FROM repricings WHERE parent_id = ? ORDER BY id").all(row.id)) as Array<{ id: number }>
  // The header's sums are Σ of these lines (a document saved before currencies were checked keeps
  // mixed totals in the table until "Перерасчет").
  return { ...rowToRepricing(row, staleTotals(row, rates)), lines, children: children.map((child) => Number(child.id)) }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type RepricingListQuery = {
  search: string
  ordering: string
  page: number
  /** 0 = all (Excel). */
  pageSize: number
  priceLists: number[]
  users: string[]
  status: RepricingStatus | ""
  products: string[]
}

const ORDER_COLUMNS: Record<string, string> = { id: "r.id", created_date: "fin_ts(NULLIF(r.created_at, ''), true)", total: "r.total" }
export const REPRICING_SORT_KEYS = Object.keys(ORDER_COLUMNS)

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const column = ORDER_COLUMNS[desc ? ordering.slice(1) : ordering]
  if (!column) return "r.id DESC"
  return `${column} ${desc ? "DESC" : "ASC"} NULLS LAST, r.id ${desc ? "DESC" : "ASC"}`
}

/** Demo GET main/reprice/?price_list&product&user&status&search&page&page_size&ordering. */
export async function listRepricingsPage(query: RepricingListQuery): Promise<RepricingListResult> {
  await ensureRepricingsSchema()
  const db = getDb()
  const where = `WHERE (@search = '' OR r.id::text = @search OR strpos(lower(concat_ws(' ', pl.name, r.created_by, r.comment)), @search) > 0)
    AND (cardinality(@priceLists::int[]) = 0 OR r.price_list_id = ANY(@priceLists::int[]))
    AND (cardinality(@users::text[]) = 0 OR COALESCE(NULLIF(r.created_by, ''), r."user") = ANY(@users::text[]))
    AND (@status = '' OR (@status = 'canceled') = (r.status = '${STATUS_DB.canceled}'))
    AND (cardinality(@products::text[]) = 0 OR ('product:' || r.product_id) = ANY(@products::text[])
         OR (r.items LIKE '[%' AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.items::jsonb) e WHERE e->>'key' = ANY(@products::text[]))))`
  const params = { search: query.search.trim().toLowerCase(), priceLists: query.priceLists, users: query.users, status: query.status, products: query.products }
  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM repricings r LEFT JOIN price_lists pl ON pl.id = r.price_list_id ${where}`).get(params)) as
    | { n: string | number }
    | undefined
  const paging = query.pageSize > 0 ? " LIMIT @limit OFFSET @offset" : ""
  const rows = (await db
    .prepare(`${SELECT} ${where} ORDER BY ${orderBy(query.ordering)}${paging}`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  const rates = await ratesForRows(db, rows)
  return { count: Number(count?.n ?? 0), results: rows.map((row) => rowToRepricing(row, staleTotals(row, rates))) }
}

/** Plain array (the original GET /api/repricings shape: newest first). */
export async function listRepricings(): Promise<Repricing[]> {
  return (await listRepricingsPage({ search: "", ordering: "", page: 1, pageSize: 0, priceLists: [], users: [], status: "", products: [] })).results
}

export async function getRepricing(id: number): Promise<RepricingDetail | null> {
  await ensureRepricingsSchema()
  const db = getDb()
  const row = await readRow(db, id)
  return row ? detailOf(db, row) : null
}

/** Filter options: price lists, creators and the items that appear in repricings. */
export async function repricingOptions(): Promise<RepricingOptions> {
  await ensureRepricingsSchema()
  const db = getDb()
  const lists = (await db
    .prepare(
      `SELECT p.id, p.name, p.currency, COALESCE(p.is_active, 1) AS is_active, p.linked_list,
         (SELECT COUNT(*) FROM price_lists d WHERE d.id <> p.id AND fin_key(d.linked_list) = fin_key(p.name)) AS dependents
         FROM price_lists p ORDER BY COALESCE(p.position, 0), p.id`,
    )
    .all()) as Array<{ id: number; name: string; currency: string | null; is_active: number; linked_list: string | null; dependents: string | number }>
  const users = (await db
    .prepare(`SELECT DISTINCT COALESCE(NULLIF(created_by, ''), "user") AS name FROM repricings WHERE COALESCE(NULLIF(created_by, ''), "user") <> '' ORDER BY 1`)
    .all()) as Array<{ name: string }>
  const keys = (await db
    .prepare(
      `SELECT DISTINCT key FROM (
         SELECT e->>'key' AS key FROM repricings r, jsonb_array_elements(CASE WHEN r.items LIKE '[%' THEN r.items::jsonb ELSE '[]'::jsonb END) e
         UNION SELECT 'product:' || product_id FROM repricings WHERE product_id IS NOT NULL
       ) k WHERE key IS NOT NULL`,
    )
    .all()) as Array<{ key: string }>
  const names = await itemNames(db, keys.map((row) => row.key))
  return {
    priceLists: lists.map((list) => ({
      id: Number(list.id),
      name: list.name,
      currency: normCurrency(list.currency),
      isActive: Number(list.is_active) === 1,
      linked: !!list.linked_list && list.linked_list.trim() !== "" && list.linked_list !== "Не указано",
      dependents: Number(list.dependents) || 0,
    })),
    users: users.map((row) => row.name),
    products: [...names].map(([key, value]) => ({ key, name: value.name })).sort((a, b) => a.name.localeCompare(b.name, "ru")),
  }
}
