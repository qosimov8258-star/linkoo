import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { getStockCatalog } from "@/lib/stock/ledger"
import { stockTables, type StockTables } from "@/lib/stock/schema"
import type { StockCatalogItem } from "@/lib/stock/types"
import {
  PLAN_TASK_TABS,
  type PlanItemDetail,
  type PlanItemProduct,
  type PlanTaskCounts,
  type PlanTaskListResult,
  type PlanTaskRow,
  type PlanTaskTab,
  type PlanTaskType,
} from "@/lib/stock-plan-types"

// "План приемок и передач": the task tabs (demo stock/income_tasks and
// stock/outcome_tasks, with history=true for the done ones), read straight
// from the documents:
//   Приемка           supplier_incomings 'ожидает'  + internal_transfers 'в пути'  (to_warehouse)
//                     + client_returns 'pending' (the return warehouse)
//   История Приемки   supplier_incomings 'принят'   + internal_transfers 'принят'  (to_warehouse)
//                     + client_returns 'accepted' (accepted_at / accepted_by)
//   Передача          internal_transfers 'потвержден' (from_warehouse) + orders 'Есть на складе' with a warehouse
//   История Передачи  internal_transfers 'в пути' / 'принят' (from_warehouse) + orders 'В пути' / 'Доставлено' with a warehouse
// Client returns ("Возврат", Продажи → Возвраты, contract 5) are accepted through
// POST /api/client-returns/[id]/accept; an accepted return can be undone with
// POST /api/client-returns/[id]/unaccept (back to pending) or cancelled, while its
// warehouse still holds the goods.
// The transfer columns given_* / accepted_* are created lazily by the
// transfers module, so every optional column is checked first.

export type PlanTaskFilters = {
  /** Warehouse names (matched by fin_key). */
  warehouses: string[]
  /** PlanTaskType or "" (all). */
  type: string
  /** Принял / Передал (history tabs). */
  doneBy: string[]
  /** Period of the tab's date column ("" = open). */
  from: string
  to: string
  search: string
}

export type PlanPaging = { page: number; pageSize: number; ordering: string }

/** Rows per export when pageSize = 0. */
const ALL_ROWS = 5000

/** fin_ts() of a stored time: zone-less "YYYY-MM-DD HH:MM:SS" (datetime('now')) is UTC,
 * "…T…" without a zone is local, "…Z" carries its zone, Russian / dotted texts are local. */
const ts = (column: string) => `fin_ts(${column}, strpos(COALESCE(${column}, ''), 'T') = 0)`
const iso = (expr: string) => `COALESCE(to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS'), '')`

function columnOr(t: StockTables, table: string, column: string, alias: string, fallback: string): string {
  return t.col(table, column) ? `${alias}.${column}` : fallback
}

/** Transfer creation moment: the "Дата создания" label's day, with the created_at time when it is the same day. */
function transferCreated(t: StockTables): string {
  const label = t.col("internal_transfers", "created_at_label") ? "fin_ts(tr.created_at_label)" : "NULL::timestamp"
  const created = t.col("internal_transfers", "created_at") ? ts("tr.created_at") : "NULL::timestamp"
  return `(CASE WHEN ${label}::date = ${created}::date THEN ${created} ELSE COALESCE(${label}, ${created}) END)`
}

/** Supply moment: "time" ("08 октября 2026, 22:08"), else its date, else created_at. */
function supplyCreated(t: StockTables): string {
  const parts: string[] = []
  if (t.col("supplier_incomings", "time")) parts.push("fin_ts(i.time)")
  if (t.col("supplier_incomings", "date")) parts.push("fin_ts(i.date)")
  if (t.col("supplier_incomings", "created_at")) parts.push(ts("i.created_at"))
  return parts.length ? `COALESCE(${parts.join(", ")})` : "NULL::timestamp"
}

function orderCreated(t: StockTables): string {
  const parts: string[] = []
  if (t.col("orders", "created")) parts.push("fin_ts(o.created)")
  if (t.col("orders", "created_at")) parts.push(ts("o.created_at"))
  return parts.length ? `COALESCE(${parts.join(", ")})` : "NULL::timestamp"
}

