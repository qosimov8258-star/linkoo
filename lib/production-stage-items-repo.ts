import "server-only"

import { getDb } from "@/lib/db"

export type ProductionStageItem = {
  id: number
  stageId: number
  kind: "product" | "operation"
  name: string
  type: string
  quantity: number | null
  equipment: string | null
}

type Row = {
  id: number
  stage_id: number
  kind: string
  name: string
  type: string
  quantity: number | null
  equipment: string | null
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS production_stage_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      quantity INTEGER,
      equipment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToItem(row: Row): ProductionStageItem {
  return {
    id: row.id,
    stageId: row.stage_id,
    kind: row.kind === "operation" ? "operation" : "product",
    name: row.name,
    type: row.type,
    quantity: row.quantity,
    equipment: row.equipment,
  }
}

export type ProductionStageItemInput = {
  stageId: number
  kind: "product" | "operation"
  name: string
  type: string
  quantity: number | null
  equipment: string | null
}

export function parseProductionStageItemInput(body: unknown): ProductionStageItemInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const stageId = Number(value.stageId)
  if (!Number.isFinite(stageId) || stageId <= 0) return null
  const kind = value.kind === "operation" ? "operation" : value.kind === "product" ? "product" : null
  if (!kind) return null
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const type = typeof value.type === "string" ? value.type.trim() : ""
  const quantity =
    kind === "product" ? Math.max(1, Number(value.quantity) || 1) : null
  const equipment = kind === "operation" ? (typeof value.equipment === "string" ? value.equipment.trim() || "N/A" : "N/A") : null
  return { stageId, kind, name, type, quantity, equipment }
}

export async function listProductionStageItems(stageId?: number): Promise<ProductionStageItem[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = stageId
    ? ((await db.prepare("SELECT * FROM production_stage_items WHERE stage_id = ? ORDER BY id ASC").all(stageId)) as Row[])
    : ((await db.prepare("SELECT * FROM production_stage_items ORDER BY id ASC").all()) as Row[])
  return rows.map(rowToItem)
}

export async function getProductionStageItem(id: number): Promise<ProductionStageItem | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM production_stage_items WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToItem(row) : null
}

export async function createProductionStageItem(input: ProductionStageItemInput): Promise<ProductionStageItem> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO production_stage_items (stage_id, kind, name, type, quantity, equipment)
       VALUES (@stageId, @kind, @name, @type, @quantity, @equipment)`,
      )
      .run({
        stageId: input.stageId,
        kind: input.kind,
        name: input.name,
        type: input.type,
        quantity: input.quantity,
        equipment: input.equipment,
      }))
  return (await getProductionStageItem(Number(result.lastInsertRowid)))!
}

export async function updateProductionStageItem(id: number, input: ProductionStageItemInput): Promise<ProductionStageItem | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getProductionStageItem(id))) return null
  await db.prepare(
        `UPDATE production_stage_items SET
       stage_id = @stageId, kind = @kind, name = @name, type = @type,
       quantity = @quantity, equipment = @equipment, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        stageId: input.stageId,
        kind: input.kind,
        name: input.name,
        type: input.type,
        quantity: input.quantity,
        equipment: input.equipment,
      })
  return (await getProductionStageItem(id))
}

export async function deleteProductionStageItem(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM production_stage_items WHERE id = ?").run(id)).changes > 0
}
