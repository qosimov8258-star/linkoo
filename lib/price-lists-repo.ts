import "server-only"

import { NextResponse } from "next/server"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { priceListKey } from "@/lib/item-prices"
import { cascadePriceListRename, priceListUsage, type PriceListRenameChange } from "@/lib/price-lists-refs"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  PRICE_LIST_CALC_METHODS,
  calcMethodById,
  type PriceList,
  type PriceListListResult,
  type PriceListMethodValue,
  type PriceListUsage,
} from "@/components/analytics/price-lists-data"

// "Прайс-листы" (demo #/price-list-setting, API sales/price_list/). Item prices live on the items
// (lib/item-prices.ts); this module keeps the price-list rows:
//   name (unique by fin_key, because documents and item prices store the NAME), currency,
//   position ("Порядок"), is_active, is_default_for_order (one list at most), and the link
//   "Связать прайс-лист": linked_list = NAME of the connected list ('Не указано' / '' = none),
//   calc_method = method id of PRICE_LIST_CALC_METHODS, method_values = [{methodKey, value}].
// A rename is carried over in one transaction (lib/price-lists-refs.ts); a delete is refused (409)
// while anything uses the list. GET /api/price-lists (plain) keeps its array shape for the pickers.
// The currency must be one of the currencies table (400 "Валюта не найдена"; an edited list keeps
// its stored currency when the body repeats it).

const NONE = "Не указано"
const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

export class PriceListError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
    readonly usage?: PriceListUsage[],
  ) {
    super(message)
  }
}

export function priceListErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PriceListError)) return null
  return NextResponse.json(
    { error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.usage ? { usage: error.usage } : {}) },
    { status: error.status },
  )
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

declare global {
  var __linkoPriceListsSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  await ensureStockSchema() // fin_key / fin_ts
  await getDb().exec(`ALTER TABLE price_lists
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_default_for_order INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS method_values TEXT NOT NULL DEFAULT '[]'`)
}

