import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { keySql, nameKey } from "@/lib/platform-refs"

// Типы отказов (refusal types). Names are unique, case- and space-insensitive
// ("Kafe", "KAFE" and "Kafe  " are one name): a create or rename to a taken
// name is refused with 409, like client types.

export type RefusalType = {
  id: number
  name: string
  resolution: string
}

type Row = {
  id: number
  name: string
  resolution: string
}

export const REFUSAL_TYPE_DUPLICATE = "Такой тип отказа уже существует"

export type RefusalTypeUsage = { label: string; count: number }

export class RefusalTypeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: RefusalTypeUsage[],
  ) {
    super(message)
  }
}

const SCHEMA_VERSION = 2

declare global {
  var __linkoRefusalTypesSchema: { version: number; ready: Promise<void> } | undefined
}

/** Table and the unique index on the normalized name, once per process. The
 * index is skipped (the API still refuses new twins) while an older database
 * holds duplicate names. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoRefusalTypesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:refusal_types:schema'))")
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS refusal_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          resolution TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      await tx.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'refusal_types_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX refusal_types_name_key ON refusal_types ((${keySql("name")}));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'refusal_types_name_key skipped: duplicate names exist';
            END;
          END IF;
        END $$;
      `)
    })).catch((error) => {
      globalThis.__linkoRefusalTypesSchema = undefined
      throw error
    })
    globalThis.__linkoRefusalTypesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoRefusalTypesSchema!.ready
}

function rowToRefusalType(row: Row): RefusalType {
  return { id: row.id, name: row.name, resolution: row.resolution }
}

export type RefusalTypeInput = { name: string; resolution: string }

export function parseRefusalTypeInput(body: unknown): RefusalTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const resolution = typeof value.resolution === "string" ? value.resolution.trim() : ""
  return { name, resolution }
}

export async function listRefusalTypes(): Promise<RefusalType[]> {
  await ensureSchema()
  return ((await getDb().prepare("SELECT * FROM refusal_types ORDER BY id ASC").all()) as Row[]).map(rowToRefusalType)
}

export async function getRefusalType(id: number): Promise<RefusalType | null> {
  await ensureSchema()
  const row = (await getDb().prepare("SELECT * FROM refusal_types WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRefusalType(row) : null
}

/** Serialises the uniqueness check with the insert / rename. */
async function lockNames(db: PgDb) {
  await db.prepare("LOCK TABLE refusal_types IN SHARE ROW EXCLUSIVE MODE").run()
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM refusal_types WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new RefusalTypeError(REFUSAL_TYPE_DUPLICATE, 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new RefusalTypeError(REFUSAL_TYPE_DUPLICATE, 409)
  throw error
}

/** 409 when another refusal type has the same name (case- and space-insensitive). */
export async function createRefusalType(input: RefusalTypeInput): Promise<RefusalType> {
  await ensureSchema()
  try {
    const id = await withTransaction(async (tx) => {
      await lockNames(tx)
      await assertNameFree(tx, input.name, 0)
      const result = await tx.prepare("INSERT INTO refusal_types (name, resolution) VALUES (@name, @resolution)").run(input)
      return Number(result.lastInsertRowid)
    })
    return (await getRefusalType(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Renaming to another type's name is refused (409); re-saving its own name (any case) is not. */
export async function updateRefusalType(id: number, input: RefusalTypeInput): Promise<RefusalType | null> {
  await ensureSchema()
  try {
    const found = await withTransaction(async (tx) => {
      await lockNames(tx)
      const current = (await tx.prepare("SELECT * FROM refusal_types WHERE id = ?").get(id)) as Row | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      await tx
        .prepare("UPDATE refusal_types SET name = @name, resolution = @resolution, updated_at = datetime('now') WHERE id = @id")
        .run({ id, name: input.name, resolution: input.resolution })
      return true
    })
    return found ? await getRefusalType(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused (409 + usage) while refusals of the mobile app (field_refusals) use the type.
 * The row lock waits for a visit finishing with this type (it share-locks the row). */
export async function deleteRefusalType(id: number): Promise<boolean> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    const row = await tx.prepare("SELECT id FROM refusal_types WHERE id = ? FOR UPDATE").get(id)
    if (!row) return false
    const table = (await tx.prepare("SELECT to_regclass('field_refusals') IS NOT NULL AS ok").get()) as { ok: boolean }
    if (table.ok) {
      const used = (await tx.prepare("SELECT COUNT(*)::int AS n FROM field_refusals WHERE refusal_type_id = ?").get(id)) as { n: number }
      if (used.n > 0) {
        throw new RefusalTypeError("Удаление невозможно из-за связи с другими данными", 409, [{ label: "Отказы", count: used.n }])
      }
    }
    return (await tx.prepare("DELETE FROM refusal_types WHERE id = ?").run(id)).changes > 0
  })
}