/** One uniform SELECT: type, id, party, warehouse, request_ts, date_ts, deliverer, done_by, done_ts, status. */
function select(fields: { type: PlanTaskType; party: string; warehouse: string; request: string; date: string; deliverer?: string; doneBy?: string; doneAt?: string }, from: string): string {
  return `SELECT '${fields.type}'::text AS type, id_col AS id, COALESCE(${fields.party}, '')::text AS party, COALESCE(${fields.warehouse}, '')::text AS warehouse,
    (${fields.request})::timestamp AS request_ts, (${fields.date})::timestamp AS date_ts, COALESCE(${fields.deliverer ?? "''"}, '')::text AS deliverer,
    COALESCE(${fields.doneBy ?? "''"}, '')::text AS done_by, (${fields.doneAt ?? "NULL::timestamp"})::timestamp AS done_ts, status_col AS status
  ${from}`
}

/** The SELECTs of a task tab (empty when none of its tables exist). */
function taskSources(tab: PlanTaskTab, t: StockTables): string[] {
  const parts: string[] = []
  const withIds = (sql: string, alias: string) => sql.replace("id_col", `${alias}.id`).replace("status_col", `COALESCE(${alias}.status, '')::text`)

  if ((tab === "receive" || tab === "receive_history") && t.has("supplier_incomings")) {
    const created = supplyCreated(t)
    if (tab === "receive") {
      parts.push(withIds(select({ type: "supply", party: "i.supplier", warehouse: "i.warehouse", request: created, date: created }, "FROM supplier_incomings i WHERE i.status = 'ожидает'"), "i"))
    } else {
      const accepted = t.col("supplier_incomings", "accepted_at") ? `COALESCE(${ts("i.accepted_at")}, ${created})` : created
      const by = columnOr(t, "supplier_incomings", "accepted_by", "i", "''")
      parts.push(withIds(select({ type: "supply", party: "i.supplier", warehouse: "i.warehouse", request: created, date: accepted, doneBy: by, doneAt: accepted }, "FROM supplier_incomings i WHERE i.status = 'принят'"), "i"))
    }
  }

  if (t.has("internal_transfers")) {
    const created = transferCreated(t)
    const planned = t.col("internal_transfers", "delivered_at") ? "fin_ts(tr.delivered_at)" : "NULL::timestamp"
    const givenAt = t.col("internal_transfers", "given_at") ? ts("tr.given_at") : "NULL::timestamp"
    const givenBy = columnOr(t, "internal_transfers", "given_by", "tr", "''")
    const acceptedAt = t.col("internal_transfers", "accepted_at") ? ts("tr.accepted_at") : "NULL::timestamp"
    const acceptedBy = columnOr(t, "internal_transfers", "accepted_by", "tr", "''")
    const driver = columnOr(t, "internal_transfers", "driver", "tr", "''")
    const base = { type: "transfer" as const, request: created, deliverer: driver }
    if (tab === "receive") {
      const expected = `COALESCE(${planned}, ${givenAt}, ${created})`
      parts.push(withIds(select({ ...base, party: "tr.from_warehouse", warehouse: "tr.to_warehouse", date: expected }, "FROM internal_transfers tr WHERE tr.status = 'в пути'"), "tr"))
    } else if (tab === "receive_history") {
      const done = `COALESCE(${acceptedAt}, ${planned}, ${created})`
      parts.push(withIds(select({ ...base, party: "tr.from_warehouse", warehouse: "tr.to_warehouse", date: done, doneBy: acceptedBy, doneAt: done }, "FROM internal_transfers tr WHERE tr.status = 'принят'"), "tr"))
    } else if (tab === "transfer") {
      parts.push(withIds(select({ ...base, party: "tr.to_warehouse", warehouse: "tr.from_warehouse", date: `COALESCE(${planned}, ${created})` }, "FROM internal_transfers tr WHERE tr.status = 'потвержден'"), "tr"))
    } else {
      const done = `COALESCE(${givenAt}, ${created})`
      parts.push(withIds(select({ ...base, party: "tr.to_warehouse", warehouse: "tr.from_warehouse", date: done, doneBy: givenBy, doneAt: done }, "FROM internal_transfers tr WHERE tr.status IN ('в пути', 'принят')"), "tr"))
    }
  }

  // Client returns: the client's goods come back into the return's warehouse
  // (pending → to receive; accepted → received). Returns without a warehouse
  // cannot be received anywhere, so they are not listed.
  if ((tab === "receive" || tab === "receive_history") && t.has("client_returns") && t.col("client_returns", "warehouse") && t.col("client_returns", "status")) {
    const created = t.col("client_returns", "created_at") ? ts("r.created_at") : "NULL::timestamp"
    const planned = t.col("client_returns", "return_date") ? `COALESCE(fin_ts(r.return_date), ${created})` : created
    const fields = {
      type: "order_return" as const,
      party: columnOr(t, "client_returns", "client", "r", "''"),
      warehouse: "r.warehouse",
      request: created,
      deliverer: columnOr(t, "client_returns", "deliverer", "r", "''"),
    }
    if (tab === "receive") {
      parts.push(withIds(select({ ...fields, date: planned }, "FROM client_returns r WHERE btrim(r.warehouse) <> '' AND r.status = 'pending'"), "r"))
    } else {
      const accepted = t.col("client_returns", "accepted_at") ? `COALESCE(${ts("r.accepted_at")}, ${planned})` : planned
      const by = columnOr(t, "client_returns", "accepted_by", "r", "''")
      parts.push(withIds(select({ ...fields, date: accepted, doneBy: by, doneAt: accepted }, "FROM client_returns r WHERE btrim(r.warehouse) <> '' AND r.status = 'accepted'"), "r"))
    }
  }

  // Orders leave a warehouse once they name it (orders.warehouse, contract 4).
  if ((tab === "transfer" || tab === "transfer_history") && t.has("orders") && t.col("orders", "warehouse")) {
    const created = orderCreated(t)
    const delivery = t.col("orders", "delivery") ? `COALESCE(fin_ts(o.delivery), ${created})` : created
    const fields = { type: "order" as const, party: columnOr(t, "orders", "client", "o", "''"), warehouse: "o.warehouse", request: created, date: delivery, deliverer: columnOr(t, "orders", "delivery_man", "o", "''") }
    if (tab === "transfer") parts.push(withIds(select(fields, "FROM orders o WHERE btrim(o.warehouse) <> '' AND o.status = 'Есть на складе'"), "o"))
    else parts.push(withIds(select({ ...fields, doneAt: delivery }, "FROM orders o WHERE btrim(o.warehouse) <> '' AND o.status IN ('В пути', 'Доставлено')"), "o"))
  }
  return parts
}

