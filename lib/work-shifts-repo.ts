import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { textKey } from "@/lib/production-schema"

export type WorkShift = { id: number; name: string; beginTime: string; endTime: string }

/** A shift that production staff rows hold (Этапы производства → Персонал references it by id): 409 with the
 * usage list, as for every master record in use. Labels are i18n keys. */
export class WorkShiftInUseError extends Error {
  readonly status = 409
  constructor(readonly usage: Array<{ table: string; label: string; count: number }>) {
    super("Удаление невозможно из-за связи с другими данными")
  }
}

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

// Активность's shift entries (production_movements rows outside any batch, made or raw) store the name of their
// Смены shift (lib/production-activity-repo.ts lockShift, which reads the shift row FOR SHARE while it saves one): a
// rename cascades into them, and a shift they name cannot be deleted. production_movements is a lazy table (missing
// where Производство was never opened), so it is looked for first. Names match as the entries' do: textKey.
const SHIFT_ENTRIES = "party_id IS NULL AND direction IN ('made', 'raw') AND shift IS NOT NULL AND shift <> ''"

async function hasShiftEntries(tx: PgDb): Promise<boolean> {
  const row = (await tx.prepare("SELECT to_regclass('production_movements') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** The spellings of shift `name` on the shift entries and how many entries carry each. Empty when another shift of
 * the directory has the same name: the entries may be that one's, so they are left to it. */
async function entryShiftNames(tx: PgDb, id: number, name: string): Promise<Array<{ shift: string; count: number }>> {
  const key = textKey(name)
  if (!key || !(await hasShiftEntries(tx))) return []
  const others = (await tx.prepare("SELECT name FROM work_shifts WHERE id <> ?").all(id)) as Array<{ name: string | null }>
  if (others.some((other) => textKey(other.name) === key)) return []
  const rows = (await tx.prepare(`SELECT shift, COUNT(*)::int AS n FROM production_movements WHERE ${SHIFT_ENTRIES} GROUP BY shift`).all()) as Array<{ shift: string; n: number | string }>
  return rows.filter((row) => textKey(row.shift) === key).map((row) => ({ shift: row.shift, count: Number(row.n) || 0 }))
}

export async function updateWorkShift(id: number, input: WorkShiftInput): Promise<WorkShift | null> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    // The row lock makes a shift entry being saved with this shift (FOR SHARE) commit first, so the cascade sees it.
    const current = (await tx.prepare("SELECT id, name FROM work_shifts WHERE id = ? FOR UPDATE").get(id)) as { id: number; name: string | null } | undefined
    if (!current) return null
    await tx
      .prepare("UPDATE work_shifts SET name = @name, begin_time = @beginTime, end_time = @endTime, updated_at = datetime('now') WHERE id = @id")
      .run({ id, ...input })
    const oldName = String(current.name ?? "").trim()
    const newName = input.name.trim()
    if (oldName !== newName) {
      const spellings = (await entryShiftNames(tx, id, oldName)).map((row) => row.shift)
      if (spellings.length) {
        await tx.prepare(`UPDATE production_movements SET shift = @name WHERE ${SHIFT_ENTRIES} AND shift = ANY(@spellings::text[])`).run({ name: newName, spellings })
      }
    }
    const row = (await tx.prepare("SELECT id, name, begin_time, end_time FROM work_shifts WHERE id = ?").get(id)) as Row | undefined
    return row ? toShift(row) : null
  })
}

/** work_shifts before a transaction that reads it (the DDL never runs inside one). */
export function ensureWorkShiftsSchema(): Promise<void> {
  return ensureSchema()
}

/** The staff rows (Этапы производства → Персонал) that hold shift `id`, the shift entries of Активность that
 * name it, and the worker shift sessions on it. production_staff.shift_id comes with the production schema
 * (lib/production-schema.ts); before it exists nothing refers to a shift by id. */
async function shiftUsage(tx: PgDb, id: number, name: string): Promise<Array<{ table: string; label: string; count: number }>> {
  const usage: Array<{ table: string; label: string; count: number }> = []
  const column = await tx
    .prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'production_staff' AND column_name = 'shift_id'")
    .get()
  if (column) {
    const row = (await tx.prepare("SELECT COUNT(*)::int AS n FROM production_staff WHERE shift_id = ?").get(id)) as { n: number | string } | undefined
    const count = Number(row?.n ?? 0)
    if (count > 0) usage.push({ table: "production_staff", label: "Сотрудники производства", count })
  }
  const entries = (await entryShiftNames(tx, id, name)).reduce((sum, row) => sum + row.count, 0)
  if (entries > 0) usage.push({ table: "production_movements", label: "Производство", count: entries })
  // The worker shift sessions (Активность → «Смены», lib/production-sessions-repo.ts) keep the shift by id, with no
  // foreign key; their table comes with the production schema, so before it exists there is nothing to count.
  const sessions = (await tx.prepare("SELECT to_regclass('production_shift_sessions') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (sessions?.ok) {
    const row = (await tx.prepare("SELECT COUNT(*)::int AS n FROM production_shift_sessions WHERE shift_id = ?").get(id)) as { n: number | string } | undefined
    const count = Number(row?.n ?? 0)
    if (count > 0) usage.push({ table: "production_shift_sessions", label: "Смены работников", count })
  }
  return usage
}

/** A shift in use stays (WorkShiftInUseError). The row lock makes a staff save that picks the shift (it reads
 * the shift FOR KEY SHARE) or a shift entry being saved with it (FOR SHARE) wait, so the count cannot miss it. */
export async function deleteWorkShift(id: number): Promise<boolean> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT id, name FROM work_shifts WHERE id = ? FOR UPDATE").get(id)) as { id: number; name: string | null } | undefined
    if (!current) return false
    const usage = await shiftUsage(tx, id, String(current.name ?? ""))
    if (usage.length) throw new WorkShiftInUseError(usage)
    return (await tx.prepare("DELETE FROM work_shifts WHERE id = ?").run(id)).changes > 0
  })
}
