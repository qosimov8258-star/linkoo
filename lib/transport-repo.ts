import "server-only"

import { getDb } from "@/lib/db"

export type TransportVehicle = {
  id: number
  name: string
  plateNumber: string
  driver: string
  branch: string
  status: string
  note: string
}

type Row = {
  id: number
  name: string
  plate_number: string
  driver: string
  branch: string
  status: string
  note: string
}

export const TRANSPORT_STATUSES = ["Активен", "На обслуживании", "Неактивен"] as const

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transport_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plate_number TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Активен',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToVehicle(row: Row): TransportVehicle {
  return {
    id: row.id,
    name: row.name,
    plateNumber: row.plate_number,
    driver: row.driver,
    branch: row.branch,
    status: row.status,
    note: row.note,
  }
}

export type TransportVehicleInput = {
  name: string
  plateNumber: string
  driver: string
  branch: string
  status: string
  note: string
}

export function parseTransportVehicleInput(body: unknown): TransportVehicleInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const status = typeof value.status === "string" && TRANSPORT_STATUSES.includes(value.status as (typeof TRANSPORT_STATUSES)[number])
    ? value.status
    : TRANSPORT_STATUSES[0]
  return {
    name,
    plateNumber: typeof value.plateNumber === "string" ? value.plateNumber.trim() : "",
    driver: typeof value.driver === "string" ? value.driver.trim() : "",
    branch: typeof value.branch === "string" ? value.branch.trim() : "",
    status,
    note: typeof value.note === "string" ? value.note.trim() : "",
  }
}

export async function listTransportVehicles(): Promise<TransportVehicle[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM transport_vehicles ORDER BY id ASC").all()) as Row[]).map(rowToVehicle)
}

export async function getTransportVehicle(id: number): Promise<TransportVehicle | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM transport_vehicles WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToVehicle(row) : null
}

export async function createTransportVehicle(input: TransportVehicleInput): Promise<TransportVehicle> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        "INSERT INTO transport_vehicles (name, plate_number, driver, branch, status, note) VALUES (@name, @plateNumber, @driver, @branch, @status, @note)",
      )
      .run(input))
  return (await getTransportVehicle(Number(result.lastInsertRowid)))!
}

export async function updateTransportVehicle(id: number, input: TransportVehicleInput): Promise<TransportVehicle | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getTransportVehicle(id))) return null
  await db.prepare(
        "UPDATE transport_vehicles SET name = @name, plate_number = @plateNumber, driver = @driver, branch = @branch, status = @status, note = @note, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, ...input })
  return (await getTransportVehicle(id))
}

export async function deleteTransportVehicle(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM transport_vehicles WHERE id = ?").run(id)).changes > 0
}
