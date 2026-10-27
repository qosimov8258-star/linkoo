import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { getProductionDb, itemKey, nowIso, ProductionError, round, textKey, type ItemKind } from "@/lib/production-schema"
import { lockWarehousesOf, lockWarehouseStock } from "@/lib/internal-transfers-stock"
import { assertMovementDay, assertWarehouseOpen, ensureAvailable, itemCosts, requireCatalogItem, type CatalogItem, type StockNeed } from "@/lib/production-stock"
import { getRecipe, getStage } from "@/lib/production-stages-repo"
import { documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"

export type PartyStatus = "pending" | "finished" | "cancelled"

export type ProductionParty = {
  id: number
  stageId: number | null
  stageName: string
  warehouse: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
}

export type ProductionMovement = {
  id: number
  partyId: number | null
  stageId: number | null
  direction: "made" | "raw" | "adjust"
  key: string
  name: string
  unit: string
  amount: number
  cost: number
  total: number
  isDefect: boolean
  comment: string
  image: string
  date: string
  shift: string
  equipmentId: number | null
  equipmentName: string
  worker: string
  userName: string
  createdAt: string
}

export type SummaryLine = { key: string; name: string; unit: string; amount: number; cost: number; total: number }

export type PartyDetail = ProductionParty & {
  made: ProductionMovement[]
  raw: ProductionMovement[]
  madeDefects: ProductionMovement[]
  rawDefects: ProductionMovement[]
  totalMade: SummaryLine[]
  /** Everything the batch consumed, spoiled raw material included. */
  totalRaw: SummaryLine[]
  /** Value of everything consumed = value of the good output (brak carries no value). */
  totalRawCost: number
}

type PartyRow = {
  id: number
  stage_id: number | null
  stage_name: string
  warehouse: string | null
  date: string
  comment: string
  status: string
  user_name: string
  created_at: string
  finished_at: string
}

export type MovementRow = {
  id: number
  party_id: number | null
  stage_id: number | null
  direction: string
  item_kind: string
  item_id: number
  item_name: string
  unit: string
  amount: number
  cost: number
  is_defect: number
  comment: string
  image: string
  date: string
  shift: string
  equipment_id: number | null
  equipment_name: string | null
  worker: string
  user_name: string
  created_at: string
}

const toStatus = (value: string): PartyStatus => (value === "finished" || value === "cancelled" ? value : "pending")

const toParty = (row: PartyRow): ProductionParty => ({
  id: row.id,
  stageId: row.stage_id,
  stageName: row.stage_name,
  warehouse: row.warehouse ?? "",
  date: row.date,
  comment: row.comment,
  status: toStatus(row.status),
  userName: row.user_name,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
})

export const toMovement = (row: MovementRow): ProductionMovement => ({
  id: row.id,
  partyId: row.party_id,
  stageId: row.stage_id,
  direction: row.direction === "made" ? "made" : row.direction === "adjust" ? "adjust" : "raw",
  key: itemKey(row.item_kind, row.item_id),
  name: row.item_name,
  unit: row.unit,
  amount: row.amount,
  cost: row.cost,
  total: round(row.amount * row.cost, 6),
  isDefect: row.is_defect === 1,
  comment: row.comment,
  image: row.image,
  date: row.date,
  shift: row.shift,
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name ?? "",
  worker: row.worker,
  userName: row.user_name,
  createdAt: row.created_at,
})

// A batch moves stock in the warehouse stored on it at creation (the stage's
// warehouse may change later); batches older than that column fall back to
// the stage's warehouse.
const PARTY_SELECT = `
  SELECT p.id, p.stage_id, p.stage_name, COALESCE(NULLIF(p.warehouse, ''), s.warehouse, '') AS warehouse,
         p.date, p.comment, p.status, p.user_name, p.created_at, p.finished_at
  FROM production_parties p LEFT JOIN production_stages s ON s.id = p.stage_id`

export const MOVEMENT_SELECT = `
  SELECT m.*, e.name AS equipment_name
  FROM production_movements m LEFT JOIN production_equipment e ON e.id = m.equipment_id`

export type PartyFilters = {
  status?: string
  search?: string
  stageId?: number
  madeKey?: string
  rawKey?: string
  dateFrom?: string
  dateTo?: string
  finishedFrom?: string
  finishedTo?: string
}

export async function listParties(filters: PartyFilters = {}): Promise<ProductionParty[]> {
  const db = await getProductionDb()
  const where: string[] = []
  const params: unknown[] = []
  if (filters.status) {
    where.push("p.status = ?")
    params.push(filters.status)
  }
  if (filters.stageId) {
    where.push("p.stage_id = ?")
    params.push(filters.stageId)
  }
  if (filters.dateFrom) {
    where.push("p.date >= ?")
    params.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    where.push("p.date <= ?")
    params.push(filters.dateTo)
  }
  // ISO instants of the viewer's local day bounds, so "finished on the 8th"
  // means the 8th in their time zone, not in UTC.
  if (filters.finishedFrom) {
    where.push("p.finished_at <> '' AND p.finished_at >= ?")
    params.push(filters.finishedFrom)
  }
  if (filters.finishedTo) {
    where.push("p.finished_at <> '' AND p.finished_at <= ?")
    params.push(filters.finishedTo)
  }
  for (const [key, direction] of [[filters.madeKey, "made"], [filters.rawKey, "raw"]] as const) {
    const [kind, id] = (key ?? "").split(":")
    if (!kind || !Number(id)) continue
    where.push("EXISTS (SELECT 1 FROM production_movements m WHERE m.party_id = p.id AND m.direction = ? AND m.item_kind = ? AND m.item_id = ?)")
    params.push(direction, kind, Number(id))
  }
  const search = filters.search?.trim()
  if (search) {
    where.push("(CAST(p.id AS TEXT) = ? OR p.stage_name ILIKE ? OR p.user_name ILIKE ? OR p.comment ILIKE ?)")
    params.push(search, `%${search}%`, `%${search}%`, `%${search}%`)
  }
  const sql = `${PARTY_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC`
  return ((await db.prepare(sql).all(...params)) as PartyRow[]).map(toParty)
}

export async function getParty(id: number): Promise<ProductionParty | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${PARTY_SELECT} WHERE p.id = ?`).get(id)) as PartyRow | undefined
  return row ? toParty(row) : null
}

function summarize(rows: ProductionMovement[]): SummaryLine[] {
  const lines = new Map<string, SummaryLine>()
  for (const row of rows) {
    const line = lines.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, amount: 0, cost: 0, total: 0 }
    line.amount = round(line.amount + row.amount)
    line.total = round(line.total + row.total, 6)
    line.cost = line.amount ? round(line.total / line.amount, 6) : row.cost
    lines.set(row.key, line)
  }
  return Array.from(lines.values())
}

/** The cost of each line as the cost ledger moved it (lib/stock/costs.ts, the one cost
 * of goods): raw lines at the average they were issued at, a batch's good output at the
 * value of everything the batch consumed ÷ its good units, shift output at its recipe
 * norms × the components' averages of its day — so a later change of a raw material's
 * average (back-dated receipt, expense on an accepted supply) shows here too. Lines the
 * ledger did not move (a cancelled batch) keep the cost booked when they were added. */
export async function withLedgerCosts(db: PgDb, rows: ProductionMovement[]): Promise<ProductionMovement[]> {
  if (!rows.length) return rows
  const index = documentLineValues(await loadCostLedger(db))
  return rows.map((row) => {
    const unit = documentLineUnit(index, "production_movements", row.id, row.key)
    if (unit === undefined) return row
    const cost = round(unit, 6)
    return { ...row, cost, total: round(row.amount * cost, 6) }
  })
}

export async function getPartyDetail(id: number): Promise<PartyDetail | null> {
  const party = await getParty(id)
  if (!party) return null
  const db = await getProductionDb()
  const booked = ((await db.prepare(`${MOVEMENT_SELECT} WHERE m.party_id = ? ORDER BY m.id DESC`).all(id)) as MovementRow[]).map(toMovement)
  const movements = await withLedgerCosts(db, booked)
  const made = movements.filter((row) => row.direction === "made" && !row.isDefect)
  const raw = movements.filter((row) => row.direction === "raw" && !row.isDefect)
  const rawDefects = movements.filter((row) => row.direction === "raw" && row.isDefect)
  const consumed = [...raw, ...rawDefects]
  return {
    ...party,
    made,
    raw,
    madeDefects: movements.filter((row) => row.direction === "made" && row.isDefect),
    rawDefects,
    totalMade: summarize(made),
    totalRaw: summarize(consumed),
    totalRawCost: round(consumed.reduce((sum, row) => sum + row.total, 0), 6),
  }
}

export type CreatePartyResult = ProductionParty | "stage_not_found"

export async function createParty(input: { stageId: number; date: string; comment: string }, userName: string): Promise<CreatePartyResult> {
  const stage = await getStage(input.stageId)
  if (!stage) return "stage_not_found"
  assertMovementDay(input.date)
  const db = await getProductionDb()
  await assertWarehouseOpen(db, stage.warehouse)
  const result = await db
    .prepare("INSERT INTO production_parties (stage_id, stage_name, warehouse, date, comment, status, user_name, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
    .run(stage.id, stage.name, stage.warehouse, input.date, input.comment, userName, nowIso())
  return (await getParty(result.lastInsertRowid))!
}

export type PartyUpdateResult = ProductionParty | "not_found" | "stage_not_found" | "stage_locked"

/** Allowed status changes: a running batch can be finished or cancelled; a
 * finished one can only be cancelled; a cancelled one is final. */
const TRANSITIONS: Record<PartyStatus, PartyStatus[]> = {
  pending: ["finished", "cancelled"],
  finished: ["cancelled"],
  cancelled: [],
}

type PartyLine = { direction: string; item_kind: string; item_id: number; item_name: string; unit: string; amount: number; is_defect: number; warehouse: string; date: string }

/** Refusal of finishing a batch whose good output consumed no raw material. */
export const NO_RAW_ERROR = "В партии нет сырья — завершить ее нельзя"

/** A batch can only be finished when its good output was made from something: good
 * output without a single raw line would bring goods in from nothing (the cost ledger
 * then takes them in at the average, never at a cost of 0). Brak-only batches carry
 * no value and may be finished. */
function assertConsumed(lines: Array<Pick<PartyLine, "direction" | "amount" | "is_defect">>) {
  const good = lines.reduce((sum, line) => sum + (line.direction === "made" && Number(line.is_defect) !== 1 ? Number(line.amount) || 0 : 0), 0)
  if (good > 0 && !lines.some((line) => line.direction === "raw")) throw new ProductionError(409, NO_RAW_ERROR)
}

async function partyLines(db: PgDb, partyId: number): Promise<PartyLine[]> {
  return (await db
    .prepare("SELECT direction, item_kind, item_id, item_name, unit, amount, is_defect, warehouse, date FROM production_movements WHERE party_id = ? ORDER BY id")
    .all(partyId)) as PartyLine[]
}

/** Cancelling takes the batch's output (good and defective units) back out of
 * the warehouse and returns its raw materials, so the output must still be there. */
async function ensureCancellable(db: PgDb, lines: PartyLine[]) {
  const byWarehouse = new Map<string, { warehouse: string; needs: StockNeed[] }>()
  for (const line of lines) {
    const amount = Number(line.amount) || 0
    // Raw lines (spoiled raw included) took good units; they come back.
    const qty = line.direction === "made" ? amount : line.direction === "raw" ? -amount : 0
    if (!qty) continue
    const group = byWarehouse.get(textKey(line.warehouse)) ?? { warehouse: line.warehouse, needs: [] }
    const defect = line.direction === "made" && line.is_defect === 1
    group.needs.push({ key: itemKey(line.item_kind, line.item_id), name: line.item_name, unit: line.unit, qty, date: line.date, defect })
    byWarehouse.set(textKey(line.warehouse), group)
  }
  for (const group of byWarehouse.values()) {
    if (textKey(group.warehouse)) await ensureAvailable(db, group.warehouse, group.needs, "Не возможно отменить. ")
  }
}

export async function updateParty(id: number, input: { stageId: number; status: PartyStatus; comment: string; date: string }): Promise<PartyUpdateResult> {
  const stage = await getStage(input.stageId)
  await getProductionDb()
  const result = await withTransaction(async (db) => {
    // Lock order (C1): cancelling moves stock in every warehouse the batch touched — their
    // stock locks (one sorted call) before the batch's row lock.
    if (input.status === "cancelled") await lockWarehousesOf(db, "SELECT DISTINCT warehouse FROM production_movements WHERE party_id = @id", { id })
    const current = await lockParty(db, id)
    if (!current) return "not_found" as const
    if (!stage) return "stage_not_found" as const
    const lines = await partyLines(db, id)
    const stageChanged = stage.id !== current.stageId
    // Movements were taken from / put into the old stage's warehouse.
    if (stageChanged && lines.length > 0) return "stage_locked" as const
    if (input.date !== current.date) {
      // The movements carry their own day (the ledger books them on it).
      if (lines.length > 0) throw new ProductionError(409, "В партии уже есть товары — дату изменить нельзя")
      assertMovementDay(input.date)
    }
    if (input.status !== current.status) {
      if (current.status === "cancelled") throw new ProductionError(409, "Партия отменена — изменить ее статус нельзя")
      if (!TRANSITIONS[current.status].includes(input.status)) throw new ProductionError(409, "Завершенную партию можно только отменить")
      if (input.status === "cancelled") await ensureCancellable(db, lines)
      if (input.status === "finished") assertConsumed(lines)
    }
    if (stageChanged) await assertWarehouseOpen(db, stage.warehouse)
    const warehouse = stageChanged ? stage.warehouse : current.warehouse
    const finishedAt = input.status === "finished" ? current.finishedAt || nowIso() : ""
    await db
      .prepare("UPDATE production_parties SET stage_id = ?, stage_name = ?, warehouse = ?, status = ?, comment = ?, date = ?, finished_at = ? WHERE id = ?")
      .run(stage.id, stage.name, warehouse, input.status, input.comment, input.date, finishedAt, id)
    return "ok" as const
  })
  return result === "ok" ? (await getParty(id))! : result
}

/** The value of everything the batch consumed (raw lines, spoiled raw
 * included) goes to its GOOD output; defective output (brak) carries no value,
 * exactly as the stock core and the cost ledger hold it. So a batch moves
 * value from raw materials to products without creating or losing any:
 * Σ good made value = Σ raw value. */
async function recalcPartyCost(db: PgDb, partyId: number) {
  const totals = (await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'raw' THEN amount * cost ELSE 0 END), 0) AS raw_cost,
         COALESCE(SUM(CASE WHEN direction = 'made' AND is_defect <> 1 THEN amount ELSE 0 END), 0) AS good_amount
       FROM production_movements WHERE party_id = ?`,
    )
    .get(partyId)) as { raw_cost: number; good_amount: number }
  const goodAmount = Number(totals.good_amount) || 0
  const unitCost = goodAmount > 0 ? (Number(totals.raw_cost) || 0) / goodAmount : 0
  await db
    .prepare("UPDATE production_movements SET cost = CASE WHEN is_defect = 1 THEN 0 ELSE CAST(? AS DOUBLE PRECISION) END WHERE party_id = ? AND direction = 'made'")
    .run(unitCost, partyId)
}

