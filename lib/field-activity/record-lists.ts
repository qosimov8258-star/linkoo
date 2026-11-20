import "server-only"

import { getDb } from "@/lib/db"
import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { scopedEmployeeIds, type FieldScope } from "@/lib/field-activity/actor"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { boolParam, dayParam, dayStartMs, idsParam, pageParams, type QueryResult } from "@/lib/field-activity/input"
import { photosOf } from "@/lib/field-activity/photos-repo"
import {
  PHOTO_REPORT_STATUSES,
  RECORD_LIST_MAX_PAGE_SIZE,
  type ClientFieldCount,
  type ClientVisitPage,
  type FieldOption,
  type FieldRecordFacets,
  type FieldRecordRow,
  type PhotoTypeGroup,
} from "@/lib/field-activity/record-list-types"
import { columnsOf, ensureFieldSchema } from "@/lib/field-activity/schema"
import { isIsoDay } from "@/lib/finance/dates"
import { MAX_DB_ID } from "@/lib/strict-number"

// Read-only lists over the mobile app's refusals and photo reports, for the Продажи pages
// "Отказы" and "Фотоотчеты" and the client card (ОТКАЗЫ / ОТЧЕТЫ / ЗАДАЧИ), and per-client
// visit / refusal counts for "Анализ покрытия". Same tables and rules as
// lib/field-activity/records.ts and events.ts (the one source of truth for field data): times are
// instants shown as local Asia/Tashkent text, employees are employees.id, clients clients.id,
// refusal reasons the current refusal type name.
//
// Paging: page / pageSize (numbered pages, the Отказы table) or a keyset cursor (?before= the
// previous page's nextCursor: "Загрузить еще..."), which records that arrive meanwhile cannot shift.

const DAY_MS = 24 * 60 * 60_000
const EMPLOYEE_NAME = "NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '')"
const LOCAL_TEXT = `'YYYY-MM-DD"T"HH24:MI:SS'`
const localTs = (expr: string) => `((${expr}) AT TIME ZONE 'UTC') + interval '5 hours'`

export type FieldRecordKind = "refusal" | "photo_report"

export type FieldRecordListFilter = {
  /** Local days "YYYY-MM-DD", inclusive; either may be empty (open end). */
  from?: string
  to?: string
  /** undefined = everyone; [] = nothing. */
  employeeIds?: number[]
  clientIds?: number[]
  /** Refusals only. */
  refusalTypeIds?: number[]
  /** Photo reports only. */
  statuses?: string[]
  /** Photo reports only (the reference's filter card): the author's supervisor (employees.details.supervisorId), the
   * shop's branch / client type (client_types ids) / Категория канала (clients.sales_channel) / ИНН, a photo group
   * name (Категория фотоотчета), and whether the shop has equipment (inventory_items.client_id). */
  supervisorIds?: number[]
  branches?: string[]
  clientTypeIds?: number[]
  channels?: string[]
  inns?: string[]
  categories?: string[]
  withEquipment?: boolean
  /** Photo reports only: Бренд of the reference's card. A report records no products here, so a chosen brand matches
   * no report (the reference answers 0 for every brand of this account too). */
  brandIds?: number[]
  /** Photo reports only: these reports (the photo viewer opened from a link). */
  ids?: number[]
  /** Photo reports only: the shop's branch by branches.id (the reference's filter keeps branch ids in its link). */
  branchIds?: number[]
  /** Free text: client, employee, comment, reason or the record number; photo reports: the store and employee names
   * only (the reference's merch_report search). */
  search?: string
}

const TABLE: Record<FieldRecordKind, string> = { refusal: "field_refusals", photo_report: "field_photo_reports" }

const MAX_SEARCH = 200

export type FieldRecordListQuery = {
  filter: FieldRecordListFilter
  page: number
  pageSize: number
  /** Keyset paging: only the records after this one (then `page` is 1). */
  before?: RecordCursor
  facets: boolean
}

/** Keyset position of a list row: its instant (UTC "YYYY-MM-DDTHH:mm:ss.ffffff") and id. */
export type RecordCursor = { at: string; id: number }

// Linear on purpose (no nested quantifiers on user input).
const CURSOR = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}_(\d{1,10})$/

/** SQL text of a row's cursor (`at` = its instant column, `id` = its id column). */
const cursorSql = (at: string, id: string) => `to_char((${at}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '_' || ${id}::text`

