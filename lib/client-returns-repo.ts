import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { keySql, nameKey } from "@/lib/platform-refs"
import {
  MAX_MONEY,
  MAX_QTY,
  OrderError,
  baseCurrency,
  ensureOrdersSchema,
  formatMoney,
  lineTotal,
  parseMoneyText,
  resolveClient,
  resolveCurrency,
  resolveEmployee,
  resolveWarehouse,
} from "@/lib/orders-repo"
import { RELEASED_STATUSES } from "@/components/orders/orders-data"

// Client returns (Продажи → Возвраты), contract 5.
//
// client_returns(id, client_id, client, warehouse, order_id, return_date,
// status 'pending' | 'accepted' | 'cancelled', currency, amount, comment,
// created_by, created_at, accepted_at, accepted_by, …) and
// client_return_items(id, return_id → client_returns ON DELETE CASCADE,
// product_id, product_name, quantity, price, …).
//
// Only an ACCEPTED return has effects, both read by other modules:
// - stock (lib/stock/sources.ts): + quantity at `warehouse` on the accepted day;
// - client ledger (lib/finance/sources.ts): the client is credited `amount`
//   (in `currency`) on the accepted day.
// accepted_at is an ISO UTC moment with "Z", so both read the same local day.
// A return of an order (order_id) is limited to the shipped quantities of that
// order minus what earlier (not cancelled) returns took back, at the order's
// net line price and currency by default.

export type ClientReturnStatus = "pending" | "accepted" | "cancelled"
export const CLIENT_RETURN_STATUSES: ClientReturnStatus[] = ["pending", "accepted", "cancelled"]

export type ClientReturnItem = {
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  price: number
  total: number
  orderItemId: number | null
}

export type ClientReturn = {
  id: number
  clientId: number | null
  client: string
  zone: string
  warehouse: string
  orderId: number | null
  returnDate: string
  status: ClientReturnStatus
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  createdBy: string
  createdAt: string
  acceptedAt: string | null
  acceptedBy: string
  items?: ClientReturnItem[]
  itemCount?: number
}

export type ClientReturnLineInput = { orderItemId?: number; productId?: number; productName?: string; quantity: number; price?: number }

