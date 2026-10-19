import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { nameKey } from "@/lib/finance/entities"
import { isIsoDay, nowLocalIso, parseAnyDate, todayIso } from "@/lib/finance/dates"
import { InventoryError, type InventoryQuery } from "@/lib/inventory-items-api"
import { ensureInventorySchema } from "@/lib/inventory-items-schema"
import {
  INVENTORY_CONDITIONS,
  type InventoryChangeInput,
  type InventoryCheck,
  type InventoryItem,
  type InventoryItemDetail,
  type InventoryItemInput,
  type InventoryItemListResult,
  type InventoryItemRef,
  type InventoryListResult,
  type InventoryLog,
  type InventoryLogStatus,
  type InventoryTotals,
} from "@/lib/inventory-items-types"

// "Работа с инвентарем" items (demo main/gear): list per tab with filters and
// totals (Одобрено / Не одобрено / Итого), create / edit / soft delete
// ("Показать удаленные"), "Передача / Изъятие" (take from the current client,
// give to another), the review toggle (Одобрить / Не одобрить → "История
// проверки") and the movement log ("История движений"). Equipment is counted
// on its own: nothing here touches the stock core.

export type Actor = { displayName?: string; username?: string }

export function actorName(user: Actor): string {
  return (user.displayName || user.username || "").trim()
}

export const NOT_FOUND = "Инвентарь не найден"
export const LINKED = "Удаление невозможно из-за связи с другими данными"
const REQUIRED = "Обязательное поле"

/** Attached = has a client (id or legacy name). */
export const ATTACHED_SQL = "(i.client_id IS NOT NULL OR btrim(i.client) <> '')"

const ITEM_FROM = `
FROM inventory_items i
LEFT JOIN products p ON p.id = i.product_id
LEFT JOIN clients c ON c.id = i.client_id
LEFT JOIN LATERAL (SELECT w.branch FROM warehouses w WHERE fin_key(w.name) = fin_key(i.warehouse) ORDER BY w.id LIMIT 1) wh ON true`

/** Product / client names: the live registry name, else the name stored on the row. */
export const PRODUCT_NAME_SQL = "COALESCE(NULLIF(btrim(p.name), ''), i.inventory_type)"
const CLIENT_NAME_SQL = `CASE WHEN ${ATTACHED_SQL} THEN COALESCE(NULLIF(btrim(c.name), ''), i.client) END`

const ITEM_COLUMNS = `i.id, i.serial_number, i.inventory_code, i.product_id, ${PRODUCT_NAME_SQL} AS product_name,
  COALESCE(p.unit, '') AS product_unit, COALESCE(p.organization, '') AS product_org, i.client_id, ${CLIENT_NAME_SQL} AS client_name,
  i.warehouse, i.condition, i.responsible, i.attach_date, i.created_at, i.created_by, i.comment, i.approved, i.check_date,
  i.reviewed_by, (i.photo <> '') AS has_photo, i.updated_at, i.deleted`

type ItemRow = {
  id: number
  serial_number: string
  inventory_code: string
  product_id: number | null
  product_name: string
  product_unit: string
  product_org: string
  client_id: number | null
  client_name: string | null
  warehouse: string
  condition: string
  responsible: string
  attach_date: string
  created_at: string
  created_by: string
  comment: string
  approved: number
  check_date: string
  reviewed_by: string
  has_photo: boolean
  updated_at: string
  deleted: number
}

export function localTime(text: string | null | undefined, utc = true): string {
  return text ? (parseAnyDate(text, utc) ?? "") : ""
}

