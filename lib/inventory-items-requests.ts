import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { nameKey } from "@/lib/finance/entities"
import { todayIso } from "@/lib/finance/dates"
import { InventoryError, type InventoryQuery } from "@/lib/inventory-items-api"
import {
  ITEM_REF_COLUMNS,
  actorName,
  clientName,
  giveToClient,
  inventoryProduct,
  isAttached,
  itemRef,
  localTime,
  lockItem,
  takeFromClient,
  type Actor,
  type ItemRefRow,
} from "@/lib/inventory-items-repo"
import { ensureInventorySchema } from "@/lib/inventory-items-schema"
import type { InventoryListResult, InventoryRequest, InventoryRequestStatus, InventoryRequestType } from "@/lib/inventory-items-types"

// "Запросы" (demo main/gear_request): an agent asks to attach equipment to a
// client ("Прикрепления") or to take an item back ("Открепления"); the manager
// confirms ("Подтвердить": attach picks an item from a warehouse, detach takes
// the requested one) or rejects ("Отклонить"). Agents create requests through
// POST /api/inventory-items/requests (the web page offers "Новый запрос" too).

const NOT_FOUND = "Запрос не найден"

type RequestRow = Partial<ItemRefRow> & {
  id: number
  type: string
  status: string
  client_id: number | null
  client_name: string
  product_id: number | null
  product_name: string
  comment: string
  reason: string
  requested_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const FROM = `FROM inventory_item_requests r
  LEFT JOIN clients c ON c.id = r.client_id
  LEFT JOIN products rp ON rp.id = r.product_id
  LEFT JOIN inventory_items i ON i.id = r.item_id
  LEFT JOIN products p ON p.id = i.product_id`

const COLUMNS = `r.id, r.type, r.status, r.client_id, COALESCE(NULLIF(btrim(c.name), ''), r.client) AS client_name,
  COALESCE(r.product_id, i.product_id) AS product_id,
  COALESCE(NULLIF(btrim(rp.name), ''), NULLIF(btrim(r.product), ''), NULLIF(btrim(p.name), ''), i.inventory_type, '') AS product_name,
  r.comment, r.reason, r.requested_by, r.created_at, r.updated_by, r.updated_at, ${ITEM_REF_COLUMNS}`

function toRequest(row: RequestRow): InventoryRequest {
  return {
    id: Number(row.id),
    type: (row.type === "detach" ? "detach" : "attach") as InventoryRequestType,
    status: (["pending", "confirmed", "canceled"].includes(row.status) ? row.status : "pending") as InventoryRequestStatus,
    client: row.client_id === null && !row.client_name ? null : { id: row.client_id === null ? null : Number(row.client_id), name: row.client_name ?? "" },
    product: row.product_name ? { id: row.product_id === null ? null : Number(row.product_id), name: row.product_name } : null,
    item: row.item_id === null || row.item_id === undefined ? null : itemRef(row as ItemRefRow),
    comment: row.comment ?? "",
    reason: row.reason ?? "",
    requestedBy: row.requested_by ?? "",
    createdAt: localTime(row.created_at),
    updatedBy: row.updated_by ?? "",
    updatedAt: localTime(row.updated_at),
  }
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

const createdDay = (column: string) => `to_char(fin_ts(${column}, true), 'YYYY-MM-DD')`

export async function listInventoryRequests(query: InventoryQuery): Promise<InventoryListResult<InventoryRequest>> {
  await ensureInventorySchema()
  const db = getDb()
  const where: string[] = []
  const args: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql)
    args.push(...values)
  }
  if (query.requestStatuses.length) add("r.status = ANY(?::text[])", query.requestStatuses)
  if (query.requestTypes.length) add("r.type = ANY(?::text[])", query.requestTypes)
  if (query.clients.length) add("r.client_id = ANY(?::int[])", query.clients)
  if (query.products.length) add("COALESCE(r.product_id, i.product_id) = ANY(?::int[])", query.products)
  if (query.items.length) add("r.item_id = ANY(?::int[])", query.items)
  if (query.requestedBy.length) add("fin_key(r.requested_by) = ANY(?::text[])", query.requestedBy.map(nameKey))
  if (query.processedBy.length) add("fin_key(r.updated_by) = ANY(?::text[])", query.processedBy.map(nameKey))
  if (query.createdFrom) add(`${createdDay("r.created_at")} >= ?`, query.createdFrom)
  if (query.createdTo) add(`${createdDay("r.created_at")} <= ?`, query.createdTo)
  if (query.updatedFrom) add(`r.updated_at <> '' AND ${createdDay("r.updated_at")} >= ?`, query.updatedFrom)
  if (query.updatedTo) add(`r.updated_at <> '' AND ${createdDay("r.updated_at")} <= ?`, query.updatedTo)
  if (query.search) {
    const pattern = likePattern(query.search)
    add(
      "(COALESCE(c.name, r.client) ILIKE ? OR COALESCE(rp.name, r.product) ILIKE ? OR i.serial_number ILIKE ? OR i.inventory_code ILIKE ? OR r.comment ILIKE ? OR r.id::text = ?)",
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      query.search,
    )
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const count = Number(((await db.prepare(`SELECT COUNT(*)::int AS n ${FROM} ${whereSql}`).get(...args)) as { n: number })?.n ?? 0)
  const pageSize = Math.max(0, query.pageSize)
  const lastPage = pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1
  const page = pageSize ? Math.min(Math.max(1, query.page), lastPage) : 1
  const limit = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : " LIMIT 10000"
  const order = query.ordering === "id" ? "r.id ASC" : "r.id DESC"
  const rows = (await db.prepare(`SELECT ${COLUMNS} ${FROM} ${whereSql} ORDER BY ${order}${limit}`).all(...args)) as RequestRow[]
  return { count, page, pageSize, results: rows.map(toRequest) }
}

export async function getInventoryRequest(id: number): Promise<InventoryRequest | null> {
  await ensureInventorySchema()
  const row = (await getDb().prepare(`SELECT ${COLUMNS} ${FROM} WHERE r.id = ?`).get(id)) as RequestRow | undefined
  return row ? toRequest(row) : null
}

/** New request: attach (client + optional Тип инвентаря) or detach (an item attached to that client). */
export async function createInventoryRequest(
  input: { type: InventoryRequestType; clientId: number; productId?: number | null; itemId?: number | null; comment: string },
  user: Actor,
): Promise<InventoryRequest> {
  await ensureInventorySchema()
  const id = await withTransaction(async (tx) => {
    if (!input.clientId) throw new InventoryError("Обязательное поле", 400, "client")
    const client = await clientName(tx, input.clientId)
    let productId: number | null = null
    let product = ""
    let itemId: number | null = null
    if (input.type === "detach") {
      if (!input.itemId) throw new InventoryError("Обязательное поле", 400, "gear")
      const item = await lockItem(tx, input.itemId)
      if (item.client_id !== input.clientId) throw new InventoryError("Инвентарь не прикреплен к этому клиенту", 400, "gear")
      const pending = await tx.prepare("SELECT 1 FROM inventory_item_requests WHERE item_id = ? AND status = 'pending' LIMIT 1").get(item.id)
      if (pending) throw new InventoryError("По этому инвентарю уже есть запрос в процессе", 409, "gear")
      itemId = item.id
      productId = item.product_id
    } else if (input.productId) {
      const found = await inventoryProduct(tx, input.productId)
      productId = found.id
      product = found.name
    }
    const result = await tx
      .prepare("INSERT INTO inventory_item_requests (type, status, client_id, client, product_id, product, item_id, comment, requested_by) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?)")
      .run(input.type, input.clientId, client, productId, product, itemId, input.comment.trim(), actorName(user))
    return Number(result.lastInsertRowid)
  })
  return (await getInventoryRequest(id))!
}

type LockedRequest = { id: number; type: string; status: string; client_id: number | null; client: string; item_id: number | null; comment: string }

async function lockPending(tx: PgDb, id: number): Promise<LockedRequest> {
  const row = (await tx.prepare("SELECT id, type, status, client_id, client, item_id, comment FROM inventory_item_requests WHERE id = ? FOR UPDATE").get(id)) as LockedRequest | undefined
  if (!row) throw new InventoryError(NOT_FOUND, 404)
  if (row.status !== "pending") throw new InventoryError("Запрос уже обработан", 409)
  return row
}

/**
 * "Подтвердить": attach gives the chosen item (in a warehouse) to the request's
 * client; detach takes the requested item back from that client. Both log the
 * movement with the request id.
 */
export async function confirmInventoryRequest(id: number, itemId: number | null, user: Actor): Promise<InventoryRequest> {
  await ensureInventorySchema()
  const by = actorName(user)
  await withTransaction(async (tx) => {
    const request = await lockPending(tx, id)
    const today = todayIso()
    const comment = request.comment ?? ""
    if (request.type === "attach") {
      if (!itemId) throw new InventoryError("Обязательное поле", 400, "gear")
      if (request.client_id === null) throw new InventoryError("Клиент не найден", 400, "client")
      const client = { id: request.client_id, name: await clientName(tx, request.client_id) }
      const item = await lockItem(tx, itemId)
      if (isAttached(item)) throw new InventoryError("Инвентарь уже прикреплен к клиенту", 409, "gear")
      await giveToClient(tx, item, client, { date: today, condition: item.condition, comment, requestId: request.id, user: by })
      await tx.prepare("UPDATE inventory_item_requests SET status = 'confirmed', item_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(item.id, by, request.id)
      return
    }
    const target = request.item_id ?? itemId
    if (!target) throw new InventoryError("Обязательное поле", 400, "gear")
    const item = await lockItem(tx, target)
    if (!isAttached(item) || (request.client_id !== null && item.client_id !== request.client_id)) throw new InventoryError("Инвентарь не прикреплен к этому клиенту", 409, "gear")
    await takeFromClient(tx, item, { date: today, condition: item.condition, comment, requestId: request.id, user: by })
    await tx.prepare("UPDATE inventory_item_requests SET status = 'confirmed', item_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(item.id, by, request.id)
  })
  return (await getInventoryRequest(id))!
}

/** "Отклонить" ("Успешно отклонено"). */
export async function cancelInventoryRequest(id: number, reason: string, user: Actor): Promise<InventoryRequest> {
  await ensureInventorySchema()
  await withTransaction(async (tx) => {
    await lockPending(tx, id)
    await tx.prepare("UPDATE inventory_item_requests SET status = 'canceled', reason = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(reason.trim(), actorName(user), id)
  })
  return (await getInventoryRequest(id))!
}