export type ClientReturnInput = {
  clientId?: number
  client?: string
  warehouse?: string
  orderId?: number
  returnDate?: string
  currency?: string
  comment?: string
  deliverer?: string
  agent?: string
  items?: ClientReturnLineInput[]
  /** With orderId and no items: return everything still returnable of the order. */
  full?: boolean
  /** Accept into the warehouse right away. */
  accept?: boolean
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const RETURN_COLUMNS: Array<[string, string]> = [
  ["client_id", "INTEGER"],
  ["client", "TEXT NOT NULL DEFAULT ''"],
  ["warehouse", "TEXT NOT NULL DEFAULT ''"],
  ["order_id", "INTEGER"],
  ["return_date", "TEXT NOT NULL DEFAULT ''"],
  ["status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["currency", "TEXT NOT NULL DEFAULT ''"],
  ["amount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
  ["created_at", "TEXT NOT NULL DEFAULT (datetime('now'))"],
  ["accepted_at", "TEXT"],
  ["accepted_by", "TEXT NOT NULL DEFAULT ''"],
  ["deliverer", "TEXT NOT NULL DEFAULT ''"],
  ["agent", "TEXT NOT NULL DEFAULT ''"],
  ["cancelled_at", "TEXT"],
  ["cancelled_by", "TEXT NOT NULL DEFAULT ''"],
  ["updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))"],
]

const ITEM_COLUMNS: Array<[string, string]> = [
  ["product_id", "INTEGER"],
  ["product_name", "TEXT NOT NULL DEFAULT ''"],
  ["unit", "TEXT NOT NULL DEFAULT ''"],
  ["quantity", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["order_item_id", "INTEGER"],
]

const DDL = `
CREATE TABLE IF NOT EXISTS client_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${RETURN_COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${RETURN_COLUMNS.map(([name, type]) => `ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS client_returns_client_idx ON client_returns (client_id);
CREATE INDEX IF NOT EXISTS client_returns_order_idx ON client_returns (order_id);
CREATE INDEX IF NOT EXISTS client_returns_status_idx ON client_returns (status);
CREATE TABLE IF NOT EXISTS client_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE,
  ${ITEM_COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${ITEM_COLUMNS.map(([name, type]) => `ALTER TABLE client_return_items ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS client_return_items_return_idx ON client_return_items (return_id);
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoClientReturnsSchema: { version: number; ready: Promise<void> } | undefined
}

export function ensureClientReturnsSchema(): Promise<void> {
  if (globalThis.__linkoClientReturnsSchema?.version !== SCHEMA_VERSION) {
    const ready = (async () => {
      await ensureOrdersSchema()
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120933)")
        await tx.exec(DDL)
      })
    })().catch((error) => {
      globalThis.__linkoClientReturnsSchema = undefined
      throw error
    })
    globalThis.__linkoClientReturnsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientReturnsSchema!.ready
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type ReturnRow = {
  id: number
  client_id: number | null
  client: string
  warehouse: string
  order_id: number | null
  return_date: string
  status: string
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  created_by: string
  created_at: string
  accepted_at: string | null
  accepted_by: string
  c_zone?: string | null
  item_count?: number | string | null
}

type ItemRow = {
  id: number
  return_id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  price: number
  order_item_id: number | null
}

const round2 = (value: number) => Math.round(value * 100) / 100
const roundQty = (value: number) => Math.round(value * 1e6) / 1e6

function rowToReturn(row: ReturnRow): ClientReturn {
  const status = (CLIENT_RETURN_STATUSES as string[]).includes(row.status) ? (row.status as ClientReturnStatus) : "pending"
  return {
    id: row.id,
    clientId: row.client_id,
    client: row.client,
    zone: row.c_zone ?? "",
    warehouse: row.warehouse,
    orderId: row.order_id,
    returnDate: row.return_date,
    status,
    currency: row.currency,
    amount: Number(row.amount) || 0,
    comment: row.comment,
    deliverer: row.deliverer,
    agent: row.agent,
    createdBy: row.created_by,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || null,
    acceptedBy: row.accepted_by,
    itemCount: row.item_count === undefined || row.item_count === null ? undefined : Number(row.item_count),
  }
}

function rowToItem(row: ItemRow): ClientReturnItem {
  const quantity = Number(row.quantity) || 0
  const price = Number(row.price) || 0
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity,
    price,
    total: round2(quantity * price),
    orderItemId: row.order_item_id,
  }
}

const SELECT = `SELECT r.*, c.zone AS c_zone,
    (SELECT COUNT(*) FROM client_return_items i WHERE i.return_id = r.id) AS item_count
  FROM client_returns r LEFT JOIN clients c ON c.id = r.client_id`

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ClientReturnQuery = {
  tab?: "pending" | "accepted" | "cancelled" | "all"
  search?: string
  warehouse?: string
  clientId?: number
  orderId?: number
  from?: string
  to?: string
}

export type ClientReturnList = { rows: ClientReturn[]; totals: Array<{ currency: string; amount: number }> }

export async function listClientReturns(query: ClientReturnQuery = {}): Promise<ClientReturnList> {
  await ensureClientReturnsSchema()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.tab && query.tab !== "all") {
    where.push("r.status = @status")
    params.status = query.tab
  }
  if (query.search?.trim()) {
    where.push(`(r.id::text = @searchId OR ${keySql("r.client")} LIKE '%' || ${keySql("@search::text")} || '%' OR r.order_id::text = @searchId)`)
    params.search = query.search.trim()
    params.searchId = query.search.trim()
  }
  if (query.warehouse?.trim()) {
    where.push(`${keySql("r.warehouse")} = ${keySql("@warehouse::text")}`)
    params.warehouse = query.warehouse.trim()
  }
  if (query.clientId) {
    where.push("r.client_id = @clientId")
    params.clientId = query.clientId
  }
  if (query.orderId) {
    where.push("r.order_id = @orderId")
    params.orderId = query.orderId
  }
  if (query.from) {
    where.push("r.return_date >= @from")
    params.from = query.from
  }
  if (query.to) {
    where.push("r.return_date <= @to")
    params.to = query.to
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id DESC LIMIT 5000`
  const statement = getDb().prepare(sql)
  const rows = ((Object.keys(params).length ? await statement.all(params) : await statement.all()) as ReturnRow[]).map(rowToReturn)
  const totals = new Map<string, number>()
  for (const row of rows) if (row.status !== "cancelled") totals.set(row.currency, round2((totals.get(row.currency) ?? 0) + row.amount))
  return { rows, totals: [...totals].map(([currency, amount]) => ({ currency, amount })) }
}

async function loadReturn(db: PgDb, id: number, lock = false): Promise<ReturnRow | undefined> {
  return (await db.prepare(`SELECT * FROM client_returns WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as ReturnRow | undefined
}

export async function getClientReturn(id: number): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientReturnsSchema()
  const db = getDb()
  const row = (await db.prepare(`${SELECT} WHERE r.id = ?`).get(id)) as ReturnRow | undefined
  if (!row) return null
  const items = (await db.prepare("SELECT * FROM client_return_items WHERE return_id = ? ORDER BY id").all(id)) as ItemRow[]
  return { ...rowToReturn(row), items: items.map(rowToItem) }
}

/** What can still be returned of an order: per order line, the shipped quantity
 * minus the quantities of its other (not cancelled) returns. */
export async function returnableOfOrder(orderId: number, exceptReturnId = 0, db: PgDb = getDb()): Promise<Array<{ orderItemId: number; productId: number | null; productName: string; unit: string; ordered: number; returned: number; available: number; price: number; currency: string }>> {
  await ensureClientReturnsSchema()
  const lines = (await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(orderId)) as Array<{
    id: number
    product_id: number | null
    product_name: string
    unit: string
    quantity: number
    unit_price: number
    discount_percent: number
    currency: string
  }>
  const returned = (await db
    .prepare(
      `SELECT i.order_item_id, i.product_id, SUM(i.quantity) AS qty FROM client_return_items i JOIN client_returns r ON r.id = i.return_id
        WHERE r.order_id = @orderId AND r.status <> 'cancelled' AND r.id <> @except GROUP BY 1, 2`,
    )
    .all({ orderId, except: exceptReturnId })) as Array<{ order_item_id: number | null; product_id: number | null; qty: number }>
  const byLine = new Map<number, number>()
  const byProduct = new Map<number, number>()
  for (const row of returned) {
    if (row.order_item_id) byLine.set(row.order_item_id, (byLine.get(row.order_item_id) ?? 0) + Number(row.qty))
    else if (row.product_id) byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + Number(row.qty))
  }
  return lines.map((line) => {
    let done = byLine.get(line.id) ?? 0
    // Returns recorded by product only take from the order's lines of that product in order.
    if (line.product_id && byProduct.get(line.product_id)) {
      const take = Math.min(Number(line.quantity) - done, byProduct.get(line.product_id)!)
      done += take
      byProduct.set(line.product_id, byProduct.get(line.product_id)! - take)
    }
    const ordered = Number(line.quantity)
    return {
      orderItemId: line.id,
      productId: line.product_id,
      productName: line.product_name,
      unit: line.unit,
      ordered,
      returned: roundQty(done),
      available: roundQty(Math.max(0, ordered - done)),
      price: round2(lineTotal(line) / (ordered || 1)),
      currency: line.currency,
    }
  })
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class ClientReturnError extends OrderError {}

function assertIsoDay(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClientReturnError("Дата: формат YYYY-MM-DD", 400, { field })
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ClientReturnError("Несуществующая дата", 400, { field })
}

type ResolvedReturnLine = { productId: number | null; productName: string; unit: string; quantity: number; price: number; orderItemId: number | null }

async function resolveProductForReturn(db: PgDb, input: { productId?: number; productName?: string }): Promise<{ id: number; name: string; unit: string }> {
  let row: { id: number; name: string; unit: string; deleted: number } | undefined
  if (input.productId) {
    row = (await db.prepare("SELECT id, name, unit, deleted FROM products WHERE id = ?").get(input.productId)) as typeof row
  } else if (input.productName?.trim()) {
    row = (await db
      .prepare(`SELECT id, name, unit, deleted FROM products WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY deleted, id LIMIT 1`)
      .get({ name: input.productName.trim() })) as typeof row
  } else {
    throw new ClientReturnError("Укажите товар", 400, { field: "productId" })
  }
  if (!row) throw new ClientReturnError("Товар не найден в каталоге", 400, { field: "productId" })
  if (row.deleted === 1) throw new ClientReturnError(`Товар «${row.name}» удален`, 400, { field: "productId" })
  return { id: row.id, name: row.name, unit: row.unit || "шт." }
}

type OrderInfo = { id: number; client_id: number | null; client: string; status: string; warehouse: string; currency: string; amount: string }

async function prepareReturn(db: PgDb, input: ClientReturnInput, exceptReturnId: number) {
  const client = await resolveClient(db, { clientId: input.clientId, client: input.client })
  const warehouse = input.warehouse?.trim() ? await resolveWarehouse(db, input.warehouse) : ""
  const returnDate = input.returnDate?.trim() || todayIso()
  assertIsoDay(returnDate, "returnDate")
  const deliverer = input.deliverer?.trim() ? await resolveEmployee(db, input.deliverer, "deliverer", "Доставщик") : ""
  const agent = input.agent?.trim() ? await resolveEmployee(db, input.agent, "agent", "Ответственный агент") : ""

  let order: OrderInfo | undefined
  if (input.orderId) {
    order = (await db.prepare("SELECT id, client_id, client, status, warehouse, currency, amount FROM orders WHERE id = ?").get(input.orderId)) as OrderInfo | undefined
    if (!order) throw new ClientReturnError("Заказ не найден", 400, { field: "orderId" })
    const sameClient = order.client_id ? order.client_id === client.id : nameKey(order.client) === nameKey(client.name)
    if (!sameClient) throw new ClientReturnError("Заказ принадлежит другому клиенту", 400, { field: "orderId" })
    if (!RELEASED_STATUSES.includes(order.status)) throw new ClientReturnError("Возврат возможен только по отгруженному заказу (В пути / Доставлено)", 409, { field: "orderId" })
  }

  let currency: string
  if (order) {
    currency = order.currency || parseMoneyText(order.amount)?.currency || (await baseCurrency(db))
    if (input.currency?.trim() && input.currency.trim().toUpperCase() !== currency.toUpperCase()) {
      throw new ClientReturnError(`Валюта возврата должна совпадать с валютой заказа (${currency})`, 400, { field: "currency" })
    }
  } else {
    currency = input.currency?.trim() ? await resolveCurrency(db, input.currency) : await baseCurrency(db)
  }

  const lines: ResolvedReturnLine[] = []
  const returnable = order ? await returnableOfOrder(order.id, exceptReturnId, db) : []
  const left = new Map(returnable.map((line) => [line.orderItemId, line.available]))
  let inputs = input.items ?? []
  if (!inputs.length && input.full && order) {
    inputs = returnable.filter((line) => line.available > 0).map((line) => ({ orderItemId: line.orderItemId, quantity: line.available }))
    if (!inputs.length) throw new ClientReturnError("По этому заказу нечего возвращать", 409, { field: "items" })
  }
  if (!inputs.length) throw new ClientReturnError("Добавьте товары возврата", 400, { field: "items" })
  for (const raw of inputs) {
    const quantity = Number(raw.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QTY) throw new ClientReturnError("Количество должно быть больше 0", 400, { field: "quantity" })
    if (raw.price !== undefined && (!Number.isFinite(Number(raw.price)) || Number(raw.price) < 0 || Number(raw.price) > MAX_MONEY)) {
      throw new ClientReturnError("Цена должна быть от 0 до 10 000 000 000 000", 400, { field: "price" })
    }
    if (order) {
      let line = raw.orderItemId ? returnable.find((entry) => entry.orderItemId === raw.orderItemId) : undefined
      if (raw.orderItemId && !line) throw new ClientReturnError("Позиция не входит в заказ", 400, { field: "orderItemId" })
      if (!line) {
        const product = await resolveProductForReturn(db, raw)
        line = returnable.find((entry) => entry.productId === product.id && (left.get(entry.orderItemId) ?? 0) > 0) ?? returnable.find((entry) => entry.productId === product.id)
        if (!line) throw new ClientReturnError(`Товар «${product.name}» не входит в заказ №${order.id}`, 400, { field: "productId" })
      }
      const available = left.get(line.orderItemId) ?? 0
      if (quantity > available + 1e-9) {
        throw new ClientReturnError(`Количество возврата больше доступного: ${line.productName} — доступно ${available}`, 409, { field: "quantity", available })
      }
      left.set(line.orderItemId, roundQty(available - quantity))
      lines.push({
        productId: line.productId,
        productName: line.productName,
        unit: line.unit,
        quantity,
        price: raw.price !== undefined ? Number(raw.price) : line.price,
        orderItemId: line.orderItemId,
      })
    } else {
      const product = await resolveProductForReturn(db, raw)
      if (raw.price === undefined) throw new ClientReturnError(`Укажите цену возврата для «${product.name}»`, 400, { field: "price" })
      lines.push({ productId: product.id, productName: product.name, unit: product.unit, quantity, price: Number(raw.price), orderItemId: null })
    }
  }
  const amount = round2(lines.reduce((sum, line) => sum + line.quantity * line.price, 0))
  if (amount > MAX_MONEY) throw new ClientReturnError("Сумма возврата слишком большая", 400, { field: "items" })
  return { client, warehouse, returnDate, deliverer, agent, order, currency, lines, amount }
}

async function writeLines(db: PgDb, returnId: number, lines: ResolvedReturnLine[]) {
  await db.prepare("DELETE FROM client_return_items WHERE return_id = ?").run(returnId)
  for (const line of lines) {
    await db
      .prepare(
        `INSERT INTO client_return_items (return_id, product_id, product_name, unit, quantity, price, order_item_id)
         VALUES (@returnId, @productId, @productName, @unit, @quantity, @price, @orderItemId)`,
      )
      .run({ returnId, ...line })
  }
}

async function lockReturns(db: PgDb) {
  await db.exec("SELECT pg_advisory_xact_lock(72120934)")
}

async function acceptRow(db: PgDb, row: ReturnRow, user: string) {
  if (row.status !== "pending") throw new ClientReturnError(row.status === "accepted" ? "Возврат уже принят" : "Отмененный возврат нельзя принять", 409, { id: row.id })
  if (!row.warehouse.trim()) throw new ClientReturnError("Укажите склад возврата", 400, { field: "warehouse", id: row.id })
  await resolveWarehouse(db, row.warehouse)
  const items = (await db.prepare("SELECT COUNT(*)::int AS n FROM client_return_items WHERE return_id = ?").get(row.id)) as { n: number }
  if (!items.n) throw new ClientReturnError("В возврате нет товаров", 400, { id: row.id })
  await db
    .prepare("UPDATE client_returns SET status = 'accepted', accepted_at = @at, accepted_by = @user, updated_at = datetime('now') WHERE id = @id")
    .run({ id: row.id, at: new Date().toISOString(), user })
}

export async function createClientReturn(input: ClientReturnInput, user: { displayName: string }): Promise<ClientReturn> {
  await ensureClientReturnsSchema()
  const id = await withTransaction(async (tx) => {
    await lockReturns(tx)
    const prepared = await prepareReturn(tx, input, 0)
    if (input.accept && !prepared.warehouse) throw new ClientReturnError("Укажите склад возврата", 400, { field: "warehouse" })
    const inserted = await tx
      .prepare(
        `INSERT INTO client_returns (client_id, client, warehouse, order_id, return_date, status, currency, amount, comment, created_by, deliverer, agent)
         VALUES (@clientId, @client, @warehouse, @orderId, @returnDate, 'pending', @currency, @amount, @comment, @createdBy, @deliverer, @agent)`,
      )
      .run({
        clientId: prepared.client.id,
        client: prepared.client.name,
        warehouse: prepared.warehouse,
        orderId: prepared.order?.id ?? null,
        returnDate: prepared.returnDate,
        currency: prepared.currency,
        amount: prepared.amount,
        comment: input.comment?.trim() ?? "",
        createdBy: user.displayName,
        deliverer: prepared.deliverer,
        agent: prepared.agent,
      })
    const returnId = Number(inserted.lastInsertRowid)
    await writeLines(tx, returnId, prepared.lines)
    if (input.accept) await acceptRow(tx, (await loadReturn(tx, returnId, true))!, user.displayName)
    return returnId
  })
  return (await getClientReturn(id))!
}

/** Edits a pending return (header and lines); 409 once accepted or cancelled. */
export async function updateClientReturn(id: number, input: ClientReturnInput, user: { displayName: string }): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientReturnsSchema()
  const found = await withTransaction(async (tx) => {
    await lockReturns(tx)
    const row = await loadReturn(tx, id, true)
    if (!row) return false
    if (row.status !== "pending") throw new ClientReturnError("Изменить можно только непринятый возврат", 409, { status: row.status })
    const existing = (await tx.prepare("SELECT * FROM client_return_items WHERE return_id = ? ORDER BY id").all(id)) as ItemRow[]
    const merged: ClientReturnInput = {
      clientId: input.clientId ?? (input.client ? undefined : row.client_id ?? undefined),
      client: input.client ?? (row.client_id ? undefined : row.client),
      warehouse: input.warehouse ?? row.warehouse,
      orderId: input.orderId ?? row.order_id ?? undefined,
      returnDate: input.returnDate ?? row.return_date,
      currency: input.currency ?? row.currency,
      deliverer: input.deliverer ?? row.deliverer,
      agent: input.agent ?? row.agent,
      items:
        input.items ??
        existing.map((item) => ({ orderItemId: item.order_item_id ?? undefined, productId: item.product_id ?? undefined, productName: item.product_name, quantity: Number(item.quantity), price: Number(item.price) })),
    }
    const prepared = await prepareReturn(tx, merged, id)
    await tx
      .prepare(
        `UPDATE client_returns SET client_id = @clientId, client = @client, warehouse = @warehouse, order_id = @orderId, return_date = @returnDate,
           currency = @currency, amount = @amount, comment = @comment, deliverer = @deliverer, agent = @agent, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        clientId: prepared.client.id,
        client: prepared.client.name,
        warehouse: prepared.warehouse,
        orderId: prepared.order?.id ?? null,
        returnDate: prepared.returnDate,
        currency: prepared.currency,
        amount: prepared.amount,
        comment: input.comment !== undefined ? input.comment.trim() : row.comment,
        deliverer: prepared.deliverer,
        agent: prepared.agent,
      })
    await writeLines(tx, id, prepared.lines)
    void user
    return true
  })
  return found ? getClientReturn(id) : null
}

/** Accepts pending returns into their warehouse (stock + client credit start counting). */
export async function acceptClientReturns(ids: number[], user: { displayName: string }): Promise<ClientReturn[]> {
  await ensureClientReturnsSchema()
  const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
  if (!unique.length) throw new ClientReturnError("Выберите возвраты", 400, { field: "ids" })
  await withTransaction(async (tx) => {
    await lockReturns(tx)
    for (const id of unique) {
      const row = await loadReturn(tx, id, true)
      if (!row) throw new ClientReturnError(`Возврат №${id} не найден`, 404, { id })
      await acceptRow(tx, row, user.displayName)
    }
  })
  return Promise.all(unique.map(async (id) => (await getClientReturn(id))!))
}

/** Cancels a pending return; an accepted return cannot be cancelled (409). */
export async function cancelClientReturn(id: number, user: { displayName: string }): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientReturnsSchema()
  const found = await withTransaction(async (tx) => {
    await lockReturns(tx)
    const row = await loadReturn(tx, id, true)
    if (!row) return false
    if (row.status === "cancelled") return true
    if (row.status !== "pending") throw new ClientReturnError("Принятый возврат нельзя отменить", 409, { status: row.status })
    await tx
      .prepare("UPDATE client_returns SET status = 'cancelled', cancelled_at = @at, cancelled_by = @user, updated_at = datetime('now') WHERE id = @id")
      .run({ id, at: new Date().toISOString(), user: user.displayName })
    return true
  })
  return found ? getClientReturn(id) : null
}

/** Accepted returns per currency in a local-day range (dashboard "Возвраты"). */
export async function acceptedReturnTotals(from: string, to: string, db: PgDb = getDb()): Promise<{ totals: Array<{ currency: string; amount: number }>; orders: number }> {
  const exists = (await db.prepare("SELECT to_regclass('client_returns') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return { totals: [], orders: 0 }
  const day = "COALESCE(fin_ts(NULLIF(r.accepted_at, '')), fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))::date"
  const rows = (await db
    .prepare(
      `SELECT r.currency, SUM(r.amount)::float8 AS amount, COUNT(DISTINCT r.order_id)::int AS orders
         FROM client_returns r WHERE r.status = 'accepted' AND ${day} BETWEEN @from::date AND @to::date GROUP BY 1`,
    )
    .all({ from, to })) as Array<{ currency: string; amount: number; orders: number }>
  const base = await baseCurrency(db)
  return {
    totals: rows.map((row) => ({ currency: row.currency || base, amount: round2(Number(row.amount) || 0) })).filter((row) => row.amount !== 0),
    orders: rows.reduce((sum, row) => sum + (Number(row.orders) || 0), 0),
  }
}

export { formatMoney }
