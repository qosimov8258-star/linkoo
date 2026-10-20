import "server-only"

import { getDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { getStockOptions } from "@/lib/stock/options"
import { jsonLines } from "@/lib/stock/sources"
import { ensureTransfersSchema, rowToTransfer, type TransferRow } from "@/lib/internal-transfers-repo"
import type { Transfer, TransferListResult, TransferOptions, TransferStatus, TransferWarehouse } from "@/lib/internal-transfers-types"

// List of "Передачи между складами" (demo stock/stock_transfer/ with
// begin_date / end_date, delivered_date_*, accepted_date_*, from_stock,
// to_stock, status, search, with_cancelled, ordering) and the dialog / filter
// lookups. Dates are compared as local days (fin_ts).

export type TransferListQuery = {
  search: string
  ordering: string
  page: number
  /** 0 = every row. */
  pageSize: number
  fromWarehouse: string[]
  toWarehouse: string[]
  /** Either side. */
  warehouse: string[]
  status: TransferStatus[]
  createdBy: string[]
  createdFrom: string
  createdTo: string
  deliveryFrom: string
  deliveryTo: string
  acceptedFrom: string
  acceptedTo: string
  givenFrom: string
  givenTo: string
  /** Cancelled transfers are hidden unless asked for (demo "Показать отмененные передачи") or filtered by status. */
  withCancelled: boolean
  ids: number[]
}

const CREATED_TS = "COALESCE(fin_ts(t.created_at_label), fin_ts(t.created_at, true))"

const ORDERING: Record<string, string> = {
  id: "t.id",
  created_date: CREATED_TS,
  date_delivery: "fin_ts(t.delivered_at)",
  total_price: "t.amount",
  total_weight: "t.weight",
  status: "t.status",
  created_by: "t.created_by",
  from_stock: "t.from_warehouse",
  to_stock: "t.to_warehouse",
  accepted_time: "fin_ts(t.accepted_at)",
  given_time: "fin_ts(t.given_at)",
}

export const TRANSFER_SORT_KEYS = Object.keys(ORDERING)

const inNames = (column: string, param: string) => `fin_key(${column}) IN (SELECT fin_key(x) FROM unnest(@${param}::text[]) AS x)`

function where(query: TransferListQuery): { sql: string; params: Record<string, unknown> } {
  const parts: string[] = []
  const params: Record<string, unknown> = {}
  if (query.ids.length) {
    parts.push("t.id = ANY(@ids::int[])")
    params.ids = query.ids
  }
  if (query.fromWarehouse.length) {
    parts.push(inNames("t.from_warehouse", "from_wh"))
    params.from_wh = query.fromWarehouse
  }
  if (query.toWarehouse.length) {
    parts.push(inNames("t.to_warehouse", "to_wh"))
    params.to_wh = query.toWarehouse
  }
  if (query.warehouse.length) {
    parts.push(`(${inNames("t.from_warehouse", "any_wh")} OR ${inNames("t.to_warehouse", "any_wh")})`)
    params.any_wh = query.warehouse
  }
  if (query.createdBy.length) {
    parts.push(inNames("t.created_by", "creators"))
    params.creators = query.createdBy
  }
  if (query.status.length) {
    parts.push("t.status = ANY(@statuses::text[])")
    params.statuses = query.status
  } else if (!query.withCancelled && !query.ids.length) {
    parts.push("t.status <> 'отменен'")
  }
  const range = (expr: string, from: string, to: string, name: string) => {
    if (from) {
      parts.push(`(${expr})::date >= @${name}_from::date`)
      params[`${name}_from`] = from
    }
    if (to) {
      parts.push(`(${expr})::date <= @${name}_to::date`)
      params[`${name}_to`] = to
    }
  }
  range(CREATED_TS, query.createdFrom, query.createdTo, "created")
  range("fin_ts(t.delivered_at)", query.deliveryFrom, query.deliveryTo, "delivery")
  range("fin_ts(t.accepted_at)", query.acceptedFrom, query.acceptedTo, "accepted")
  range("fin_ts(t.given_at)", query.givenFrom, query.givenTo, "given")
  const search = query.search.trim()
  if (search) {
    params.search = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    params.search_id = /^\d{1,9}$/.test(search) ? Number(search) : -1
    parts.push(`(t.id = @search_id OR t.from_warehouse ILIKE @search OR t.to_warehouse ILIKE @search OR t.created_by ILIKE @search
      OR t.comment ILIKE @search OR t.invoice_number ILIKE @search OR t.transport_number ILIKE @search OR t.driver ILIKE @search
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonLines("t.items")}) AS l(j) WHERE l.j ->> 'product' ILIKE @search))`)
  }
  return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params }
}

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const expr = ORDERING[ordering.replace(/^-/, "")]
  if (!expr) return "ORDER BY t.id DESC"
  return `ORDER BY ${expr} ${desc ? "DESC" : "ASC"} NULLS LAST, t.id DESC`
}

