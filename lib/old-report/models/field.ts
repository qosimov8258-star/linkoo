import "server-only"

import { clientDays } from "@/lib/agent-visits-repo"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { normCurrency } from "@/lib/finance/currency"

import { defineModel, type FilterDef, type RunContext } from "../context"
import { nameKey, type ClientInfo, type EmployeeInfo } from "../directory"
import { clientGroups } from "../facets"
import { clock, count, dayGroups, distinct, dmy, maxText, minText, plain, round, sum, type GroupDef, type MeasureFn } from "../pivot"

// The field models of the old report builder (the field scope of Активность: an agent reads their own records):
//   rejection    «Отказы»: the refusals the agents recorded in the shops;
//   today_plans  «Задачи»: what each employee had to do or did on a day in a shop — a visit of the route plan or
//                outside it, an order, a refusal, the time spent in the shop, a delivery, a return, a payment taken,
//                a task set by hand;
//   visit        «Визит»: the visits alone, planned against made.
// Visits, their plans and the time in the shop are the field activity data (lib/agent-visits-repo.ts clientDays,
// the source of Активность and of the new builder's «Визит»); the other tasks are the documents themselves.

/** Local (Asia/Tashkent) timestamp of a timestamptz expression. */
const local = (expr: string) => `((${expr}) AT TIME ZONE 'UTC') + interval '5 hours'`
const STAMP = `'YYYY-MM-DD"T"HH24:MI:SS'`
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const scoped = (context: RunContext, column: string) => (context.employeeIds ? `AND ${column} = ANY(@employeeIds::int[])` : "")
const params = (context: RunContext) => ({ from: context.from, to: context.to, ...(context.employeeIds ? { employeeIds: context.employeeIds } : {}) })

// ---------------------------------------------------------------- Отказы

type Refusal = { id: number; day: string; clientKey: string; clientName: string; client?: ClientInfo; author: string; comment: string }

const refusalDays = dayGroups<Refusal>((record) => record.day)
const refusalClient = clientGroups<Refusal>((record) => record.client, (record) => record.clientName)

export const rejectionModel = defineModel<Refusal>({
  access: "field",
  async load(context) {
    if (context.employeeIds && !context.employeeIds.length) return []
    await ensureFieldSchema()
    const at = local("r.happened_at")
    const rows = (await context.db
      .prepare(
        `SELECT r.id, r.employee_id, r.client_id, r.reason, r.comment, to_char((${at})::date, 'YYYY-MM-DD') AS day
           FROM field_refusals r
          WHERE (${at})::date BETWEEN @from::date AND @to::date ${scoped(context, "r.employee_id")}`,
      )
      .all(params(context))) as Record<string, unknown>[]
    const [clients, employees] = await Promise.all([context.dir.clients(), context.dir.employees()])
    return rows.flatMap((row) => {
      const client = row.client_id === null ? undefined : clients.get(Number(row.client_id))
      if (context.branch && nameKey(client?.branch) !== nameKey(context.branch)) return []
      return [
        {
          id: Number(row.id),
          day: str(row.day),
          clientKey: client ? `id:${client.id}` : "",
          clientName: client?.name ?? "",
          client,
          author: employees.get(Number(row.employee_id))?.name ?? "",
          // The reason the agent picked, with what they typed after it.
          comment: [str(row.reason), str(row.comment)].filter(Boolean).join(". "),
        },
      ]
    })
  },
  groups: {
    market_id: refusalClient.name,
    comment: { label: (record) => record.comment },
    user_id: { label: (record) => record.author },
    market_responsible_agent_id: refusalClient.agent,
    branch_name: refusalClient.branch,
    created_date_day: refusalDays.byDay,
    created_date_week: refusalDays.byWeek,
    created_date_month: refusalDays.byMonth,
  },
  measures: {
    market_count: distinct((record) => record.clientKey),
    count: count(),
  },
  filters: {
    market_user_name: { value: (record) => record.client?.agent },
    user_name: { value: (record) => record.author },
    Branch: { value: (record) => record.client?.branch },
  },
})

// ---------------------------------------------------------------- Задачи / Визит

type TaskType = "visit" | "order" | "rejection" | "service_time" | "custom" | "delivery" | "return" | "payment"
const TYPE_LABEL: Record<TaskType, string> = {
  payment: "Оплата",
  visit: "Визит",
  delivery: "Доставка",
  order: "Заказ",
  return: "Возврат",
  custom: "Своя задача",
  rejection: "Отказ",
  service_time: "Время обслуживания",
}
type TaskStatus = "done" | "pending" | "undone"
const STATUS_LABEL: Record<TaskStatus, string> = { pending: "В процессе", done: "Выполнено", undone: "Невыполнено" }