const EMPTY_TASKS = `SELECT ''::text AS type, 0 AS id, ''::text AS party, ''::text AS warehouse, NULL::timestamp AS request_ts, NULL::timestamp AS date_ts,
  ''::text AS deliverer, ''::text AS done_by, NULL::timestamp AS done_ts, ''::text AS status WHERE false`

function taskUnion(tab: PlanTaskTab, t: StockTables): string {
  const parts = taskSources(tab, t)
  return parts.length ? parts.join("\nUNION ALL\n") : EMPTY_TASKS
}

function taskWhere(filters: Partial<PlanTaskFilters>, params: Record<string, unknown>): string {
  const where = ["true"]
  if (filters.warehouses?.length) {
    where.push("fin_key(x.warehouse) IN (SELECT fin_key(w) FROM unnest(@pl_wh::text[]) AS w)")
    params.pl_wh = filters.warehouses
  }
  if (filters.type) {
    where.push("x.type = @pl_type")
    params.pl_type = filters.type
  }
  if (filters.doneBy?.length) {
    where.push("x.done_by = ANY(@pl_by::text[])")
    params.pl_by = filters.doneBy
  }
  if (filters.from) {
    where.push("x.date_ts >= @pl_from::date")
    params.pl_from = filters.from
  }
  if (filters.to) {
    where.push("x.date_ts < @pl_to::date + 1")
    params.pl_to = filters.to
  }
  const search = filters.search?.trim()
  if (search) {
    where.push("(x.id::text = @pl_q OR strpos(lower(x.party), @pl_ql) > 0 OR strpos(lower(x.warehouse), @pl_ql) > 0 OR strpos(lower(x.deliverer), @pl_ql) > 0)")
    params.pl_q = search.replace(/^№\s*/, "")
    params.pl_ql = search.toLowerCase()
  }
  return where.join(" AND ")
}

