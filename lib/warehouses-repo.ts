import "server-only"

import { getDb } from "@/lib/db"
import type { Warehouse } from "@/components/analytics/warehouses-data"

type WarehouseRow = {
  id: number
  name: string
  address: string
  branch: string
  manager: string
  created_date: string
  online: number
  active: number
}

function rowToWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    branch: row.branch,
    manager: row.manager,
    createdDate: row.created_date,
    online: row.online === 1,
    active: row.active === 1,
  }
}

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function formatToday() {
  const date = new Date()
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export type WarehouseInput = { name: string; address: string; branch: string; manager: string; online: boolean; active?: boolean }

export function parseWarehouseInput(body: unknown): WarehouseInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const address = typeof value.address === "string" ? value.address.trim() : ""
  if (!name || !address) return null
  return {
    name,
    address,
    branch: typeof value.branch === "string" ? value.branch : "",
    manager: typeof value.manager === "string" ? value.manager : "",
    online: value.online === true,
    active: typeof value.active === "boolean" ? value.active : true,
  }
}

export async function listWarehouses(): Promise<Warehouse[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM warehouses ORDER BY id DESC").all()) as WarehouseRow[]).map(rowToWarehouse)
}

export async function getWarehouse(id: number): Promise<Warehouse | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM warehouses WHERE id = ?").get(id)) as WarehouseRow | undefined
  return row ? rowToWarehouse(row) : null
}

export async function createWarehouse(input: WarehouseInput): Promise<Warehouse> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO warehouses (name, address, branch, manager, created_date, online, active, updated_at)
       VALUES (@name, @address, @branch, @manager, @createdDate, @online, @active, datetime('now'))`,
      )
      .run({
        name: input.name,
        address: input.address,
        branch: input.branch,
        manager: input.manager,
        createdDate: formatToday(),
        online: input.online ? 1 : 0,
        active: input.active === false ? 0 : 1,
      }))
  return (await getWarehouse(Number(result.lastInsertRowid)))!
}

export async function updateWarehouse(id: number, input: WarehouseInput): Promise<Warehouse | null> {
  const db = getDb()
  if (!(await getWarehouse(id))) return null
  await db.prepare(
        `UPDATE warehouses SET name = @name, address = @address, branch = @branch, manager = @manager,
       online = @online, active = @active, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        address: input.address,
        branch: input.branch,
        manager: input.manager,
        online: input.online ? 1 : 0,
        active: input.active === false ? 0 : 1,
      })
  return (await getWarehouse(id))
}

export async function deleteWarehouse(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM warehouses WHERE id = ?").run(id)).changes > 0
}
