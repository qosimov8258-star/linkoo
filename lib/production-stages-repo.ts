import "server-only"

import { getProductionDb, itemKey, nowIso, type ItemKind } from "@/lib/production-schema"
import { getCatalogItem } from "@/lib/production-stock"

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type ProductionStage = { id: number; name: string; warehouse: string; responsible: string; createdAt: string }
export type StageInput = { name: string; warehouse: string; responsible: string }

type StageRow = { id: number; name: string; warehouse: string; responsible: string; created_at: string }

const toStage = (row: StageRow): ProductionStage => ({
  id: row.id,
  name: row.name,
  warehouse: row.warehouse,
  responsible: row.responsible,
  createdAt: row.created_at,
})

export async function listStages(): Promise<ProductionStage[]> {
  const db = await getProductionDb()
  return ((await db.prepare("SELECT * FROM production_stages ORDER BY id DESC").all()) as StageRow[]).map(toStage)
}

export async function getStage(id: number): Promise<ProductionStage | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT * FROM production_stages WHERE id = ?").get(id)) as StageRow | undefined
  return row ? toStage(row) : null
}

export async function createStage(input: StageInput): Promise<ProductionStage> {
  const db = await getProductionDb()
  const result = await db
    .prepare("INSERT INTO production_stages (name, warehouse, responsible, created_at) VALUES (?, ?, ?, ?)")
    .run(input.name, input.warehouse, input.responsible, nowIso())
  return (await getStage(result.lastInsertRowid))!
}

export async function updateStage(id: number, input: StageInput): Promise<ProductionStage | null> {
  const db = await getProductionDb()
  const { changes } = await db
    .prepare("UPDATE production_stages SET name = ?, warehouse = ?, responsible = ? WHERE id = ?")
    .run(input.name, input.warehouse, input.responsible, id)
  if (!changes) return null
  // The batch list shows the stage name stored on each batch. Movements keep
  // the warehouse they actually moved stock in; a new warehouse only applies
  // from now on.
  await db.prepare("UPDATE production_parties SET stage_name = ? WHERE stage_id = ?").run(input.name, id)
  return getStage(id)
}

/** A stage that already moved stock (batches or shift entries) stays: its
 * history is part of the warehouse balances. */
export async function deleteStage(id: number): Promise<"ok" | "not_found" | "in_use"> {
  const db = await getProductionDb()
  if (!(await getStage(id))) return "not_found"
  const used = (await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM production_parties WHERE stage_id = ?)
            + (SELECT COUNT(*) FROM production_movements WHERE stage_id = ?) AS count`,
    )
    .get(id, id)) as { count: number | string }
  if (Number(used.count) > 0) return "in_use"
  await db.prepare("DELETE FROM production_stages WHERE id = ?").run(id)
  return "ok"
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

export type ProductionEquipment = {
  id: number
  stageId: number
  name: string
  status: "0" | "1"
  image: string
  lastShipment: number | null
  createdAt: string
}
export type EquipmentInput = { stageId: number; name: string; status: "0" | "1"; image: string }

type EquipmentRow = { id: number; stage_id: number; name: string; status: string; image: string; created_at: string; last_shipment: number | null }

const toEquipment = (row: EquipmentRow): ProductionEquipment => ({
  id: row.id,
  stageId: row.stage_id,
  name: row.name,
  status: row.status === "1" ? "1" : "0",
  image: row.image,
  lastShipment: row.last_shipment ?? null,
  createdAt: row.created_at,
})

const EQUIPMENT_SELECT = `
  SELECT e.*, (SELECT MAX(m.id) FROM production_movements m WHERE m.equipment_id = e.id) AS last_shipment
  FROM production_equipment e`

export async function listEquipment(stageId?: number): Promise<ProductionEquipment[]> {
  const db = await getProductionDb()
  const rows = stageId
    ? ((await db.prepare(`${EQUIPMENT_SELECT} WHERE e.stage_id = ? ORDER BY e.id DESC`).all(stageId)) as EquipmentRow[])
    : ((await db.prepare(`${EQUIPMENT_SELECT} ORDER BY e.id DESC`).all()) as EquipmentRow[])
  return rows.map(toEquipment)
}

async function getEquipment(id: number): Promise<ProductionEquipment | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${EQUIPMENT_SELECT} WHERE e.id = ?`).get(id)) as EquipmentRow | undefined
  return row ? toEquipment(row) : null
}

