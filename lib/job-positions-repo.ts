import "server-only"

import { readSetting, writeSetting } from "@/lib/app-settings"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { isUniqueViolation } from "@/lib/auth-request"
import { refreshEmployeePositions, withEmployeeLinks } from "@/lib/employees-usage"
import { cascadeNameRename, existingReferences, keySql, nameKey, usageOf, type Usage } from "@/lib/platform-refs"
import { refDateTime } from "@/lib/ref-date"

export type JobPosition = { id: number; name: string; date: string; createdAt: string }

type Row = { id: number; name: string; created_at: string }

let schemaReady: Promise<void> | null = null

// Должности a new company starts with, as a new Linko account has them (the first positions of the reference account).
// Written once, only into an empty table (the app_settings mark keeps deleted ones from coming back).
const DEFAULT_POSITIONS = ["Менеджер", "Агент", "Доставщик", "Инкассатор", "Оператор", "Супервайзер", "Мерчендайзер", "Админ", "Кассир", "Бухгалтер", "Зав. склад"]
const SEED_KEY = "seed:default_job_positions"

async function seedDefaultPositions(): Promise<void> {
  if (await readSetting(getDb(), SEED_KEY)) return
  await withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:default-job-positions')) AS ok").get()
    if (await readSetting(tx, SEED_KEY)) return
    const count = (await tx.prepare("SELECT COUNT(*)::int AS n FROM job_positions").get()) as { n: number }
    if (!count.n) for (const name of DEFAULT_POSITIONS) await tx.prepare("INSERT INTO job_positions (name) VALUES (?)").run(name)
    await writeSetting(tx, SEED_KEY, count.n ? "skipped: the company has its own positions" : "written")
  })
}

/** The table (and the default positions of a new company). */
export async function ensureJobPositionsSchema() {
  if (!schemaReady) {
    schemaReady = outsideTransaction(async () => {
      const db = getDb()
      await db.exec(`
        CREATE TABLE IF NOT EXISTS job_positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      // Case-insensitive unique names; skipped while an older database still
      // holds twins (the API refuses new ones either way).
      await db.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'job_positions_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX job_positions_name_key ON job_positions (lower(btrim(name)));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'job_positions_name_key skipped: duplicate names exist';
            END;
          END IF;
        END $$;
      `)
      await seedDefaultPositions()
    }).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

export class JobPositionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: Usage[],
  ) {
    super(message)
  }
}

function rowToPosition(row: Row): JobPosition {
  return { id: row.id, name: row.name, date: refDateTime(row.created_at), createdAt: row.created_at }
}

export type JobPositionInput = { name: string }

// Employees (and production staff) store the position NAME.
const REFERENCES = [
  { table: "employees", column: "position", kind: "name" as const },
  { table: "production_staff", column: "position", kind: "name" as const },
  // База знания: the articles published to the position (deleting it would publish an article
  // whose only position it was to everybody).
  { table: "knowledge_base_article_positions", column: "position_id", kind: "id" as const },
]

export async function listJobPositions(): Promise<JobPosition[]> {
  const db = getDb()
  await ensureJobPositionsSchema()
  return ((await db.prepare("SELECT * FROM job_positions ORDER BY id DESC").all()) as Row[]).map(rowToPosition)
}

export async function getJobPosition(id: number): Promise<JobPosition | null> {
  const db = getDb()
  await ensureJobPositionsSchema()
  const row = (await db.prepare("SELECT * FROM job_positions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPosition(row) : null
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM job_positions WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new JobPositionError("Такая должность уже существует", 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new JobPositionError("Такая должность уже существует", 409)
  throw error
}

export async function createJobPosition(input: JobPositionInput): Promise<JobPosition> {
  await ensureJobPositionsSchema()
  try {
    const id = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE job_positions IN SHARE ROW EXCLUSIVE MODE").run()
      await assertNameFree(tx, input.name, 0)
      const result = await tx.prepare("INSERT INTO job_positions (name) VALUES (@name)").run({ name: input.name })
      return Number(result.lastInsertRowid)
    })
    return (await getJobPosition(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Renames the position; employees holding the old name follow in the same transaction. */
export async function updateJobPosition(id: number, input: JobPositionInput): Promise<JobPosition | null> {
  await ensureJobPositionsSchema()
  try {
    const found = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE job_positions IN SHARE ROW EXCLUSIVE MODE").run()
      const current = (await tx.prepare("SELECT * FROM job_positions WHERE id = ?").get(id)) as Row | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      await tx.prepare("UPDATE job_positions SET name = @name, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name })
      await cascadeNameRename(tx, await existingReferences(tx, REFERENCES), current.name, input.name)
      // employees.position ("access right · job", read by tracking, attendance and cashboxes) of the employees linked by job_id.
      await refreshEmployeePositions(tx, "job_positions", id)
      return true
    })
    return found ? await getJobPosition(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused (409 with the usage list) while employees hold the position. */
export async function deleteJobPosition(id: number): Promise<boolean> {
  await ensureJobPositionsSchema()
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT * FROM job_positions WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    // Employees by job_id (and legacy ones by the plain job name in position), each counted once.
    const usage = await withEmployeeLinks(tx, "job_positions", { id, name: current.name }, await usageOf(tx, await existingReferences(tx, REFERENCES), { id, name: current.name }))
    if (usage.length) throw new JobPositionError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM job_positions WHERE id = ?").run(id)).changes > 0
  })
}
