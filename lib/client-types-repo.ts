import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { isUniqueViolation } from "@/lib/auth-request"
import { cascadeNameRename, existingReferences, keySql, nameKey, usageOf, type Usage } from "@/lib/platform-refs"
import { refDate } from "@/lib/ref-date"

// Client types (Типы клиентов). Names are unique (case / spacing-insensitive,
// 409). Clients store the type NAME, so a rename follows to them in the same
// transaction, and a type still used by clients cannot be deleted (409 with
// the usage list, contract 7).

export type ClientType = {
  id: number
  name: string
  supplier: string
  date: string
  parentId: number | null
  innRequired: boolean
}

type Row = { id: number; name: string; supplier: string; created_at: string; parent_id: number | null; inn_required: number }

export class ClientTypeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: Usage[],
  ) {
    super(message)
  }
}

const SCHEMA_VERSION = 2

declare global {
  var __linkoClientTypesSchema: { version: number; ready: Promise<void> } | undefined
}

async function ensureSchema(): Promise<void> {
  if (globalThis.__linkoClientTypesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(72120937)")
      await tx.exec(`
        CREATE TABLE IF NOT EXISTS client_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          supplier TEXT NOT NULL DEFAULT 'Не указано',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ALTER TABLE client_types ADD COLUMN IF NOT EXISTS parent_id INTEGER;
        ALTER TABLE client_types ADD COLUMN IF NOT EXISTS inn_required INTEGER NOT NULL DEFAULT 0;
      `)
      // Case-insensitive unique names; skipped while an older database still
      // holds twins (the API refuses new ones either way).
      await tx.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'client_types_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX client_types_name_key ON client_types (lower(btrim(name)));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'client_types_name_key skipped: duplicate names exist';
            END;
          END IF;
        END $$;
      `)
    })).catch((error) => {
      globalThis.__linkoClientTypesSchema = undefined
      throw error
    })
    globalThis.__linkoClientTypesSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoClientTypesSchema!.ready
}

function dateLabel(iso: string): string {
  const parsed = new Date(iso.replace(" ", "T") + "Z")
  if (Number.isNaN(parsed.getTime())) return iso
  return refDate(new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

function rowToClientType(row: Row): ClientType {
  return { id: row.id, name: row.name, supplier: row.supplier, date: dateLabel(row.created_at), parentId: row.parent_id ?? null, innRequired: !!row.inn_required }
}

export type ClientTypeInput = { name: string; supplier: string; parentId: number | null; innRequired: boolean }

export function parseClientTypeInput(body: unknown): ClientTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const supplier = typeof value.supplier === "string" && value.supplier.trim() ? value.supplier.trim() : "Не указано"
  const parentId = typeof value.parentId === "number" && Number.isInteger(value.parentId) ? value.parentId : null
  return { name, supplier, parentId, innRequired: value.innRequired === true }
}

// Clients (and KPI tasks) store the type NAME.
const REFERENCES = [
  { table: "clients", column: "type", kind: "name" as const },
  { table: "kpi_tasks", column: "client_type", kind: "name" as const },
  // Surveys ("Опросник") keep the type name next to its id (lib/surveys-repo.ts).
  { table: "surveys", column: "store_type", kind: "name" as const },
  { table: "surveys", column: "client_type_id", kind: "id" as const },
]

export async function listClientTypes(): Promise<ClientType[]> {
  await ensureSchema()
  const rows = ((await getDb().prepare("SELECT * FROM client_types").all()) as Row[]).map(rowToClientType)
  // Like the reference hierarchy: by name (case-insensitive), every child right after its parent.
  const byName = (a: ClientType, b: ClientType) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en") || a.id - b.id
  const ids = new Set(rows.map((row) => row.id))
  const roots = rows.filter((row) => row.parentId === null || !ids.has(row.parentId)).sort(byName)
  return roots.flatMap((root) => [root, ...rows.filter((row) => row.parentId === root.id).sort(byName)])
}

export async function getClientType(id: number): Promise<ClientType | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureSchema()
  const row = (await getDb().prepare("SELECT * FROM client_types WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToClientType(row) : null
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM client_types WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new ClientTypeError("Такой тип клиента уже существует", 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new ClientTypeError("Такой тип клиента уже существует", 409)
  throw error
}

export async function createClientType(input: ClientTypeInput): Promise<ClientType> {
  await ensureSchema()
  try {
    const id = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE client_types IN SHARE ROW EXCLUSIVE MODE").run()
      await assertNameFree(tx, input.name, 0)
      const result = await tx.prepare("INSERT INTO client_types (name, supplier, parent_id, inn_required) VALUES (@name, @supplier, @parentId, @innRequired)").run({ ...input, innRequired: input.innRequired ? 1 : 0 })
      return Number(result.lastInsertRowid)
    })
    return (await getClientType(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Renames the type; clients holding the old name follow in the same transaction. */
export async function updateClientType(id: number, input: ClientTypeInput): Promise<ClientType | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureSchema()
  try {
    const found = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE client_types IN SHARE ROW EXCLUSIVE MODE").run()
      const current = (await tx.prepare("SELECT * FROM client_types WHERE id = ?").get(id)) as Row | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      await tx.prepare("UPDATE client_types SET name = @name, supplier = @supplier, parent_id = @parentId, inn_required = @innRequired, updated_at = datetime('now') WHERE id = @id").run({ ...input, innRequired: input.innRequired ? 1 : 0, id })
      // Another type with the same key (older twins) keeps the clients on its name.
      const twins = (await tx.prepare(`SELECT COUNT(*)::int AS n FROM client_types WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(current.name, id)) as { n: number }
      if (!twins.n) await cascadeNameRename(tx, await existingReferences(tx, REFERENCES), current.name, input.name)
      return true
    })
    return found ? await getClientType(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused (409 with the usage list) while clients hold the type. */
export async function deleteClientType(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return false
  await ensureSchema()
  return withTransaction(async (tx) => {
    const current = (await tx.prepare("SELECT * FROM client_types WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
    if (!current) return false
    const twins = (await tx.prepare(`SELECT COUNT(*)::int AS n FROM client_types WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(current.name, id)) as { n: number }
    if (!twins.n) {
      const usage = await usageOf(tx, await existingReferences(tx, REFERENCES), { id, name: current.name })
      if (usage.length) throw new ClientTypeError("Удаление невозможно из-за связи с другими данными", 409, usage)
    }
    return (await tx.prepare("DELETE FROM client_types WHERE id = ?").run(id)).changes > 0
  })
}
