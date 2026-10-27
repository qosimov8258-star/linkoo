import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { DB_LOCKED } from "@/lib/db-errors"
import { todayIso } from "@/lib/finance/dates"
import { getWarehouseItemCosts } from "@/lib/stock/costs"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"
import { minBalancesFrom } from "@/lib/stock/min-balance"
import { stockTables } from "@/lib/stock/schema"
import type { StockCatalogItem } from "@/lib/stock/types"
import { unitWeightKg, type StockPickRow, type StockShortage } from "@/lib/internal-transfers-types"

// "Available in the warehouse" for the transfer and write-off documents, from
// the stock core (getStockBalances / getStockPending / getStockCatalog):
// Доступно = on hand − defects − reserved, as the demo's pickers show it; Брак
// (defective units) can only leave through lines flagged "defect", up to the
// defects on hand. No stock may go negative on ANY day (business rule 8): a
// document booked on a day lowers every later day too, so it must fit the
// smallest end-of-day balance from its day on — every day in between, today
// and the movements already booked for later days (a give or write-off dated
// ahead must not let the same goods be spent twice). lib/stock/min-balance.ts
// computes that minimum in one query. Costs are the cost of goods
// (lib/stock/costs.ts) at the document's day (the warehouse's own when it is
// its own cost scope).

/** JS twin of fin_key(): lower-cased, trimmed, inner whitespace collapsed. */
export function textKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function round6(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Serialises stock-changing documents of one warehouse (transaction-scoped lock). */
export async function lockWarehouseStock(tx: PgDb, warehouses: string[]): Promise<void> {
  const keys = [...new Set(warehouses.map(textKey).filter(Boolean))].sort()
  for (const key of keys) await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@k)) AS ok").get({ k: `linko-stock:${key}` })
}

/**
 * Lock order of the stock writers (C1): the warehouses' stock locks BEFORE the row lock of
 * the document being changed. One global order — linko-catalog, then linko-stock:<warehouse>
 * (sorted), then stock_inventory:<warehouse>, then rows — is what a catalog or warehouse
 * rename takes (lib/products-write.ts lockStockWrites, lib/warehouses-refs.ts
 * lockWarehouseNames: every stock lock first, then the documents' rows). A writer that held
 * its document's row while it waited for the stock lock deadlocked against such a rename.
 * `sql` reads the document's warehouse(s) as `warehouse` WITHOUT a lock; lockWarehouseStock
 * is re-entrant, so the writer's own later call for the same warehouse costs nothing (a
 * warehouse changed in between is still locked by that later call).
 */
export async function lockWarehousesOf(tx: PgDb, sql: string, params: Record<string, unknown>): Promise<void> {
  const rows = (await tx.prepare(sql).all(params)) as Array<{ warehouse: string | null }>
  await lockWarehouseStock(
    tx,
    rows.map((row) => String(row.warehouse ?? "")),
  )
}

export type ItemStock = {
  qty: number
  defects: number
  reserved: number
  /** Good units that may leave: min over every day from the document's day on of (on hand − defects), − reserved. */
  available: number
  /** Defective units that may leave (lines flagged "defect"): min over the same days. */
  defectsAvailable: number
  cost: number
}

async function balancesOn(warehouse: string, date: string, db: PgDb) {
  const wanted = textKey(warehouse)
  const map = new Map<string, { qty: number; defects: number; value: number; cost: number }>()
  for (const row of await getStockBalances({ warehouses: [warehouse], date }, db)) {
    if (textKey(row.warehouse) !== wanted) continue
    const current = map.get(row.key)
    if (!current) map.set(row.key, { qty: row.qty, defects: row.defects, value: row.value, cost: row.cost })
    else {
      current.qty += row.qty
      current.defects += row.defects
      current.value += row.value
    }
  }
  return map
}

/** The day a document's stock check starts from: its booking day, never after today
 * (a document dated ahead must also fit today's stock). */
export function checkDay(day?: string | null): string {
  const today = todayIso()
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < today ? day : today
}

