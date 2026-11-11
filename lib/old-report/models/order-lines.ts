import "server-only"

import { allocatedOrderDues } from "@/lib/cash/orders"
import { currencyContext } from "@/lib/cash/common"
import { normCurrency } from "@/lib/finance/currency"
import { orderRealizationTs, orderReleasedSql } from "@/lib/finance/sources"
import { parseMoneyText } from "@/lib/orders-repo"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"
import { getStockBalances, getStockPending } from "@/lib/stock/ledger"

import { defineModel, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ClientInfo, type EmployeeInfo, type GearInfo, type ProductInfo } from "../directory"
import { clientGroups, dealTypeLabel, employeeGroups, ORDER_STATUS_OPTIONS, orderStatusLabel, PAY_TYPE_OPTIONS, payTypeLabel, productGroups, YES_NO } from "../facets"
import { avg, dayGroups, distinct, max, maxText, min, minText, perKey, plain, sum, dmy, type GroupDef, type MeasureFn } from "../pivot"

// The order-line models of the old report builder — one record per line of an order:
//   order_product     «Продукты заказов по дате создания»: every order that is not cancelled, on its creation day;
//   delivery_product  «Продукты заказов по дате по дате доставки»: the same orders on their planned delivery day;
//   accepted_product  «Продукты заказов по дате реализации со склада»: the released orders (В пути / Доставлено) on
//                     the day they left the warehouse.
// "БВ" in a column name = «без возврата» (what was ordered), "факт" = ordered − returned, "ОВ" = основная валюта
// (the base currency, at the rate of the order's day); the other money columns are in the order's own currency.
// A line's price is the price after its discount; a bonus line is a line whose price is 0.

export type OrderLine = {
  orderId: number
  /** Local business day of the model's date. */
  day: string
  status: string
  agent: string
  deliverer: string
  collector: string
  clientKey: string
  clientName: string
  client?: ClientInfo
  agentInfo?: EmployeeInfo
  gear?: GearInfo
  organization: string
  branch: string
  stock: string
  priceList: string
  payType: string
  dealType: string
  invoiceNumber: string
  invoiceActive: boolean
  /** "<number> <model>" of the order's transport. */
  transport: string
  transportModel: string
  transportNumber: string
  transportDriver: string
  currency: string
  comment: string
  /** The order's unpaid remainder in its own currency (when a debt field is asked for). */
  orderDebt: number
  /** Ordered − returned amount of the whole order, own currency. */
  orderFact: number
  productId: number | null
  productKey: string
  productName: string
  product?: ProductInfo
  unit: string
  qty: number
  ret: number
  /** Unit price after the discount, own currency. */
  price: number
  /** Unit price of the price list (the line's own price before the discount when the list has none). */
  listPrice: number
  discountPercent: number
  /** Discount of one unit, own currency. */
  discount: number
  /** Own-currency → base-currency factor of the order's day (0 without a rate). */
  toBase: number
  /** Unit cost, base currency (0 when unknown or when no cost field is asked for). */
  cost: number
  box: number
  kg: number
  /** Shops of the order's agent / of the shop's responsible agent / of the shop's zone (ОКБ). */
  okbAgent: number
  okbResponsible: number
  okbZone: number
  /** Free quantity of the product in the order's warehouse now. */
  available: number | null
}

export type OrderBasis = "created" | "delivery" | "accepted"
type Basis = OrderBasis
/** The costly lookups of the loader, each made only when a field that needs it is asked for. */
export type OrderLineNeeds = { cost?: boolean; debts?: boolean; gear?: boolean; transports?: boolean; listPrices?: boolean; okb?: boolean; free?: boolean }

const num = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())

/** Field ids that need the cost of goods. */
const COST_FIELDS = ["net_cost_sum", "total_profit", "net_cost_sum_order", "total_profit_order", "total_bonus", "net_cost_group"]
const DEBT_FIELDS = ["order_total_balance", "order_total_balance_filter"]