/** ?before= of a list: the nextCursor of the previous page; empty → undefined. */
export function cursorParam(value: string | null, field = "before"): QueryResult<RecordCursor | undefined> {
  const text = (value ?? "").trim()
  if (!text) return { ok: true, value: undefined }
  const match = text.length <= 40 ? CURSOR.exec(text) : null
  if (!match) return { ok: false, field, error: "Неверное значение" }
  const [, year, month, day, hours, minutes, seconds, idText] = match
  const id = Number(idText)
  // The UTC instant of a local day in 2000 may still fall on 1999-12-31.
  const yearOk = Number(year) >= DOC_MIN_YEAR - 1 && Number(year) <= DOC_MAX_YEAR
  if (!yearOk || !isIsoDay(`${year}-${month}-${day}`) || Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59 || id <= 0 || id > MAX_DB_ID) {
    return { ok: false, field, error: "Неверное значение" }
  }
  return { ok: true, value: { at: text.slice(0, text.lastIndexOf("_")), id } }
}

/**
 * The query string of a list request: from / to (local days, both optional, from ≤ to),
 * employeeId, clientId (comma lists), refusalTypeId (refusals) or status (photo reports:
 * pending,rejected,accepted), q (free text), page (1..), pageSize (1..500, default 25),
 * facets=true — the employees narrowed to the reader's scope.
 */
export function recordListQueryOf(kind: FieldRecordKind, params: URLSearchParams, scope: FieldScope): QueryResult<FieldRecordListQuery> {
  const from = dayParam(params.get("from"), "from", "")
  if (!from.ok) return from
  const to = dayParam(params.get("to"), "to", "")
  if (!to.ok) return to
  if (from.value && to.value && from.value > to.value) return { ok: false, field: "from", error: FIELD_MESSAGES.badRange }
  const employees = idsParam(params, "employeeId")
  if (!employees.ok) return employees
  const clients = idsParam(params, "clientId")
  if (!clients.ok) return clients
  const types = idsParam(params, "refusalTypeId")
  if (!types.ok) return types
  const statuses: string[] = []
  for (const part of params.getAll("status").flatMap((value) => value.split(","))) {
    const status = part.trim()
    if (!status) continue
    if (!(PHOTO_REPORT_STATUSES as readonly string[]).includes(status)) return { ok: false, field: "status", error: "Неверное значение" }
    if (!statuses.includes(status)) statuses.push(status)
  }
  const search = [...(params.get("q") ?? "")]
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
    .join("")
    .trim()
  if (search.length > MAX_SEARCH) return { ok: false, field: "q", error: "Слишком длинное значение" }
  const paging = pageParams(params, RECORD_LIST_MAX_PAGE_SIZE)
  if (!paging.ok) return paging
  const before = cursorParam(params.get("before"))
  if (!before.ok) return before
  // A cursor replaces the page number: both together would skip records.
  if (before.value && paging.value.page > 1) return { ok: false, field: "page", error: "Неверное значение" }
  const facets = boolParam(params.get("facets"), "facets")
  if (!facets.ok) return facets
  const supervisors = idsParam(params, "supervisorId")
  if (!supervisors.ok) return supervisors
  const clientTypes = idsParam(params, "clientTypeId")
  if (!clientTypes.ok) return clientTypes
  const equipment = boolParam(params.get("withEquipment"), "withEquipment")
  if (!equipment.ok) return equipment
  const texts = textsParam(params, ["branch", "channel", "inn", "category"])
  if (!texts.ok) return texts
  const brands = idsParam(params, "brandId")
  if (!brands.ok) return brands
  const reportIds = idsParam(params, "id")
  if (!reportIds.ok) return reportIds
  const branchIds = idsParam(params, "branchId")
  if (!branchIds.ok) return branchIds
  const photo = kind === "photo_report"
  return {
    ok: true,
    value: {
      filter: {
        from: from.value || undefined,
        to: to.value || undefined,
        employeeIds: scopedEmployeeIds(scope, employees.value.length ? employees.value : undefined),
        clientIds: clients.value.length ? clients.value : undefined,
        refusalTypeIds: kind === "refusal" && types.value.length ? types.value : undefined,
        statuses: kind === "photo_report" && statuses.length ? statuses : undefined,
        supervisorIds: photo && supervisors.value.length ? supervisors.value : undefined,
        branches: photo && texts.value.branch.length ? texts.value.branch : undefined,
        clientTypeIds: photo && clientTypes.value.length ? clientTypes.value : undefined,
        channels: photo && texts.value.channel.length ? texts.value.channel : undefined,
        inns: photo && texts.value.inn.length ? texts.value.inn : undefined,
        categories: photo && texts.value.category.length ? texts.value.category : undefined,
        withEquipment: photo ? equipment.value : undefined,
        brandIds: photo && brands.value.length ? brands.value : undefined,
        ids: photo && reportIds.value.length ? reportIds.value : undefined,
        branchIds: photo && branchIds.value.length ? branchIds.value : undefined,
        search: search || undefined,
      },
      page: paging.value.page,
      pageSize: paging.value.pageSize,
      before: before.value,
      facets: Boolean(facets.value),
    },
  }
}