export async function listTransfers(query: TransferListQuery): Promise<TransferListResult> {
  await ensureTransfersSchema()
  const db = getDb()
  const filter = where(query)
  // The db shim binds a lone object only when the SQL has @names.
  const args = Object.keys(filter.params).length ? [filter.params] : []
  const count = (await db.prepare(`SELECT count(*)::int AS n FROM internal_transfers t ${filter.sql}`).get(...args)) as { n: number }
  const pageSize = Math.max(0, query.pageSize)
  const page = Math.max(1, query.page)
  const limit = pageSize ? `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await db.prepare(`SELECT t.* FROM internal_transfers t ${filter.sql} ${orderBy(query.ordering)} ${limit}`).all(...args)) as TransferRow[]
  return { count: Number(count?.n) || 0, page, pageSize, results: rows.map(rowToTransfer) }
}

/** Legacy GET /api/internal-transfers (no paging params): every transfer, newest first. */
export async function listAllTransfers(): Promise<Transfer[]> {
  await ensureTransfersSchema()
  const rows = (await getDb().prepare("SELECT * FROM internal_transfers ORDER BY id DESC").all()) as TransferRow[]
  return rows.map(rowToTransfer)
}

/** Registered warehouses (address / manager for the printed invoice) plus names seen on documents. */
export async function transferWarehouses(): Promise<TransferWarehouse[]> {
  const db = getDb()
  const options = await getStockOptions(db)
  const registered = (await db.prepare("SELECT name, address, manager, active FROM warehouses ORDER BY name").all()) as Array<{
    name: string
    address: string | null
    manager: string | null
    active: number | boolean | null
  }>
  const byKey = new Map<string, TransferWarehouse>()
  const key = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase()
  for (const row of registered) {
    if (!row.name?.trim() || byKey.has(key(row.name))) continue
    byKey.set(key(row.name), { name: row.name.trim(), address: row.address ?? "", manager: row.manager ?? "", active: row.active === null ? true : Boolean(Number(row.active)) })
  }
  for (const warehouse of options.warehouses) if (!byKey.has(key(warehouse.name))) byKey.set(key(warehouse.name), { name: warehouse.name, address: "", manager: "", active: true })
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

export async function transferOptions(): Promise<TransferOptions> {
  await ensureTransfersSchema()
  const db = getDb()
  const [stock, warehouses, currency, creators] = await Promise.all([
    getStockOptions(db),
    transferWarehouses(),
    loadCurrencyContext(db),
    db.prepare("SELECT DISTINCT created_by AS name FROM internal_transfers WHERE btrim(created_by) <> '' ORDER BY 1").all() as Promise<Array<{ name: string }>>,
  ])
  return {
    warehouses,
    users: creators.map((row) => row.name),
    priceLists: stock.priceLists,
    priceListCurrency: stock.priceListCurrency,
    currencies: currency.currencies.map((entry) => entry.code),
    baseCurrency: currency.base,
    organizations: stock.organizations,
  }
}