function rowToItem(row: ItemRow): InventoryItem {
  return {
    id: Number(row.id),
    serialNumber: row.serial_number ?? "",
    stockNumber: row.inventory_code ?? "",
    product: { id: row.product_id === null ? null : Number(row.product_id), name: row.product_name ?? "", unit: row.product_unit ?? "", organization: row.product_org ?? "" },
    client: row.client_name === null ? null : { id: row.client_id === null ? null : Number(row.client_id), name: row.client_name },
    warehouse: row.warehouse ?? "",
    condition: row.condition ?? "",
    responsible: row.responsible ?? "",
    date: (row.attach_date ?? "").slice(0, 10),
    createdAt: localTime(row.created_at),
    createdBy: row.created_by ?? "",
    comment: row.comment ?? "",
    isReviewed: Number(row.approved) === 1,
    reviewedAt: localTime(row.check_date, false),
    reviewedBy: row.reviewed_by ?? "",
    hasPhoto: Boolean(row.has_photo),
    version: row.updated_at ?? "",
    deleted: Number(row.deleted) === 1,
  }
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

const keys = (values: string[]) => values.map(nameKey)

/** Local day of a created_at (UTC text) column, for the period filters. */
const createdDay = (column: string) => `to_char(fin_ts(${column}, true), 'YYYY-MM-DD')`

function pageOf(count: number, query: InventoryQuery) {
  const pageSize = Math.max(0, query.pageSize)
  const lastPage = pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1
  const page = pageSize ? Math.min(Math.max(1, query.page), lastPage) : 1
  const limit = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : " LIMIT 10000"
  return { page, pageSize, limit }
}

function itemWhere(query: InventoryQuery): { sql: string; args: unknown[] } {
  const where: string[] = []
  const args: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql)
    args.push(...values)
  }
  if (!query.showDeleted) add("i.deleted = 0")
  if (query.scope === "in_stock") add(`NOT ${ATTACHED_SQL}`)
  if (query.scope === "in_market") add(ATTACHED_SQL)
  if (query.clients.length) add("i.client_id = ANY(?::int[])", query.clients)
  if (query.products.length) add("i.product_id = ANY(?::int[])", query.products)
  if (query.items.length) add("i.id = ANY(?::int[])", query.items)
  if (query.warehouses.length) add("fin_key(i.warehouse) = ANY(?::text[])", keys(query.warehouses))
  if (query.users.length) add("fin_key(i.responsible) = ANY(?::text[])", keys(query.users))
  if (query.organizations.length) add("fin_key(p.organization) = ANY(?::text[])", keys(query.organizations))
  if (query.branches.length) add("(fin_key(wh.branch) = ANY(?::text[]) OR fin_key(c.branch) = ANY(?::text[]))", keys(query.branches), keys(query.branches))
  if (query.clientTypes.length) add("fin_key(c.type) = ANY(?::text[])", keys(query.clientTypes))
  if (query.agents.length) add("fin_key(c.agent) = ANY(?::text[])", keys(query.agents))
  if (query.zones.length) add("fin_key(c.zone) = ANY(?::text[])", keys(query.zones))
  if (query.isReviewed !== null) add("i.approved = ?", query.isReviewed ? 1 : 0)
  if (query.attachFrom) add("left(i.attach_date, 10) >= ?", query.attachFrom)
  if (query.attachTo) add("left(i.attach_date, 10) <= ?", query.attachTo)
  if (query.createdFrom) add(`${createdDay("i.created_at")} >= ?`, query.createdFrom)
  if (query.createdTo) add(`${createdDay("i.created_at")} <= ?`, query.createdTo)
  if (query.search) {
    const pattern = likePattern(query.search)
    add(
      `(${PRODUCT_NAME_SQL} ILIKE ? OR i.serial_number ILIKE ? OR i.inventory_code ILIKE ? OR COALESCE(c.name, i.client) ILIKE ? OR i.comment ILIKE ? OR i.id::text = ?)`,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      query.search,
    )
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args }
}

const ITEM_ORDER: Record<string, string> = {
  id: "i.id ASC",
  "-id": "i.id DESC",
  created_date: "i.created_at ASC, i.id ASC",
  "-created_date": "i.created_at DESC, i.id DESC",
  date: "i.attach_date ASC, i.id ASC",
  "-date": "i.attach_date DESC, i.id DESC",
}