const SORTS: Record<string, string> = {
  id: "x.id",
  date: "x.date_ts",
  requestDate: "x.request_ts",
  warehouse: "lower(x.warehouse)",
  type: "x.type",
  party: "lower(x.party)",
  deliverer: "lower(x.deliverer)",
  doneBy: "lower(x.done_by)",
  doneAt: "x.done_ts",
}

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const expr = SORTS[desc ? ordering.slice(1) : ordering]
  const tail = "x.date_ts DESC NULLS LAST, x.type, x.id DESC"
  return expr ? `${expr} ${desc ? "DESC" : "ASC"} NULLS LAST, ${tail}` : tail
}

type TaskSqlRow = { type: string; id: number; party: string; warehouse: string; request: string; date: string; deliverer: string; done_by: string; done: string; status: string }

/** Named parameters for the db shim: none at all when the SQL has no @name (it would bind them positionally). */
const args = (sql: string, params: Record<string, unknown>): unknown[] => (sql.includes("@") ? [params] : [])

async function ready(db: PgDb): Promise<StockTables> {
  // stockTables() installs the fin_* SQL helpers first (ensureStockSchema).
  return stockTables(db)
}

/** One task tab, filtered, sorted and paged (pageSize 0 = every row, up to 5000). */
export async function listPlanTasks(tab: PlanTaskTab, filters: PlanTaskFilters, paging: PlanPaging, db: PgDb = getDb()): Promise<PlanTaskListResult> {
  const t = await ready(db)
  const union = taskUnion(tab, t)
  const params: Record<string, unknown> = {}
  const where = taskWhere(filters, params)
  const limit = paging.pageSize > 0 ? paging.pageSize : ALL_ROWS
  const offset = paging.pageSize > 0 ? (paging.page - 1) * paging.pageSize : 0
  const countSql = `SELECT COUNT(*)::int AS n FROM (${union}) x WHERE ${where}`
  const [rows, total, doneBy] = await Promise.all([
    db
      .prepare(
        `SELECT x.type, x.id, x.party, x.warehouse, ${iso("x.request_ts")} AS request, ${iso("x.date_ts")} AS date, x.deliverer, x.done_by, ${iso("x.done_ts")} AS done, x.status
           FROM (${union}) x WHERE ${where} ORDER BY ${orderBy(paging.ordering || "-date")} LIMIT @pl_limit OFFSET @pl_offset`,
      )
      .all({ ...params, pl_limit: limit, pl_offset: offset }) as Promise<TaskSqlRow[]>,
    db.prepare(countSql).get(...args(countSql, params)) as Promise<{ n: number } | undefined>,
    tab === "receive_history" || tab === "transfer_history"
      ? (db.prepare(`SELECT DISTINCT x.done_by AS name FROM (${union}) x WHERE btrim(x.done_by) <> '' ORDER BY 1`).all() as Promise<Array<{ name: string }>>)
      : Promise.resolve([]),
  ])
  return {
    tab,
    count: Number(total?.n) || 0,
    page: paging.pageSize > 0 ? paging.page : 1,
    pageSize: paging.pageSize,
    results: rows.map(
      (row): PlanTaskRow => ({
        type: row.type as PlanTaskType,
        id: Number(row.id),
        party: row.party,
        warehouse: row.warehouse,
        requestDate: row.request,
        date: row.date,
        deliverer: row.deliverer,
        doneBy: row.done_by,
        doneAt: row.done,
        status: row.status,
      }),
    ),
    doneByOptions: doneBy.map((row) => row.name),
  }
}

/** Number of rows of every task tab for the warehouse filter (tab badges). */
export async function countPlanTasks(warehouses: string[], db: PgDb = getDb()): Promise<PlanTaskCounts> {
  const t = await ready(db)
  const params: Record<string, unknown> = {}
  const where = taskWhere({ warehouses }, params)
  const parts = PLAN_TASK_TABS.map((tab) => `(SELECT COUNT(*)::int FROM (${taskUnion(tab, t)}) x WHERE ${where}) AS ${tab}`)
  const sql = `SELECT ${parts.join(", ")}`
  const row = (await db.prepare(sql).get(...args(sql, params))) as Record<string, number> | undefined
  return Object.fromEntries(PLAN_TASK_TABS.map((tab) => [tab, Number(row?.[tab]) || 0])) as PlanTaskCounts
}

