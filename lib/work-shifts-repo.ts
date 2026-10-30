import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

export type WorkShift = { id: number; name: string; beginTime: string; endTime: string }

type Row = { id: number; name: string; begin_time: string; end_time: string }

// "Смены" are this company's own: a fresh database starts without any. An older build seeded the
// reference account's two shifts; those rows are removed only while they are exactly the seed
// (same id, name and times to the second, never edited: updated_at = created_at).
const LEGACY_SEED: Row[] = [
  { id: 3, name: "1-smena", begin_time: "08:00:41", end_time: "18:00:17" },
  { id: 4, name: "2-smena", begin_time: "18:00:54", end_time: "00:00:04" },
]

const SCHEMA_VERSION = 2

declare global {
  var __linkoWorkShiftsSchema: { version: number; ready: Promise<void> } | undefined
}

/** work_shifts, once per process and outside any request transaction. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoWorkShiftsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:work_shifts:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS work_shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            begin_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
        await tx
          .prepare(
            `DELETE FROM work_shifts w
              USING jsonb_to_recordset(@rows::jsonb) AS s(id int, name text, begin_time text, end_time text)
              WHERE w.id = s.id AND w.name = s.name AND w.begin_time = s.begin_time AND w.end_time = s.end_time
                AND w.updated_at = w.created_at`,
          )
          .run({ rows: JSON.stringify(LEGACY_SEED) })
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoWorkShiftsSchema = undefined
      throw error
    })
    globalThis.__linkoWorkShiftsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoWorkShiftsSchema!.ready
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
