import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

// Reference "Транспорт" (main/transport/): model, number, driver, capacity (Объем, л),
// load_limit (Грузоподъёмность, кг) and an optional branch.
export type TransportVehicle = {
  id: number
  model: string
  number: string
  driver: string
  capacity: number
  loadLimit: number
  branch: { id: number; name: string } | null
}

type Row = {
  id: number
  model: string
  number: string
  driver: string
  capacity: number
  load_limit: number
  branch_id: number | null
  branch_name: string | null
}

// "Транспорт" is this company's own: a fresh database starts without any vehicle. An older build seeded the
// reference account's seven vehicles into a new table; those rows are removed only while they are exactly that
// seed and were never edited (updated_at = created_at). Each seeded vehicle is matched by the SHA-256 fingerprint
// of all its fields (id, model, number, driver, capacity, load limit, branch id, joined by U+001F), so the other
// company's vehicles and drivers are not kept in the code. A vehicle the company added or edited is never touched.
// Data only — nothing is inserted.
const LEGACY_SEED_FINGERPRINTS = [
  "d612960c64d04d20503568cbbe8bc35ba2c567d1d1242e7fa3efc28ab59ff0e1",
  "f389e126b50602fa1032c58e554e6e5936e5b32bbe21ec28917700f04359270f",
  "fae73481b57d092a847a0b7e410fcaa0354c9051f12c577106777f2cb6363a14",
  "9468ce0f04e8ebe6db2a7570f59b4b24c8067f0860df800b8b0338843be4e082",
  "7a8a6ef969fcc0c599f09e1d50b11f045284dbce5bf7ee31fe8ba19777cdc9c8",
  "19d3585e1209f09bf7af20e7bd3e43df74bbf132821140c6b1cce78ab87792f0",
  "13d8f36474751deb9c3023153c48db93d489cb4bfb408624302440f9508765b6",
]

const SCHEMA_VERSION = 3

declare global {
  var __linkoTransportSchema: { version: number; ready: Promise<void> } | undefined
}

/** The transports table, once per process and outside any request transaction. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoTransportSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:transports:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS transports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            number TEXT NOT NULL DEFAULT '',
            driver TEXT NOT NULL DEFAULT '',
            capacity DOUBLE PRECISION NOT NULL DEFAULT 0,
            load_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
            branch_id INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
        await tx
          .prepare(
            `DELETE FROM transports t
              WHERE t.updated_at = t.created_at
                AND encode(sha256(convert_to(concat_ws(chr(31), t.id::text, t.model, t.number, t.driver, t.capacity::float8::text,
                      t.load_limit::float8::text, COALESCE(t.branch_id::text, '')), 'UTF8')), 'hex') = ANY(@seed::text[])`,
          )
          .run({ seed: LEGACY_SEED_FINGERPRINTS })
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoTransportSchema = undefined
      throw error
    })
    globalThis.__linkoTransportSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoTransportSchema!.ready
}

const SELECT = `SELECT t.id, t.model, t.number, t.driver, t.capacity, t.load_limit, t.branch_id, b.name AS branch_name
  FROM transports t LEFT JOIN branches b ON b.id = t.branch_id`

function toVehicle(row: Row): TransportVehicle {
  return {
    id: row.id,
    model: row.model,
    number: row.number,
    driver: row.driver,
    capacity: Number(row.capacity),
    loadLimit: Number(row.load_limit),
    branch: row.branch_id !== null && row.branch_name !== null ? { id: row.branch_id, name: row.branch_name } : null,
  }
}

export type TransportInput = { model: string; number: string; driver: string; capacity: number; loadLimit: number; branchId: number | null }

export async function listTransport(): Promise<TransportVehicle[]> {
  await ensureSchema()
  return ((await getDb().prepare(`${SELECT} ORDER BY t.id DESC`).all()) as Row[]).map(toVehicle)
}

export async function getTransport(id: number): Promise<TransportVehicle | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`${SELECT} WHERE t.id = ?`).get(id)) as Row | undefined
  return row ? toVehicle(row) : null
}

export async function branchExists(id: number): Promise<boolean> {
  return Boolean(await getDb().prepare("SELECT 1 AS ok FROM branches WHERE id = ?").get(id))
}

export async function createTransport(input: TransportInput): Promise<TransportVehicle> {
  await ensureSchema()
  const result = await getDb()
    .prepare("INSERT INTO transports (model, number, driver, capacity, load_limit, branch_id) VALUES (@model, @number, @driver, @capacity, @loadLimit, @branchId)")
    .run(input)
  return (await getTransport(Number(result.lastInsertRowid)))!
}

export async function updateTransport(id: number, input: TransportInput): Promise<TransportVehicle | null> {
  await ensureSchema()
  if (!(await getTransport(id))) return null
  await getDb()
    .prepare(
      "UPDATE transports SET model = @model, number = @number, driver = @driver, capacity = @capacity, load_limit = @loadLimit, branch_id = @branchId, updated_at = datetime('now') WHERE id = @id",
    )
    .run({ id, ...input })
  return getTransport(id)
}

export async function deleteTransport(id: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM transports WHERE id = ?").run(id)).changes > 0
}
