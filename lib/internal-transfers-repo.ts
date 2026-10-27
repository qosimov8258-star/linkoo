import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { isIsoDay, nowLocalIso, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { costsInWarehouse, getWarehouseItemCosts } from "@/lib/stock/costs"
import { getStockBalances } from "@/lib/stock/ledger"
import { nowLocalMoment } from "@/lib/stock/moments"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  catalogIndex,
  countedByInventory,
  findShortages,
  findWarehouse,
  lockWarehouseStock,
  resolveLine,
  round6,
  shortageMessage,
  textKey,
  warehouseStock,
  type CatalogIndex,
  type WarehouseRef,
} from "@/lib/internal-transfers-stock"
import {
  TRANSFER_EDITABLE,
  TRANSFER_STATUSES,
  TRANSFER_TRANSITIONS,
  unitWeightKg,
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
// the source warehouse lacks the goods (stock core balances). Both warehouses
// must be registered (Склады) and active for new movements; action dates
// cannot be in the future; a give / accept a confirmed inventory already
// counted cannot be undone. Without a price list the lines are valued at the
// cost of goods (lib/stock/costs.ts) when the goods leave, so transfers between
// branches reach the branch balances.

/** Contract 3 bounds. */
export const MAX_TRANSFER_QTY = 1e9
export const MAX_TRANSFER_PRICE = 1e13

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
        ALTER TABLE transfer_reference_items ADD COLUMN IF NOT EXISTS box_label TEXT NOT NULL DEFAULT '';
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'internal_transfers' AND column_name = 'amount' AND data_type = 'real') THEN
            ALTER TABLE internal_transfers ALTER COLUMN amount TYPE double precision;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'internal_transfers' AND column_name = 'weight' AND data_type = 'real') THEN
            ALTER TABLE internal_transfers ALTER COLUMN weight TYPE double precision;
          END IF;
        END $$;
      `)
      try {
        await valueUnpricedTransfers()
      } catch (error) {
        // Valuing old rows must never block the module; it is retried by the next process.
        console.error("internal transfers: valuing transfers without a price list", error)
      }
    })().catch((error) => {
      globalThis.__linkoTransfersSchemaV2 = undefined
      throw error
    })
  }
  await globalThis.__linkoTransfersSchemaV2
}

/** Transfers that left without a price list before they were valued at cost (amount 0):
 * their lines get the cost of goods of the day they were given (one-time, idempotent:
 * only rows that still have no value). */
async function valueUnpricedTransfers(): Promise<void> {
  const db = getDb()
  const rows = (await db
    .prepare(
      `SELECT id, from_warehouse, items, given_at, created_at_label, created_at FROM internal_transfers
       WHERE status IN ('в пути', 'принят') AND btrim(COALESCE(price_list, '')) = '' AND COALESCE(amount, 0) = 0`,
    )
    .all()) as Array<{ id: number; from_warehouse: string; items: string; given_at: string; created_at_label: string; created_at: string }>
  if (!rows.length) return
  const index = await catalogIndex(db)
  const costsByDay = new Map<string, Awaited<ReturnType<typeof getWarehouseItemCosts>>>()
  for (const row of rows) {
    const day = parseAnyDay(row.given_at) ?? parseAnyDay(row.created_at_label) ?? parseAnyDay(row.created_at, true) ?? todayIso()
    let costs = costsByDay.get(day)
    if (!costs) costsByDay.set(day, (costs = await getWarehouseItemCosts({ date: day }, db)))
    const items = priceAtCost(parseItems(row.items), index, costsInWarehouse(costs, row.from_warehouse))
    const amount = round6(items.reduce((sum, item) => sum + item.quantity * item.price, 0))
    if (amount > 0) {
      await db.prepare("UPDATE internal_transfers SET items = @items, amount = @amount WHERE id = @id AND COALESCE(amount, 0) = 0").run({ id: row.id, items: JSON.stringify(items), amount })
    }
  }
}

/** The lines of a transfer without a price list, valued at the cost of goods (`priced: "cost"`). */
function priceAtCost(items: TransferItem[], index: CatalogIndex, costs: Map<string, number>): TransferItem[] {
  return items.map((item) => {
    const key = index.byKey.has(item.key) ? item.key : resolveLine(index, { key: item.key, product: item.product }).key
    // Брак carries no value.
    return { ...item, price: item.defect ? 0 : round6(costs.get(key) ?? 0), priced: "cost" as const }
  })
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

export function parseItems(text: string): TransferItem[] {
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
      // Lines saved before kg goods had a weight: the unit implies it.
      weight: unitWeightKg(String(line.unit ?? ""), Number(line.weight) || 0),
      series: String(line.series ?? ""),
      ...(line.defect === true ? { defect: true } : {}),
      ...(line.priced === "cost" ? { priced: "cost" as const } : {}),
    }))
}

const statusOf = (value: string): TransferStatus => ((TRANSFER_STATUSES as string[]).includes(value) ? (value as TransferStatus) : "ожидает")

/** Local "YYYY-MM-DDTHH:mm:ss" of a stored date text ('' when unparseable). */
const localIso = (value: string, utc = false) => (value ? (parseAnyDate(value, utc) ?? value) : "")

export function rowToTransfer(row: TransferRow): Transfer {
  const items = parseItems(row.items)
  const storedWeight = Number(row.weight) || 0
  return {
    id: row.id,
    fromWarehouse: row.from_warehouse,
    toWarehouse: row.to_warehouse,
    createdBy: row.created_by,
    createdAt: localIso(row.created_at_label) || localIso(row.created_at, true),
    deliveredAt: parseAnyDay(row.delivered_at) ?? row.delivered_at,
    amount: round6(Number(row.amount) || 0),
    weight: round6(storedWeight || items.reduce((sum, item) => sum + item.quantity * item.weight, 0)),
    status: statusOf(row.status),
    priceList: row.price_list,
    currency: row.currency ?? "",
    organization: row.organization,
    invoiceNumber: row.invoice_number,
    transportNumber: row.transport_number,
    driver: row.driver,
    comment: row.comment,
    items,
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
    .prepare("SELECT product, article, unit, quantity, weight, price, series, box_label FROM transfer_reference_items WHERE transfer_id = @id ORDER BY position, id")
    .all({ id })) as Array<{ product: string; article: string; unit: string; quantity: number; weight: number; price: number; series: string; box_label: string }>
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
    boxLabel: row.box_label || undefined,
  }))
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type TransferLineInput = { key?: string; product?: string; quantity: number; price?: number; series?: string; defect?: boolean }

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

export type TransferError = { error: string; status: 400 | 404 | 409; shortages?: StockShortage[]; field?: string }
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

/** Local date-time of the moment of an action (milliseconds: the cost ledger orders the
 * day's movements by it): now, or the end of an earlier chosen day (a back-dated action
 * happened some time that day: after its other movements). */
function momentOf(day?: string): string {
  const now = nowLocalMoment()
  if (!day || !isIsoDay(day) || day >= now.slice(0, 10)) return now
  return `${day}T23:59:59`
}

function createdMoment(value: string): string {
  const text = value.trim()
  if (!text) return nowLocalMoment()
  if (isIsoDay(text)) return momentOf(text)
  return parseAnyDate(text) ?? nowLocalIso()
}

type NormalizedInput = Omit<TransferInput, "items"> & { items: TransferItem[]; amount: number; weight: number }

/** A warehouse of a document: registered, and active unless it is the one the edited document already has. */
async function documentWarehouse(db: PgDb, name: string, keep: string | undefined, field: string): Promise<WarehouseRef | TransferError> {
  const found = await findWarehouse(db, name)
  if (!found) return { error: "Склад не найден", status: 400, field }
  if (!found.active && !(keep !== undefined && textKey(keep) === textKey(found.name))) return { error: "Склад неактивен", status: 400, field }
  return found
}

/** Non-catalog ("name:") keys the source warehouse's ledger has (legacy document names), plus the edited document's. */
async function movableOrphans(db: PgDb, warehouse: string, current?: Transfer): Promise<Set<string>> {
  const keys = new Set<string>()
  const wanted = textKey(warehouse)
  for (const row of await getStockBalances({ warehouses: [warehouse] }, db)) if (row.key.startsWith("name:") && textKey(row.warehouse) === wanted) keys.add(row.key)
  for (const item of current?.items ?? []) if (item.key.startsWith("name:")) keys.add(`name:${textKey(item.key.slice(5))}`)
  return keys
}

async function normalize(db: PgDb, input: TransferInput, index: CatalogIndex, current?: Transfer): Promise<NormalizedInput | TransferError> {
  if (!input.fromWarehouse.trim() || !input.toWarehouse.trim()) return { error: "Склад не выбран", status: 400 }
  const from = await documentWarehouse(db, input.fromWarehouse, current?.fromWarehouse, "fromWarehouse")
  if (isTransferError(from)) return from
  const to = await documentWarehouse(db, input.toWarehouse, current?.toWarehouse, "toWarehouse")
  if (isTransferError(to)) return to
  const fromWarehouse = from.name
  const toWarehouse = to.name
  if (textKey(fromWarehouse) === textKey(toWarehouse)) return { error: "Склад отправитель и склад получатель должны отличаться", status: 400 }
  const deliveredAt = input.deliveredAt.trim() ? parseAnyDay(input.deliveredAt) : todayIso()
  if (!deliveredAt) return { error: "Неверная дата доставки", status: 400 }
  if (!input.items.length) return { error: "Добавьте товары", status: 400, field: "items" }
  let orphans: Set<string> | null = null
  const items: TransferItem[] = []
  for (const [position, line] of input.items.entries()) {
    const field = `items.${position}`
    if (!String(line.key ?? "").trim() && !String(line.product ?? "").trim()) return { error: "Выберите товар", status: 400, field: `${field}.key` }
    const quantity = round6(Number(line.quantity))
    if (!Number.isFinite(Number(line.quantity)) || !(quantity > 0)) return { error: "Количество должно быть больше 0", status: 400, field: `${field}.quantity` }
    if (quantity > MAX_TRANSFER_QTY) return { error: "Слишком большое количество", status: 400, field: `${field}.quantity` }
    const rawPrice = Number(line.price ?? 0)
    if (!Number.isFinite(rawPrice) || rawPrice < 0 || rawPrice > MAX_TRANSFER_PRICE) return { error: "Неверная цена", status: 400, field: `${field}.price` }
    const resolved = resolveLine(index, line)
    let key = resolved.key
    if (!resolved.item) {
      // Only goods the source already holds under a legacy document name may move by name.
      key = `name:${textKey(key.startsWith("name:") ? key.slice(5) : resolved.name)}`
      orphans ??= await movableOrphans(db, fromWarehouse, current)
      if (!resolved.name || key === "name:" || !orphans.has(key)) return { error: "Товар не найден", status: 400, field: `${field}.key` }
    }
    items.push({
      id: items.length + 1,
      key,
      product: resolved.name,
      article: resolved.item?.article ?? "",
      unit: resolved.item?.unit ?? "",
      quantity,
      price: round6(rawPrice),
      weight: unitWeightKg(resolved.item?.unit ?? "", resolved.item?.weight ?? 0),
      series: String(line.series ?? "").trim(),
      ...(line.defect ? { defect: true } : {}),
    })
  }
  const createdAt = createdMoment(input.createdAt)
  // Without a price list the lines are valued at the cost of goods (re-valued when given).
  const priced = input.priceList.trim()
    ? items
    : priceAtCost(items, index, costsInWarehouse(await getWarehouseItemCosts({ date: createdAt.slice(0, 10) }, db), fromWarehouse))
  return {
    ...input,
    fromWarehouse,
    toWarehouse,
    deliveredAt,
    createdAt,
    items: priced,
    amount: round6(priced.reduce((sum, item) => sum + item.quantity * item.price, 0)),
    weight: round6(priced.reduce((sum, item) => sum + item.quantity * item.weight, 0)),
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
  if (options.date && !isIsoDay(options.date)) throw new TransferAbort({ error: "Неверная дата", status: 400, field: "date" })
  if (options.date && options.date > todayIso()) throw new TransferAbort({ error: "Дата не может быть позже сегодняшнего дня", status: 400, field: "date" })
  const moment = momentOf(options.date)
  const set: Record<string, string | number> = { status: transition.to }
  /** The movement must not touch an inactive warehouse (closed to new movements). */
  const requireActive = async (names: string[]) => {
    for (const name of names) {
      const found = await findWarehouse(tx, name)
      if (!found) throw new TransferAbort({ error: "Склад не найден", status: 400 })
      if (!found.active) throw new TransferAbort({ error: "Склад неактивен", status: 400 })
    }
  }
  /** A confirmed inventory already counted the movement: undoing it would break the count. */
  const requireUncounted = async (warehouse: string, at: string) => {
    if (await countedByInventory(tx, warehouse, at.slice(0, 10), at)) throw new TransferAbort({ error: "Отменение невозможно из-за связи с другими данными", status: 409 })
  }
  if (action === "give") {
    await requireActive([current.fromWarehouse, current.toWarehouse])
    await lockWarehouseStock(tx, [current.fromWarehouse])
    const catalog = index ?? (await catalogIndex(tx))
    const stock = await warehouseStock(current.fromWarehouse, moment.slice(0, 10), tx)
    const shortages = findShortages(current.items, catalog, stock)
    if (shortages.length) throw new TransferAbort({ error: shortageMessage(current.fromWarehouse, shortages), status: 409, shortages })
    Object.assign(set, { given_at: moment, given_by: userName })
    if (!current.priceList.trim()) {
      // Valued at the cost of goods of the moment the goods leave.
      const items = priceAtCost(current.items, catalog, new Map([...stock].map(([key, item]) => [key, item.cost])))
      Object.assign(set, { items: JSON.stringify(items), amount: round6(items.reduce((sum, item) => sum + item.quantity * item.price, 0)) })
    }
  } else if (action === "accept") {
    await requireActive([current.toWarehouse])
    const givenDay = current.givenAt.slice(0, 10)
    if (givenDay && moment.slice(0, 10) < givenDay) throw new TransferAbort({ error: "Дата приемки не может быть раньше даты передачи", status: 400, field: "date" })
    Object.assign(set, { accepted_at: moment < current.givenAt ? current.givenAt : moment, accepted_by: userName })
  } else if (action === "cancel_accepted") {
    await requireUncounted(current.toWarehouse, current.acceptedAt)
    // The goods leave the target again: it must still have them.
    await lockWarehouseStock(tx, [current.toWarehouse])
    const stock = await warehouseStock(current.toWarehouse, current.acceptedAt.slice(0, 10) || undefined, tx)
    const shortages = findShortages(current.items, index ?? (await catalogIndex(tx)), stock)
    if (shortages.length) {
      throw new TransferAbort({ error: `Не возможно отменить. ${shortageMessage(current.toWarehouse, shortages)}`, status: 409, shortages })
    }
    Object.assign(set, { accepted_at: "", accepted_by: "" })
  } else if (action === "cancel_given") {
    await requireUncounted(current.fromWarehouse, current.givenAt)
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
  const db = getDb()
  const index = await catalogIndex(db)
  const data = await normalize(db, input, index)
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
  const db = getDb()
  const before = await getTransfer(id, db)
  if (!before) return { error: "Передача не найдена", status: 404 }
  const data = await normalize(db, input, await catalogIndex(db), before)
  if (isTransferError(data)) return data
  return inTransaction(async (tx) => {
    const current = await lockTransfer(tx, id)
    if (!current) return { error: "Передача не найдена", status: 404 }
    if (!TRANSFER_EDITABLE.includes(current.status)) {
      return { error: "Изменять можно только передачу в статусе «ожидает» или «подтвержден»", status: 409 }
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
  // The status is read from the locked row, so a delete racing "give" can never
  // wipe a transfer that has just gone in transit.
  return withTransaction(async (tx) => {
    const locked = (await tx.prepare("SELECT status FROM internal_transfers WHERE id = @id FOR UPDATE").get({ id })) as { status: string } | undefined
    if (!locked) return "not_found"
    if (locked.status === "в пути" || locked.status === "принят") return "locked"
    await tx.prepare("DELETE FROM internal_transfers WHERE id = @id").run({ id })
    return "ok"
  })
}
