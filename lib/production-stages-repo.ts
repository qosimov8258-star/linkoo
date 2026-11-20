import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { getProductionDb, itemKey, nowIso, ProductionError, textKey, type ItemKind } from "@/lib/production-schema"
import { findWarehouse, getCatalogItem, requireCatalogItem } from "@/lib/production-stock"
import { usageTableLabel } from "@/lib/usage-labels"
import { ensureWorkShiftsSchema } from "@/lib/work-shifts-repo"

// Master data of the production module: stages, their equipment, operations,
// staff and products (recipes). Every reference is checked before writing
// (warehouse, employee, equipment of the same stage, catalog items), so a bad
// id is a clean 4xx (ProductionError), never an FK violation.

/** Transaction-scoped lock serialising the uniqueness checks of one scope. */
async function lockScope(db: PgDb, scope: string) {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?)) AS ok").get(`linko-production:${scope}`)
}

const DELETE_BLOCKED = "Удаление невозможно из-за связи с другими данными"
/** Usage label of the worker shift sessions (production_shift_sessions, lib/production-sessions-repo.ts). */
const SHIFT_SESSIONS_LABEL = "Смены работников"
type Usage = { table: string; label: string; count: number }

// ---------------------------------------------------------------------------
// References: warehouses and employees
// ---------------------------------------------------------------------------

/** Canonical name of an active warehouse: by id first (what the stage dialog sends),
 * else by name (matched like the stock core: fin_key). The stock core keys a
 * warehouse by its name, so the stage stores the name. The stage's current
 * warehouse is kept even when it was deactivated since. */
async function resolveWarehouse(db: PgDb, input: { id?: number | null; name: string }, current?: string): Promise<string> {
  let found: { name: string; active: boolean } | null
  if (input.id) {
    const row = (await db.prepare("SELECT name, COALESCE(active, 1) AS active FROM warehouses WHERE id = ?").get(input.id)) as { name: string; active: number | string } | undefined
    found = row ? { name: String(row.name ?? "").trim(), active: Number(row.active) === 1 } : null
  } else {
    found = await findWarehouse(db, input.name)
  }
  if (!found || !textKey(found.name)) throw new ProductionError(400, "Склад не найден", { field: "warehouse" })
  if (!found.active && !(current !== undefined && textKey(current) === textKey(found.name))) throw new ProductionError(400, "Склад неактивен", { field: "warehouse" })
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
/** `warehouseId` / `responsibleId` win over the names (references by id first). */
export type StageInput = { name: string; warehouseId?: number | null; warehouse: string; responsible: string; responsibleId?: number | null }

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
    throw new ProductionError(409, "Этап с таким названием уже существует", { field: "name" })
  }
}

async function employeeActive(db: PgDb, id: number): Promise<boolean> {
  const row = (await db.prepare("SELECT COALESCE(active, 1) AS active FROM employees WHERE id = ?").get(id)) as { active: number | string } | undefined
  return Number(row?.active ?? 0) === 1
}

const EMPLOYEE_INACTIVE = "Сотрудник неактивен"

/** The responsible employee: by id, else by name (active namesakes first); empty
 * = none. A deactivated employee is refused, except the stage's current one; an
 * unchanged name is kept as it is (a legacy free-text name without a matching
 * employee, or one whose only namesakes are deactivated), so opening and saving
 * the dialog never links somebody else. */
async function resolveResponsible(db: PgDb, input: StageInput, current?: ProductionStage): Promise<{ id: number | null; name: string }> {
  if (input.responsibleId) {
    const employee = await findEmployee(db, { id: input.responsibleId })
    if (!employee) throw new ProductionError(400, "Сотрудник не найден", { field: "responsible" })
    if (employee.id !== current?.responsibleId && !(await employeeActive(db, employee.id))) throw new ProductionError(400, EMPLOYEE_INACTIVE, { field: "responsible" })
    return { id: employee.id, name: employee.name }
  }
  if (!textKey(input.responsible)) return { id: null, name: "" }
  const unchanged = current !== undefined && textKey(current.responsible) === textKey(input.responsible)
  if (unchanged && current.responsibleId !== null) return { id: current.responsibleId, name: current.responsible }
  const employee = await findEmployee(db, { name: input.responsible })
  if (employee && (await employeeActive(db, employee.id))) return { id: employee.id, name: employee.name }
  if (unchanged) return { id: null, name: current.responsible }
  throw new ProductionError(400, employee ? EMPLOYEE_INACTIVE : "Сотрудник не найден", { field: "responsible" })
}

