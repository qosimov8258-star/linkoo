import "server-only"

import { getDb } from "@/lib/db"

export type WorkShift = { id: number; name: string; beginTime: string; endTime: string }

type Row = { id: number; name: string; begin_time: string; end_time: string }

// Reference rows (staff/shift/): ids 3 and 4, times with seconds.
const SEED: Row[] = [
  { id: 3, name: "1-smena", begin_time: "08:00:41", end_time: "18:00:17" },
  { id: 4, name: "2-smena", begin_time: "18:00:54", end_time: "00:00:04" },
]

let ready: Promise<void> | null = null

async function ensureSchema() {
  ready ??= (async () => {
    const db = getDb()
    const existing = (await db.prepare("SELECT to_regclass('work_shifts') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
    await db.exec(`
      CREATE TABLE IF NOT EXISTS work_shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        begin_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    if (existing?.ok) return
    for (const row of SEED) {
      await db.prepare("INSERT INTO work_shifts (id, name, begin_time, end_time) VALUES (@id, @name, @begin_time, @end_time)").run(row)
    }
    await db.exec("SELECT setval(pg_get_serial_sequence('work_shifts', 'id'), (SELECT MAX(id) FROM work_shifts))")
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

function toShift(row: Row): WorkShift {
  return { id: row.id, name: row.name, beginTime: row.begin_time, endTime: row.end_time }
}

export type WorkShiftInput = { name: string; beginTime: string; endTime: string }

export async function listWorkShifts(): Promise<WorkShift[]> {
  await ensureSchema()
  return ((await getDb().prepare("SELECT id, name, begin_time, end_time FROM work_shifts ORDER BY id").all()) as Row[]).map(toShift)
}

export async function getWorkShift(id: number): Promise<WorkShift | null> {
  await ensureSchema()
  const row = (await getDb().prepare("SELECT id, name, begin_time, end_time FROM work_shifts WHERE id = ?").get(id)) as Row | undefined
  return row ? toShift(row) : null
}

export async function createWorkShift(input: WorkShiftInput): Promise<WorkShift> {
  await ensureSchema()
  const result = await getDb()
    .prepare("INSERT INTO work_shifts (name, begin_time, end_time) VALUES (@name, @beginTime, @endTime)")
    .run(input)
  return (await getWorkShift(Number(result.lastInsertRowid)))!
}

export async function updateWorkShift(id: number, input: WorkShiftInput): Promise<WorkShift | null> {
  await ensureSchema()
  if (!(await getWorkShift(id))) return null
  await getDb()
    .prepare("UPDATE work_shifts SET name = @name, begin_time = @beginTime, end_time = @endTime, updated_at = datetime('now') WHERE id = @id")
    .run({ id, ...input })
  return getWorkShift(id)
}

export async function deleteWorkShift(id: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM work_shifts WHERE id = ?").run(id)).changes > 0
}
