import "server-only"

import { getDb } from "@/lib/db"
import { formatInventoryDate } from "@/components/analytics/inventory-items-data"
import type { InventoryItem } from "@/components/analytics/inventory-items-data"

type Row = {
  id: number
  serial_number: string
  client: string
  inventory_type: string
  inventory_code: string
  warehouse: string
  condition: string
  responsible: string
  attach_date: string
  created_date: string
  check_date: string
  approved: number
}

function rowToItem(row: Row): InventoryItem {
  return {
    id: row.id,
    serialNumber: row.serial_number,
    client: row.client,
    inventoryType: row.inventory_type,
    inventoryCode: row.inventory_code,
    warehouse: row.warehouse,
    condition: row.condition,
    responsible: row.responsible,
    attachDate: row.attach_date,
    createdDate: row.created_date,
    checkDate: row.check_date,
    approved: row.approved === 1,
  }
}

export type InventoryItemInput = Omit<InventoryItem, "id" | "createdDate">

export async function listInventoryItems(): Promise<InventoryItem[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM inventory_items ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToItem)
}

export async function getInventoryItem(id: number): Promise<InventoryItem | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToItem(row) : null
}

function toParams(input: InventoryItemInput) {
  return {
    serialNumber: input.serialNumber,
    client: input.client,
    inventoryType: input.inventoryType,
    inventoryCode: input.inventoryCode,
    warehouse: input.warehouse,
    condition: input.condition,
    responsible: input.responsible,
    attachDate: input.attachDate,
    checkDate: input.checkDate,
    approved: input.approved ? 1 : 0,
  }
}

export async function createInventoryItem(input: InventoryItemInput): Promise<InventoryItem> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO inventory_items (
        serial_number, client, inventory_type, inventory_code, warehouse, condition, responsible,
        attach_date, created_date, check_date, approved
      ) VALUES (
        @serialNumber, @client, @inventoryType, @inventoryCode, @warehouse, @condition, @responsible,
        @attachDate, @createdDate, @checkDate, @approved
      )`,
      )
      .run({ ...toParams(input), createdDate: formatInventoryDate(new Date()) }))
  return (await getInventoryItem(Number(result.lastInsertRowid)))!
}

export async function updateInventoryItem(id: number, input: InventoryItemInput): Promise<InventoryItem | null> {
  if (!(await getInventoryItem(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE inventory_items SET
      serial_number = @serialNumber, client = @client, inventory_type = @inventoryType, inventory_code = @inventoryCode,
      warehouse = @warehouse, condition = @condition, responsible = @responsible, attach_date = @attachDate,
      check_date = @checkDate, approved = @approved, updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(input), id })
  return (await getInventoryItem(id))
}

export async function deleteInventoryItem(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM inventory_items WHERE id = ?").run(id))
  return result.changes > 0
}