export function ensurePriceListsSchema(): Promise<void> {
  if (globalThis.__linkoPriceListsSchema?.version !== SCHEMA_VERSION) {
    const ready = install().catch((error) => {
      globalThis.__linkoPriceListsSchema = undefined
      throw error
    })
    globalThis.__linkoPriceListsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoPriceListsSchema!.ready
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Row = {
  id: number
  name: string
  currency: string | null
  linked_list: string | null
  calc_method: string | null
  method_values: string | null
  position: number | null
  is_active: number | null
  is_default_for_order: number | null
  created_iso: string | null
  linked_id: number | null
  linked_name: string | null
}

const SELECT = `SELECT p.id, p.name, p.currency, p.linked_list, p.calc_method, p.method_values, p.position, p.is_active, p.is_default_for_order,
  to_char(fin_ts(NULLIF(p.created_at, ''), true), 'YYYY-MM-DD"T"HH24:MI:SS') AS created_iso,
  l.id AS linked_id, l.name AS linked_name
  FROM price_lists p
  LEFT JOIN LATERAL (
    SELECT x.id, x.name FROM price_lists x
     WHERE x.id <> p.id AND COALESCE(p.linked_list, '') NOT IN ('', '${NONE}') AND fin_key(x.name) = fin_key(p.linked_list)
     ORDER BY x.id LIMIT 1
  ) l ON TRUE`

export function isNoLink(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim()
  return !text || text === NONE
}

/** Stored calc_method → method id ('' = none); older rows may hold the method name. */
export function storedMethodId(value: string | null | undefined): string {
  const text = String(value ?? "").trim()
  if (!text || text === NONE) return ""
  return (calcMethodById(text) ?? PRICE_LIST_CALC_METHODS.find((method) => method.name === text))?.id ?? ""
}

export function parseMethodValues(text: string | null | undefined): PriceListMethodValue[] {
  try {
    const parsed = JSON.parse(text || "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({ methodKey: String((item as { methodKey?: unknown }).methodKey ?? ""), value: Number((item as { value?: unknown }).value) || 0 }))
      .filter((item) => item.methodKey)
  } catch {
    return []
  }
}

function dateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return ""
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
}

function rowToPriceList(row: Row): PriceList {
  const methodId = storedMethodId(row.calc_method)
  const method = calcMethodById(methodId)
  const linked = !isNoLink(row.linked_list)
  return {
    id: Number(row.id),
    name: row.name,
    currency: normCurrency(row.currency),
    createdDate: dateLabel(row.created_iso ?? ""),
    createdAt: row.created_iso ?? "",
    linkedList: linked ? (row.linked_name ?? row.linked_list ?? NONE) : NONE,
    calcMethod: method?.name ?? NONE,
    position: Number(row.position) || 0,
    isActive: row.is_active === null ? true : Number(row.is_active) === 1,
    isDefaultForOrder: Number(row.is_default_for_order) === 1,
    connectedPriceList: linked && row.linked_id !== null ? { id: Number(row.linked_id), name: row.linked_name ?? "" } : null,
    calcMethodId: methodId,
    methodValues: method ? parseMethodValues(row.method_values) : [],
  }
}

export type PriceListActive = "true" | "false" | "all"

function activeCondition(active: PriceListActive): string {
  if (active === "true") return "COALESCE(p.is_active, 1) = 1"
  if (active === "false") return "COALESCE(p.is_active, 1) <> 1"
  return "TRUE"
}

/** Plain list (pickers of other pages): active lists by default, ordered by position. */
export async function listPriceLists(options: { active?: PriceListActive } = {}): Promise<PriceList[]> {
  await ensurePriceListsSchema()
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE ${activeCondition(options.active ?? "true")} ORDER BY COALESCE(p.position, 0), p.id`)
    .all()) as Row[]
  return rows.map(rowToPriceList)
}

export type PriceListListQuery = { search: string; page: number; pageSize: number; ordering: string; active: PriceListActive }

const ORDER_COLUMNS: Record<string, string> = {
  id: "p.id",
  name: "lower(p.name)",
  position: "COALESCE(p.position, 0)",
  created_date: "fin_ts(NULLIF(p.created_at, ''), true)",
  currency: "p.currency",
}
export const PRICE_LIST_SORT_KEYS = Object.keys(ORDER_COLUMNS)

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const column = ORDER_COLUMNS[desc ? ordering.slice(1) : ordering]
  if (!column) return "COALESCE(p.position, 0), p.id"
  return `${column} ${desc ? "DESC" : "ASC"} NULLS LAST, p.id ${desc ? "DESC" : "ASC"}`
}

/** Grid of the page (demo GET sales/price_list/?search&page&page_size&ordering). pageSize 0 = all. */
export async function listPriceListsPage(query: PriceListListQuery): Promise<PriceListListResult> {
  await ensurePriceListsSchema()
  const db = getDb()
  const needle = query.search.trim().toLowerCase()
  const where = `WHERE ${activeCondition(query.active)} AND (@needle = '' OR strpos(lower(p.name), @needle) > 0 OR p.id::text = @needle)`
  const count = (await db.prepare(`SELECT COUNT(*) AS n FROM price_lists p ${where}`).get({ needle })) as { n: string | number } | undefined
  const paging = query.pageSize > 0 ? " LIMIT @limit OFFSET @offset" : ""
  const rows = (await db
    .prepare(`${SELECT} ${where} ORDER BY ${orderBy(query.ordering)}${paging}`)
    .all({ needle, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: Number(count?.n ?? 0), results: rows.map(rowToPriceList) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  if (lock) await db.prepare("SELECT id FROM price_lists WHERE id = ? FOR UPDATE").get(id)
  return (await db.prepare(`${SELECT} WHERE p.id = ?`).get(id)) as Row | undefined
}

export async function getPriceList(id: number, withUsage = false): Promise<(PriceList & { usage?: PriceListUsage[] }) | null> {
  await ensurePriceListsSchema()
  const db = getDb()
  const row = await readRow(db, id)
  if (!row) return null
  const priceList = rowToPriceList(row)
  return withUsage ? { ...priceList, usage: await priceListUsage(db, { id: priceList.id, name: priceList.name }) } : priceList
}

/** Price lists by id (repricing / grid helpers); missing ids are skipped. */
export async function priceListsByIds(db: PgDb, ids: number[]): Promise<PriceList[]> {
  if (!ids.length) return []
  await ensurePriceListsSchema()
  const rows = (await db.prepare(`${SELECT} WHERE p.id = ANY(?::int[])`).all(ids)) as Row[]
  return rows.map(rowToPriceList)
}

/** Lists whose "Связанный прайс лист" is `name` (fin_key). */
export async function dependentPriceLists(db: PgDb, name: string): Promise<PriceList[]> {
  await ensurePriceListsSchema()
  const rows = (await db.prepare(`${SELECT} WHERE fin_key(p.linked_list) = fin_key(?) ORDER BY COALESCE(p.position, 0), p.id`).all(name)) as Row[]
  return rows.map(rowToPriceList)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type PriceListInput = {
  name: string
  currency?: string
  position?: number
  isActive?: boolean
  isDefaultForOrder?: boolean
  /** undefined = keep; null = unlink. */
  connectedPriceListId?: number | null
  /** Older body: the connected list by NAME ("Не указано" = none). */
  linkedList?: string
  calcMethodId?: string | null
  methodValues?: PriceListMethodValue[]
}

async function lockPriceLists(db: PgDb) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:price-lists'))").get()
}

async function assertNameAvailable(db: PgDb, name: string, exceptId: number | null) {
  const duplicate = (await db
    .prepare("SELECT id FROM price_lists WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId })) as { id: number } | undefined
  if (duplicate) throw new PriceListError("Прайс-лист с таким наименованием уже существует", 400, { name: "Прайс-лист с таким наименованием уже существует" })
}

type Stored = { name: string; currency: string; position: number; is_active: number; is_default_for_order: number; linked_list: string; calc_method: string; method_values: string }

/** Resolves the link: the connected list must exist, differ from the list and not lead back to it. */
async function resolveLink(db: PgDb, selfId: number | null, selfName: string, input: PriceListInput, current: Row | null): Promise<{ linked: string; linkedId: number | null }> {
  let target: { id: number; name: string } | null = null
  if (input.connectedPriceListId !== undefined) {
    if (input.connectedPriceListId === null) return { linked: NONE, linkedId: null }
    target = ((await db.prepare("SELECT id, name FROM price_lists WHERE id = ?").get(input.connectedPriceListId)) as { id: number; name: string } | undefined) ?? null
    if (!target) throw new PriceListError("Прайс-лист не найден", 400, { connectedPriceList: "Прайс-лист не найден" })
  } else if (input.linkedList !== undefined) {
    if (isNoLink(input.linkedList)) return { linked: NONE, linkedId: null }
    target = ((await db.prepare("SELECT id, name FROM price_lists WHERE fin_key(name) = fin_key(?) ORDER BY id LIMIT 1").get(input.linkedList)) as { id: number; name: string } | undefined) ?? null
    if (!target) throw new PriceListError("Прайс-лист не найден", 400, { connectedPriceList: "Прайс-лист не найден" })
  } else {
    return isNoLink(current?.linked_list) ? { linked: NONE, linkedId: null } : { linked: current!.linked_list!, linkedId: current!.linked_id }
  }
  if (target.id === selfId) throw new PriceListError("Нельзя связать прайс-лист с самим собой", 400, { connectedPriceList: "Нельзя связать прайс-лист с самим собой" })
  // Walk the chain of links from the target: it must not come back to this list (by id or name).
  const cycle = () => new PriceListError("Связь прайс-листов образует цикл", 400, { connectedPriceList: "Связь прайс-листов образует цикл" })
  const seen = new Set<number>([target.id])
  let linkedName = ((await db.prepare("SELECT linked_list FROM price_lists WHERE id = ?").get(target.id)) as { linked_list: string | null } | undefined)?.linked_list
  while (!isNoLink(linkedName)) {
    if (priceListKey(linkedName) === priceListKey(selfName)) throw cycle()
    const next = (await db.prepare("SELECT id, linked_list FROM price_lists WHERE fin_key(name) = fin_key(?) ORDER BY id LIMIT 1").get(linkedName)) as
      | { id: number; linked_list: string | null }
      | undefined
    if (!next || seen.has(next.id)) break
    if (next.id === selfId) throw cycle()
    seen.add(next.id)
    linkedName = next.linked_list
  }
  return { linked: target.name, linkedId: target.id }
}

export const CURRENCY_NOT_FOUND = "Валюта не найдена"

/** Currency of a written list: a code of the currencies table (empty table: SUM / USD / EUR), canonical. */
async function resolveListCurrency(db: PgDb, wanted: string | undefined, stored: string | null | undefined): Promise<string> {
  const context = await loadCurrencyContext(db)
  if (wanted === undefined || !wanted.trim()) {
    // Omitted: keep the stored currency (an edit) or take the base currency (a new list).
    return stored ? normCurrency(stored) : context.base
  }
  const code = normCurrency(wanted)
  if (stored && normCurrency(stored) === code) return code
  if (!context.currencies.some((currency) => currency.code === code)) throw new PriceListError(CURRENCY_NOT_FOUND, 400, { currency: CURRENCY_NOT_FOUND })
  return code
}

async function storedFields(db: PgDb, id: number | null, input: PriceListInput, current: Row | null): Promise<Stored> {
  const { linked } = await resolveLink(db, id, input.name, input, current)
  const linkedSet = !isNoLink(linked)
  let methodId = input.calcMethodId === undefined ? storedMethodId(current?.calc_method) : (input.calcMethodId ?? "").trim()
  if (methodId && !calcMethodById(methodId)) throw new PriceListError("Неизвестный метод расчета", 400, { calcMethod: "Неизвестный метод расчета" })
  if (!linkedSet) methodId = ""
  const method = calcMethodById(methodId)
  const values = input.methodValues === undefined ? parseMethodValues(current?.method_values) : input.methodValues
  const methodValues = method ? method.keys.map((key) => ({ methodKey: key.id, value: Number(values.find((item) => item.methodKey === key.id)?.value) || 0 })) : []
  if (method?.keys.some((key) => key.id === "round") && methodValues.some((item) => item.methodKey === "round" && item.value < 0)) {
    throw new PriceListError("Некорректное значение", 400, { round: "Некорректное значение" })
  }
  const flag = (value: boolean | undefined, stored: number | null | undefined, fallback: number) =>
    value === undefined ? (stored === null || stored === undefined ? fallback : Number(stored) === 1 ? 1 : 0) : value ? 1 : 0
  const currency = await resolveListCurrency(db, input.currency, current?.currency)
  return {
    name: input.name.trim(),
    currency,
    position: input.position === undefined ? Number(current?.position) || 0 : Math.trunc(input.position),
    is_active: flag(input.isActive, current?.is_active, 1),
    is_default_for_order: flag(input.isDefaultForOrder, current?.is_default_for_order, 0),
    linked_list: linkedSet ? linked : NONE,
    calc_method: methodId || NONE,
    method_values: JSON.stringify(methodValues),
  }
}

async function clearOtherDefaults(db: PgDb, fields: Stored, id: number) {
  if (fields.is_default_for_order) await db.prepare("UPDATE price_lists SET is_default_for_order = 0 WHERE id <> ? AND is_default_for_order = 1").run(id)
}

/** Demo POST sales/price_list/. */
export async function createPriceList(input: PriceListInput): Promise<PriceList> {
  await ensurePriceListsSchema()
  return withTransaction(async (tx) => {
    await lockPriceLists(tx)
    await assertNameAvailable(tx, input.name, null)
    const fields = await storedFields(tx, null, input, null)
    const result = await tx
      .prepare(
        `INSERT INTO price_lists (name, currency, position, is_active, is_default_for_order, linked_list, calc_method, method_values, created_at, updated_at)
         VALUES (@name, @currency, @position, @is_active, @is_default_for_order, @linked_list, @calc_method, @method_values, datetime('now'), datetime('now'))`,
      )
      .run(fields)
    const id = Number(result.lastInsertRowid)
    await clearOtherDefaults(tx, fields, id)
    return rowToPriceList((await readRow(tx, id))!)
  })
}

export type PriceListUpdateResult = { priceList: PriceList; renamed: PriceListRenameChange[] }

/** Demo PUT sales/price_list/:id; a rename is carried over to every reference. */
export async function updatePriceList(id: number, input: PriceListInput): Promise<PriceListUpdateResult | null> {
  await ensurePriceListsSchema()
  return withTransaction(async (tx) => {
    await lockPriceLists(tx)
    const current = await readRow(tx, id, true)
    if (!current) return null
    let renamed: PriceListRenameChange[] = []
    if (current.name !== input.name.trim()) {
      await assertNameAvailable(tx, input.name, id)
      renamed = await cascadePriceListRename(tx, current.name, input.name.trim())
    }
    const fields = await storedFields(tx, id, input, current)
    await tx
      .prepare(
        `UPDATE price_lists SET name = @name, currency = @currency, position = @position, is_active = @is_active,
           is_default_for_order = @is_default_for_order, linked_list = @linked_list, calc_method = @calc_method,
           method_values = @method_values, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...fields, id })
    await clearOtherDefaults(tx, fields, id)
    return { priceList: rowToPriceList((await readRow(tx, id))!), renamed }
  })
}

/** Demo DELETE sales/price_list/:id — refused (409) while the list is used anywhere. */
export async function deletePriceList(id: number): Promise<boolean> {
  await ensurePriceListsSchema()
  return withTransaction(async (tx) => {
    await lockPriceLists(tx)
    const current = await readRow(tx, id, true)
    if (!current) return false
    const usage = await priceListUsage(tx, { id: Number(current.id), name: current.name })
    if (usage.length) throw new PriceListError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    const result = await tx.prepare("DELETE FROM price_lists WHERE id = ?").run(id)
    return result.changes > 0
  })
}
