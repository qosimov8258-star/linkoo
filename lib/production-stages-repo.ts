import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { getProductionDb, itemKey, nowIso, ProductionError, textKey, type ItemKind } from "@/lib/production-schema"
import { findWarehouse, getCatalogItem, requireCatalogItem } from "@/lib/production-stock"

// Master data of the production module: stages, their equipment, operations,
// staff and products (recipes). Every reference is checked before writing
// (warehouse, employee, equipment of the same stage, catalog items), so a bad
// id is a clean 4xx (ProductionError), never an FK violation.

/** Transaction-scoped lock serialising the uniqueness checks of one scope. */
async function lockScope(db: PgDb, scope: string) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?)) AS ok").get(`linko-production:${scope}`)
}

const DELETE_BLOCKED = "Удаление невозможно из-за связи с другими данными"
type Usage = { table: string; label: string; count: number }

// ---------------------------------------------------------------------------
// References: warehouses and employees
// ---------------------------------------------------------------------------

/** Canonical name of an active warehouse (matched like the stock core: fin_key).
 * The stage's current warehouse is kept even when it was deactivated since. */
async function resolveWarehouse(db: PgDb, name: string, current?: string): Promise<string> {
  const found = await findWarehouse(db, name)
  if (!found) throw new ProductionError(400, "Склад не найден")
  if (!found.active && !(current !== undefined && textKey(current) === textKey(name))) throw new ProductionError(400, "Склад неактивен")
  return found.name
}

export type EmployeeRef = { id: number; name: string; position: string }

