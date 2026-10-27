import "server-only"

import { getDb } from "@/lib/db"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { roundMoney } from "@/lib/finance/currency"
import { orderCountedSql } from "@/lib/finance/sources"
import { addDays, dayStartMs } from "@/lib/field-activity/input"
import { photosOf } from "@/lib/field-activity/photos-repo"
import { columnsOf, ensureFieldSchema } from "@/lib/field-activity/schema"
import { keySql } from "@/lib/platform-refs"
import {
  FIELD_EVENT_KINDS,
  MAX_PAGE_SIZE,
  type FieldEvent,
  type FieldEventFilter,
  type FieldEventKind,
  type FieldTotals,
  type KindTotal,
  type VisitResult,
} from "@/lib/field-activity/types"

// One event stream for the field pages (design §4): the stored field records (visits,
// refusals, photo reports) merged with what the existing documents already say (orders,
// deliveries, client payments, client returns). Both pages list and count through these two
// functions, so a header count always equals the number of cards its list can load.
//
// Documents name their employee by text; it is matched to employees.id by the finance name key
// (fin_key(first_name || ' ' || last_name), lowest id), like the KPI facts. Every amount keeps
// its own currency; amountBase converts it with the current rates of Валюты.

export type FieldEventQuery = FieldEventFilter & {
  /** Drop orders / deliveries of cancelled and unconfirmed orders (counted = false). */
  excludeCancelled?: boolean
}

const DAY_MS = 24 * 60 * 60_000

const COLUMN_TYPES = {
  kind: "text",
  source_id: "int",
  at: "timestamp",
  employee_id: "int",
  employee_raw: "text",
  client_id: "int",
  client_raw: "text",
  order_id: "int",
  status: "text",
  cancelled: "boolean",
  counted: "boolean",
  amount: "float8",
  currency: "text",
  amount_base: "float8",
  comment: "text",
  reason: "text",
  refusal_type_id: "int",
  visit_id: "int",
  lat: "float8",
  lng: "float8",
  v_started: "timestamp",
  v_finished: "timestamp",
  v_result: "text",
  v_planned: "boolean",
  v_start_lat: "float8",
  v_start_lng: "float8",
  v_end_lat: "float8",
  v_end_lng: "float8",
  v_client_lat: "float8",
  v_client_lng: "float8",
  v_distance: "float8",
  v_refusal_id: "int",
  v_report_id: "int",
} as const

type Column = keyof typeof COLUMN_TYPES

const DEFAULTS: Partial<Record<Column, string>> = {
  employee_raw: "''",
  client_raw: "''",
  status: "''",
  cancelled: "false",
  counted: "true",
  comment: "''",
  reason: "''",
}

/** The select list of one source, every column cast to its type (UNION ALL needs one shape). */
function selectList(values: Partial<Record<Column, string>>): string {
  return (Object.keys(COLUMN_TYPES) as Column[])
    .map((column) => `CAST(${values[column] ?? DEFAULTS[column] ?? "NULL"} AS ${COLUMN_TYPES[column]}) AS ${column}`)
    .join(",\n    ")
}

/** Local (Asia/Tashkent, UTC+5) timestamp of a timestamptz column, like fin_ts() of a UTC text. */
const localTs = (expr: string) => `((${expr}) AT TIME ZONE 'UTC') + interval '5 hours'`

/** Base-currency multiplier of a canonical currency expression (NULL when the rate is unknown). */
const toBase = (cur: string) => `(CASE WHEN ${cur} = @base::text THEN 1::float8 ELSE (SELECT fx.rate FROM rates fx WHERE fx.code = ${cur}) END)`

type Ctx = { s: FinanceSchema; extra: Map<string, Set<string>>; excludeCancelled: boolean }

const has = (ctx: Ctx, table: string, column?: string) =>
  ctx.s.has(table) ? !column || ctx.s.col(table, column) : column ? Boolean(ctx.extra.get(table)?.has(column)) : ctx.extra.has(table)

/** `expr` when the column exists, else `fallback`. */
const col = (ctx: Ctx, table: string, column: string, expr: string, fallback: string) => (has(ctx, table, column) ? expr : fallback)