export async function createStage(input: StageInput): Promise<ProductionStage> {
  await getProductionDb()
  const id = await withTransaction(async (db) => {
    await lockScope(db, "stage-names")
    await assertUniqueStageName(db, input.name, null)
    const warehouse = await resolveWarehouse(db, { id: input.warehouseId, name: input.warehouse })
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
    const warehouse = await resolveWarehouse(db, { id: input.warehouseId, name: input.warehouse }, current.warehouse)
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

/** Section labels (i18n keys) of what a stage holds, in the order of its page. */
const STAGE_USAGE_LABELS: Array<[table: string, label: string]> = [
  ["production_parties", "Партии"],
  ["production_recipes", "Продукция"],
  ["production_staff", "Персонал"],
  ["production_equipment", "Оборудование"],
  // Shift entries and the stock corrections of its counts (a batch's lines count as its batch).
  ["production_movements", "Активность"],
  ["production_shift_sessions", SHIFT_SESSIONS_LABEL],
  ["production_inventories", "Инвентаризация"],
]

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

/** A stage that still holds anything (batches whatever their status, products
 * and their norms, staff, equipment, shift entries, counts, or the records of a
 * table added later: every foreign key to it, from the catalog) stays: 409 with
 * the usage list, never a silent cascade (most of its tables reference it ON
 * DELETE CASCADE). Operations are global (the reference's carry no stage): the
 * ones an older version filed under the stage are kept and only lose that link.
 * The row lock makes a concurrent write that points at the stage (its foreign
 * key check) wait, so no count can miss it. */
export async function deleteStage(id: number): Promise<"ok" | "not_found"> {
  await getProductionDb()
  return withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM production_stages WHERE id = ? FOR UPDATE").get(id))) return "not_found" as const
    const refs = (await db
      .prepare(
        `SELECT cl.relname AS table_name, a.attname AS column_name
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'production_stages'::regclass AND array_length(c.conkey, 1) = 1
           AND cl.relname <> 'production_operations'
         ORDER BY cl.relname, a.attname`,
      )
      .all()) as Array<{ table_name: string; column_name: string }>
    const counted: Usage[] = []
    for (const ref of refs) {
      const where = `${quoteIdent(ref.column_name)} = ?${ref.table_name === "production_movements" ? " AND party_id IS NULL" : ""}`
      const row = (await db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(ref.table_name)} WHERE ${where}`).get(id)) as { count: number | string }
      const count = Number(row.count)
      if (count <= 0) continue
      const label = STAGE_USAGE_LABELS.find(([table]) => table === ref.table_name)?.[1] ?? usageTableLabel(ref.table_name)
      const existing = counted.find((entry) => entry.label === label)
      if (existing) existing.count += count
      else counted.push({ table: ref.table_name, label, count })
    }
    const rank = (entry: Usage) => {
      const index = STAGE_USAGE_LABELS.findIndex(([table]) => table === entry.table)
      return index < 0 ? STAGE_USAGE_LABELS.length : index
    }
    const usage = counted.sort((a, b) => rank(a) - rank(b))
    if (usage.length) throw new ProductionError(409, DELETE_BLOCKED, { usage })
    await db.prepare("UPDATE production_operations SET stage_id = NULL WHERE stage_id = ?").run(id)
    await db.prepare("DELETE FROM production_stages WHERE id = ?").run(id)
    return "ok" as const
  })
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

// One directory of machines: the stage tab «Оборудование» and Настройки → «Оборудования» (lib/equipment-repo.ts)
// both read and write production_equipment, as Linko's pages both use manufacture/equipment/.

export type ProductionEquipment = {
  id: number
  stageId: number
  /** The stage's current name (Настройки → «Оборудования» lists the machines of every stage). */
  stageName: string
  name: string
  /** Linko's status as stored: "0" не работает, "1" рабочий, any other value «получить продукт». */
  status: string
  /** Where the picture is read: the machine's own image URL (the picture itself stays out of the lists), an
   * older http(s) / site link as it was stored, or "" (no picture). */
  image: string
  lastShipment: number | null
  createdAt: string
}
/** `status` omitted: "0" (не работает, as Linko creates a machine) for a new one, unchanged on an edit.
 * `image` omitted (or the machine's own image URL sent back): the stored picture stays; "" removes it. */
export type EquipmentInput = { stageId: number; name: string; status?: "0" | "1"; image?: string }

type EquipmentRow = {
  id: number
  stage_id: number
  stage_name: string | null
  name: string
  status: string | null
  image_link: string | null
  image_hash: string | null
  created_at: string
  last_shipment: number | null
}

/** The picture of machine `id`: GET /api/production/equipment/{id}/image. */
export const equipmentImagePath = (id: number) => `/api/production/equipment/${id}/image`

const toEquipment = (row: EquipmentRow): ProductionEquipment => ({
  id: row.id,
  stageId: row.stage_id,
  stageName: row.stage_name ?? "",
  name: row.name,
  status: String(row.status ?? "").trim() || "0",
  // The hash changes with the picture, so a browser never shows a replaced one from its cache.
  image: row.image_hash ? `${equipmentImagePath(row.id)}?v=${row.image_hash}` : (row.image_link ?? ""),
  lastShipment: row.last_shipment ?? null,
  createdAt: row.created_at,
})

// A picture is a data URL of up to a few MB: the lists carry only a hash of it (for its URL), never the data.
const EQUIPMENT_SELECT = `
  SELECT e.id, e.stage_id, s.name AS stage_name, e.name, e.status, e.created_at,
         CASE WHEN e.image LIKE 'data:%' THEN '' ELSE e.image END AS image_link,
         CASE WHEN e.image LIKE 'data:%' THEN left(md5(e.image), 12) END AS image_hash,
         (SELECT MAX(m.id) FROM production_movements m WHERE m.equipment_id = e.id) AS last_shipment
  FROM production_equipment e LEFT JOIN production_stages s ON s.id = e.stage_id`

/** The machines of a stage, or of every stage (Настройки → «Оборудования»), newest first. */
export async function listEquipment(stageId?: number): Promise<ProductionEquipment[]> {
  const db = await getProductionDb()
  const rows = stageId
    ? ((await db.prepare(`${EQUIPMENT_SELECT} WHERE e.stage_id = ? ORDER BY e.id DESC`).all(stageId)) as EquipmentRow[])
    : ((await db.prepare(`${EQUIPMENT_SELECT} ORDER BY e.id DESC`).all()) as EquipmentRow[])
  return rows.map(toEquipment)
}

export async function getEquipment(id: number): Promise<ProductionEquipment | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${EQUIPMENT_SELECT} WHERE e.id = ?`).get(id)) as EquipmentRow | undefined
  return row ? toEquipment(row) : null
}

const STORED_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/

/** The stored picture of machine `id` as bytes and their type; null without one (or for an older link). */
export async function getEquipmentImage(id: number): Promise<{ type: string; bytes: Buffer } | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("SELECT image FROM production_equipment WHERE id = ?").get(id)) as { image: string | null } | undefined
  const match = STORED_IMAGE.exec(row?.image ?? "")
  if (!match) return null
  return { type: `image/${match[1] === "jpg" ? "jpeg" : match[1]}`, bytes: Buffer.from(match[2], "base64") }
}

