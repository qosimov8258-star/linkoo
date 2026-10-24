import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { isIsoDay, nowLocalIso, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  catalogIndex,
  findShortages,
  lockWarehouseStock,
  resolveLine,
  round6,
  shortageMessage,
  textKey,
  warehouseStock,
  type CatalogIndex,
} from "@/lib/internal-transfers-stock"
import {
  TRANSFER_EDITABLE,
  TRANSFER_STATUSES,
  TRANSFER_TRANSITIONS,
  type StockShortage,
  type Transfer,
  type TransferAction,
  type TransferItem,
  type TransferLog,
  type TransferLogAction,
  type TransferStatus,
} from "@/lib/internal-transfers-types"

// "Передачи между складами" storage: internal_transfers (+ lazy columns for
// who / when it was given, accepted, cancelled, and the currency) and the
// action log internal_transfer_logs ("Логи", with a snapshot of the lines for
// "Детали изменений товаров"). Status changes go through transferAction (the
// state machine of lib/internal-transfers-types.ts); giving is refused when
// the source warehouse lacks the goods (stock core balances).

declare global {
  var __linkoTransfersSchemaV2: Promise<void> | undefined
}

export async function ensureTransfersSchema(): Promise<void> {
  if (!globalThis.__linkoTransfersSchemaV2) {
    globalThis.__linkoTransfersSchemaV2 = (async () => {
      await ensureStockSchema()
      await getDb().exec(`
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS given_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS given_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS accepted_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS accepted_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE internal_transfers ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT '';
        CREATE TABLE IF NOT EXISTS internal_transfer_logs (
          id SERIAL PRIMARY KEY,
          transfer_id INTEGER NOT NULL REFERENCES internal_transfers(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT '',
          from_warehouse TEXT NOT NULL DEFAULT '',
          to_warehouse TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL DEFAULT '',
          currency TEXT NOT NULL DEFAULT '',
          items TEXT NOT NULL DEFAULT '[]',
          user_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS internal_transfer_logs_transfer_idx ON internal_transfer_logs (transfer_id);
        CREATE TABLE IF NOT EXISTS transfer_reference_items (
          id SERIAL PRIMARY KEY,
          transfer_id INTEGER NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          product TEXT NOT NULL DEFAULT '',
          article TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT '',
          quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
          weight DOUBLE PRECISION NOT NULL DEFAULT 0,
          price DOUBLE PRECISION NOT NULL DEFAULT 0,
          series TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS transfer_reference_items_transfer_idx ON transfer_reference_items (transfer_id);
      `)
    })().catch((error) => {
      globalThis.__linkoTransfersSchemaV2 = undefined
      throw error
    })
  }
  await globalThis.__linkoTransfersSchemaV2
}

export type TransferRow = {
  id: number
  from_warehouse: string
  to_warehouse: string
  created_by: string
  created_at_label: string
  delivered_at: string
  amount: number
  weight: number
  status: string
  price_list: string
  organization: string
  invoice_number: string
  transport_number: string
  driver: string
  comment: string
  items: string
  created_at: string
  updated_at: string
  given_at: string
  given_by: string
  accepted_at: string
  accepted_by: string
  cancelled_at: string
  cancelled_by: string
  currency: string
}

function parseItems(text: string): TransferItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text || "[]")
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
    .map((line, index) => ({
      id: Number(line.id) || index + 1,
      key: String(line.key ?? ""),
      product: String(line.product ?? ""),
      article: String(line.article ?? ""),
      unit: String(line.unit ?? ""),
      quantity: Number(String(line.quantity ?? 0).replace(",", ".")) || 0,
      price: Number(line.price) || 0,
      weight: Number(line.weight) || 0,
      series: String(line.series ?? ""),
    }))
}

const statusOf = (value: string): TransferStatus => ((TRANSFER_STATUSES as string[]).includes(value) ? (value as TransferStatus) : "ожидает")

/** Local "YYYY-MM-DDTHH:mm:ss" of a stored date text ('' when unparseable). */
const localIso = (value: string, utc = false) => (value ? (parseAnyDate(value, utc) ?? value) : "")

export function rowToTransfer(row: TransferRow): Transfer {
  return {
    id: row.id,
    fromWarehouse: row.from_warehouse,
    toWarehouse: row.to_warehouse,
    createdBy: row.created_by,
    createdAt: localIso(row.created_at_label) || localIso(row.created_at, true),
    deliveredAt: parseAnyDay(row.delivered_at) ?? row.delivered_at,
    amount: round6(Number(row.amount) || 0),
    weight: round6(Number(row.weight) || 0),
    status: statusOf(row.status),
    priceList: row.price_list,
    currency: row.currency ?? "",
    organization: row.organization,
    invoiceNumber: row.invoice_number,
    transportNumber: row.transport_number,
    driver: row.driver,
    comment: row.comment,
    items: parseItems(row.items),
    givenAt: localIso(row.given_at ?? ""),
    givenBy: row.given_by ?? "",
    acceptedAt: localIso(row.accepted_at ?? ""),
    acceptedBy: row.accepted_by ?? "",
    cancelledAt: localIso(row.cancelled_at ?? ""),
    cancelledBy: row.cancelled_by ?? "",
    updatedAt: localIso(row.updated_at, true),
  }
}