type Task = {
  type: TaskType
  /** «ИД плана»: the route plan of a planned visit, else the document. */
  id: string
  user: string
  employee?: EmployeeInfo
  clientKey: string
  clientName: string
  client?: ClientInfo
  /** The day of the task. */
  day: string
  /** Local "YYYY-MM-DDTHH:mm:ss" it was done at ("" while it is not). */
  doneAt: string
  status: TaskStatus
  /** A visit of the route plan. */
  planned: boolean
  /** A visit that ended with an order. */
  effective: boolean
  /** An order task: the order's amount, base currency. */
  orderSum: number
  /** Time in the shop: seconds, start and end (local stamps). */
  serviceSec: number | null
  serviceStart: string
  serviceEnd: string
}

async function loadTasks(context: RunContext, visitsOnly: boolean): Promise<Task[]> {
  if (context.employeeIds && !context.employeeIds.length) return []
  const { db, dir, money } = context
  const [clients, employees, employeesByName] = await Promise.all([dir.clients(), dir.employees(), dir.employeesByName()])
  const allowed = context.employeeIds ? new Set(context.employeeIds) : null
  const tasks: Task[] = []
  const add = (task: Omit<Task, "clientKey" | "clientName" | "client" | "user" | "employee"> & { employeeId: number | null; userName?: string; clientId: number | null; clientText?: string }) => {
    const employee = task.employeeId === null ? employeesByName.get(nameKey(task.userName)) : employees.get(task.employeeId)
    if (allowed && (!employee || !allowed.has(employee.id))) return
    const client = task.clientId === null ? undefined : clients.get(task.clientId)
    if (context.branch && nameKey(client?.branch ?? employee?.branch) !== nameKey(context.branch)) return
    const { employeeId: _employeeId, userName, clientId: _clientId, clientText, ...rest } = task
    void _employeeId
    void _clientId
    tasks.push({
      ...rest,
      user: employee?.name || userName || "",
      employee,
      clientKey: client ? `id:${client.id}` : `name:${nameKey(clientText)}`,
      clientName: client?.name ?? clientText ?? "",
      client,
    })
  }

  // Visits: the planned and the visited shops of each employee and day.
  for (const day of await clientDays(context.from, context.to, context.employeeIds)) {
    const visited = day.visits > 0
    add({
      type: "visit",
      id: day.planId === null ? "" : String(day.planId),
      employeeId: day.employeeId,
      clientId: day.clientId,
      day: day.day,
      doneAt: visited ? (day.firstStart ?? "") : "",
      status: day.open ? "pending" : visited ? "done" : "undone",
      planned: day.planned,
      effective: day.effective,
      orderSum: 0,
      serviceSec: visited ? day.storeSec : null,
      serviceStart: day.firstStart ?? "",
      serviceEnd: day.lastEnd ?? "",
    })
  }
  if (visitsOnly) return tasks

  const base = { planned: false, effective: false, orderSum: 0, serviceSec: null, serviceStart: "", serviceEnd: "" }
  const query = async (sql: string) => (await db.prepare(sql).all(params(context))) as Record<string, unknown>[]
  const between = (expr: string) => `(${expr})::date BETWEEN @from::date AND @to::date`

  // Time in the shop: every visit session.
  await ensureFieldSchema()
  const started = local("v.started_at")
  for (const row of await query(
    `SELECT v.id, v.employee_id, v.client_id, to_char(${started}, ${STAMP}) AS started, to_char(${local("v.finished_at")}, ${STAMP}) AS finished,
            EXTRACT(EPOCH FROM (v.finished_at - v.started_at))::float8 AS seconds
       FROM field_visits v WHERE ${between(started)} ${scoped(context, "v.employee_id")}`,
  )) {
    const finished = str(row.finished)
    add({
      ...base,
      type: "service_time",
      id: `v${row.id}`,
      employeeId: Number(row.employee_id),
      clientId: row.client_id === null ? null : Number(row.client_id),
      day: str(row.started).slice(0, 10),
      doneAt: finished,
      status: finished ? "done" : "pending",
      serviceSec: finished ? Number(row.seconds) || 0 : null,
      serviceStart: str(row.started),
      serviceEnd: finished,
    })
  }

  // Refusals.
  const refused = local("r.happened_at")
  for (const row of await query(
    `SELECT r.id, r.employee_id, r.client_id, to_char(${refused}, ${STAMP}) AS at FROM field_refusals r WHERE ${between(refused)} ${scoped(context, "r.employee_id")}`,
  )) {
    add({ ...base, type: "rejection", id: `r${row.id}`, employeeId: Number(row.employee_id), clientId: row.client_id === null ? null : Number(row.client_id), day: str(row.at).slice(0, 10), doneAt: str(row.at), status: "done" })
  }

  // Orders: made by their agent on the day they were created.
  const created = "fin_ts(o.created_at, true)"
  for (const row of await query(
    `SELECT o.id, o.client_id, o.client, o.market_name, o.agent, o.currency, o.created_at, to_char(${created}, ${STAMP}) AS at,
            COALESCE((SELECT SUM((i.quantity - LEAST(i.quantity, COALESCE((to_jsonb(i) ->> 'return_quantity')::float8, 0))) * i.unit_price * (1 - COALESCE(i.discount_percent, 0) / 100))
                        FROM order_items i WHERE i.order_id = o.id), 0) AS fact
       FROM orders o WHERE o.status <> 'Отменен' AND ${between(created)}`,
  )) {
    add({
      ...base,
      type: "order",
      id: `o${row.id}`,
      employeeId: null,
      userName: str(row.agent),
      clientId: row.client_id === null ? null : Number(row.client_id),
      clientText: str(row.market_name) || str(row.client),
      day: str(row.at).slice(0, 10),
      doneAt: str(row.at),
      status: "done",
      orderSum: money.base(Number(row.fact) || 0, normCurrency(str(row.currency), money.code), str(row.created_at)),
    })
  }

  // Deliveries: the orders of a deliverer on their delivery day.
  const delivery = `COALESCE(fin_ts(NULLIF(o.delivery, '')), ${created})`
  for (const row of await query(
    `SELECT o.id, o.client_id, o.client, o.market_name, o.delivery_man, o.status, to_char((${delivery})::date, 'YYYY-MM-DD') AS day,
            to_char(fin_ts(NULLIF(to_jsonb(o) ->> 'shipped_at', ''), true), ${STAMP}) AS shipped
       FROM orders o WHERE o.status IN ('Есть на складе', 'В пути', 'Доставлено') AND COALESCE(o.delivery_man, '') <> '' AND ${between(delivery)}`,
  )) {
    const status = str(row.status)
    add({
      ...base,
      type: "delivery",
      id: `d${row.id}`,
      employeeId: null,
      userName: str(row.delivery_man),
      clientId: row.client_id === null ? null : Number(row.client_id),
      clientText: str(row.market_name) || str(row.client),
      day: str(row.day),
      doneAt: status === "Доставлено" ? str(row.shipped) : "",
      status: status === "Доставлено" ? "done" : "pending",
    })
  }

  // Returns: taken from the shop by their agent.
  const returned = "COALESCE(fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))"
  for (const row of await query(
    `SELECT r.id, r.client_id, r.client, r.agent, r.created_by, r.status, to_char(${returned}, ${STAMP}) AS at
       FROM client_returns r WHERE r.status <> 'cancelled' AND ${between(returned)}`,
  )) {
    add({
      ...base,
      type: "return",
      id: `b${row.id}`,
      employeeId: null,
      userName: str(row.agent) || str(row.created_by),
      clientId: row.client_id === null ? null : Number(row.client_id),
      clientText: str(row.client),
      day: str(row.at).slice(0, 10),
      doneAt: str(row.status) === "accepted" ? str(row.at) : "",
      status: str(row.status) === "accepted" ? "done" : "pending",
    })
  }

  // Payments: taken from a client by an agent or a deliverer.
  const paid = "COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.created_at, true))"
  for (const row of await query(
    `SELECT p.id, p.client_id, p.client, COALESCE(NULLIF(p.agent, ''), NULLIF(p.delivery_man, '')) AS taker, to_char(${paid}, ${STAMP}) AS at
       FROM customer_payments p
      WHERE COALESCE((to_jsonb(p) ->> 'is_deleted')::int, 0) = 0 AND COALESCE(NULLIF(p.agent, ''), NULLIF(p.delivery_man, '')) IS NOT NULL AND ${between(paid)}`,
  ).catch(() => [])) {
    add({ ...base, type: "payment", id: `p${row.id}`, employeeId: null, userName: str(row.taker), clientId: row.client_id === null ? null : Number(row.client_id), clientText: str(row.client), day: str(row.at).slice(0, 10), doneAt: str(row.at), status: "done" })
  }

  // Tasks set by hand (Задачи).
  for (const row of await query(
    `SELECT t.id, t.employee_id, t.responsible, t.client_id, t.store, t.status, to_char(fin_ts(NULLIF(t.date, ''))::date, 'YYYY-MM-DD') AS day,
            to_char(fin_ts(t.updated_at, true), ${STAMP}) AS changed
       FROM tasks t WHERE ${between("fin_ts(NULLIF(t.date, ''))")}`,
  ).catch(() => [])) {
    const done = str(row.status) === "done"
    add({
      ...base,
      type: "custom",
      id: `t${row.id}`,
      employeeId: row.employee_id === null ? null : Number(row.employee_id),
      userName: str(row.responsible),
      clientId: row.client_id === null ? null : Number(row.client_id),
      clientText: str(row.store),
      day: str(row.day),
      doneAt: done ? str(row.changed) : "",
      status: done ? "done" : str(row.status) === "cancelled" ? "undone" : "pending",
    })
  }
  return tasks
}

