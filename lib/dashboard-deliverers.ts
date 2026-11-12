import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"
import { loadEntities, nameKey } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// The dashboard's deliverer widget, as Linko's stats/widget/delivery (checked month by month against it):
//   who: the employees «Долги доставщиков» lists (access right with the «Доставщик» capability) that have
//     «Показывать в отслеживании», deleted ones too — the most planned first, then by id;
//   Отгружено / Посещено: the orders handed over (В пути, Доставлено) with their delivery day in the period and the
//     deliverer on them — the exact sum of their lines (as Linko, every currency added as one number), the markets
//     planned / delivered (Не посещено = the rest);
//   Возвраты с отг. заказов: what was returned of those orders (Linko's total_return_price);
//   Возвраты за период: the returns made in the period with the deliverer on them;
//   Оплаты / Кассир принял: the client payments the deliverer made in the period (the user who made them — a payment made
//     by the admin for another delivery man is the admin's, as in Linko), and the part a cashbox accepted (green: all of
//     it, blue: some, red: none);
//   Посл.Активность: minutes since the deliverer's last action in the period (a delivery day, a return, a payment),
//     -1 = «Не вышел».

export type DelivererWidgetRow = {
  id: number
  name: string
  order: number
  orderReturn: number
  dateReturn: number
  plan: number
  done: number
  undone: number
  collect: number
  taken: number
  cashierColor: "green" | "blue" | "red"
  differenceMin: number
}

export type DelivererWidget = {
  rows: DelivererWidgetRow[]
  total: { order: number; orderMarkets: number; orderReturn: number; dateReturn: number; plan: number; done: number; undone: number; donePercent: number; collect: number; collectMarkets: number; taken: number }
}

type OrderRow = { id: number; client_id: number | null; status: string; total: number | null; returned: number | null; day: string | null; deliverer: string | null }

export async function getDelivererWidget(begin: string, end: string, db: PgDb = getDb()): Promise<DelivererWidget> {
  const s = await ensureFinanceSchema(db)
  const people = (await loadEntities("deliverer", db, s)).filter((entity) => Number(entity.info.is_deliverer) === 1 && entity.id !== null)
  const tracked = new Set(
    ((await db.prepare("SELECT id FROM employees WHERE COALESCE(show_in_tracking, 0) = 1").all().catch(() => [])) as Array<{ id: number }>).map((row) => Number(row.id)),
  )
  const listed = people.filter((person) => tracked.has(Number(person.id)))

  const appReturns = s.col("client_returns", "client_credit")
    ? `COALESCE((SELECT SUM(r.amount::numeric) FROM client_returns r WHERE r.order_id = o.id AND r.status <> 'cancelled' AND r.client_credit IS NULL), 0)`
    : "0"
  const orders = (await db
    .prepare(
      `SELECT o.id, o.client_id, o.status,
              COALESCE((SELECT SUM(i.quantity::numeric * i.unit_price::numeric * (1 - COALESCE(i.discount_percent, 0)::numeric / 100)) FROM order_items i WHERE i.order_id = o.id), o.total_price::numeric)::float8 AS total,
              (COALESCE(o.return_price, 0)::numeric + ${appReturns})::float8 AS returned,
              to_char(fin_ts(o.delivery)::date, 'YYYY-MM-DD') AS day, o.delivery_man AS deliverer
         FROM orders o
        WHERE o.status IN ('В пути', 'Доставлено') AND fin_ts(o.delivery)::date BETWEEN @begin::date AND @end::date`,
    )
    .all({ begin, end })) as OrderRow[]
  const returns = (await db
    .prepare(
      `SELECT r.amount::float8 AS amount, r.status, r.deliverer, to_char(fin_ts(r.return_date), 'YYYY-MM-DD"T"HH24:MI:SS') AS at
         FROM client_returns r WHERE fin_ts(r.return_date)::date BETWEEN @begin::date AND @end::date`,
    )
    .all({ begin, end })
    .catch(() => [])) as Array<{ amount: number | null; status: string; deliverer: string | null; at: string | null }>
  const payments = (await db
    .prepare(
      `SELECT p.amount::float8 AS amount, p.accepted, p.client_id, p.created_by AS who,
              to_char(fin_ts(p.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') AS at
         FROM customer_payments p
        WHERE COALESCE(p.is_deleted, 0) = 0 AND fin_ts(p.created_at, true)::date BETWEEN @begin::date AND @end::date`,
    )
    .all({ begin, end })
    .catch(() => [])) as Array<{ amount: number | null; accepted: number | null; client_id: number | null; who: string | null; at: string | null }>

  const now = Date.parse(`${nowLocalIso()}Z`)
  const total = { order: 0, orderMarkets: 0, orderReturn: 0, dateReturn: 0, plan: 0, done: 0, undone: 0, donePercent: 0, collect: 0, collectMarkets: 0, taken: 0 }
  // Totals count each market once, whoever's it is (Linko: plan 26 where the deliverers' rows add up to 28).
  const plannedAll = new Set<number>()
  const deliveredAll = new Set<number>()
  const collectMarkets = new Set<string>()
  const rows: DelivererWidgetRow[] = listed.map((person) => {
    const key = nameKey(person.name)
    const own = orders.filter((order) => nameKey(order.deliverer) === key)
    const planned = new Set(own.map((order) => order.client_id ?? -order.id))
    const delivered = new Set(own.filter((order) => order.status === "Доставлено").map((order) => order.client_id ?? -order.id))
    const ownReturns = returns.filter((item) => nameKey(item.deliverer) === key)
    const ownPayments = payments.filter((item) => nameKey(item.who) === key)
    const collect = ownPayments.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const taken = ownPayments.filter((item) => Number(item.accepted) === 1).reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    for (const item of ownPayments) collectMarkets.add(String(item.client_id ?? "none"))
    for (const market of planned) plannedAll.add(market)
    for (const market of delivered) deliveredAll.add(market)
    // The last action: a delivery day (its start), a return or a payment of the deliverer in the period.
    const moments = [
      ...own.filter((order) => order.status === "Доставлено" && order.day).map((order) => `${order.day}T00:00:00`),
      ...ownReturns.map((item) => item.at ?? ""),
      ...ownPayments.map((item) => item.at ?? ""),
    ].filter(Boolean)
    const last = moments.length ? moments.reduce((a, b) => (a > b ? a : b)) : ""
    const row: DelivererWidgetRow = {
      id: Number(person.id),
      name: person.name,
      order: own.reduce((sum, order) => sum + Number(order.total ?? 0), 0),
      orderReturn: own.reduce((sum, order) => sum + Number(order.returned ?? 0), 0),
      dateReturn: ownReturns.reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      plan: planned.size,
      done: delivered.size,
      undone: planned.size - delivered.size,
      collect,
      taken,
      cashierColor: collect > 0 && taken >= collect - 1e-6 ? "green" : taken > 0 ? "blue" : "red",
      differenceMin: last ? Math.max(0, Math.floor((now - Date.parse(`${last}Z`)) / 60_000)) : -1,
    }
    total.order += row.order
    total.orderReturn += row.orderReturn
    total.dateReturn += ownReturns.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    total.collect += row.collect
    total.taken += row.taken
    return row
  })
  rows.sort((a, b) => b.plan - a.plan || a.id - b.id)
  total.plan = plannedAll.size
  total.done = deliveredAll.size
  total.undone = total.plan - total.done
  total.orderMarkets = total.plan
  total.collectMarkets = collectMarkets.size
  total.donePercent = total.plan ? Math.round((total.done / total.plan) * 100) : 0
  return { rows, total }
}