export async function listInventoryItems(query: InventoryQuery): Promise<InventoryItemListResult> {
  await ensureInventorySchema()
  const db = getDb()
  const { sql, args } = itemWhere(query)
  const counted = (await db.prepare(`SELECT COUNT(*)::int AS n ${ITEM_FROM} ${sql}`).get(...args)) as { n: number }
  const count = Number(counted?.n ?? 0)
  const { page, pageSize, limit } = pageOf(count, query)
  const rows = (await db.prepare(`SELECT ${ITEM_COLUMNS} ${ITEM_FROM} ${sql} ORDER BY ${ITEM_ORDER[query.ordering] ?? ITEM_ORDER["-id"]}${limit}`).all(...args)) as ItemRow[]
  return { count, page, pageSize, results: rows.map(rowToItem) }
}

/** Demo total_reviews: Одобрено / Не одобрено / Итого of the filtered list. */
export async function getInventoryTotals(query: InventoryQuery): Promise<InventoryTotals> {
  await ensureInventorySchema()
  const { sql, args } = itemWhere(query)
  const row = (await getDb()
    .prepare(`SELECT COUNT(*) FILTER (WHERE i.approved = 1)::int AS reviewed, COUNT(*) FILTER (WHERE i.approved <> 1)::int AS not_reviewed, COUNT(*)::int AS total ${ITEM_FROM} ${sql}`)
    .get(...args)) as { reviewed: number; not_reviewed: number; total: number }
  return { reviewed: Number(row?.reviewed ?? 0), notReviewed: Number(row?.not_reviewed ?? 0), total: Number(row?.total ?? 0) }
}

async function loadItem(db: PgDb, id: number): Promise<InventoryItem | null> {
  const row = (await db.prepare(`SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE i.id = ?`).get(id)) as ItemRow | undefined
  return row ? rowToItem(row) : null
}

export async function getInventoryItem(id: number): Promise<InventoryItemDetail | null> {
  await ensureInventorySchema()
  const db = getDb()
  const item = await loadItem(db, id)
  if (!item) return null
  const pending = (await db.prepare("SELECT COUNT(*)::int AS n FROM inventory_item_requests WHERE item_id = ? AND status = 'pending'").get(id)) as { n: number }
  return { ...item, pendingRequests: Number(pending?.n ?? 0) }
}

export async function getInventoryPhoto(id: number): Promise<{ type: string; data: Buffer } | null> {
  await ensureInventorySchema()
  const row = (await getDb().prepare("SELECT photo FROM inventory_items WHERE id = ?").get(id)) as { photo: string } | undefined
  const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(row?.photo ?? "")
  return match ? { type: match[1], data: Buffer.from(match[2], "base64") } : null
}

// --- writes ---------------------------------------------------------------------------------

/** Locked raw row of a live (not deleted) item. */
export type LockedItem = { id: number; client_id: number | null; client: string; warehouse: string; condition: string; product_id: number | null; deleted: number }

export async function lockItem(db: PgDb, id: number): Promise<LockedItem> {
  const row = (await db
    .prepare("SELECT id, client_id, client, warehouse, condition, product_id, deleted FROM inventory_items WHERE id = ? FOR UPDATE")
    .get(id)) as LockedItem | undefined
  if (!row || Number(row.deleted) === 1) throw new InventoryError(NOT_FOUND, 404)
  return row
}

export function isAttached(item: LockedItem): boolean {
  return item.client_id !== null || Boolean((item.client ?? "").trim())
}

export async function clientName(db: PgDb, clientId: number, field = "client"): Promise<string> {
  const row = (await db.prepare("SELECT name FROM clients WHERE id = ?").get(clientId)) as { name: string } | undefined
  if (!row) throw new InventoryError("Клиент не найден", 400, field)
  return row.name
}