/** Client of a document `alias` (by client_id, else by name for legacy rows). */
function clientJoin(ctx: Ctx, table: string, alias: string): { join: string; id: string; raw: string } {
  const byId = has(ctx, table, "client_id")
  const hasName = has(ctx, table, "client")
  if (!hasName) return { join: "", id: byId ? `${alias}.client_id` : "NULL", raw: "''" }
  return {
    join: `LEFT JOIN ck ${alias}_ck ON ${byId ? `${alias}.client_id IS NULL AND ` : ""}${alias}_ck.k = fin_key(${alias}.client)`,
    id: byId ? `COALESCE(${alias}.client_id, ${alias}_ck.id)` : `${alias}_ck.id`,
    raw: `COALESCE(${alias}.client, '')`,
  }
}

/** Employee named by a text column (joined by name key). */
function employeeJoin(ctx: Ctx, table: string, alias: string, column: string, joinAlias: string): { join: string; id: string; raw: string } {
  if (!has(ctx, table, column)) return { join: "", id: "NULL", raw: "''" }
  return {
    join: `LEFT JOIN ek ${joinAlias} ON fin_key(${alias}.${column}) <> '' AND ${joinAlias}.k = fin_key(${alias}.${column})`,
    id: `${joinAlias}.id`,
    raw: `COALESCE(NULLIF(btrim(${alias}.${column}), ''), '')`,
  }
}

/** Amount of an order `o` (its lines, else the amount text), its single currency and the base equivalent. */
function orderAmount(ctx: Ctx): { joins: string; amount: string; currency: string; base: string } {
  const orderCur = col(ctx, "orders", "currency", "fin_cur(o.currency)", "NULL::text")
  const hasItems = has(ctx, "order_items", "order_id") && has(ctx, "order_items", "quantity") && has(ctx, "order_items", "unit_price")
  const joins: string[] = []
  if (hasItems) {
    const itemCur = `COALESCE(${col(ctx, "order_items", "currency", "fin_cur(i.currency)", "NULL::text")}, ${orderCur}, @base::text)`
    const discount = col(ctx, "order_items", "discount_percent", "COALESCE(i.discount_percent, 0)::float8", "0::float8")
    joins.push(`LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n, SUM(x.q) AS amount, MIN(x.cur) AS cmin, MAX(x.cur) AS cmax, SUM(x.q * ${toBase("x.cur")}) AS base
        FROM (SELECT i.quantity::float8 * i.unit_price::float8 * (1 - ${discount} / 100) AS q, ${itemCur} AS cur
                FROM order_items i WHERE i.order_id = o.id) x) oi ON true`)
  }
  const textCur = `COALESCE(a.currency, ${orderCur}, @base::text)`
  joins.push(`LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS amount, MIN(${textCur}) AS cmin, MAX(${textCur}) AS cmax, SUM(a.amount * ${toBase(textCur)}) AS base
        FROM fin_amounts(o.amount) a ${hasItems ? "WHERE COALESCE(oi.n, 0) = 0" : ""}) ot ON true`)
  if (!hasItems) {
    return {
      joins: joins.join("\n"),
      amount: "CASE WHEN ot.cmin = ot.cmax THEN ot.amount END",
      currency: "CASE WHEN ot.cmin = ot.cmax THEN ot.cmin END",
      base: "ot.base",
    }
  }
  return {
    joins: joins.join("\n"),
    amount: "CASE WHEN COALESCE(oi.n, 0) > 0 THEN (CASE WHEN oi.cmin = oi.cmax THEN oi.amount END) ELSE (CASE WHEN ot.cmin = ot.cmax THEN ot.amount END) END",
    currency: "CASE WHEN COALESCE(oi.n, 0) > 0 THEN (CASE WHEN oi.cmin = oi.cmax THEN oi.cmin END) ELSE (CASE WHEN ot.cmin = ot.cmax THEN ot.cmin END) END",
    base: "CASE WHEN COALESCE(oi.n, 0) > 0 THEN oi.base ELSE ot.base END",
  }
}

const CANCELLED = (alias: string) => `(${alias}.status = 'Отменен')`