type EmployeeRow = { id: number; first_name: string | null; last_name: string | null; position: string | null }
const toEmployeeRef = (row: EmployeeRow): EmployeeRef => ({
  id: row.id,
  name: `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim(),
  position: String(row.position ?? ""),
})

/** An employee by id, or by "First Last" name (active ones first). */
async function findEmployee(db: PgDb, by: { id?: number | null; name?: string }): Promise<EmployeeRef | null> {
  if (by.id) {
    const row = (await db.prepare("SELECT id, first_name, last_name, position FROM employees WHERE id = ?").get(by.id)) as EmployeeRow | undefined
    return row ? toEmployeeRef(row) : null
  }
  const key = textKey(by.name)
  if (!key) return null
  const rows = (await db.prepare("SELECT id, first_name, last_name, position FROM employees ORDER BY COALESCE(active, 1) DESC, id").all()) as EmployeeRow[]
  return rows.map(toEmployeeRef).find((employee) => textKey(employee.name) === key) ?? null
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type ProductionStage = { id: number; name: string; warehouse: string; responsible: string; responsibleId: number | null; createdAt: string }
export type StageInput = { name: string; warehouse: string; responsible: string; responsibleId?: number | null }

type StageRow = { id: number; name: string; warehouse: string; responsible: string; responsible_id: number | null; employee_name: string | null; created_at: string }

const toStage = (row: StageRow): ProductionStage => ({
  id: row.id,
  name: row.name,
  warehouse: row.warehouse,
  // The employee's current name (renames follow); legacy free-text otherwise.
  responsible: row.employee_name ?? row.responsible,
  responsibleId: row.responsible_id ?? null,
  createdAt: row.created_at,
})

const STAGE_SELECT = `
  SELECT s.id, s.name, s.warehouse, s.responsible, s.responsible_id, s.created_at,
         NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '') AS employee_name
  FROM production_stages s LEFT JOIN employees e ON e.id = s.responsible_id`

export async function listStages(): Promise<ProductionStage[]> {
  const db = await getProductionDb()
  return ((await db.prepare(`${STAGE_SELECT} ORDER BY s.id DESC`).all()) as StageRow[]).map(toStage)
}

export async function getStage(id: number, db?: PgDb): Promise<ProductionStage | null> {
  const executor = db ?? (await getProductionDb())
  const row = (await executor.prepare(`${STAGE_SELECT} WHERE s.id = ?`).get(id)) as StageRow | undefined
  return row ? toStage(row) : null
}

async function assertUniqueStageName(db: PgDb, name: string, exceptId: number | null) {
  const rows = (await db.prepare("SELECT id, name FROM production_stages").all()) as Array<{ id: number; name: string }>
  if (rows.some((row) => row.id !== exceptId && textKey(row.name) === textKey(name))) {
    throw new ProductionError(409, "Этап с таким названием уже существует")
  }
}

/** The responsible employee: by id, else by name; empty = none. An unchanged
 * legacy free-text name (no matching employee) is kept as it is. */
async function resolveResponsible(db: PgDb, input: StageInput, current?: ProductionStage): Promise<{ id: number | null; name: string }> {
  if (input.responsibleId) {
    const employee = await findEmployee(db, { id: input.responsibleId })
    if (!employee) throw new ProductionError(400, "Сотрудник не найден")
    return { id: employee.id, name: employee.name }
  }
  if (!textKey(input.responsible)) return { id: null, name: "" }
  const employee = await findEmployee(db, { name: input.responsible })
  if (employee) return { id: employee.id, name: employee.name }
  if (current && current.responsibleId === null && textKey(current.responsible) === textKey(input.responsible)) return { id: null, name: current.responsible }
  throw new ProductionError(400, "Сотрудник не найден")
}

export async function createStage(input: StageInput): Promise<ProductionStage> {
  await getProductionDb()
  const id = await withTransaction(async (db) => {
    await lockScope(db, "stage-names")
    await assertUniqueStageName(db, input.name, null)
    const warehouse = await resolveWarehouse(db, input.warehouse)
    const responsible = await resolveResponsible(db, input)
    const result = await db
      .prepare("INSERT INTO production_stages (name, warehouse, responsible, responsible_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.name, warehouse, responsible.name, responsible.id, nowIso())
    return result.lastInsertRowid
  })
  return (await getStage(id))!
}

export async function updateStage(id: number, input: StageInput): Promise<ProductionStage | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    await lockScope(db, "stage-names")
    const current = await getStage(id, db)
    if (!current) return false
    await assertUniqueStageName(db, input.name, id)
    const warehouse = await resolveWarehouse(db, input.warehouse, current.warehouse)
    const responsible = await resolveResponsible(db, input, current)
    await db
      .prepare("UPDATE production_stages SET name = ?, warehouse = ?, responsible = ?, responsible_id = ? WHERE id = ?")
      .run(input.name, warehouse, responsible.name, responsible.id, id)
    // The batch list shows the stage name stored on each batch.
    await db.prepare("UPDATE production_parties SET stage_name = ? WHERE stage_id = ?").run(input.name, id)
    // A batch keeps the warehouse its stock moved in; only running batches
    // that have not moved anything yet follow the stage to its new warehouse.
    if (textKey(warehouse) !== textKey(current.warehouse)) {
      await db
        .prepare(
          `UPDATE production_parties p SET warehouse = ?
           WHERE p.stage_id = ? AND p.status = 'pending' AND NOT EXISTS (SELECT 1 FROM production_movements m WHERE m.party_id = p.id)`,
        )
        .run(warehouse, id)
    }
    return true
  })
  return found ? getStage(id) : null
}

/** A stage that already moved stock (batches or shift entries) stays: its
 * history is part of the warehouse balances. */
export async function deleteStage(id: number): Promise<"ok" | "not_found"> {
  const db = await getProductionDb()
  if (!(await getStage(id))) return "not_found"
  const counts = (await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM production_parties WHERE stage_id = ?) AS parties,
              (SELECT COUNT(*) FROM production_movements WHERE stage_id = ? AND party_id IS NULL) AS movements`,
    )
    .get(id, id)) as { parties: number | string; movements: number | string }
  const usage: Usage[] = []
  if (Number(counts.parties) > 0) usage.push({ table: "production_parties", label: "Партии", count: Number(counts.parties) })
  if (Number(counts.movements) > 0) usage.push({ table: "production_movements", label: "Производство", count: Number(counts.movements) })
  if (usage.length) throw new ProductionError(409, DELETE_BLOCKED, { usage })
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
/** `status` omitted: "1" (работает) for a new machine, unchanged on an edit. */
export type EquipmentInput = { stageId: number; name: string; status?: "0" | "1"; image: string }

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

export const EQUIPMENT_NOT_WORKING = "Оборудование не работает"

/** Equipment referenced by an operation / product / shift entry of a stage
 * must exist (404) and belong to that same stage (400). Work booked on it
 * (`mustWork`: shift entries) also needs it in status "работает" (400); master
 * data (operations, products) may name a machine that is down for now. */
