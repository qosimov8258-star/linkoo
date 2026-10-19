import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import { stockOrphanNames } from "@/lib/stock/level"
import { stockTables } from "@/lib/stock/schema"
import type { StockMoveKind } from "@/lib/stock/types"
import type { PlanPaging } from "@/lib/stock-plan"
import { PLAN_MOVE_TYPES, type PlanMovementResult, type PlanMovementRow, type PlanOptionsResult } from "@/lib/stock-plan-types"

// "Движение товаров" (demo stock/barcode_history, chunk c90): every line of
// the stock ledger (lib/stock stockMovementsSql: accepted supplies, supplier
// returns, write-offs, transfer legs, production, confirmed inventories,
// shipped orders) with its document, newest first. Lines without a warehouse
// are skipped, as the balances skip them.

export type PlanMoveFilters = {
  warehouses: string[]
  /** PLAN_MOVE_TYPES ids. */
  types: string[]
  /** Item keys ("product:12"). */
  products: string[]
  /** Тип продукта / Подкатегория (catalog). */
  typeParents: string[]
  subcategories: string[]
  from: string
  to: string
  search: string
}

/** Rows per export when pageSize = 0. */
const ALL_ROWS = 100_000

const SORTS: Record<string, string> = {
  day: "m.day",
  qty: "m.qty",
  warehouse: "fin_key(m.warehouse)",
  docNumber: "m.doc_no",
}

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const expr = SORTS[desc ? ordering.slice(1) : ordering]
  const tail = "m.day DESC, m.doc_type, m.doc_no DESC, m.item_key, m.kind"
  return expr ? `${expr} ${desc ? "DESC" : "ASC"}, ${tail}` : tail
}

