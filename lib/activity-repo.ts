import "server-only"

import {
  ACTIVITY_COLUMNS,
  ACTIVITY_MAX_CLIENT_TYPES,
  ACTIVITY_MAX_PAGE_SIZE,
  ACTIVITY_PAGE_SIZE,
  isActivityColumn,
  type ActivityAgent,
  type ActivityBoard,
  type ActivityCard,
  type ActivityColumn,
  type ActivityFeedPage,
} from "@/lib/activity-types"
import { scopeAllows, scopedEmployeeIds, type FieldScope } from "@/lib/field-activity/actor"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { fieldEventTotals, listFieldEvents, type FieldEventQuery } from "@/lib/field-activity/events"
import { idParam } from "@/lib/field-activity/http"
import { boolParam, idsParam, pageParams, periodParams, type QueryResult } from "@/lib/field-activity/input"
import type { FieldEvent, FieldEventKind, KindTotal, MoneyTotal } from "@/lib/field-activity/types"
import { normCurrency } from "@/lib/finance/currency"

// Read model of the Активность page (/analytics/activity). Everything comes from the field
// event stream (lib/field-activity/events.ts), so the column header counts and the cards each
// column can load are the same rows:
// - Сделки = counted orders (cancelled and unconfirmed ones are left out: excludeCancelled),
//   Отказы = visit refusals, Отчеты = photo reports, Возвраты = client returns that are not
//   cancelled, Сбор денег = client payments, Доставки = orders that reached Доставлено;
// - the agent strip lists the active employees (with 0 too) plus any inactive one that still
//   has visits or sales in the period; the number is their visits, the sum their counted
//   orders per currency (currencies are never added together).
// A reader restricted to their own data (lib/field-activity/actor.ts) sees only their employee.

/** The page filter of a board / feed request. */
export type ActivityQuery = {
  from: string
  to: string
  employeeId: number | null
  clientTypeIds: number[]
  withEquipment: boolean | undefined
  branchId: number | undefined
}

/**
 * ?from&to (local days, default today; at most 366 days) &employeeId &clientTypeId (comma
 * list) &withEquipment=true|false &branchId — every value validated (400 with the field).
 */
export function activityQueryOf(params: URLSearchParams): QueryResult<ActivityQuery> {
  const period = periodParams(params)
  if (!period.ok) return period
  const employee = idParam(params.get("employeeId"), "employeeId")
  if (!employee.ok) return employee
  const types = idsParam(params, "clientTypeId", ACTIVITY_MAX_CLIENT_TYPES)
  if (!types.ok) return types
  const equipment = boolParam(params.get("withEquipment"), "withEquipment")
  if (!equipment.ok) return equipment
  const branch = idParam(params.get("branchId"), "branchId")
  if (!branch.ok) return branch
  return {
    ok: true,
    value: {
      from: period.value.from,
      to: period.value.to,
      employeeId: employee.value ?? null,
      clientTypeIds: types.value,
      withEquipment: equipment.value,
      branchId: branch.value,
    },
  }
}

/** ?column (one of the six columns, required) &page &pageSize (1..100, default 25). */
export function activityPageOf(params: URLSearchParams): QueryResult<{ column: ActivityColumn; page: number; pageSize: number }> {
  const column = (params.get("column") ?? "").trim()
  if (!column) return { ok: false, field: "column", error: "Обязательное поле" }
  if (!isActivityColumn(column)) return { ok: false, field: "column", error: "Неверное значение" }
  const paging = pageParams(params, ACTIVITY_MAX_PAGE_SIZE, ACTIVITY_PAGE_SIZE)
  if (!paging.ok) return paging
  return { ok: true, value: { column, ...paging.value } }
}

function eventQuery(query: ActivityQuery, kinds: FieldEventKind[], employeeIds: number[] | undefined): FieldEventQuery {
  return {
    from: query.from,
    to: query.to,
    kinds,
    employeeIds,
    clientTypeIds: query.clientTypeIds.length ? query.clientTypeIds : undefined,
    withEquipment: query.withEquipment,
    branchId: query.branchId,
    excludeCancelled: true,
  }
}

const emptyTotal = (): KindTotal => ({ count: 0, amountBase: null, byCurrency: [] })