type T = Task
const days = dayGroups<T>((task) => task.day)
const client = clientGroups<T>((task) => task.client, (task) => task.clientName)
const text = (pick: (task: T) => string | number | null | undefined): GroupDef<T> => ({ label: pick })
const spaced = (stamp: string) => stamp.replace("T", " ")

const GROUPS: Record<string, GroupDef<T>> = {
  user_id: text((task) => task.user),
  border_id: client.zone,
  code: client.code,
  date: days.byDay,
  modified_date: text((task) => clock(task.doneAt)),
  modified_date__date: { label: (task) => dmy(task.doneAt), sort: (task) => task.doneAt.slice(0, 10) },
  date_day: days.byDay,
  market_id: client.name,
  id: text((task) => task.id),
  service_time: text((task) => (task.serviceSec === null ? "" : plain(task.serviceSec / 60, 2))),
  service_time_begin: text((task) => spaced(task.serviceStart)),
  service_time_end: text((task) => spaced(task.serviceEnd)),
  type: text((task) => TYPE_LABEL[task.type]),
  status: text((task) => STATUS_LABEL[task.status]),
}

const isVisit = (task: T) => task.type === "visit"
const done = (task: T) => task.status === "done"
const success = (task: T) => isVisit(task) && done(task) && task.effective
const doneVisitAt = (task: T) => (isVisit(task) && done(task) ? task.doneAt : "")
const rate =
  (part: (task: T) => boolean, whole: (task: T) => boolean): MeasureFn<T> =>
  (records) => {
    let a = 0
    let b = 0
    for (const task of records) {
      if (whole(task)) b++
      if (part(task)) a++
    }
    return round((a * 100) / Math.max(b, 1), 1)
  }