/** The picture to store: undefined keeps the stored one, and so does the machine's image URL a client sends back
 * (it is where the picture is read, not a picture). */
function newImage(value: string | undefined): string | undefined {
  if (value === undefined || value.startsWith("/api/production/equipment/")) return undefined
  return value
}

/** Equipment referenced by a product (recipe) / shift entry of a stage
 * must exist (404) and belong to that same stage (400); operations are global and
 * do not come here. A machine that is down for now is accepted, as the reference
 * offers every machine of the stage.
 * FOR KEY SHARE (callers run in a transaction): it waits for a pending move (updateEquipment's FOR UPDATE)
 * and reads the moved row, so the stage check sees the new stage; and the lock, held until the caller's
 * INSERT commits, makes a later move wait and count that row. */
export async function requireStageEquipment(db: PgDb, equipmentId: number | null | undefined, stageId: number): Promise<void> {
  if (!equipmentId) return
  const row = (await db.prepare("SELECT id, stage_id FROM production_equipment WHERE id = ? FOR KEY SHARE").get(equipmentId)) as { id: number; stage_id: number } | undefined
  if (!row) throw new ProductionError(404, "Оборудование не найдено")
  if (row.stage_id !== stageId) throw new ProductionError(400, "Оборудование не относится к этапу")
}

/** A new machine on a stage (`field` stageId of an unknown stage: 404). Linko creates it «не работает». */
export async function createEquipment(input: EquipmentInput): Promise<ProductionEquipment> {
  const db = await getProductionDb()
  if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден", { field: "stageId" })
  const result = await db
    .prepare("INSERT INTO production_equipment (stage_id, name, status, image, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.stageId, input.name, input.status ?? "0", newImage(input.image) ?? "", nowIso())
  return (await getEquipment(result.lastInsertRowid))!
}

/** Name, stage, status and picture of a machine. It moves to another stage (Linko's «Производство») only while
 * no product (recipe) or shift entry uses it: those require the machine of their own stage (409). Operations
 * are global and may use a machine of any stage, so they do not hold it back.
 * The row lock (FOR UPDATE) makes a concurrent product / shift entry that picks it (requireStageEquipment's
 * FOR KEY SHARE) wait and re-read the moved row; one already holding that lock makes the move wait and count it. */
export async function updateEquipment(id: number, input: EquipmentInput): Promise<ProductionEquipment | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    const current = (await db.prepare("SELECT id, stage_id, status FROM production_equipment WHERE id = ? FOR UPDATE").get(id)) as { id: number; stage_id: number; status: string } | undefined
    if (!current) return false
    if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден", { field: "stageId" })
    if (input.stageId !== current.stage_id) {
      const used = (await db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM production_recipes WHERE equipment_id = @id)
                + (SELECT COUNT(*) FROM production_movements WHERE equipment_id = @id) AS count`,
        )
        .get({ id })) as { count: number | string }
      if (Number(used.count) > 0) throw new ProductionError(409, "Оборудование уже используется — перенести его на другой этап нельзя", { field: "stageId" })
    }
    const image = newImage(input.image)
    await db
      .prepare("UPDATE production_equipment SET stage_id = ?, name = ?, status = ?, image = COALESCE(?::text, image) WHERE id = ?")
      .run(input.stageId, input.name, input.status ?? current.status, image ?? null, id)
    return true
  })
  return found ? getEquipment(id) : null
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

// Operations are global, as in the reference (its operations carry no stage: one list under every stage,
// equipment of any stage). `stageId` is only the stage an older version filed the operation under (null for
// new ones); nothing depends on it.

export type ProductionOperation = {
  id: number
  stageId: number | null
  title: string
  duration: number
  type: "equipment" | "human"
  equipmentId: number | null
  equipmentName: string
}
export type OperationInput = { title: string; duration: number; type: "equipment" | "human"; equipmentId: number | null }

type OperationRow = { id: number; stage_id: number | null; title: string; duration: number; type: string; equipment_id: number | null; equipment_name: string | null }

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

/** Every operation (they are global: no narrowing by the stage an older row was filed under). */
export async function listOperations(): Promise<ProductionOperation[]> {
  const db = await getProductionDb()
  const rows = await db.prepare(`${OPERATION_SELECT} ORDER BY o.id`).all()
  return (rows as OperationRow[]).map(toOperation)
}

async function getOperation(id: number): Promise<ProductionOperation | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${OPERATION_SELECT} WHERE o.id = ?`).get(id)) as OperationRow | undefined
  return row ? toOperation(row) : null
}

