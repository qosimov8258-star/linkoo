import "server-only"

import { z } from "zod"

import { isUniqueViolation, nameField } from "@/lib/auth-request"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { keySql, nameKey } from "@/lib/platform-refs"
import { tableExists } from "@/lib/supplier-refs"

// Client attributes (Атрибуты клиента). Names are unique after NFC normalisation, case- and space-insensitively:
// a twin is refused with 409 under a table lock, so two parallel creates of one name cannot both succeed. The
// values of an attribute (lib/client-attribute-values-repo.ts) store the attribute NAME, so a rename follows to
// them in the same transaction.

export type ClientAttribute = {
  id: number
  name: string
  fieldType: string
  required: boolean
  cacheNumber: number | null
}

type Row = {
  id: number
  name: string
  field_type: string
  required: number
  market_cache_number: number | null
}

export class ClientAttributeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export const CLIENT_ATTRIBUTE_EXISTS = "Такой атрибут уже существует"
export const CHOICE_FIELD_TYPE = "Выбор вариантов"
export const CLIENT_ATTRIBUTE_FIELD_TYPES = ["Цифровое поле", "Дата выборки", "Текстовое поле", CHOICE_FIELD_TYPE]

/** Body of POST /api/client-attributes and PUT /api/client-attributes/[id]. */
export const clientAttributeSchema = z.object({
  name: nameField("Обязательное поле", 255),
  fieldType: z.enum(CLIENT_ATTRIBUTE_FIELD_TYPES as [string, ...string[]]).optional(),
  required: z.boolean().optional(),
  cacheNumber: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable().optional(),
})

/** The input of a parsed body (an absent type is "Выбор вариантов"). */
export function clientAttributeInput(data: z.infer<typeof clientAttributeSchema>): ClientAttributeInput {
  return { name: data.name, fieldType: data.fieldType ?? CHOICE_FIELD_TYPE, required: data.required ?? false, cacheNumber: data.cacheNumber ?? null }
}

const SCHEMA_VERSION = 1

declare global {
  var __linkoClientAttributesSchema: { version: number; ready: Promise<void> } | undefined
}

