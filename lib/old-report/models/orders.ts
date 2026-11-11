import "server-only"

import { allocatedOrderDues } from "@/lib/cash/orders"
import { currencyContext } from "@/lib/cash/common"
import { normCurrency } from "@/lib/finance/currency"
import { parseMoneyText } from "@/lib/orders-repo"

import { defineModel, type FilterDef } from "../context"
import { nameKey, type ClientInfo } from "../directory"
import { clientGroups, ORDER_STATUS_OPTIONS, orderStatusLabel, payTypeLabel } from "../facets"
import { dayGroups, distinct, sum, type GroupDef, type MeasureFn } from "../pivot"

// order «Заказы по дате доставки»: one record per order that is not cancelled, on its planned delivery day. The
// amounts are the order's own (its currency): what was ordered, what came back, and what the client still owes for
// it (the cash ledger's remainder, as the order list shows it).

type OrderRecord = {
  orderId: number
  day: string
  status: string
  agent: string
  deliverer: string
  clientKey: string
  clientName: string
  client?: ClientInfo
  organization: string
  priceList: string
  payType: string
  total: number
  returned: number
  debt: number
}

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const num = (value: unknown) => Number(value) || 0

type R = OrderRecord
const days = dayGroups<R>((order) => order.day)
const client = clientGroups<R>((order) => order.client, (order) => order.clientName)
const text = (pick: (order: R) => string | number | null | undefined): GroupDef<R> => ({ label: pick })
const eq = (pick: FilterDef<R>["value"], options?: FilterDef<R>["options"]): FilterDef<R> => ({ value: pick, options })

const GROUPS: Record<string, GroupDef<R>> = {
  user_id: text((order) => order.agent),
  delivery_man_id: text((order) => order.deliverer),
  border_name_group: client.zone,
  market_id: client.name,
  status: text((order) => order.status),
  payment_type: text((order) => order.payType),
  division_id: text((order) => order.organization),
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  created_date_year: days.byYear,
  market_type_id: client.type,
}

const MEASURES: Record<string, MeasureFn<R>> = {
  total_price: sum((order) => order.total, 2),
  total_return_price: sum((order) => order.returned, 2),
  total_fact_price: sum((order) => order.total - order.returned, 2),
  total_balance: sum((order) => order.debt, 2),
  id: distinct((order) => order.orderId),
  order_market: distinct((order) => order.clientKey),
}

const FILTERS: Record<string, FilterDef<R>> = {
  user_name: eq((order) => order.agent),
  delivery_man_name: eq((order) => order.deliverer),
  border_name: eq((order) => order.client?.zone),
  MarketType: eq((order) => order.client?.type),
  PriceList: eq((order) => order.priceList),
  status_filter_order: eq((order) => order.status, () => ORDER_STATUS_OPTIONS),
  market_name: eq((order) => order.client?.name || order.clientName),
  debt_filter: eq((order) => order.debt),
  fact_sale_filter: eq((order) => order.total - order.returned),
}

export const orderModel = defineModel<R>({
  access: "any",
  async load(context) {
    const { db, dir, money } = context
    const created = "fin_ts(o.created_at, true)"
    const dayTs = `COALESCE(fin_ts(NULLIF(o.delivery, '')), ${created})`
    const rows = (await db
      .prepare(
        `SELECT o.id, o.client_id, o.client, o.market_name, o.agent, o.delivery_man, o.organization, o.price_list, o.status, o.currency, o.amount,
                o.pay_type_name, o.payment_type, o.created_at, to_jsonb(o) ->> 'created_by' AS created_by,
                to_char((${dayTs})::date, 'YYYY-MM-DD') AS day,
                COALESCE((SELECT SUM(i.quantity * i.unit_price * (1 - COALESCE(i.discount_percent, 0) / 100)) FROM order_items i WHERE i.order_id = o.id), 0) AS total,
                COALESCE((SELECT SUM(LEAST(i.quantity, COALESCE((to_jsonb(i) ->> 'return_quantity')::float8, 0)) * i.unit_price * (1 - COALESCE(i.discount_percent, 0) / 100))
                            FROM order_items i WHERE i.order_id = o.id), 0) AS returned
           FROM orders o
          WHERE o.status <> 'Отменен' AND (@branch::text = '' OR o.branch_name = @branch)
            AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ branch: context.branch, from: context.from, to: context.to })) as Record<string, unknown>[]
    if (!rows.length) return []
    const [clients, clientsByName] = await Promise.all([dir.clients(), dir.clientsByName()])
    const debts = new Map<number, number>()
    if (context.wants("total_balance", "debt_filter")) {
      try {
        const cc = await currencyContext(db)
        for (const due of await allocatedOrderDues(db, rows.map((row) => Number(row.id)), cc)) {
          if (due.counted) debts.set(due.id, due.currencies.reduce((total, part) => total + Math.max(0, part.remaining), 0))
        }
      } catch (error) {
        console.error("old report: order dues unavailable", error)
      }
    }
    return rows.map((row) => {
      const found = (row.client_id !== null && row.client_id !== undefined ? clients.get(Number(row.client_id)) : undefined) ?? clientsByName.get(nameKey(row.market_name || row.client))
      const clientName = str(row.market_name) || str(row.client)
      const currency = normCurrency(str(row.currency) || parseMoneyText(str(row.amount))?.currency || "", money.code)
      const fx = money.rate(currency, str(row.created_at))
      const own = (amount: number) => amount * fx.own
      return {
        orderId: Number(row.id),
        day: str(row.day),
        status: orderStatusLabel(str(row.status)),
        agent: str(row.agent) || str(row.created_by),
        deliverer: str(row.delivery_man),
        clientKey: found ? `id:${found.id}` : `name:${nameKey(clientName)}`,
        clientName,
        client: found,
        organization: str(row.organization),
        priceList: str(row.price_list),
        payType: payTypeLabel(str(row.pay_type_name), str(row.payment_type)),
        total: own(num(row.total)),
        returned: own(num(row.returned)),
        debt: own(debts.get(Number(row.id)) ?? 0),
      }
    })
  },
  groups: GROUPS,
  measures: MEASURES,
  filters: FILTERS,
})
