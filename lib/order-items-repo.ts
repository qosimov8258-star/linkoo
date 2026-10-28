import "server-only"

import { getDb } from "@/lib/db"
import { ensureOrdersSchema, lineTotal, writeOrderLine, type ItemRow, type OrderLineInput } from "@/lib/orders-repo"

// Order lines. The table (double precision money, FK to orders) and every
// write live in lib/orders-repo.ts: a line is validated against the catalog,
// takes the order currency, may change only while the order is editable,
// re-checks stock of a reserved order and keeps the order total in sync.

export type OrderItem = {
  id: number
  orderId: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  costPrice: number
  discountPercent: number
  currency: string
  lineTotal: number
  lineCost: number
  /** Product article (the reference shows it under the product name). */
  article?: string
  /** Units per block and the block's unit name ("0 тонна(+1 кг)" in the order card). */
  boxAmount?: number
  boxUnit?: string
  /** Quantity already returned by the client (the "Возврат" column of the order card). */
  returnQuantity?: number
}

export type OrderItemWithOrder = OrderItem & {
  orderClient: string
  orderAgent: string
  orderZone: string
  orderType: string
  orderCreated: string
  orderStatus: string
}

export type OrderItemInput = OrderLineInput & {
  /** Total quantity returned by the client so far (written by the quick return). */
  returnQuantity?: number
}

function rowToOrderItem(row: ItemRow): OrderItem {
  const quantity = Number(row.quantity)
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity,
    unitPrice: Number(row.unit_price),
    costPrice: Number(row.cost_price),
    discountPercent: Number(row.discount_percent),
    currency: row.currency,
    lineTotal: lineTotal(row),
    lineCost: quantity * Number(row.cost_price),
  }
}

export async function listOrderItems(orderId: number): Promise<OrderItem[]> {
  await ensureOrdersSchema()
  const db = getDb()
  await ensureReturnColumns()
  const rows = (await db
    .prepare(
      `SELECT i.*, COALESCE(p.article, '') AS article, COALESCE(p.box_amount, 0) AS box_amount, COALESCE(p.box_unit, '') AS box_unit, COALESCE(i.return_quantity, 0) AS return_quantity
       FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id ASC`,
    )
    .all(orderId)) as Array<ItemRow & { article: string; box_amount: number; box_unit: string; return_quantity: number }>
  return rows.map((row) => ({ ...rowToOrderItem(row), article: row.article, boxAmount: Number(row.box_amount), boxUnit: row.box_unit, returnQuantity: Number(row.return_quantity) }))
}

async function ensureReturnColumns(): Promise<void> {
  await getDb().exec(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS box_unit TEXT NOT NULL DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS return_quantity DOUBLE PRECISION NOT NULL DEFAULT 0;
  `)
}

async function getOrderItem(orderId: number, itemId: number): Promise<OrderItem | null> {
  const row = (await getDb().prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ?").get(itemId, orderId)) as ItemRow | undefined
  return row ? rowToOrderItem(row) : null
}

/** 404 OrderError when the order does not exist; 409 when it is not editable. */
export async function createOrderItem(orderId: number, input: OrderItemInput, user: { displayName: string }): Promise<OrderItem> {
  const id = await writeOrderLine(orderId, { kind: "create", line: input }, user)
  return (await getOrderItem(orderId, id!))!
}

/** null when the line does not belong to the order. */
export async function updateOrderItem(orderId: number, itemId: number, input: OrderItemInput, user: { displayName: string }): Promise<OrderItem | null> {
  const id = await writeOrderLine(orderId, { kind: "update", itemId, line: input }, user)
  if (id === null) return null
  if (input.returnQuantity !== undefined) {
    await ensureReturnColumns()
    await getDb().prepare("UPDATE order_items SET return_quantity = ? WHERE id = ? AND order_id = ?").run(input.returnQuantity, id, orderId)
  }
  return getOrderItem(orderId, id)
}

export async function deleteOrderItem(orderId: number, itemId: number, user: { displayName: string }): Promise<boolean> {
  return (await writeOrderLine(orderId, { kind: "delete", itemId }, user)) !== null
}

export async function listAllOrderItemsWithOrderInfo(): Promise<OrderItemWithOrder[]> {
  await ensureOrdersSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT oi.*, o.client AS order_client, o.agent AS order_agent, o.zone AS order_zone,
              o.type AS order_type, o.created AS order_created, o.status AS order_status
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       ORDER BY oi.id DESC`,
    )
    .all()) as (ItemRow & {
    order_client: string
    order_agent: string
    order_zone: string
    order_type: string
    order_created: string
    order_status: string
  })[]

  return rows.map((row) => ({
    ...rowToOrderItem(row),
    orderClient: row.order_client,
    orderAgent: row.order_agent,
    orderZone: row.order_zone,
    orderType: row.order_type,
    orderCreated: row.order_created,
    orderStatus: row.order_status,
  }))
}