/** Stock of every item of one warehouse for a document booked on `day` (default today):
 * what is on hand today, and what may leave from that day on (see the header). */
export async function warehouseStock(warehouse: string, day?: string, db: PgDb = getDb()): Promise<Map<string, ItemStock>> {
  const docDay = checkDay(day)
  const [balances, pending, costs] = await Promise.all([
    minBalancesFrom(warehouse, docDay, db),
    getStockPending({ warehouses: [warehouse] }, db),
    getWarehouseItemCosts({ date: docDay }, db),
  ])
  const reserved = new Map<string, number>()
  const wanted = textKey(warehouse)
  for (const row of pending) if (textKey(row.warehouse) === wanted) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
  const keys = [...new Set([...balances.keys(), ...reserved.keys()])]
  // Items the cost of goods does not know (legacy "name:" lines) keep the stock core's own average.
  const uncosted = keys.some((key) => costs.costOf(key, warehouse) === undefined)
  const latest = uncosted ? await balancesOn(warehouse, todayIso(), db) : null
  const result = new Map<string, ItemStock>()
  for (const key of keys) {
    const balance = balances.get(key)
    const r = reserved.get(key) ?? 0
    result.set(key, {
      qty: round6(balance?.qty ?? 0),
      defects: round6(balance?.defects ?? 0),
      reserved: round6(r),
      available: round6((balance?.minGood ?? 0) - r),
      defectsAvailable: round6(Math.max(0, balance?.minDefects ?? 0)),
      cost: round6(costs.costOf(key, warehouse) ?? latest?.get(key)?.cost ?? 0),
    })
  }
  return result
}

/** Catalog by key plus a name lookup that matches the core (products first). */
export type CatalogIndex = { byKey: Map<string, StockCatalogItem>; byName: Map<string, StockCatalogItem>; items: StockCatalogItem[] }

export async function catalogIndex(db: PgDb = getDb()): Promise<CatalogIndex> {
  const items = await getStockCatalog(db)
  const byKey = new Map(items.map((item) => [item.key, item]))
  const byName = new Map<string, StockCatalogItem>()
  // getStockCatalog lists products first, then raw materials (same priority as the ledger).
  for (const item of items) {
    const key = textKey(item.name)
    if (key && !byName.has(key)) byName.set(key, item)
  }
  return { byKey, byName, items }
}

/** The stock key the ledger will give a document line (by its name, as the core does). */
export function ledgerKey(index: CatalogIndex, name: string): string {
  const item = index.byName.get(textKey(name))
  return item ? item.key : `name:${textKey(name)}`
}

/** A line as entered: catalog key (picker) or product name (legacy / Excel). */
export type LineRef = { key?: string; product?: string }

/** Canonical item of a line: by key when it is a catalog item, else by name. */
export function resolveLine(index: CatalogIndex, line: LineRef): { key: string; item: StockCatalogItem | undefined; name: string } {
  const byKey = line.key ? index.byKey.get(line.key) : undefined
  if (byKey) return { key: byKey.key, item: byKey, name: byKey.name }
  const name = String(line.product ?? "").trim()
  const item = index.byName.get(textKey(name))
  if (item) return { key: item.key, item, name: item.name }
  return { key: line.key && line.key.startsWith("name:") ? line.key : `name:${textKey(name)}`, item: undefined, name }
}

/** Lines whose total quantity exceeds what the warehouse has available (good units;
 * lines flagged `defect` against the defective units). */