/** Repeated or comma-separated text values of each name (trimmed, control characters dropped, at most 50 of 200 chars). */
function textsParam<K extends string>(params: URLSearchParams, names: K[]): QueryResult<Record<K, string[]>> {
  const out = {} as Record<K, string[]>
  for (const name of names) {
    const values: string[] = []
    for (const part of params.getAll(name).flatMap((value) => value.split(","))) {
      const value = [...part].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim()
      if (!value) continue
      if (value.length > MAX_SEARCH || values.length >= 50) return { ok: false, field: name, error: "Неверное значение" }
      if (!values.includes(value)) values.push(value)
    }
    out[name] = values
  }
  return { ok: true, value: out }
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** Named parameters only when the statement has any (lib/db.ts passes a lone object through otherwise). */
function args(sql: string, params: Record<string, unknown>): Record<string, unknown>[] {
  return /@[A-Za-z_]/.test(sql) ? [params] : []
}

async function hasRefusalTypes(): Promise<boolean> {
  return Boolean((await columnsOf(["refusal_types"])).get("refusal_types")?.has("name"))
}

/** WHERE clause + parameters of a list filter (aliases: f = record, e = employee, c = client). */
function whereOf(kind: FieldRecordKind, filter: FieldRecordListFilter, types: boolean, columns: PhotoFilterColumns = NO_PHOTO_COLUMNS) {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.from) {
    where.push("f.happened_at >= @fromUtc::timestamptz")
    params.fromUtc = new Date(dayStartMs(filter.from)).toISOString()
  }
  if (filter.to) {
    where.push("f.happened_at < @toUtc::timestamptz")
    params.toUtc = new Date(dayStartMs(filter.to) + DAY_MS).toISOString()
  }
  if (filter.employeeIds) {
    where.push("f.employee_id = ANY(@employeeIds::int[])")
    params.employeeIds = filter.employeeIds
  }
  if (filter.clientIds) {
    where.push("f.client_id = ANY(@clientIds::int[])")
    params.clientIds = filter.clientIds
  }
  if (kind === "refusal" && filter.refusalTypeIds) {
    where.push("f.refusal_type_id = ANY(@refusalTypeIds::int[])")
    params.refusalTypeIds = filter.refusalTypeIds
  }
  if (kind === "photo_report" && filter.statuses) {
    where.push("f.status = ANY(@statuses::text[])")
    params.statuses = filter.statuses
  }
  if (kind === "photo_report") {
    if (filter.supervisorIds) {
      // The authors whose supervisor is one of them (resolved from employees.details by photoFilterColumns' caller).
      where.push("f.employee_id = ANY(@supervisedIds::int[])")
      params.supervisedIds = columns.supervisedIds ?? []
    }
    if (filter.branches) {
      where.push("fin_key(c.branch) = ANY(SELECT fin_key(x) FROM unnest(@branches::text[]) AS x)")
      params.branches = filter.branches
    }
    if (filter.clientTypeIds) {
      where.push(columns.clientTypes ? "fin_key(c.type) IN (SELECT fin_key(t.name) FROM client_types t WHERE t.id = ANY(@clientTypeIds::int[]))" : "false")
      params.clientTypeIds = filter.clientTypeIds
    }
    if (filter.channels) {
      where.push(columns.channel ? "fin_key(c.sales_channel) = ANY(SELECT fin_key(x) FROM unnest(@channels::text[]) AS x)" : "false")
      params.channels = filter.channels
    }
    if (filter.inns) {
      where.push("btrim(COALESCE(c.inn, '')) = ANY(@inns::text[])")
      params.inns = filter.inns
    }
    if (filter.categories) {
      // photo_types is JSON text written by JSON.stringify ([{"name":"Polka","before":1,"after":1}]): a group is matched
      // by its "name":<json string> pair, so a damaged value matches nothing instead of failing the list.
      where.push(`EXISTS (SELECT 1 FROM unnest(@categories::text[]) AS x WHERE position(('"name":' || to_json(x)::text) IN COALESCE(f.photo_types, '')) > 0)`)
      params.categories = filter.categories
    }
    if (filter.withEquipment !== undefined) {
      const equipment = columns.equipment
        ? `EXISTS (SELECT 1 FROM inventory_items ii WHERE ii.client_id = f.client_id${columns.equipmentDeleted ? " AND COALESCE(ii.deleted, 0) = 0" : ""})`
        : "false"
      where.push(filter.withEquipment ? equipment : `NOT ${equipment}`)
    }
    // No photo report records products here, so none is of a chosen brand.
    if (filter.brandIds) where.push("false")
    if (filter.ids) {
      where.push("f.id = ANY(@reportIds::int[])")
      params.reportIds = filter.ids
    }
    if (filter.branchIds) {
      where.push(columns.branches ? "fin_key(c.branch) IN (SELECT fin_key(b.name) FROM branches b WHERE b.id = ANY(@branchIds::int[]))" : "false")
      params.branchIds = filter.branchIds
    }
  }
  const search = (filter.search ?? "").trim()
  if (search && kind === "photo_report") {
    // The reference's photo report search: the store or the employee who sent it (not the comment, not the number).
    where.push(`(COALESCE(c.name, '') ILIKE @pattern OR COALESCE(${EMPLOYEE_NAME}, '') ILIKE @pattern)`)
    params.pattern = likePattern(search)
  } else if (search) {
    const reason = kind === "refusal" ? (types ? "COALESCE(rt.name, f.reason, '')" : "COALESCE(f.reason, '')") : "''"
    where.push(
      `(COALESCE(${clientNameSql(kind)}, '') ILIKE @pattern OR COALESCE(${EMPLOYEE_NAME}, '') ILIKE @pattern OR COALESCE(f.comment, '') ILIKE @pattern
        OR ${reason} ILIKE @pattern OR f.id::text = @search)`,
    )
    params.pattern = likePattern(search)
    params.search = search
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
}

/** Optional tables / columns the photo report filters read (clients.sales_channel, client_types, inventory_items). */
type PhotoFilterColumns = { channel: boolean; clientTypes: boolean; equipment: boolean; equipmentDeleted: boolean; branches: boolean; supervisedIds?: number[] }
const NO_PHOTO_COLUMNS: PhotoFilterColumns = { channel: false, clientTypes: false, equipment: false, equipmentDeleted: false, branches: false }

async function photoFilterColumns(supervisorIds: number[] | undefined): Promise<PhotoFilterColumns> {
  const columns = await columnsOf(["clients", "client_types", "inventory_items", "branches"])
  return {
    branches: Boolean(columns.get("branches")?.has("name")),
    channel: Boolean(columns.get("clients")?.has("sales_channel")),
    clientTypes: Boolean(columns.get("client_types")?.has("name")),
    equipment: Boolean(columns.get("inventory_items")?.has("client_id")),
    equipmentDeleted: Boolean(columns.get("inventory_items")?.has("deleted")),
    supervisedIds: supervisorIds ? await supervisedEmployees(supervisorIds) : undefined,
  }
}

/** Employees whose supervisor (employees.details.supervisorId, lib/employees-repo.ts) is one of `supervisorIds`. */
async function supervisedEmployees(supervisorIds: number[]): Promise<number[]> {
  const wanted = new Set(supervisorIds)
  const rows = (await getDb().prepare("SELECT id, details FROM employees").all()) as Array<{ id: number; details: string | null }>
  return rows.filter((row) => wanted.has(Number(supervisorOf(row.details)))).map((row) => Number(row.id))
}

function supervisorOf(details: string | null): number | null {
  try {
    const value = (JSON.parse(details || "{}") as { supervisorId?: unknown }).supervisorId
    return Number.isInteger(Number(value)) && value !== null && value !== "" ? Number(value) : null
  } catch {
    return null
  }
}

type Row = {
  id: number
  visit_id: number | null
  employee_id: number
  employee_name: string | null
  client_id: number
  client_name: string | null
  at_text: string
  comment: string | null
  reason: string | null
  refusal_type_id: number | null
  status: string | null
  photo_types: string | null
  cursor: string
}

const num = (value: number | null | undefined) => (value === null || value === undefined ? null : Number(value))

/** field_photo_reports.photo_types → the named photo groups (a damaged value is no groups). */
function photoTypesOf(text: string | null): PhotoTypeGroup[] {
  try {
    const value = JSON.parse(text || "[]") as unknown
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const group = item as Record<string, unknown>
      const name = typeof group.name === "string" ? group.name.trim() : ""
      return name ? [{ name, before: Number(group.before) || 0, after: Number(group.after) || 0 }] : []
    })
  } catch {
    return []
  }
}

