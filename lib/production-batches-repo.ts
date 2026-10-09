import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { getProductionDb, itemKey, nowIso, round, type ItemKind } from "@/lib/production-schema"
import { averageCost, getCatalogItem, getWarehouseStock, nameKey } from "@/lib/production-stock"
import { getRecipe, getStage } from "@/lib/production-stages-repo"

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
  totalRaw: SummaryLine[]
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

const PARTY_SELECT = `
  SELECT p.*, s.warehouse
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

export async function getPartyDetail(id: number): Promise<PartyDetail | null> {
  const party = await getParty(id)
  if (!party) return null
  const db = await getProductionDb()
  const movements = ((await db.prepare(`${MOVEMENT_SELECT} WHERE m.party_id = ? ORDER BY m.id DESC`).all(id)) as MovementRow[]).map(toMovement)
  const made = movements.filter((row) => row.direction === "made" && !row.isDefect)
  const raw = movements.filter((row) => row.direction === "raw" && !row.isDefect)
  return {
    ...party,
    made,
    raw,
    madeDefects: movements.filter((row) => row.direction === "made" && row.isDefect),
    rawDefects: movements.filter((row) => row.direction === "raw" && row.isDefect),
    totalMade: summarize(made),
    totalRaw: summarize(raw),
    totalRawCost: round(raw.reduce((sum, row) => sum + row.total, 0), 6),
  }
}

export async function createParty(input: { stageId: number; date: string; comment: string }, userName: string): Promise<ProductionParty | null> {
  const stage = await getStage(input.stageId)
  if (!stage) return null
  const db = await getProductionDb()
  const result = await db
    .prepare("INSERT INTO production_parties (stage_id, stage_name, date, comment, status, user_name, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
    .run(stage.id, stage.name, input.date, input.comment, userName, nowIso())
  return getParty(result.lastInsertRowid)
}

export type PartyUpdateResult = ProductionParty | "not_found" | "stage_not_found" | "stage_locked"

export async function updateParty(id: number, input: { stageId: number; status: PartyStatus; comment: string; date: string }): Promise<PartyUpdateResult> {
  const stage = await getStage(input.stageId)
  await getProductionDb()
  const result = await withTransaction(async (db) => {
    const current = await lockParty(db, id)
    if (!current) return "not_found" as const
    if (!stage) return "stage_not_found" as const
    if (stage.id !== current.stageId) {
      // Movements were taken from / put into the old stage's warehouse.
      const moved = (await db.prepare("SELECT COUNT(*)::int AS count FROM production_movements WHERE party_id = ?").get(id)) as { count: number }
      if (moved.count > 0) return "stage_locked" as const
    }
    const finishedAt = input.status === "finished" ? current.finishedAt || nowIso() : ""
    await db
      .prepare("UPDATE production_parties SET stage_id = ?, stage_name = ?, status = ?, comment = ?, date = ?, finished_at = ? WHERE id = ?")
      .run(stage.id, stage.name, input.status, input.comment, input.date, finishedAt, id)
    return "ok" as const
  })
  return result === "ok" ? (await getParty(id))! : result
}

/** Spreads the batch's raw-material cost over everything it produced. */
async function recalcPartyCost(db: PgDb, partyId: number) {
  const totals = (await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'raw' AND is_defect = 0 THEN amount * cost ELSE 0 END), 0) AS raw_cost,
         COALESCE(SUM(CASE WHEN direction = 'made' AND is_defect = 0 THEN amount ELSE 0 END), 0) AS made_amount
       FROM production_movements WHERE party_id = ?`,
    )
    .get(partyId)) as { raw_cost: number; made_amount: number }
  const unitCost = totals.made_amount > 0 ? totals.raw_cost / totals.made_amount : 0
  await db.prepare("UPDATE production_movements SET cost = ? WHERE party_id = ? AND direction = 'made'").run(unitCost, partyId)
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
}

/** Inserts stock movements; raw lines are costed at the warehouse's current
 * average cost, made lines get their cost from `madeCost` (or the batch
 * recalculation that follows). */
export async function insertMovements(
  db: PgDb,
  context: MovementContext,
  direction: "made" | "raw" | "adjust",
  items: Array<MovementItemInput & { isDefect?: boolean; comment?: string; image?: string }>,
  madeCost?: (item: { kind: ItemKind; id: number; name: string }) => Promise<number>,
): Promise<number> {
  const stock = direction === "made" ? null : await getWarehouseStock(db, context.warehouse)
  const fallbackRows = (await db.prepare("SELECT name, cost FROM products WHERE deleted = 0").all()) as Array<{ name: string; cost: number }>
  const fallback = new Map(fallbackRows.map((row) => [nameKey(row.name), Number(row.cost) || 0]))
  let inserted = 0
  for (const input of items) {
    if (!(input.amount > 0) && direction !== "adjust") continue
    const item = await getCatalogItem(db, input.kind, input.id)
    if (!item) continue
    const cost = direction === "made"
      ? madeCost ? await madeCost(item) : 0
      : averageCost(stock?.get(nameKey(item.name)), fallback.get(nameKey(item.name)) ?? 0)
    await db
      .prepare(
        `INSERT INTO production_movements
           (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect,
            comment, image, date, shift, equipment_id, worker, user_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        cost,
        input.isDefect ? 1 : 0,
        input.comment ?? "",
        input.image ?? "",
        context.date,
        context.shift ?? "",
        context.equipmentId ?? null,
        context.worker ?? "",
        context.userName,
        nowIso(),
      )
    inserted += 1
  }
  return inserted
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
 * for it and closes the batch, like the demo's party auto_finish. */
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
    await db.prepare("UPDATE production_parties SET status = 'finished', finished_at = ? WHERE id = ?").run(nowIso(), partyId)
    // The note is kept on the made line; it also becomes the batch comment
    // when the batch has none yet.
    if (comment) await db.prepare("UPDATE production_parties SET comment = ? WHERE id = ? AND comment = ''").run(comment, partyId)
    return "ok"
  })
}

export async function deleteMovement(id: number): Promise<"ok" | "not_found" | "not_pending"> {
  await getProductionDb()
  return withTransaction(async (db) => {
    const row = (await db.prepare("SELECT party_id FROM production_movements WHERE id = ?").get(id)) as { party_id: number | null } | undefined
    if (!row) return "not_found"
    if (row.party_id) {
      const party = await lockParty(db, row.party_id)
      if (party && party.status !== "pending") return "not_pending"
    }
    await db.prepare("DELETE FROM production_movements WHERE id = ?").run(id)
    if (row.party_id) await recalcPartyCost(db, row.party_id)
    return "ok"
  })
}
