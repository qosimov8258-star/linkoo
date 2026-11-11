import "server-only"

import { normCurrency } from "@/lib/finance/currency"

import { defineModel, type FilterDef } from "../context"
import { nameKey, type ClientInfo, type EmployeeInfo } from "../directory"
import { clientGroups, YES_NO } from "../facets"
import { count, dayGroups, distinct, dmy, dmyTime, maxText, plain, round, sum, yesNo, type GroupDef, type MeasureFn } from "../pivot"

// The remaining models of the old report builder this app has data for:
//   order_logs       «Лог изменений заказов»: the history lines of the orders;
//   debt_separation  «Распределение оплат по заказам»: the payments and returns booked against the orders (money);
//   merch_report     «Фотоотчет»: the photo reports of the field staff (field scope);
//   attendance       «Посещаемость»: the attendance days of the employees;
//   user             «Пользователь»: the employees, whatever the period;
//   subscription     «Подписка»: the licences of the employees, whatever the period.

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const num = (value: unknown) => Number(value) || 0
/** «Права доступа · Должность» of an employee card. */
const roleOf = (employee?: EmployeeInfo) => (employee?.position ?? "").split(" · ")[0]?.trim() ?? ""
const jobOf = (employee?: EmployeeInfo) => (employee?.position ?? "").split(" · ").slice(1).join(" · ").trim()

// ---------------------------------------------------------------- Лог изменений заказов

type OrderLog = { id: number; orderId: number; day: string; at: string; shop: string; total: number; comment: string; author: string; action: string }
const ORDER_ACTION: Record<string, string> = {
  created: "Создан",
  updated: "Изменен",
  given: "Передан доставщику",
  delivered: "Доставлен",
  canceled: "Отменен",
  add_bonus: "Добавлен бонус",
  add_discount: "Добавлена скидка",
  change_invoice: "Изменена счет-фактура",
}
const logDays = dayGroups<OrderLog>((row) => row.day)