type RecordPage = { count: number; hasMore: boolean; nextCursor: string | null; rows: FieldRecordRow[] }

/** A header sort of the Отказы table, by Linko's ?ordering= keys: id, createdDate, name (the agent), market (the
 * client), comment (the reason). Numbered pages only: a `before` cursor always follows the default order. */
export type FieldRecordOrder = { key: "id" | "createdDate" | "name" | "market" | "comment"; desc: boolean }

/** The client's name of a record: a refusal of a client deleted in Linko keeps the name Linko still shows
 * (field_refusals.client_name, written by scripts/linko-sync/import-field-records.mjs). */
const clientNameSql = (kind: FieldRecordKind) => (kind === "refusal" ? "COALESCE(c.name, NULLIF(f.client_name, ''))" : "c.name")

/** ORDER BY of a list: newest first, or the header sort (ties keep the newest first, so pages never overlap). */
function orderSql(kind: FieldRecordKind, types: boolean, order?: FieldRecordOrder): string {
  const newest = "f.happened_at DESC, f.id DESC"
  if (!order) return newest
  const dir = order.desc ? "DESC" : "ASC"
  if (order.key === "id") return `f.id ${dir}`
  if (order.key === "createdDate") return `f.happened_at ${dir}, f.id ${dir}`
  const reason = kind === "refusal" ? (types ? "COALESCE(rt.name, f.reason)" : "f.reason") : "f.comment"
  const column = order.key === "name" ? EMPLOYEE_NAME : order.key === "market" ? clientNameSql(kind) : reason
  return `${column} ${dir}, ${newest}`
}

