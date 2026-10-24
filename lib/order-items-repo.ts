import "server-only"

import { getDb } from "@/lib/db"
import { getOrder, updateOrder } from "@/lib/orders-repo"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      discount_percent REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'SUM',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS box_unit TEXT NOT NULL DEFAULT '';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS return_quantity REAL NOT NULL DEFAULT 0;
  `)
}

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

type Row = {
  id: number
  order_id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  unit_price: number
  cost_price: number
  discount_percent: number
  currency: string
}

function lineTotalOf(row: Pick<Row, "quantity" | "unit_price" | "discount_percent">): number {
  return row.quantity * row.unit_price * (1 - row.discount_percent / 100)
}

function rowToOrderItem(row: Row): OrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    costPrice: row.cost_price,
    discountPercent: row.discount_percent,
    currency: row.currency,
    lineTotal: lineTotalOf(row),
    lineCost: row.quantity * row.cost_price,
  }
}

export type OrderItemInput = {
  /** Total quantity returned by the client so far (written by the quick return). */
  returnQuantity?: number
  productId?: number
  productName: string
  unit?: string
  quantity: number
  unitPrice: number
  costPrice?: number
  discountPercent?: number
  currency?: string
}

export function parseOrderItemInput(body: unknown): OrderItemInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const productName = typeof value.productName === "string" ? value.productName.trim() : ""
  if (!productName) return null

  const quantity = Number(value.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null

  const unitPrice = Number(value.unitPrice)
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null

  const productId = value.productId !== undefined ? Number(value.productId) : undefined
  const costPrice = value.costPrice !== undefined ? Number(value.costPrice) : undefined
  const discountPercent = value.discountPercent !== undefined ? Number(value.discountPercent) : undefined

  return {
    productId: Number.isFinite(productId) ? productId : undefined,
    productName,
    unit: typeof value.unit === "string" ? value.unit.trim() : "шт.",
    quantity,
    unitPrice,
    costPrice: Number.isFinite(costPrice) ? costPrice : 0,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0,
    currency: typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "SUM",
  }
}

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const grouped = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/ /g, " ")
  return `${grouped} ${currency}`
}

async function syncOrderSummary(orderId: number): Promise<void> {
  const items = await listOrderItems(orderId)
  const order = await getOrder(orderId)
  if (!order) return
  if (items.length === 0) return

  const totalsByCurrency = new Map<string, number>()
  for (const item of items) {
    totalsByCurrency.set(item.currency, (totalsByCurrency.get(item.currency) ?? 0) + item.lineTotal)
  }
  const amount = Array.from(totalsByCurrency.entries())
    .map(([currency, total]) => formatMoney(total, currency))
    .join(", ")
  const product = items.map((item) => `${item.productName} x${item.quantity}`).join(", ")

  await updateOrder(orderId, { amount, product })
}

export async function listOrderItems(orderId: number): Promise<OrderItem[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
    .prepare(
      `SELECT i.*, COALESCE(p.article, '') AS article, COALESCE(p.box_amount, 0) AS box_amount, COALESCE(p.box_unit, '') AS box_unit, COALESCE(i.return_quantity, 0) AS return_quantity
       FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id ASC`,
    )
    .all(orderId)) as Array<Row & { article: string; box_amount: number; box_unit: string; return_quantity: number }>
  return rows.map((row) => ({ ...rowToOrderItem(row), article: row.article, boxAmount: Number(row.box_amount), boxUnit: row.box_unit, returnQuantity: Number(row.return_quantity) }))
}

/** A line sent by name only (the order form) is linked to the one live product with that name and gets its cost, so stock and profit reports see it. */
async function resolveProduct(db: ReturnType<typeof getDb>, input: OrderItemInput): Promise<{ productId: number | null; costPrice: number }> {
  let productId = input.productId ?? null
  let costPrice = input.costPrice ?? 0
  if (productId === null) {
    const found = (await db.prepare("SELECT id, cost FROM products WHERE name = ? AND COALESCE(deleted, 0) = 0 LIMIT 2").all(input.productName)) as Array<{ id: number; cost: number | null }>
    if (found.length === 1) {
      productId = found[0].id
      if (!costPrice) costPrice = Number(found[0].cost) || 0
    }
  } else if (!costPrice) {
    const row = (await db.prepare("SELECT cost FROM products WHERE id = ?").get(productId)) as { cost: number | null } | undefined
    costPrice = Number(row?.cost) || 0
  }
  return { productId, costPrice }
}

export async function createOrderItem(orderId: number, input: OrderItemInput): Promise<OrderItem> {
  const db = getDb()
  await ensureSchema(db)
  const linked = await resolveProduct(db, input)
  const result = await db
    .prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, cost_price, discount_percent, currency)
       VALUES (@orderId, @productId, @productName, @unit, @quantity, @unitPrice, @costPrice, @discountPercent, @currency)`,
    )
    .run({
      orderId,
      productId: linked.productId,
      productName: input.productName,
      unit: input.unit ?? "шт.",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      costPrice: linked.costPrice,
      discountPercent: input.discountPercent ?? 0,
      currency: input.currency ?? "SUM",
    })
  const row = (await db.prepare("SELECT * FROM order_items WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  await syncOrderSummary(orderId)
  return rowToOrderItem(row)
}

export async function updateOrderItem(orderId: number, itemId: number, input: OrderItemInput): Promise<OrderItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const existing = (await db.prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ?").get(itemId, orderId)) as Row | undefined
  if (!existing) return null
  // A body without productId / costPrice (the edit form, quick return) keeps the link and the cost the line already has; a renamed line is re-linked by name.
  const renamed = existing.product_name !== input.productName
  const linked = await resolveProduct(db, { ...input, productId: input.productId ?? (renamed ? undefined : (existing.product_id as number | null) ?? undefined), costPrice: input.costPrice || (renamed ? 0 : Number(existing.cost_price) || 0) })

  await db
    .prepare(
      `UPDATE order_items SET product_id = @productId, product_name = @productName, unit = @unit, quantity = @quantity,
       unit_price = @unitPrice, cost_price = @costPrice, discount_percent = @discountPercent, currency = @currency,
       return_quantity = COALESCE(@returnQuantity, return_quantity)
       WHERE id = @id AND order_id = @orderId`,
    )
    .run({
      id: itemId,
      orderId,
      productId: linked.productId,
      productName: input.productName,
      unit: input.unit ?? "шт.",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      costPrice: linked.costPrice,
      discountPercent: input.discountPercent ?? 0,
      currency: input.currency ?? "SUM",
      returnQuantity: input.returnQuantity ?? null,
    })
  const row = (await db.prepare("SELECT * FROM order_items WHERE id = ?").get(itemId)) as Row
  await syncOrderSummary(orderId)
  return rowToOrderItem(row)
}

export async function deleteOrderItem(orderId: number, itemId: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?").run(itemId, orderId)
  if (result.changes > 0) await syncOrderSummary(orderId)
  return result.changes > 0
}

export async function listAllOrderItemsWithOrderInfo(): Promise<OrderItemWithOrder[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
    .prepare(
      `SELECT oi.*, o.client AS order_client, o.agent AS order_agent, o.zone AS order_zone,
              o.type AS order_type, o.created AS order_created, o.status AS order_status
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       ORDER BY oi.id DESC`,
    )
    .all()) as (Row & {
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
