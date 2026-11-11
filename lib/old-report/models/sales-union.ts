import "server-only"

import { defineModel, PASS, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ClientInfo, type EmployeeInfo, type GearInfo, type ProductInfo } from "../directory"
import { clientGroups, employeeGroups, ORDER_STATUS_OPTIONS, PAY_TYPE_OPTIONS, productGroups, RETURN_STATUS_OPTIONS, YES_NO } from "../facets"
import { dayGroups, distinct, plain, round, sum, type GroupDef, type MeasureFn } from "../pivot"
import { loadOrderLines } from "./order-lines"
import { loadReturnLines } from "./returns"

// «Заказ и возврат …»: the lines of the orders and the lines of the client returns in one report, each document on
// its own day —
//   order_and_return_delivery  «… по дате реализации»: the released orders on the day they left the warehouse and
//                              the accepted returns on the day the warehouse took them back;
//   order_and_return           «… по дате создания»: every order and return that is not cancelled, on its own day.
// A column "… заказа" counts the order lines, "… возврата" the return lines, "… факт" the first minus the second.
// «Документ Тип» tells the two apart; a filter of the orders alone (their status, their warehouse) leaves the
// returns in, and the other way round, as in the reference.

type DocLine = {
  doc: "order" | "return"
  docId: number
  day: string
  /** The order's status / the return's status ("" for the other kind). */
  orderStatus: string
  returnStatus: string
  agent: string
  agentInfo?: EmployeeInfo
  deliverer: string
  delivererInfo?: EmployeeInfo
  collector: string
  collectorInfo?: EmployeeInfo
  comment: string
  clientKey: string
  clientName: string
  client?: ClientInfo
  responsibleInfo?: EmployeeInfo
  gear?: GearInfo
  organization: string
  priceList: string
  stock: string
  branch: string
  payType: string
  dealType: string
  currency: string
  transportModel: string
  transportNumber: string
  transportDriver: string
  productId: number | null
  productKey: string
  productName: string
  product?: ProductInfo
  unit: string
  qty: number
  price: number
  listPrice: number
  toBase: number
  cost: number
  box: number
  kg: number
}

const COST_FIELDS = ["sale_profit", "sale_markup_percent", "order_net_cost_sum", "return_net_cost_sum", "fact_net_cost_sum", "net_cost_group"]

async function loadDocLines(context: RunContext, basis: "delivery" | "created"): Promise<DocLine[]> {
  const cost = context.wants(...COST_FIELDS)
  const gearWanted = context.wants("market_inventory_count", "market_inventory_names", "inventory_count_filter")
  const [orders, returns, employees, gear] = await Promise.all([
    loadOrderLines(context, basis === "delivery" ? "accepted" : "created", {
      cost,
      gear: gearWanted,
      transports: context.wants("transport_model", "transport_number", "transport_driver"),
      listPrices: context.wants("order_total_price_list_price", "fact_total_price_list_price", "product_price_list_price"),
    }),
    loadReturnLines(context, basis === "delivery", { cost }),
    context.dir.employeesByName(),
    gearWanted ? context.dir.gear() : Promise.resolve(new Map<number, GearInfo>()),
  ])
  const person = (name: string) => employees.get(nameKey(name))
  const lines: DocLine[] = []
  for (const line of orders) {
    lines.push({
      doc: "order",
      docId: line.orderId,
      day: line.day,
      orderStatus: line.status,
      returnStatus: "",
      agent: line.agent,
      agentInfo: line.agentInfo,
      deliverer: line.deliverer,
      delivererInfo: person(line.deliverer),
      collector: line.collector,
      collectorInfo: person(line.collector),
      comment: line.comment,
      clientKey: line.clientKey,
      clientName: line.clientName,
      client: line.client,
      responsibleInfo: line.client ? person(line.client.agent) : undefined,
      gear: line.gear,
      organization: line.organization,
      priceList: line.priceList,
      stock: line.stock,
      branch: line.branch,
      payType: line.payType,
      dealType: line.dealType,
      currency: line.currency,
      transportModel: line.transportModel,
      transportNumber: line.transportNumber,
      transportDriver: line.transportDriver,
      productId: line.productId,
      productKey: line.productKey,
      productName: line.productName,
      product: line.product,
      unit: line.unit,
      qty: line.qty,
      price: line.price,
      listPrice: line.listPrice,
      toBase: line.toBase,
      cost: line.cost,
      box: line.box,
      kg: line.kg,
    })
  }
  for (const line of returns) {
    lines.push({
      doc: "return",
      docId: line.returnId,
      day: line.day,
      orderStatus: "",
      returnStatus: line.status,
      agent: line.agent,
      agentInfo: person(line.agent),
      deliverer: line.deliverer,
      delivererInfo: person(line.deliverer),
      collector: "",
      comment: line.comment,
      clientKey: line.clientKey,
      clientName: line.clientName,
      client: line.client,
      responsibleInfo: line.client ? person(line.client.agent) : undefined,
      gear: line.client ? gear.get(line.client.id) : undefined,
      organization: line.organization,
      priceList: "",
      stock: line.stock,
      branch: line.branch,
      payType: line.payType,
      dealType: "Стандартная",
      currency: line.currency,
      transportModel: "",
      transportNumber: "",
      transportDriver: "",
      productId: line.productId,
      productKey: line.productKey,
      productName: line.productName,
      product: line.product,
      unit: line.product?.unit ?? "",
      qty: line.qty,
      price: line.price,
      listPrice: line.price,
      toBase: line.toBase,
      cost: line.cost,
      box: line.box,
      kg: line.kg,
    })
  }
  return lines
}

