import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { keySql, nameKey } from "@/lib/platform-refs"

// Категории магазинов (store categories). Names are unique, case- and
// space-insensitive: a create or rename to a taken name is refused with 409,
// like client types.

export type StoreCategory = {
  id: number
  name: string
  createdDate: string
}

type Row = {
  id: number
  name: string
  created_at: string
}

export const STORE_CATEGORY_DUPLICATE = "Такая категория магазина уже существует"

export class StoreCategoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const SCHEMA_VERSION = 2

declare global {
  var __linkoStoreCategoriesSchema: { version: number; ready: Promise<void> } | undefined
}

/** Table and the unique index on the normalized name, once per process. The
 * index is skipped (the API still refuses new twins) while an older database
 * holds duplicate names. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoStoreCategoriesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:store_categories:schema'))")
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS store_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      await tx.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'store_categories_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX store_categories_name_key ON store_categories ((${keySql("name")}));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'store_categories_name_key skipped: duplicate names exist';
            END;
          END IF;
        END $$;
      `)
    })).catch((error) => {
      globalThis.__linkoStoreCategoriesSchema = undefined
      throw error
    })
    globalThis.__linkoStoreCategoriesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoStoreCategoriesSchema!.ready
}

function toItem(row: Row): StoreCategory {
  return { id: row.id, name: row.name, createdDate: row.created_at }
}

export type StoreCategoryInput = {
  name: string
}

export async function listStoreCategories(): Promise<StoreCategory[]> {
  await ensureSchema()
  return ((await getDb().prepare("SELECT id, name, created_at FROM store_categories ORDER BY id ASC").all()) as Row[]).map(toItem)
}

export async function getStoreCategory(id: number): Promise<StoreCategory | null> {
  await ensureSchema()
  const row = (await getDb().prepare("SELECT id, name, created_at FROM store_categories WHERE id = ?").get(id)) as Row | undefined
  return row ? toItem(row) : null
}

/** Serialises the uniqueness check with the insert / rename. */
async function lockNames(db: PgDb) {
  await db.prepare("LOCK TABLE store_categories IN SHARE ROW EXCLUSIVE MODE").run()
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM store_categories WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new StoreCategoryError(STORE_CATEGORY_DUPLICATE, 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new StoreCategoryError(STORE_CATEGORY_DUPLICATE, 409)
  throw error
}

/** 409 when another category has the same name (case- and space-insensitive). */
export async function createStoreCategory(input: StoreCategoryInput): Promise<StoreCategory> {
  await ensureSchema()
  try {
    const id = await withTransaction(async (tx) => {
      await lockNames(tx)
      await assertNameFree(tx, input.name, 0)
      const result = await tx.prepare("INSERT INTO store_categories (name) VALUES (@name)").run({ name: input.name })
      return Number(result.lastInsertRowid)
    })
    return (await getStoreCategory(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Renaming to another category's name is refused (409); re-saving its own name (any case) is not. */
export async function updateStoreCategory(id: number, input: StoreCategoryInput): Promise<StoreCategory | null> {
  await ensureSchema()
  try {
    const found = await withTransaction(async (tx) => {
      await lockNames(tx)
      const current = (await tx.prepare("SELECT id, name FROM store_categories WHERE id = ?").get(id)) as Pick<Row, "id" | "name"> | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      await tx.prepare("UPDATE store_categories SET name = @name, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name })
      return true
    })
    return found ? await getStoreCategory(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

export async function deleteStoreCategory(id: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM store_categories WHERE id = ?").run(id)).changes > 0
}