const EMPTY_PAGE: RecordPage = { count: 0, hasMore: false, nextCursor: null, rows: [] }

/**
 * One page of refusals / photo reports, newest first, with the total count of the filter: the
 * `offset`-th records, or (`before`) the records after that cursor. `hasMore` / `nextCursor`
 * tell whether and from where older records follow.
 */
export async function listFieldRecords(
  kind: FieldRecordKind,
  filter: FieldRecordListFilter,
  { limit, offset, before, order }: { limit: number; offset: number; before?: RecordCursor; order?: FieldRecordOrder },
): Promise<RecordPage> {
  await ensureFieldSchema()
  if ((filter.employeeIds && !filter.employeeIds.length) || (filter.clientIds && !filter.clientIds.length)) return EMPTY_PAGE
  if ((filter.refusalTypeIds && !filter.refusalTypeIds.length) || (filter.statuses && !filter.statuses.length)) return EMPTY_PAGE
  const types = kind === "refusal" && (await hasRefusalTypes())
  const { sql: whereSql, params } = whereOf(kind, filter, types, kind === "photo_report" ? await photoFilterColumns(filter.supervisorIds) : NO_PHOTO_COLUMNS)
  const joins = `FROM ${TABLE[kind]} f
         LEFT JOIN employees e ON e.id = f.employee_id
         LEFT JOIN clients c ON c.id = f.client_id
         ${types ? "LEFT JOIN refusal_types rt ON rt.id = f.refusal_type_id" : ""}`
  const db = getDb()
  const countSql = `SELECT COUNT(*)::int AS n ${joins} ${whereSql}`
  const counted = (await db.prepare(countSql).get(...args(countSql, params))) as { n: number } | undefined
  const count = Number(counted?.n ?? 0)
  if (!count || (!before && offset >= count)) return { ...EMPTY_PAGE, count }
  const after = before ? `${whereSql ? `${whereSql} AND` : "WHERE"} (f.happened_at, f.id) < ((@beforeAt::timestamp AT TIME ZONE 'UTC'), @beforeId::int)` : whereSql
  const columns =
    kind === "refusal"
      ? `f.comment, ${types ? "COALESCE(rt.name, f.reason)" : "f.reason"} AS reason, f.refusal_type_id, NULL AS status`
      : "f.comment, NULL AS reason, NULL AS refusal_type_id, f.status, f.photo_types"
  const rows = (await db
    .prepare(
      `SELECT f.id, f.visit_id, f.employee_id, ${EMPLOYEE_NAME} AS employee_name, f.client_id, ${clientNameSql(kind)} AS client_name,
              to_char(${localTs("f.happened_at")}, ${LOCAL_TEXT}) AS at_text, ${columns}, ${cursorSql("f.happened_at", "f.id")} AS cursor
         ${joins}
         ${after}
        ORDER BY ${orderSql(kind, types, before ? undefined : order)}
        LIMIT @limit OFFSET @offset`,
    )
    // One more row than asked tells whether older records follow.
    .all({ ...params, limit: limit + 1, offset: before ? 0 : offset, beforeAt: before?.at ?? null, beforeId: before?.id ?? null })) as Row[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const photos = await photosOf(kind, page.map((row) => Number(row.id)))
  return {
    count,
    hasMore,
    nextCursor: hasMore ? page[page.length - 1].cursor : null,
    rows: page.map((row) => ({
      id: Number(row.id),
      visitId: num(row.visit_id),
      employeeId: Number(row.employee_id),
      employeeName: row.employee_name ?? "",
      clientId: Number(row.client_id),
      clientName: row.client_name ?? "",
      at: row.at_text,
      comment: row.comment ?? "",
      reason: row.reason ?? "",
      refusalTypeId: num(row.refusal_type_id),
      status: row.status ?? "",
      photos: photos.get(Number(row.id)) ?? [],
      ...(kind === "photo_report" ? { photoTypes: photoTypesOf(row.photo_types) } : {}),
    })),
  }
}

/**
 * Filter options of a list page: the employees and clients that have records of `kind` (within the
 * reader's employees), and for refusals every refusal type plus the types old refusals still name.
 */
export async function fieldRecordFacets(kind: FieldRecordKind, employeeIds?: number[]): Promise<FieldRecordFacets> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return { employees: [], clients: [], refusalTypes: [] }
  const db = getDb()
  const only = employeeIds ? "WHERE f.employee_id = ANY(@employeeIds::int[])" : ""
  const params = { employeeIds: employeeIds ?? [] }
  const employeeSql = `SELECT DISTINCT f.employee_id AS id, COALESCE(${EMPLOYEE_NAME}, '#' || f.employee_id::text) AS name
         FROM ${TABLE[kind]} f LEFT JOIN employees e ON e.id = f.employee_id ${only}`
  const employees = (await db.prepare(employeeSql).all(...args(employeeSql, params))) as FieldOption[]
  const clientSql = `SELECT DISTINCT f.client_id AS id, COALESCE(NULLIF(btrim(${clientNameSql(kind)}), ''), '#' || f.client_id::text) AS name
         FROM ${TABLE[kind]} f LEFT JOIN clients c ON c.id = f.client_id ${only}`
  const clients = (await db.prepare(clientSql).all(...args(clientSql, params))) as FieldOption[]
  let refusalTypes: FieldOption[] = []
  if (kind === "refusal") {
    const types = await hasRefusalTypes()
    refusalTypes = (await db
      .prepare(
        types
          ? `SELECT rt.id, rt.name FROM refusal_types rt
             UNION
             SELECT DISTINCT f.refusal_type_id AS id, f.reason AS name FROM field_refusals f
              WHERE f.refusal_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM refusal_types rt WHERE rt.id = f.refusal_type_id)`
          : `SELECT DISTINCT f.refusal_type_id AS id, f.reason AS name FROM field_refusals f WHERE f.refusal_type_id IS NOT NULL`,
      )
      .all()) as FieldOption[]
  }
  const byName = (list: FieldOption[]) =>
    list
      .map((option) => ({ id: Number(option.id), name: String(option.name ?? "").trim() || `#${option.id}` }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id)
  const base = { employees: byName(employees), clients: byName(clients), refusalTypes: byName(refusalTypes) }
  if (kind !== "photo_report") return base
  return { ...base, ...(await photoReportFacets(employeeIds)) }
}

/** Optional numeric id → number (the option lists drop rows without one). */
const optionsOf = (rows: Array<{ id: unknown; name: unknown }>): FieldOption[] =>
  rows.flatMap((row) => {
    const id = Number(row.id)
    const name = String(row.name ?? "").trim()
    return Number.isInteger(id) && id > 0 ? [{ id, name: name || `#${id}` }] : []
  })

// The reference's selects list names in its database's en_US order: letters before Cyrillic, case and punctuation
// ignored at first (lower case first on a tie), so "Baby Still" comes before "b-fresh" and "pepsi" before "Pepsi".
const NAME_ORDER = new Intl.Collator("en", { ignorePunctuation: true })
const byCollation = (list: FieldOption[]) => [...list].sort((a, b) => NAME_ORDER.compare(a.name, b.name) || a.id - b.id)

/**
 * The lists of the photo report filter card, as the reference's selects offer them: Создал every active user by id
 * (its users select), Супервайзер by id, Бренд / Филиалы / Тип клиента (top level) by name in the reference's collation
 * (the reference orders them the same way: Latin before Cyrillic, case-insensitive), Магазин every store newest first,
 * ИНН магазина every store's ИНН. A reader limited to some employees keeps the lists of their own data: those employees,
 * their supervisors, and the stores / ИНН / photo groups of their reports.
 */
async function photoReportFacets(employeeIds?: number[]): Promise<Partial<FieldRecordFacets>> {
  const db = getDb()
  const only = employeeIds ? "AND f.employee_id = ANY(@employeeIds::int[])" : ""
  const scoped = { employeeIds: employeeIds ?? [] }
  const inScope = employeeIds ? new Set(employeeIds) : null
  const columns = await columnsOf(["clients", "client_types", "branches", "brands", "employees"])
  const texts = (values: unknown[]) => [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
  const activeOnly = columns.get("employees")?.has("active") ? "WHERE e.active = 1" : ""
  const staff = (await db.prepare(`SELECT e.id, ${EMPLOYEE_NAME} AS name, e.details FROM employees e ORDER BY e.id`).all()) as Array<FieldOption & { details: string | null }>
  const active = (await db.prepare(`SELECT e.id, ${EMPLOYEE_NAME} AS name FROM employees e ${activeOnly} ORDER BY e.id`).all()) as FieldOption[]
  const employees = optionsOf(active).filter((row) => !inScope || inScope.has(row.id))
  const supervisorIds = new Set(
    staff
      .filter((row) => !inScope || inScope.has(Number(row.id)))
      .map((row) => supervisorOf(row.details))
      .filter((id): id is number => id !== null),
  )
  const supervisors = optionsOf(staff.filter((row) => supervisorIds.has(Number(row.id))))
  const branches = columns.get("branches")?.has("name") ? byCollation(optionsOf((await db.prepare("SELECT id, name FROM branches WHERE btrim(COALESCE(name, '')) <> ''").all()) as FieldOption[])) : []
  const types = columns.get("client_types")
  const clientTypes = types?.has("name")
    ? byCollation(optionsOf((await db.prepare(`SELECT id, name FROM client_types ${types.has("parent_id") ? "WHERE parent_id IS NULL" : ""}`).all()) as FieldOption[]))
    : []
  const channels = columns.get("clients")?.has("sales_channel") ? ((await db.prepare("SELECT DISTINCT sales_channel AS v FROM clients").all()) as Array<{ v: string }>).map((row) => row.v) : []
  const clientSql = employeeIds
    ? `SELECT DISTINCT c.id, c.name FROM field_photo_reports f JOIN clients c ON c.id = f.client_id WHERE true ${only} ORDER BY c.id DESC`
    : "SELECT c.id, c.name FROM clients c ORDER BY c.id DESC"
  const clients = optionsOf((await db.prepare(clientSql).all(...args(clientSql, scoped))) as FieldOption[])
  const innSql = employeeIds
    ? `SELECT DISTINCT btrim(c.inn) AS v FROM field_photo_reports f JOIN clients c ON c.id = f.client_id WHERE btrim(COALESCE(c.inn, '')) <> '' ${only}`
    : "SELECT DISTINCT btrim(c.inn) AS v FROM clients c WHERE btrim(COALESCE(c.inn, '')) <> ''"
  const inns = columns.get("clients")?.has("inn")
    ? [...new Set(((await db.prepare(innSql).all(...args(innSql, scoped))) as Array<{ v: string }>).map((row) => row.v))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    : []
  const groupSql = `SELECT f.photo_types FROM field_photo_reports f WHERE COALESCE(f.photo_types, '') NOT IN ('', '[]') ${only}`
  const groups = ((await db.prepare(groupSql).all(...args(groupSql, scoped))) as Array<{ photo_types: string | null }>).flatMap((row) =>
    photoTypesOf(row.photo_types).map((group) => group.name),
  )
  const brands = columns.get("brands")?.has("name") ? byCollation(optionsOf((await db.prepare("SELECT id, name FROM brands WHERE btrim(COALESCE(name, '')) <> ''").all()) as FieldOption[])) : []
  return { employees, clients, supervisors, branches, clientTypes, channels: texts(channels), inns, categories: texts(groups), brands }
}

/**
 * The period of GET /api/field-activity/client-counts: from / to local days (default today,
 * year 2000..2100, from ≤ to). Unlike the event lists it has no 366-day cap: the counts are one
 * indexed GROUP BY, and Анализ покрытия computes its other columns for any period it is given,
 * so Визит / Отказ must cover that same period.
 */
export function countPeriodOf(params: URLSearchParams): QueryResult<{ from: string; to: string }> {
  const to = dayParam(params.get("to"), "to")
  if (!to.ok) return to
  const from = dayParam(params.get("from"), "from", to.value)
  if (!from.ok) return from
  if (from.value > to.value) return { ok: false, field: "from", error: FIELD_MESSAGES.badRange }
  return { ok: true, value: { from: from.value, to: to.value } }
}

/** Visits, refusals and photo reports per client in a period of local days (inclusive). */
export async function clientFieldCounts(
  from: string,
  to: string,
  filter: { employeeIds?: number[]; clientIds?: number[] } = {},
): Promise<ClientFieldCount[]> {
  await ensureFieldSchema()
  if ((filter.employeeIds && !filter.employeeIds.length) || (filter.clientIds && !filter.clientIds.length)) return []
  const where = (column: string, alias: string) =>
    [
      `${alias}.${column} >= @fromUtc::timestamptz AND ${alias}.${column} < @toUtc::timestamptz`,
      filter.employeeIds ? `${alias}.employee_id = ANY(@employeeIds::int[])` : "",
      filter.clientIds ? `${alias}.client_id = ANY(@clientIds::int[])` : "",
    ]
      .filter(Boolean)
      .join(" AND ")
  const rows = (await getDb()
    .prepare(
      `SELECT client_id, SUM(visits)::int AS visits, SUM(refusals)::int AS refusals, SUM(reports)::int AS reports FROM (
         SELECT v.client_id, COUNT(*) AS visits, 0 AS refusals, 0 AS reports FROM field_visits v WHERE ${where("started_at", "v")} GROUP BY v.client_id
         UNION ALL
         SELECT r.client_id, 0, COUNT(*), 0 FROM field_refusals r WHERE ${where("happened_at", "r")} GROUP BY r.client_id
         UNION ALL
         SELECT p.client_id, 0, 0, COUNT(*) FROM field_photo_reports p WHERE ${where("happened_at", "p")} GROUP BY p.client_id
       ) counts GROUP BY client_id ORDER BY client_id`,
    )
    .all({
      fromUtc: new Date(dayStartMs(from)).toISOString(),
      toUtc: new Date(dayStartMs(to) + DAY_MS).toISOString(),
      employeeIds: filter.employeeIds ?? [],
      clientIds: filter.clientIds ?? [],
    })) as Array<{ client_id: number; visits: number; refusals: number; reports: number }>
  return rows.map((row) => ({ clientId: Number(row.client_id), visits: Number(row.visits), refusals: Number(row.refusals), photoReports: Number(row.reports) }))
}

/**
 * The visits of one client that are not linked to an order (an order already shows as its own
 * entry in the client card's ЗАДАЧИ), newest first, `limit` at a time after the `before` cursor,
 * with the client's total of such visits. `employeeIds` narrows them to the reader's scope.
 */
export async function listClientVisitPage(
  clientId: number,
  { limit, before }: { limit: number; before?: RecordCursor },
  employeeIds?: number[],
): Promise<ClientVisitPage> {
  await ensureFieldSchema()
  if (employeeIds && !employeeIds.length) return { count: 0, hasMore: false, nextCursor: null, rows: [] }
  const types = await hasRefusalTypes()
  const where = ["v.client_id = @clientId", "v.order_id IS NULL", ...(employeeIds ? ["v.employee_id = ANY(@employeeIds::int[])"] : [])]
  const params = { clientId, employeeIds: employeeIds ?? [] }
  const db = getDb()
  const counted = (await db.prepare(`SELECT COUNT(*)::int AS n FROM field_visits v WHERE ${where.join(" AND ")}`).get(params)) as { n: number } | undefined
  const count = Number(counted?.n ?? 0)
  if (!count) return { count, hasMore: false, nextCursor: null, rows: [] }
  if (before) where.push("(v.started_at, v.id) < ((@beforeAt::timestamp AT TIME ZONE 'UTC'), @beforeId::int)")
  const rows = (await db
    .prepare(
      `SELECT v.id, v.employee_id, ${EMPLOYEE_NAME} AS employee_name,
              to_char(${localTs("v.started_at")}, ${LOCAL_TEXT}) AS started_text,
              CASE WHEN v.finished_at IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM (v.finished_at - v.started_at))::int END AS duration_sec,
              COALESCE(v.result, 'open') AS result,
              ${types ? "COALESCE(rt.name, fr.reason, '')" : "COALESCE(fr.reason, '')"} AS refusal,
              v.planned, ${cursorSql("v.started_at", "v.id")} AS cursor
         FROM field_visits v
         LEFT JOIN employees e ON e.id = v.employee_id
         LEFT JOIN field_refusals fr ON fr.visit_id = v.id
         ${types ? "LEFT JOIN refusal_types rt ON rt.id = fr.refusal_type_id" : ""}
        WHERE ${where.join(" AND ")}
        ORDER BY v.started_at DESC, v.id DESC
        LIMIT @limit`,
    )
    .all({ ...params, limit: limit + 1, beforeAt: before?.at ?? null, beforeId: before?.id ?? null })) as Array<{
    id: number
    employee_id: number
    employee_name: string | null
    started_text: string
    duration_sec: number
    result: string
    refusal: string | null
    planned: boolean
    cursor: string
  }>
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    count,
    hasMore,
    nextCursor: hasMore ? page[page.length - 1].cursor : null,
    rows: page.map((row) => ({
      visitId: Number(row.id),
      employeeId: Number(row.employee_id),
      agent: row.employee_name ?? `#${row.employee_id}`,
      startedAt: row.started_text,
      durationSec: Math.max(0, Number(row.duration_sec) || 0),
      result: row.result,
      refusal: row.refusal ?? "",
      planned: Boolean(row.planned),
    })),
  }
}