export async function createEquipment(input: EquipmentInput): Promise<ProductionEquipment> {
  const db = await getProductionDb()
  const result = await db
    .prepare("INSERT INTO production_equipment (stage_id, name, status, image, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.stageId, input.name, input.status, input.image, nowIso())
  return (await getEquipment(result.lastInsertRowid))!
}

export async function updateEquipment(id: number, input: EquipmentInput): Promise<ProductionEquipment | null> {
  const db = await getProductionDb()
  const { changes } = await db
    .prepare("UPDATE production_equipment SET stage_id = ?, name = ?, status = ?, image = ? WHERE id = ?")
    .run(input.stageId, input.name, input.status, input.image, id)
  return changes ? getEquipment(id) : null
}

export async function deleteEquipment(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_equipment WHERE id = ?").run(id)).changes > 0
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type ProductionOperation = {
  id: number
  stageId: number
  title: string
  duration: number
  type: "equipment" | "human"
  equipmentId: number | null
  equipmentName: string
}
export type OperationInput = { stageId: number; title: string; duration: number; type: "equipment" | "human"; equipmentId: number | null }

type OperationRow = { id: number; stage_id: number; title: string; duration: number; type: string; equipment_id: number | null; equipment_name: string | null }

const toOperation = (row: OperationRow): ProductionOperation => ({
  id: row.id,
  stageId: row.stage_id,
  title: row.title,
  duration: row.duration,
  type: row.type === "human" ? "human" : "equipment",
  equipmentId: row.equipment_id,
  equipmentName: row.equipment_name ?? "",
})

const OPERATION_SELECT = `
  SELECT o.*, COALESCE(e.name, NULLIF(m.equipment_name, '')) AS equipment_name
  FROM production_operations o
  LEFT JOIN production_equipment e ON e.id = o.equipment_id
  LEFT JOIN production_operation_meta m ON m.operation_id = o.id`

export async function listOperations(stageId?: number): Promise<ProductionOperation[]> {
  const db = await getProductionDb()
  const rows = stageId
    ? await db.prepare(`${OPERATION_SELECT} WHERE o.stage_id = ? ORDER BY COALESCE(m.sort_order, o.id), o.id`).all(stageId)
    : await db.prepare(`${OPERATION_SELECT} ORDER BY COALESCE(m.sort_order, o.id), o.id`).all()
  return (rows as OperationRow[]).map(toOperation)
}

async function getOperation(id: number): Promise<ProductionOperation | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${OPERATION_SELECT} WHERE o.id = ?`).get(id)) as OperationRow | undefined
  return row ? toOperation(row) : null
}

export async function createOperation(input: OperationInput): Promise<ProductionOperation> {
  const db = await getProductionDb()
  const result = await db
    .prepare("INSERT INTO production_operations (stage_id, title, duration, type, equipment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.stageId, input.title, input.duration, input.type, input.type === "equipment" ? input.equipmentId : null, nowIso())
  return (await getOperation(result.lastInsertRowid))!
}

export async function updateOperation(id: number, input: OperationInput): Promise<ProductionOperation | null> {
  const db = await getProductionDb()
  const { changes } = await db
    .prepare("UPDATE production_operations SET title = ?, duration = ?, type = ?, equipment_id = ? WHERE id = ?")
    .run(input.title, input.duration, input.type, input.type === "equipment" ? input.equipmentId : null, id)
  return changes ? getOperation(id) : null
}

export async function deleteOperation(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_operations WHERE id = ?").run(id)).changes > 0
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type ProductionStaff = {
  id: number
  stageId: number
  employeeId: number | null
  employeeName: string
  position: string
  shift: string
  beginTime: string
  endTime: string
}
export type StaffInput = Omit<ProductionStaff, "id">

type StaffRow = {
  id: number
  stage_id: number
  employee_id: number | null
  employee_name: string
  position: string
  shift: string
  begin_time: string
  end_time: string
}

const toStaff = (row: StaffRow): ProductionStaff => ({
  id: row.id,
  stageId: row.stage_id,
  employeeId: row.employee_id,
  employeeName: row.employee_name,
  position: row.position,
  shift: row.shift,
  beginTime: row.begin_time,
  endTime: row.end_time,
})

export async function listStaff(stageId: number): Promise<ProductionStaff[]> {
  const db = await getProductionDb()
  return ((await db.prepare("SELECT * FROM production_staff WHERE stage_id = ? ORDER BY id").all(stageId)) as StaffRow[]).map(toStaff)
}

async function getStaff(id: number): Promise<ProductionStaff | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT * FROM production_staff WHERE id = ?").get(id)) as StaffRow | undefined
  return row ? toStaff(row) : null
}

export async function createStaff(input: StaffInput): Promise<ProductionStaff> {
  const db = await getProductionDb()
  const result = await db
    .prepare(
      `INSERT INTO production_staff (stage_id, employee_id, employee_name, position, shift, begin_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.stageId, input.employeeId, input.employeeName, input.position, input.shift, input.beginTime, input.endTime, nowIso())
  return (await getStaff(result.lastInsertRowid))!
}

export async function updateStaff(id: number, input: StaffInput): Promise<ProductionStaff | null> {
  const db = await getProductionDb()
  const { changes } = await db
    .prepare("UPDATE production_staff SET employee_id = ?, employee_name = ?, position = ?, shift = ?, begin_time = ?, end_time = ? WHERE id = ?")
    .run(input.employeeId, input.employeeName, input.position, input.shift, input.beginTime, input.endTime, id)
  return changes ? getStaff(id) : null
}

export async function deleteStaff(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_staff WHERE id = ?").run(id)).changes > 0
}

// ---------------------------------------------------------------------------
// Recipes (the stage's products and their raw-material norms)
// ---------------------------------------------------------------------------

export type RecipeComponent = { id: number; role: "raw" | "ready"; key: string; kind: ItemKind; itemId: number; name: string; unit: string; amount: number }
export type ProductionRecipe = {
  id: number
  stageId: number
  key: string
  kind: ItemKind
  itemId: number
  name: string
  type: string
  unit: string
  equipmentId: number | null
  equipmentName: string
  amount: number
  components: RecipeComponent[]
}
export type ComponentInput = { role: "raw" | "ready"; kind: ItemKind; id: number; amount: number }
export type RecipeInput = { stageId: number; kind: ItemKind; id: number; equipmentId: number | null; amount: number; components: ComponentInput[] }

type RecipeRow = {
  id: number
  stage_id: number
  item_kind: string
  item_id: number
  item_name: string
  item_type: string
  unit: string
  equipment_id: number | null
  equipment_name: string | null
  amount: number
}
type ComponentRow = { id: number; recipe_id: number; role: string; item_kind: string; item_id: number; item_name: string; unit: string; amount: number }

const toKind = (value: string): ItemKind => (value === "product" ? "product" : "raw_material")

const toComponent = (row: ComponentRow): RecipeComponent => ({
  id: row.id,
  role: row.role === "ready" ? "ready" : "raw",
  key: itemKey(row.item_kind, row.item_id),
  kind: toKind(row.item_kind),
  itemId: row.item_id,
  name: row.item_name,
  unit: row.unit,
  amount: row.amount,
})

const RECIPE_SELECT = `
  SELECT r.*, e.name AS equipment_name
  FROM production_recipes r LEFT JOIN production_equipment e ON e.id = r.equipment_id`

async function withComponents(rows: RecipeRow[]): Promise<ProductionRecipe[]> {
  if (!rows.length) return []
  const db = await getProductionDb()
  const ids = rows.map((row) => row.id)
  const components = (await db
    .prepare(`SELECT * FROM production_recipe_items WHERE recipe_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`)
    .all(...ids)) as ComponentRow[]
  return rows.map((row) => ({
    id: row.id,
    stageId: row.stage_id,
    key: itemKey(row.item_kind, row.item_id),
    kind: toKind(row.item_kind),
    itemId: row.item_id,
    name: row.item_name,
    type: row.item_type,
    unit: row.unit,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name ?? "",
    amount: row.amount,
    components: components.filter((component) => component.recipe_id === row.id).map(toComponent),
  }))
}

export async function listRecipes(stageId: number): Promise<ProductionRecipe[]> {
  const db = await getProductionDb()
  return withComponents((await db.prepare(`${RECIPE_SELECT} WHERE r.stage_id = ? ORDER BY r.id`).all(stageId)) as RecipeRow[])
}

export async function getRecipe(id: number): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${RECIPE_SELECT} WHERE r.id = ?`).get(id)) as RecipeRow | undefined
  return row ? (await withComponents([row]))[0] : null
}

async function insertComponent(recipeId: number, input: ComponentInput) {
  const db = await getProductionDb()
  const item = await getCatalogItem(db, input.kind, input.id)
  if (!item) return null
  const result = await db
    .prepare("INSERT INTO production_recipe_items (recipe_id, role, item_kind, item_id, item_name, unit, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(recipeId, input.role, item.kind, item.id, item.name, item.unit, input.amount)
  return result.lastInsertRowid
}

export async function createRecipe(input: RecipeInput): Promise<ProductionRecipe | "item_not_found" | "duplicate"> {
  const db = await getProductionDb()
  const item = await getCatalogItem(db, input.kind, input.id)
  if (!item) return "item_not_found"
  const existing = await db
    .prepare("SELECT id FROM production_recipes WHERE stage_id = ? AND item_kind = ? AND item_id = ?")
    .get(input.stageId, item.kind, item.id)
  if (existing) return "duplicate"
  const result = await db
    .prepare(
      `INSERT INTO production_recipes (stage_id, item_kind, item_id, item_name, item_type, unit, equipment_id, amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.stageId, item.kind, item.id, item.name, item.type, item.unit, input.equipmentId, input.amount, nowIso())
  for (const component of input.components) await insertComponent(result.lastInsertRowid, component)
  return (await getRecipe(result.lastInsertRowid))!
}

