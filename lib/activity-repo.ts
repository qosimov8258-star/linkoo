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
import {
  activityHiddenEmployeeIds,
  dayTaskHistoryEnd,
  HISTORY_TASK_COLUMNS,
  historyCardCounts,
  historyTaskPage,
  historyVisits,
  type HistoryFilter,
  type HistoryTask,
} from "@/lib/activity-history"
import { getDb } from "@/lib/db"
import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { scopeAllows, scopedEmployeeIds, type FieldScope } from "@/lib/field-activity/actor"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { fieldEventTotals, listFieldEvents, type FieldEventQuery } from "@/lib/field-activity/events"
import { addDays } from "@/lib/field-activity/input"
import { idParam } from "@/lib/field-activity/http"
import { boolParam, idsParam, pageParams, periodParams, type QueryResult } from "@/lib/field-activity/input"
import type { FieldEvent, FieldEventKind, KindTotal, MoneyTotal } from "@/lib/field-activity/types"
import { normCurrency } from "@/lib/finance/currency"

// Read model of the Активность page (/analytics/activity). Everything comes from the field
// event stream (lib/field-activity/events.ts), so the column header counts and the cards each
// column can load are the same rows:
// - as the reference counts them (market/today_plan_stat_sum, market/agent/done_plan): Сделки = every
//   order of the period (cancelled ones too), Отказы = visit refusals, Отчеты = photo reports,
//   Возвраты = accepted client returns, Сбор денег = client payments, Доставки = orders that
//   reached Доставлено;
// - the agent strip lists the active tracked employees (with 0 too), most visits first; the number is
//   their visits, the sum their orders that are not cancelled (unconfirmed ones too) per currency
//   (currencies are never added together — Linko adds the bare numbers of different currencies).
// The header sums leave out employees that are neither active nor tracked, as Linko does. For the
// period copied from Linko, the cards and the strip's visits are Linko's own day-plan tasks
// (lib/activity-history.ts); a column shows only when it has cards, as in Linko.
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
    orders: "all",
    returns: "accepted",
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

/** The part of a period read from Linko's day-plan history and the part read from the app's documents. */
type PeriodSplit = { history: { from: string; to: string } | null; documents: { from: string; to: string } | null }

function splitPeriod(query: ActivityQuery, historyEnd: string | null): PeriodSplit {
  if (!historyEnd || query.from > historyEnd) return { history: null, documents: { from: query.from, to: query.to } }
  const history = { from: query.from, to: query.to < historyEnd ? query.to : historyEnd }
  const after = addDays(historyEnd, 1)
  return { history, documents: query.to >= after ? { from: after, to: query.to } : null }
}

function historyFilter(query: ActivityQuery, range: { from: string; to: string }, employeeIds: number[] | undefined): HistoryFilter {
  return {
    from: range.from,
    to: range.to,
    employeeIds,
    clientTypeIds: query.clientTypeIds,
    withEquipment: query.withEquipment,
    branchId: query.branchId,
  }
}

/** Number of cards each column can load (the same split as activityFeed). */
async function cardCounts(query: ActivityQuery, employeeIds: number[] | undefined, hidden: number[], split: PeriodSplit): Promise<Record<ActivityColumn, number>> {
  const counts = Object.fromEntries(ACTIVITY_COLUMNS.map((column) => [column, 0])) as Record<ActivityColumn, number>
  // Refusals: every refusal of the period, whoever made it (Linko's market/rejection list has no employee rule).
  const refusals = await fieldEventTotals(eventQuery(query, ["refusal"], employeeIds))
  counts.refusal = refusals.byKind.refusal?.count ?? 0
  const documentColumns = split.history ? HISTORY_TASK_COLUMNS : ACTIVITY_COLUMNS.filter((column) => column !== "refusal")
  if (split.documents) {
    const range = { ...query, ...split.documents }
    const totals = await fieldEventTotals({ ...eventQuery(range, documentColumns, employeeIds), excludeEmployeeIds: hidden })
    for (const column of documentColumns) counts[column] += totals.byKind[column]?.count ?? 0
  }
  if (split.history) {
    const history = await historyCardCounts(historyFilter(query, split.history, employeeIds))
    for (const column of HISTORY_TASK_COLUMNS) counts[column] += history[column] ?? 0
  }
  return counts
}