export function findShortages(
  lines: Array<{ product: string; quantity: number; unit?: string; defect?: boolean }>,
  index: CatalogIndex,
  stock: Map<string, ItemStock>,
): StockShortage[] {
  const need = new Map<string, { key: string; defect: boolean; product: string; unit: string; required: number }>()
  for (const line of lines) {
    if (!(line.quantity > 0)) continue
    // Key as the ledger will book it (by name), so the check matches the movement.
    const key = ledgerKey(index, line.product)
    const defect = Boolean(line.defect)
    const id = `${key}\u0000${defect ? 1 : 0}`
    const current = need.get(id)
    if (current) current.required += line.quantity
    else need.set(id, { key, defect, product: line.product, unit: line.unit || index.byKey.get(key)?.unit || "", required: line.quantity })
  }
  const shortages: StockShortage[] = []
  for (const entry of need.values()) {
    const item = stock.get(entry.key)
    const available = (entry.defect ? item?.defectsAvailable : item?.available) ?? 0
    if (entry.required > available + 1e-9) {
      shortages.push({
        key: entry.key,
        product: entry.defect ? `${entry.product} (брак)` : entry.product,
        unit: entry.unit,
        required: round6(entry.required),
        available: round6(Math.max(0, available)),
        ...(entry.defect ? { defect: true } : {}),
      })
    }
  }
  return shortages
}

// ---------------------------------------------------------------------------
// Warehouses and inventories the documents depend on
// ---------------------------------------------------------------------------

export type WarehouseRef = { id: number; name: string; active: boolean }

type WarehouseRow = { id: number | string; name: string; active: number | boolean | null }

const toWarehouseRef = (row: WarehouseRow): WarehouseRef => ({
  id: Number(row.id),
  name: String(row.name).trim(),
  active: row.active === null || Boolean(Number(row.active)),
})

/** The warehouses-table row of a name (fin_key match; the registry's spelling), or null. */
export async function findWarehouse(db: PgDb, name: string): Promise<WarehouseRef | null> {
  const wanted = textKey(name)
  if (!wanted) return null
  const row = (await db
    .prepare("SELECT id, name, COALESCE(active, 1) AS active FROM warehouses WHERE fin_key(name) = fin_key(@name) ORDER BY COALESCE(active, 1) DESC, id LIMIT 1")
    .get({ name })) as WarehouseRow | undefined
  return row ? toWarehouseRef(row) : null
}

/** A warehouse of a document being written, as it is under its stock lock (lockDocumentWarehouses). */
export type LockedWarehouse = {
  /** null: a warehouse only documents know (no registry row), kept as named. */
  id: number | null
  /** The registry's spelling now (a rename that committed before the lock included). */
  name: string
  active: boolean
  /** The name changed beyond its spelling since `ref` was read (another stock key): values the
   * caller derived from the old name (stock, costs, ledger keys) must be read again. */
  renamed: boolean
}

/** The warehouse of a document kept being renamed while the document was written. lib/db-errors.ts
 * answers it like any other conflict ("retry", 409) where the caller does not map it itself. */
export class WarehouseRenamedError extends Error {
  readonly status = 409
  /** serialization_failure: dbErrorKind() → "locked". */
  readonly code = "40001"

  constructor() {
    super(DB_LOCKED)
    this.name = "WarehouseRenamedError"
  }
}

/**
 * The warehouses a new or edited document names, under their stock locks, as they are now
 * (rename race). A document validates its warehouse before its transaction; a rename that
 * committed in between had already carried every existing document over to the new name, so
 * the document would land on a name that no longer exists. Therefore, inside the document's
 * transaction and before any row lock (the global lock order, see lockWarehousesOf):
 *  1. the stock locks of the names the document validated, sorted — a rename takes the same
 *     locks (lib/warehouses-refs.ts lockWarehouseNames) before its cascade, so it has either
 *     committed by now or waits until this transaction commits (and then carries this
 *     document over too);
 *  2. each registry row read again by id (a plain read: the rename holds that row while it
 *     waits for our lock) — a rename that committed before step 1 shows its new name, whose
 *     stock lock is taken as well (other writers use that name now) and the rows are read
 *     again, until every current name is locked.
 * `ref.id` null / undefined = a warehouse only documents know: locked by name, kept as is.
 * null in the result: the warehouse was deleted meanwhile. WarehouseRenamedError when it is
 * renamed again and again under us (practically never: each round needs another committed rename).
 */
