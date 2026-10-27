import "server-only"

import { withTransaction } from "@/lib/db"
import { lockWarehouseStock } from "@/lib/internal-transfers-stock"
import { insertMovements, MOVEMENT_SELECT, toMovement, type MovementItemInput, type MovementRow, type ProductionMovement } from "@/lib/production-batches-repo"
import { getProductionDb, itemKey, nowIso, ProductionError, round, textKey, type ItemKind } from "@/lib/production-schema"
import { assertMovementDay, itemCosts, requireCatalogItem, warehouseOnHand } from "@/lib/production-stock"
import { getStage, listRecipes, requireStageEquipment } from "@/lib/production-stages-repo"

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
 * recipe norms at the components' cost of goods of that day. Raw use must fit
 * the stage warehouse's available stock (409 otherwise). */
export async function addActivity(stageId: number, input: ActivityInput, userName: string): Promise<number | "stage_not_found"> {
  const stage = await getStage(stageId)
  if (!stage) return "stage_not_found"
  assertMovementDay(input.date)
  const recipes = input.direction === "made" ? await listRecipes(stageId) : []
  await getProductionDb()
  return withTransaction(async (tx) => {
    await requireStageEquipment(tx, input.equipmentId, stageId)
    let costs: Map<string, number> | null = null
    return insertMovements(
      tx,
      { stageId, partyId: null, warehouse: stage.warehouse, date: input.date, userName, shift: input.shift, equipmentId: input.equipmentId, worker: input.worker },
      input.direction,
      input.items,
      async (item) => {
        const recipe = recipes.find((entry) => entry.kind === item.kind && entry.itemId === item.id)
        if (!recipe || !(recipe.amount > 0)) return 0
        costs ??= await itemCosts(tx, input.date)
        const total = recipe.components.reduce((sum, component) => sum + component.amount * (costs?.get(component.key) ?? 0), 0)
        return total / recipe.amount
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Inventory ("Сверить" / "Инвентаризация")
// ---------------------------------------------------------------------------

/** expected = on hand at the end of the inventory day, defective units
 * included (what a physical count finds); defects = the brak inside it. */
export type InventoryLine = { key: string; name: string; unit: string; expected: number; defects?: number; actual: number; difference: number }
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
 * adjustments (linked to the inventory) so the warehouse balance on that day
 * matches the count afterwards. The count is compared with everything on
 * hand, brak included, so counting defective units never turns them into
 * good stock; a shortfall larger than the good stock is refused (409). */
export async function createInventory(
  stageId: number,
  input: { date: string; comment: string; lines: Array<{ kind: ItemKind; id: number; actual: number }> },
  userName: string,
): Promise<ProductionInventory | "stage_not_found" | "empty"> {
  const stage = await getStage(stageId)
  if (!stage) return "stage_not_found"
  assertMovementDay(input.date)
  if (!textKey(stage.warehouse)) throw new ProductionError(400, "У этапа не указан склад")
  const seen = new Set<string>()
  for (const line of input.lines) {
    const key = itemKey(line.kind, line.id)
    if (seen.has(key)) throw new ProductionError(400, "Товар указан в сверке дважды", { key })
    seen.add(key)
  }
  await getProductionDb()
  // Count, adjustments and the inventory record land together or not at all.
  const row = await withTransaction(async (db) => {
    await lockWarehouseStock(db, [stage.warehouse])
    const onHand = await warehouseOnHand(db, stage.warehouse, input.date)
    const lines: InventoryLine[] = []
    const adjustments: MovementItemInput[] = []
    for (const counted of input.lines) {
      const item = await requireCatalogItem(db, counted.kind, counted.id)
      const stock = onHand.get(item.key) ?? { qty: 0, defects: 0 }
      const difference = round(counted.actual - stock.qty)
      lines.push({ key: item.key, name: item.name, unit: item.unit, expected: round(stock.qty), defects: round(stock.defects), actual: counted.actual, difference })
      if (difference !== 0) adjustments.push({ kind: item.kind, id: item.id, amount: difference })
    }
    if (!lines.length) return null
    const result = await db
      .prepare("INSERT INTO production_inventories (stage_id, warehouse, date, comment, user_name, lines, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(stageId, stage.warehouse, input.date, input.comment, userName, JSON.stringify(lines), nowIso())
    if (adjustments.length) {
      await insertMovements(
        db,
        { stageId, partyId: null, warehouse: stage.warehouse, date: input.date, userName, inventoryId: result.lastInsertRowid },
        "adjust",
        adjustments,
        undefined,
        "Не возможно провести сверку. ",
      )
    }
    return (await db.prepare("SELECT * FROM production_inventories WHERE id = ?").get(result.lastInsertRowid)) as InventoryRow
  })
  if (!row) return "empty"
  return toInventory(row)
}