export async function getTransfer(id: number, db?: PgDb): Promise<Transfer | null> {
  await ensureTransfersSchema()
  const row = (await (db ?? getDb()).prepare("SELECT * FROM internal_transfers WHERE id = @id").get({ id })) as TransferRow | undefined
  return row ? rowToTransfer(row) : null
}

/**
 * Product lines the reference shows for a transfer whose own `items` are empty (read-only display data copied from the
 * reference; they never take part in stock or in actions).
 */
export async function getTransferReferenceItems(id: number): Promise<TransferItem[]> {
  await ensureTransfersSchema()
  const rows = (await getDb()
    .prepare("SELECT product, article, unit, quantity, weight, price, series FROM transfer_reference_items WHERE transfer_id = @id ORDER BY position, id")
    .all({ id })) as Array<{ product: string; article: string; unit: string; quantity: number; weight: number; price: number; series: string }>
  return rows.map((row, index) => ({
    id: index + 1,
    key: "",
    product: row.product,
    article: row.article,
    unit: row.unit,
    quantity: Number(row.quantity) || 0,
    price: Number(row.price) || 0,
    // `weight` of a line is its total weight; TransferItem keeps the weight of one unit
    weight: Number(row.quantity) ? (Number(row.weight) || 0) / Number(row.quantity) : 0,
    series: row.series,
  }))
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type TransferLineInput = { key?: string; product?: string; quantity: number; price?: number; series?: string }

export type TransferInput = {
  fromWarehouse: string
  toWarehouse: string
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" (local); '' = now. */
  createdAt: string
  /** "YYYY-MM-DD"; '' = today. */
  deliveredAt: string
  priceList: string
  currency: string
  organization: string
  invoiceNumber: string
  transportNumber: string
  driver: string
  comment: string
  /** 'ожидает' | 'потвержден' on save; create may also ask for 'в пути' / 'принят' (sent at once). */
  status: TransferStatus
  items: TransferLineInput[]
}

export type TransferError = { error: string; status: 400 | 404 | 409; shortages?: StockShortage[] }
export type TransferChange = Transfer | TransferError

export function isTransferError(value: unknown): value is TransferError {
  return Boolean(value) && typeof value === "object" && "error" in (value as object) && "status" in (value as object)
}

/** Thrown inside a transaction to roll it back with a response. */
class TransferAbort extends Error {
  constructor(readonly result: TransferError) {
    super(result.error)
  }
}

/** Local date-time of the moment of an action: the chosen day + the current time. */
function momentOf(day?: string): string {
  const now = nowLocalIso()
  return day && isIsoDay(day) ? `${day}${now.slice(10)}` : now
}

function createdMoment(value: string): string {
  const text = value.trim()
  if (!text) return nowLocalIso()
  if (isIsoDay(text)) return momentOf(text)
  return parseAnyDate(text) ?? nowLocalIso()
}

type NormalizedInput = Omit<TransferInput, "items"> & { items: TransferItem[]; amount: number; weight: number }

function normalize(input: TransferInput, index: CatalogIndex): NormalizedInput | TransferError {
  const fromWarehouse = input.fromWarehouse.trim()
  const toWarehouse = input.toWarehouse.trim()
  if (!fromWarehouse || !toWarehouse) return { error: "Склад не выбран", status: 400 }
  if (textKey(fromWarehouse) === textKey(toWarehouse)) return { error: "Склад отправитель и склад получатель должны отличаться", status: 400 }
  const deliveredAt = input.deliveredAt.trim() ? parseAnyDay(input.deliveredAt) : todayIso()
  if (!deliveredAt) return { error: "Неверная дата доставки", status: 400 }
  const items: TransferItem[] = []
  for (const line of input.items) {
    const quantity = round6(Number(line.quantity) || 0)
    if (!(quantity > 0)) continue
    const resolved = resolveLine(index, line)
    if (!resolved.name) continue
    if (!resolved.item && !String(line.key ?? "").startsWith("name:")) return { error: `Товар не найден: ${resolved.name}`, status: 400 }
    const price = round6(Math.max(0, Number(line.price) || 0))
    items.push({
      id: items.length + 1,
      key: resolved.key,
      product: resolved.name,
      article: resolved.item?.article ?? "",
      unit: resolved.item?.unit ?? "",
      quantity,
      price,
      weight: resolved.item?.weight ?? 0,
      series: String(line.series ?? "").trim(),
    })
  }
  if (!items.length) return { error: "Добавьте товары", status: 400 }
  return {
    ...input,
    fromWarehouse,
    toWarehouse,
    deliveredAt,
    createdAt: createdMoment(input.createdAt),
    items,
    amount: round6(items.reduce((sum, item) => sum + item.quantity * item.price, 0)),
    weight: round6(items.reduce((sum, item) => sum + item.quantity * item.weight, 0)),
  }
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

async function addLog(tx: PgDb, transfer: Transfer, action: TransferLogAction, userName: string, comment = "") {
  await tx
    .prepare(
      `INSERT INTO internal_transfer_logs (transfer_id, action, status, from_warehouse, to_warehouse, comment, currency, items, user_name, created_at)
       VALUES (@id, @action, @status, @from, @to, @comment, @currency, @items, @user, @at)`,
    )
    .run({
      id: transfer.id,
      action,
      status: transfer.status,
      from: transfer.fromWarehouse,
      to: transfer.toWarehouse,
      comment: comment.trim(),
      currency: transfer.currency,
      items: JSON.stringify(transfer.items),
      user: userName,
      at: nowLocalIso(),
    })
}

export async function listTransferLogs(id: number): Promise<TransferLog[]> {
  await ensureTransfersSchema()
  const rows = (await getDb().prepare("SELECT * FROM internal_transfer_logs WHERE transfer_id = @id ORDER BY id").all({ id })) as Array<{
    id: number
    action: string
    status: string
    from_warehouse: string
    to_warehouse: string
    comment: string
    currency: string
    items: string
    user_name: string
    created_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    action: row.action as TransferLogAction,
    status: statusOf(row.status),
    userName: row.user_name,
    fromWarehouse: row.from_warehouse,
    toWarehouse: row.to_warehouse,
    comment: row.comment,
    currency: row.currency,
    items: parseItems(row.items),
    createdAt: row.created_at,
  }))
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

const LOG_OF: Record<TransferAction, TransferLogAction> = {
  approve: "approved",
  give: "given",
  cancel_given: "cancel_given",
  accept: "accepted",
  cancel_accepted: "cancel_accepted",
  cancel: "canceled",
}

export type ActionOptions = { comment?: string; date?: string }

/** One transition on a locked transfer (inside a transaction). */
async function applyAction(tx: PgDb, current: Transfer, action: TransferAction, options: ActionOptions, userName: string, index?: CatalogIndex): Promise<Transfer> {
  const transition = TRANSFER_TRANSITIONS[action]
  if (!transition.from.includes(current.status)) {
    throw new TransferAbort({ error: `Действие недоступно для текущего статуса передачи (${current.status})`, status: 409 })
  }
  if (options.date && !isIsoDay(options.date)) throw new TransferAbort({ error: "Неверная дата", status: 400 })
  const moment = momentOf(options.date)
  const set: Record<string, string> = { status: transition.to }
  if (action === "give") {
    await lockWarehouseStock(tx, [current.fromWarehouse])
    const stock = await warehouseStock(current.fromWarehouse, moment.slice(0, 10), tx)
    const shortages = findShortages(current.items, index ?? (await catalogIndex(tx)), stock)
    if (shortages.length) throw new TransferAbort({ error: shortageMessage(current.fromWarehouse, shortages), status: 409, shortages })
    Object.assign(set, { given_at: moment, given_by: userName })
  } else if (action === "accept") {
    const givenDay = current.givenAt.slice(0, 10)
    if (givenDay && moment.slice(0, 10) < givenDay) throw new TransferAbort({ error: "Дата приемки не может быть раньше даты передачи", status: 400 })
    Object.assign(set, { accepted_at: moment, accepted_by: userName })
  } else if (action === "cancel_accepted") {
    // The goods leave the target again: it must still have them.
    await lockWarehouseStock(tx, [current.toWarehouse])
    const stock = await warehouseStock(current.toWarehouse, current.acceptedAt.slice(0, 10) || undefined, tx)
    const shortages = findShortages(current.items, index ?? (await catalogIndex(tx)), stock)
    if (shortages.length) {
      throw new TransferAbort({ error: `Не возможно отменить. ${shortageMessage(current.toWarehouse, shortages)}`, status: 409, shortages })
    }
    Object.assign(set, { accepted_at: "", accepted_by: "" })
  } else if (action === "cancel_given") {
    Object.assign(set, { given_at: "", given_by: "" })
  } else if (action === "cancel") {
    Object.assign(set, { cancelled_at: moment, cancelled_by: userName })
  }
  const columns = Object.keys(set)
  await tx
    .prepare(`UPDATE internal_transfers SET ${columns.map((column) => `${column} = @${column}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...set, id: current.id })
  const updated = (await getTransfer(current.id, tx))!
  await addLog(tx, updated, LOG_OF[action], userName, options.comment ?? "")
  return updated
}