/** "Изменение нормы": the output quantity and equipment of a recipe. */
export async function updateRecipe(id: number, input: { equipmentId: number | null; amount: number }): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const { changes } = await db.prepare("UPDATE production_recipes SET equipment_id = ?, amount = ? WHERE id = ?").run(input.equipmentId, input.amount, id)
  return changes ? getRecipe(id) : null
}

export async function deleteRecipe(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_recipes WHERE id = ?").run(id)).changes > 0
}

export async function addRecipeComponent(recipeId: number, input: ComponentInput): Promise<ProductionRecipe | null> {
  if (!(await getRecipe(recipeId))) return null
  const db = await getProductionDb()
  // Adding the same item again just changes its norm.
  const existing = (await db
    .prepare("SELECT id FROM production_recipe_items WHERE recipe_id = ? AND role = ? AND item_kind = ? AND item_id = ?")
    .get(recipeId, input.role, input.kind, input.id)) as { id: number } | undefined
  if (existing) await db.prepare("UPDATE production_recipe_items SET amount = ? WHERE id = ?").run(input.amount, existing.id)
  else if (!(await insertComponent(recipeId, input))) return null
  return getRecipe(recipeId)
}

export async function updateRecipeComponent(id: number, amount: number): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT recipe_id FROM production_recipe_items WHERE id = ?").get(id)) as { recipe_id: number } | undefined
  if (!row) return null
  await db.prepare("UPDATE production_recipe_items SET amount = ? WHERE id = ?").run(amount, id)
  return getRecipe(row.recipe_id)
}

export async function deleteRecipeComponent(id: number): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT recipe_id FROM production_recipe_items WHERE id = ?").get(id)) as { recipe_id: number } | undefined
  if (!row) return null
  await db.prepare("DELETE FROM production_recipe_items WHERE id = ?").run(id)
  return getRecipe(row.recipe_id)
}