export async function requireStageEquipment(db: PgDb, equipmentId: number | null | undefined, stageId: number, options?: { mustWork?: boolean }): Promise<void> {
  if (!equipmentId) return
  const row = (await db.prepare("SELECT id, stage_id, status FROM production_equipment WHERE id = ?").get(equipmentId)) as { id: number; stage_id: number; status: string | null } | undefined
  if (!row) throw new ProductionError(404, "Оборудование не найдено")
  if (row.stage_id !== stageId) throw new ProductionError(400, "Оборудование не относится к этапу")
  if (options?.mustWork && row.status !== "1") throw new ProductionError(400, EQUIPMENT_NOT_WORKING, { equipmentId })
}

export async function createEquipment(input: EquipmentInput): Promise<ProductionEquipment> {
  const db = await getProductionDb()
  if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
  const result = await db
    .prepare("INSERT INTO production_equipment (stage_id, name, status, image, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.stageId, input.name, input.status ?? "1", input.image, nowIso())
  return (await getEquipment(result.lastInsertRowid))!
}

export async function updateEquipment(id: number, input: EquipmentInput): Promise<ProductionEquipment | null> {
  const db = await getProductionDb()
  const current = await getEquipment(id)
  if (!current) return null
  if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
  if (input.stageId !== current.stageId) {
    // Operations, products and shift entries of its stage point at it.
    const used = (await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM production_operations WHERE equipment_id = ?)
              + (SELECT COUNT(*) FROM production_recipes WHERE equipment_id = ?)
              + (SELECT COUNT(*) FROM production_movements WHERE equipment_id = ?) AS count`,
      )
      .get(id, id, id)) as { count: number | string }
    if (Number(used.count) > 0) throw new ProductionError(409, "Оборудование уже используется — перенести его на другой этап нельзя")
  }
  await db.prepare("UPDATE production_equipment SET stage_id = ?, name = ?, status = ?, image = ? WHERE id = ?").run(input.stageId, input.name, input.status ?? current.status, input.image, id)
  return getEquipment(id)
}

/** Equipment that an operation or a stage product (recipe) uses, or that is
 * named on production records (shift entries, batch lines), stays: 409 with
 * the usage list. The row lock makes a concurrent operation / recipe write
 * that points at it wait, so the count cannot miss it. */
export async function deleteEquipment(id: number): Promise<boolean> {
  await getProductionDb()
  return withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM production_equipment WHERE id = ? FOR UPDATE").get(id))) return false
    const counts = (await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM production_operations WHERE equipment_id = @id) AS operations,
                (SELECT COUNT(*) FROM production_recipes WHERE equipment_id = @id) AS recipes,
                (SELECT COUNT(*) FROM production_movements WHERE equipment_id = @id) AS movements`,
      )
      .get({ id })) as { operations: number | string; recipes: number | string; movements: number | string }
    const usage: Usage[] = []
    if (Number(counts.operations) > 0) usage.push({ table: "production_operations", label: "Операции", count: Number(counts.operations) })
    if (Number(counts.recipes) > 0) usage.push({ table: "production_recipes", label: "Продукция", count: Number(counts.recipes) })
    if (Number(counts.movements) > 0) usage.push({ table: "production_movements", label: "Производство", count: Number(counts.movements) })
    if (usage.length) throw new ProductionError(409, DELETE_BLOCKED, { usage })
    return (await db.prepare("DELETE FROM production_equipment WHERE id = ?").run(id)).changes > 0
  })
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

// The equipment name comes from this company's equipment only. (The reference account's display overlay that the
// removed demo scripts wrote into production_operation_meta — equipment names and list order — is not read.)
const OPERATION_SELECT = `
  SELECT o.*, e.name AS equipment_name
  FROM production_operations o
  LEFT JOIN production_equipment e ON e.id = o.equipment_id`

export async function listOperations(stageId?: number): Promise<ProductionOperation[]> {
  const db = await getProductionDb()
  const rows = stageId
    ? await db.prepare(`${OPERATION_SELECT} WHERE o.stage_id = ? ORDER BY o.id`).all(stageId)
    : await db.prepare(`${OPERATION_SELECT} ORDER BY o.id`).all()
  return (rows as OperationRow[]).map(toOperation)
}