function nameKey(value: string): string {
  return value.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

type LedgerRow = { day: string; warehouse: string; item_key: string; qty: number; kind: string; doc_type: string; doc_id: number; doc_no: number; is_defect: number; total?: string | number }

export async function listPlanMovements(filters: PlanMoveFilters, paging: PlanPaging, db: PgDb = getDb()): Promise<PlanMovementResult> {
  const t = await stockTables(db)
  const [ledger, catalog, warehouseRows] = await Promise.all([
    stockMovementsSql({}, db),
    getStockCatalog(db),
    t.has("warehouses") ? db.prepare("SELECT name FROM warehouses ORDER BY id").all() : Promise.resolve([]),
  ])
  const pageSize = paging.pageSize > 0 ? paging.pageSize : ALL_ROWS
  const page = paging.pageSize > 0 ? paging.page : 1
  const result: PlanMovementResult = { count: 0, page, pageSize: paging.pageSize, results: [] }

  const params: Record<string, unknown> = { ...ledger.params }
  const where = ["fin_key(m.warehouse) <> ''"]
  if (filters.warehouses.length) {
    where.push("fin_key(m.warehouse) IN (SELECT fin_key(w) FROM unnest(@pl_wh::text[]) AS w)")
    params.pl_wh = filters.warehouses
  }
  if (filters.types.length) {
    const kinds = PLAN_MOVE_TYPES.filter((type) => filters.types.includes(type.id)).flatMap((type) => type.kinds)
    if (!kinds.length) return result
    where.push("m.kind = ANY(@pl_kinds::text[])")
    params.pl_kinds = kinds
  }
  if (filters.products.length) {
    where.push("m.item_key = ANY(@pl_items::text[])")
    params.pl_items = filters.products
  }
  if (filters.typeParents.length || filters.subcategories.length) {
    const keys = catalog
      .filter((item) => (!filters.typeParents.length || filters.typeParents.includes(item.type)) && (!filters.subcategories.length || filters.subcategories.includes(item.subcategory ?? "")))
      .map((item) => item.key)
    if (!keys.length) return result
    where.push("m.item_key = ANY(@pl_cat::text[])")
    params.pl_cat = keys
  }
  const search = filters.search.trim()
  if (search) {
    // Item name / article / barcode, an unmatched document name, or the document №.
    const needle = search.toLowerCase()
    params.pl_found = catalog
      .filter((item) => item.name.toLowerCase().includes(needle) || item.article.toLowerCase().includes(needle) || (item.barcode ?? "").toLowerCase().includes(needle))
      .map((item) => item.key)
    params.pl_ql = nameKey(search)
    params.pl_q = search.replace(/^№\s*/, "")
    where.push("(m.item_key = ANY(@pl_found::text[]) OR (m.item_key LIKE 'name:%' AND strpos(m.item_key, @pl_ql) > 0) OR m.doc_no::text = @pl_q)")
  }
  if (filters.from) {
    where.push("m.day >= @pl_from")
    params.pl_from = filters.from
  }
  if (filters.to) {
    where.push("m.day <= @pl_to")
    params.pl_to = filters.to
  }

  // № of a production line is its batch (party), as in the demo (d_parent_id).
  const withParty = t.has("production_movements") && t.col("production_movements", "party_id")
  const source = withParty
    ? `SELECT l.*, COALESCE(pm.party_id, l.doc_id) AS doc_no FROM (${ledger.sql}) l
         LEFT JOIN production_movements pm ON l.doc_type = 'production_movements' AND pm.id = l.doc_id`
    : `SELECT l.*, l.doc_id AS doc_no FROM (${ledger.sql}) l`
  const base = `FROM (${source}) m WHERE ${where.join(" AND ")}`
  const rows = (await db
    .prepare(
      `SELECT m.day, m.warehouse, m.item_key, m.qty, m.kind, m.doc_type, m.doc_id, m.doc_no, m.is_defect, COUNT(*) OVER () AS total
         ${base} ORDER BY ${orderBy(paging.ordering || "-day")} LIMIT @pl_limit OFFSET @pl_offset`,
    )
    .all({ ...params, pl_limit: pageSize, pl_offset: (page - 1) * pageSize })) as LedgerRow[]
  if (rows.length) result.count = Number(rows[0].total) || 0
  else if (page > 1) result.count = Number(((await db.prepare(`SELECT COUNT(*)::int AS n ${base}`).get(params)) as { n: number } | undefined)?.n) || 0

  const items = new Map(catalog.map((item) => [item.key, item]))
  const orphans = await stockOrphanNames([...new Set(rows.map((row) => row.item_key).filter((key) => !items.has(key)))], db)
  const warehouses = new Map<string, string>()
  for (const row of warehouseRows) {
    const name = String(row.name ?? "").trim()
    if (name && !warehouses.has(nameKey(name))) warehouses.set(nameKey(name), name)
  }
  const offset = (page - 1) * pageSize
  result.results = rows.map((row, index): PlanMovementRow => {
    const item = items.get(row.item_key)
    const orphan = orphans.get(row.item_key)
    const warehouse = String(row.warehouse ?? "").trim()
    return {
      id: `${row.doc_type}-${row.doc_id}-${row.item_key}-${row.kind}-${offset + index}`,
      day: row.day === "1970-01-01" ? "" : row.day,
      warehouse: warehouses.get(nameKey(warehouse)) ?? warehouse,
      kind: row.kind as StockMoveKind,
      docType: row.doc_type,
      docId: Number(row.doc_id),
      docNumber: Number(row.doc_no),
      key: row.item_key,
      name: item?.name ?? orphan?.name ?? (row.item_key.startsWith("name:") ? row.item_key.slice(5) : row.item_key),
      article: item?.article ?? "",
      unit: item?.unit || orphan?.unit || "",
      qty: Math.round((Number(row.qty) || 0) * 1e6) / 1e6,
      isDefect: Number(row.is_defect) === 1,
    }
  })
  return result
}

/** Product picker of the "Товар" filter: every catalog item. */
export async function listPlanOptions(db: PgDb = getDb()): Promise<PlanOptionsResult> {
  const catalog = await getStockCatalog(db)
  return { products: catalog.map((item) => ({ key: item.key, name: item.article ? `${item.name} (${item.article})` : item.name })) }
}