/** Agent strip + column header totals for the page filter. */
export async function activityBoard(query: ActivityQuery, scope: FieldScope): Promise<ActivityBoard> {
  // The strip ignores the selected agent; a restricted reader only ever sees their own employee.
  const stripIds = scopedEmployeeIds(scope, undefined)
  const [historyEnd, hidden] = await Promise.all([dayTaskHistoryEnd(), activityHiddenEmployeeIds()])
  const split = splitPeriod(query, historyEnd)
  const totals = await fieldEventTotals({ ...eventQuery(query, [...ACTIVITY_COLUMNS, "visit"], stripIds), excludeEmployeeIds: hidden })
  const base = normCurrency(totals.baseCurrency)
  const perEmployee = new Map(totals.byEmployee.map((entry) => [entry.employeeId, entry]))
  // The strip's sales: the agent's orders that are not cancelled.
  const salesTotals = await fieldEventTotals({ ...eventQuery(query, ["order"], stripIds), orders: "not_cancelled" })
  const salesOf = new Map(salesTotals.byEmployee.map((entry) => [entry.employeeId, entry.byKind.order]))
  // The strip's visits: Linko's done visit tasks for its history, the app's visits after it.
  const visitsOf = new Map<number, number>()
  const addVisits = (employeeId: number | null, count: number) => {
    if (employeeId !== null) visitsOf.set(employeeId, (visitsOf.get(employeeId) ?? 0) + count)
  }
  if (split.history) for (const [employeeId, count] of await historyVisits(historyFilter(query, split.history, stripIds))) addVisits(employeeId, count)
  if (split.documents) {
    const visits = await fieldEventTotals(eventQuery({ ...query, ...split.documents }, ["visit"], stripIds))
    for (const entry of visits.byEmployee) addVisits(entry.employeeId, entry.byKind.visit?.count ?? 0)
  }

  let columns: Record<ActivityColumn, KindTotal>
  let cardEmployees: number[] | undefined = stripIds
  if (query.employeeId === null) {
    // Linko's «Сбор денег» sum counts every payment, hidden employees too (2025: 267, 2 of them by hidden ones).
    const payments = hidden.length ? await fieldEventTotals(eventQuery(query, ["payment"], stripIds)) : totals
    columns = columnsOf({ ...totals.byKind, payment: payments.byKind.payment }, base)
  }
  else if (!scopeAllows(scope, query.employeeId)) {
    columns = columnsOf({}, base)
    cardEmployees = []
  } else {
    columns = columnsOf(perEmployee.get(query.employeeId)?.byKind ?? {}, base)
    cardEmployees = [query.employeeId]
  }
  const cards = await cardCounts(query, cardEmployees, hidden, split)

  // As Linko's market/agent/done_plan: the active employees with «Показывать в отслеживании», in login order,
  // shown with the most visits first (a stable sort keeps the login order among equals).
  const employees = await listFieldEmployees({ activeOnly: true, trackedOnly: true, branchId: query.branchId, employeeIds: stripIds })
  const agents: ActivityAgent[] = []
  for (const employee of employees) {
    agents.push({
      employeeId: employee.employeeId,
      name: employee.name,
      active: employee.active,
      visits: visitsOf.get(employee.employeeId) ?? 0,
      visitedClients: perEmployee.get(employee.employeeId)?.visitedClients ?? 0,
      sales: moneyOf(salesOf.get(employee.employeeId), base),
    })
  }
  agents.sort((a, b) => b.visits - a.visits)

  return {
    from: query.from,
    to: query.to,
    baseCurrency: base,
    employeeId: query.employeeId,
    totalVisits: agents.reduce((sum, agent) => sum + agent.visits, 0),
    columns,
    cards,
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

/** Names of employees and clients by id. */
async function namesOf(table: "employees" | "clients", ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const label = table === "employees" ? "btrim(btrim(COALESCE(first_name, '')) || ' ' || btrim(COALESCE(last_name, '')))" : "COALESCE(name, '')"
  const rows = (await getDb().prepare(`SELECT id, ${label} AS label FROM ${table} WHERE id = ANY(@ids::int[])`).all({ ids })) as Array<{ id: number; label: string }>
  return new Map(rows.map((row) => [Number(row.id), row.label]))
}

/** Cards of Linko day-plan tasks: dated, attributed and placed as the task says, amounts / photos from the document. */
async function historyCards(column: ActivityColumn, tasks: HistoryTask[]): Promise<ActivityCard[]> {
  if (!tasks.length) return []
  const sourceOf = (task: HistoryTask) => (column === "payment" ? task.paymentId : column === "photo_report" ? task.reportId : task.orderId)
  const ids = [...new Set(tasks.map(sourceOf).filter((id): id is number => id !== null))]
  const documents = new Map<number, FieldEvent>()
  if (column !== "delivery" && ids.length) {
    const kind = column as FieldEventKind
    const found = await listFieldEvents(
      { from: `${DOC_MIN_YEAR}-01-01`, to: `${DOC_MAX_YEAR}-12-31`, kinds: [kind], sourceIds: ids, orders: "all", returns: "not_cancelled" },
      { limit: ids.length, offset: 0 },
    )
    for (const event of found.rows) documents.set(event.sourceId, event)
  }
  const [employees, clients] = await Promise.all([
    namesOf("employees", [...new Set(tasks.map((task) => task.employeeId))]),
    namesOf("clients", [...new Set(tasks.map((task) => task.clientId).filter((id): id is number => id !== null))]),
  ])
  return tasks.map((task) => {
    const sourceId = sourceOf(task)
    const document = sourceId === null ? undefined : documents.get(sourceId)
    const clientId = task.clientId ?? document?.clientId ?? null
    return {
      id: `task:${task.id}`,
      kind: column,
      sourceId: sourceId ?? task.id,
      at: task.at,
      employeeId: task.employeeId,
      employeeName: employees.get(task.employeeId) ?? document?.employeeName ?? "",
      clientId,
      clientName: (clientId !== null ? clients.get(clientId) : undefined) ?? document?.clientName ?? "",
      orderId: column === "order" || column === "delivery" ? task.orderId : (document?.orderId ?? null),
      status: document?.status ?? "",
      amount: document?.amount ?? null,
      currency: document?.currency ? normCurrency(document.currency) : null,
      comment: document?.comment ?? "",
      reason: document?.reason ?? "",
      photos: document?.photos ?? [],
    }
  })
}

/** One page of one column, newest first: the app's documents after the Linko history, then the history's tasks. */
export async function activityFeed(
  query: ActivityQuery,
  page: { column: ActivityColumn; page: number; pageSize: number },
  scope: FieldScope,
): Promise<ActivityFeedPage> {
  const employeeIds = scopedEmployeeIds(scope, query.employeeId === null ? undefined : [query.employeeId])
  const offset = (page.page - 1) * page.pageSize
  // Refusals list every refusal of the period; the other columns follow Linko's history and its employee rule.
  const split = page.column === "refusal" ? { history: null, documents: { from: query.from, to: query.to } } : splitPeriod(query, await dayTaskHistoryEnd())
  const hidden = page.column === "refusal" ? [] : await activityHiddenEmployeeIds()

  let count = 0
  let rows: ActivityCard[] = []
  let baseCurrency = ""
  if (split.documents) {
    const result = await listFieldEvents(
      { ...eventQuery({ ...query, ...split.documents }, [page.column], employeeIds), excludeEmployeeIds: hidden },
      { limit: page.pageSize, offset },
    )
    count = result.count
    rows = result.rows.map((event) => cardOf(event, page.column))
    baseCurrency = result.baseCurrency
  }
  if (split.history && HISTORY_TASK_COLUMNS.includes(page.column)) {
    const room = page.pageSize - rows.length
    const history = await historyTaskPage(page.column, historyFilter(query, split.history, employeeIds), {
      limit: Math.max(1, room),
      offset: Math.max(0, offset - count),
    })
    if (room > 0) rows = [...rows, ...(await historyCards(page.column, history.tasks))]
    count += history.count
  }
  if (!baseCurrency) {
    const totals = await fieldEventTotals({ ...eventQuery(query, [], []), kinds: [page.column] })
    baseCurrency = totals.baseCurrency
  }
  return {
    column: page.column,
    count,
    page: page.page,
    pageSize: page.pageSize,
    hasMore: page.page * page.pageSize < count,
    baseCurrency: normCurrency(baseCurrency),
    rows,
  }
}