type L = DocLine
const days = dayGroups<L>((line) => line.day)
const product = productGroups<L>((line) => line.product, (line) => line.productName, (line) => line.productId)
const client = clientGroups<L>((line) => line.client, (line) => line.clientName, (line) => line.gear)
const agent = employeeGroups<L>((line) => line.agentInfo, (line) => line.agent)
const text = (pick: (line: L) => string | number | null | undefined): GroupDef<L> => ({ label: pick })
/** This app's products carry no mark, format or portfolio / assortment / product / mark group. */
const none = text(() => "")

const GROUPS: Record<string, GroupDef<L>> = {
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  currency_name: text((line) => line.currency),
  parent_id: text((line) => line.docId),
  doc_type: text((line) => (line.doc === "order" ? "Заказ" : "Возврат")),
  user_name: agent.name,
  user_first_name: agent.firstName,
  user_second_name: agent.lastName,
  supervisor_name: agent.supervisor,
  auditor_names: agent.auditors,
  doc_comment: text((line) => line.comment),
  delivery_man_name: text((line) => line.deliverer),
  delivery_man_id: text((line) => line.delivererInfo?.id ?? ""),
  collector_name: text((line) => line.collector),
  collector_id: text((line) => line.collectorInfo?.id ?? ""),
  division_name: text((line) => line.organization),
  price_list_name: text((line) => line.priceList),
  product_unique_id: product.id,
  product_name: product.name,
  product_measurement_name: text((line) => line.unit),
  product_brand_name: product.brand,
  product_type_name: product.type,
  parent_product_type_name: product.parentType,
  product_stock_number: product.orderNumber,
  product_vendor_code: product.article,
  product_code: product.code,
  product_barcode: product.barcode,
  market_real_id: client.id,
  market_name: client.name,
  market_contact_name: client.contact,
  market_inn: client.inn,
  market_type_id: client.type,
  market_category_name: client.category,
  channel_category_name: client.channel,
  market_code: client.code,
  // Clients of this app have one code (Код); no separate integration code.
  market_service_id: none,
  market_responsible_agent_name: client.agent,
  market_responsible_agent_id: text((line) => line.responsibleInfo?.id ?? ""),
  market_activity: client.active,
  market_inventory_count: client.gearCount,
  market_inventory_names: client.gearNames,
  net_cost_group: text((line) => plain(line.cost, 2)),
  stock_name: text((line) => line.stock),
  border_name: client.zone,
  payment_type: text((line) => line.payType),
  deal_type: text((line) => line.dealType),
  branch_name: text((line) => line.branch),
  product_price: text((line) => plain(line.price)),
  product_price_list_price: text((line) => plain(line.listPrice)),
  service_id: agent.code,
  // Documents of this app have no number of an outside accounting system.
  service_order_number: none,
  mark_name: none,
  format_name: none,
  group_portfolio_name: none,
  group_assortment_name: none,
  group_product_name: none,
  group_mark_name: none,
  group_parent: product.groupParent,
  market_phone: client.phone,
  market_full_name: client.attribute("Полное наименование"),
  transport_model: text((line) => line.transportModel),
  transport_number: text((line) => line.transportNumber),
  transport_driver: text((line) => line.transportDriver),
}

const isOrder = (line: L) => line.doc === "order"
const isReturn = (line: L) => line.doc === "return"
type Pick = (line: L) => number
/** The three columns of a value: of the orders, of the returns, and the first minus the second. */
function trio(value: Pick, digits = 3): [MeasureFn<L>, MeasureFn<L>, MeasureFn<L>] {
  return [
    sum((line) => (isOrder(line) ? value(line) : 0), digits),
    sum((line) => (isReturn(line) ? value(line) : 0), digits),
    sum((line) => (isOrder(line) ? value(line) : -value(line)), digits),
  ]
}
const [orderWeight, returnWeight, factWeight] = trio((line) => line.kg * line.qty)
const [orderAmount, returnAmount, factAmount] = trio((line) => line.qty)
const [orderBox, returnBox, factBox] = trio((line) => (line.box > 0 ? line.qty / line.box : 0))
const [orderBonus, returnBonus, factBonus] = trio((line) => (line.price === 0 ? line.qty : 0))
const [orderSum, returnSum, factSum] = trio((line) => line.qty * line.price, 2)
const [orderBase, returnBase, factBase] = trio((line) => line.qty * line.price * line.toBase, 2)
const [orderList, returnList, factList] = trio((line) => line.qty * line.listPrice, 2)
const [orderCost, returnCost, factCost] = trio((line) => line.qty * line.cost, 2)
const margin = (line: L) => line.qty * (line.price * line.toBase - line.cost)