export type MovementItemInput = { kind: ItemKind; id: number; amount: number }
type MovementContext = {
  stageId: number | null
  partyId: number | null
  warehouse: string
  date: string
  userName: string
  shift?: string
  equipmentId?: number | null
  worker?: string
  inventoryId?: number | null
}

/** The cost of a shift entry's good output and the recipe norms it was costed with
 * (per unit of output), which the cost ledger re-values it by. */
export type MadeCost = { cost: number; basis?: Array<{ key: string; amount: number }> }

/** Inserts stock movements atomically (inside the caller's transaction):
 * every item must exist (404 otherwise, nothing is inserted); raw lines and
 * negative adjustments must fit the warehouse's available stock on every day
 * from the movement day on (business rule 8; 409 otherwise); raw / adjust lines are valued at
 * the shared cost of goods of that day; good made lines get `madeCost` (or the
 * batch recalculation that follows), defective made lines 0. The cost stored here
 * is the booking-time value: the cost ledger values every line again from its own
 * averages (see withLedgerCosts). */
export async function insertMovements(
  db: PgDb,
  context: MovementContext,
  direction: "made" | "raw" | "adjust",
  items: Array<MovementItemInput & { isDefect?: boolean; comment?: string; image?: string }>,
  madeCost?: (item: CatalogItem) => Promise<MadeCost>,
  shortagePrefix = "",
): Promise<number> {
  assertMovementDay(context.date)
  await assertWarehouseOpen(db, context.warehouse)
  const lines: Array<{ input: (typeof items)[number]; item: CatalogItem }> = []
  for (const input of items) {
    if (direction === "adjust" ? !input.amount : !(input.amount > 0)) continue
    lines.push({ input, item: await requireCatalogItem(db, input.kind, input.id) })
  }
  if (!lines.length) return 0
  const takes = lines.filter(({ input }) => direction === "raw" || (direction === "adjust" && input.amount < 0))
  if (takes.length) {
    await ensureAvailable(
      db,
      context.warehouse,
      takes.map(({ input, item }) => ({ key: item.key, name: item.name, unit: item.unit, qty: Math.abs(input.amount), date: context.date })),
      shortagePrefix,
    )
  }
  const costs = direction === "made" ? null : await itemCosts(db, context.date)
  for (const { input, item } of lines) {
    // Defective output (brak) carries no value.
    const made = !costs && !input.isDefect && madeCost ? await madeCost(item) : null
    const cost = costs ? costs.get(item.key) ?? 0 : made ? made.cost : 0
    const basis = made?.basis?.length ? JSON.stringify(made.basis) : null
    await db
      .prepare(
        `INSERT INTO production_movements
           (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect,
            comment, image, date, shift, equipment_id, worker, user_name, created_at, inventory_id, cost_basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.stageId,
        context.partyId,
        context.warehouse,
        direction,
        item.kind,
        item.id,
        item.name,
        item.unit,
        input.amount,
        Number.isFinite(cost) ? cost : 0,
        input.isDefect ? 1 : 0,
        input.comment ?? "",
        input.image ?? "",
        context.date,
        context.shift ?? "",
        context.equipmentId ?? null,
        context.worker ?? "",
        context.userName,
        nowIso(),
        context.inventoryId ?? null,
        basis,
      )
  }
  return lines.length
}

/** Reads the batch row with a row lock, so concurrent edits of one batch
 * (double-clicked "Подтвердить", parallel adds) apply one after another. */
async function lockParty(db: PgDb, partyId: number): Promise<ProductionParty | null> {
  const row = (await db.prepare(`${PARTY_SELECT} WHERE p.id = ? FOR UPDATE OF p`).get(partyId)) as PartyRow | undefined
  return row ? toParty(row) : null
}

async function lockPendingParty(db: PgDb, partyId: number, userName: string, date?: string): Promise<MovementContext | "not_found" | "not_pending"> {
  const party = await lockParty(db, partyId)
  if (!party) return "not_found"
  if (party.status !== "pending") return "not_pending"
  return { stageId: party.stageId, partyId, warehouse: party.warehouse, date: date || party.date, userName }
}

export type MovementResult = PartyDetail | "not_found" | "not_pending" | "empty"

/** Runs a batch mutation atomically against the locked, still-pending batch
 * and returns the refreshed detail. */
async function mutatePendingParty(
  partyId: number,
  userName: string,
  date: string | undefined,
  mutate: (db: PgDb, context: MovementContext) => Promise<"ok" | "empty" | "recipe_not_found">,
): Promise<MovementResult | "recipe_not_found"> {
  await getProductionDb()
  const result = await withTransaction(async (db) => {
    // Lock order (C1): raw lines take stock — the batch warehouse's stock lock before the batch's row lock.
    await lockWarehousesOf(
      db,
      "SELECT COALESCE(NULLIF(p.warehouse, ''), s.warehouse, '') AS warehouse FROM production_parties p LEFT JOIN production_stages s ON s.id = p.stage_id WHERE p.id = @id",
      { id: partyId },
    )
    const context = await lockPendingParty(db, partyId, userName, date)
    if (typeof context === "string") return context
    const outcome = await mutate(db, context)
    if (outcome === "ok") await recalcPartyCost(db, partyId)
    return outcome
  })
  return result === "ok" ? (await getPartyDetail(partyId))! : result
}

export async function addPartyItems(
  partyId: number,
  direction: "made" | "raw",
  input: { date?: string; items: MovementItemInput[] },
  userName: string,
): Promise<MovementResult> {
  const result = await mutatePendingParty(partyId, userName, input.date, async (db, context) =>
    (await insertMovements(db, context, direction, input.items)) ? "ok" : "empty",
  )
  return result === "recipe_not_found" ? "empty" : result
}

export async function addPartyDefect(
  partyId: number,
  input: { type: "made" | "raw"; kind: ItemKind; id: number; amount: number; comment: string; image: string; date?: string },
  userName: string,
): Promise<MovementResult> {
  const result = await mutatePendingParty(partyId, userName, input.date, async (db, context) => {
    const inserted = await insertMovements(db, context, input.type, [
      { kind: input.kind, id: input.id, amount: input.amount, isDefect: true, comment: input.comment, image: input.image },
    ])
    return inserted ? "ok" : "empty"
  })
  return result === "recipe_not_found" ? "empty" : result
}

/** "Автодобавление": records the product made plus the components consumed
 * for it and closes the batch, like the demo's party auto_finish. Like finishing by
 * hand, it needs at least one raw line in the batch (409 otherwise). */
export async function autoFinishParty(
  partyId: number,
  input: { recipeId: number; amount: number; comment: string; components: MovementItemInput[] },
  userName: string,
): Promise<MovementResult | "recipe_not_found"> {
  const recipe = await getRecipe(input.recipeId)
  const comment = input.comment.trim()
  return mutatePendingParty(partyId, userName, undefined, async (db, context) => {
    if (!recipe || recipe.stageId !== context.stageId) return "recipe_not_found"
    await insertMovements(db, context, "raw", input.components)
    await insertMovements(db, context, "made", [{ kind: recipe.kind, id: recipe.itemId, amount: input.amount, comment }])
    assertConsumed(await partyLines(db, partyId))
    await db.prepare("UPDATE production_parties SET status = 'finished', finished_at = ? WHERE id = ?").run(nowIso(), partyId)
    // The note is kept on the made line; it also becomes the batch comment
    // when the batch has none yet.
    if (comment) await db.prepare("UPDATE production_parties SET comment = ? WHERE id = ? AND comment = ''").run(comment, partyId)
    return "ok"
  })
}

/** Deletes one movement of a running batch or a shift entry. Inventory
 * adjustments belong to their inventory and cannot be deleted alone; removing
 * output requires it to be still in the warehouse. */
export async function deleteMovement(id: number): Promise<"ok" | "not_found" | "not_pending"> {
  await getProductionDb()
  return withTransaction(async (db) => {
    const row = (await db
      .prepare("SELECT party_id, direction, item_kind, item_id, item_name, unit, amount, is_defect, warehouse, date FROM production_movements WHERE id = ?")
      .get(id)) as (PartyLine & { party_id: number | null }) | undefined
    if (!row) return "not_found"
    if (row.direction === "adjust") throw new ProductionError(409, "Строка относится к инвентаризации — удалить ее нельзя")
    // Lock order (C1): removing output takes stock — the warehouse's stock lock before the batch's row lock.
    if (row.direction === "made") await lockWarehouseStock(db, [row.warehouse])
    if (row.party_id) {
      const party = await lockParty(db, row.party_id)
      if (party && party.status !== "pending") return "not_pending"
    }
    if (row.direction === "made" && textKey(row.warehouse)) {
      const defect = row.is_defect === 1
      await ensureAvailable(
        db,
        row.warehouse,
        [{ key: itemKey(row.item_kind, row.item_id), name: row.item_name, unit: row.unit, qty: Number(row.amount) || 0, date: row.date, defect }],
        "Не возможно удалить. ",
      )
    }
    await db.prepare("DELETE FROM production_movements WHERE id = ?").run(id)
    if (row.party_id) await recalcPartyCost(db, row.party_id)
    return "ok"
  })
}