async function lockTransfer(tx: PgDb, id: number): Promise<Transfer | null> {
  const row = (await tx.prepare("SELECT * FROM internal_transfers WHERE id = @id FOR UPDATE").get({ id })) as TransferRow | undefined
  return row ? rowToTransfer(row) : null
}

async function inTransaction(fn: (tx: PgDb) => Promise<Transfer | TransferError>): Promise<TransferChange> {
  try {
    return await withTransaction(fn)
  } catch (error) {
    if (error instanceof TransferAbort) return error.result
    throw error
  }
}

/** POST /api/internal-transfers/[id]/action. */
export async function transferAction(id: number, action: TransferAction, options: ActionOptions, userName: string): Promise<TransferChange> {
  await ensureTransfersSchema()
  return inTransaction(async (tx) => {
    const current = await lockTransfer(tx, id)
    if (!current) return { error: "Передача не найдена", status: 404 }
    return applyAction(tx, current, action, options, userName)
  })
}

/** Transitions that take a freshly saved transfer to the requested status. */
function pathTo(status: TransferStatus): TransferAction[] {
  if (status === "в пути") return ["give"]
  if (status === "принят") return ["give", "accept"]
  return []
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

const COLUMNS = {
  from_warehouse: "fromWarehouse",
  to_warehouse: "toWarehouse",
  created_at_label: "createdAt",
  delivered_at: "deliveredAt",
  amount: "amount",
  weight: "weight",
  price_list: "priceList",
  currency: "currency",
  organization: "organization",
  invoice_number: "invoiceNumber",
  transport_number: "transportNumber",
  driver: "driver",
  comment: "comment",
} as const

function values(input: NormalizedInput) {
  const out: Record<string, unknown> = {}
  for (const [column, field] of Object.entries(COLUMNS)) out[column] = input[field]
  out.items = JSON.stringify(input.items)
  return out
}

export async function createTransfer(input: TransferInput, userName: string): Promise<TransferChange> {
  await ensureTransfersSchema()
  const index = await catalogIndex()
  const data = normalize(input, index)
  if (isTransferError(data)) return data
  if (input.status === "отменен") return { error: "Нельзя создать отмененную передачу", status: 400 }
  const initial: TransferStatus = input.status === "ожидает" ? "ожидает" : "потвержден"
  return inTransaction(async (tx) => {
    const row = values(data)
    const columns = [...Object.keys(row), "status", "created_by", "updated_at"]
    const result = await tx
      .prepare(`INSERT INTO internal_transfers (${columns.join(", ")}) VALUES (${columns.map((column) => (column === "updated_at" ? "datetime('now')" : `@${column}`)).join(", ")})`)
      .run({ ...row, status: initial, created_by: userName })
    let transfer = (await getTransfer(Number(result.lastInsertRowid), tx))!
    await addLog(tx, transfer, "created", userName)
    for (const action of pathTo(input.status)) transfer = await applyAction(tx, transfer, action, {}, userName, index)
    return transfer
  })
}

export async function updateTransfer(id: number, input: TransferInput, userName: string): Promise<TransferChange> {
  await ensureTransfersSchema()
  const data = normalize(input, await catalogIndex())
  if (isTransferError(data)) return data
  return inTransaction(async (tx) => {
    const current = await lockTransfer(tx, id)
    if (!current) return { error: "Передача не найдена", status: 404 }
    if (!TRANSFER_EDITABLE.includes(current.status)) {
      return { error: "Изменять можно только передачу в статусе «ожидает» или «потвержден»", status: 409 }
    }
    const status: TransferStatus = input.status === "ожидает" ? "ожидает" : input.status === "потвержден" ? "потвержден" : current.status
    const row = values(data)
    const columns = [...Object.keys(row), "status"]
    await tx.prepare(`UPDATE internal_transfers SET ${columns.map((column) => `${column} = @${column}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`).run({ ...row, status, id })
    const updated = (await getTransfer(id, tx))!
    await addLog(tx, updated, "updated", userName)
    return updated
  })
}

/** Hard delete of a transfer without stock effect (the UI cancels instead). */
export async function deleteTransfer(id: number): Promise<"ok" | "not_found" | "locked"> {
  await ensureTransfersSchema()
  const current = await getTransfer(id)
  if (!current) return "not_found"
  if (current.status === "в пути" || current.status === "принят") return "locked"
  await getDb().prepare("DELETE FROM internal_transfers WHERE id = @id").run({ id })
  return "ok"
}