function orderSource(ctx: Ctx): string {
  const client = clientJoin(ctx, "orders", "o")
  const employee = employeeJoin(ctx, "orders", "o", "agent", "oe")
  const money = orderAmount(ctx)
  const at = "fin_ts(o.created_at, true)"
  return `SELECT ${selectList({
    kind: "'order'",
    source_id: "o.id",
    at,
    employee_id: employee.id,
    employee_raw: employee.raw,
    client_id: client.id,
    client_raw: client.raw,
    order_id: "o.id",
    status: "COALESCE(o.status, '')",
    cancelled: CANCELLED("o"),
    counted: orderCountedSql("o"),
    amount: money.amount,
    currency: money.currency,
    amount_base: money.base,
    comment: col(ctx, "orders", "comment", "COALESCE(o.comment, '')", "''"),
  })}
  FROM orders o
  ${client.join}
  ${employee.join}
  ${money.joins}
  WHERE ${at} >= @from::timestamp AND ${at} < @to::timestamp${ctx.excludeCancelled ? ` AND ${orderCountedSql("o")}` : ""}`
}

function deliverySource(ctx: Ctx): string {
  const client = clientJoin(ctx, "orders", "o")
  const employee = employeeJoin(ctx, "orders", "o", "delivery_man", "de")
  const money = orderAmount(ctx)
  const moments = [
    has(ctx, "order_logs", "status") && has(ctx, "order_logs", "created_at")
      ? "(SELECT MAX(fin_ts(l.created_at, true)) FROM order_logs l WHERE l.order_id = d.id AND l.status = 'Доставлено')"
      : "",
    col(ctx, "orders", "shipped_at", "fin_ts(d.shipped_at::text, true)", ""),
    col(ctx, "orders", "updated_at", "fin_ts(d.updated_at, true)", ""),
    "fin_ts(d.created_at, true)",
  ].filter(Boolean)
  return `SELECT ${selectList({
    kind: "'delivery'",
    source_id: "o.id",
    at: "o.delivered_at",
    employee_id: employee.id,
    employee_raw: employee.raw,
    client_id: client.id,
    client_raw: client.raw,
    order_id: "o.id",
    status: "COALESCE(o.status, '')",
    amount: money.amount,
    currency: money.currency,
    amount_base: money.base,
  })}
  FROM (SELECT d.*, COALESCE(${moments.join(", ")}) AS delivered_at FROM orders d WHERE d.status = 'Доставлено') o
  ${client.join}
  ${employee.join}
  ${money.joins}
  WHERE o.delivered_at >= @from::timestamp AND o.delivered_at < @to::timestamp`
}

function paymentSource(ctx: Ctx): string {
  const T = "customer_payments"
  const client = clientJoin(ctx, T, "p")
  const agent = employeeJoin(ctx, T, "p", "agent", "pa")
  const courier = employeeJoin(ctx, T, "p", "delivery_man", "pd")
  const byId = has(ctx, T, "delivery_man_id")
  const ids = [agent.id, byId ? "pde.id" : "", courier.id].filter((value) => value && value !== "NULL")
  const raws = [agent.raw, courier.raw].filter((value) => value !== "''")
  const moments = [
    col(ctx, T, "payment_date", "fin_ts(p.payment_date)", ""),
    col(ctx, T, "paid_at", "fin_ts(p.paid_at)", ""),
    col(ctx, T, "created_at", "fin_ts(p.created_at, true)", ""),
  ].filter(Boolean)
  if (!moments.length || !has(ctx, T, "amount")) return ""
  const at = `COALESCE(${moments.join(", ")})`
  const cur = `COALESCE(${col(ctx, T, "currency", "fin_cur(p.currency)", "NULL::text")}, @base::text)`
  return `SELECT ${selectList({
    kind: "'payment'",
    source_id: "p.id",
    at,
    employee_id: ids.length ? `COALESCE(${ids.join(", ")})` : "NULL",
    employee_raw: raws.length ? `COALESCE(${raws.map((raw) => `NULLIF(${raw}, '')`).join(", ")}, '')` : "''",
    client_id: client.id,
    client_raw: client.raw,
    order_id: col(ctx, T, "order_id", "p.order_id", "NULL"),
    status: col(ctx, T, "accepted", "CASE WHEN p.accepted = 1 THEN 'accepted' ELSE 'pending' END", "'accepted'"),
    amount: "p.amount",
    currency: cur,
    amount_base: `p.amount * ${toBase(cur)}`,
    comment: col(ctx, T, "comment", "COALESCE(p.comment, '')", "''"),
  })}
  FROM ${T} p
  ${client.join}
  ${agent.join}
  ${byId ? "LEFT JOIN employees pde ON pde.id = p.delivery_man_id" : ""}
  ${courier.join}
  WHERE ${at} >= @from::timestamp AND ${at} < @to::timestamp${col(ctx, T, "is_deleted", " AND COALESCE(p.is_deleted, 0) = 0", "")}`
}