/** Registered warehouse name (canonical spelling) or a field error. */
export async function warehouseName(db: PgDb, name: string, field = "warehouse"): Promise<string> {
  if (!name.trim()) throw new InventoryError(REQUIRED, 400, field)
  const row = (await db.prepare("SELECT name FROM warehouses WHERE fin_key(name) = fin_key(?) ORDER BY id LIMIT 1").get(name)) as { name: string } | undefined
  if (!row) throw new InventoryError("Склад не найден", 400, field)
  return row.name
}

/** Inventory product (products.is_inventory = 1, not deleted); `keepId` stays valid on edit. */
export async function inventoryProduct(db: PgDb, productId: number, keepId: number | null = null, field = "product"): Promise<{ id: number; name: string }> {
  if (!productId) throw new InventoryError(REQUIRED, 400, field)
  const row = (await db.prepare("SELECT id, name, is_inventory, deleted FROM products WHERE id = ?").get(productId)) as
    | { id: number; name: string; is_inventory: number; deleted: number }
    | undefined
  if (!row) throw new InventoryError("Продукт не найден", 400, field)
  if ((Number(row.is_inventory) !== 1 || Number(row.deleted) === 1) && row.id !== keepId) throw new InventoryError("Выберите продукт, отмеченный как инвентарь", 400, field)
  return { id: Number(row.id), name: row.name }
}

export function checkCondition(value: string, current = "", field = "condition"): string {
  const condition = value.trim()
  if (!condition) throw new InventoryError(REQUIRED, 400, field)
  if (!(INVENTORY_CONDITIONS as readonly string[]).includes(condition) && condition !== current) throw new InventoryError("Неизвестное состояние", 400, field)
  return condition
}

export async function checkStockNumber(db: PgDb, stockNumber: string, exceptId: number | null, field = "stockNumber"): Promise<void> {
  if (!stockNumber) return
  const row = await db
    .prepare("SELECT id FROM inventory_items WHERE deleted = 0 AND fin_key(inventory_code) = fin_key(?) AND id <> ? LIMIT 1")
    .get(stockNumber, exceptId ?? 0)
  if (row) throw new InventoryError("Инвентарный номер уже используется", 400, field)
}