/** The reference's refusal of an «Оборудование» operation without a machine. */
export const OPERATION_EQUIPMENT_REQUIRED = "Оборудование обязательно!"

/** A machine of any stage (operations are global); unknown → 404. */
async function requireOperationEquipment(db: PgDb, equipmentId: number) {
  if (!(await db.prepare("SELECT id FROM production_equipment WHERE id = ?").get(equipmentId))) throw new ProductionError(404, "Оборудование не найдено", { field: "equipmentId" })
}

export async function createOperation(input: OperationInput): Promise<ProductionOperation> {
  const db = await getProductionDb()
  const equipmentId = input.type === "equipment" ? input.equipmentId : null
  if (input.type === "equipment") {
    if (!equipmentId) throw new ProductionError(400, OPERATION_EQUIPMENT_REQUIRED, { field: "equipmentId" })
    await requireOperationEquipment(db, equipmentId)
  }
  const result = await db
    .prepare("INSERT INTO production_operations (stage_id, title, duration, type, equipment_id, created_at) VALUES (NULL, ?, ?, ?, ?, ?)")
    .run(input.title, input.duration, input.type, equipmentId, nowIso())
  return (await getOperation(result.lastInsertRowid))!
}

/** An «Оборудование» operation needs a machine (of any stage). An older one
 * saved without a machine (the copy could not link its reference machine) may
 * keep having none while it stays of that type. «Трудовые затраты» has no
 * machine. A machine deleted meanwhile fails on its foreign key (→ 400). */
export async function updateOperation(id: number, input: OperationInput): Promise<ProductionOperation | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    const current = (await db.prepare("SELECT type, equipment_id FROM production_operations WHERE id = ? FOR UPDATE").get(id)) as { type: string; equipment_id: number | null } | undefined
    if (!current) return false
    const equipmentId = input.type === "equipment" ? input.equipmentId : null
    if (input.type === "equipment") {
      if (equipmentId) await requireOperationEquipment(db, equipmentId)
      else if (!(current.type !== "human" && current.equipment_id === null)) throw new ProductionError(400, OPERATION_EQUIPMENT_REQUIRED, { field: "equipmentId" })
    }
    await db.prepare("UPDATE production_operations SET title = ?, duration = ?, type = ?, equipment_id = ? WHERE id = ?").run(input.title, input.duration, input.type, equipmentId, id)
    return true
  })
  return found ? getOperation(id) : null
}

/** Section labels of the tables that point at an operation (a module may add
 * one later, e.g. the products an operation is attached to). */
function operationUsageLabel(table: string): string {
  return /^production_.*(product|recipe)/.test(table) ? "Продукция" : usageTableLabel(table)
}

/** An operation that other records point at (their foreign keys, found in the
 * catalog so a table added later counts too) stays: 409 with the usage list.
 * production_operation_meta is no usage: a 1:1 display overlay of the operation
 * itself (older demo scripts), dropped with it. The row lock makes a concurrent
 * write that points at the operation wait. */
