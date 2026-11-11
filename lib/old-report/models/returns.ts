import "server-only"

import { normCurrency } from "@/lib/finance/currency"
import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

import { defineModel, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ClientInfo, type ProductInfo } from "../directory"
import { clientGroups, payTypeLabel, productGroups, RETURN_STATUS_OPTIONS, returnStatusLabel, YES_NO } from "../facets"
import { dayGroups, distinct, perKey, plain, sum, yesNo, type GroupDef, type MeasureFn } from "../pivot"

// The return models of the old report builder — one record per line of a client return (Продажи → Возвраты):
//   order_return_product     «Возвраты»: every return that is not cancelled, on the day of the document;
//   return_product_by_stock  «Возвраты по дате приемки»: the accepted returns on the day the warehouse took them.

export type ReturnLine = {
  returnId: number
  orderId: number | null
  day: string
  status: string
  clientKey: string
  clientName: string
  client?: ClientInfo
  stock: string
  author: string
  agent: string
  deliverer: string
  orderDeliverer: string
  organization: string
  branch: string
  payType: string
  currency: string
  reason: string
  comment: string
  onDelivery: boolean
  productId: number | null
  productKey: string
  productName: string
  product?: ProductInfo
  qty: number
  price: number
  /** Discount of one unit on the order's line the goods come back from (own currency). */
  discount: number
  toBase: number
  /** Unit cost, base currency (when a cost field is asked for). */
  cost: number
  box: number
  kg: number
}

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const num = (value: unknown) => Number(value) || 0
const COST_FIELDS = ["net_cost_sum"]