function returnSource(ctx: Ctx): string {
  const T = "client_returns"
  if (!has(ctx, T, "created_at") || !has(ctx, T, "amount")) return ""
  const client = clientJoin(ctx, T, "r")
  const agent = employeeJoin(ctx, T, "r", "agent", "ra")
  const deliverer = employeeJoin(ctx, T, "r", "deliverer", "rd")
  const created = "fin_ts(r.created_at, true)"
  // The return's own day, with the time it was entered when that was the same day.
  const at = has(ctx, T, "return_date")
    ? `CASE WHEN fin_ts(r.return_date) IS NULL OR ${created}::date = fin_ts(r.return_date)::date THEN ${created} ELSE fin_ts(r.return_date) END`
    : created
  const cur = `COALESCE(${col(ctx, T, "currency", "fin_cur(r.currency)", "NULL::text")}, @base::text)`
  const ids = [agent.id, deliverer.id].filter((value) => value !== "NULL")
  const raws = [agent.raw, deliverer.raw].filter((value) => value !== "''")
  return `SELECT ${selectList({
    kind: "'return'",
    source_id: "r.id",
    at,
    employee_id: ids.length ? `COALESCE(${ids.join(", ")})` : "NULL",
    employee_raw: raws.length ? `COALESCE(${raws.map((raw) => `NULLIF(${raw}, '')`).join(", ")}, '')` : "''",
    client_id: client.id,
    client_raw: client.raw,
    order_id: col(ctx, T, "order_id", "r.order_id", "NULL"),
    status: col(ctx, T, "status", "COALESCE(r.status, '')", "''"),
    amount: "r.amount",
    currency: cur,
    amount_base: `r.amount * ${toBase(cur)}`,
    comment: col(ctx, T, "comment", "COALESCE(r.comment, '')", "''"),
  })}
  FROM ${T} r
  ${client.join}
  ${agent.join}
  ${deliverer.join}
  WHERE ${at} >= @from::timestamp AND ${at} < @to::timestamp${col(ctx, T, "status", " AND COALESCE(r.status, '') <> 'cancelled'", "")}`
}

function visitSource(): string {
  return `SELECT ${selectList({
    kind: "'visit'",
    source_id: "v.id",
    at: localTs("v.started_at"),
    employee_id: "v.employee_id",
    client_id: "v.client_id",
    order_id: "v.order_id",
    status: "CASE WHEN v.finished_at IS NULL THEN 'open' ELSE 'finished' END",
    comment: "v.comment",
    visit_id: "v.id",
    lat: "v.start_lat",
    lng: "v.start_lng",
    v_started: localTs("v.started_at"),
    v_finished: localTs("v.finished_at"),
    v_result: "v.result",
    v_planned: "v.planned",
    v_start_lat: "v.start_lat",
    v_start_lng: "v.start_lng",
    v_end_lat: "v.end_lat",
    v_end_lng: "v.end_lng",
    v_client_lat: "v.client_lat",
    v_client_lng: "v.client_lng",
    v_distance: "v.distance_m",
    v_refusal_id: "fr.id",
    v_report_id: "fp.id",
  })}
  FROM field_visits v
  LEFT JOIN field_refusals fr ON fr.visit_id = v.id
  LEFT JOIN field_photo_reports fp ON fp.visit_id = v.id
  WHERE v.started_at >= @fromUtc::timestamptz AND v.started_at < @toUtc::timestamptz`
}

function refusalSource(ctx: Ctx): string {
  const types = has(ctx, "refusal_types", "name")
  return `SELECT ${selectList({
    kind: "'refusal'",
    source_id: "f.id",
    at: localTs("f.happened_at"),
    employee_id: "f.employee_id",
    client_id: "f.client_id",
    status: "'done'",
    comment: "f.comment",
    reason: types ? "COALESCE(rt.name, f.reason)" : "f.reason",
    refusal_type_id: "f.refusal_type_id",
    visit_id: "f.visit_id",
    lat: "f.lat",
    lng: "f.lng",
  })}
  FROM field_refusals f
  ${types ? "LEFT JOIN refusal_types rt ON rt.id = f.refusal_type_id" : ""}
  WHERE f.happened_at >= @fromUtc::timestamptz AND f.happened_at < @toUtc::timestamptz`
}

