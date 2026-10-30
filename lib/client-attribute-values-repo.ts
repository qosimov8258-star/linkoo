import "server-only"

import { z } from "zod"

import { CHOICE_FIELD_TYPE, ensureClientAttributesSchema, findClientAttributeByName } from "@/lib/client-attributes-repo"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { keySql, nameKey } from "@/lib/platform-refs"

// The options of a "Выбор вариантов" client attribute (Значение атрибута). One row per attribute, stored under
// the attribute's own name (resolved on the server, NFC / case / spaces ignored). Each value is at most 255
// characters and kept once. Writes lock client_attributes (a rename waits) and then this table (lock order:
// attributes → values), so two parallel creates for one attribute cannot both store a row.

export type ClientAttributeValue = {
  id: number
  attribute: string
  values: string[]
}

type Row = { id: number; attribute: string; values_json: string }

export class ClientAttributeValueError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(message)
  }
}

const MAX_VALUE = 255
const MAX_VALUES = 1000

/** Body of POST /api/client-attribute-values and PUT /api/client-attribute-values/[id]. */
export const clientAttributeValueSchema = z.object({
  attribute: z.string({ error: "Обязательное поле" }).trim().min(1, { error: "Обязательное поле" }).max(255, { error: "Не более 255 символов" }),
  values: z
    .array(z.string({ error: "Неверные данные" }).trim().max(MAX_VALUE, { error: "Не более 255 символов" }), { error: "Неверные данные" })
    .max(MAX_VALUES, { error: "Слишком много значений" })
    .optional(),
})

export type ClientAttributeValueInput = { attribute: string; values: string[] }

/** The input of a parsed body: empty values dropped, each value kept once (NFC, case and spaces ignored). */
export function clientAttributeValueInput(data: z.infer<typeof clientAttributeValueSchema>): ClientAttributeValueInput {
  const seen = new Set<string>()
  const values: string[] = []
  for (const raw of data.values ?? []) {
    const value = raw.normalize("NFC")
    const key = nameKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return { attribute: data.attribute.normalize("NFC"), values }
}

function parseValues(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToAttributeValue(row: Row): ClientAttributeValue {
  return { id: row.id, attribute: row.attribute, values: parseValues(row.values_json) }
}

export async function listClientAttributeValues(): Promise<ClientAttributeValue[]> {
  await ensureClientAttributesSchema()
  return ((await getDb().prepare("SELECT id, attribute, values_json FROM client_attribute_values ORDER BY id ASC").all()) as Row[]).map(rowToAttributeValue)
}

export async function getClientAttributeValue(id: number, db: PgDb = getDb()): Promise<ClientAttributeValue | null> {
  await ensureClientAttributesSchema()
  const row = (await db.prepare("SELECT id, attribute, values_json FROM client_attribute_values WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToAttributeValue(row) : null
}

/** Lock order: attributes (a rename waits), then values. */
async function lockTables(tx: PgDb): Promise<void> {
  await tx.prepare("LOCK TABLE client_attributes IN SHARE MODE").run()
  await tx.prepare("LOCK TABLE client_attribute_values IN SHARE ROW EXCLUSIVE MODE").run()
}

/** The stored name of the attribute: it must exist and offer a choice of options. */
async function resolveAttribute(tx: PgDb, name: string): Promise<string> {
  const attribute = await findClientAttributeByName(name, tx)
  if (!attribute) throw new ClientAttributeValueError("Атрибут не найден", 400, "attribute")
  if (attribute.fieldType !== CHOICE_FIELD_TYPE) throw new ClientAttributeValueError("Значения задаются только для атрибута с выбором вариантов", 400, "attribute")
  return attribute.name
}

/** Another row already holding the values of `attribute` → 409. */
async function assertOneRowPerAttribute(tx: PgDb, attribute: string, exceptId: number): Promise<void> {
  const twin = await tx.prepare(`SELECT id FROM client_attribute_values WHERE ${keySql("attribute")} = ${keySql("?::text")} AND id <> ?`).get(attribute, exceptId)
  if (twin) throw new ClientAttributeValueError("Значения этого атрибута уже заданы", 409, "attribute")
}

export async function createClientAttributeValue(input: ClientAttributeValueInput): Promise<ClientAttributeValue> {
  await ensureClientAttributesSchema()
  const id = await withTransaction(async (tx) => {
    await lockTables(tx)
    const attribute = await resolveAttribute(tx, input.attribute)
    await assertOneRowPerAttribute(tx, attribute, 0)
    const result = await tx
      .prepare("INSERT INTO client_attribute_values (attribute, values_json) VALUES (@attribute, @values)")
      .run({ attribute, values: JSON.stringify(input.values) })
    return Number(result.lastInsertRowid)
  })
  return (await getClientAttributeValue(id))!
}

export async function updateClientAttributeValue(id: number, input: ClientAttributeValueInput): Promise<ClientAttributeValue | null> {
  await ensureClientAttributesSchema()
  const found = await withTransaction(async (tx) => {
    await lockTables(tx)
    if (!(await getClientAttributeValue(id, tx))) return false
    const attribute = await resolveAttribute(tx, input.attribute)
    await assertOneRowPerAttribute(tx, attribute, id)
    await tx
      .prepare("UPDATE client_attribute_values SET attribute = @attribute, values_json = @values, updated_at = datetime('now') WHERE id = @id")
      .run({ id, attribute, values: JSON.stringify(input.values) })
    return true
  })
  return found ? await getClientAttributeValue(id) : null
}

export async function deleteClientAttributeValue(id: number): Promise<boolean> {
  await ensureClientAttributesSchema()
  return (await getDb().prepare("DELETE FROM client_attribute_values WHERE id = ?").run(id)).changes > 0
}
