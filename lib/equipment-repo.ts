import "server-only"

import { z } from "zod"

import { getDb } from "@/lib/db"

// "Оборудования" (demo #/equipment, API manufacture/equipment/): Id | Наименование | Производство.
// The "Производство" select reads manufacturings (demo manufacture/manufacturing/).

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS manufacturings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      manufacturing_id INTEGER,
      photo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export type Equipment = { id: number; name: string; manufacturingId: number | null; manufacturing: string }
export type EquipmentDetail = Equipment & { photo: string }
export type EquipmentInput = { name: string; manufacturingId: number | null; photo: string | null | undefined }
export const equipmentInputSchema = z.object({
  name: z.string().trim().min(1),
  manufacturingId: z.number().int().positive().nullable().optional(),
  photo: z.string().max(3_000_000).nullable().optional(),
})

export type Manufacturing = { id: number; name: string }

type Row = { id: number; name: string; manufacturing_id: number | null; manufacturing: string | null; photo?: string }

const SELECT = `SELECT e.id, e.name, e.manufacturing_id, m.name AS manufacturing FROM equipment e LEFT JOIN manufacturings m ON m.id = e.manufacturing_id`

const toEquipment = (row: Row): Equipment => ({ id: row.id, name: row.name, manufacturingId: row.manufacturing_id, manufacturing: row.manufacturing ?? "" })

export async function listEquipment(search = ""): Promise<Equipment[]> {
  const db = getDb()
  await ensureSchema(db)
  const needle = search.trim().toLowerCase()
  const rows = (await db.prepare(`${SELECT} WHERE (@needle = '' OR strpos(lower(e.name), @needle) > 0) ORDER BY e.id ASC`).all({ needle })) as Row[]
  return rows.map(toEquipment)
}

export async function getEquipment(id: number): Promise<EquipmentDetail | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare(`SELECT e.id, e.name, e.manufacturing_id, m.name AS manufacturing, e.photo FROM equipment e LEFT JOIN manufacturings m ON m.id = e.manufacturing_id WHERE e.id = ?`).get(id)) as Row | undefined
  return row ? { ...toEquipment(row), photo: row.photo ?? "" } : null
}

export async function createEquipment(input: EquipmentInput): Promise<EquipmentDetail> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db.prepare("INSERT INTO equipment (name, manufacturing_id, photo) VALUES (@name, @manufacturingId, @photo)").run({ name: input.name, manufacturingId: input.manufacturingId, photo: input.photo ?? "" })
  return (await getEquipment(Number(result.lastInsertRowid)))!
}

/** `photo` undefined keeps the stored picture, null / "" removes it. */
export async function updateEquipment(id: number, input: EquipmentInput): Promise<EquipmentDetail | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getEquipment(id))) return null
  await db
    .prepare(`UPDATE equipment SET name = @name, manufacturing_id = @manufacturingId, photo = CASE WHEN @keep THEN photo ELSE @photo END, updated_at = datetime('now') WHERE id = @id`)
    .run({ id, name: input.name, manufacturingId: input.manufacturingId, keep: input.photo === undefined, photo: input.photo ?? "" })
  return getEquipment(id)
}

export async function deleteEquipment(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM equipment WHERE id = ?").run(id)).changes > 0
}

/** Newest first, like the demo's manufacture/manufacturing/ select. */
export async function listManufacturings(search = ""): Promise<Manufacturing[]> {
  const db = getDb()
  await ensureSchema(db)
  const needle = search.trim().toLowerCase()
  return (await db.prepare("SELECT id, name FROM manufacturings WHERE (@needle = '' OR strpos(lower(name), @needle) > 0) ORDER BY id DESC").all({ needle })) as Manufacturing[]
}