const MEASURES: Record<string, MeasureFn<L>> = {
  order_market: distinct((line) => (isOrder(line) ? line.clientKey : null)),
  order_weight: orderWeight,
  return_weight: returnWeight,
  fact_weight: factWeight,
  order_product_amount: orderAmount,
  order_return_product_amount: returnAmount,
  fact_amount: factAmount,
  order_box_amount: orderBox,
  return_box_amount: returnBox,
  fact_box_amount: factBox,
  order_bonus_amount: orderBonus,
  return_bonus_amount: returnBonus,
  fact_bonus_amount: factBonus,
  order_count: distinct((line) => (isOrder(line) ? line.docId : null)),
  return_count: distinct((line) => (isReturn(line) ? line.docId : null)),
  sale_profit: sum((line) => (isOrder(line) ? margin(line) : -margin(line)), 2),
  sale_markup_percent: (records) => {
    let gain = 0
    let cost = 0
    for (const line of records) {
      if (!isOrder(line)) continue
      gain += margin(line)
      cost += line.qty * line.cost
    }
    return cost ? round((gain / cost) * 100, 2) : 0
  },
  order_total_price: orderSum,
  order_return_total_price: returnSum,
  fact_total_price: factSum,
  internal_order_total_price: orderBase,
  internal_order_return_total_price: returnBase,
  internal_fact_total_price: factBase,
  order_total_price_list_price: orderList,
  return_total_price_list_price: returnList,
  fact_total_price_list_price: factList,
  order_net_cost_sum: orderCost,
  return_net_cost_sum: returnCost,
  fact_net_cost_sum: factCost,
  order_product_count: distinct((line) => (isOrder(line) ? line.productKey : null)),
}

const eq = (pick: FilterDef<L>["value"], options?: FilterDef<L>["options"]): FilterDef<L> => ({ value: pick, options })

const FILTERS: Record<string, FilterDef<L>> = {
  Brand: eq((line) => line.product?.brand),
  User: eq((line) => line.agent),
  User_auditor_filter: eq((line) => (line.agentInfo?.auditors ? line.agentInfo.auditors.split(" , ") : [])),
  User_delivery_man: eq((line) => line.deliverer),
  Position: eq((line) => line.agentInfo?.position),
  Market: eq((line) => line.client?.name || line.clientName),
  Division: eq((line) => line.organization),
  market_user_name: eq((line) => line.client?.agent),
  pricelist: eq((line) => (isOrder(line) ? line.priceList : PASS)),
  Product: eq((line) => line.product?.name || line.productName),
  Stock: eq((line) => line.stock),
  Stock_order_filter: eq((line) => (isOrder(line) ? line.stock : PASS)),
  Stock_return_filter: eq((line) => (isReturn(line) ? line.stock : PASS)),
  status_filter_order: eq((line) => (isOrder(line) ? line.orderStatus : PASS), () => ORDER_STATUS_OPTIONS),
  status_filter_order_return: eq((line) => (isReturn(line) ? line.returnStatus : PASS), () => RETURN_STATUS_OPTIONS),
  Border: eq((line) => line.client?.zone),
  ProductType: eq((line) => line.product?.type),
  product_type_parent: eq((line) => line.product?.parentType),
  payment_type_filter: eq((line) => line.payType, () => PAY_TYPE_OPTIONS),
  MarketType: eq((line) => line.client?.type),
  MarketChannelcategory: eq((line) => line.client?.channel),
  Branch: eq((line) => line.branch),
  boolean_filter_product_is_mml: eq((line) => (line.product?.mml ? "Да" : "Нет"), () => YES_NO),
  ProductMark: eq(() => "", () => []),
  ProductFormat: eq(() => "", () => []),
  group_portfolio_filter: eq(() => "", () => []),
  group_assortment_filter: eq(() => "", () => []),
  group_product_filter: eq(() => "", () => []),
  group_mark_filter: eq(() => "", () => []),
  market_inn_filter: eq((line) => line.client?.inn),
  inventory_count_filter: eq((line) => line.gear?.count ?? 0),
  bonus_amount_filter: eq((line) => (line.price === 0 ? line.qty : 0)),
  price_filter: eq((line) => line.price),
}

const model = (basis: "delivery" | "created"): ModelImpl<L> =>
  defineModel<L>({ access: "any", load: (context) => loadDocLines(context, basis), groups: GROUPS, measures: MEASURES, filters: FILTERS, cost: COST_FIELDS })

export const orderAndReturnDeliveryModel = model("delivery")
export const orderAndReturnModel = model("created")
