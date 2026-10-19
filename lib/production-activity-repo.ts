import "server-only"

import { withTransaction } from "@/lib/db"
import { insertMovements, MOVEMENT_SELECT, toMovement, type MovementItemInput, type MovementRow, type ProductionMovement } from "@/lib/production-batches-repo"
import { getProductionDb, nowIso, round } from "@/lib/production-schema"
import { averageCost, getWarehouseStock, listWarehouseItems, nameKey } from "@/lib/production-stock"
import { getStage, listRecipes } from "@/lib/production-stages-repo"

export type ActivityFilters = { from: string; to: string; shift?: string; equipmentId?: number; worker?: string }

export type ActivityMadeLine = { key: string; name: string; unit: string; total: number; ok: number; defect: number }
export type ActivityRawLine = { key: string; name: string; unit: string; amount: number }
export type ActivityShift = { date: string; shift: string; worker: string; made: number; raw: number }

export type ProductionActivity = {
  made: ActivityMadeLine[]
  raw: ActivityRawLine[]
  logs: ProductionMovement[]
  shifts: ActivityShift[]
}

/** Everything the stage produced and consumed in a period — batch movements
 * and shift entries alike, cancelled batches excluded. */
export async function getActivity(stageId: number, filters: ActivityFilters): Promise<ProductionActivity> {
  const db = await getProductionDb()
  const where = [
    "m.stage_id = ?",
    "m.direction <> 'adjust'",
    "m.date >= ?",
    "m.date <= ?",
    "(m.party_id IS NULL OR m.party_id IN (SELECT id FROM production_parties WHERE status <> 'cancelled'))",
  ]
  const params: unknown[] = [stageId, filters.from, filters.to]
  if (filters.shift) {
    where.push("m.shift = ?")
    params.push(filters.shift)
  }
  if (filters.equipmentId) {
    where.push("m.equipment_id = ?")
    params.push(filters.equipmentId)
  }
  if (filters.worker) {
    where.push("m.worker = ?")
    params.push(filters.worker)
  }
  const logs = ((await db.prepare(`${MOVEMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.id DESC`).all(...params)) as MovementRow[]).map(toMovement)

  const made = new Map<string, ActivityMadeLine>()
  const raw = new Map<string, ActivityRawLine>()
  const shifts = new Map<string, ActivityShift>()
  for (const row of logs) {
    if (row.direction === "made") {
      const line = made.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, total: 0, ok: 0, defect: 0 }
      line.total = round(line.total + row.amount)
      if (row.isDefect) line.defect = round(line.defect + row.amount)
      else line.ok = round(line.ok + row.amount)
      made.set(row.key, line)
    } else {
      const line = raw.get(row.key) ?? { key: row.key, name: row.name, unit: row.unit, amount: 0 }
      line.amount = round(line.amount + row.amount)
      raw.set(row.key, line)
    }
    if (row.shift || row.worker) {
      const id = `${row.date}|${row.shift}|${row.worker}`
      const shift = shifts.get(id) ?? { date: row.date, shift: row.shift, worker: row.worker, made: 0, raw: 0 }
      if (row.direction === "made") shift.made += 1
      else shift.raw += 1
      shifts.set(id, shift)
    }
  }
  return { made: Array.from(made.values()), raw: Array.from(raw.values()), logs, shifts: Array.from(shifts.values()) }
}

export type ActivityInput = {
  direction: "made" | "raw"
  date: string
  shift: string
  equipmentId: number | null
  worker: string
  items: Array<MovementItemInput & { isDefect?: boolean }>
}

/** Shift entries ("Добавить продукт" / "Добавить сырье" on the activity tab)
 * are not part of a batch; products made this way are costed by their
 * recipe norms at the warehouse's current average costs. */
export async function addActivity(stageId: number, input: ActivityInput, userName: string): Promise<number | null> {
  const stage = await getStage(stageId)
  if (!stage) return null
  const db = await getProductionDb()
  const recipes = input.direction === "made" ? await listRecipes(stageId) : []
  const stock = input.direction === "made" ? await getWarehouseStock(db, stage.warehouse) : null
  return withTransaction((tx) => insertMovements(
    tx,
    { stageId, partyId: null, warehouse: stage.warehouse, date: input.date, userName, shift: input.shift, equipmentId: input.equipmentId, worker: input.worker },
    input.direction,
    input.items,
    async (item) => {
      const recipe = recipes.find((entry) => entry.kind === item.kind && entry.itemId === item.id)
      if (!recipe || !(recipe.amount > 0)) return 0
      const total = recipe.components.reduce((sum, component) => sum + component.amount * averageCost(stock?.get(nameKey(component.name))), 0)
      return total / recipe.amount
    },
  ))
}

// ---------------------------------------------------------------------------
// Inventory ("Сверить" / "Инвентаризация")
// ---------------------------------------------------------------------------

export type InventoryLine = { key: string; name: string; unit: string; expected: number; actual: number; difference: number }
export type ProductionInventory = { id: number; stageId: number; warehouse: string; date: string; comment: string; userName: string; lines: InventoryLine[]; createdAt: string }

type InventoryRow = { id: number; stage_id: number; warehouse: string; date: string; comment: string; user_name: string; lines: string; created_at: string }

function toInventory(row: InventoryRow): ProductionInventory {
  let lines: InventoryLine[] = []
  try {
    lines = JSON.parse(row.lines) as InventoryLine[]
  } catch {
    lines = []
  }
  return { id: row.id, stageId: row.stage_id, warehouse: row.warehouse, date: row.date, comment: row.comment, userName: row.user_name, lines, createdAt: row.created_at }
}

export async function listInventories(stageId: number, from: string, to: string): Promise<ProductionInventory[]> {
  const db = await getProductionDb()
  const rows = (await db
    .prepare("SELECT * FROM production_inventories WHERE stage_id = ? AND date >= ? AND date <= ? ORDER BY id DESC")
    .all(stageId, from, to)) as InventoryRow[]
  return rows.map(toInventory)
}

/** Records the counted quantities and books the differences as stock
 * adjustments so the warehouse balance matches the count afterwards. */
export async function createInventory(
  stageId: number,
  input: { date: string; comment: string; lines: Array<{ key: string; actual: number }> },
  userName: string,
): Promise<ProductionInventory | null> {
  const stage = await getStage(stageId)
  if (!stage) return null
  await getProductionDb()
  // Count, adjustments and the inventory record land together or not at all.
  const row = await withTransaction(async (db) => {
    const items = new Map((await listWarehouseItems(db, stage.warehouse)).map((item) => [item.key, item]))
    const lines: InventoryLine[] = []
    const adjustments: MovementItemInput[] = []
    for (const counted of input.lines) {
      const item = items.get(counted.key)
      if (!item) continue
      const difference = round(counted.actual - item.available)
      lines.push({ key: item.key, name: item.name, unit: item.unit, expected: round(item.available), actual: counted.actual, difference })
      if (difference !== 0) adjustments.push({ kind: item.kind, id: item.id, amount: difference })
    }
    if (!lines.length) return null
    if (adjustments.length) {
      await insertMovements(db, { stageId, partyId: null, warehouse: stage.warehouse, date: input.date, userName }, "adjust", adjustments)
    }
    const result = await db
      .prepare("INSERT INTO production_inventories (stage_id, warehouse, date, comment, user_name, lines, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(stageId, stage.warehouse, input.date, input.comment, userName, JSON.stringify(lines), nowIso())
    return (await db.prepare("SELECT * FROM production_inventories WHERE id = ?").get(result.lastInsertRowid)) as InventoryRow
  })
  if (!row) return null
  return toInventory(row)
}