function reportSource(): string {
  return `SELECT ${selectList({
    kind: "'photo_report'",
    source_id: "f.id",
    at: localTs("f.happened_at"),
    employee_id: "f.employee_id",
    client_id: "f.client_id",
    status: "f.status",
    comment: "f.comment",
    visit_id: "f.visit_id",
    lat: "f.lat",
    lng: "f.lng",
  })}
  FROM field_photo_reports f
  WHERE f.happened_at >= @fromUtc::timestamptz AND f.happened_at < @toUtc::timestamptz`
}

type Built = { sql: string; params: Record<string, unknown>; base: string } | { sql: null; base: string }

/** The `WITH … ev AS (…), f AS (filtered events joined to their employee / client)` prefix. */
async function buildFiltered(query: FieldEventQuery): Promise<Built> {
  await ensureFieldSchema()
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const extra = await columnsOf(["order_logs", "inventory_items", "refusal_types"])
  const baseRow = s.has("currencies")
    ? ((await db.prepare("SELECT fin_cur(code) AS code FROM currencies WHERE is_base = 1 ORDER BY id LIMIT 1").get()) as { code: string | null } | undefined)
    : undefined
  const base = baseRow?.code || "SUM"
  const kinds = new Set<FieldEventKind>(query.kinds?.length ? query.kinds : FIELD_EVENT_KINDS)
  const empty = (query.employeeIds && !query.employeeIds.length) || (query.clientIds && !query.clientIds.length)
  if (empty) return { sql: null, base }
  const ctx: Ctx = { s, extra, excludeCancelled: Boolean(query.excludeCancelled) }
  const sources: string[] = []
  if (kinds.has("order")) sources.push(orderSource(ctx))
  if (kinds.has("delivery")) sources.push(deliverySource(ctx))
  if (kinds.has("payment") && s.has("customer_payments")) sources.push(paymentSource(ctx))
  if (kinds.has("return") && s.has("client_returns")) sources.push(returnSource(ctx))
  if (kinds.has("visit")) sources.push(visitSource())
  if (kinds.has("refusal")) sources.push(refusalSource(ctx))
  if (kinds.has("photo_report")) sources.push(reportSource())
  const union = sources.filter(Boolean)
  if (!union.length) return { sql: null, base }

  const where: string[] = []
  if (query.employeeIds) where.push("ev.employee_id = ANY(@employeeIds::int[])")
  if (query.onlyAttributed) where.push("ev.employee_id IS NOT NULL")
  if (query.clientIds) where.push("ev.client_id = ANY(@clientIds::int[])")
  if (query.branchId) {
    where.push(s.has("branches") ? `${keySql("e.branch")} = (SELECT ${keySql("b.name")} FROM branches b WHERE b.id = @branchId)` : "false")
  }
  if (query.clientTypeIds?.length) {
    where.push(s.has("client_types") ? "fin_key(c.type) IN (SELECT fin_key(t.name) FROM client_types t WHERE t.id = ANY(@clientTypeIds::int[]))" : "false")
  }
  if (query.withEquipment !== undefined) {
    const equipment =
      has(ctx, "inventory_items", "client_id")
        ? `EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.client_id = ev.client_id${has(ctx, "inventory_items", "deleted") ? " AND COALESCE(ii.deleted, 0) = 0" : ""})`
        : "false"
    where.push(query.withEquipment ? equipment : `ev.client_id IS NOT NULL AND NOT ${equipment}`)
  }

  const ctes = [
    s.has("currencies")
      ? "rates AS (SELECT fin_cur(code) AS code, MAX(rate)::float8 AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1)"
      : "rates AS (SELECT NULL::text AS code, NULL::float8 AS rate WHERE false)",
    "ek AS (SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1)",
    "ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1)",
    `ev AS (\n${union.join("\nUNION ALL\n")}\n)`,
    `f AS (
      SELECT ev.*,
             COALESCE(NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), ''), NULLIF(ev.employee_raw, ''), '') AS employee_name,
             COALESCE(c.name, NULLIF(ev.client_raw, ''), '') AS client_name
        FROM ev
        LEFT JOIN employees e ON e.id = ev.employee_id
        LEFT JOIN clients c ON c.id = ev.client_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""})`,
  ]
  const fromMs = dayStartMs(query.from)
  const toMs = dayStartMs(query.to) + DAY_MS
  return {
    sql: `WITH ${ctes.join(",\n")}`,
    base,
    params: {
      base,
      from: `${query.from}T00:00:00`,
      to: `${addDays(query.to, 1)}T00:00:00`,
      fromUtc: new Date(fromMs).toISOString(),
      toUtc: new Date(toMs).toISOString(),
      employeeIds: query.employeeIds ?? [],
      clientIds: query.clientIds ?? [],
      branchId: query.branchId ?? 0,
      clientTypeIds: query.clientTypeIds ?? [],
    },
  }
}