// --- detail ---------------------------------------------------------------------------

/** JS twin of the SQL fin_key(): trimmed, single-spaced, lower-cased. */
function nameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function jsonArray(text: unknown): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(String(text ?? ""))
    return Array.isArray(parsed) ? parsed.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object") : []
  } catch {
    return []
  }
}

function lineQty(value: unknown): number {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(number) ? number : 0
}

type CatalogIndex = { byKey: Map<string, StockCatalogItem>; byName: Map<string, StockCatalogItem> }

async function catalogIndex(db: PgDb): Promise<CatalogIndex> {
  const items = await getStockCatalog(db)
  const byKey = new Map(items.map((item) => [item.key, item]))
  const byName = new Map<string, StockCatalogItem>()
  // Products first, then raw materials (the ledger's name matching order).
  for (const item of [...items.filter((entry) => entry.kind === "product"), ...items.filter((entry) => entry.kind !== "product")]) {
    const key = nameKey(item.name)
    if (key && !byName.has(key)) byName.set(key, item)
  }
  return { byKey, byName }
}

function product(index: CatalogIndex, name: string, qty: number, key = "", unit = ""): PlanItemProduct {
  const item = (key && index.byKey.get(key)) || index.byName.get(nameKey(name))
  return {
    key: item?.key ?? (key || `name:${nameKey(name)}`),
    name: item?.name ?? name.trim(),
    productType: item?.type ?? "",
    qty,
    unit: item?.unit || unit,
  }
}

type DetailRow = Record<string, unknown>
const text = (row: DetailRow, column: string) => String(row[column] ?? "")