async function getOperation(id: number): Promise<ProductionOperation | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${OPERATION_SELECT} WHERE o.id = ?`).get(id)) as OperationRow | undefined
  return row ? toOperation(row) : null
}

export async function createOperation(input: OperationInput): Promise<ProductionOperation> {
  const db = await getProductionDb()
  if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
  const equipmentId = input.type === "equipment" ? input.equipmentId : null
  await requireStageEquipment(db, equipmentId, input.stageId)
  const result = await db
    .prepare("INSERT INTO production_operations (stage_id, title, duration, type, equipment_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.stageId, input.title, input.duration, input.type, equipmentId, nowIso())
  return (await getOperation(result.lastInsertRowid))!
}

/** The operation stays on its stage; its equipment must belong to that stage. */
export async function updateOperation(id: number, input: OperationInput): Promise<ProductionOperation | null> {
  const db = await getProductionDb()
  const current = await getOperation(id)
  if (!current) return null
  const equipmentId = input.type === "equipment" ? input.equipmentId : null
  await requireStageEquipment(db, equipmentId, current.stageId)
  await db.prepare("UPDATE production_operations SET title = ?, duration = ?, type = ?, equipment_id = ? WHERE id = ?").run(input.title, input.duration, input.type, equipmentId, id)
  return getOperation(id)
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

async function getStaff(id: number, db?: PgDb): Promise<ProductionStaff | null> {
  const executor = db ?? (await getProductionDb())
  const row = (await executor.prepare("SELECT * FROM production_staff WHERE id = ?").get(id)) as StaffRow | undefined
  return row ? toStaff(row) : null
}

/** One row per employee and stage. */
async function assertStaffUnique(db: PgDb, stageId: number, employee: { id: number | null; name: string }, exceptId: number | null) {
  const rows = (await db.prepare("SELECT id, employee_id, employee_name FROM production_staff WHERE stage_id = ?").all(stageId)) as Array<{ id: number; employee_id: number | null; employee_name: string }>
  const duplicate = rows.some(
    (row) =>
      row.id !== exceptId &&
      (employee.id !== null && row.employee_id !== null ? row.employee_id === employee.id : textKey(row.employee_name) === textKey(employee.name)),
  )
  if (duplicate) throw new ProductionError(409, "Сотрудник уже добавлен в этап")
}

export async function createStaff(input: StaffInput): Promise<ProductionStaff> {
  await getProductionDb()
  const id = await withTransaction(async (db) => {
    if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
    const employee = await findEmployee(db, input.employeeId ? { id: input.employeeId } : { name: input.employeeName })
    if (!employee) throw new ProductionError(404, "Сотрудник не найден")
    await lockScope(db, `staff:${input.stageId}`)
    await assertStaffUnique(db, input.stageId, employee, null)
    const result = await db
      .prepare(
        `INSERT INTO production_staff (stage_id, employee_id, employee_name, position, shift, begin_time, end_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.stageId, employee.id, employee.name, input.position || employee.position, input.shift, input.beginTime, input.endTime, nowIso())
    return result.lastInsertRowid
  })
  return (await getStaff(id))!
}

export async function updateStaff(id: number, input: StaffInput): Promise<ProductionStaff | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    const current = await getStaff(id, db)
    if (!current) return false
    let employee: { id: number | null; name: string; position: string } | null = await findEmployee(db, input.employeeId ? { id: input.employeeId } : { name: input.employeeName })
    // A legacy row (no employee link) may keep its name unchanged.
    if (!employee && !input.employeeId && current.employeeId === null && textKey(input.employeeName || current.employeeName) === textKey(current.employeeName)) {
      employee = { id: null, name: current.employeeName, position: current.position }
    }
    if (!employee) throw new ProductionError(404, "Сотрудник не найден")
    await lockScope(db, `staff:${current.stageId}`)
    await assertStaffUnique(db, current.stageId, employee, id)
    await db
      .prepare("UPDATE production_staff SET employee_id = ?, employee_name = ?, position = ?, shift = ?, begin_time = ?, end_time = ? WHERE id = ?")
      .run(employee.id, employee.name, input.position || employee.position, input.shift, input.beginTime, input.endTime, id)
    return true
  })
  return found ? getStaff(id) : null
}

export const WORKER_NOT_ON_STAGE = "Работник не входит в сотрудники этапа"

/** The worker of a shift entry: a member of the stage's staff ("Сотрудники"),
 * matched by name like the stage responsible and the staff themselves (case and
 * spacing ignored; a linked employee by their current name). Returns the
 * canonical name to store ("" = no worker); anyone else is refused (400). */