export async function lockDocumentWarehouses(tx: PgDb, refs: ReadonlyArray<{ id?: number | null; name: string }>): Promise<Array<LockedWarehouse | null>> {
  const locked = new Set<string>()
  const lock = async (names: string[]) => {
    const fresh = [...new Set(names.map(textKey).filter((key) => key && !locked.has(key)))]
    if (!fresh.length) return
    await lockWarehouseStock(tx, fresh)
    for (const key of fresh) locked.add(key)
  }
  await lock(refs.map((ref) => ref.name))
  const ids = [...new Set(refs.map((ref) => Number(ref.id)).filter((id) => Number.isSafeInteger(id) && id > 0))]
  for (let round = 0; round < 5; round++) {
    const rows = ids.length
      ? ((await tx.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM warehouses WHERE id = ANY(@ids::int[])").all({ ids })) as WarehouseRow[])
      : []
    const byId = new Map(rows.map((row) => [Number(row.id), toWarehouseRef(row)]))
    const current = refs.map((ref): LockedWarehouse | null => {
      const id = Number(ref.id)
      if (!(Number.isSafeInteger(id) && id > 0)) return { id: null, name: ref.name.trim(), active: true, renamed: false }
      const row = byId.get(id)
      return row ? { ...row, renamed: textKey(row.name) !== textKey(ref.name) } : null
    })
    const unlocked = current.flatMap((entry) => (entry && !locked.has(textKey(entry.name)) ? [entry.name] : []))
    if (!unlocked.length) return current
    await lock(unlocked)
  }
  throw new WarehouseRenamedError()
}

/** lockDocumentWarehouses for a document that resolves its warehouse inside its transaction
 * (supplies, supplier returns): the stock lock of the warehouse the request named, and the name
 * to resolve — the registry's current one when the row `seen` before the transaction
 * (findWarehouse) was renamed meanwhile, else `name` as sent (an unknown or deleted warehouse
 * then fails the caller's own lookup). */
export async function lockNamedWarehouse(tx: PgDb, name: string, seen: { id: number; name: string } | null | undefined): Promise<string> {
  if (!seen) {
    await lockWarehouseStock(tx, [name])
    return name
  }
  const [locked] = await lockDocumentWarehouses(tx, [seen])
  return locked ? locked.name : name
}

/** The stock keys the ledger books a document's lines under (by name, as the core does). */
export function documentKeys(index: CatalogIndex, lines: Array<{ product: string }>): string[] {
  return [...new Set(lines.map((line) => ledgerKey(index, String(line.product ?? ""))).filter((key) => key && key !== "name:"))]
}

/** Whether a confirmed inventory of `warehouse` counted one of the document's items
 * (`keys`, stock ledger keys) after its movement — booked on `day` at `moment` (local
 * "YYYY-MM-DDTHH:mm:ss"): an inventory dated after that day, or an end-of-day one of
 * that day confirmed at or after the moment. With `registeredAt` (the local moment
 * the movement was entered), only counts confirmed at or after it qualify: a count
 * confirmed before a back-dated movement was entered never saw it. Undoing the
 * movement would make the stock differ from such a count; inventories that did not
 * count the document's items are not affected. Missing lazy tables / columns are
 * tolerated (no inventory = nothing counted). */
export async function countedByInventory(
  db: PgDb,
  warehouse: string,
  day: string,
  moment: string,
  keys: string[],
  options: { registeredAt?: string | null } = {},
): Promise<boolean> {
  const wanted = [...new Set(keys.filter(Boolean))]
  if (!day || !wanted.length) return false
  const t = await stockTables(db)
  if (!t.has("stock_inventories") || !t.has("stock_inventory_items") || !t.col("stock_inventories", "inv_date")) return false
  const stamps = [
    t.col("stock_inventories", "confirmed_at") ? "fin_ts(NULLIF(btrim(si.confirmed_at), ''), true)" : null,
    t.col("stock_inventories", "created_at") ? "fin_ts(si.created_at, true)" : null,
  ].filter(Boolean)
  // No usable timestamp: assume the count came after the movement (refuse rather than corrupt).
  const confirmed = `COALESCE(${[...stamps, "'infinity'::timestamp"].join(", ")})`
  const sameDay = t.col("stock_inventories", "for_day_end")
    ? ` OR (fin_ts(si.inv_date)::date = @day::date AND COALESCE(si.for_day_end, 0) = 1 AND ${confirmed} >= COALESCE(fin_ts(@moment), @day::timestamp))`
    : ""
  const registered = options.registeredAt ? ` AND ${confirmed} >= COALESCE(fin_ts(@registered), '-infinity'::timestamp)` : ""
  const row = (await db
    .prepare(
      `SELECT 1 AS ok FROM stock_inventories si
       WHERE si.status = 'confirmed' AND fin_key(si.warehouse) = fin_key(@warehouse)
         AND (fin_ts(si.inv_date)::date > @day::date${sameDay})${registered}
         AND EXISTS (
           SELECT 1 FROM stock_inventory_items it
           WHERE it.inventory_id = si.id
             AND (CASE WHEN it.item_key LIKE 'name:%' THEN 'name:' || fin_key(substr(it.item_key, 6)) ELSE it.item_key END) = ANY(@keys::text[])
         )
       LIMIT 1`,
    )
    .get({ warehouse, day, moment: moment || day, keys: wanted, ...(options.registeredAt ? { registered: options.registeredAt } : {}) })) as { ok: number } | undefined
  return Boolean(row)
}

const qtyText = (value: number, unit: string) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value).replace(/ /g, " ")}${unit ? ` ${unit}` : ""}`

/** "Недостаточно товара на складе «A»: sndwch — доступно 5 шт, требуется 8 шт; …". */
export function shortageMessage(warehouse: string, shortages: StockShortage[]): string {
  const parts = shortages.slice(0, 5).map((s) => `${s.product} — доступно ${qtyText(s.available, s.unit)}, требуется ${qtyText(s.required, s.unit)}`)
  const more = shortages.length > 5 ? `; … (+${shortages.length - 5})` : ""
  return `Недостаточно товара на складе «${warehouse}»: ${parts.join("; ")}${more}`
}

/** Picker rows of one warehouse: every catalog item with a balance there (and
 * the extra keys, e.g. lines of an edited document), with the price-list price. */
export async function stockPickRows(warehouse: string, options: { priceList?: string; day?: string; includeKeys?: string[] } = {}, db: PgDb = getDb()): Promise<StockPickRow[]> {
  const [index, stock] = await Promise.all([catalogIndex(db), warehouseStock(warehouse, options.day, db)])
  const include = new Set(options.includeKeys ?? [])
  const priceList = String(options.priceList ?? "").trim()
  const rows: StockPickRow[] = []
  const seen = new Set<string>()
  const push = (key: string, item: StockCatalogItem | undefined, s: ItemStock | undefined) => {
    seen.add(key)
    rows.push({
      key,
      name: item?.name ?? key.replace(/^name:/, ""),
      article: item?.article ?? "",
      type: item?.type ?? "",
      brand: item?.brand ?? "",
      unit: item?.unit ?? "",
      weight: unitWeightKg(item?.unit ?? "", item?.weight ?? 0),
      boxSize: item?.boxSize ?? 0,
      qty: s?.qty ?? 0,
      defects: s?.defects ?? 0,
      defectsAvailable: s?.defectsAvailable ?? 0,
      reserved: s?.reserved ?? 0,
      available: s?.available ?? 0,
      cost: round6(s?.cost ?? item?.fallbackCost ?? 0),
      price: priceList && item ? (item.prices[priceList] ?? 0) : 0,
    })
  }
  for (const item of index.items) {
    const s = stock.get(item.key)
    if ((s && (s.qty !== 0 || s.reserved !== 0)) || include.has(item.key)) push(item.key, item, s)
  }
  for (const [key, s] of stock) if (!seen.has(key) && s.qty !== 0) push(key, undefined, s)
  for (const key of include) if (!seen.has(key)) push(key, index.byKey.get(key), stock.get(key))
  rows.sort((a, b) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key))
  return rows
}