/** Lazy, idempotent, once per process and outside any request transaction. */
export async function ensureClientAttributesSchema(): Promise<void> {
  if (globalThis.__linkoClientAttributesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_attributes:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS client_attributes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            field_type TEXT NOT NULL DEFAULT 'Выбор вариантов',
            required INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          ALTER TABLE client_attributes ADD COLUMN IF NOT EXISTS market_cache_number INTEGER;
          CREATE TABLE IF NOT EXISTS client_attribute_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attribute TEXT NOT NULL,
            values_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
        // Case- and space-insensitive unique names; skipped while an older database still holds twins
        // (the API refuses new ones either way, under the table lock).
        await tx.exec(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'client_attributes_name_key') THEN
              BEGIN
                CREATE UNIQUE INDEX client_attributes_name_key ON client_attributes (${keySql("name")});
              EXCEPTION WHEN unique_violation THEN
                RAISE NOTICE 'client_attributes_name_key skipped: duplicate names exist';
              END;
            END IF;
          END $$;
        `)
      }),
    ).catch((error) => {
      globalThis.__linkoClientAttributesSchema = undefined
      throw error
    })
    globalThis.__linkoClientAttributesSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoClientAttributesSchema!.ready
}

function rowToAttribute(row: Row): ClientAttribute {
  return {
    id: row.id,
    name: row.name,
    fieldType: row.field_type,
    required: !!row.required,
    cacheNumber: row.market_cache_number ?? null,
  }
}

export type ClientAttributeInput = {
  name: string
  fieldType: string
  required: boolean
  cacheNumber: number | null
}

const COLUMNS = "id, name, field_type, required, market_cache_number"

export async function listClientAttributes(): Promise<ClientAttribute[]> {
  await ensureClientAttributesSchema()
  return ((await getDb().prepare(`SELECT ${COLUMNS} FROM client_attributes ORDER BY id ASC`).all()) as Row[]).map(rowToAttribute)
}

export async function getClientAttribute(id: number, db: PgDb = getDb()): Promise<ClientAttribute | null> {
  await ensureClientAttributesSchema()
  const row = (await db.prepare(`SELECT ${COLUMNS} FROM client_attributes WHERE id = ?`).get(id)) as Row | undefined
  return row ? rowToAttribute(row) : null
}

/** The attribute whose name has the same key as `name` (NFC, case and spaces ignored). */
export async function findClientAttributeByName(name: string, db: PgDb = getDb()): Promise<ClientAttribute | null> {
  await ensureClientAttributesSchema()
  const row = (await db
    .prepare(`SELECT ${COLUMNS} FROM client_attributes WHERE ${keySql("name")} = ${keySql("?::text")} ORDER BY id LIMIT 1`)
    .get(name.normalize("NFC"))) as Row | undefined
  return row ? rowToAttribute(row) : null
}

async function assertNameFree(tx: PgDb, name: string, exceptId: number): Promise<void> {
  const twin = await tx.prepare(`SELECT id FROM client_attributes WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new ClientAttributeError(CLIENT_ATTRIBUTE_EXISTS, 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new ClientAttributeError(CLIENT_ATTRIBUTE_EXISTS, 409)
  throw error
}

const lockAttributes = (tx: PgDb) => tx.prepare("LOCK TABLE client_attributes IN SHARE ROW EXCLUSIVE MODE").run()

export async function createClientAttribute(input: ClientAttributeInput): Promise<ClientAttribute> {
  await ensureClientAttributesSchema()
  const name = input.name.normalize("NFC")
  try {
    const id = await withTransaction(async (tx) => {
      await lockAttributes(tx)
      await assertNameFree(tx, name, 0)
      const result = await tx
        .prepare("INSERT INTO client_attributes (name, field_type, required, market_cache_number) VALUES (@name, @fieldType, @required, @cacheNumber)")
        .run({ name, fieldType: input.fieldType, required: input.required ? 1 : 0, cacheNumber: input.cacheNumber })
      return Number(result.lastInsertRowid)
    })
    return (await getClientAttribute(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

export async function updateClientAttribute(id: number, input: ClientAttributeInput): Promise<ClientAttribute | null> {
  await ensureClientAttributesSchema()
  const name = input.name.normalize("NFC")
  try {
    const found = await withTransaction(async (tx) => {
      await lockAttributes(tx)
      const previous = await getClientAttribute(id, tx)
      if (!previous) return false
      if (nameKey(previous.name.normalize("NFC")) !== nameKey(name)) await assertNameFree(tx, name, id)
      if (previous.name !== name && (await tableExists(tx, "client_attribute_values"))) {
        await tx.prepare("UPDATE client_attribute_values SET attribute = ? WHERE attribute = ?").run(name, previous.name)
      }
      await tx
        .prepare(
          "UPDATE client_attributes SET name = @name, field_type = @fieldType, required = @required, market_cache_number = @cacheNumber, updated_at = datetime('now') WHERE id = @id",
        )
        .run({ id, name, fieldType: input.fieldType, required: input.required ? 1 : 0, cacheNumber: input.cacheNumber })
      return true
    })
    return found ? await getClientAttribute(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

export async function deleteClientAttribute(id: number): Promise<boolean> {
  await ensureClientAttributesSchema()
  return withTransaction(async (tx) => {
    await lockAttributes(tx)
    const attribute = await getClientAttribute(id, tx)
    if (!attribute) return false
    if (await tableExists(tx, "client_attribute_values")) await tx.prepare("DELETE FROM client_attribute_values WHERE attribute = ?").run(attribute.name)
    return (await tx.prepare("DELETE FROM client_attributes WHERE id = ?").run(id)).changes > 0
  })
}