export async function loadReturnLines(context: RunContext, accepted: boolean, needs: { cost?: boolean }): Promise<ReturnLine[]> {
  const { db, dir, money } = context
  const made = "COALESCE(fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))"
  const dayTs = accepted ? `COALESCE(fin_ts(NULLIF(r.accepted_at, '')), ${made})` : made
  const rows = (await db
    .prepare(
      `SELECT r.id, r.client_id, r.client, r.warehouse, r.order_id, r.status, r.currency, r.created_by, r.deliverer, r.agent, r.comment,
              to_jsonb(r) ->> 'organization' AS organization, to_jsonb(r) ->> 'payment_type' AS payment_type,
              to_jsonb(r) ->> 'reason' AS reason, to_jsonb(r) ->> 'on_delivery' AS on_delivery,
              COALESCE(to_char(${made}, 'YYYY-MM-DD HH24:MI:SS'), '') AS made_at,
              to_char((${dayTs})::date, 'YYYY-MM-DD') AS day,
              o.delivery_man AS order_deliverer,
              i.product_id, i.product_name, i.quantity, i.price,
              COALESCE(oi.unit_price * oi.discount_percent / 100, 0) AS discount
         FROM client_returns r
         JOIN client_return_items i ON i.return_id = r.id
         LEFT JOIN orders o ON o.id = r.order_id
         LEFT JOIN order_items oi ON oi.id = i.order_item_id
        WHERE ${accepted ? "r.status = 'accepted'" : "r.status <> 'cancelled'"}
          AND (${dayTs})::date BETWEEN @from::date AND @to::date
        ORDER BY r.id, i.id`,
    )
    .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
  if (!rows.length) return []
  const [products, clients, clientsByName, warehouseBranches] = await Promise.all([dir.products(), dir.clients(), dir.clientsByName(), dir.warehouseBranches()])
  const ledger = needs.cost ? await loadCostLedger(db) : null
  const moved = ledger ? documentLineValues(ledger) : null
  const costsByDay = new Map<string, Map<string, number>>()
  const lines: ReturnLine[] = []
  for (const row of rows) {
    const client = (row.client_id !== null && row.client_id !== undefined ? clients.get(Number(row.client_id)) : undefined) ?? clientsByName.get(nameKey(row.client))
    const stock = str(row.warehouse)
    const branch = client?.branch || warehouseBranches.get(nameKey(stock)) || ""
    if (context.branch && nameKey(branch) !== nameKey(context.branch)) continue
    const productId = row.product_id === null || row.product_id === undefined ? null : Number(row.product_id)
    const product = productId === null ? undefined : products.get(productId)
    const productKey = productId === null ? `name:${nameKey(row.product_name)}` : `product:${productId}`
    const fx = money.rate(normCurrency(str(row.currency), money.code), str(row.made_at))
    const day = str(row.day)
    let cost = 0
    if (ledger && moved) {
      let unit = productId === null ? undefined : documentLineUnit(moved, "client_returns", Number(row.id), productKey)
      if (unit === undefined && productId !== null) {
        let costs = costsByDay.get(day)
        if (!costs) costsByDay.set(day, (costs = costsFromLedger(ledger, day)))
        unit = costs.get(productKey)
      }
      cost = unit ?? 0
    }
    lines.push({
      returnId: Number(row.id),
      orderId: row.order_id === null || row.order_id === undefined ? null : Number(row.order_id),
      day,
      status: returnStatusLabel(str(row.status)),
      clientKey: client ? `id:${client.id}` : `name:${nameKey(row.client)}`,
      clientName: str(row.client),
      client,
      stock,
      author: str(row.created_by),
      agent: str(row.agent),
      deliverer: str(row.deliverer),
      orderDeliverer: str(row.order_deliverer),
      organization: str(row.organization),
      branch,
      payType: payTypeLabel(str(row.payment_type)),
      currency: fx.name,
      reason: str(row.reason),
      comment: str(row.comment),
      onDelivery: str(row.on_delivery) === "1" || str(row.on_delivery) === "true",
      productId,
      productKey,
      productName: str(row.product_name),
      product,
      qty: num(row.quantity),
      price: num(row.price) * fx.own,
      discount: num(row.discount) * fx.own,
      toBase: fx.toBase,
      cost,
      box: product?.box ?? 0,
      kg: product?.kg ?? 0,
    })
  }
  return lines
}

type L = ReturnLine
const days = dayGroups<L>((line) => line.day)
const product = productGroups<L>((line) => line.product, (line) => line.productName, (line) => line.productId)
const client = clientGroups<L>((line) => line.client, (line) => line.clientName)
const text = (pick: (line: L) => string | number | null | undefined): GroupDef<L> => ({ label: pick })

const GROUPS: Record<string, GroupDef<L>> = {
  product_unique_id: product.id,
  market_id: client.name,
  market_code: client.code,
  stock_id: text((line) => line.stock),
  user_id: text((line) => line.author),
  responsible_agent: text((line) => line.agent),
  market_responsible_agent_id: client.agent,
  division_id: text((line) => line.organization),
  market_type_id: client.type,
  market_category_id: client.category,
  return_order_id: text((line) => line.returnId),
  reason: text((line) => line.reason),
  is_return_on_delivery: text((line) => yesNo(line.onDelivery)),
  border_id: client.zone,
  product_type_id: product.type,
  brand_id: product.brand,
  product_id: product.name,
  product_code: product.code,
  product_vendor_code: product.article,
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  created_date_year: days.byYear,
  order_id: text((line) => line.orderId ?? ""),
  delivery_man_id: text((line) => line.deliverer),
  order_delivery_man_id: text((line) => line.orderDeliverer),
  cost: text((line) => plain(line.price)),
  branch_name: text((line) => line.branch),
  status: text((line) => line.status),
  payment_type: text((line) => line.payType),
}

const MEASURES: Record<string, MeasureFn<L>> = {
  internal_total_price: sum((line) => line.qty * line.price * line.toBase, 2),
  total_price: sum((line) => line.qty * line.price, 2),
  kg_amount: sum((line) => line.kg * line.qty),
  total_discount: sum((line) => line.discount * line.qty, 2),
  bonus_amount: sum((line) => (line.price === 0 ? line.qty : 0)),
  amount: sum((line) => line.qty),
  box_amount: perKey((line) => line.productKey, (line) => line.box),
  box_count: sum((line) => (line.box > 0 ? line.qty / line.box : 0)),
  order_return_market: distinct((line) => line.clientKey),
  net_cost_sum: sum((line) => line.cost * line.qty, 2),
}

const eq = (pick: (line: L) => string | number | null | undefined, options?: FilterDef<L>["options"]): FilterDef<L> => ({ value: pick, options })
const FILTERS: Record<string, FilterDef<L>> = {
  status_filter_order_return: eq((line) => line.status, () => RETURN_STATUS_OPTIONS),
  market_name: eq((line) => line.client?.name || line.clientName),
  stock_name: eq((line) => line.stock),
  responsible_agent_name: eq((line) => line.agent),
  "responsible_agent_name~2": eq((line) => line.agent),
  MarketType: eq((line) => line.client?.type),
  border_name: eq((line) => line.client?.zone),
  // A return without its order: goods sold before the books were kept here.
  boolean_filter_return_from_old_base: eq((line) => yesNo(line.orderId === null), () => YES_NO),
  delivery_man_name: eq((line) => line.deliverer),
  boolean_filter_is_return_on_delivery: eq((line) => yesNo(line.onDelivery), () => YES_NO),
  different_deliveryman: eq((line) => (line.orderDeliverer && line.deliverer && nameKey(line.orderDeliverer) !== nameKey(line.deliverer) ? 1 : 0)),
  cost_filter: eq((line) => line.price),
}

const model = (accepted: boolean): ModelImpl<L> =>
  defineModel<L>({
    access: "any",
    load: (context) => loadReturnLines(context, accepted, { cost: context.wants(...COST_FIELDS) }),
    groups: GROUPS,
    measures: MEASURES,
    filters: FILTERS,
    cost: COST_FIELDS,
  })

export const orderReturnProductModel = model(false)
export const returnProductByStockModel = model(true)
