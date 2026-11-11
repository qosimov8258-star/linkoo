import "server-only"

import { todayIso } from "@/lib/finance/dates"

import { defineModel, type FilterDef } from "../context"
import { nameKey, type ClientInfo } from "../directory"
import { clientGroups } from "../facets"
import { count, dmy, dmyTime, lastText, maxText, type GroupDef, type MeasureFn } from "../pivot"

// market «Магазины»: one record per client (a shop) that is not closed, whatever the period — when it ordered
// first and last, how long ago, its last refusal and visit, the days of its route plan.

type Shop = {
  client: ClientInfo
  /** Local days ("" when there is none). */
  firstOrder: string
  lastOrder: string
  lastRefusal: string
  lastRefusalComment: string
  lastVisit: string
  /** Weekdays of the responsible agent's route plan, "Пн, Ср". */
  plan: string
  /** Whole days since the last order (null without one). */
  idleDays: number | null
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

type S = Shop
const client = clientGroups<S>((shop) => shop.client, (shop) => shop.client.name)
const text = (pick: (shop: S) => string | number | null | undefined): GroupDef<S> => ({ label: pick })
const eq = (pick: FilterDef<S>["value"]): FilterDef<S> => ({ value: pick })

const GROUPS: Record<string, GroupDef<S>> = {
  created_date_name: { label: (shop) => dmyTime(shop.client.createdAt.replace(" ", "T")), sort: (shop) => shop.client.createdAt },
  code: client.code,
  id: client.id,
  name: client.name,
  note: client.note,
  plan_id: text((shop) => shop.plan),
  first_order_date: { label: (shop) => dmy(shop.firstOrder), sort: (shop) => shop.firstOrder },
  address: client.address,
  guide: client.landmark,
  contact_name: client.contact,
  responsible_agent_id: client.agent,
  border_id: client.zone,
  market_type_id: client.type,
  branch_id: client.branch,
  // Clients of this app take their price list from the order, not from their card.
  price_list_name: text(() => ""),
  delivery_man_id: client.deliverer,
}

const MEASURES: Record<string, MeasureFn<S>> = {
  // A value of the shop itself; for several shops together: the latest date, the shortest idle time.
  last_order_date: maxText((shop) => shop.lastOrder, dmy),
  last_order_past_days: (records) => {
    let found: number | null = null
    for (const shop of records) if (shop.idleDays !== null && (found === null || shop.idleDays < found)) found = shop.idleDays
    return found ?? ""
  },
  last_rejection_date: maxText((shop) => shop.lastRefusal, dmy),
  last_rejection_comment: lastText((shop) => shop.lastRefusal, (shop) => shop.lastRefusalComment),
  last_visit_date: maxText((shop) => shop.lastVisit, dmy),
  market_count: count(),
}

const FILTERS: Record<string, FilterDef<S>> = {
  responsible_agent_name: eq((shop) => shop.client.agent),
  delivery_man_name: eq((shop) => shop.client.deliverer),
  filter_last_order_past_days: eq((shop) => shop.idleDays ?? ""),
  border_name: eq((shop) => shop.client.zone),
}

export const marketModel = defineModel<S>({
  access: "any",
  async load(context) {
    const { db, dir } = context
    const [clients, employeesByName] = await Promise.all([dir.clients(), dir.employeesByName()])
    const all = <T,>(sql: string) => db.prepare(sql).all().catch(() => []) as Promise<T[]>
    const [orders, refusals, visits, plans] = await Promise.all([
      context.wants("last_order_date", "last_order_past_days", "first_order_date", "filter_last_order_past_days")
        ? all<{ client_id: number; first: string; last: string }>(
            `SELECT client_id, to_char(MIN(fin_ts(created_at, true))::date, 'YYYY-MM-DD') AS first, to_char(MAX(fin_ts(created_at, true))::date, 'YYYY-MM-DD') AS last
               FROM orders WHERE status <> 'Отменен' AND client_id IS NOT NULL GROUP BY client_id`,
          )
        : [],
      context.wants("last_rejection_date", "last_rejection_comment")
        ? all<{ client_id: number; day: string; reason: string; comment: string }>(
            `SELECT DISTINCT ON (client_id) client_id, to_char(((happened_at AT TIME ZONE 'UTC') + interval '5 hours')::date, 'YYYY-MM-DD') AS day, reason, comment
               FROM field_refusals WHERE client_id IS NOT NULL ORDER BY client_id, happened_at DESC`,
          )
        : [],
      context.wants("last_visit_date")
        ? all<{ client_id: number; day: string }>(
            `SELECT client_id, to_char(MAX((started_at AT TIME ZONE 'UTC') + interval '5 hours')::date, 'YYYY-MM-DD') AS day FROM field_visits WHERE client_id IS NOT NULL GROUP BY client_id`,
          )
        : [],
      context.wants("plan_id") ? all<{ client_id: number; employee_id: number; weekdays: number }>("SELECT client_id, employee_id, weekdays FROM field_route_plans") : [],
    ])
    const orderOf = new Map(orders.map((row) => [Number(row.client_id), row]))
    const refusalOf = new Map(refusals.map((row) => [Number(row.client_id), row]))
    const visitOf = new Map(visits.map((row) => [Number(row.client_id), str(row.day)]))
    const plansOf = new Map<number, { employeeId: number; weekdays: number }[]>()
    for (const row of plans) {
      const list = plansOf.get(Number(row.client_id)) ?? []
      list.push({ employeeId: Number(row.employee_id), weekdays: Number(row.weekdays) })
      plansOf.set(Number(row.client_id), list)
    }
    const today = todayIso()
    const shops: Shop[] = []
    for (const item of clients.values()) {
      if (!item.active) continue
      if (context.branch && nameKey(item.branch) !== nameKey(context.branch)) continue
      const order = orderOf.get(item.id)
      const refusal = refusalOf.get(item.id)
      // The plan of the shop's responsible agent, else any plan of the shop.
      const responsible = employeesByName.get(nameKey(item.agent))?.id
      const list = plansOf.get(item.id) ?? []
      const mask = (list.find((plan) => plan.employeeId === responsible) ?? list[0])?.weekdays ?? 0
      const lastOrder = str(order?.last)
      shops.push({
        client: item,
        firstOrder: str(order?.first),
        lastOrder,
        lastRefusal: str(refusal?.day),
        lastRefusalComment: [str(refusal?.reason), str(refusal?.comment)].filter(Boolean).join(". "),
        lastVisit: visitOf.get(item.id) ?? "",
        plan: WEEKDAYS.filter((_, index) => mask & (1 << index)).join(", "),
        idleDays: lastOrder ? Math.max(0, daysBetween(lastOrder, today)) : null,
      })
    }
    return shops
  },
  groups: GROUPS,
  measures: MEASURES,
  filters: FILTERS,
})