const TASK_MEASURES: Record<string, MeasureFn<T>> = {
  task_count: count(),
  market_count: distinct((task) => task.clientKey),
  done_amount: count(done),
  pending_amount: count((task) => task.status === "pending"),
  undone_amount: count((task) => task.status === "undone"),
  plan_visit_count: count((task) => isVisit(task) && task.planned),
  fact_plan_visit_count: count((task) => isVisit(task) && task.planned && done(task)),
  fact_no_plan_visit_count: count((task) => isVisit(task) && !task.planned && done(task)),
  no_visit_count: count((task) => isVisit(task) && task.planned && !done(task)),
  akb: distinct((task) => (success(task) ? task.clientKey : null)),
  success_visit_count: count(success),
  order_total_price: sum((task) => (task.type === "order" && done(task) ? task.orderSum : 0), 2),
  min_start_time: minText(doneVisitAt, clock),
  max_start_time: maxText(doneVisitAt, clock),
}

const VISIT_MEASURES: Record<string, MeasureFn<T>> = {
  plan_count: count((task) => task.planned),
  all_visit_count: count(done),
  plan_visit_count: count((task) => task.planned && done(task)),
  plan_visit_rate: rate((task) => task.planned && done(task), (task) => task.planned),
  fact_no_plan_visit_count: count((task) => !task.planned && done(task)),
  no_visit_count: count((task) => task.planned && !done(task)),
  success_visit_count: count(success),
  strike_rate: rate(success, done),
  // «Посещено − Результативный визит»: the visits that brought no order.
  reject_visit_count: count((task) => done(task) && !task.effective),
  min_start_time: minText((task) => (done(task) ? task.doneAt : ""), clock),
  max_start_time: maxText((task) => (done(task) ? task.doneAt : ""), clock),
}

const eq = (pick: FilterDef<T>["value"], options?: FilterDef<T>["options"]): FilterDef<T> => ({ value: pick, options })
const FILTERS: Record<string, FilterDef<T>> = {
  User: eq((task) => task.user),
  today_plan_status_filter: eq((task) => STATUS_LABEL[task.status], () => Object.values(STATUS_LABEL)),
  today_plan_type_filter: eq((task) => TYPE_LABEL[task.type], () => Object.values(TYPE_LABEL)),
  Border: eq((task) => task.client?.zone),
  Branch: eq((task) => task.client?.branch ?? task.employee?.branch),
}

export const todayPlansModel = defineModel<T>({ access: "field", load: (context) => loadTasks(context, false), groups: GROUPS, measures: TASK_MEASURES, filters: FILTERS })
export const visitModel = defineModel<T>({ access: "field", load: (context) => loadTasks(context, true), groups: GROUPS, measures: VISIT_MEASURES, filters: FILTERS })