/** The document behind a task row with its product lines (null = not found / no such table). */
export async function getPlanItem(type: PlanTaskType, id: number, db: PgDb = getDb()): Promise<PlanItemDetail | null> {
  const t = await ready(db)
  const empty = { givenBy: "", givenAt: "", acceptedBy: "", acceptedAt: "", deliverer: "", comment: "" }

  if (type === "supply" && t.has("supplier_incomings")) {
    const created = supplyCreated(t)
    const accepted = t.col("supplier_incomings", "accepted_at") ? ts("i.accepted_at") : "NULL::timestamp"
    const row = (await db
      .prepare(`SELECT i.*, ${iso(created)} AS pl_created, ${iso("fin_ts(i.date)")} AS pl_planned, ${iso(accepted)} AS pl_accepted FROM supplier_incomings i WHERE i.id = @pl_id`)
      .get({ pl_id: id })) as DetailRow | undefined
    if (!row) return null
    const index = await catalogIndex(db)
    return {
      ...empty,
      type,
      id,
      status: text(row, "status"),
      fromName: text(row, "supplier"),
      toName: text(row, "warehouse"),
      createdBy: text(row, "initiator"),
      createdAt: text(row, "pl_created"),
      plannedDate: text(row, "pl_planned"),
      acceptedBy: text(row, "accepted_by"),
      acceptedAt: text(row, "status") === "принят" ? text(row, "pl_accepted") : "",
      comment: text(row, "comment"),
      products: jsonArray(row.items).map((line) => product(index, String(line.product ?? ""), lineQty(line.qty))),
    }
  }

  if (type === "transfer" && t.has("internal_transfers")) {
    const givenAt = t.col("internal_transfers", "given_at") ? ts("tr.given_at") : "NULL::timestamp"
    const acceptedAt = t.col("internal_transfers", "accepted_at") ? ts("tr.accepted_at") : "NULL::timestamp"
    const planned = t.col("internal_transfers", "delivered_at") ? "fin_ts(tr.delivered_at)" : "NULL::timestamp"
    const row = (await db
      .prepare(
        `SELECT tr.*, ${iso(transferCreated(t))} AS pl_created, ${iso(planned)} AS pl_planned, ${iso(givenAt)} AS pl_given, ${iso(acceptedAt)} AS pl_accepted
           FROM internal_transfers tr WHERE tr.id = @pl_id`,
      )
      .get({ pl_id: id })) as DetailRow | undefined
    if (!row) return null
    const index = await catalogIndex(db)
    return {
      type,
      id,
      status: text(row, "status"),
      fromName: text(row, "from_warehouse"),
      toName: text(row, "to_warehouse"),
      createdBy: text(row, "created_by"),
      createdAt: text(row, "pl_created"),
      plannedDate: text(row, "pl_planned"),
      deliverer: text(row, "driver"),
      givenBy: text(row, "given_by"),
      givenAt: text(row, "pl_given"),
      acceptedBy: text(row, "accepted_by"),
      acceptedAt: text(row, "pl_accepted"),
      comment: text(row, "comment"),
      products: jsonArray(row.items).map((line) => product(index, String(line.product ?? ""), lineQty(line.quantity ?? line.qty))),
    }
  }

  if (type === "order_return" && t.has("client_returns")) {
    const created = t.col("client_returns", "created_at") ? ts("r.created_at") : "NULL::timestamp"
    const planned = t.col("client_returns", "return_date") ? "fin_ts(r.return_date)" : "NULL::timestamp"
    const accepted = t.col("client_returns", "accepted_at") ? ts("r.accepted_at") : "NULL::timestamp"
    const row = (await db
      .prepare(`SELECT r.*, ${iso(created)} AS pl_created, ${iso(planned)} AS pl_planned, ${iso(accepted)} AS pl_accepted FROM client_returns r WHERE r.id = @pl_id`)
      .get({ pl_id: id })) as DetailRow | undefined
    if (!row) return null
    const index = await catalogIndex(db)
    const lines =
      t.has("client_return_items") && t.col("client_return_items", "return_id")
        ? ((await db.prepare("SELECT * FROM client_return_items WHERE return_id = @pl_id ORDER BY id").all({ pl_id: id })) as DetailRow[])
        : []
    return {
      ...empty,
      type,
      id,
      status: text(row, "status"),
      fromName: text(row, "client"),
      toName: text(row, "warehouse"),
      createdBy: text(row, "created_by"),
      createdAt: text(row, "pl_created"),
      plannedDate: text(row, "pl_planned"),
      deliverer: text(row, "deliverer"),
      acceptedBy: text(row, "status") === "accepted" ? text(row, "accepted_by") : "",
      acceptedAt: text(row, "status") === "accepted" ? text(row, "pl_accepted") : "",
      comment: text(row, "comment"),
      products: lines.map((line) =>
        product(index, text(line, "product_name"), lineQty(line.quantity), line.product_id ? `product:${line.product_id}` : "", text(line, "unit")),
      ),
    }
  }

  if (type === "order" && t.has("orders")) {
    const created = orderCreated(t)
    const delivery = t.col("orders", "delivery") ? "fin_ts(o.delivery)" : "NULL::timestamp"
    const row = (await db
      .prepare(`SELECT o.*, ${iso(created)} AS pl_created, ${iso(delivery)} AS pl_planned FROM orders o WHERE o.id = @pl_id`)
      .get({ pl_id: id })) as DetailRow | undefined
    if (!row) return null
    const index = await catalogIndex(db)
    const lines = t.has("order_items")
      ? ((await db.prepare("SELECT * FROM order_items WHERE order_id = @pl_id ORDER BY id").all({ pl_id: id })) as DetailRow[])
      : []
    const shipped = ["В пути", "Доставлено"].includes(text(row, "status"))
    return {
      ...empty,
      type,
      id,
      status: text(row, "status"),
      fromName: text(row, "warehouse"),
      toName: text(row, "client"),
      createdBy: text(row, "agent"),
      createdAt: text(row, "pl_created"),
      plannedDate: text(row, "pl_planned"),
      deliverer: text(row, "delivery_man"),
      givenAt: shipped ? text(row, "pl_planned") : "",
      products: lines.map((line) =>
        product(index, text(line, "product_name"), lineQty(line.quantity), line.product_id ? `product:${line.product_id}` : "", text(line, "unit")),
      ),
    }
  }
  return null
}