export async function resolveStageWorker(db: PgDb, stageId: number, worker: string): Promise<string> {
  const key = textKey(worker)
  if (!key) return ""
  const rows = (await db
    .prepare(
      `SELECT s.employee_name,
              NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), '') AS current_name
       FROM production_staff s LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.stage_id = ? ORDER BY s.id`,
    )
    .all(stageId)) as Array<{ employee_name: string | null; current_name: string | null }>
  for (const row of rows) {
    const name = row.current_name ?? String(row.employee_name ?? "")
    if (textKey(name) === key || textKey(row.employee_name) === key) return name
  }
  throw new ProductionError(400, WORKER_NOT_ON_STAGE, { worker })
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

const SELF_COMPONENT = "Продукт не может быть компонентом самого себя"

/** The recipe with all its components, or nothing: every component must be
 * a known item other than the recipe's own product (same item twice = one
 * line with the summed norm). */
export async function createRecipe(input: RecipeInput): Promise<ProductionRecipe | "item_not_found" | "duplicate"> {
  await getProductionDb()
  const result = await withTransaction(async (db) => {
    if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
    const item = await getCatalogItem(db, input.kind, input.id)
    if (!item) return "item_not_found" as const
    await requireStageEquipment(db, input.equipmentId, input.stageId)
    const components = new Map<string, { role: "raw" | "ready"; item: Awaited<ReturnType<typeof requireCatalogItem>>; amount: number }>()
    for (const component of input.components) {
      if (component.kind === item.kind && component.id === item.id) throw new ProductionError(400, SELF_COMPONENT)
      const resolved = await requireCatalogItem(db, component.kind, component.id)
      const key = `${component.role}|${resolved.key}`
      const existing = components.get(key)
      if (existing) existing.amount += component.amount
      else components.set(key, { role: component.role, item: resolved, amount: component.amount })
    }
    await lockScope(db, `recipes:${input.stageId}`)
    const existing = await db.prepare("SELECT id FROM production_recipes WHERE stage_id = ? AND item_kind = ? AND item_id = ?").get(input.stageId, item.kind, item.id)
    if (existing) return "duplicate" as const
    const inserted = await db
      .prepare(
        `INSERT INTO production_recipes (stage_id, item_kind, item_id, item_name, item_type, unit, equipment_id, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.stageId, item.kind, item.id, item.name, item.type, item.unit, input.equipmentId, input.amount, nowIso())
    for (const component of components.values()) {
      await db
        .prepare("INSERT INTO production_recipe_items (recipe_id, role, item_kind, item_id, item_name, unit, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(inserted.lastInsertRowid, component.role, component.item.kind, component.item.id, component.item.name, component.item.unit, component.amount)
    }
    return inserted.lastInsertRowid
  })
  return typeof result === "number" ? (await getRecipe(result))! : result
}

/** "Изменение нормы": the output quantity and equipment of a recipe. */
export async function updateRecipe(id: number, input: { equipmentId: number | null; amount: number }): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const recipe = await getRecipe(id)
  if (!recipe) return null
  await requireStageEquipment(db, input.equipmentId, recipe.stageId)
  await db.prepare("UPDATE production_recipes SET equipment_id = ?, amount = ? WHERE id = ?").run(input.equipmentId, input.amount, id)
  return getRecipe(id)
}

export async function deleteRecipe(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_recipes WHERE id = ?").run(id)).changes > 0
}

export async function addRecipeComponent(recipeId: number, input: ComponentInput): Promise<ProductionRecipe | null> {
  const recipe = await getRecipe(recipeId)
  if (!recipe) return null
  if (input.kind === recipe.kind && input.id === recipe.itemId) throw new ProductionError(400, SELF_COMPONENT)
  const db = await getProductionDb()
  const item = await requireCatalogItem(db, input.kind, input.id)
  // Adding the same item again just changes its norm.
  const existing = (await db
    .prepare("SELECT id FROM production_recipe_items WHERE recipe_id = ? AND role = ? AND item_kind = ? AND item_id = ?")
    .get(recipeId, input.role, item.kind, item.id)) as { id: number } | undefined
  if (existing) await db.prepare("UPDATE production_recipe_items SET amount = ? WHERE id = ?").run(input.amount, existing.id)
  else {
    await db
      .prepare("INSERT INTO production_recipe_items (recipe_id, role, item_kind, item_id, item_name, unit, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(recipeId, input.role, item.kind, item.id, item.name, item.unit, input.amount)
  }
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