type EventRow = {
  kind: FieldEventKind
  source_id: number
  at_text: string
  employee_id: number | null
  employee_name: string
  client_id: number | null
  client_name: string
  order_id: number | null
  status: string
  cancelled: boolean
  counted: boolean
  amount: number | null
  currency: string | null
  amount_base: number | null
  comment: string
  reason: string
  refusal_type_id: number | null
  visit_id: number | null
  lat: number | null
  lng: number | null
  v_started_text: string | null
  v_finished_text: string | null
  v_result: VisitResult | null
  v_planned: boolean | null
  v_start_lat: number | null
  v_start_lng: number | null
  v_end_lat: number | null
  v_end_lng: number | null
  v_client_lat: number | null
  v_client_lng: number | null
  v_distance: number | null
  v_refusal_id: number | null
  v_report_id: number | null
  total: string | number
}

const num = (value: number | string | null | undefined) => (value === null || value === undefined ? null : Number(value))
/** An amount without float noise (2 decimals, like formatMoney). */
const money = (value: number | string | null | undefined) => (value === null || value === undefined ? null : roundMoney(Number(value)))

function durationSec(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  return Math.round((Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 1000)
}

function rowToEvent(row: EventRow): FieldEvent {
  const visit =
    row.kind === "visit" && row.v_started_text
      ? {
          startedAt: row.v_started_text,
          finishedAt: row.v_finished_text,
          durationSec: durationSec(row.v_started_text, row.v_finished_text),
          result: row.v_result,
          planned: Boolean(row.v_planned),
          startLat: num(row.v_start_lat),
          startLng: num(row.v_start_lng),
          endLat: num(row.v_end_lat),
          endLng: num(row.v_end_lng),
          clientLat: num(row.v_client_lat),
          clientLng: num(row.v_client_lng),
          distanceM: num(row.v_distance),
          refusalId: num(row.v_refusal_id),
          reportId: num(row.v_report_id),
        }
      : null
  return {
    kind: row.kind,
    id: `${row.kind}:${row.source_id}`,
    sourceId: Number(row.source_id),
    at: row.at_text,
    day: row.at_text.slice(0, 10),
    employeeId: num(row.employee_id),
    employeeName: row.employee_name ?? "",
    clientId: num(row.client_id),
    clientName: row.client_name ?? "",
    orderId: num(row.order_id),
    status: row.status ?? "",
    cancelled: Boolean(row.cancelled),
    counted: Boolean(row.counted),
    amount: money(row.amount),
    currency: row.currency ?? null,
    amountBase: money(row.amount_base),
    comment: row.comment ?? "",
    reason: row.reason ?? "",
    refusalTypeId: num(row.refusal_type_id),
    visitId: num(row.visit_id),
    lat: num(row.lat),
    lng: num(row.lng),
    photos: [],
    visit,
  }
}

const LOCAL_TEXT = `'YYYY-MM-DD"T"HH24:MI:SS'`

/**
 * One page of the event stream, newest first (at DESC, kind, sourceId DESC), and the total count
 * of events matching the filter. Refusals and photo reports carry their photos.
 */
export async function listFieldEvents(query: FieldEventQuery, page: { limit: number; offset: number }): Promise<{ count: number; rows: FieldEvent[]; baseCurrency: string }> {
  const built = await buildFiltered(query)
  if (built.sql === null) return { count: 0, rows: [], baseCurrency: built.base }
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(page.limit)))
  const offset = Math.max(0, Math.floor(page.offset))
  const db = getDb()
  const rows = (await db
    .prepare(
      `${built.sql}
       SELECT f.*, to_char(f.at, ${LOCAL_TEXT}) AS at_text, to_char(f.v_started, ${LOCAL_TEXT}) AS v_started_text,
              to_char(f.v_finished, ${LOCAL_TEXT}) AS v_finished_text, COUNT(*) OVER () AS total
         FROM f
        ORDER BY f.at DESC, f.kind, f.source_id DESC
        LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(built.params)) as EventRow[]
  let count = rows.length ? Number(rows[0].total) : 0
  if (!rows.length && offset > 0) {
    const row = (await db.prepare(`${built.sql} SELECT COUNT(*)::int AS n FROM f`).get(built.params)) as { n: number }
    count = Number(row.n)
  }
  const events = rows.map(rowToEvent)
  const refusalIds = events.filter((event) => event.kind === "refusal").map((event) => event.sourceId)
  const reportIds = events.filter((event) => event.kind === "photo_report").map((event) => event.sourceId)
  const [refusalPhotos, reportPhotos] = [await photosOf("refusal", refusalIds), await photosOf("photo_report", reportIds)]
  for (const event of events) {
    if (event.kind === "refusal") event.photos = refusalPhotos.get(event.sourceId) ?? []
    if (event.kind === "photo_report") event.photos = reportPhotos.get(event.sourceId) ?? []
  }
  return { count, rows: events, baseCurrency: built.base }
}

function emptyTotal(): KindTotal {
  return { count: 0, amountBase: null, byCurrency: [] }
}

function addTo(total: KindTotal, row: { n: number; currency: string | null; amount: number | null; base: number | null }) {
  total.count += Number(row.n)
  if (row.base !== null && row.base !== undefined) total.amountBase = (total.amountBase ?? 0) + Number(row.base)
  if (row.currency && row.amount !== null && row.amount !== undefined) {
    const entry = total.byCurrency.find((item) => item.currency === row.currency)
    if (entry) entry.amount += Number(row.amount)
    else total.byCurrency.push({ currency: row.currency, amount: Number(row.amount) })
  }
}

/** Counts and sums of the event stream per kind and per employee (same filter as listFieldEvents). */
export async function fieldEventTotals(query: FieldEventQuery): Promise<FieldTotals> {
  const built = await buildFiltered(query)
  const byKind = Object.fromEntries(FIELD_EVENT_KINDS.map((kind) => [kind, emptyTotal()])) as Record<FieldEventKind, KindTotal>
  if (built.sql === null) return { baseCurrency: built.base, byKind, byEmployee: [] }
  const rows = (await getDb()
    .prepare(
      `${built.sql}
       SELECT 'g' AS t, f.kind, f.employee_id, f.currency, COUNT(*)::int AS n, SUM(f.amount) AS amount, SUM(f.amount_base) AS base, 0 AS visited
         FROM f GROUP BY f.kind, f.employee_id, f.currency
       UNION ALL
       SELECT 'v' AS t, 'visit', f.employee_id, NULL, 0, NULL, NULL, COUNT(DISTINCT f.client_id)::int
         FROM f WHERE f.kind = 'visit' GROUP BY f.employee_id`,
    )
    .all(built.params)) as Array<{
    t: "g" | "v"
    kind: FieldEventKind
    employee_id: number | null
    currency: string | null
    n: number
    amount: number | null
    base: number | null
    visited: number
  }>
  const employees = new Map<number | null, { employeeId: number | null; byKind: Partial<Record<FieldEventKind, KindTotal>>; visitedClients: number }>()
  const employeeEntry = (id: number | null) => {
    let entry = employees.get(id)
    if (!entry) employees.set(id, (entry = { employeeId: id, byKind: {}, visitedClients: 0 }))
    return entry
  }
  for (const row of rows) {
    const employeeId = row.employee_id === null ? null : Number(row.employee_id)
    const entry = employeeEntry(employeeId)
    if (row.t === "v") {
      entry.visitedClients = Number(row.visited)
      continue
    }
    addTo(byKind[row.kind], row)
    addTo((entry.byKind[row.kind] ??= emptyTotal()), row)
  }
  const tidy = (total: KindTotal) => {
    if (total.amountBase !== null) total.amountBase = roundMoney(total.amountBase)
    for (const entry of total.byCurrency) entry.amount = roundMoney(entry.amount)
  }
  Object.values(byKind).forEach(tidy)
  for (const entry of employees.values()) Object.values(entry.byKind).forEach((total) => total && tidy(total))
  return {
    baseCurrency: built.base,
    byKind,
    byEmployee: [...employees.values()].sort((a, b) => (a.employeeId ?? Number.MAX_SAFE_INTEGER) - (b.employeeId ?? Number.MAX_SAFE_INTEGER)),
  }
}