export async function insertLog(
  db: PgDb,
  log: { itemId: number; status: InventoryLogStatus; clientId: number | null; client: string; warehouse: string; condition: string; date: string; comment: string; requestId?: number | null; user: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO inventory_item_logs (item_id, status, client_id, client, warehouse, condition, move_date, comment, request_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(log.itemId, log.status, log.clientId, log.client, log.warehouse, log.condition, log.date, log.comment, log.requestId ?? null, log.user)
}

type NormalizedInput = {
  warehouse: string
  productId: number
  productName: string
  condition: string
  responsible: string
  clientId: number | null
  client: string
  serialNumber: string
  stockNumber: string
  date: string
  comment: string
}

async function normalizeInput(db: PgDb, input: InventoryItemInput, current: LockedItem | null): Promise<NormalizedInput> {
  const warehouse = await warehouseName(db, input.warehouse)
  const product = await inventoryProduct(db, input.productId, current?.product_id ?? null)
  const condition = checkCondition(input.condition, current?.condition ?? "")
  const responsible = input.responsible.trim()
  if (!responsible) throw new InventoryError(REQUIRED, 400, "user")
  const serialNumber = input.serialNumber.trim()
  if (!serialNumber) throw new InventoryError(REQUIRED, 400, "serialNumber")
  const stockNumber = input.stockNumber.trim()
  if (!stockNumber) throw new InventoryError(REQUIRED, 400, "stockNumber")
  await checkStockNumber(db, stockNumber, current?.id ?? null)
  if (!isIsoDay(input.date)) throw new InventoryError(REQUIRED, 400, "date")
  const clientId = !current && input.clientId ? input.clientId : null
  const client = clientId ? await clientName(db, clientId) : ""
  return { warehouse, productId: product.id, productName: product.name, condition, responsible, clientId, client, serialNumber, stockNumber, date: input.date, comment: input.comment.trim() }
}

/** "Добавление инвентаря": the item and its "create" log (Новый) in one transaction. */
export async function createInventoryItem(input: InventoryItemInput, user: Actor): Promise<InventoryItemDetail> {
  await ensureInventorySchema()
  const by = actorName(user)
  const id = await withTransaction(async (tx) => {
    const data = await normalizeInput(tx, input, null)
    const result = await tx
      .prepare(
        `INSERT INTO inventory_items (serial_number, client, client_id, inventory_type, product_id, inventory_code, warehouse, condition,
           responsible, attach_date, created_date, check_date, approved, comment, photo, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?)`,
      )
      .run(
        data.serialNumber,
        data.client,
        data.clientId,
        data.productName,
        data.productId,
        data.stockNumber,
        data.warehouse,
        data.condition,
        data.responsible,
        data.date,
        nowLocalIso(),
        data.comment,
        input.photo ?? "",
        by,
      )
    const itemId = Number(result.lastInsertRowid)
    await insertLog(tx, { itemId, status: "create", clientId: data.clientId, client: data.client, warehouse: data.warehouse, condition: data.condition, date: data.date, comment: data.comment, user: by })
    return itemId
  })
  return (await getInventoryItem(id))!
}

/** "Изменение инвентаря": every field but the client (moves go through change). */
export async function updateInventoryItem(id: number, input: InventoryItemInput): Promise<InventoryItemDetail> {
  await ensureInventorySchema()
  await withTransaction(async (tx) => {
    const current = await lockItem(tx, id)
    const data = await normalizeInput(tx, input, current)
    await tx
      .prepare(
        `UPDATE inventory_items SET serial_number = ?, inventory_type = ?, product_id = ?, inventory_code = ?, warehouse = ?, condition = ?,
           responsible = ?, attach_date = ?, comment = ?, photo = COALESCE(?, photo), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(data.serialNumber, data.productName, data.productId, data.stockNumber, data.warehouse, data.condition, data.responsible, data.date, data.comment, input.photo ?? null, id)
  })
  return (await getInventoryItem(id))!
}

async function softDelete(tx: PgDb, id: number, by: string): Promise<void> {
  await lockItem(tx, id)
  const pending = await tx.prepare("SELECT 1 FROM inventory_item_requests WHERE item_id = ? AND status = 'pending' LIMIT 1").get(id)
  if (pending) throw new InventoryError(LINKED, 409, undefined, { id })
  await tx.prepare("UPDATE inventory_items SET deleted = 1, deleted_at = datetime('now'), deleted_by = ?, updated_at = datetime('now') WHERE id = ?").run(by, id)
}

/** Soft delete (the demo keeps deleted gear behind "Показать удаленные"); blocked by a pending request. */
export async function deleteInventoryItem(id: number, user: Actor): Promise<void> {
  await ensureInventorySchema()
  await withTransaction((tx) => softDelete(tx, id, actorName(user)))
}

/** Checkbox "Удалить": all or nothing. */
export async function bulkDeleteInventoryItems(ids: number[], user: Actor): Promise<number> {
  await ensureInventorySchema()
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  await withTransaction(async (tx) => {
    for (const id of unique) await softDelete(tx, id, actorName(user))
  })
  return unique.length
}

/** Takes a locked attached item from its client: "take" log, client cleared. */
export async function takeFromClient(tx: PgDb, item: LockedItem, options: { date: string; condition: string; comment: string; requestId?: number | null; user: string }): Promise<void> {
  const name = item.client_id !== null ? ((await tx.prepare("SELECT name FROM clients WHERE id = ?").get(item.client_id)) as { name: string } | undefined)?.name : undefined
  await insertLog(tx, { itemId: item.id, status: "take", clientId: item.client_id, client: name ?? item.client, warehouse: item.warehouse, condition: options.condition, date: options.date, comment: options.comment, requestId: options.requestId, user: options.user })
  await tx.prepare("UPDATE inventory_items SET client_id = NULL, client = '', attach_date = ?, condition = ?, updated_at = datetime('now') WHERE id = ?").run(options.date, options.condition, item.id)
}

/** Gives a locked item in a warehouse to a client: "give" log, client set. */
export async function giveToClient(
  tx: PgDb,
  item: LockedItem,
  client: { id: number; name: string },
  options: { date: string; condition: string; comment: string; requestId?: number | null; user: string },
): Promise<void> {
  await insertLog(tx, { itemId: item.id, status: "give", clientId: client.id, client: client.name, warehouse: item.warehouse, condition: options.condition, date: options.date, comment: options.comment, requestId: options.requestId, user: options.user })
  await tx.prepare("UPDATE inventory_items SET client_id = ?, client = ?, attach_date = ?, condition = ?, updated_at = datetime('now') WHERE id = ?").run(client.id, client.name, options.date, options.condition, item.id)
}

/** "Передача / Изъятие" (demo change_market): take from the current client (if any), then give to the chosen one. */
export async function changeInventoryClient(id: number, input: InventoryChangeInput, user: Actor): Promise<InventoryItemDetail> {
  await ensureInventorySchema()
  const by = actorName(user)
  await withTransaction(async (tx) => {
    const item = await lockItem(tx, id)
    const attached = isAttached(item)
    const condition = input.condition?.trim() ? checkCondition(input.condition, item.condition) : item.condition
    const comment = (input.comment ?? "").trim()
    const giveId = input.giveClientId || null
    if (!attached && !giveId) throw new InventoryError("Выберите клиента", 400, "giveClient")
    if (attached && giveId && giveId === item.client_id) throw new InventoryError("Инвентарь уже прикреплен к этому клиенту", 409, "giveClient")
    const give = giveId ? { id: giveId, name: await clientName(tx, giveId, "giveClient") } : null
    const today = todayIso()
    if (attached) {
      await takeFromClient(tx, item, { date: input.takeDate || input.giveDate || today, condition, comment, user: by })
      item.client_id = null
      item.client = ""
    }
    if (give) await giveToClient(tx, item, give, { date: input.giveDate || today, condition, comment, user: by })
  })
  return (await getInventoryItem(id))!
}

/** Одобрить / Не одобрить: sets Одобрено and records the review ("История проверки"). */
export async function reviewInventoryItem(id: number, isReviewed: boolean, user: Actor): Promise<InventoryItemDetail> {
  await ensureInventorySchema()
  const by = actorName(user)
  await withTransaction(async (tx) => {
    const item = await lockItem(tx, id)
    const name = item.client_id !== null ? ((await tx.prepare("SELECT name FROM clients WHERE id = ?").get(item.client_id)) as { name: string } | undefined)?.name : undefined
    await tx.prepare("UPDATE inventory_items SET approved = ?, check_date = ?, reviewed_by = ?, updated_at = datetime('now') WHERE id = ?").run(isReviewed ? 1 : 0, nowLocalIso(), by, id)
    await tx.prepare("INSERT INTO inventory_item_checks (item_id, client_id, client, is_reviewed, created_by) VALUES (?, ?, ?, ?, ?)").run(id, item.client_id, name ?? item.client, isReviewed ? 1 : 0, by)
  })
  return (await getInventoryItem(id))!
}

// --- history and reviews ----------------------------------------------------------------------

export const ITEM_REF_COLUMNS = `i.id AS item_id, ${PRODUCT_NAME_SQL} AS item_product, i.serial_number AS item_serial, i.inventory_code AS item_code,
  i.deleted AS item_deleted, (i.photo <> '') AS item_photo, i.updated_at AS item_version`

export type ItemRefRow = { item_id: number; item_product: string; item_serial: string; item_code: string; item_deleted: number; item_photo: boolean; item_version: string }

export function itemRef(row: ItemRefRow): InventoryItemRef {
  return {
    id: Number(row.item_id),
    product: row.item_product ?? "",
    serialNumber: row.item_serial ?? "",
    stockNumber: row.item_code ?? "",
    deleted: Number(row.item_deleted) === 1,
    hasPhoto: Boolean(row.item_photo),
    version: row.item_version ?? "",
  }
}

type LogRow = ItemRefRow & { id: number; status: string; client_id: number | null; client_name: string; warehouse: string; condition: string; move_date: string; comment: string; created_by: string; created_at: string }

const LOG_ORDER: Record<string, string> = {
  "-id": "l.id DESC",
  id: "l.id ASC",
  created_date: "l.created_at ASC, l.id ASC",
  "-created_date": "l.created_at DESC, l.id DESC",
  date: "l.move_date ASC, l.id ASC",
  "-date": "l.move_date DESC, l.id DESC",
  client: "lower(COALESCE(c.name, l.client)) ASC, l.id DESC",
  "-client": "lower(COALESCE(c.name, l.client)) DESC, l.id DESC",
}

/** "История движений" (demo main/gear_log): create / give / take of every item. */
export async function listInventoryLogs(query: InventoryQuery): Promise<InventoryListResult<InventoryLog>> {
  await ensureInventorySchema()
  const db = getDb()
  const where: string[] = []
  const args: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql)
    args.push(...values)
  }
  if (!query.showDeleted) add("i.deleted = 0")
  if (query.clients.length) add("l.client_id = ANY(?::int[])", query.clients)
  if (query.products.length) add("i.product_id = ANY(?::int[])", query.products)
  if (query.items.length) add("l.item_id = ANY(?::int[])", query.items)
  if (query.warehouses.length) add("fin_key(l.warehouse) = ANY(?::text[])", keys(query.warehouses))
  if (query.users.length) add("fin_key(l.created_by) = ANY(?::text[])", keys(query.users))
  if (query.organizations.length) add("fin_key(p.organization) = ANY(?::text[])", keys(query.organizations))
  if (query.clientTypes.length) add("fin_key(c.type) = ANY(?::text[])", keys(query.clientTypes))
  if (query.logStatuses.length) add("l.status = ANY(?::text[])", query.logStatuses)
  if (query.createdFrom) add(`${createdDay("l.created_at")} >= ?`, query.createdFrom)
  if (query.createdTo) add(`${createdDay("l.created_at")} <= ?`, query.createdTo)
  if (query.moveFrom) add("l.move_date >= ?", query.moveFrom)
  if (query.moveTo) add("l.move_date <= ?", query.moveTo)
  if (query.search) {
    const pattern = likePattern(query.search)
    add(`(${PRODUCT_NAME_SQL} ILIKE ? OR i.serial_number ILIKE ? OR i.inventory_code ILIKE ? OR COALESCE(c.name, l.client) ILIKE ? OR l.comment ILIKE ?)`, pattern, pattern, pattern, pattern, pattern)
  }
  const from = `FROM inventory_item_logs l JOIN inventory_items i ON i.id = l.item_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN clients c ON c.id = l.client_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`
  const count = Number(((await db.prepare(`SELECT COUNT(*)::int AS n ${from}`).get(...args)) as { n: number })?.n ?? 0)
  const { page, pageSize, limit } = pageOf(count, query)
  const rows = (await db
    .prepare(
      `SELECT l.id, l.status, l.client_id, COALESCE(NULLIF(btrim(c.name), ''), l.client) AS client_name, l.warehouse, l.condition, l.move_date, l.comment,
         l.created_by, l.created_at, ${ITEM_REF_COLUMNS} ${from} ORDER BY ${LOG_ORDER[query.ordering] ?? LOG_ORDER["-id"]}${limit}`,
    )
    .all(...args)) as LogRow[]
  return {
    count,
    page,
    pageSize,
    results: rows.map((row) => ({
      id: Number(row.id),
      item: itemRef(row),
      status: (["create", "give", "take"].includes(row.status) ? row.status : "create") as InventoryLogStatus,
      client: row.client_id === null && !row.client_name ? null : { id: row.client_id === null ? null : Number(row.client_id), name: row.client_name ?? "" },
      warehouse: row.warehouse ?? "",
      condition: row.condition ?? "",
      date: row.move_date ?? "",
      comment: row.comment ?? "",
      createdBy: row.created_by ?? "",
      createdAt: localTime(row.created_at),
    })),
  }
}

type CheckRow = ItemRefRow & { id: number; client_id: number | null; client_name: string; is_reviewed: number; comment: string; created_by: string; created_at: string }

/** "История проверки" (demo main/gear_check): every review of an item. */
export async function listInventoryChecks(query: InventoryQuery): Promise<InventoryListResult<InventoryCheck>> {
  await ensureInventorySchema()
  const db = getDb()
  const where: string[] = []
  const args: unknown[] = []
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql)
    args.push(...values)
  }
  if (!query.showDeleted) add("i.deleted = 0")
  if (query.clients.length) add("k.client_id = ANY(?::int[])", query.clients)
  if (query.products.length) add("i.product_id = ANY(?::int[])", query.products)
  if (query.items.length) add("k.item_id = ANY(?::int[])", query.items)
  if (query.users.length) add("fin_key(k.created_by) = ANY(?::text[])", keys(query.users))
  if (query.organizations.length) add("fin_key(p.organization) = ANY(?::text[])", keys(query.organizations))
  if (query.isReviewed !== null) add("k.is_reviewed = ?", query.isReviewed ? 1 : 0)
  if (query.createdFrom) add(`${createdDay("k.created_at")} >= ?`, query.createdFrom)
  if (query.createdTo) add(`${createdDay("k.created_at")} <= ?`, query.createdTo)
  if (query.search) {
    const pattern = likePattern(query.search)
    add(`(${PRODUCT_NAME_SQL} ILIKE ? OR i.serial_number ILIKE ? OR i.inventory_code ILIKE ? OR COALESCE(c.name, k.client) ILIKE ?)`, pattern, pattern, pattern, pattern)
  }
  const from = `FROM inventory_item_checks k JOIN inventory_items i ON i.id = k.item_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN clients c ON c.id = k.client_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`
  const count = Number(((await db.prepare(`SELECT COUNT(*)::int AS n ${from}`).get(...args)) as { n: number })?.n ?? 0)
  const { page, pageSize, limit } = pageOf(count, query)
  const order = query.ordering === "created_date" ? "k.created_at ASC, k.id ASC" : query.ordering === "id" ? "k.id ASC" : "k.id DESC"
  const rows = (await db
    .prepare(
      `SELECT k.id, k.client_id, COALESCE(NULLIF(btrim(c.name), ''), k.client) AS client_name, k.is_reviewed, k.comment, k.created_by, k.created_at,
         ${ITEM_REF_COLUMNS} ${from} ORDER BY ${order}${limit}`,
    )
    .all(...args)) as CheckRow[]
  return {
    count,
    page,
    pageSize,
    results: rows.map((row) => ({
      id: Number(row.id),
      item: itemRef(row),
      client: row.client_id === null && !row.client_name ? null : { id: row.client_id === null ? null : Number(row.client_id), name: row.client_name ?? "" },
      isReviewed: Number(row.is_reviewed) === 1,
      comment: row.comment ?? "",
      createdBy: row.created_by ?? "",
      createdAt: localTime(row.created_at),
    })),
  }
}