export async function deleteOperation(id: number): Promise<boolean> {
  await getProductionDb()
  return withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM production_operations WHERE id = ? FOR UPDATE").get(id))) return false
    const refs = (await db
      .prepare(
        `SELECT cl.relname AS table_name, a.attname AS column_name
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         WHERE c.contype = 'f' AND c.confrelid = 'production_operations'::regclass AND array_length(c.conkey, 1) = 1
           AND cl.relname <> 'production_operation_meta'
         ORDER BY cl.relname, a.attname`,
      )
      .all()) as Array<{ table_name: string; column_name: string }>
    const usage: Usage[] = []
    for (const ref of refs) {
      const row = (await db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(ref.table_name)} WHERE ${quoteIdent(ref.column_name)} = ?`).get(id)) as { count: number | string }
      const count = Number(row.count)
      if (count <= 0) continue
      const label = operationUsageLabel(ref.table_name)
      const existing = usage.find((entry) => entry.label === label)
      if (existing) existing.count += count
      else usage.push({ table: ref.table_name, label, count })
    }
    if (usage.length) throw new ProductionError(409, DELETE_BLOCKED, { usage })
    return (await db.prepare("DELETE FROM production_operations WHERE id = ?").run(id)).changes > 0
  })
}

export type OperationEquipment = { id: number; stageId: number; name: string; stageName: string }

/** The machines an operation can use: those of every stage (the reference's
 * equipment search is not limited to a stage), with their stage's name so
 * namesakes can be told apart. */
export async function listOperationEquipment(): Promise<OperationEquipment[]> {
  const db = await getProductionDb()
  const rows = (await db
    .prepare(
      `SELECT e.id, e.stage_id, e.name, COALESCE(s.name, '') AS stage_name
       FROM production_equipment e LEFT JOIN production_stages s ON s.id = e.stage_id
       ORDER BY lower(e.name), e.id`,
    )
    .all()) as Array<{ id: number; stage_id: number; name: string; stage_name: string }>
  return rows.map((row) => ({ id: row.id, stageId: row.stage_id, name: row.name, stageName: row.stage_name }))
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

// A staff row is Linko's user_shift {user, shift, manufacture}: an employee on a shift of the Смены directory
// (work_shifts, by id). Its name, «Должность» (the employee's access right, which Linko shows there), shift name
// and times are read live; the row's own columns keep the copy of the last save, shown only when the employee or
// the shift is gone (and for older rows that name a shift the directory does not have).

export type ProductionStaff = {
  id: number
  stageId: number
  employeeId: number | null
  employeeName: string
  position: string
  /** The shift of the Смены directory; null for an older row whose shift name is not in it. */
  shiftId: number | null
  shift: string
  /** The shift's times as stored there ("08:00:41"); the list shows HH:MM. */
  beginTime: string
  endTime: string
}
export type StaffInput = { stageId: number; employeeId: number; shiftId: number }
/** An edit changes the shift only: the employee of a row stays (Linko's edit dialog has it disabled). */
export type StaffUpdate = { shiftId: number }

type StaffRow = {
  id: number
  stage_id: number
  employee_id: number | null
  shift_id: number | null
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
  shiftId: row.shift_id ?? null,
  shift: row.shift,
  beginTime: row.begin_time,
  endTime: row.end_time,
})

const STAFF_SELECT = `
  SELECT s.id, s.stage_id, s.employee_id, s.shift_id,
         COALESCE(NULLIF(btrim(btrim(COALESCE(e.first_name, '')) || ' ' || btrim(COALESCE(e.last_name, ''))), ''), s.employee_name) AS employee_name,
         COALESCE(NULLIF(btrim(a.name), ''), s.position) AS position,
         COALESCE(w.name, s.shift) AS shift,
         COALESCE(w.begin_time, s.begin_time) AS begin_time,
         COALESCE(w.end_time, s.end_time) AS end_time
  FROM production_staff s
  LEFT JOIN employees e ON e.id = s.employee_id
  LEFT JOIN access_rights a ON a.id = e.access_right_id
  LEFT JOIN work_shifts w ON w.id = s.shift_id`

export async function listStaff(stageId: number): Promise<ProductionStaff[]> {
  const db = await getProductionDb()
  await ensureWorkShiftsSchema()
  return ((await db.prepare(`${STAFF_SELECT} WHERE s.stage_id = ? ORDER BY s.id`).all(stageId)) as StaffRow[]).map(toStaff)
}

async function getStaff(id: number, db?: PgDb): Promise<ProductionStaff | null> {
  const executor = db ?? (await getProductionDb())
  const row = (await executor.prepare(`${STAFF_SELECT} WHERE s.id = ?`).get(id)) as StaffRow | undefined
  return row ? toStaff(row) : null
}

/** Linko's refusal of the same employee on the same shift twice. */
export const STAFF_SHIFT_TAKEN = "Один пользователь может иметь только один раз в одну смену"

/** An employee of the staff dialog, locked like a foreign key would (an employee delete waits, then sees the row). */
async function staffEmployee(db: PgDb, id: number): Promise<{ id: number; name: string; active: boolean; accessRight: string }> {
  const row = (await db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, COALESCE(e.active, 1) AS active, a.name AS access_right
       FROM employees e LEFT JOIN access_rights a ON a.id = e.access_right_id
       WHERE e.id = ? FOR KEY SHARE OF e`,
    )
    .get(id)) as { id: number; first_name: string | null; last_name: string | null; active: number | string; access_right: string | null } | undefined
  if (!row) throw new ProductionError(400, "Сотрудник не найден", { field: "employeeId" })
  return {
    id: row.id,
    name: `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim(),
    active: Number(row.active) === 1,
    accessRight: String(row.access_right ?? "").trim(),
  }
}

/** A shift of the Смены directory, locked like a foreign key would (a shift delete waits, then sees the row). */
async function staffShift(db: PgDb, id: number): Promise<{ id: number; name: string; beginTime: string; endTime: string }> {
  const row = (await db.prepare("SELECT id, name, begin_time, end_time FROM work_shifts WHERE id = ? FOR KEY SHARE").get(id)) as
    | { id: number; name: string; begin_time: string; end_time: string }
    | undefined
  if (!row) throw new ProductionError(400, "Смена не найдена", { field: "shiftId" })
  return { id: row.id, name: String(row.name ?? "").trim(), beginTime: String(row.begin_time ?? ""), endTime: String(row.end_time ?? "") }
}

/** One employee once per shift, over all stages (Linko's rule; several shifts of one employee on a stage are
 * fine). Run under the employee's lock; an older row without an employee link is matched by its name. */
async function assertShiftFree(db: PgDb, employee: { id: number | null; name: string }, shiftId: number, exceptId: number | null) {
  const rows = (await db.prepare("SELECT id, employee_id, employee_name FROM production_staff WHERE shift_id = ?").all(shiftId)) as Array<{ id: number; employee_id: number | null; employee_name: string }>
  const taken = rows.some(
    (row) =>
      row.id !== exceptId &&
      (employee.id !== null && row.employee_id !== null ? row.employee_id === employee.id : textKey(row.employee_name) === textKey(employee.name)),
  )
  if (taken) throw new ProductionError(409, STAFF_SHIFT_TAKEN)
}

/** «Добавить сотрудника»: an active employee (400 otherwise, field employeeId) on a directory shift (field shiftId). */
export async function createStaff(input: StaffInput): Promise<ProductionStaff> {
  await getProductionDb()
  await ensureWorkShiftsSchema()
  const id = await withTransaction(async (db) => {
    if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
    const employee = await staffEmployee(db, input.employeeId)
    if (!employee.active) throw new ProductionError(400, "Сотрудник неактивен", { field: "employeeId" })
    const shift = await staffShift(db, input.shiftId)
    await lockScope(db, `staff-employee:${employee.id}`)
    await assertShiftFree(db, employee, shift.id, null)
    const result = await db
      .prepare(
        `INSERT INTO production_staff (stage_id, employee_id, employee_name, position, shift_id, shift, begin_time, end_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.stageId, employee.id, employee.name, employee.accessRight, shift.id, shift.name, shift.beginTime, shift.endTime, nowIso())
    return result.lastInsertRowid
  })
  return (await getStaff(id))!
}