/** Money of one kind, the base currency first, then by code; zero amounts left out. */
function moneyOf(total: KindTotal | undefined, base: string): MoneyTotal[] {
  const lines = (total?.byCurrency ?? []).filter((line) => Math.abs(line.amount) >= 0.005)
  return lines.sort((a, b) => (a.currency === base ? -1 : b.currency === base ? 1 : a.currency.localeCompare(b.currency)))
}

function columnsOf(byKind: Partial<Record<FieldEventKind, KindTotal>>, base: string): Record<ActivityColumn, KindTotal> {
  const columns = {} as Record<ActivityColumn, KindTotal>
  for (const column of ACTIVITY_COLUMNS) {
    const total = byKind[column] ?? emptyTotal()
    columns[column] = { count: total.count, amountBase: total.amountBase, byCurrency: moneyOf(total, base) }
  }
  return columns
}

/** Agent strip + column header totals for the page filter. */
export async function activityBoard(query: ActivityQuery, scope: FieldScope): Promise<ActivityBoard> {
  // The strip ignores the selected agent; a restricted reader only ever sees their own employee.
  const stripIds = scopedEmployeeIds(scope, undefined)
  const totals = await fieldEventTotals(eventQuery(query, [...ACTIVITY_COLUMNS, "visit"], stripIds))
  const base = normCurrency(totals.baseCurrency)
  const perEmployee = new Map(totals.byEmployee.map((entry) => [entry.employeeId, entry]))

  let columns: Record<ActivityColumn, KindTotal>
  if (query.employeeId === null) columns = columnsOf(totals.byKind, base)
  else if (!scopeAllows(scope, query.employeeId)) columns = columnsOf({}, base)
  else columns = columnsOf(perEmployee.get(query.employeeId)?.byKind ?? {}, base)

  const employees = await listFieldEmployees({ activeOnly: false, branchId: query.branchId, employeeIds: stripIds })
  const agents: ActivityAgent[] = []
  for (const employee of employees) {
    const entry = perEmployee.get(employee.employeeId)
    const visits = entry?.byKind.visit?.count ?? 0
    const sales = moneyOf(entry?.byKind.order, base)
    if (!employee.active && visits === 0 && sales.length === 0) continue
    agents.push({
      employeeId: employee.employeeId,
      name: employee.name,
      active: employee.active,
      visits,
      visitedClients: entry?.visitedClients ?? 0,
      sales,
    })
  }
  // Most visits first; ties keep the name order of listFieldEmployees (stable sort).
  agents.sort((a, b) => b.visits - a.visits)

  return {
    from: query.from,
    to: query.to,
    baseCurrency: base,
    employeeId: query.employeeId,
    totalVisits: agents.reduce((sum, agent) => sum + agent.visits, 0),
    columns,
    agents,
  }
}

function cardOf(event: FieldEvent, column: ActivityColumn): ActivityCard {
  return {
    id: event.id,
    kind: column,
    sourceId: event.sourceId,
    at: event.at,
    employeeId: event.employeeId,
    employeeName: event.employeeName,
    clientId: event.clientId,
    clientName: event.clientName,
    orderId: event.orderId,
    status: event.status,
    amount: event.amount,
    currency: event.currency ? normCurrency(event.currency) : null,
    comment: event.comment,
    reason: event.reason,
    photos: event.photos,
  }
}

/** One page of one column, newest first. */
export async function activityFeed(
  query: ActivityQuery,
  page: { column: ActivityColumn; page: number; pageSize: number },
  scope: FieldScope,
): Promise<ActivityFeedPage> {
  const employeeIds = scopedEmployeeIds(scope, query.employeeId === null ? undefined : [query.employeeId])
  const result = await listFieldEvents(eventQuery(query, [page.column], employeeIds), {
    limit: page.pageSize,
    offset: (page.page - 1) * page.pageSize,
  })
  return {
    column: page.column,
    count: result.count,
    page: page.page,
    pageSize: page.pageSize,
    hasMore: page.page * page.pageSize < result.count,
    baseCurrency: normCurrency(result.baseCurrency),
    rows: result.rows.map((event) => cardOf(event, page.column)),
  }
}