export const orderLogsModel = defineModel<OrderLog>({
  access: "any",
  async load(context) {
    // The history keeps the local moment for the lines of the copied account and UTC for the app's own.
    const at = "COALESCE(fin_ts(NULLIF(l.created_at, ''), l.created_at NOT LIKE '%T%'), fin_ts(l.created_at))"
    const rows = (await context.db
      .prepare(
        `SELECT l.id, l.order_id, l.action, l.comment, l.total_price, l.created_by, COALESCE(NULLIF(l.market_name, ''), o.market_name, o.client) AS shop,
                o.branch_name, to_char(${at}, 'YYYY-MM-DD"T"HH24:MI:SS') AS at
           FROM order_logs l LEFT JOIN orders o ON o.id = l.order_id
          WHERE (${at})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    return rows.flatMap((row) => {
      if (context.branch && nameKey(row.branch_name) !== nameKey(context.branch)) return []
      return [{ id: Number(row.id), orderId: Number(row.order_id), day: str(row.at).slice(0, 10), at: str(row.at), shop: str(row.shop), total: num(row.total_price), comment: str(row.comment), author: str(row.created_by), action: ORDER_ACTION[str(row.action)] ?? str(row.action) }]
    })
  },
  groups: {
    market_name: { label: (row) => row.shop },
    order_id: { label: (row) => row.orderId },
    total_price: { label: (row) => plain(row.total, 2) },
    comment: { label: (row) => row.comment },
    created_by_id: { label: (row) => row.author },
    action: { label: (row) => row.action },
    created_date_by_day: logDays.byDay,
  },
  measures: {
    change_count: count(),
    market_count: distinct((row) => nameKey(row.shop)),
    created_date_log: maxText((row) => row.at, dmyTime),
  },
  filters: { user_name: { value: (row) => row.author } },
})

// ---------------------------------------------------------------- Распределение оплат по заказам

type Share = { orderId: number; orderDay: string; currency: string; agent: string; kind: string; tx: string; day: string; amount: number; organization: string }
const SHARE_KIND: Record<string, string> = { "1": "Оплата", "3": "Возврат", "9": "Баланс" }

export const debtSeparationModel = defineModel<Share>({
  access: "money",
  async load(context) {
    const at = "fin_ts(NULLIF(r.created_date, ''))"
    const rows = (await context.db
      .prepare(
        `SELECT r.order_id, r.kind, r.tx_id, r.return_id, r.amount, r.currency, o.agent, o.organization, o.branch_name,
                to_char((${at})::date, 'YYYY-MM-DD') AS day, to_char(fin_ts(o.created_at, true)::date, 'YYYY-MM-DD') AS order_day
           FROM order_payment_rows r LEFT JOIN orders o ON o.id = r.order_id
          WHERE (${at})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    return rows.flatMap((row) => {
      if (context.branch && nameKey(row.branch_name) !== nameKey(context.branch)) return []
      const fx = context.money.rate(normCurrency(str(row.currency), context.money.code), str(row.day))
      const tx = Number(row.tx_id) || Number(row.return_id) || 0
      return [{ orderId: Number(row.order_id), orderDay: str(row.order_day), currency: fx.name, agent: str(row.agent), kind: SHARE_KIND[str(row.kind)] ?? str(row.kind), tx: tx ? String(tx) : "", day: str(row.day), amount: num(row.amount) * fx.own, organization: str(row.organization) }]
    })
  },
  groups: {
    to_order_id: { label: (row) => row.orderId },
    to_order_created_date: { label: (row) => dmy(row.orderDay), sort: (row) => row.orderDay },
    from_currency_name: { label: (row) => row.currency },
    to_order_user: { label: (row) => row.agent },
    from_payment_type: { label: (row) => row.kind },
    from_transaction_id: { label: (row) => row.tx },
    from_accepted_time: { label: (row) => dmy(row.day), sort: (row) => row.day },
    from_transaction_amount: { label: (row) => plain(row.amount, 2) },
    from_division: { label: (row) => row.organization },
  },
  measures: { amount: sum((row) => row.amount, 2) },
  filters: {},
})

// ---------------------------------------------------------------- Фотоотчет

type Photo = { id: number; day: string; status: string; client?: ClientInfo; employee?: EmployeeInfo }
const photoDays = dayGroups<Photo>((row) => row.day)
const photoClient = clientGroups<Photo>((row) => row.client, () => "")
const processed = (row: Photo) => row.status === "accepted" || row.status === "approved" || row.status === "rejected"

export const merchReportModel = defineModel<Photo>({
  access: "field",
  async load(context) {
    if (context.employeeIds && !context.employeeIds.length) return []
    const at = "((r.happened_at AT TIME ZONE 'UTC') + interval '5 hours')"
    const rows = (await context.db
      .prepare(
        `SELECT r.id, r.employee_id, r.client_id, r.status, to_char((${at})::date, 'YYYY-MM-DD') AS day
           FROM field_photo_reports r
          WHERE (${at})::date BETWEEN @from::date AND @to::date ${context.employeeIds ? "AND r.employee_id = ANY(@employeeIds::int[])" : ""}`,
      )
      .all({ from: context.from, to: context.to, ...(context.employeeIds ? { employeeIds: context.employeeIds } : {}) })) as Record<string, unknown>[]
    const [clients, employees] = await Promise.all([context.dir.clients(), context.dir.employees()])
    return rows.flatMap((row) => {
      const client = row.client_id === null ? undefined : clients.get(Number(row.client_id))
      if (context.branch && nameKey(client?.branch) !== nameKey(context.branch)) return []
      return [{ id: Number(row.id), day: str(row.day), status: str(row.status), client, employee: employees.get(Number(row.employee_id)) }]
    })
  },
  groups: {
    market_name: photoClient.name,
    user_name: { label: (row) => row.employee?.name },
    supervisor_name: { label: (row) => row.employee?.supervisor },
    created_date_2: photoDays.byDay,
    created_date_day: photoDays.byDay,
    created_date_week: photoDays.byWeek,
    created_date_month: photoDays.byMonth,
  },
  measures: {
    count_all: count(),
    count_market: distinct((row) => row.client?.id),
    count_processed: count(processed),
    count_pending: count((row) => !processed(row)),
    count_approved: count((row) => row.status === "accepted" || row.status === "approved"),
    count_rejected: count((row) => row.status === "rejected"),
    percent_processed: (records) => (records.length ? round((records.filter(processed).length * 100) / records.length, 2) : 0),
  },
  filters: { Market: { value: (row) => row.client?.name }, User: { value: (row) => row.employee?.name } },
})

// ---------------------------------------------------------------- Посещаемость

type Attendance = { day: string; type: string; arrival: string; late: boolean; employee?: EmployeeInfo }

export const attendanceModel = defineModel<Attendance>({
  access: "money",
  async load(context) {
    const rows = (await context.db
      .prepare("SELECT employee_id, day, type, arrival_time, late_minutes FROM attendance_days WHERE day BETWEEN @from AND @to AND type NOT IN ('holiday', 'not_come')")
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    const employees = await context.dir.employees()
    return rows.flatMap((row) => {
      const employee = employees.get(Number(row.employee_id))
      if (context.branch && nameKey(employee?.branch) !== nameKey(context.branch)) return []
      return [{ day: str(row.day).slice(0, 10), type: str(row.type), arrival: str(row.arrival_time), late: num(row.late_minutes) > 0 || str(row.type) === "late", employee }]
    })
  },
  groups: {
    user_name: { label: (row) => row.employee?.name },
    job_name: { label: (row) => jobOf(row.employee) },
    supervisor_name: { label: (row) => row.employee?.supervisor },
    date: { label: (row) => dmy(row.day), sort: (row) => row.day },
    day_came_time: { label: (row) => row.arrival },
  },
  measures: {
    late_to_office_count: count((row) => row.late),
    attendance_count: count(),
  },
  filters: {
    User: { value: (row) => row.employee?.name },
    Job: { value: (row) => jobOf(row.employee) },
    Branch: { value: (row) => row.employee?.branch },
  },
})

// ---------------------------------------------------------------- Пользователь

const userText = (pick: (row: EmployeeInfo) => string | number | null | undefined): GroupDef<EmployeeInfo> => ({ label: pick })
const userEq = (pick: FilterDef<EmployeeInfo>["value"], options?: FilterDef<EmployeeInfo>["options"]): FilterDef<EmployeeInfo> => ({ value: pick, options })

export const userModel = defineModel<EmployeeInfo>({
  access: "money",
  async load(context) {
    const employees = [...(await context.dir.employees()).values()]
    return context.branch ? employees.filter((employee) => nameKey(employee.branch) === nameKey(context.branch)) : employees
  },
  groups: {
    id: userText((row) => row.id),
    username: userText((row) => row.login),
    first_name: userText((row) => row.firstName),
    second_name: userText((row) => row.lastName),
    is_active: userText((row) => yesNo(row.active)),
    position_name: userText(roleOf),
    job_name: userText(jobOf),
    branch_names: userText((row) => row.branch),
    service_id: userText((row) => row.code),
  },
  measures: { count: count() },
  filters: {
    boolean_is_active: userEq((row) => yesNo(row.active), () => YES_NO),
    Position: userEq(roleOf),
    Job: userEq(jobOf),
    Branch: userEq((row) => row.branch),
  },
})

// ---------------------------------------------------------------- Подписка

type Licence = { id: string; name: string; begin: string; end: string; price: number; employee?: EmployeeInfo }
const licenceMeasures: Record<string, MeasureFn<Licence>> = { count: count(), sum_price: sum((row) => row.price, 2) }

export const subscriptionModel = defineModel<Licence>({
  access: "money",
  async load(context) {
    const rows = (await context.db.prepare("SELECT employee_id, seq, license_name, begin_date, end_date, price FROM employee_subscriptions").all().catch(() => [])) as Record<string, unknown>[]
    const employees = await context.dir.employees()
    return rows.flatMap((row) => {
      const employee = employees.get(Number(row.employee_id))
      if (context.branch && nameKey(employee?.branch) !== nameKey(context.branch)) return []
      return [{ id: `${row.employee_id}-${row.seq}`, name: str(row.license_name), begin: str(row.begin_date).slice(0, 10), end: str(row.end_date).slice(0, 10), price: num(row.price), employee }]
    })
  },
  groups: {
    id: { label: (row) => row.id },
    license: { label: (row) => row.name },
    user_full_name: { label: (row) => row.employee?.name },
    branch_names: { label: (row) => row.employee?.branch },
    begin_date: { label: (row) => dmy(row.begin), sort: (row) => row.begin },
    end_date: { label: (row) => dmy(row.end), sort: (row) => row.end },
    price: { label: (row) => plain(row.price, 2) },
  },
  measures: licenceMeasures,
  filters: {
    user_name: { value: (row) => row.employee?.name },
    Position: { value: (row) => roleOf(row.employee) },
    Job: { value: (row) => jobOf(row.employee) },
    Branch: { value: (row) => row.employee?.branch },
  },
})