export async function loadOrderLines(context: RunContext, basis: Basis, needs: OrderLineNeeds): Promise<OrderLine[]> {
  const { db, schema, dir, money } = context
  const created = "fin_ts(o.created_at, true)"
  const accepted = schema.col("orders", "accepted_date") ? "fin_ts(NULLIF(o.accepted_date, ''))" : "NULL::timestamp"
  const dayTs = basis === "created" ? created : basis === "delivery" ? `COALESCE(fin_ts(NULLIF(o.delivery, '')), ${created})` : `COALESCE(${accepted}, ${orderRealizationTs(schema, "o")})`
  const scope = basis === "accepted" ? orderReleasedSql("o") : "o.status <> 'Отменен'"
  const orders = (await db
    .prepare(
      `SELECT o.id, o.client_id, o.client, o.market_name, o.agent, o.delivery_man, o.expeditor, o.organization, o.price_list, o.status, o.currency,
              o.amount, o.created_at, o.pay_type_name, o.payment_type, o.deal_type, o.branch_name,
              COALESCE(NULLIF(to_jsonb(o) ->> 'stock_name', ''), o.warehouse, '') AS stock,
              to_jsonb(o) ->> 'created_by' AS created_by, to_jsonb(o) ->> 'invoice_number' AS invoice_number,
              to_jsonb(o) ->> 'invoice_active' AS invoice_active, to_jsonb(o) ->> 'transport_number' AS transport_number,
              to_jsonb(o) ->> 'comment' AS comment,
              to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
         FROM orders o
        WHERE ${scope} AND (@branch::text = '' OR o.branch_name = @branch)
          AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
    )
    .all({ branch: context.branch, from: context.from, to: context.to })) as Record<string, unknown>[]
  if (!orders.length) return []
  const items = (await db
    .prepare(
      `SELECT i.id, i.order_id, i.product_id, i.product_name, i.unit, i.quantity, i.unit_price, i.cost_price, i.discount_percent, i.currency,
              COALESCE((to_jsonb(i) ->> 'return_quantity')::float8, 0) AS return_quantity,
              (to_jsonb(i) ->> 'list_price')::float8 AS list_price
         FROM order_items i
        WHERE i.order_id = ANY(@ids::int[])
        ORDER BY i.order_id, i.id`,
    )
    .all({ ids: orders.map((order) => Number(order.id)) })) as Record<string, unknown>[]

  const [products, clients, clientsByName, employees, gear, transports] = await Promise.all([
    dir.products(),
    dir.clients(),
    dir.clientsByName(),
    dir.employeesByName(),
    needs.gear ? dir.gear() : Promise.resolve(new Map<number, GearInfo>()),
    needs.transports ? dir.transports() : Promise.resolve(new Map<string, { model: string; number: string; driver: string }>()),
  ])
  const listPrices = needs.listPrices ? await dir.priceListPrices() : null

  // ОКБ: the shops of an agent (every shop / the open ones) and of a zone.
  const shopsOfAgent = new Map<string, number>()
  const openShopsOfAgent = new Map<string, number>()
  const shopsOfZone = new Map<string, number>()
  if (needs.okb) {
    for (const client of clients.values()) {
      const agent = nameKey(client.agent)
      if (agent) {
        shopsOfAgent.set(agent, (shopsOfAgent.get(agent) ?? 0) + 1)
        if (client.active) openShopsOfAgent.set(agent, (openShopsOfAgent.get(agent) ?? 0) + 1)
      }
      const zone = nameKey(client.zone)
      if (zone) shopsOfZone.set(zone, (shopsOfZone.get(zone) ?? 0) + 1)
    }
  }

  // Cost of goods (base currency): the value the cost ledger moved the order's goods at, else the average of the day.
  const ledger = needs.cost ? await loadCostLedger(db) : null
  const moved = ledger ? documentLineValues(ledger) : null
  const costsByDay = new Map<string, Map<string, number>>()
  const costOn = (key: string, day: string) => {
    if (!ledger) return undefined
    let costs = costsByDay.get(day)
    if (!costs) costsByDay.set(day, (costs = costsFromLedger(ledger, day)))
    return costs.get(key)
  }

  // The unpaid remainder of the orders (the cash ledger's figure, as the order list shows it).
  const debts = new Map<number, number>()
  if (needs.debts) {
    try {
      const cc = await currencyContext(db)
      for (const due of await allocatedOrderDues(db, orders.map((order) => Number(order.id)), cc)) {
        if (!due.counted) continue
        debts.set(due.id, due.currencies.reduce((total, part) => total + Math.max(0, part.remaining), 0))
      }
    } catch (error) {
      console.error("old report: order dues unavailable", error)
    }
  }

  // Free stock now (on hand − reserved) per product and warehouse.
  const free = new Map<string, number>()
  if (needs.free) {
    for (const balance of await getStockBalances({}, db)) free.set(`${balance.key}\u0001${nameKey(balance.warehouse)}`, balance.qty)
    for (const pending of await getStockPending({}, db)) {
      const key = `${pending.key}\u0001${nameKey(pending.warehouse)}`
      free.set(key, (free.get(key) ?? 0) - pending.reserved)
    }
  }

  const orderById = new Map(orders.map((order) => [Number(order.id), order]))
  const lines: OrderLine[] = []
  const factOfOrder = new Map<number, number>()
  for (const item of items) {
    const order = orderById.get(Number(item.order_id))
    if (!order) continue
    const orderId = Number(order.id)
    const client = (order.client_id !== null && order.client_id !== undefined ? clients.get(Number(order.client_id)) : undefined) ?? clientsByName.get(nameKey(order.market_name || order.client))
    const clientName = str(order.market_name) || str(order.client)
    const qty = num(item.quantity)
    const ret = Math.min(qty, num(item.return_quantity))
    const discountPercent = num(item.discount_percent)
    const currency = normCurrency(str(order.currency) || str(item.currency) || parseMoneyText(str(order.amount))?.currency || "", money.code)
    const createdAt = str(order.created_at)
    const fx = money.rate(currency, createdAt)
    const before = num(item.unit_price) * fx.own
    const price = before * (1 - discountPercent / 100)
    const productId = item.product_id === null || item.product_id === undefined ? null : Number(item.product_id)
    const product = productId === null ? undefined : products.get(productId)
    const productKey = productId === null ? `name:${nameKey(item.product_name)}` : `product:${productId}`
    const day = str(order.day)
    const toBase = fx.toBase
    const agent = str(order.agent) || str(order.created_by)
    const payType = payTypeLabel(str(order.pay_type_name), str(order.payment_type))
    const stock = str(order.stock)
    let cost = 0
    if (moved) {
      const unit = productId === null ? undefined : (documentLineUnit(moved, "orders", orderId, productKey) ?? costOn(productKey, day))
      // A line the ledger does not know (no product link): its own cost price, in the order's currency.
      cost = unit !== undefined ? money.base(unit, money.code, createdAt) : num(item.cost_price) * fx.own * toBase
    }
    let listPrice = before
    if (item.list_price !== null && item.list_price !== undefined) listPrice = num(item.list_price) * fx.own
    else if (listPrices) {
      const entry = listPrices.get(`${nameKey(order.price_list)}\u0001${nameKey(product?.name ?? item.product_name)}`)
      if (entry !== undefined && entry > 0) listPrice = entry * fx.own
    }
    const transport = transports.get(nameKey(order.transport_number))
    factOfOrder.set(orderId, (factOfOrder.get(orderId) ?? 0) + (qty - ret) * price)
    lines.push({
      orderId,
      day,
      status: orderStatusLabel(str(order.status)),
      agent,
      deliverer: str(order.delivery_man),
      collector: str(order.expeditor),
      clientKey: client ? `id:${client.id}` : `name:${nameKey(clientName)}`,
      clientName,
      client,
      agentInfo: employees.get(nameKey(agent)),
      gear: client ? gear.get(client.id) : undefined,
      organization: str(order.organization),
      branch: str(order.branch_name),
      stock,
      priceList: str(order.price_list),
      payType,
      dealType: dealTypeLabel(str(order.deal_type)),
      invoiceNumber: str(order.invoice_number),
      invoiceActive: str(order.invoice_active) === "1" || str(order.invoice_active) === "true",
      transport: transport ? `${transport.number} ${transport.model}`.trim() : str(order.transport_number),
      transportModel: transport?.model ?? "",
      transportNumber: transport?.number ?? str(order.transport_number),
      transportDriver: transport?.driver ?? "",
      currency: fx.name,
      comment: str(order.comment),
      orderDebt: (debts.get(orderId) ?? 0) * fx.own,
      orderFact: 0,
      productId,
      productKey,
      productName: str(item.product_name),
      product,
      unit: product?.unit || str(item.unit),
      qty,
      ret,
      price,
      listPrice,
      discountPercent,
      discount: before - price,
      toBase,
      cost,
      box: product?.box ?? 0,
      kg: product?.kg ?? 0,
      okbAgent: shopsOfAgent.get(nameKey(agent)) ?? 0,
      okbResponsible: client ? (openShopsOfAgent.get(nameKey(client.agent)) ?? 0) : 0,
      okbZone: client ? (shopsOfZone.get(nameKey(client.zone)) ?? 0) : 0,
      available: free.size ? (free.get(`${productKey}\u0001${nameKey(stock)}`) ?? 0) : null,
    })
  }
  for (const line of lines) line.orderFact = factOfOrder.get(line.orderId) ?? 0
  return lines
}

// ---------------------------------------------------------------- fields

type L = OrderLine

const days = dayGroups<L>((line) => line.day)
const product = productGroups<L>((line) => line.product, (line) => line.productName, (line) => line.productId)
const client = clientGroups<L>((line) => line.client, (line) => line.clientName, (line) => line.gear)
const agent = employeeGroups<L>((line) => line.agentInfo, (line) => line.agent)
const text = (pick: (line: L) => string | number | null | undefined): GroupDef<L> => ({ label: pick })

const GROUPS: Record<string, GroupDef<L>> = {
  user_id: text((line) => line.agent),
  delivery_man_id: text((line) => line.deliverer),
  collector_id: text((line) => line.collector),
  market_id: client.name,
  inn_value: client.inn,
  market_code: client.code,
  brand_id: product.brand,
  division_id: text((line) => line.organization),
  branch_id: text((line) => line.branch),
  stock_id: text((line) => line.stock),
  market_responsible_agent_id: client.agent,
  supervisor_name: agent.supervisor,
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  created_date_year: days.byYear,
  date_delivery_day: days.byDay,
  date_delivery_week: days.byWeek,
  date_delivery_month: days.byMonth,
  date_delivery_year: days.byYear,
  order_market_id: client.id,
  inventory_count: client.gearCount,
  inventory_names: client.gearNames,
  product_unique_id: product.id,
  product_id: product.name,
  product_stock_number: product.orderNumber,
  product_barcode: product.barcode,
  product_vendor_code: product.article,
  product_code: product.code,
  status: text((line) => line.status),
  order_id: text((line) => line.orderId),
  order_number: text((line) => line.orderId),
  product_price: text((line) => plain(line.price)),
  price_list_price: text((line) => plain(line.listPrice)),
  discount_percent: text((line) => plain(line.discountPercent)),
  difference_price: text((line) => plain(line.price - line.listPrice)),
  order_total_balance: text((line) => plain(line.orderDebt, 2)),
  price_list_name: text((line) => line.priceList),
  net_cost_group: text((line) => plain(line.cost, 2)),
  market_type_id: client.type,
  border_id: client.zone,
  market_category_id: client.category,
  type_parent_id: product.parentType,
  product_type_id: product.type,
  payment_type: text((line) => line.payType),
  deal_type: text((line) => line.dealType),
  invoice_number: text((line) => line.invoiceNumber),
  transport_number: text((line) => line.transport),
  transport_driver: text((line) => line.transportDriver),
  currency_name: text((line) => line.currency),
  // This app takes no orders from a Telegram bot.
  is_telegram_id: text(() => "Нет"),
  product_available: text((line) => (line.available === null ? "" : plain(line.available))),
  measurement: text((line) => line.unit),
  order_comment: text((line) => line.comment),
  group_parent: product.groupParent,
  // Lines of this app carry no marketing action.
  promotion: text(() => ""),
}

const total = (line: L) => line.qty * line.price
const totalBase = (line: L) => line.qty * line.price * line.toBase
const fact = (line: L) => line.qty - line.ret
const blocks = (line: L, qty: number) => (line.box > 0 ? qty / line.box : 0)
const difference = (line: L) => (line.price - line.listPrice) * line.qty
const minus =
  (a: MeasureFn<L>, b: MeasureFn<L>, digits = 2): MeasureFn<L> =>
  (records) =>
    Math.round((Number(a(records)) - Number(b(records))) * 10 ** digits) / 10 ** digits

const MEASURES: Record<string, MeasureFn<L>> = {
  user_markets: perKey((line) => nameKey(line.agent), (line) => line.okbAgent),
  okb_market_responsible: perKey((line) => nameKey(line.client?.agent), (line) => line.okbResponsible),
  box_amount: perKey((line) => line.productKey, (line) => line.box),
  order_box_amount: sum((line) => blocks(line, line.qty)),
  fact_order_box_amount: sum((line) => blocks(line, fact(line))),
  fact_amount: sum(fact),
  order_market: distinct((line) => line.clientKey),
  internal_total_price: sum(totalBase, 2),
  total_difference_price: sum(difference, 2),
  total_price: sum(total, 2),
  total_price_list_price: sum((line) => total(line) - difference(line), 2),
  total_return_price: sum((line) => line.ret * line.price, 2),
  total_fact_price: sum((line) => fact(line) * line.price, 2),
  total_fact_price_main: sum((line) => fact(line) * line.price * line.toBase, 2),
  internal_total_discount: sum((line) => line.discount * line.qty * line.toBase, 2),
  total_discount: sum((line) => line.discount * line.qty, 2),
  fact_discount: sum((line) => line.discount * fact(line), 2),
  bonus_amount: sum((line) => (line.price === 0 ? line.qty : 0)),
  // What was ordered at first is not kept apart from the line: the line's quantity.
  begin_amount: sum((line) => line.qty),
  amount: sum((line) => line.qty),
  avg_amount: avg((line) => line.qty),
  return_amount: sum((line) => line.ret),
  typeof_amount: distinct((line) => line.productKey),
  min_price: min((line) => line.price),
  price: avg((line) => line.price),
  max_price: max((line) => line.price),
  min_date: minText((line) => line.day, dmy),
  max_date: maxText((line) => line.day, dmy),
  kg_amount: sum((line) => line.kg * line.qty),
  kg_return_amount: sum((line) => line.kg * line.ret),
  kg_fact_amount: sum((line) => line.kg * fact(line)),
  order_count: distinct((line) => line.orderId),
  order_id: distinct((line) => line.orderId),
  border_okb: perKey((line) => nameKey(line.client?.zone), (line) => line.okbZone),
  order_fact_market: distinct((line) => (line.qty !== line.ret ? line.clientKey : null)),
  // The reference's own formula: 4000 for every unit sold.
  amount_kpi: sum((line) => fact(line) * 4000),
  total_bonus: sum((line) => (line.price === 0 ? line.cost * line.qty : 0), 2),
}

const factCost = sum<L>((line) => line.cost * fact(line), 2)
const factProfit = minus(sum((line) => fact(line) * line.price * line.toBase, 2), factCost)
const fullCost = sum<L>((line) => line.cost * line.qty, 2)
const fullProfit = minus(sum(totalBase, 2), fullCost)

const eq = (pick: (line: L) => string | number | null | undefined, options?: FilterDef<L>["options"]): FilterDef<L> => ({ value: pick, options })

const FILTERS: Record<string, FilterDef<L>> = {
  status_filter_order: eq((line) => line.status, () => ORDER_STATUS_OPTIONS),
  division_name: eq((line) => line.organization),
  brand: eq((line) => line.product?.brand),
  market_name: eq((line) => line.client?.name || line.clientName),
  branch_name: eq((line) => line.branch),
  stock_name: eq((line) => line.stock),
  product_type_name: eq((line) => line.product?.type),
  market_user_name: eq((line) => line.client?.agent),
  MarketCategory: eq(() => ""),
  MarketType: eq((line) => line.client?.type),
  user_name: eq((line) => line.agent),
  delivery_man_name: eq((line) => line.deliverer),
  pricelist: eq((line) => line.priceList),
  border_name: eq((line) => line.client?.zone),
  product_name: eq((line) => line.product?.name || line.productName),
  payment_type_filter: eq((line) => line.payType, () => PAY_TYPE_OPTIONS),
  boolean_filter_invoice_is_active: eq((line) => (line.invoiceActive ? "Да" : "Нет"), () => YES_NO),
  boolean_filter_product_is_mml: eq((line) => (line.product?.mml ? "Да" : "Нет"), () => YES_NO),
  Promotion: eq(() => ""),
  order_total_balance_filter: eq((line) => (line.orderDebt > 0 ? "Есть долг" : "Нет долга"), () => ["Есть долг", "Нет долга"]),
  // «Фильтры»: compared with the typed value.
  inventory_count_filter: eq((line) => line.gear?.count ?? 0),
  with_bonus: eq((line) => (line.price === 0 ? line.qty : 0)),
  price_filter: eq((line) => line.price),
  with_discount: eq((line) => line.discount * line.qty * line.toBase),
  fact_order_price_filter: eq((line) => line.orderFact),
  fact_amount_filter: eq(fact),
}

const model = (basis: Basis, measures: Record<string, MeasureFn<L>>): ModelImpl<L> =>
  defineModel<L>({
    access: "any",
    load: (context) =>
      loadOrderLines(context, basis, {
        cost: context.wants(...COST_FIELDS),
        debts: context.wants(...DEBT_FIELDS),
        gear: context.wants("inventory_count", "inventory_names", "inventory_count_filter"),
        transports: context.wants("transport_number", "transport_driver"),
        listPrices: context.wants("total_difference_price", "total_price_list_price", "price_list_price", "difference_price"),
        okb: context.wants("user_markets", "okb_market_responsible", "border_okb"),
        free: context.wants("product_available"),
      }),
    groups: GROUPS,
    measures: { ...MEASURES, ...measures },
    filters: FILTERS,
    cost: COST_FIELDS,
  })

export const orderProductModel = model("created", {})
export const deliveryProductModel = model("delivery", { net_cost_sum: factCost, total_profit: factProfit })
export const acceptedProductModel = model("accepted", { net_cost_sum_order: factCost, total_profit_order: factProfit, net_cost_sum: fullCost, total_profit: fullProfit })