/** «Изменение сотрудника»: another shift for the row; its employee stays. */
export async function updateStaff(id: number, input: StaffUpdate): Promise<ProductionStaff | null> {
  await getProductionDb()
  await ensureWorkShiftsSchema()
  const found = await withTransaction(async (db) => {
    const current = (await db.prepare("SELECT id, employee_id, employee_name FROM production_staff WHERE id = ? FOR UPDATE").get(id)) as
      | { id: number; employee_id: number | null; employee_name: string }
      | undefined
    if (!current) return false
    const shift = await staffShift(db, input.shiftId)
    const employee = { id: current.employee_id, name: current.employee_name }
    await lockScope(db, `staff-employee:${employee.id ?? textKey(employee.name)}`)
    await assertShiftFree(db, employee, shift.id, id)
    await db.prepare("UPDATE production_staff SET shift_id = ?, shift = ?, begin_time = ?, end_time = ? WHERE id = ?").run(shift.id, shift.name, shift.beginTime, shift.endTime, id)
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

/** «Удалить» a Персонал row. While a worker shift session opened from it is still open, the row stays: 409 with the
 * usage list («Смены работников»), the session is closed first. Closed sessions keep their worker and shift (their
 * link is cleared, ON DELETE SET NULL). The row lock makes a parallel «Открыть смену» (FOR KEY SHARE on the row)
 * wait, so the count cannot miss it. */
export async function deleteStaff(id: number): Promise<boolean> {
  await getProductionDb()
  return withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM production_staff WHERE id = ? FOR UPDATE").get(id))) return false
    const open = (await db.prepare("SELECT COUNT(*) AS count FROM production_shift_sessions WHERE staff_id = ? AND closed_at IS NULL").get(id)) as { count: number | string }
    const count = Number(open.count)
    if (count > 0) throw new ProductionError(409, DELETE_BLOCKED, { usage: [{ table: "production_shift_sessions", label: SHIFT_SESSIONS_LABEL, count }] satisfies Usage[] })
    return (await db.prepare("DELETE FROM production_staff WHERE id = ?").run(id)).changes > 0
  })
}

// ---------------------------------------------------------------------------
// Recipes (the stage's products and their raw-material norms)
// ---------------------------------------------------------------------------

export type RecipeComponent = { id: number; role: "raw" | "ready"; key: string; kind: ItemKind; itemId: number; name: string; unit: string; amount: number }
/** An operation attached to a stage product («Прикрепить операцию»); `id` is the link's own id. */
export type RecipeOperation = { id: number; operationId: number; title: string; type: "equipment" | "human" }
export type ProductionRecipe = {
  id: number
  stageId: number
  key: string
  kind: ItemKind
  itemId: number
  name: string
  /** The item's code (article): the reference's product search matches the name and the code. */
  code: string
  type: string
  unit: string
  equipmentId: number | null
  equipmentName: string
  amount: number
  /** Raw lines (used per `amount` of output) and ready lines (what the norm puts out, by-products included:
   * display only, the reference's auto-finish neither consumes nor produces them), newest line first. */
  components: RecipeComponent[]
  operations: RecipeOperation[]
}
export type ComponentInput = { role: "raw" | "ready"; kind: ItemKind; id: number; amount: number }
export type RecipeInput = { stageId: number; kind: ItemKind; id: number; equipmentId: number | null; amount: number; components: ComponentInput[] }
/** «Изменение нормы»: a `stageId` other than the current one moves the product (with its norm) there. */
export type RecipeUpdate = { stageId?: number; equipmentId: number | null; amount: number }

type RecipeRow = {
  id: number
  stage_id: number
  item_kind: string
  item_id: number
  item_name: string
  item_type: string
  item_code: string | null
  unit: string
  equipment_id: number | null
  equipment_name: string | null
  amount: number
}
type ComponentRow = { id: number; recipe_id: number; role: string; item_kind: string; item_id: number; item_name: string; unit: string; amount: number }
type OperationLinkRow = { id: number; recipe_id: number; operation_id: number; title: string; type: string }

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
  SELECT r.*, e.name AS equipment_name, COALESCE(p.article, m.article, '') AS item_code
  FROM production_recipes r
  LEFT JOIN production_equipment e ON e.id = r.equipment_id
  LEFT JOIN products p ON r.item_kind = 'product' AND p.id = r.item_id
  LEFT JOIN raw_materials m ON r.item_kind = 'raw_material' AND m.id = r.item_id`

async function withComponents(rows: RecipeRow[]): Promise<ProductionRecipe[]> {
  if (!rows.length) return []
  const db = await getProductionDb()
  const ids = rows.map((row) => row.id)
  const marks = ids.map(() => "?").join(", ")
  // A line's place is its sort_order, else its id (lib/production-schema.ts: a line added later goes first).
  const components = (await db
    .prepare(`SELECT * FROM production_recipe_items WHERE recipe_id IN (${marks}) ORDER BY COALESCE(sort_order, id), id`)
    .all(...ids)) as ComponentRow[]
  const links = (await db
    .prepare(
      `SELECT l.id, l.recipe_id, l.operation_id, o.title, o.type
       FROM production_product_operations l JOIN production_operations o ON o.id = l.operation_id
       WHERE l.recipe_id IN (${marks}) ORDER BY l.id`,
    )
    .all(...ids)) as OperationLinkRow[]
  return rows.map((row) => ({
    id: row.id,
    stageId: row.stage_id,
    key: itemKey(row.item_kind, row.item_id),
    kind: toKind(row.item_kind),
    itemId: row.item_id,
    name: row.item_name,
    code: String(row.item_code ?? ""),
    type: row.item_type,
    unit: row.unit,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name ?? "",
    amount: row.amount,
    components: components.filter((component) => component.recipe_id === row.id).map(toComponent),
    operations: links
      .filter((link) => link.recipe_id === row.id)
      .map((link) => ({ id: link.id, operationId: link.operation_id, title: link.title, type: link.type === "human" ? "human" : "equipment" })),
  }))
}

/** A stage's products in the reference's order: the newest product first (product id DESC). */
export async function listRecipes(stageId: number): Promise<ProductionRecipe[]> {
  const db = await getProductionDb()
  return withComponents((await db.prepare(`${RECIPE_SELECT} WHERE r.stage_id = ? ORDER BY r.item_id DESC, r.id DESC`).all(stageId)) as RecipeRow[])
}

export async function getRecipe(id: number): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const row = (await db.prepare(`${RECIPE_SELECT} WHERE r.id = ?`).get(id)) as RecipeRow | undefined
  return row ? (await withComponents([row]))[0] : null
}

const SELF_COMPONENT = "Продукт не может быть компонентом самого себя"
const RECIPE_ON_STAGE = "Этот продукт уже добавлен в этап"
/** A product is made on one stage only: the reference's product carries a single «manufacture». */
export const RECIPE_ON_OTHER_STAGE = "Этот продукт уже добавлен в другой этап"
const COMPONENT_EXISTS = "Этот товар уже есть в норме"
/** A norm line's bound (lib/production-api.ts MAX_QTY and its message), also for the sum of an item sent twice. */
const MAX_LINE_AMOUNT = 1e9
const LINE_AMOUNT_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"

/** Serialises the creates and moves of one item's norm (one stage per product). */
const lockRecipeItem = (db: PgDb, kind: string, id: number) => lockScope(db, `recipe-item:${kind}:${id}`)

/** The recipe with all its components, or nothing. The product is a catalog product (the reference has no
 * other kind of stage product) that no other stage makes yet (409 with that stage's name and id). Every
 * component must be a known item; the product itself may be one of its ready lines (the reference's norms
 * list it there), never its own raw material; the same item twice in one role = one line with the summed
 * norm (≤ 1e9). The lines keep the order they are sent in.
 * Like the reference's «Добавление продукта» (it sends no ready lines, yet its new norms list the product
 * itself under «Готовый продукт» with the norm's own quantity), a norm sent without the product as a ready
 * line gets that line, after the lines sent. Ready lines are display only: auto-add, auto-finish and the
 * activity costing read the raw lines alone. */
export async function createRecipe(input: RecipeInput): Promise<ProductionRecipe | "item_not_found" | "duplicate"> {
  if (input.kind !== "product") throw new ProductionError(400, "Неверный товар")
  await getProductionDb()
  const result = await withTransaction(async (db) => {
    if (!(await getStage(input.stageId, db))) throw new ProductionError(404, "Этап не найден")
    const item = await getCatalogItem(db, input.kind, input.id)
    if (!item) return "item_not_found" as const
    await requireStageEquipment(db, input.equipmentId, input.stageId)
    const components = new Map<string, { role: "raw" | "ready"; item: Awaited<ReturnType<typeof requireCatalogItem>>; amount: number }>()
    for (const component of input.components) {
      if (component.role === "raw" && component.kind === item.kind && component.id === item.id) throw new ProductionError(400, SELF_COMPONENT)
      const resolved = await requireCatalogItem(db, component.kind, component.id)
      const key = `${component.role}|${resolved.key}`
      const existing = components.get(key)
      if (existing && existing.amount + component.amount > MAX_LINE_AMOUNT) throw new ProductionError(400, LINE_AMOUNT_ERROR, { key: resolved.key })
      if (existing) existing.amount += component.amount
      else components.set(key, { role: component.role, item: resolved, amount: component.amount })
    }
    if (!components.has(`ready|${item.key}`)) components.set(`ready|${item.key}`, { role: "ready", item, amount: input.amount })
    await lockRecipeItem(db, item.kind, item.id)
    const existing = (await db
      .prepare(
        `SELECT r.stage_id, s.name AS stage_name FROM production_recipes r LEFT JOIN production_stages s ON s.id = r.stage_id
         WHERE r.item_kind = ? AND r.item_id = ? ORDER BY (r.stage_id = ?) DESC, r.id LIMIT 1`,
      )
      .get(item.kind, item.id, input.stageId)) as { stage_id: number; stage_name: string | null } | undefined
    if (existing?.stage_id === input.stageId) return "duplicate" as const
    if (existing) throw new ProductionError(409, RECIPE_ON_OTHER_STAGE, { stageId: existing.stage_id, stage: existing.stage_name ?? "" })
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

/** «Изменение нормы»: the output quantity, the equipment (of the recipe's stage) and the stage itself (the
 * reference's «Производство» moves the product, with its norm and operations, to another stage, which must
 * not have it yet: 409). */
export async function updateRecipe(id: number, input: RecipeUpdate): Promise<ProductionRecipe | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    const current = (await db.prepare("SELECT stage_id, item_kind, item_id FROM production_recipes WHERE id = ? FOR UPDATE").get(id)) as
      | { stage_id: number; item_kind: string; item_id: number }
      | undefined
    if (!current) return false
    const stageId = input.stageId ?? current.stage_id
    if (stageId !== current.stage_id) {
      if (!(await getStage(stageId, db))) throw new ProductionError(404, "Этап не найден")
      await lockRecipeItem(db, current.item_kind, current.item_id)
      const taken = await db
        .prepare("SELECT id FROM production_recipes WHERE stage_id = ? AND item_kind = ? AND item_id = ? AND id <> ?")
        .get(stageId, current.item_kind, current.item_id, id)
      if (taken) throw new ProductionError(409, RECIPE_ON_STAGE)
    }
    await requireStageEquipment(db, input.equipmentId, stageId)
    await db.prepare("UPDATE production_recipes SET stage_id = ?, equipment_id = ?, amount = ? WHERE id = ?").run(stageId, input.equipmentId, input.amount, id)
    return true
  })
  return found ? getRecipe(id) : null
}

export async function deleteRecipe(id: number): Promise<boolean> {
  const db = await getProductionDb()
  return (await db.prepare("DELETE FROM production_recipes WHERE id = ?").run(id)).changes > 0
}

/** A new line of a norm («Добавление сырья» / «Добавление продукта»). An item already in that role is refused
 * (409; the reference's picker leaves the current lines out), so a norm is never overwritten unseen; the
 * product itself may be a ready line, never its own raw material. The new line is listed first, as the
 * reference lists the newest line first. The norm's row lock makes a double submit add it once. */
export async function addRecipeComponent(recipeId: number, input: ComponentInput): Promise<ProductionRecipe | null> {
  await getProductionDb()
  const found = await withTransaction(async (db) => {
    const recipe = (await db.prepare("SELECT item_kind, item_id FROM production_recipes WHERE id = ? FOR UPDATE").get(recipeId)) as { item_kind: string; item_id: number } | undefined
    if (!recipe) return false
    if (input.role === "raw" && input.kind === recipe.item_kind && input.id === recipe.item_id) throw new ProductionError(400, SELF_COMPONENT)
    const item = await requireCatalogItem(db, input.kind, input.id)
    const existing = await db
      .prepare("SELECT id FROM production_recipe_items WHERE recipe_id = ? AND role = ? AND item_kind = ? AND item_id = ?")
      .get(recipeId, input.role, item.kind, item.id)
    if (existing) throw new ProductionError(409, COMPONENT_EXISTS)
    const first = (await db.prepare("SELECT MIN(COALESCE(sort_order, id)) AS position FROM production_recipe_items WHERE recipe_id = ?").get(recipeId)) as
      | { position: number | string | null }
      | undefined
    const position = first?.position === null || first?.position === undefined ? null : Number(first.position) - 1
    await db
      .prepare("INSERT INTO production_recipe_items (recipe_id, role, item_kind, item_id, item_name, unit, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(recipeId, input.role, item.kind, item.id, item.name, item.unit, input.amount, position)
    return true
  })
  return found ? getRecipe(recipeId) : null
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

// ---------------------------------------------------------------------------
// Operations of a stage product («Прикрепить операцию»)
// ---------------------------------------------------------------------------

/** The reference's POST /manufacture/product_operations/ {operations, products}: every given operation is
 * attached to every given stage product; pairs attached already stay as they are. An unknown product or
 * operation refuses the whole request (404). FOR KEY SHARE makes a parallel delete of one of them wait for
 * the new links (an attached operation is then kept: deleteOperation counts them). Returns the number of
 * new links. */
export async function attachRecipeOperations(recipeIds: number[], operationIds: number[]): Promise<number> {
  await getProductionDb()
  const recipes = [...new Set(recipeIds)]
  const operations = [...new Set(operationIds)]
  return withTransaction(async (db) => {
    const foundRecipes = (await db.prepare("SELECT id FROM production_recipes WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE").all({ ids: recipes })) as Array<{ id: number }>
    if (foundRecipes.length !== recipes.length) throw new ProductionError(404, "Продукт этапа не найден")
    const foundOperations = (await db.prepare("SELECT id FROM production_operations WHERE id = ANY(@ids::int[]) ORDER BY id FOR KEY SHARE").all({ ids: operations })) as Array<{ id: number }>
    if (foundOperations.length !== operations.length) throw new ProductionError(404, "Операция не найдена")
    const result = await db
      .prepare(
        `INSERT INTO production_product_operations (recipe_id, operation_id, created_at)
         SELECT r.id, o.id, @now FROM unnest(@recipes::int[]) AS r(id) CROSS JOIN unnest(@operations::int[]) AS o(id)
         ON CONFLICT (recipe_id, operation_id) DO NOTHING`,
      )
      .run({ recipes, operations, now: nowIso() })
    return result.changes
  })
}

/** Detaches one operation from its stage product: the product's refreshed norm, or null when there is no such link. */
export async function detachRecipeOperation(linkId: number): Promise<ProductionRecipe | null> {
  const db = await getProductionDb()
  const row = (await db.prepare("DELETE FROM production_product_operations WHERE id = ? RETURNING recipe_id").get(linkId)) as { recipe_id: number } | undefined
  return row ? getRecipe(row.recipe_id) : null
}
